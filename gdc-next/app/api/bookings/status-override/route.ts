// POST /api/bookings/status-override
//
// Lets the DJ manually mark a readiness step done / not-done on one of their
// bookings (for steps handled outside the app — contract signed on paper, a
// deposit paid in cash, etc.). Stored in bookings.status_overrides (JSONB),
// e.g. { "contract": true }.
//
// Body: { bookingId: string, key: string, done: boolean }
// DJ-only (must own the booking).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 15;

// Only these keys can be overridden — guards against arbitrary JSON writes.
const ALLOWED_KEYS = new Set(['contract', 'deposit', 'deposit_skipped', 'song_list']);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { bookingId?: unknown; key?: unknown; done?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const bookingId = typeof body.bookingId === 'string' && body.bookingId ? body.bookingId : null;
  const key = typeof body.key === 'string' ? body.key : null;
  const done = body.done === true;
  if (!bookingId || !key || !ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: 'Missing or invalid bookingId/key' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from('bookings')
    .select('status_overrides, dj_id')
    .eq('id', bookingId)
    .maybeSingle();
  const row = data as { status_overrides?: Record<string, boolean> | null; dj_id?: string | null } | null;
  if (!row) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  if (row.dj_id !== user.id) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });

  const overrides: Record<string, boolean> =
    row.status_overrides && typeof row.status_overrides === 'object' ? { ...row.status_overrides } : {};
  if (done) overrides[key] = true; else delete overrides[key];

  // Manual overrides are discrete actions the booking log should show, so stamp
  // the moment they're toggled. (status_overrides is a boolean map with no
  // history of its own.)
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status_overrides: overrides };
  if (key === 'deposit_skipped') {
    if (done) patch.deposit_skipped_at = now;
    else patch.deposit_skip_undone_at = now;
  } else if (key === 'contract') {
    // "Mark Complete" on a contract handled outside the app (signed on paper,
    // etc.) — distinct from the host signing in-app (contract_signed_at).
    if (done) patch.contract_completed_at = now;
    else patch.contract_completion_undone_at = now;
  }

  try {
    await admin.from('bookings').update(patch as unknown as never).eq('id', bookingId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, status_overrides: overrides });
}
