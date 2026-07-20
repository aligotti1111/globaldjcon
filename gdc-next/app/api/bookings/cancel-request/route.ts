// /api/bookings/cancel-request — ask to cancel a booking, and answer that ask.
//
// WHY A REQUEST AND NOT A CANCEL BUTTON
// A booked date is a promise two people made. Either of them can want out, but
// neither should be able to erase it alone: the DJ turned down other work for
// it, and the host built a day around it. So one side ASKS and the other side
// ANSWERS. The booking's own status stays 'approved' the whole time a request
// is pending — contracts, payments and planners keep working, because until
// somebody accepts, nothing has actually changed.
//
// A cancellation is also not a legal event. If a contract was signed, cancelling
// here does not undo it; the emails say so, but only when a contract actually
// exists (see contractLine in /api/send-email — silence is better than a
// paragraph of boilerplate about a document nobody signed).
//
// THREE ACTIONS
//   request  — logged in, DJ or host on this booking. Optional reason.
//   accept   — the OTHER side agrees. Booking flips to 'cancelled'.
//   decline  — the OTHER side refuses. Booking untouched; both sides are told
//              to talk to each other.
//
// TWO WAYS TO AUTHORIZE
//   Session — the DJ, who has an account and comes from /upcoming-bookings.
//   Token   — the host, who does not have an account and never will. The token
//             is an unguessable uuid mailed to them, the same capability-URL
//             pattern as /planner/[id] and /pay/[id]. It expires, it is
//             regenerated on every new request, and it is cleared the moment
//             it's used, so a forwarded email can't act twice.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A cancel link stays good for two weeks. Long enough that a host who reads
// email on Sundays still gets to answer; short enough that a link sitting in an
// old inbox isn't a live button on a booking months later.
const TOKEN_TTL_DAYS = 14;

type Side = 'dj' | 'host';

interface BookingRow {
  id: string;
  dj_id: string | null;
  requester_id: string | null;
  status: string | null;
  event_date: string | null;
  booking_type: string | null;
  set_type: string | null;
  cancel_status: string | null;
  cancel_requested_by: string | null;
  cancel_token: string | null;
  cancel_token_expires_at: string | null;
}

const SELECT =
  'id, dj_id, requester_id, status, event_date, booking_type, set_type, cancel_status, cancel_requested_by, cancel_token, cancel_token_expires_at';

/**
 * Give the DJ their slot back.
 *
 * Approving a booking spends capacity: a mobile DJ's day counter drops by one
 * (users.booking_settings.mob_booking_days[date].bookings_available) and the
 * day is flagged `booked` when it hits zero; a club DJ's date is simply flagged
 * booked. See /api/booking-approve, which this is the exact inverse of.
 *
 * If cancelling didn't undo that, a DJ who takes two events a day and loses one
 * would be stuck at one for that date forever — the calendar would keep telling
 * the world they're full on a night they're free. The whole point of a
 * cancellation is that the night is available again.
 *
 * Deliberately does NOT touch `unavailable`: that's the DJ blocking the day
 * themselves, and it has nothing to do with this booking.
 *
 * Best-effort — a calendar write that fails must never leave the booking
 * half-cancelled, so this throws nothing.
 */
async function releaseCalendarSlot(
  admin: SupabaseClient,
  booking: BookingRow,
): Promise<void> {
  if (!booking.dj_id || !booking.event_date) return;
  try {
    const { data: djRow } = await admin
      .from('users')
      .select('booking_settings')
      .eq('id', booking.dj_id)
      .single<{ booking_settings: string | null }>();

    let bs: {
      mob_bookings_per_day?: number;
      mob_booking_days?: Record<string, {
        bookings_available?: number;
        booked?: boolean;
        unavailable?: boolean;
      }>;
      booking_days?: Record<string, { booked?: boolean; unavailable?: boolean }>;
    } = {};
    if (djRow?.booking_settings) {
      try {
        bs = JSON.parse(djRow.booking_settings);
      } catch {
        return; // Unreadable settings — leave them alone rather than clobber.
      }
    }

    // Same club test the approve route uses: club bookings always carry a
    // set_type, and booking_type is authoritative when present.
    const isClubBooking = booking.booking_type === 'club' || !!booking.set_type;

    if (isClubBooking) {
      if (!bs.booking_days) bs.booking_days = {};
      const existing = bs.booking_days[booking.event_date] || {};
      bs.booking_days[booking.event_date] = { ...existing, booked: false };
    } else {
      const defaultPerDay = bs.mob_bookings_per_day || 1;
      if (!bs.mob_booking_days) bs.mob_booking_days = {};
      const dayData = bs.mob_booking_days[booking.event_date] || {};
      const current = dayData.bookings_available != null
        ? dayData.bookings_available
        : defaultPerDay;
      // Hand back one slot, but never more than the DJ's own per-day setting —
      // otherwise repeated cancels on a date could inflate capacity past what
      // the DJ ever agreed to work.
      const newCount = Math.min(defaultPerDay, current + 1);
      bs.mob_booking_days[booking.event_date] = {
        ...dayData,
        bookings_available: newCount,
        // There's room again by definition, so the day is not full.
        booked: false,
      };
    }

    await admin
      .from('users')
      .update({ booking_settings: JSON.stringify(bs) } as unknown as never)
      .eq('id', booking.dj_id);
  } catch (e) {
    console.warn('releaseCalendarSlot failed:', e);
  }
}

/** Cloudflare swallows 502s, so every failure here is a 500. */
function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail('Bad request body');
  }

  const action = String(body.action || '');
  if (action !== 'request' && action !== 'accept' && action !== 'decline') {
    return fail('Unknown action');
  }

  // booking_planners-era tables postdate the generated types; bookings itself is
  // typed, but the cancel_* columns are newer than types/supabase.ts. Same cast
  // used elsewhere for this reason.
  const admin = createAdminClient() as unknown as SupabaseClient;

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const bookingId = typeof body.bookingId === 'string' ? body.bookingId.trim() : '';

  // ── Find the booking, and work out who is asking ────────────────────
  let booking: BookingRow | null = null;
  let actor: Side | null = null;

  if (token) {
    // Token path — no session. The token IS the authorization, and it only
    // ever belongs to the side that did NOT make the request.
    if (!/^[0-9a-f-]{36}$/i.test(token)) return fail('Invalid link', 404);
    const { data } = await admin
      .from('bookings')
      .select(SELECT)
      .eq('cancel_token', token)
      .maybeSingle<BookingRow>();
    if (!data) return fail('This link is no longer valid.', 404);
    if (
      data.cancel_token_expires_at &&
      new Date(data.cancel_token_expires_at).getTime() < Date.now()
    ) {
      return fail('This link has expired. Please contact the other party directly.', 410);
    }
    booking = data;
    // Whoever holds the token is the responder — the opposite side to the asker.
    actor = data.cancel_requested_by === 'dj' ? 'host' : 'dj';
    // A token can only answer a request, never start one.
    if (action === 'request') return fail('Invalid link', 404);
  } else {
    // Session path — must be logged in AND be one of the two parties.
    if (!bookingId || !/^[0-9a-f-]{36}$/i.test(bookingId)) return fail('Missing booking');
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail('Not signed in', 401);

    const { data } = await admin
      .from('bookings')
      .select(SELECT)
      .eq('id', bookingId)
      .maybeSingle<BookingRow>();
    if (!data) return fail('Booking not found', 404);

    if (data.dj_id === user.id) actor = 'dj';
    else if (data.requester_id === user.id) actor = 'host';
    else return fail('Not your booking', 403);

    booking = data;
  }

  if (!booking || !actor) return fail('Booking not found', 404);

  // Already gone — nothing to request or answer.
  if (booking.status === 'cancelled') {
    return fail('This booking is already cancelled.', 409);
  }

  // Past events are history, not plans. You cannot cancel a night that already
  // happened — the DJ showed up, or didn't, and that's a conversation for the
  // two of them, not a status change. event_date is a plain date, so a string
  // compare against today is exact.
  const todayStr = new Date().toISOString().slice(0, 10);
  if (booking.event_date && booking.event_date < todayStr) {
    return fail('This event has already passed and can no longer be cancelled.', 409);
  }

  const nowIso = new Date().toISOString();

  // ── REQUEST ─────────────────────────────────────────────────────────
  if (action === 'request') {
    if (booking.cancel_status === 'requested') {
      return fail('A cancellation request is already pending on this booking.', 409);
    }

    const reason =
      typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 1000) : null;

    // Fresh token every request. A previous request that was declined leaves a
    // dead link behind, which is the point: that email should not still work.
    const newToken = crypto.randomUUID();
    const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await admin
      .from('bookings')
      .update({
        cancel_status: 'requested',
        cancel_requested_by: actor,
        cancel_requested_by_id: null,
        cancel_reason: reason,
        cancel_requested_at: nowIso,
        cancel_responded_at: null,
        cancel_token: newToken,
        cancel_token_expires_at: expires,
        updated_at: nowIso,
      } as unknown as never)
      .eq('id', booking.id);
    if (error) {
      console.error('cancel request update failed:', error);
      return fail('Could not save the request. Please try again.', 500);
    }

    // Best-effort email — a failed send never undoes a saved request.
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || ''}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'cancel_requested',
          bookingId: booking.id,
          requestedBy: actor,
        }),
      });
    } catch (e) {
      console.warn('cancel_requested email failed:', e);
    }

    return NextResponse.json({ ok: true, cancel_status: 'requested' });
  }

  // ── ACCEPT / DECLINE ────────────────────────────────────────────────
  if (booking.cancel_status !== 'requested') {
    return fail('There is no cancellation request to answer.', 409);
  }
  // The side that ASKED cannot also answer. (Withdrawing is a separate thing;
  // it isn't this route.)
  if (booking.cancel_requested_by === actor) {
    return fail('You made this request — the other party needs to answer it.', 403);
  }

  const accepted = action === 'accept';

  const { error } = await admin
    .from('bookings')
    .update({
      cancel_status: accepted ? 'accepted' : 'declined',
      cancel_responded_at: nowIso,
      // Burn the token either way: this link has done its job.
      cancel_token: null,
      cancel_token_expires_at: null,
      // Only an ACCEPT touches the booking itself.
      ...(accepted ? { status: 'cancelled' } : {}),
      updated_at: nowIso,
    } as unknown as never)
    .eq('id', booking.id)
    // Guard against two clicks racing: only the first one finds 'requested'.
    .eq('cancel_status', 'requested');
  if (error) {
    console.error('cancel response update failed:', error);
    return fail('Could not save your answer. Please try again.', 500);
  }

  // The date is free again — put the slot back on the DJ's calendar so they can
  // fill it. Only on accept: a declined request changed nothing.
  if (accepted) {
    await releaseCalendarSlot(admin, booking);
  }

  try {
    await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || ''}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: accepted ? 'cancel_accepted' : 'cancel_declined',
        bookingId: booking.id,
        respondedBy: actor,
      }),
    });
  } catch (e) {
    console.warn('cancel response email failed:', e);
  }

  return NextResponse.json({ ok: true, cancel_status: accepted ? 'accepted' : 'declined' });
}
