// POST /api/bookings/change-response  — the HOST approves or declines the DJ's
// pending changes to a booking. Auth is the unguessable token from the email
// link (the token IS the credential — no login needed), exactly like the
// contract signing links and cancellation responses.
//
// A single submit from the DJ can create several pending rows (date + price,
// say). The host sees and answers them together, so one token resolves the
// whole batch of still-pending requests for that booking.
//
// Body: { token: string, action: 'approve' | 'decline' }
//
// On APPROVE we apply every pending change to the booking (price recomputes the
// frozen-tax snapshot; collected money is untouched, per the owner's rule) and
// email the DJ that the host approved — with a reminder they can send an
// updated contract if needed. On DECLINE nothing changes and the DJ is told.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { Resend } from 'resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';
const LEGAL = 'This change does not legally cancel or modify either party’s existing obligations. Any change must be mutually agreed upon by both parties. Global DJ Connect is not responsible for enforcing this booking or any changes to it.';

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
function shell(content: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000;padding:24px 32px;" align="center"><div style="font-family:Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div></td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;"><p style="margin:0;color:#888;font-size:11px;">© ${new Date().getFullYear()} Global DJ Connect · globaldjconnect.com</p></td></tr>
</table></td></tr></table>`;
}

interface ReqRow { id: string; booking_id: string; dj_id: string; field: string; old_value: string | null; new_value: string | null; target_col: string; target_raw: string | null; status: string; }

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: string; action?: string };
  const token = body.token;
  const action = body.action;
  if (!token || (action !== 'approve' && action !== 'decline')) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const admin = createAdminClient() as unknown as SupabaseClient;

  // Resolve the token → the booking, then the whole pending batch for it.
  const { data: hit } = await admin.from('booking_change_requests').select('id, booking_id, dj_id, status').eq('token', token).maybeSingle<ReqRow>();
  if (!hit) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 });
  const { data: pend } = await admin.from('booking_change_requests')
    .select('id, booking_id, dj_id, field, old_value, new_value, target_col, target_raw, status')
    .eq('booking_id', hit.booking_id).eq('status', 'pending');
  const pending = (pend || []) as unknown as ReqRow[];
  if (pending.length === 0) return NextResponse.json({ ok: true, alreadyDone: true });

  const nowISO = new Date().toISOString();

  if (action === 'decline') {
    await admin.from('booking_change_requests').update({ status: 'declined', responded_at: nowISO } as unknown as never)
      .eq('booking_id', hit.booking_id).eq('status', 'pending');
    await notifyDj(admin, hit.dj_id, hit.booking_id, pending, 'declined');
    return NextResponse.json({ ok: true, action: 'declined' });
  }

  // APPROVE — apply each pending change.
  const { data: bk } = await admin.from('bookings').select('id, tax_pct, currency').eq('id', hit.booking_id).maybeSingle<{ id: string; tax_pct: number | null; currency: string | null }>();
  const taxPct = bk?.tax_pct != null ? Number(bk.tax_pct) : 0;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const update: Record<string, unknown> = {};
  for (const r of pending) {
    if (r.target_col === 'price') {
      const price = Number(r.target_raw);
      if (!Number.isFinite(price)) continue;
      update.counter_rate = price; // highest-priority agreed-rate field → becomes the total
      if (taxPct > 0) {
        const tax = round2((price * taxPct) / 100);
        update.tax_amount = tax;
        update.total_with_tax = round2(price + tax);
      } else {
        update.tax_amount = 0;
        update.total_with_tax = price;
      }
    } else {
      update[r.target_col] = r.target_raw === '' ? null : r.target_raw;
    }
  }
  if (Object.keys(update).length > 0) {
    const { error } = await admin.from('bookings').update(update as unknown as never).eq('id', hit.booking_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  }
  await admin.from('booking_change_requests').update({ status: 'approved', responded_at: nowISO } as unknown as never)
    .eq('booking_id', hit.booking_id).eq('status', 'pending');
  await notifyDj(admin, hit.dj_id, hit.booking_id, pending, 'approved');
  return NextResponse.json({ ok: true, action: 'approved' });
}

async function notifyDj(admin: SupabaseClient, djId: string, bookingId: string, rows: ReqRow[], outcome: 'approved' | 'declined') {
  const email = await resolveUserEmail(djId);
  if (!email || !process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const list = rows.map((r) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#111;"><b>${esc(r.field)}</b><br><span style="color:#888;font-size:13px;">${esc(r.old_value || '—')}</span> → <span style="color:${outcome === 'approved' ? '#0a6f61' : '#b0791f'};font-weight:700;">${esc(r.new_value || '—')}</span></td></tr>`).join('');
    const link = `${SITE_URL}/upcoming-bookings`;
    let content: string;
    if (outcome === 'approved') {
      content = `<h1 style="margin:0 0 12px;font-size:20px;color:#111;">The host approved your changes</h1>
<p style="margin:0 0 6px;color:#333;font-size:15px;">These changes are now live on the booking:</p>
<table width="100%" cellpadding="0" cellspacing="0">${list}</table>
<p style="margin:16px 0 6px;color:#333;font-size:15px;">If a contract is already in place, you can send an <b>updated contract</b> reflecting these changes.</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:16px auto 4px;"><tr><td style="background:#0a6f61;border-radius:6px;"><a href="${link}" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Open booking</a></td></tr></table>`;
    } else {
      content = `<h1 style="margin:0 0 12px;font-size:20px;color:#111;">The host declined your changes</h1>
<p style="margin:0 0 6px;color:#333;font-size:15px;">Nothing was changed. The booking stays as it was:</p>
<table width="100%" cellpadding="0" cellspacing="0">${list}</table>
<table cellpadding="0" cellspacing="0" border="0" style="margin:16px auto 4px;"><tr><td style="background:#0a6f61;border-radius:6px;"><a href="${link}" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Open booking</a></td></tr></table>`;
    }
    content += `<p style="margin:20px 0 0;color:#999;font-size:11px;line-height:1.5;border-top:1px solid #eee;padding-top:12px;">${esc(LEGAL)}</p>`;
    await resend.emails.send({ from: FROM, to: email, subject: outcome === 'approved' ? 'Host approved your booking changes' : 'Host declined your booking changes', html: shell(content) });
  } catch { /* non-fatal */ }
}
