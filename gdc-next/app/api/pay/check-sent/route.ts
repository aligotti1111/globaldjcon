// POST /api/pay/check-sent  { paymentId }
//
// Public (no login). A client who received a deposit/balance email and is
// MAILING a check taps "Let your DJ know" — this flags the payment as
// "client says sent (check)" and emails the DJ so an envelope isn't a surprise
// weeks later. Keyed by the unguessable payment UUID, exactly like the Venmo
// hand-off page: whoever holds the emailed link can already see the amount.
//
// It only ever records a CLAIM (status pending_confirmation). It never marks
// the money received — only the DJ confirming does that.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { Resend } from 'resend';

export const runtime = 'nodejs';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';

function money(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch { return `$${n.toFixed(2)}`; }
}

function shell(content: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000;padding:24px 32px;" align="center"><div style="font-family:Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div></td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;"><p style="margin:0;color:#888;font-size:11px;">© ${new Date().getFullYear()} Global DJ Connect · globaldjconnect.com</p></td></tr>
</table></td></tr></table>`;
}

export async function POST(req: Request) {
  let body: { paymentId?: unknown; mode?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const paymentId = typeof body.paymentId === 'string' && body.paymentId ? body.paymentId : null;
  if (!paymentId) return NextResponse.json({ error: 'Missing paymentId' }, { status: 400 });
  // 'sent'     — a check was mailed ahead (deposit); flag it as claimed-sent.
  // 'at-event' — cash/check will be handed over at the event (balance); record
  //              intent only, the DJ collects on the day.
  const mode = (body as { mode?: unknown }).mode === 'at-event' ? 'at-event' : 'sent';

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  const { data: pData } = await db
    .from('booking_payments')
    .select('id, booking_id, kind, amount, currency, status')
    .eq('id', paymentId)
    .maybeSingle();
  const p = pData as unknown as { id: string; booking_id: string; kind: string; amount: number; currency: string | null; status: string } | null;
  if (!p) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });

  // Already settled — nothing to claim.
  if (p.status === 'paid' || p.status === 'waived') {
    return NextResponse.json({ ok: true, alreadySettled: true });
  }

  // Record the claim. 'at-event' is an INTENT only (nothing sent yet — the DJ
  // collects on the day); 'sent' flags a mailed check as claimed-sent. Neither
  // ever marks 'paid' — that's the DJ's call alone.
  const patch = mode === 'at-event'
    ? { client_intent: 'pay_at_event' }
    : { status: 'pending_confirmation', marked_sent_at: new Date().toISOString(), method: 'check', client_intent: 'pay_now' };
  const { error: upErr } = await db
    .from('booking_payments')
    .update(patch as unknown as never)
    .eq('id', paymentId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 502 });

  // Tell the DJ a check is coming.
  const { data: bData } = await admin
    .from('bookings')
    .select('dj_id, requester_name, event_date, venue_name')
    .eq('id', p.booking_id)
    .maybeSingle();
  const b = bData as { dj_id: string | null; requester_name: string | null; event_date: string | null; venue_name: string | null } | null;

  if (b?.dj_id && process.env.RESEND_API_KEY) {
    const djEmail = await resolveUserEmail(b.dj_id);
    if (djEmail) {
      const who = b.requester_name || 'Your client';
      const amt = money(Number(p.amount), p.currency || 'USD');
      const kindLabel = p.kind === 'balance' ? 'balance' : p.kind === 'deposit' ? 'deposit' : 'payment';
      const forWhen = b.event_date ? ` for the ${b.event_date} event` : '';
      const atVenue = b.venue_name ? ` at ${b.venue_name}` : '';
      const heading = mode === 'at-event'
        ? `${who} will pay at the event`
        : `${who} is mailing a check`;
      const bodyLines = mode === 'at-event'
        ? `<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">They plan to pay their ${kindLabel} of <strong>${amt}</strong> in person${forWhen}${atVenue} — by cash or check on the day. Nothing to do now; collect it at the event and confirm what you receive.</p>`
        : `<p style="margin:0 0 8px;color:#333;font-size:15px;line-height:1.6;">They've marked their ${kindLabel} of <strong>${amt}</strong> as sent by check${forWhen}${atVenue}.</p>
<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">Watch for the envelope — it isn't marked paid until you confirm what actually arrives.</p>`;
      const content = `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">${heading}</h1>
${bodyLines}
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#0a6f61;border-radius:6px;">
<a href="${SITE_URL}/upcoming-bookings" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Review booking</a>
</td></tr></table>`;
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({ from: FROM, to: djEmail, subject: mode === 'at-event' ? `${who} will pay at the event — ${amt}` : `${who} is mailing a check — ${amt}`, html: shell(content) });
      } catch { /* non-fatal */ }
    }
  }

  return NextResponse.json({ ok: true });
}
