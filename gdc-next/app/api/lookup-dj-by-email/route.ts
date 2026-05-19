// /api/lookup-dj-by-email?email=...[&date=YYYY-MM-DD]
// Returns the DJ user record matching the given email, or null if no DJ
// exists with that email. Used by the /upcoming-events Add Event flow when
// a host/venue attaches a DJ to a manual event: if a match exists we set
// booking.dj_id + status=pending (DJ approves via booking-requests); if no
// match we send an invite email and save the booking with dj_id=null.
//
// When ?date is provided AND a DJ is found, the response also includes
// capacity info for that date: the DJ's max bookings/day setting, and the
// count of existing approved/manual bookings on the given date. This lets
// the host UI warn before submitting "you'd exceed the DJ's daily cap".
//
// Anon clients can't read other users' rows via RLS, so this admin-backed
// endpoint does the lookup server-side. Returns minimal info — id, role,
// dj_type, name — never sensitive data.

import { NextResponse } from 'next/server';
import { createAdminClient, resolveUserIdByEmail } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const email = (url.searchParams.get('email') || '').trim().toLowerCase();
    const dateStr = url.searchParams.get('date') || null;
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'valid email required' }, { status: 400 });
    }
    const userId = await resolveUserIdByEmail(email);
    if (!userId) {
      return NextResponse.json({ found: false });
    }
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from('users')
      .select('id, role, dj_type, name, booking_settings')
      .eq('id', userId)
      .maybeSingle<{
        id: string;
        role: string | null;
        dj_type: string | null;
        name: string | null;
        booking_settings: { mob_bookings_per_day?: number } | null;
      }>();
    if (!profile) {
      return NextResponse.json({ found: false });
    }

    // Capacity check — only meaningful when we have a date AND the user
    // is a DJ. Club/bar DJs have a fixed cap of 1; mobile DJs use their
    // mob_bookings_per_day setting (default 1).
    let capacity: {
      max: number;
      existing: number;
      atCap: boolean;
    } | null = null;
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && profile.role === 'dj') {
      const max = profile.dj_type === 'club'
        ? 1
        : Math.max(1, profile.booking_settings?.mob_bookings_per_day || 1);
      const { count } = await admin
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('dj_id', userId)
        .eq('event_date', dateStr)
        .or('status.eq.approved,is_manual.eq.true');
      const existing = count || 0;
      capacity = { max, existing, atCap: existing >= max };
    }

    return NextResponse.json({
      found: true,
      id: profile.id,
      role: profile.role,
      dj_type: profile.dj_type,
      name: profile.name,
      isDj: profile.role === 'dj',
      capacity,
    });
  } catch (e) {
    console.error('[lookup-dj-by-email] error', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
