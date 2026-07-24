// /api/team — the owner manages their team seats.
//   GET    — list members + seat limit/used (seat limit comes from the tier).
//   POST   — invite by email + role (gated on Pro+ and free seats). Emails link.
//   PATCH  — change a member's role.
//   DELETE — remove a member (their access dies immediately).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { seatsFor, type AccessFields } from '@/lib/access';
import { isTeamRole } from '@/lib/team';

export const runtime = 'nodejs';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';
const ACCESS_COLS = 'sub_status, sub_tier, sub_period_end, comp_tier, comp_expires_at, comp_source';
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface TeamRow { id: string; owner_id: string; member_id: string | null; invited_email: string; role: string; status: string; invited_at: string; accepted_at: string | null; }

async function seatLimit(admin: SupabaseClient, ownerId: string): Promise<number> {
  const { data } = await admin.from('users').select(ACCESS_COLS).eq('id', ownerId).maybeSingle();
  return seatsFor((data as unknown as AccessFields) || ({} as AccessFields));
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const admin = createAdminClient() as unknown as SupabaseClient;

  const { data } = await admin.from('team_members').select('id, owner_id, member_id, invited_email, role, status, invited_at, accepted_at').eq('owner_id', user.id).order('invited_at', { ascending: true });
  const members = ((data as unknown as TeamRow[] | null) || []).filter((m) => m.status !== 'revoked');
  const limit = await seatLimit(admin, user.id);
  return NextResponse.json({ ok: true, members, seatLimit: limit, seatsUsed: members.length });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  let body: { email?: unknown; role?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const email = String(body.email || '').trim().toLowerCase();
  const role = body.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 });
  if (!isTeamRole(role)) return NextResponse.json({ error: 'Pick a role.' }, { status: 400 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const limit = await seatLimit(admin, user.id);
  if (limit <= 0) return NextResponse.json({ error: 'Team seats are a Pro feature. Upgrade to invite teammates.' }, { status: 403 });

  const { data: existing } = await admin.from('team_members').select('id, status, invited_email').eq('owner_id', user.id);
  const rows = (existing as unknown as { id: string; status: string; invited_email: string }[] | null) || [];
  const active = rows.filter((r) => r.status !== 'revoked');
  const already = active.find((r) => r.invited_email.toLowerCase() === email);
  if (!already && active.length >= limit) return NextResponse.json({ error: `You've used all ${limit} seats on your plan.` }, { status: 400 });

  const token = (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/-/g, '');
  const { error } = await admin.from('team_members').upsert({
    owner_id: user.id, invited_email: email, role, status: 'invited', invite_token: token, invited_at: new Date().toISOString(),
  } as unknown as never, { onConflict: 'owner_id,invited_email' });
  if (error) return NextResponse.json({ error: 'Could not send the invite.' }, { status: 500 });

  // Email the invite.
  if (process.env.RESEND_API_KEY) {
    const { data: djData } = await admin.from('users').select('name').eq('id', user.id).maybeSingle();
    const ownerName = (djData as unknown as { name?: string | null } | null)?.name || 'A Global DJ Connect account';
    const url = `${SITE_URL}/team/accept?token=${token}`;
    const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
<h2 style="color:#111;">You've been added to ${esc(ownerName)}'s team</h2>
<p style="color:#555;font-size:14px;line-height:1.6;">You've been invited as <strong>${esc(String(role))}</strong> on Global DJ Connect. Accept with the email this was sent to — sign in and you'll be dropped into the account with your access.</p>
<p style="margin:22px 0;"><a href="${url}" style="background:#000;color:#00f5c4;padding:13px 26px;border-radius:8px;text-decoration:none;font-weight:700;">Accept invite</a></p>
<p style="color:#999;font-size:12px;word-break:break-all;">${url}</p></div>`;
    try { await new Resend(process.env.RESEND_API_KEY).emails.send({ from: FROM, to: email, subject: `${ownerName} added you to their team`, html }); }
    catch { return NextResponse.json({ ok: true, warning: 'Invite saved, but the email could not be sent.' }); }
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  let body: { id?: unknown; role?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const id = String(body.id || '');
  if (!id || !isTeamRole(body.role)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { error } = await admin.from('team_members').update({ role: body.role } as unknown as never).eq('id', id).eq('owner_id', user.id);
  if (error) return NextResponse.json({ error: 'Could not update the role.' }, { status: 500 });
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
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { error } = await admin.from('team_members').delete().eq('id', id).eq('owner_id', user.id);
  if (error) return NextResponse.json({ error: 'Could not remove the member.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
