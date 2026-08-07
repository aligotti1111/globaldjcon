// /api/dj/timezone
//
//   GET  — return this DJ's saved timezone (defaults to US Eastern).
//   POST — save a new timezone. Body: { timezone: string }, validated against
//          the offered allowlist so no arbitrary string reaches the column.
//
// The clock this sets drives the booking-request auto-decline deadline and the
// "Expires in N days" countdown. Scoped to the ACTING dj (the owner's id when a
// teammate is signed in), so a team shares one timezone.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext } from '@/lib/acting';
import { isValidTimezone, effectiveTimezone, timezoneFromZip } from '@/lib/bookingExpiry';

export const runtime = 'nodejs';

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
  // timezone postdates the generated types — untyped cast to read/write it.
  const db = admin as unknown as SupabaseClient;
  const { data } = await db.from('users').select('timezone, zip').eq('id', djId).maybeSingle();
  const row = data as { timezone?: string | null; zip?: string | null } | null;
  const stored = row?.timezone ?? null;   // null = automatic (from ZIP)
  const zip = row?.zip ?? null;
  return NextResponse.json({
    ok: true,
    // What's saved (null when on automatic) and what's actually in effect.
    timezone: stored,
    effective: effectiveTimezone(stored, zip),
    fromZip: timezoneFromZip(zip),   // the zone the ZIP maps to, if any
    isAuto: !stored,
  });
}

export async function POST(req: Request) {
  const djId = await resolveDjId();
  if (!djId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { timezone?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const raw = typeof body.timezone === 'string' ? body.timezone : '';
  // 'auto' (or empty) clears the override → back to ZIP-derived. Anything else
  // must be one of the offered zones.
  const isAuto = raw === '' || raw === 'auto';
  if (!isAuto && !isValidTimezone(raw)) {
    return NextResponse.json({ error: 'Unsupported timezone.' }, { status: 400 });
  }
  const value: string | null = isAuto ? null : raw;

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;
  const { error } = await db.from('users').update({ timezone: value }).eq('id', djId);
  if (error) return NextResponse.json({ error: 'Could not save your timezone.' }, { status: 500 });

  return NextResponse.json({ ok: true, timezone: value });
}
