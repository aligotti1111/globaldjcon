// /api/profile/update — lets a team member (assistant → admin) edit the
// owner's PUBLIC PROFILE (all tabs except Booking). The owner edits their own
// row directly from the browser; team members can't (RLS), so their inline
// edits POST here and we write the owner's row with the admin client, gated by
// the acting role. Only a fixed whitelist of NON-booking columns is writable —
// booking_settings and anything booking-related can never be touched here.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActingContext, canEditProfile } from '@/lib/acting';
import { logActivity } from '@/lib/activityLog';

export const runtime = 'nodejs';

// Non-booking profile columns a profile-editor may write. Booking columns are
// deliberately absent, so this permission can never change booking config.
const WRITABLE = new Set<string>([
  'bio',
  'avatar_url', 'avatar_position', 'avatar_hidden',
  'banner_url', 'banner_position', 'banner_position_mobile',
  'profile_name_color',
  'website', 'instagram', 'facebook', 'tiktok', 'twitch', 'soundcloud', 'phone',
  'tab_visibility',
  'tab_order',
  'testimonials',
  'faqs',
  'about_stats',
  'mix_urls', 'mix_url_1', 'mix_url_2', 'mix_url_3',
  'gallery_photos', 'gallery_img_1', 'gallery_img_2', 'gallery_img_3', 'gallery_img_4',
  'video_urls',
  'video_url_1', 'video_url_2', 'video_url_3',
  'video_title_1', 'video_title_2', 'video_title_3',
  'video_desc_1', 'video_desc_2', 'video_desc_3',
]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const acting = await getActingContext(user.id);
  // Owner always allowed; members only if their seat grants profile editing.
  if (!canEditProfile(acting.role)) {
    return NextResponse.json({ error: 'Your role cannot edit this profile.' }, { status: 403 });
  }

  let body: { patch?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const patch = body.patch;
  if (!patch || typeof patch !== 'object') {
    return NextResponse.json({ error: 'Missing patch' }, { status: 400 });
  }

  // Keep only whitelisted keys — silently drop anything else (e.g. booking).
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (WRITABLE.has(k)) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) {
    return NextResponse.json({ error: 'No editable fields.' }, { status: 400 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { error } = await admin
    .from('users')
    .update(clean as unknown as never)
    .eq('id', acting.djId);
  if (error) return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
  // Name the changed fields so the log is specific (e.g. "Edited profile — bio, socials").
  const changed = Object.keys(clean).map((k) => k.replace(/_/g, ' ')).slice(0, 4).join(', ');
  await logActivity(acting, { action: 'profile.updated', summary: `Edited the profile${changed ? ` — ${changed}` : ''}` });
  return NextResponse.json({ ok: true });
}
