// /api/team — the owner manages their team seats.
//   GET    — list members + seat limit/used (seat limit comes from the tier).
//   POST   — invite by email + role (gated on Pro+ and free seats). Emails link.
//   PATCH  — change a member's role.
//   DELETE — remove a member (their access dies immediately).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { seatsFor, type AccessFields } from '@/lib/access';
import { isTeamRole } from '@/lib/team';
import { getActingContext, canManageTeam, type ActingContext } from '@/lib/acting';
import { logActivity } from '@/lib/activityLog';

export const runtime = 'nodejs';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';
const ACCESS_COLS = 'sub_status, sub_tier, sub_period_end, comp_tier, comp_expires_at, comp_source';
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface TeamRow { id: string; owner_id: string; member_id: string | null; invited_email: string; invited_name: string | null; role: string; status: string; can_addons: boolean; invited_at: string; accepted_at: string | null; }

async function seatLimit(admin: SupabaseClient, ownerId: string): Promise<number> {
  const { data } = await admin.from('users').select(ACCESS_COLS).eq('id', ownerId).maybeSingle();
  return seatsFor((data as unknown as AccessFields) || ({} as AccessFields));
}

// Gate that returns the full acting context so staffing changes can be
// attributed in the activity log. Null when the caller can't manage the team.
async function manageActing(authUserId: string): Promise<ActingContext | null> {
  const acting = await getActingContext(authUserId);
  return canManageTeam(acting.role) ? acting : null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const acting = await getActingContext(user.id);
  if (!canManageTeam(acting.role)) return NextResponse.json({ error: 'You do not have team access.' }, { status: 403 });
  const ownerId = acting.djId;
  const admin = createAdminClient() as unknown as SupabaseClient;

  // These three reads don't depend on each other, so run them together instead
  // of one-after-another — this is what made the Team tab feel slow. The owner
  // row now carries BOTH the display name and the seat-tier columns in a single
  // select (was two separate queries), and the auth email lookup (the slowest
  // hop) runs in parallel rather than last.
  const [membersRes, ownerRes, ownerEmail] = await Promise.all([
    admin.from('team_members').select('id, owner_id, member_id, invited_email, invited_name, role, status, can_addons, invited_at, accepted_at').eq('owner_id', ownerId).order('invited_at', { ascending: true }),
    admin.from('users').select(`name, ${ACCESS_COLS}`).eq('id', ownerId).maybeSingle(),
    resolveUserEmail(ownerId),
  ]);

  const members = ((membersRes.data as unknown as TeamRow[] | null) || []).filter((m) => m.status !== 'revoked');

  // Pull each accepted teammate's own profile name (the "Full name" they set in
  // their account) so the list shows a real name, not just the email.
  const memberIds = members.map((m) => m.member_id).filter((x): x is string => !!x);
  const nameById: Record<string, string | null> = {};
  if (memberIds.length) {
    const { data: us } = await admin.from('users').select('id, name').in('id', memberIds);
    for (const u of (us as unknown as { id: string; name: string | null }[] | null) || []) nameById[u.id] = u.name;
  }
  const enriched = members.map((m) => ({ ...m, name: (m.member_id ? nameById[m.member_id] : null) || m.invited_name || null }));

  const ownerData = ownerRes.data as unknown as (AccessFields & { name?: string | null }) | null;
  const limit = seatsFor((ownerData as AccessFields) || ({} as AccessFields));

  // The account OWNER, for the pinned top row. Not a seat, not removable, no
  // role change — just shown so the team list is complete.
  const owner = {
    id: ownerId,
    name: ownerData?.name || null,
    email: ownerEmail,
  };

  return NextResponse.json({ ok: true, owner, members: enriched, seatLimit: limit, seatsUsed: enriched.length, viewerId: user.id });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  let body: { name?: unknown; email?: unknown; role?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const email = String(body.email || '').trim().toLowerCase();
  const invitedName = String(body.name || '').trim().slice(0, 120) || null;
  const role = body.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 });
  if (!isTeamRole(role)) return NextResponse.json({ error: 'Pick a role.' }, { status: 400 });
  if (email === (user.email || '').trim().toLowerCase()) return NextResponse.json({ error: "You can't invite yourself." }, { status: 400 });
  const acting = await manageActing(user.id);
  if (!acting) return NextResponse.json({ error: 'You do not have team access.' }, { status: 403 });
  const ownerId = acting.djId;

  const admin = createAdminClient() as unknown as SupabaseClient;
  const limit = await seatLimit(admin, ownerId);
  if (limit <= 0) return NextResponse.json({ error: 'Team seats are a Pro feature. Upgrade to invite teammates.' }, { status: 403 });

  const { data: existing } = await admin.from('team_members').select('id, status, invited_email').eq('owner_id', ownerId);
  const rows = (existing as unknown as { id: string; status: string; invited_email: string }[] | null) || [];
  const active = rows.filter((r) => r.status !== 'revoked');
  const already = active.find((r) => r.invited_email.toLowerCase() === email);
  if (already && already.status === 'active') return NextResponse.json({ error: 'That person is already on your team.' }, { status: 400 });
  if (!already && active.length >= limit) return NextResponse.json({ error: `You've used all ${limit} seats on your plan.` }, { status: 400 });

  // Refuse to invite an email that already has a customer-facing account. A dj,
  // host, or venue can't double as staff — they could book the very account they
  // manage, or run two identities (their own bookings + acting-as-owner) at
  // once. Only unregistered emails and existing teammate accounts may be
  // invited. (The accept route enforces the same rule; this just stops a dead
  // "pending" invite from being sent in the first place.)
  {
    let existingId: string | null = null;
    try {
      const { data: uid } = await admin.rpc('auth_user_id_by_email', { p_email: email });
      if (uid) existingId = uid as string;
    } catch { /* fall through to the listUsers fallback */ }
    if (!existingId) {
      try {
        const { data: lu } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const hit = (lu?.users || []).find((u) => (u.email || '').toLowerCase() === email);
        if (hit) existingId = hit.id;
      } catch { /* best-effort — accept-time check is the backstop */ }
    }
    if (existingId) {
      const { data: u } = await admin.from('users').select('role').eq('id', existingId).maybeSingle();
      const r = (u as unknown as { role?: string } | null)?.role;
      if (r === 'dj' || r === 'host' || r === 'venue') {
        const label = r === 'dj' ? 'a DJ' : `a ${r}`;
        return NextResponse.json({ error: `That email already has ${label} account on Global DJ Connect. Teammates need an email that isn't already registered here — try a different address.` }, { status: 400 });
      }
    }
  }

  const token = (globalThis.crypto?.randomUUID?.() || '').replace(/-/g, '');
  if (!token) return NextResponse.json({ error: 'Could not generate a secure invite. Please try again.' }, { status: 500 });
  const { error } = await admin.from('team_members').upsert({
    owner_id: ownerId, invited_email: email, invited_name: invitedName, role, status: 'invited', invite_token: token, invited_at: new Date().toISOString(),
  } as unknown as never, { onConflict: 'owner_id,invited_email' });
  if (error) return NextResponse.json({ error: 'Could not send the invite.' }, { status: 500 });

  // Email the invite.
  if (process.env.RESEND_API_KEY) {
    const { data: djData } = await admin.from('users').select('name').eq('id', ownerId).maybeSingle();
    const ownerName = (djData as unknown as { name?: string | null } | null)?.name || 'A Global DJ Connect account';
    const url = `${SITE_URL}/team/accept?token=${token}`;
    const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
<h2 style="color:#111;">You've been added to ${esc(ownerName)}'s team</h2>
<p style="color:#555;font-size:14px;line-height:1.6;">You've been invited as <strong>${esc(String(role))}</strong> on Global DJ Connect. Accept with the email this was sent to — sign in and you'll be dropped into the account with your access.</p>
<p style="margin:22px 0;"><a href="${url}" style="background:#000;color:#00f5c4;padding:13px 26px;border-radius:8px;text-decoration:none;font-weight:700;">Accept invite</a></p>
<p style="color:#999;font-size:12px;word-break:break-all;">${url}</p></div>`;
    try { await new Resend(process.env.RESEND_API_KEY).emails.send({ from: FROM, to: email, subject: `${ownerName} added you to their team`, html }); }
    catch {
      await logActivity(acting, { action: 'team.invited', summary: `Invited ${email} as ${role}` });
      return NextResponse.json({ ok: true, warning: 'Invite saved, but the email could not be sent.' });
    }
  }
  await logActivity(acting, { action: 'team.invited', summary: `Invited ${email} as ${role}` });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  let body: { id?: unknown; role?: unknown; canAddons?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const acting = await manageActing(user.id);
  if (!acting) return NextResponse.json({ error: 'You do not have team access.' }, { status: 403 });
  const ownerId = acting.djId;
  const upd: Record<string, unknown> = {};
  if (isTeamRole(body.role)) upd.role = body.role;
  if (typeof body.canAddons === 'boolean') upd.can_addons = body.canAddons;
  if (Object.keys(upd).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: updRows, error } = await admin.from('team_members').update(upd as unknown as never).eq('id', id).eq('owner_id', ownerId).select('invited_email');
  if (error) return NextResponse.json({ error: 'Could not update the member.' }, { status: 500 });
  if (Array.isArray(updRows) && updRows.length > 0 && isTeamRole(body.role)) {
    const who = (updRows[0] as { invited_email?: string | null }).invited_email || 'a teammate';
    await logActivity(acting, { action: 'team.role_changed', summary: `Changed ${who}'s role to ${body.role}` });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  let body: { id?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const acting = await manageActing(user.id);
  if (!acting) return NextResponse.json({ error: 'You do not have team access.' }, { status: 403 });
  const ownerId = acting.djId;
  const admin = createAdminClient() as unknown as SupabaseClient;

  // Grab the row first so we know WHO we're removing before it's gone.
  const { data: rowData } = await admin.from('team_members')
    .select('member_id, status, invited_email').eq('id', id).eq('owner_id', ownerId).maybeSingle();
  const memberRow = rowData as unknown as { member_id?: string | null; invited_email?: string | null } | null;
  const memberId = memberRow?.member_id || null;
  const memberEmail = memberRow?.invited_email || null;

  // An admin managing the team can't delete their OWN membership from here
  // (they'd nuke their own access). They can leave via their account settings.
  if (memberId && memberId === user.id) {
    return NextResponse.json({ error: "You can't remove your own account here." }, { status: 400 });
  }

  const { error } = await admin.from('team_members').delete().eq('id', id).eq('owner_id', ownerId);
  if (error) return NextResponse.json({ error: 'Could not remove the member.' }, { status: 500 });

  await logActivity(acting, { action: 'team.removed', summary: `Removed ${memberEmail || 'a teammate'} from the team` });

  // A teammate account is pointless once it's off every team — and worse, it
  // would keep the person's email locked out of ever creating their own DJ or
  // host account. So if this was an ACCEPTED teammate who now belongs to no
  // active team, delete the account outright to free the email. Guarded hard:
  // only ever deletes a row whose role is exactly 'teammate'.
  if (memberId) {
    const { data: others } = await admin.from('team_members')
      .select('id').eq('member_id', memberId).eq('status', 'active').limit(1);
    const stillOnATeam = ((others as unknown as unknown[] | null) || []).length > 0;
    if (!stillOnATeam) {
      const { data: prof } = await admin.from('users').select('role').eq('id', memberId).maybeSingle();
      if ((prof as unknown as { role?: string } | null)?.role === 'teammate') {
        await admin.from('users').delete().eq('id', memberId);
        try { await admin.auth.admin.deleteUser(memberId); } catch { /* auth row may already be gone */ }
      }
    }
  }
  return NextResponse.json({ ok: true });
}
