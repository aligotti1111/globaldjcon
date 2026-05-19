// /api/lookup-dj-by-email?email=... — returns the DJ user record matching
// the given email, or null if no DJ exists with that email. Used by the
// /upcoming-events Add Event flow when a host/venue attaches a DJ to a
// manual event: if a match exists we set booking.dj_id + status=pending
// (DJ approves via booking-requests); if no match we send an invite email
// and save the booking with dj_id=null.
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
      .select('id, role, dj_type, name')
      .eq('id', userId)
      .maybeSingle<{ id: string; role: string | null; dj_type: string | null; name: string | null }>();
    if (!profile) {
      return NextResponse.json({ found: false });
    }
    return NextResponse.json({
      found: true,
      id: profile.id,
      role: profile.role,
      dj_type: profile.dj_type,
      name: profile.name,
      isDj: profile.role === 'dj',
    });
  } catch (e) {
    console.error('[lookup-dj-by-email] error', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
