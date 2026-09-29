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
import { checkMemo, referenceCode, splitMailAddress } from '@/lib/paymentMethods';
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
  let body: { paymentId?: unknown; mode?: unknown; method?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const paymentId = typeof body.paymentId === 'string' && body.paymentId ? body.paymentId : null;
  if (!paymentId) return NextResponse.json({ error: 'Missing paymentId' }, { status: 400 });
  // 'sent'     — a check was mailed ahead (deposit); flag it as claimed-sent.
  // 'at-event' — cash/check will be handed over at the event (balance); record
  //              intent only, the DJ collects on the day.
  const mode = (body as { mode?: unknown }).mode === 'at-event' ? 'at-event' : 'sent';
  // Which method the client picked for at-event, so the DJ's heads-up says
  // "in cash" or "by check" instead of the generic "cash or check". Null when
  // the client came from a link that didn't specify.
  const method = body.method === 'cash' ? 'cash' : body.method === 'check' ? 'check' : null;

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
    // Record the chosen rail (cash/check) AND when the host confirmed, so the
    // DJ's dashboard can show "Pending/Cash" (or /Check) and the confirmation
    // date under pricing. Method is only stored when the client's link told us
    // which — a generic at-event link leaves it null.
    ? { client_intent: 'pay_at_event', marked_sent_at: new Date().toISOString(), ...(method ? { method } : {}) }
    : { status: 'pending_confirmation', marked_sent_at: new Date().toISOString(), method: 'check', client_intent: 'pay_now' };
  const { error: upErr } = await db
    .from('booking_payments')
    .update(patch as unknown as never)
    .eq('id', paymentId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 502 });

  // Tell the DJ a check is coming.
  const { data: bData } = await admin
    .from('bookings')
    .select('dj_id, requester_name, event_date, venue_name, host_email, requester_id')
    .eq('id', p.booking_id)
    .maybeSingle();
  const b = bData as { dj_id: string | null; requester_name: string | null; event_date: string | null; venue_name: string | null; host_email: string | null; requester_id: string | null } | null;

  if (b?.dj_id && process.env.RESEND_API_KEY) {
    const djEmail = await resolveUserEmail(b.dj_id);
    if (djEmail) {
      const who = b.requester_name || 'Your client';
      const amt = money(Number(p.amount), p.currency || 'USD');
      const kindLabel = p.kind === 'balance' ? 'balance' : p.kind === 'deposit' ? 'deposit' : 'payment';
      const forWhen = b.event_date ? ` for the ${b.event_date} event` : '';
      const atVenue = b.venue_name ? ` at ${b.venue_name}` : '';
      // A deposit is paid AHEAD of the event, so an at-event confirm for a
      // deposit reads "before the event", not "at the event".
      const depositAhead = mode === 'at-event' && p.kind === 'deposit';
      const heading = depositAhead
        ? `${who} will pay their deposit before the event`
        : mode === 'at-event'
        ? `${who} will pay at the event`
        : `${who} is mailing a check`;
      // "in cash" / "by check" when the client's link told us which; otherwise
      // the generic "by cash or check".
      const payWord = method === 'cash' ? 'in cash' : method === 'check' ? 'by check' : 'by cash or check';
      const bodyLines = depositAhead
        ? `<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">${who} has confirmed they'll pay their deposit of <strong>${amt}</strong> ${payWord} before the event${forWhen}${atVenue}. Arrange to collect it ahead of time, then <strong>Mark Paid</strong> in your dashboard to auto-send the receipt.</p>`
        : mode === 'at-event'
        ? `<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">${who} has confirmed payment will be paid ${payWord} at the event${forWhen}${atVenue}. Nothing to do now; collect it at the event and <strong>Mark Paid</strong> in your dashboard to auto-send the receipt.</p>`
        : `<p style="margin:0 0 8px;color:#333;font-size:15px;line-height:1.6;">They've marked their ${kindLabel} of <strong>${amt}</strong> as sent by check${forWhen}${atVenue}.</p>
<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">Watch for the envelope — it isn't marked paid until you confirm what actually arrives.</p>`;
      const content = `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">${heading}</h1>
${bodyLines}
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#0a6f61;border-radius:6px;">
<a href="${SITE_URL}/upcoming-bookings" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Review booking</a>
</td></tr></table>`;
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({ from: FROM, to: djEmail, subject: depositAhead ? `${who} will pay their deposit before the event — ${amt}` : mode === 'at-event' ? `${who} will pay at the event — ${amt}` : `${who} is mailing a check — ${amt}`, html: shell(content) });
      } catch { /* non-fatal */ }
    }
  }

  // CHECK chosen → also email the HOST where to send it: payable-to name, the
  // DJ's mailing address, and the memo (event date · venue · booking code) so
  // the DJ can match the envelope to this booking.
  if (method === 'check' && b?.dj_id && process.env.RESEND_API_KEY) {
    const to = b.host_email?.trim() || (b.requester_id ? await resolveUserEmail(b.requester_id) : null);
    if (to) {
      const { data: uData } = await admin.from('users').select('payment_methods').eq('id', b.dj_id).maybeSingle();
      const raw = (uData as { payment_methods?: unknown } | null)?.payment_methods;
      const methods = Array.isArray(raw) ? (raw as Array<{ type?: string; handle?: string; contact?: string }>) : [];
      const chk = methods.find((x) => x?.type === 'check');
      if (chk?.handle) {
        const who = b.requester_name?.trim() ? b.requester_name.trim().split(' ')[0] : 'there';
        const memo = checkMemo(b.event_date, b.venue_name, referenceCode(p.booking_id, p.kind));
        const addrLines = chk.contact ? splitMailAddress(chk.contact) : [];
        const content = `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Where to send your check</h1>
<p style="margin:0 0 14px;color:#333;font-size:15px;line-height:1.6;">Hi ${who}, please mail your check to the address below.</p>
<p style="margin:0 0 2px;color:#666;font-size:13px;">Make it payable to:</p>
<p style="margin:0 0 12px;font-size:16px;color:#111;">${chk.handle}</p>
${addrLines.length ? `<p style="margin:0 0 2px;color:#666;font-size:13px;">Mail to:</p>
<p style="margin:0 0 12px;font-size:15px;color:#111;line-height:1.45;">${addrLines.join('<br>')}</p>` : ''}
${memo ? `<p style="margin:0 0 2px;color:#666;font-size:13px;">Include with your check:</p>
<p style="margin:0 0 14px;font-family:monospace;font-size:14px;color:#111;">${memo}</p>` : ''}
<p style="margin:0;color:#888;font-size:13px;line-height:1.6;">Your ${kindLabelFor(p.kind)} is marked paid once your DJ receives and confirms the check.</p>`;
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({ from: FROM, to, subject: 'Where to send your check', html: shell(content) });
        } catch { /* non-fatal */ }
      }
    }
  }

  return NextResponse.json({ ok: true });
}

function kindLabelFor(kind: string): string {
  return kind === 'balance' ? 'balance' : kind === 'deposit' ? 'deposit' : 'payment';
}
