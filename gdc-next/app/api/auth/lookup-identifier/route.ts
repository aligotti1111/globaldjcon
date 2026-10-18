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
   * DEPRECATED / never set. A phone now counts as an account only when it's a
   * real auth identity (a phone signup); we no longer match saved notification
   * numbers (users.sms_phone) or booking phones, so there's nothing to "link on
   * verify." Kept on the type only so existing client reads compile; it is
   * always falsy.
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
    // Exact, INDEXED lookup in auth.users — scales past 200 accounts. (The old
    // page-1 listUsers scan silently missed anyone created after the first 200.)
    try {
      const { data: uid } = await admin.rpc('auth_user_id_by_email', { p_email: email });
      if (uid) authUser = { id: uid as string };
    } catch (e) {
      console.warn('[lookup] auth_user_id_by_email rpc failed:', e);
    }
    // Fallback (small deployments where the function isn't present yet).
    if (!authUser) {
      try {
        const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const hit = (data?.users || []).find((u) => (u.email || '').toLowerCase() === email);
        if (hit) authUser = { id: hit.id };
      } catch (e) {
        console.warn('[lookup] listUsers fallback failed:', e);
      }
    }

    // Also check contact_email — a phone-signup host's delivery address. They
    // may well type it at login, and it should find them. Case-insensitive, but
    // with LIKE wildcards neutralized: ilike treats % and _ specially, and the
    // email validator allows % in the local part, so a raw `%@domain` would
    // return found:true for any host at that domain — a cheap existence oracle.
    // Escaping % _ \ makes the pattern match the literal address only.
    if (!authUser) {
      const literal = email.replace(/[\\%_]/g, '\\$&');
      const { data: profile } = await admin
        .from('users')
        .select('id')
        .ilike('contact_email', literal)
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

  // 1. An actual auth identity — they signed up by phone. Indexed lookup so it
  //    scales past the first 200 accounts.
  let phoneAuthId: string | null = null;
  try {
    const { data: uid } = await admin.rpc('auth_user_id_by_phone', { p_phone: e164 });
    if (uid) phoneAuthId = uid as string;
  } catch (e) {
    console.warn('[lookup] auth_user_id_by_phone rpc failed:', e);
  }
  if (!phoneAuthId) {
    try {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const hit = (data?.users || []).find((u) => u.phone === e164.replace('+', '') || u.phone === e164);
      if (hit) phoneAuthId = hit.id;
    } catch (e) {
      console.warn('[lookup] listUsers (phone) fallback failed:', e);
    }
  }
  if (phoneAuthId) {
    const result: LookupResult = { kind: 'phone', found: true, canPassword: false, canCode: true };
    return NextResponse.json(result);
  }

  // A PHONE COUNTS AS AN ACCOUNT ONLY WHEN IT WAS USED TO SIGN UP.
  //
  // We deliberately do NOT look the number up in users.sms_phone (a saved
  // notification preference) or bookings.phone (a number typed while booking).
  // Those are things a person uses their phone FOR — they are not a sign-in
  // credential, and treating them as one is wrong twice over:
  //   • it can resolve someone else's number (a client's phone a DJ typed on a
  //     booking) to the wrong account, and
  //   • there is no phone auth identity to send a login code to anyway, so the
  //     "we found your account" path can't actually sign anyone in.
  // So a number that was never used to sign up is simply "not found" here. The
  // person keeps using their phone for notifications/bookings freely, and if
  // they actually have an account under an email, the client tells them to use
  // it. (verify-otp has nothing to attach, and no account is ever auto-created
  // from this route.)
  const result: LookupResult = {
    kind: 'phone', found: false, canPassword: false, canCode: false,
  };
  return NextResponse.json(result);
}
