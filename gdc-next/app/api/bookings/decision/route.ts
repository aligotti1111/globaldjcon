// POST /api/bookings/decision — the DJ-side responses to an incoming request.
//
// WHY THIS EXISTS
// Approve / Deny / Counter / Quote used to run in the BROWSER against the
// bookings table. That works for an account OWNER (their login owns the row),
// but a TEAM MEMBER's login does not: the bookings table has no team-member RLS
// policy, so the member's UPDATE silently matches ZERO rows with NO error. The
// UI flashed "Booking approved" and emailed the host while nothing saved — so
// managers/admins (who are meant to accept) couldn't, and an assistant (who is
// NOT) could still trigger a false "approved" email.
//
// So these writes move here, where they are:
//   1. ROLE-GATED — manager+ only (owner / admin / manager). Assistants 403.
//   2. Scoped to acting.djId (the OWNER), written with the admin client so the
//      row actually updates for a teammate.
//   3. The single source of truth: the client only emails AFTER this returns ok.
//
// Body: { bookingId, action: 'approve'|'deny'|'counter'|'quote', ... }
//   approve/deny — server computes status, accepted_at, agreed money + calendar.
//   counter/quote — client sends a WHITELISTED `patch` (the modal already did
//     the pricing math); the server gates + scopes the write it can't do safely
//     in the browser. Only booking-scoped, non-payment-routing columns pass.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActingContext, canAcceptBookings } from '@/lib/acting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Columns a counter / quote is allowed to write. Everything here is
// booking-scoped negotiation/pricing state — NOT payment routing, tier, or
// ownership. Anything not on this list is dropped.
//
// negotiation_log is DELIBERATELY absent: a teammate can't reliably read the
// current log in the browser (RLS), so a client-built log would truncate the
// history. Instead the client sends `appendLog` and the server reads-and-appends
// authoritatively below.
const PATCH_WHITELIST = new Set<string>([
  'status',
  'counter_rate', 'counter_message', 'package_details',
  'quoted_rate', 'deposit_amount', 'tax_pct', 'tax_amount', 'total_with_tax',
  'overtime_rate', 'offer_discount_pct', 'offer_discount_amount',
  'cocktail_price', 'cocktail_included', 'ceremony_price', 'ceremony_included',
  'quote_sent_at',
]);

interface LogEntry { from: 'dj' | 'booker'; amount: number; message: string; created_at: string }

// Statuses a counter/quote may set — never 'approved' (that path computes money
// + calendar itself) and never a terminal/foreign status.
const ALLOWED_PATCH_STATUS = new Set<string>(['counter', 'pending']);

interface BookingLite {
  id: string;
  dj_id: string | null;
  event_date: string | null;
  set_type: string | null;
  counter_rate: number | null;
  quoted_rate: number | null;
  offer_amount: number | null;
  tax_pct: number | null;
  deposit_pct: number | null;
  negotiation_log: LogEntry[] | null;
}

// The money snapshot stamped onto a booking when it's approved — mirrors the
// client's old acceptedMoneyPatch exactly.
function acceptedMoneyPatch(b: BookingLite): Record<string, number | null> {
  const agreed = Number(b.counter_rate ?? b.quoted_rate ?? b.offer_amount ?? 0);
  if (!Number.isFinite(agreed) || agreed <= 0) return {};
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const taxPct = Number(b.tax_pct) || 0;
  const depPct = Number(b.deposit_pct) || 0;
  const taxAmount = taxPct > 0 ? round2((agreed * taxPct) / 100) : 0;
  const totalWithTax = round2(agreed + taxAmount);
  return {
    tax_amount: taxPct > 0 ? taxAmount : null,
    total_with_tax: totalWithTax,
    deposit_amount: depPct > 0 ? round2((totalWithTax * depPct) / 100) : null,
  };
}

// Approve → mark the event date used on the OWNER's calendar. Club bookings
// flip the day's `booked` flag; mobile decrements bookings_available. Re-reads
// settings first so a concurrent edit isn't clobbered (same as the client did).
async function markCalendar(
  admin: SupabaseClient, djId: string, b: BookingLite,
): Promise<void> {
  if (!b.event_date) return;
  const isClub = !!b.set_type;
  const { data: djRow } = await admin
    .from('users')
    .select('booking_settings')
    .eq('id', djId)
    .single<{ booking_settings: string | null }>();
  let bs: {
    mob_bookings_per_day?: number;
    mob_booking_days?: Record<string, { bookings_available?: number; booked?: boolean; unavailable?: boolean }>;
    booking_days?: Record<string, { booked?: boolean; unavailable?: boolean }>;
  } = {};
  if (djRow?.booking_settings) {
    try {
      bs = typeof djRow.booking_settings === 'string'
        ? JSON.parse(djRow.booking_settings)
        : (djRow.booking_settings as unknown as typeof bs);
    } catch { bs = {}; }
  }
  if (isClub) {
    if (!bs.booking_days) bs.booking_days = {};
    const existing = bs.booking_days[b.event_date] || {};
    bs.booking_days[b.event_date] = { ...existing, booked: true };
  } else {
    const defaultPerDay = bs.mob_bookings_per_day || 1;
    if (!bs.mob_booking_days) bs.mob_booking_days = {};
    const dayData = bs.mob_booking_days[b.event_date] || {};
    const current = dayData.bookings_available != null ? dayData.bookings_available : defaultPerDay;
    bs.mob_booking_days[b.event_date] = { ...dayData, bookings_available: Math.max(0, current - 1) };
  }
  await admin
    .from('users')
    .update({ booking_settings: JSON.stringify(bs) } as unknown as never)
    .eq('id', djId);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { bookingId?: unknown; action?: unknown; patch?: unknown; appendLog?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const bookingId = typeof body.bookingId === 'string' && body.bookingId ? body.bookingId : null;
  const action = typeof body.action === 'string' ? body.action : null;
  if (!bookingId || !action || !['approve', 'deny', 'counter', 'quote'].includes(action)) {
    return NextResponse.json({ error: 'Missing or invalid bookingId/action' }, { status: 400 });
  }

  // Manager+ only. Assistants may send documents, not decide bookings.
  const acting = await getActingContext(user.id);
  if (!canAcceptBookings(acting.role)) {
    return NextResponse.json({ error: 'You do not have permission to respond to bookings.' }, { status: 403 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: bData } = await admin
    .from('bookings')
    .select('id, dj_id, event_date, set_type, counter_rate, quoted_rate, offer_amount, tax_pct, deposit_pct, negotiation_log')
    .eq('id', bookingId)
    .maybeSingle();
  const b = bData as unknown as BookingLite | null;
  if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  if (b.dj_id !== acting.djId) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });

  const now = new Date().toISOString();

  // ── Approve / Deny ── the server owns the whole computation.
  if (action === 'approve' || action === 'deny') {
    const patch: Record<string, unknown> = {
      status: action === 'approve' ? 'approved' : 'denied',
      updated_at: now,
      ...(action === 'approve' ? { accepted_at: now, ...acceptedMoneyPatch(b) } : {}),
    };
    const { error } = await admin
      .from('bookings')
      .update(patch as unknown as never)
      .eq('id', bookingId)
      .eq('dj_id', acting.djId);
    if (error) return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
    if (action === 'approve') {
      try { await markCalendar(admin, acting.djId, b); } catch { /* non-fatal */ }
    }
    return NextResponse.json({ ok: true });
  }

  // ── Counter / Quote ── the modal already did the pricing; we gate + scope
  // the write. Whitelist the columns and constrain the status it may set.
  const rawPatch = (body.patch && typeof body.patch === 'object') ? body.patch as Record<string, unknown> : null;
  if (!rawPatch) return NextResponse.json({ error: 'Missing patch.' }, { status: 400 });
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawPatch)) {
    if (PATCH_WHITELIST.has(k)) patch[k] = v;
  }
  if (typeof patch.status === 'string' && !ALLOWED_PATCH_STATUS.has(patch.status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }
  // Append to the negotiation log HERE, from the row we just read with the admin
  // client — the authoritative current value. (The browser can't read it under
  // RLS for a teammate, so a client-built log would drop the history.)
  const al = (body.appendLog && typeof body.appendLog === 'object') ? body.appendLog as Partial<LogEntry> : null;
  if (al && typeof al.amount === 'number' && (al.from === 'dj' || al.from === 'booker')) {
    const log = Array.isArray(b.negotiation_log) ? [...b.negotiation_log] : [];
    log.push({ from: al.from, amount: al.amount, message: typeof al.message === 'string' ? al.message : '', created_at: now });
    patch.negotiation_log = log;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 });
  }
  patch.updated_at = now;
  const { error } = await admin
    .from('bookings')
    .update(patch as unknown as never)
    .eq('id', bookingId)
    .eq('dj_id', acting.djId);
  if (error) return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
