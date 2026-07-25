// POST /api/team/accept  { token } — the invited person, once signed in, links
// their user id to the membership. The signed-in email must match the invite.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in to accept.', needsAuth: true }, { status: 401 });
  let body: { token?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const token = String(body.token || '');
  if (!token) return NextResponse.json({ error: 'Missing invite.' }, { status: 400 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data } = await admin.from('team_members').select('id, invited_email, status, owner_id').eq('invite_token', token).maybeSingle();
  const row = data as unknown as { id: string; invited_email: string; status: string; owner_id: string } | null;
  if (!row) return NextResponse.json({ error: 'This invite is no longer valid.' }, { status: 404 });
  if (row.status !== 'invited') return NextResponse.json({ error: 'This invite has already been used or was revoked.' }, { status: 400 });
  if (row.owner_id === user.id) return NextResponse.json({ error: "You can't add yourself to your own account." }, { status: 400 });

  // Fail CLOSED on the email match — an account with no email can't accept.
  const myEmail = (user.email || '').trim().toLowerCase();
  if (!myEmail || row.invited_email.toLowerCase() !== myEmail) {
    return NextResponse.json({ error: `This invite was sent to ${row.invited_email}. Sign in with that email to accept.` }, { status: 403 });
  }

  // A DJ who owns their own account can't also be a teammate (no "act as myself"
  // escape today), and nobody can hold two active memberships.
  const { data: meRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
  if ((meRow as unknown as { role?: string } | null)?.role === 'dj') {
    return NextResponse.json({ error: 'You already run your own DJ account. Team seats are for staff who don\'t have their own account.' }, { status: 400 });
  }
  const { data: existingMem } = await admin.from('team_members').select('id').eq('member_id', user.id).eq('status', 'active').limit(1);
  if (((existingMem as unknown as unknown[] | null) || []).length > 0) {
    return NextResponse.json({ error: 'You are already on a team. Ask to be removed there first.' }, { status: 400 });
  }

  const { error } = await admin.from('team_members')
    .update({ member_id: user.id, status: 'active', accepted_at: new Date().toISOString(), invite_token: null } as unknown as never)
    .eq('id', row.id);
  if (error) return NextResponse.json({ error: 'Could not accept the invite.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
