// /api/dj/profile-color — persists the DJ's hero name / location colours.
//
//   POST { field, color } → update one colour column on the acting DJ's row.
//     field: 'name' | 'location' | 'name_bg' | 'location_bg'
//     color: '#rrggbb'  (a 6-digit hex) — or null to CLEAR the field (used to
//            turn a colour band off). Text colours (name/location) don't accept
//            null; the band fields do.
//   Legacy: { color } with no field is treated as field 'name' so older clients
//     keep working.
//
// DJ-authed by session (matches /api/dj/logo). These columns postdate the
// generated DB types, so the update is done through an admin client cast (house
// pattern). Never 502 — Cloudflare eats the body; always 500.

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

    const body = (await req.json().catch(() => ({}))) as { field?: string; color?: string | null };

    // field → column. Default 'name' keeps older clients (which sent only
    // { color }) working.
    const COLUMN: Record<string, string> = {
      name: 'profile_name_color',
      location: 'profile_location_color',
      name_bg: 'profile_name_bg',
      location_bg: 'profile_location_bg',
    };
    const field = typeof body.field === 'string' && body.field ? body.field : 'name';
    const column = COLUMN[field];
    if (!column) return NextResponse.json({ error: 'Invalid field.' }, { status: 400 });

    // Band fields (name_bg / location_bg) may be cleared with null. Text colours
    // (name / location) must be a valid hex.
    const isBandField = field === 'name_bg' || field === 'location_bg';
    let value: string | null;
    if (body.color === null && isBandField) {
      value = null; // clear the band
    } else {
      const color = typeof body.color === 'string' ? body.color.trim() : '';
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        return NextResponse.json({ error: 'Invalid color.' }, { status: 400 });
      }
      value = color;
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('users')
      .update({ [column]: value } as unknown as never)
      .eq('id', acting.djId);
    if (error) return NextResponse.json({ error: 'Could not save the color.' }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
