// /api/booking-approve — server-side approval of a DJ's offer by the
// booker. Required because marking the date booked means writing the
// DJ's users.booking_settings row, which the booker can't do under RLS.
//
// Flow:
//   1. Client sends { bookingId } — auth comes from the session cookie.
//   2. We verify the authenticated user is the booking's requester and
//      the booking is in a state the booker can approve ('counter' —
//      i.e. the DJ has sent an offer and is waiting on the booker).
//   3. Set status = 'approved'.
//   4. Update the DJ's calendar:
//        - Club/bar DJ  → mark the event date booked.
//        - Mobile DJ    → decrement that day's bookings_available; when
//          it reaches 0 the day is also flagged booked.
//   5. Return { ok: true } or an appropriate error.
//
// Email notifications are still fired by the client (booking_approved to
// both parties) — this route only handles the DB writes the booker
// cannot perform directly.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { bookingId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const bookingId = body.bookingId;
  if (!bookingId || typeof bookingId !== 'string') {
    return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Look up the booking. set_type distinguishes club vs mobile bookings
  // (club bookings always carry a set_type).
  const { data: booking, error: lookupErr } = await admin
    .from('bookings')
    .select('id, dj_id, requester_id, status, event_date, set_type, booking_type')
    .eq('id', bookingId)
    .maybeSingle<{
      id: string;
      dj_id: string | null;
      requester_id: string | null;
      status: string | null;
      event_date: string | null;
      set_type: string | null;
      booking_type: string | null;
    }>();

  if (lookupErr) {
    return NextResponse.json({ error: 'Lookup failed: ' + lookupErr.message }, { status: 500 });
  }
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  // Ownership — only the booker who made the request may approve the offer.
  if (booking.requester_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized for this booking' }, { status: 403 });
  }
  // Only approvable from 'counter' (DJ sent an offer, awaiting booker).
  if (booking.status !== 'counter') {
    return NextResponse.json(
      { error: `Booking is not awaiting approval (status: ${booking.status})` },
      { status: 409 },
    );
  }

  // 1. Mark the booking approved.
  const { error: updErr } = await admin
    .from('bookings')
    .update({ status: 'approved', updated_at: new Date().toISOString() } as unknown as never)
    .eq('id', bookingId);
  if (updErr) {
    return NextResponse.json({ error: 'Update failed: ' + updErr.message }, { status: 500 });
  }

  // 2. Update the DJ's calendar. Mirrors the DJ-side approve logic in
  //    BookingRequestsClient.djUpdateStatus — club marks the date booked;
  //    mobile decrements per-day capacity and flags booked at zero.
  if (booking.dj_id && booking.event_date) {
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
          eventName?: string;
          location?: string;
          startTime?: string;
          endTime?: string;
        }>;
        booking_days?: Record<string, {
          booked?: boolean;
          unavailable?: boolean;
          eventName?: string;
          startTime?: string;
          endTime?: string;
          location?: string;
        }>;
      } = {};
      if (djRow?.booking_settings) {
        try {
          bs = JSON.parse(djRow.booking_settings);
        } catch {
          bs = {};
        }
      }

      const isClubBooking = !!booking.set_type || booking.booking_type === 'club';
      if (isClubBooking) {
        // Club DJ — flip the date booked. Club DJs take one booking a day.
        if (!bs.booking_days) bs.booking_days = {};
        const existing = bs.booking_days[booking.event_date] || {};
        bs.booking_days[booking.event_date] = { ...existing, booked: true };
      } else {
        // Mobile DJ — decrement that day's remaining capacity. The day
        // is only fully booked once capacity hits zero.
        const defaultPerDay = bs.mob_bookings_per_day || 1;
        if (!bs.mob_booking_days) bs.mob_booking_days = {};
        const dayData = bs.mob_booking_days[booking.event_date] || {};
        const current = dayData.bookings_available != null
          ? dayData.bookings_available
          : defaultPerDay;
        const newCount = Math.max(0, current - 1);
        bs.mob_booking_days[booking.event_date] = {
          ...dayData,
          bookings_available: newCount,
          // When the last slot is taken, also mark the day booked so the
          // public calendar shows it as unavailable.
          ...(newCount <= 0 ? { booked: true } : {}),
        };
      }

      await admin
        .from('users')
        .update({ booking_settings: JSON.stringify(bs) } as unknown as never)
        .eq('id', booking.dj_id);
    } catch (calErr) {
      // Calendar update is best-effort — the approval itself already
      // succeeded. Log and continue so the booker still sees success.
      console.error('booking-approve calendar update failed:', calErr);
    }
  }

  return NextResponse.json({ ok: true });
}
