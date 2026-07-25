// POST /api/team/leave — a teammate deletes their OWN staff account.
//
// A teammate login is worthless once it isn't on a team, and while it exists it
// keeps the person's email from ever being used for a real DJ/host account. So
// self-delete removes every membership AND the account itself, freeing the
// email. Guarded hard: this only ever acts on the CALLER's own account, and
// only when that account's role is exactly 'teammate' — it can never delete a
// DJ, host, or venue.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: prof } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
  const role = (prof as unknown as { role?: string } | null)?.role;
  if (role !== 'teammate') {
    return NextResponse.json({ error: 'Only a team login can be deleted here.' }, { status: 403 });
  }

  // Drop every membership this account holds, then the profile row, then the
  // auth user. Best-effort on the auth delete — the account is already unusable
  // once the profile + memberships are gone.
  await admin.from('team_members').delete().eq('member_id', user.id);
  await admin.from('users').delete().eq('id', user.id);
  try { await admin.auth.admin.deleteUser(user.id); } catch { /* may already be gone */ }

  return NextResponse.json({ ok: true });
}
