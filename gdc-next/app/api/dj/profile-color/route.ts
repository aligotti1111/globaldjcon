// /api/dj/profile-color — persists the DJ's hero name + location color.
//
//   POST { color: '#rrggbb' } → update users.profile_name_color for the
//   authed user. Rejects anything that isn't a 6-digit hex color with 400.
//
// DJ-authed by session (matches /api/dj/logo). profile_name_color postdates
// the generated DB types, so the update is done through an admin client cast
// (house pattern). Never 502 — Cloudflare eats the body; always 500.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext, canEditProfile } from '@/lib/acting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    // Resolve who we're acting as — an owner writes their own row, a team
    // member with a profile-editing seat writes the owner's row.
    const acting = await getActingContext(user.id);
    if (!canEditProfile(acting.role)) {
      return NextResponse.json({ error: 'Your role cannot edit this profile.' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { color?: string };
    const color = typeof body.color === 'string' ? body.color.trim() : '';
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      return NextResponse.json({ error: 'Invalid color.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('users')
      .update({ profile_name_color: color } as unknown as never)
      .eq('id', acting.djId);
    if (error) return NextResponse.json({ error: 'Could not save the color.' }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
