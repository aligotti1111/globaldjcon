// /api/rider/library — the DJ's NAMED, REUSABLE rider library.
//   GET    → list the DJ's saved named riders.
//   POST   → create or update one { id?, name, mode, items, pdfUrl }; returns it.
//   DELETE → remove one { id }.
//
// Stored on users.booking_settings JSON under `riders` (NO new table). Scoped
// to the acting djId; the admin client is cast (house pattern) because
// booking_settings lives on the users row. Any teammate who can send riders can
// save one, so we gate on canSettings (owner + admin + manager).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getActingContext, canSettings } from '@/lib/acting';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  normalizeNamedRiders, normalizeRiderItems, normalizeRiderMode, newRiderId,
  upsertNamedRider, type NamedRider,
} from '@/lib/rider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Parse booking_settings (jsonb OR stringified) into a plain object. */
async function loadSettings(admin: SupabaseClient, djId: string): Promise<Record<string, unknown>> {
  const { data } = await admin.from('users').select('booking_settings').eq('id', djId).maybeSingle();
  const bs = (data as unknown as { booking_settings?: unknown } | null)?.booking_settings;
  if (typeof bs === 'string') { try { return JSON.parse(bs) as Record<string, unknown>; } catch { return {}; } }
  if (bs && typeof bs === 'object') return bs as Record<string, unknown>;
  return {};
}

async function saveSettings(admin: SupabaseClient, djId: string, settings: Record<string, unknown>): Promise<boolean> {
  // Match the rest of the app: booking_settings is STRINGIFIED JSON. Writing a
  // raw object here corrupted the blob and wiped equipment/rates. Stringify.
  const { error } = await admin.from('users').update({ booking_settings: JSON.stringify(settings) } as unknown as never).eq('id', djId);
  return !error;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const acting = await getActingContext(user.id);

  const admin = createAdminClient() as unknown as SupabaseClient;
  const settings = await loadSettings(admin, acting.djId);
  return NextResponse.json({ ok: true, riders: normalizeNamedRiders(settings.riders) });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const acting = await getActingContext(user.id);
  if (!canSettings(acting.role)) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });

  let body: { id?: unknown; name?: unknown; mode?: unknown; items?: unknown; pdfUrl?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Give the rider a name.' }, { status: 400 });
  const mode = normalizeRiderMode(body.mode);
  const items = normalizeRiderItems(body.items);
  const pdfUrl = typeof body.pdfUrl === 'string' && body.pdfUrl ? body.pdfUrl : null;
  const id = typeof body.id === 'string' && body.id ? body.id : newRiderId();

  if (mode === 'upload' ? !pdfUrl : items.length === 0) {
    return NextResponse.json({ error: 'Add a PDF or at least one field before saving.' }, { status: 400 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const settings = await loadSettings(admin, acting.djId);
  const rider: NamedRider = { id, name, mode, items, pdfUrl, updatedAt: new Date().toISOString() };
  settings.riders = upsertNamedRider(normalizeNamedRiders(settings.riders), rider);
  if (!(await saveSettings(admin, acting.djId, settings))) {
    return NextResponse.json({ error: 'Could not save the rider.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, rider });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const acting = await getActingContext(user.id);
  if (!canSettings(acting.role)) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });

  let body: { id?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const settings = await loadSettings(admin, acting.djId);
  settings.riders = normalizeNamedRiders(settings.riders).filter((r) => r.id !== id);
  if (!(await saveSettings(admin, acting.djId, settings))) {
    return NextResponse.json({ error: 'Could not delete the rider.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, riders: settings.riders });
}
