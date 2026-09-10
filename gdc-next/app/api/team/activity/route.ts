// GET /api/team/activity — the owner's audit trail of team actions.
//
// OWNER ONLY. Returns the account's activity newest-first with each actor's
// name resolved, so the Team page can show one log per user, grouped by day.
// Reads via the admin client because the log table is RLS-locked to the server.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActingContext } from '@/lib/acting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A reasonable window so the payload stays small; the log keeps everything, this
// just bounds what the page pulls at once.
const MAX_ROWS = 1000;

interface LogRow {
  id: string;
  actor_id: string;
  actor_role: string | null;
  action: string;
  summary: string;
  booking_id: string | null;
  created_at: string;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const acting = await getActingContext(user.id);
  // OWNER ONLY — the activity log is the owner's oversight tool. A teammate must
  // not read (or by omission, audit) the account's activity.
  if (acting.role !== 'owner') {
    return NextResponse.json({ error: 'Only the account owner can view team activity.' }, { status: 403 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data } = await admin
    .from('team_activity_log')
    .select('id, actor_id, actor_role, action, summary, booking_id, created_at')
    .eq('owner_id', acting.djId)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);
  const rows = (data as unknown as LogRow[] | null) || [];

  // Resolve actor names once (owner + each teammate all have a users row).
  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id)));
  const names: Record<string, string> = {};
  if (actorIds.length) {
    const { data: uData } = await admin.from('users').select('id, name').in('id', actorIds);
    for (const u of (uData as unknown as { id: string; name: string | null }[] | null) || []) {
      if (u.name) names[u.id] = u.name;
    }
  }

  const entries = rows.map((r) => ({
    id: r.id,
    actorId: r.actor_id,
    actorName: names[r.actor_id] || (r.actor_id === acting.djId ? 'You (Owner)' : 'Teammate'),
    actorRole: r.actor_role,
    action: r.action,
    summary: r.summary,
    bookingId: r.booking_id,
    createdAt: r.created_at,
  }));

  return NextResponse.json({ ok: true, ownerId: acting.djId, entries });
}
