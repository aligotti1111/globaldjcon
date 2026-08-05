// /api/dj/calendar-token
//
//   GET  — return this DJ's calendar subscription link, generating the secret
//          token lazily on first ask.
//   POST — reset the link (new token; the old subscription URL goes dead).
//
// Session required. The token is scoped to the ACTING dj (the owner's id when a
// teammate is signed in), so a whole team subscribes to one shared calendar.

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext } from '@/lib/acting';

export const runtime = 'nodejs';

const SITE_HOST = 'globaldjconnect.com';

function links(token: string) {
  const path = `/api/calendar/${token}.ics`;
  return {
    token,
    // webcal:// makes iOS / macOS offer "Subscribe" directly; https is the
    // copy-paste fallback (Google Calendar's "From URL" wants https).
    webcalUrl: `webcal://${SITE_HOST}${path}`,
    httpsUrl: `https://${SITE_HOST}${path}`,
  };
}

async function resolveDjId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const acting = await getActingContext(user.id);
  return acting.djId || user.id;
}

export async function GET() {
  const djId = await resolveDjId();
  if (!djId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const admin = createAdminClient();
  // calendar_token postdates the generated types — one untyped cast to read /
  // write it, same pattern as the payments tables.
  const db = admin as unknown as SupabaseClient;

  const { data } = await db.from('users').select('calendar_token').eq('id', djId).maybeSingle();
  let token = (data as { calendar_token?: string | null } | null)?.calendar_token || '';

  if (!token) {
    token = randomUUID().replace(/-/g, '');
    const { error } = await db.from('users').update({ calendar_token: token }).eq('id', djId);
    if (error) return NextResponse.json({ error: 'Could not create your calendar link.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...links(token) });
}

export async function POST() {
  const djId = await resolveDjId();
  if (!djId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  const token = randomUUID().replace(/-/g, '');
  const { error } = await db.from('users').update({ calendar_token: token }).eq('id', djId);
  if (error) return NextResponse.json({ error: 'Could not reset your calendar link.' }, { status: 500 });

  return NextResponse.json({ ok: true, ...links(token) });
}
