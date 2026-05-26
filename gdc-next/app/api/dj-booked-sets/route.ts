// /api/dj-booked-sets?djId=...&date=YYYY-MM-DD
//
// Public endpoint that returns the time ranges of a DJ's already-booked
// sets on a given date. Used by the club booking form to show the
// customer what's already taken (and to flag time overlaps).
//
// Bypasses RLS via the admin client — anon/customer clients can't read
// another user's bookings directly. Returns ONLY start/end times — no
// venue, financial, or host-contact info.
//
// Only APPROVED bookings are returned. Manual bookings save as
// status='approved', so they're included. Pending/countered requests
// are excluded — they don't hold a confirmed slot.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const djId = url.searchParams.get('djId');
    const date = url.searchParams.get('date');
    if (!djId) {
      return NextResponse.json({ error: 'djId required' }, { status: 400 });
    }
    if (!date) {
      return NextResponse.json({ error: 'date required' }, { status: 400 });
    }
    const admin = createAdminClient();

    const { data, error } = await admin
      .from('bookings')
      .select('start_time, end_time')
      .eq('dj_id', djId)
      .eq('event_date', date)
      .eq('status', 'approved')
      .order('start_time', { ascending: true });
    if (error) {
      console.error('[dj-booked-sets] query error', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const sets = (data || []).map((row) => ({
      start: (row as { start_time: string | null }).start_time,
      end: (row as { end_time: string | null }).end_time,
    }));

    return NextResponse.json({ sets });
  } catch (e) {
    console.error('[dj-booked-sets] unexpected error', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
