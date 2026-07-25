// /api/team/accept
//   GET  ?token=…  → invite context { email, ownerName, role } so the accept
//                    page can greet a brand-new invitee and send a code.
//   POST { token } → the invited person (now signed in with the invited email)
//                    links their user id to the membership.
// Most invitees have no account yet: they create one on the accept page via a
// 6-digit email code (signInWithOtp), which lands here as a signed-in user with
// no users row — so POST also seeds a lightweight 'teammate' profile.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

type Row = { id: string; invited_email: string; status: string; owner_id: string; role: string };

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || '';
  if (!token) return NextResponse.json({ error: 'Missing invite.' }, { status: 400 });
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data } = await admin.from('team_members')
    .select('invited_email, status, owner_id, role').eq('invite_token', token).maybeSingle();
  const row = data as unknown as { invited_email: string; status: string; owner_id: string; role: string } | null;
  if (!row) return NextResponse.json({ error: 'This invite is no longer valid.' }, { status: 404 });
  if (row.status !== 'invited') return NextResponse.json({ error: 'This invite has already been used or was revoked.' }, { status: 400 });
  const { data: owner } = await admin.from('users').select('name').eq('id', row.owner_id).maybeSingle();
  const ownerName = (owner as unknown as { name?: string } | null)?.name || 'a DJ';
  return NextResponse.json({ ok: true, email: row.invited_email, ownerName, role: row.role });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in to accept.', needsAuth: true }, { status: 401 });
  let body: { token?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const token = String(body.token || '');
  if (!token) return NextResponse.json({ error: 'Missing invite.' }, { status: 400 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data } = await admin.from('team_members').select('id, invited_email, status, owner_id, role').eq('invite_token', token).maybeSingle();
  const row = data as unknown as Row | null;
  if (!row) return NextResponse.json({ error: 'This invite is no longer valid.' }, { status: 404 });
  if (row.status !== 'invited') return NextResponse.json({ error: 'This invite has already been used or was revoked.' }, { status: 400 });
  if (row.owner_id === user.id) return NextResponse.json({ error: "You can't add yourself to your own account." }, { status: 400 });

  // Fail CLOSED on the email match — an account with no email can't accept.
  const myEmail = (user.email || '').trim().toLowerCase();
  if (!myEmail || row.invited_email.toLowerCase() !== myEmail) {
    return NextResponse.json({ error: `This invite was sent to ${row.invited_email}. Use that email to accept.` }, { status: 403 });
  }

  // A DJ who owns their own account can't also be a teammate (no "act as myself"
  // escape today), and nobody can hold two active memberships.
  const { data: meRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
  const myRole = (meRow as unknown as { role?: string } | null)?.role;
  // Only unregistered emails (or an existing teammate account) may join. A
  // customer-facing account — dj, host, or venue — can't double as staff: it
  // would let someone book the very account they manage, or run two identities
  // (their own bookings + acting-as-owner) at once. Force a fresh email.
  if (myRole === 'dj' || myRole === 'host' || myRole === 'venue') {
    const label = myRole === 'dj' ? 'a DJ' : `a ${myRole}`;
    return NextResponse.json({ error: `This email is already registered as ${label} account on Global DJ Connect. Team members need an email that isn't already used here — ask whoever invited you to send it to a different address.` }, { status: 400 });
  }
  const { data: existingMem } = await admin.from('team_members').select('id').eq('member_id', user.id).eq('status', 'active').limit(1);
  if (((existingMem as unknown as unknown[] | null) || []).length > 0) {
    return NextResponse.json({ error: 'You are already on a team. Ask to be removed there first.' }, { status: 400 });
  }

  const { error } = await admin.from('team_members')
    .update({ member_id: user.id, status: 'active', accepted_at: new Date().toISOString(), invite_token: null } as unknown as never)
    .eq('id', row.id);
  if (error) return NextResponse.json({ error: 'Could not accept the invite.' }, { status: 500 });

  // Brand-new invitees (created via the email code) have no users row yet.
  // Seed a lightweight 'teammate' profile so login + the app have something to
  // read. Best-effort: the membership is what grants access, so don't fail here.
  if (!meRow) {
    const name = (myEmail.split('@')[0] || 'Teammate').replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    await admin.from('users').upsert(
      { id: user.id, role: 'teammate', name, email_verified: true } as unknown as never,
      { onConflict: 'id' },
    );
  }
  return NextResponse.json({ ok: true });
}
