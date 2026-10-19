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
import { effectiveTimezone, todayInTz } from '@/lib/bookingExpiry';
import { getActingContext, canAcceptBookings, canBilling } from '@/lib/acting';
import { logActivity } from '@/lib/activityLog';

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
  start_time: string | null;
  end_time: string | null;
  booking_type: string | null;
  set_type: string | null;
  cancel_status: string | null;
  cancel_requested_by: string | null;
  cancel_token: string | null;
  cancel_token_expires_at: string | null;
  // For the manual-booking direct cancel (no host approval when no contract).
  is_manual: boolean | null;
  host_email: string | null;
  requester_name: string | null;
  venue_name: string | null;
  contract_status: string | null;
  contract_signed_at: string | null;
  status_overrides: Record<string, boolean> | null;
}

const SELECT =
  'id, dj_id, requester_id, status, event_date, start_time, end_time, booking_type, set_type, cancel_status, cancel_requested_by, cancel_token, cancel_token_expires_at, is_manual, host_email, requester_name, venue_name, contract_status, contract_signed_at, status_overrides';

// Whether a real, AGREED contract sits on this booking — a signed/completed
// document (or one the DJ manually marked complete). Only then does cancelling a
// manual booking need the host's approval; without one the DJ owns the booking
// and can cancel it outright.
function hasAgreedContract(b: BookingRow): boolean {
  return b.contract_status === 'signed'
    || b.contract_status === 'completed'
    || !!b.contract_signed_at
    || !!(b.status_overrides && b.status_overrides.contract);
}

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
  if (action !== 'request' && action !== 'accept' && action !== 'decline' && action !== 'cancel-direct') {
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
  // Captured on the session (DJ) path so the DJ-side action can be logged to the
  // owner's activity trail. Null on the host token path.
  let djActing: import('@/lib/acting').ActingContext | null = null;

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
    // A token can only answer a request, never start one or cancel directly.
    if (action === 'request' || action === 'cancel-direct') return fail('Invalid link', 404);
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

    // TEAM SEATS: a teammate acts on the OWNER's booking (dj_id === acting.djId),
    // and cancelling is a manager+ action. The host is always their own account
    // (requester_id === user.id) and never a teammate. Keying the DJ side to
    // user.id 403'd every teammate.
    const acting = await getActingContext(user.id);
    if (data.dj_id === acting.djId) {
      if (!canAcceptBookings(acting.role)) {
        return fail('You do not have permission to cancel this booking.', 403);
      }
      // SENDING a cancellation request — or directly cancelling a manual booking
      // — is OWNER-ONLY. Answering one (accept/decline) stays manager+, but
      // ending a booking is reserved for the account owner.
      if ((action === 'request' || action === 'cancel-direct') && !canBilling(acting.role)) {
        return fail('Only the account owner can cancel a booking.', 403);
      }
      actor = 'dj';
      djActing = acting;
    } else if (data.requester_id === user.id) {
      actor = 'host';
    } else {
      return fail('Not your booking', 403);
    }

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
  // "Today" in the DJ's timezone — otherwise a same-day event becomes
  // un-cancellable from 8pm ET on the event day instead of at local midnight.
  const { data: djTz } = booking.dj_id
    ? await admin.from('users').select('timezone').eq('id', booking.dj_id).maybeSingle<{ timezone: string | null }>()
    : { data: null };
  const todayStr = todayInTz(effectiveTimezone(djTz?.timezone, null));
  if (booking.event_date && booking.event_date < todayStr) {
    return fail('This event has already passed and can no longer be cancelled.', 409);
  }

  const nowIso = new Date().toISOString();

  // ── CANCEL DIRECT (manual bookings, no signed contract) ─────────────
  // A manual booking the DJ entered themselves is theirs to cancel — UNLESS an
  // agreed (signed) contract sits on it, in which case it behaves like a normal
  // online booking and needs the host's approval (the request flow below). With
  // no contract, the DJ cancels outright and the host is simply emailed that the
  // DJ cancelled it. Session DJ only (blocked on the token path above).
  if (action === 'cancel-direct') {
    if (actor !== 'dj') return fail('Only the DJ can cancel this booking.', 403);
    if (!booking.is_manual) return fail('Only manually-added bookings can be cancelled directly.', 400);
    if (hasAgreedContract(booking)) {
      return fail('This booking has a signed contract — the host must approve the cancellation.', 409);
    }

    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 1000) : null;

    const { data: rows, error } = await admin
      .from('bookings')
      .update({
        status: 'cancelled',
        cancel_status: 'accepted',
        cancel_requested_by: 'dj',
        cancel_reason: reason,
        cancel_requested_at: nowIso,
        cancel_responded_at: nowIso,
        cancel_token: null,
        cancel_token_expires_at: null,
        updated_at: nowIso,
      } as unknown as never)
      .eq('id', booking.id)
      .neq('status', 'cancelled')
      .select('id');
    if (error) {
      console.error('direct cancel update failed:', error);
      return fail('Could not cancel the booking. Please try again.', 500);
    }
    const applied = Array.isArray(rows) && rows.length > 0;
    if (applied) await releaseCalendarSlot(admin, booking);

    // The host is deliberately NOT emailed here. A manual booking is the DJ's
    // own entry; the DJ handles telling the host and settling any refund per
    // whatever they agreed. (Online bookings, and manual bookings with a signed
    // contract, go through the request flow below, which does email.)

    if (djActing) await logActivity(djActing, { action: 'cancellation.direct', summary: 'Cancelled a manual booking (no contract — immediate, host not notified)', bookingId: booking.id });
    return NextResponse.json({ ok: true, cancel_status: 'accepted', status: 'cancelled' });
  }

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
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.CRON_SECRET || '' },
        body: JSON.stringify({
          type: 'cancel_requested',
          bookingId: booking.id,
          requestedBy: actor,
        }),
      });
    } catch (e) {
      console.warn('cancel_requested email failed:', e);
    }

    if (djActing) await logActivity(djActing, { action: 'cancellation.requested', summary: 'Requested to cancel a booking', bookingId: booking.id });
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

  // The DJ may include a note with their answer — stored on the booking and
  // emailed to the host. (Only the DJ side; the host doesn't answer their own
  // request, and a host answering a DJ request doesn't get this field.)
  const responseNote = (actor === 'dj' && typeof body.note === 'string' && body.note.trim())
    ? body.note.trim().slice(0, 1000)
    : null;

  const { data: respRows, error } = await admin
    .from('bookings')
    .update({
      cancel_status: accepted ? 'accepted' : 'declined',
      cancel_responded_at: nowIso,
      cancel_response_note: responseNote,
      // Burn the token either way: this link has done its job.
      cancel_token: null,
      cancel_token_expires_at: null,
      // Only an ACCEPT touches the booking itself.
      ...(accepted ? { status: 'cancelled' } : {}),
      updated_at: nowIso,
    } as unknown as never)
    .eq('id', booking.id)
    // Guard against two clicks racing: only the first one finds 'requested'.
    .eq('cancel_status', 'requested')
    .select('id');
  if (error) {
    console.error('cancel response update failed:', error);
    return fail('Could not save your answer. Please try again.', 500);
  }
  // Did THIS request win the race? A second click matches zero rows.
  const respApplied = Array.isArray(respRows) && respRows.length > 0;

  // The date is free again — put the slot back on the DJ's calendar so they can
  // fill it. Only on accept: a declined request changed nothing.
  if (accepted && respApplied) {
    await releaseCalendarSlot(admin, booking);
  }

  // Log the DJ-side response. On the session path djActing carries the real
  // actor; on the emailed-link (token) path there's no session, so attribute it
  // to the owner account with a "via link" action so the log is honest about how
  // it happened. Host responses are never logged (not a team action).
  if (respApplied && actor === 'dj') {
    const ctx = djActing ?? (booking.dj_id
      ? { authUserId: booking.dj_id, djId: booking.dj_id, role: 'owner' as const, isMember: false }
      : null);
    if (ctx) {
      const viaLink = !djActing;
      await logActivity(ctx, {
        action: accepted
          ? (viaLink ? 'cancellation.accepted_via_link' : 'cancellation.accepted')
          : (viaLink ? 'cancellation.declined_via_link' : 'cancellation.declined'),
        summary: (accepted ? 'Accepted a cancellation (booking cancelled)' : 'Declined a cancellation') + (viaLink ? ' — via email link' : ''),
        bookingId: booking.id,
      });
    }
  }

  try {
    await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || ''}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.CRON_SECRET || '' },
      body: JSON.stringify({
        type: accepted ? 'cancel_accepted' : 'cancel_declined',
        bookingId: booking.id,
        respondedBy: actor,
        responseNote,
      }),
    });
  } catch (e) {
    console.warn('cancel response email failed:', e);
  }

  return NextResponse.json({ ok: true, cancel_status: accepted ? 'accepted' : 'declined' });
}
