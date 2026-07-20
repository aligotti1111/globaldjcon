// /api/auth/lookup-identifier — "who does this email or phone belong to?"
//
// WHY THIS EXISTS
// The login page has one field. Somebody types an email or a phone number and
// we have to work out what to offer them: a password box, a code, or an
// explanation. Only the server can answer that, because it means reading
// auth.users and other people's bookings.
//
// THE CASE THAT DROVE THE DESIGN
// A host signs up with an email. Months later they come back and type their
// PHONE number, because that's what people do. That number is nowhere in auth
// — but it IS on the booking they made, sitting next to their requester_id.
//
// If we only checked auth we'd say "no account found", they'd sign up again,
// and now one person has two accounts with their bookings split between them.
// That is the single worst outcome in this whole feature, and it's silent.
//
// So a phone is looked for in three places, in order of how sure we are:
//   1. auth.users.phone   — they signed up by phone
//   2. users.sms_phone    — they added it for notifications
//   3. bookings.phone     — they typed it while booking  ← the case above
//
// WHAT THIS DELIBERATELY DOES NOT DO
// It never creates anything, and it never returns a name, an email, or a user
// id. The answer is only ever "there is an account, here's how it can be
// opened" or "there isn't". Anyone can type numbers into a login box; nobody
// should be able to harvest whose they are.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What the login page needs to decide which screen to draw. */
interface LookupResult {
  /** 'email' | 'phone' — what we decided they typed. */
  kind: 'email' | 'phone';
  /** Is there an account behind it at all? */
  found: boolean;
  /** Can they type a password? False for accounts that never set one. */
  canPassword: boolean;
  /** Can we send a code to this identifier? */
  canCode: boolean;
  /**
   * True when the number matched a stored number rather than an auth identity —
   * i.e. we found them via sms_phone or a booking. The code still gets sent;
   * this just tells the client to say "we found your account" rather than
   * silently proceeding, and tells verify-otp to attach the phone afterwards.
   */
  linkOnVerify?: boolean;
}

/**
 * Digits only, then E.164. Mirrors the normalisation in lib/supabase/sms.ts so
 * a number stored by the notification system matches one typed at login —
 * "(555) 555-5555" and "+15555555555" have to land on the same account.
 */
function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** Loose but adequate — the real validation is whether a code arrives. */
function looksLikeEmail(raw: string): boolean {
  return raw.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

export async function POST(req: Request) {
  let body: { identifier?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const raw = (body.identifier || '').trim();
  if (!raw) {
    return NextResponse.json({ error: 'Enter an email address or phone number.' }, { status: 400 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;

  // ── EMAIL ─────────────────────────────────────────────────────────
  if (looksLikeEmail(raw)) {
    const email = raw.toLowerCase();

    // listUsers is the supported way to find an auth user by email without a
    // direct auth-schema query. Small page: we want one exact match, not a scan.
    let authUser: { id: string } | null = null;
    try {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const hit = (data?.users || []).find(
        (u) => (u.email || '').toLowerCase() === email,
      );
      if (hit) authUser = { id: hit.id };
    } catch (e) {
      console.warn('[lookup] listUsers failed:', e);
    }

    // Also check contact_email — a phone-signup host's delivery address. They
    // may well type it at login, and it should find them.
    if (!authUser) {
      const { data: profile } = await admin
        .from('users')
        .select('id')
        .ilike('contact_email', email)
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (profile) authUser = { id: profile.id };
    }

    const result: LookupResult = {
      kind: 'email',
      found: !!authUser,
      // Any email account can try a password; if they never set one, Supabase
      // rejects it and they fall back to the code. Offering it is harmless and
      // keeps the DJ path exactly as it is today.
      canPassword: !!authUser,
      canCode: !!authUser,
    };
    return NextResponse.json(result);
  }

  // ── PHONE ─────────────────────────────────────────────────────────
  const e164 = toE164(raw);
  if (!e164) {
    return NextResponse.json(
      { error: 'That doesn’t look like an email address or phone number.' },
      { status: 400 },
    );
  }

  // 1. An actual auth identity — they signed up by phone.
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const hit = (data?.users || []).find((u) => u.phone === e164.replace('+', '') || u.phone === e164);
    if (hit) {
      const result: LookupResult = {
        kind: 'phone',
        found: true,
        // Phone accounts have no password unless they chose to add one. The
        // client greys the password button; Supabase is the real arbiter.
        canPassword: false,
        canCode: true,
      };
      return NextResponse.json(result);
    }
  } catch (e) {
    console.warn('[lookup] listUsers (phone) failed:', e);
  }

  // 2. Their notification number.
  const { data: byPrefs } = await admin
    .from('users')
    .select('id, sms_phone')
    .not('sms_phone', 'is', null)
    .limit(1000);
  const prefsHit = ((byPrefs as { id: string; sms_phone: string | null }[] | null) || [])
    .find((u) => u.sms_phone && toE164(u.sms_phone) === e164);
  if (prefsHit) {
    const result: LookupResult = {
      kind: 'phone', found: true, canPassword: false, canCode: true, linkOnVerify: true,
    };
    return NextResponse.json(result);
  }

  // 3. A number they typed while booking. THE case this route exists for.
  //    requester_id is what ties that row back to a real account; a booking
  //    made by a guest with no account can't help us and is skipped.
  const { data: byBooking } = await admin
    .from('bookings')
    .select('requester_id, phone')
    .not('phone', 'is', null)
    .not('requester_id', 'is', null)
    .limit(2000);
  const bookingHit = ((byBooking as { requester_id: string | null; phone: string | null }[] | null) || [])
    .find((b) => b.phone && toE164(b.phone) === e164);
  if (bookingHit?.requester_id) {
    const result: LookupResult = {
      kind: 'phone', found: true, canPassword: false, canCode: true, linkOnVerify: true,
    };
    return NextResponse.json(result);
  }

  // Nothing anywhere. Never offer to create an account from here — that's how
  // the person who signed up with an email ends up with a second one. The
  // client's copy points them at their email instead.
  const result: LookupResult = {
    kind: 'phone', found: false, canPassword: false, canCode: false,
  };
  return NextResponse.json(result);
}
