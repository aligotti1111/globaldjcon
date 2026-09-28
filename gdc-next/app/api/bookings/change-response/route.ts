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
  // The DJ cancelled this request — the host can no longer approve or decline it.
  if (hit.status === 'cancelled' || hit.status === 'superseded') {
    return NextResponse.json({ error: 'This request was cancelled by the DJ.', cancelled: true }, { status: 409 });
  }
  const { data: pend } = await admin.from('booking_change_requests')
    .select('id, booking_id, dj_id, field, old_value, new_value, target_col, target_raw, status')
    .eq('booking_id', hit.booking_id).eq('status', 'pending');
  const pending = (pend || []) as unknown as ReqRow[];
  if (pending.length === 0) return NextResponse.json({ ok: true, alreadyDone: true });

  const nowISO = new Date().toISOString();
  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Booking snapshot BEFORE any approve mutation — the "old" side of the price
  // breakdown, and the base for recompute on approve.
  const { data: bk } = await admin.from('bookings').select('id, tax_pct, tax_amount, total_with_tax, counter_rate, quoted_rate, offer_amount, currency, deposit_amount, balance_settled_total, status_overrides, field_edits').eq('id', hit.booking_id).maybeSingle<{ id: string; tax_pct: number | null; tax_amount: number | null; total_with_tax: number | null; counter_rate: number | null; quoted_rate: number | null; offer_amount: number | null; currency: string | null; deposit_amount: number | null; balance_settled_total: number | null; status_overrides: Record<string, boolean> | null; field_edits: Record<string, string> | null }>();
  const taxPct = bk?.tax_pct != null ? Number(bk.tax_pct) : 0;

  // Build the price breakdown (old → new) when a price / tax change is in the
  // batch, so the DJ's confirm/decline email carries the same figures the host
  // saw — including what's already collected and the resulting new balance.
  const priceReq = pending.find((r) => r.target_col === 'price');
  const taxReq = pending.find((r) => r.target_col === 'tax_pct');
  let breakdown: Breakdown | null = null;
  if (priceReq || taxReq) {
    const cur = bk?.currency || 'USD';
    const oldRate = Number(bk?.counter_rate ?? bk?.quoted_rate ?? bk?.offer_amount ?? 0);
    const newRate = priceReq ? Number(priceReq.target_raw) : oldRate;
    const oldTaxPct = bk?.tax_pct != null ? Number(bk.tax_pct) : 0;
    const newTaxPct = taxReq ? Math.max(0, Number(taxReq.target_raw) || 0) : oldTaxPct;
    const oldTax = round2((oldRate * oldTaxPct) / 100);
    const newTax = round2((newRate * newTaxPct) / 100);
    const oldTotal = round2(oldRate + oldTax);
    const newTotal = round2(newRate + newTax);
    // Everything collected (real rows + hand-marked deposit/balance).
    const { data: payAll } = await admin.from('booking_payments').select('kind, amount_paid').eq('booking_id', hit.booking_id);
    const pr = (payAll as { kind: string; amount_paid?: number }[] | null) || [];
    let collected = pr.reduce((s, p) => s + Number(p.amount_paid || 0), 0);
    const so = bk?.status_overrides || {};
    if (so.deposit && !pr.some((p) => p.kind === 'deposit' && Number(p.amount_paid || 0) > 0)) collected += Number(bk?.deposit_amount || 0);
    if (bk?.balance_settled_total != null) collected = Math.max(collected, Number(bk.balance_settled_total));
    else if (so.invoice && !pr.some((p) => p.kind === 'balance' && Number(p.amount_paid || 0) > 0)) collected = Math.max(collected, oldTotal);
    collected = round2(collected);
    breakdown = { cur, oldRate, newRate, oldTaxPct, newTaxPct, oldTax, newTax, oldTotal, newTotal, collected };
  }

  if (action === 'decline') {
    await admin.from('booking_change_requests').update({ status: 'declined', responded_at: nowISO } as unknown as never)
      .eq('booking_id', hit.booking_id).eq('status', 'pending');
    await notifyDj(admin, hit.dj_id, hit.booking_id, pending, 'declined', breakdown);
    return NextResponse.json({ ok: true, action: 'declined' });
  }

  // APPROVE — apply each pending change.
  const update: Record<string, unknown> = {};
  // Stamp each approved column so the card shows a "Host approved change" badge
  // (value prefixed 'approved:' to distinguish it from a plain notify-only edit).
  const marks: Record<string, string> = { ...(bk?.field_edits || {}) };
  for (const r of pending) {
    marks[r.target_col] = `approved:${nowISO}`;
  }
  for (const r of pending) {
    if (r.target_col === 'price') {
      const price = Number(r.target_raw);
      if (!Number.isFinite(price)) continue;
      update.counter_rate = price; // highest-priority agreed-rate field → becomes the total
      // Prefer a tax rate approved in this same batch, else the booking's current.
      const taxRow = pending.find((x) => x.target_col === 'tax_pct');
      const tp = taxRow ? Math.max(0, Number(taxRow.target_raw) || 0) : taxPct;
      if (tp > 0) {
        const tax = round2((price * tp) / 100);
        update.tax_amount = tax;
        update.total_with_tax = round2(price + tax);
      } else {
        update.tax_amount = 0;
        update.total_with_tax = price;
      }
    } else if (r.target_col === 'tax_pct') {
      // Tax approved: recompute on the base (a price approved in the same batch
      // is handled by the price branch above; otherwise use the current base).
      const priceRow = pending.find((x) => x.target_col === 'price');
      if (priceRow) continue; // price branch already recomputed with this tax
      const base = (bk?.tax_amount != null && bk?.total_with_tax != null)
        ? round2(Number(bk.total_with_tax) - Number(bk.tax_amount))
        : Number(bk?.counter_rate ?? 0);
      const tp = Math.max(0, Number(r.target_raw) || 0);
      const tax = round2((base * tp) / 100);
      update.tax_pct = tp;
      update.tax_amount = tax;
      update.total_with_tax = round2(base + tax);
    } else {
      update[r.target_col] = r.target_raw === '' ? null : r.target_raw;
    }
  }
  update.field_edits = marks;
  {
    const { error } = await admin.from('bookings').update(update as unknown as never).eq('id', hit.booking_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  }
  await admin.from('booking_change_requests').update({ status: 'approved', responded_at: nowISO } as unknown as never)
    .eq('booking_id', hit.booking_id).eq('status', 'pending');
  await notifyDj(admin, hit.dj_id, hit.booking_id, pending, 'approved', breakdown);
  return NextResponse.json({ ok: true, action: 'approved' });
}

interface Breakdown { cur: string; oldRate: number; newRate: number; oldTaxPct: number; newTaxPct: number; oldTax: number; newTax: number; oldTotal: number; newTotal: number; collected: number; }

// The price breakdown table (old → new), shared shape with the host approval
// email so the DJ sees exactly what was confirmed / declined.
function breakdownTable(b: Breakdown): string {
  const money = (n: number) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: b.cur }).format(n); } catch { return `$${n.toFixed(2)}`; } };
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const oldBal = Math.max(0, round2(b.oldTotal - b.collected));
  const newBal = round2(b.newTotal - b.collected);
  const row = (label: string, oldV: string | null, newV: string, strong = false) =>
    `<tr><td style="padding:7px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#111;${strong ? 'font-weight:700;' : ''}">${esc(label)}</td>`
    + `<td align="right" style="padding:7px 0;border-bottom:1px solid #f0f0f0;font-size:14px;">${oldV != null ? `<span style="color:#aaa;text-decoration:line-through;">${esc(oldV)}</span> ` : ''}<span style="color:#0a6f61;font-weight:700;">${esc(newV)}</span></td></tr>`;
  const rows = [
    row('Agreed rate', money(b.oldRate), money(b.newRate)),
    (b.oldTaxPct > 0 || b.newTaxPct > 0) ? row(`Tax (${b.newTaxPct}%)`, money(b.oldTax), money(b.newTax)) : '',
    row(b.newTaxPct > 0 ? 'Total (with tax)' : 'Total', money(b.oldTotal), money(b.newTotal), true),
    b.collected > 0 ? `<tr><td style="padding:7px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#111;">Received (paid)</td><td align="right" style="padding:7px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#111;font-weight:700;">${esc(money(b.collected))}</td></tr>` : '',
    row(b.collected > 0 ? 'New balance due' : 'Balance due', money(oldBal), money(newBal), true),
  ].join('');
  return `<p style="margin:16px 0 6px;color:#333;font-size:13px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;">Price breakdown</p><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`;
}

async function notifyDj(admin: SupabaseClient, djId: string, bookingId: string, rows: ReqRow[], outcome: 'approved' | 'declined', breakdown: Breakdown | null) {
  const email = await resolveUserEmail(djId);
  if (!email || !process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    // When a breakdown is shown, drop the raw price/tax rows from the plain list
    // so the numbers don't appear twice.
    const list = rows
      .filter((r) => !(breakdown && (r.target_col === 'price' || r.target_col === 'tax_pct')))
      .map((r) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#111;"><b>${esc(r.field)}</b><br><span style="color:#888;font-size:13px;">${esc(r.old_value || '—')}</span> → <span style="color:${outcome === 'approved' ? '#0a6f61' : '#b0791f'};font-weight:700;">${esc(r.new_value || '—')}</span></td></tr>`).join('');
    const listTable = list ? `<table width="100%" cellpadding="0" cellspacing="0">${list}</table>` : '';
    const brTable = breakdown ? breakdownTable(breakdown) : '';
    const link = `${SITE_URL}/upcoming-bookings`;
    let content: string;
    if (outcome === 'approved') {
      content = `<h1 style="margin:0 0 12px;font-size:20px;color:#111;">The host approved your changes</h1>
<p style="margin:0 0 6px;color:#333;font-size:15px;">These changes are now live on the booking:</p>
${listTable}${brTable}
<p style="margin:16px 0 6px;color:#333;font-size:15px;">If a contract is already in place, you can send an <b>updated contract</b> reflecting these changes.</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:16px auto 4px;"><tr><td style="background:#0a6f61;border-radius:6px;"><a href="${link}" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Open booking</a></td></tr></table>`;
    } else {
      content = `<h1 style="margin:0 0 12px;font-size:20px;color:#111;">The host declined your changes</h1>
<p style="margin:0 0 6px;color:#333;font-size:15px;">Nothing was changed. The booking stays as it was:</p>
${listTable}${brTable}
<table cellpadding="0" cellspacing="0" border="0" style="margin:16px auto 4px;"><tr><td style="background:#0a6f61;border-radius:6px;"><a href="${link}" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Open booking</a></td></tr></table>`;
    }
    content += `<p style="margin:20px 0 0;color:#999;font-size:11px;line-height:1.5;border-top:1px solid #eee;padding-top:12px;">${esc(LEGAL)}</p>`;
    await resend.emails.send({ from: FROM, to: email, subject: outcome === 'approved' ? 'Host approved your booking changes' : 'Host declined your booking changes', html: shell(content) });
  } catch { /* non-fatal */ }
}
