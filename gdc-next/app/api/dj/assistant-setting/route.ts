// /api/dj/assistant-setting
//
//   GET  — return whether the DJ assistant is switched on for this account.
//   POST — turn it on or off. Body: { enabled: boolean }. OWNER ONLY — it's an
//          account-level feature, so a teammate can't flip it. Default is ON, so
//          a null column reads as enabled.
//
// This is just the DJ's preference switch. The actual eligibility (paid tier)
// still lives in /api/dj/assistant; this toggle only lets a paid DJ hide the
// helper if they don't want it.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext } from '@/lib/acting';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const acting = await getActingContext(user.id);
  const db = createAdminClient() as unknown as SupabaseClient;
  const { data } = await db.from('users').select('assistant_enabled').eq('id', acting.djId).maybeSingle();
  const row = data as { assistant_enabled?: boolean | null } | null;
  return NextResponse.json({ ok: true, enabled: row?.assistant_enabled !== false });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const acting = await getActingContext(user.id);
  if (acting.role !== 'owner') {
    return NextResponse.json({ error: 'Only the account owner can change this.' }, { status: 403 });
  }

  let body: { enabled?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
  }

  const db = createAdminClient() as unknown as SupabaseClient;
  const { error } = await db.from('users').update({ assistant_enabled: body.enabled }).eq('id', acting.djId);
  if (error) return NextResponse.json({ error: 'Could not save your setting.' }, { status: 500 });
  return NextResponse.json({ ok: true, enabled: body.enabled });
}
