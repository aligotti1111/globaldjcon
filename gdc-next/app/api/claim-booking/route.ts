// /api/claim-booking — server-side claim of a manual booking. Required
// because the bookings table RLS doesn't permit a user to UPDATE a row
// they don't yet own. Two flows are supported:
//
//   1. HOST claim: the booking was created by a DJ with host_email set.
//      The newly-signed-up host (whose email matches host_email) claims
//      ownership — sets requester_id + requester_name to the host.
//
//   2. DJ claim: the booking was created by a host/venue on /upcoming-events
//      with a dj_email but no matching DJ account at creation time. The
//      DJ later signs up (or already had an account but didn't match at
//      insert time), and claims the booking — sets dj_id to the DJ.
//
// Direction is auto-detected by looking at which email column matches the
// authenticated user's email.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface BookingLookup {
  id: string;
  host_email: string | null;
  dj_email: string | null;
  is_manual: boolean;
  requester_id: string | null;
  dj_id: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
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

  const { data: booking, error: lookupErr } = await admin
    .from('bookings')
    .select('id, host_email, dj_email, is_manual, requester_id, dj_id, event_date, start_time, end_time, venue_name, venue_address')
    .eq('id', bookingId)
    .maybeSingle<BookingLookup>();

  if (lookupErr) {
    return NextResponse.json({ error: 'Lookup failed: ' + lookupErr.message }, { status: 500 });
  }
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }
  if (!booking.is_manual) {
    return NextResponse.json({ error: 'Not a manual booking' }, { status: 400 });
  }

  const userEmail = user.email.toLowerCase();
  const hostEmailMatch = booking.host_email?.toLowerCase() === userEmail;
  const djEmailMatch = booking.dj_email?.toLowerCase() === userEmail;

  if (!hostEmailMatch && !djEmailMatch) {
    return NextResponse.json({ error: 'Email does not match booking invitation' }, { status: 403 });
  }

  // Fetch user profile once — needed for requester_name (host flow) and
  // role/dj_type sanity checking (DJ flow).
  const { data: profile } = await admin
    .from('users')
    .select('name, role, dj_type')
    .eq('id', user.id)
    .maybeSingle<{ name: string | null; role: string | null; dj_type: string | null }>();

  // ── DJ claim path ──────────────────────────────────────────────────
  // Email matches dj_email — attach this user as the DJ. Only if the
  // user's role is 'dj'. Clear dj_email so it doesn't sit around.
  if (djEmailMatch) {
    if (profile?.role !== 'dj') {
      return NextResponse.json(
        { error: 'Your account is not a DJ account — only DJs can claim DJ event invites.' },
        { status: 403 },
      );
    }
    const { error: updateErr } = await admin
      .from('bookings')
      .update({
        dj_id: user.id,
        dj_email: null,
        // Pending bookings need DJ approval via /booking-requests — keep
        // the status as-is so the existing pending flow surfaces it.
      } as unknown as never)
      .eq('id', bookingId);
    if (updateErr) {
      return NextResponse.json({ error: 'Update failed: ' + updateErr.message }, { status: 500 });
    }
    // Look up host name for the success banner.
    let fromName: string | null = null;
    if (booking.requester_id) {
      const { data: hostRow } = await admin
        .from('users')
        .select('name')
        .eq('id', booking.requester_id)
        .maybeSingle<{ name: string | null }>();
      fromName = hostRow?.name || null;
    }
    return NextResponse.json({
      ok: true,
      direction: 'dj',
      booking: {
        id: bookingId,
        event_date: booking.event_date,
        start_time: booking.start_time,
        end_time: booking.end_time,
        venue_name: booking.venue_name,
        venue_address: booking.venue_address,
        from_name: fromName,
      },
    });
  }

  // ── Host claim path (existing) ─────────────────────────────────────
  const { error: updateErr } = await admin
    .from('bookings')
    .update({
      requester_id: user.id,
      requester_name: profile?.name || null,
    } as unknown as never)
    .eq('id', bookingId);

  if (updateErr) {
    return NextResponse.json({ error: 'Update failed: ' + updateErr.message }, { status: 500 });
  }
  // Look up DJ name for the success banner.
  let fromName: string | null = null;
  if (booking.dj_id) {
    const { data: djRow } = await admin
      .from('users')
      .select('name')
      .eq('id', booking.dj_id)
      .maybeSingle<{ name: string | null }>();
    fromName = djRow?.name || null;
  }
  return NextResponse.json({
    ok: true,
    direction: 'host',
    booking: {
      id: bookingId,
      event_date: booking.event_date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      venue_name: booking.venue_name,
      venue_address: booking.venue_address,
      from_name: fromName,
    },
  });
}
