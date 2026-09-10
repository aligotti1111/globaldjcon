// /api/dj/story — the Monthly Story graphic's per-account bits.
//
// The story tool read the DJ's slug + saved logo/colors and wrote them back to
// users.booking_settings, plus uploaded story images to the DJ's storage folder
// — all as browser writes keyed to the auth user. For a TEAM MEMBER those all
// target the OWNER's row/folder, which RLS refuses, so a teammate saw no slug,
// no saved logo/colors, couldn't save any, and couldn't upload an image. This
// runs the reads/writes with the admin client, scoped to the acting OWNER.
//
//   GET                         → { slug, storyLogoUrl, storyColors }
//   POST (application/json)      → persist { storyLogoUrl?, storyColors? } (null clears)
//   POST (multipart/form-data)   → upload { file, prefix } → { url }
//
// Assistant+ (every seat may make marketing graphics).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext, canEditProfile } from '@/lib/acting';

export const runtime = 'nodejs';
export const maxDuration = 26;

const BUCKET = 'avatars';

async function authorize() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  const acting = await getActingContext(user.id);
  if (!canEditProfile(acting.role)) {
    return { error: NextResponse.json({ error: 'Your role cannot use the story tool.' }, { status: 403 }) };
  }
  return { djId: acting.djId, admin: createAdminClient() as unknown as SupabaseClient };
}

function parseSettings(raw: unknown): Record<string, unknown> {
  try { return (typeof raw === 'string' ? JSON.parse(raw) : (raw || {})) as Record<string, unknown>; }
  catch { return {}; }
}

export async function GET() {
  const auth = await authorize();
  if ('error' in auth) return auth.error;
  const { djId, admin } = auth;

  const { data } = await admin.from('users').select('slug, booking_settings').eq('id', djId).maybeSingle();
  const row = data as { slug?: string | null; booking_settings?: string | null } | null;
  const bs = parseSettings(row?.booking_settings);
  return NextResponse.json({
    ok: true,
    slug: row?.slug ?? null,
    storyLogoUrl: typeof bs.story_logo_url === 'string' ? bs.story_logo_url : null,
    storyColors: (bs.story_colors && typeof bs.story_colors === 'object') ? bs.story_colors : null,
  });
}

export async function POST(req: Request) {
  const auth = await authorize();
  if ('error' in auth) return auth.error;
  const { djId, admin } = auth;

  const ctype = req.headers.get('content-type') || '';

  // ── Image upload ──
  if (ctype.includes('multipart/form-data')) {
    let form: FormData;
    try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }); }
    const file = form.get('file');
    const prefix = String(form.get('prefix') || 'story').replace(/[^a-z0-9_]/gi, '') || 'story';
    if (!(file instanceof File)) return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${djId}/${prefix}_${Date.now()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { upsert: true, contentType: file.type || 'image/png' });
    if (upErr) return NextResponse.json({ error: upErr.message || 'Upload failed' }, { status: 400 });
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ ok: true, url: `${pub.publicUrl}?t=${Date.now()}` });
  }

  // ── Persist prefs (merge into booking_settings) ──
  let body: { storyLogoUrl?: string | null; storyColors?: Record<string, string> | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const { data } = await admin.from('users').select('booking_settings').eq('id', djId).maybeSingle();
  const bs = parseSettings((data as { booking_settings?: string | null } | null)?.booking_settings);

  if ('storyLogoUrl' in body) {
    if (body.storyLogoUrl) bs.story_logo_url = body.storyLogoUrl; else delete bs.story_logo_url;
  }
  if ('storyColors' in body) {
    if (body.storyColors) bs.story_colors = body.storyColors; else delete bs.story_colors;
  }

  const { error } = await admin
    .from('users')
    .update({ booking_settings: JSON.stringify(bs) } as unknown as never)
    .eq('id', djId);
  if (error) return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
