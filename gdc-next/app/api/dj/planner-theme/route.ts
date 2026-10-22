route.ts// /api/dj/planner-theme — the DJ's Planner & Playlist colour theme.
//
//   GET  → { theme: 'dark' | 'light', accent: string | null }  (current values)
//   POST { theme?, accent? } → update either/both on the acting DJ's row.
//     theme:  'dark' | 'light'          — the page background for ALL this DJ's planners
//     accent: '#rrggbb' | null          — the accent colour (null clears → brand default)
//
// Per-DJ, applies to every planner template the DJ sends. Mirrors
// /api/dj/profile-color: session-authed, acting-context resolved so a team
// member with a settings seat writes the OWNER's row. These columns postdate the
// generated DB types, so reads/writes go through an admin client cast (house
// pattern). Never 502 — Cloudflare eats the body; always 500.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext, canSettings } from '@/lib/acting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    const acting = await getActingContext(user.id);
    const admin = createAdminClient();
    const db = admin as unknown as SupabaseClient;
    const { data } = await db
      .from('users')
      .select('planner_theme, planner_accent')
      .eq('id', acting.djId)
      .maybeSingle();
    const row = data as unknown as { planner_theme?: string | null; planner_accent?: string | null } | null;
    return NextResponse.json({
      theme: row?.planner_theme === 'light' ? 'light' : 'dark',
      accent: row?.planner_accent || null,
    });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    // The theme is a planner/booking setting — gate it like the template editor.
    const acting = await getActingContext(user.id);
    if (!canSettings(acting.role)) {
      return NextResponse.json({ error: 'Your role cannot edit planner settings.' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { theme?: string; accent?: string | null };

    // Build only the fields that were actually sent, so a caller can change the
    // background without touching the accent and vice versa.
    const patch: Record<string, string | null> = {};

    if (body.theme !== undefined) {
      if (body.theme !== 'dark' && body.theme !== 'light') {
        return NextResponse.json({ error: 'Invalid theme.' }, { status: 400 });
      }
      patch.planner_theme = body.theme;
    }

    if (body.accent !== undefined) {
      if (body.accent === null) {
        patch.planner_accent = null; // clear → brand default
      } else {
        const accent = typeof body.accent === 'string' ? body.accent.trim() : '';
        if (!/^#[0-9a-fA-F]{6}$/.test(accent)) {
          return NextResponse.json({ error: 'Invalid color.' }, { status: 400 });
        }
        patch.planner_accent = accent;
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('users')
      .update(patch as unknown as never)
      .eq('id', acting.djId);
    if (error) return NextResponse.json({ error: 'Could not save the theme.' }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
