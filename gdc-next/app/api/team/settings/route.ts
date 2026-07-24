// /api/team/settings — the ONE exception to owner-only booking settings.
// Owner + Admin + Manager can read/write ONLY the rider + guest-list config on
// the owner's account (rider default template, rider toggle, guest-list toggle).
// Everything else in Booking Settings stays owner-only. Uses the admin client
// so a permitted member writes the owner's row; the role gate is the security.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActingContext } from '@/lib/acting';
import { normalizeRiderItems } from '@/lib/rider';

export const runtime = 'nodejs';

const ALLOWED = new Set(['owner', 'admin', 'manager']);

async function memberCanAddons(admin: SupabaseClient, authUserId: string, djId: string, isMember: boolean): Promise<boolean> {
  if (!isMember) return true;
  const { data } = await admin.from('team_members').select('can_addons').eq('member_id', authUserId).eq('owner_id', djId).eq('status', 'active').maybeSingle();
  const row = data as unknown as { can_addons?: boolean } | null;
  return !!row && row.can_addons !== false;
}

function parseSettings(bs: unknown): Record<string, unknown> {
  if (typeof bs === 'string') { try { return JSON.parse(bs); } catch { return {}; } }
  if (bs && typeof bs === 'object') return bs as Record<string, unknown>;
  return {};
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const acting = await getActingContext(user.id);
  const admin = createAdminClient() as unknown as SupabaseClient;
  if (!ALLOWED.has(acting.role) || !(await memberCanAddons(admin, acting.authUserId, acting.djId, acting.isMember))) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  }

  const { data } = await admin.from('users').select('booking_settings').eq('id', acting.djId).maybeSingle();
  const bs = parseSettings((data as unknown as { booking_settings?: unknown } | null)?.booking_settings);
  return NextResponse.json({
    ok: true,
    role: acting.role,
    riderDefault: normalizeRiderItems(bs.rider_default),
    riderEnabled: !!bs.rider_enabled,
    guestlistEnabled: !!bs.guestlist_enabled,
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const acting = await getActingContext(user.id);
  const admin = createAdminClient() as unknown as SupabaseClient;
  if (!ALLOWED.has(acting.role) || !(await memberCanAddons(admin, acting.authUserId, acting.djId, acting.isMember))) {
    return NextResponse.json({ error: 'Your role cannot change these settings.' }, { status: 403 });
  }

  let body: { riderDefault?: unknown; riderEnabled?: unknown; guestlistEnabled?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const { data } = await admin.from('users').select('booking_settings').eq('id', acting.djId).maybeSingle();
  const bs = parseSettings((data as unknown as { booking_settings?: unknown } | null)?.booking_settings);

  // Merge ONLY the allowed fields — never touch anything else in settings.
  if (body.riderDefault !== undefined) bs.rider_default = normalizeRiderItems(body.riderDefault);
  if (body.riderEnabled !== undefined) bs.rider_enabled = !!body.riderEnabled;
  if (body.guestlistEnabled !== undefined) bs.guestlist_enabled = !!body.guestlistEnabled;

  const { error } = await admin.from('users').update({ booking_settings: JSON.stringify(bs) } as unknown as never).eq('id', acting.djId);
  if (error) return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
