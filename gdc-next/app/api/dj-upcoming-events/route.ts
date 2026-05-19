// /api/dj-upcoming-events?djId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Public endpoint that returns a DJ's upcoming booking rows for use in the
// public profile's "Upcoming Events" list. Bypasses RLS via the admin
// client because anon clients can't read other users' bookings directly.
//
// Returns only the fields safe for public display — never financial or
// host-contact info. Includes both approved (real) and manual bookings
// within the date window.
//
// Bookings whose booking_type doesn't match the DJ's dj_type are excluded
// from this public list — e.g. a mobile DJ accepting a club event still
// gets the booking in their schedule, but it shouldn't appear on their
// (mobile-only) profile event list.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const djId = url.searchParams.get('djId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!djId) {
      return NextResponse.json({ error: 'djId required' }, { status: 400 });
    }
    if (!from || !to) {
      return NextResponse.json({ error: 'from and to dates required' }, { status: 400 });
    }
    const admin = createAdminClient();

    // Look up the DJ's dj_type so we can filter out mismatched bookings.
    const { data: profile } = await admin
      .from('users')
      .select('dj_type')
      .eq('id', djId)
      .maybeSingle<{ dj_type: string | null }>();
    const djType = profile?.dj_type || null;

    // Select only fields safe for public display.
    const { data, error } = await admin
      .from('bookings')
      .select('id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, set_type, flyer_url, is_manual, link_url, link_label, booking_type')
      .eq('dj_id', djId)
      .gte('event_date', from)
      .lt('event_date', to)
      .or('status.eq.approved,is_manual.eq.true')
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true });
    if (error) {
      console.error('[dj-upcoming-events] query error', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Filter out type-mismatched bookings — e.g. a club event accepted by
    // a mobile DJ shouldn't render on the mobile DJ's public profile.
    // Bookings without a booking_type are kept (legacy / unknown).
    const filtered = (data || []).filter((row) => {
      if (!djType) return true;
      const bt = (row as { booking_type: string | null }).booking_type;
      if (!bt) return true;
      return bt === djType;
    });

    return NextResponse.json({ events: filtered });
  } catch (e) {
    console.error('[dj-upcoming-events] unexpected error', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
