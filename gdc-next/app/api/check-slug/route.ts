// /api/check-slug — server-side slug availability check.
//
// Why server-side instead of a direct Supabase query from the client?
// On the editing pages (Update Profile / Account Settings) the user is
// logged in, and RLS policies on the public.users table may restrict
// SELECTs to only the current user's own row. That means the client-side
// query "WHERE slug=X AND id != myId" returns empty even when another
// user owns that slug — falsely reporting it as available.
//
// This route uses the admin client (service-role) which bypasses RLS,
// so it can see ALL rows and correctly detect collisions.
//
// Request: POST { slug: string, excludeUserId?: string }
// Response: { available: boolean }

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  let body: { slug?: string; excludeUserId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const slug = (body.slug || '').trim().toLowerCase();
  const excludeUserId = body.excludeUserId?.trim() || null;

  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    let query = admin
      .from('users')
      .select('id')
      .eq('slug', slug);
    if (excludeUserId) {
      query = query.neq('id', excludeUserId);
    }
    const { data, error } = await query.limit(1);
    if (error) {
      console.error('[check-slug] query error:', error);
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
    }
    return NextResponse.json({ available: !data || data.length === 0 });
  } catch (e) {
    console.error('[check-slug] exception:', e);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
