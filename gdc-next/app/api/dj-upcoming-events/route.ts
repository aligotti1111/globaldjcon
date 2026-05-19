// /api/dj-upcoming-events?djId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Public endpoint that returns a DJ's upcoming booking rows for use in the
// public profile's "Upcoming Events" list. Bypasses RLS via the admin
// client because anon clients can't read other users' bookings directly.
//
// Returns only the fields safe for public display — never financial or
// host-contact info. Includes both approved (real) and manual bookings
// within the date window.

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
    // Select only fields safe for public display. No financial info, no
    // host contact info, no internal IDs beyond what the UI needs.
    const { data, error } = await admin
      .from('bookings')
      .select('id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, set_type, flyer_url, is_manual, link_url, link_label')
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
    return NextResponse.json({ events: data || [] });
  } catch (e) {
    console.error('[dj-upcoming-events] unexpected error', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
