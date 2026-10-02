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

// "Saturday, May 31, 2028" from a YYYY-MM-DD (noon-anchored so no TZ drift).
function fmtEventDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// "7:00 PM" from a "HH:MM" (or "HH:MM:SS") 24-hour string.
function fmtTime(t: string | null): string {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
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
  // How the host will get the money to the DJ:
  //   check → 'dropoff' (call/text number) or 'mail' (mailing address)
  //   cash  → 'meet' (exchange in person, call/text number) or 'office' (drop
  //           off at the office address). Day-of cash comes through as 'at-event'
  //           with no handoff — nothing to arrange, no host email.
  const handoffRaw = (body as { handoff?: unknown }).handoff;
  const handoff = handoffRaw === 'dropoff' ? 'dropoff'
    : handoffRaw === 'mail' ? 'mail'
    : handoffRaw === 'meet' ? 'meet'
    : handoffRaw === 'office' ? 'office'
    : null;

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
    // A 'sent' claim is a check mailed ahead OR cash dropped off ahead — store
    // the rail the client actually chose (fall back to check for older links).
    : { status: 'pending_confirmation', marked_sent_at: new Date().toISOString(), method: method || 'check', client_intent: 'pay_now' };
  const { error: upErr } = await db
    .from('booking_payments')
    .update(patch as unknown as never)
    .eq('id', paymentId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 502 });

  // Tell the DJ a check is coming.
  const { data: bData } = await admin
    .from('bookings')
    .select('dj_id, requester_name, event_date, start_time, end_time, venue_name, host_email, requester_id')
    .eq('id', p.booking_id)
    .maybeSingle();
  const b = bData as { dj_id: string | null; requester_name: string | null; event_date: string | null; start_time: string | null; end_time: string | null; venue_name: string | null; host_email: string | null; requester_id: string | null } | null;

  if (b?.dj_id && process.env.RESEND_API_KEY) {
    const djEmail = await resolveUserEmail(b.dj_id);
    if (djEmail) {
      const who = b.requester_name || 'Your client';
      const amt = money(Number(p.amount), p.currency || 'USD');
      const kindLabel = p.kind === 'balance' ? 'balance' : p.kind === 'deposit' ? 'deposit' : 'payment';
      // Event date/place/time now live in a details block at the top, so the
      // sentences no longer repeat the raw date and venue inline.
      const forWhen = '';
      const atVenue = '';
      // A clean "Event details" card: Date, Place, Time — only the rows we have.
      const evDate = fmtEventDate(b.event_date);
      const evStart = fmtTime(b.start_time);
      const evEnd = fmtTime(b.end_time);
      const evTime = evStart && evEnd ? `${evStart} – ${evEnd}` : evStart || '';
      const detailRow = (label: string, val: string) => val
        ? `<tr><td style="padding:4px 0;color:#888;font-size:12px;width:70px;vertical-align:top;">${label}</td><td style="padding:4px 0;color:#111;font-size:14px;font-weight:600;">${val}</td></tr>`
        : '';
      const detailsRows = `${detailRow('Date', evDate)}${detailRow('Place', b.venue_name || '')}${detailRow('Time', evTime)}`;
      const detailsBlock = detailsRows
        ? `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 18px;background:#f6f7f9;border:1px solid #e4e7eb;border-radius:10px;"><tr><td style="padding:14px 16px;"><table cellpadding="0" cellspacing="0" border="0" style="width:100%;">${detailsRows}</table></td></tr></table>`
        : '';
      // A deposit is paid AHEAD of the event, so an at-event confirm for a
      // deposit reads "before the event", not "at the event".
      const depositAhead = mode === 'at-event' && p.kind === 'deposit';
      // A 'sent' claim for cash is a drop-off (cash can't be mailed); for check
      // it's a mailed/handed-over check.
      const sentCash = mode !== 'at-event' && method === 'cash';
      const heading = depositAhead
        ? `${who} will pay their deposit before the event`
        : mode === 'at-event'
        ? `${who} will pay at the event`
        : sentCash
        ? `${who} will drop off cash`
        : `${who} is mailing a check`;
      // "in cash" / "by check" when the client's link told us which; otherwise
      // the generic "by cash or check".
      const payWord = method === 'cash' ? 'in cash' : method === 'check' ? 'by check' : 'by cash or check';
      const bodyLines = depositAhead
        ? `<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">${who} has confirmed they'll pay their deposit of <strong>${amt}</strong> ${payWord} before the event${forWhen}${atVenue}. Arrange to collect it ahead of time, then <strong>Mark Paid</strong> in your dashboard to auto-send the receipt.</p>`
        : mode === 'at-event'
        ? `<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">${who} has confirmed payment will be paid ${payWord} at the event${forWhen}${atVenue}. Nothing to do now; collect it at the event and <strong>Mark Paid</strong> in your dashboard to auto-send the receipt.</p>`
        : sentCash
        ? `<p style="margin:0 0 8px;color:#333;font-size:15px;line-height:1.6;">${who} has confirmed they'll drop off their ${kindLabel} of <strong>${amt}</strong> in cash${forWhen}${atVenue}.</p>
<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">Arrange the hand-off — it isn't marked paid until you receive it and confirm.</p>`
        : `<p style="margin:0 0 8px;color:#333;font-size:15px;line-height:1.6;">They've marked their ${kindLabel} of <strong>${amt}</strong> as sent by check${forWhen}${atVenue}.</p>
<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">Watch for the envelope — it isn't marked paid until you confirm what actually arrives.</p>`;
      const content = `<h1 style="margin:0 0 14px;font-size:20px;color:#111;">${heading}</h1>
${detailsBlock}${bodyLines}
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#0a6f61;border-radius:6px;">
<a href="${SITE_URL}/upcoming-bookings" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Review booking</a>
</td></tr></table>`;
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({ from: FROM, to: djEmail, subject: depositAhead ? `${who} will pay their deposit before the event — ${amt}` : mode === 'at-event' ? `${who} will pay at the event — ${amt}` : sentCash ? `${who} will drop off cash — ${amt}` : `${who} is mailing a check — ${amt}`, html: shell(content) });
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
      const chk = methods.find((x) => x?.type === 'check') as { handle?: string; contact?: string; checkPhone?: string } | undefined;
      if (chk?.handle) {
        const who = b.requester_name?.trim() || 'there';
        const memo = checkMemo(b.event_date, b.venue_name, referenceCode(p.booking_id, p.kind));
        const addrLines = chk.contact ? splitMailAddress(chk.contact) : [];
        const chkPhone = chk.checkPhone?.trim() || null;
        const payableBlock = `<p style="margin:0 0 2px;color:#666;font-size:13px;">Make it payable to:</p>
<p style="margin:0 0 12px;font-size:16px;color:#111;">${chk.handle}</p>
${memo ? `<p style="margin:0 0 2px;color:#666;font-size:13px;">Include with your check:</p>
<p style="margin:0 0 14px;font-family:monospace;font-size:14px;color:#111;">${memo}</p>` : ''}`;
        // Drop-off → give them the call/text number. Mail → give the address.
        const isDropoff = handoff === 'dropoff';
        const subject = isDropoff ? 'Dropping off your check' : 'Where to send your check';
        const content = isDropoff
          ? `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Dropping off your check</h1>
<p style="margin:0 0 14px;color:#333;font-size:15px;line-height:1.6;">Hi ${who}, here are the details for your check.</p>
${payableBlock}
${chkPhone
  ? `<p style="margin:0 0 2px;color:#666;font-size:13px;">Arrange the drop-off:</p>
<p style="margin:0 0 14px;font-size:15px;color:#111;">Call or text <strong>${chkPhone}</strong></p>`
  : `<p style="margin:0 0 14px;color:#333;font-size:14px;">Reach out to your DJ to arrange dropping it off.</p>`}
<p style="margin:0;color:#888;font-size:13px;line-height:1.6;">Your ${kindLabelFor(p.kind)} is marked paid once your DJ receives and confirms the check.</p>`
          : `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Where to send your check</h1>
<p style="margin:0 0 14px;color:#333;font-size:15px;line-height:1.6;">Hi ${who}, please mail your check to the address below.</p>
${payableBlock}
${addrLines.length ? `<p style="margin:0 0 2px;color:#666;font-size:13px;">Mail to:</p>
<p style="margin:0 0 12px;font-size:15px;color:#111;line-height:1.45;">${addrLines.join('<br>')}</p>` : ''}
<p style="margin:0;color:#888;font-size:13px;line-height:1.6;">Your ${kindLabelFor(p.kind)} is marked paid once your DJ receives and confirms the check.</p>`;
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({ from: FROM, to, subject, html: shell(content) });
        } catch { /* non-fatal */ }
      }
    }
  }

  // CASH chosen → email the HOST how to get it to the DJ, with the price:
  //   'meet'   → the call/text number to arrange handing it over in person
  //   'office' → the office drop-off address (+ hours)
  // Day-of cash ('at-event') needs no arrangement, so it gets no logistics email.
  if (method === 'cash' && (handoff === 'meet' || handoff === 'office') && b?.dj_id && process.env.RESEND_API_KEY) {
    const to = b.host_email?.trim() || (b.requester_id ? await resolveUserEmail(b.requester_id) : null);
    if (to) {
      const { data: uData } = await admin.from('users').select('name, payment_methods').eq('id', b.dj_id).maybeSingle();
      const djName = (uData as { name?: string | null } | null)?.name?.trim() || null;
      const raw = (uData as { payment_methods?: unknown } | null)?.payment_methods;
      const methods = Array.isArray(raw) ? (raw as Array<{ type?: string; handle?: string; smsOk?: boolean; dropoffAddress?: string; dropoffHours?: string }>) : [];
      const csh = methods.find((x) => x?.type === 'cash');
      const who = b.requester_name?.trim() || 'there';
      const amt = money(Number(p.amount), p.currency || 'USD');
      const kindLabel = kindLabelFor(p.kind);
      const amountBlock = `<p style="margin:0 0 2px;color:#666;font-size:13px;">Amount due:</p>
<p style="margin:0 0 14px;font-size:18px;color:#111;font-weight:700;">${amt}</p>`;
      // Subject: "Payment Instructions | <event date>".
      const subjDate = fmtEventDate(b.event_date);
      const subject = `Payment Instructions${subjDate ? ` | ${subjDate}` : ''}`;

      let content: string;
      if (handoff === 'meet') {
        const phone = csh?.handle?.trim() || null;
        const verb = csh?.smsOk ? 'Call or text' : 'Call';
        content = `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Paying your ${kindLabel} in cash</h1>
<p style="margin:0 0 14px;color:#333;font-size:15px;line-height:1.6;">Hi ${who}, you&rsquo;ll hand your cash to your DJ in person. Here are the details.</p>
${amountBlock}
${phone
  ? `<p style="margin:0 0 2px;color:#666;font-size:13px;">Arrange the hand-off:</p>
<p style="margin:0 0 14px;font-size:15px;color:#111;">${verb} <strong>${phone}</strong></p>`
  : `<p style="margin:0 0 14px;color:#333;font-size:14px;">Reach out to your DJ to arrange handing it over.</p>`}
<p style="margin:0;color:#888;font-size:13px;line-height:1.6;">Your ${kindLabel} is marked paid once your DJ receives and confirms the cash.</p>`;
      } else {
        const addrLines = csh?.dropoffAddress ? splitMailAddress(csh.dropoffAddress) : [];
        const hours = csh?.dropoffHours?.trim() || null;
        content = `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Where to drop off your ${kindLabel}</h1>
<p style="margin:0 0 14px;color:#333;font-size:15px;line-height:1.6;">Hi ${who}, please drop the ${kindLabel} at the office address below.</p>
${amountBlock}
${addrLines.length ? `<p style="margin:0 0 2px;color:#666;font-size:13px;">Drop-off location:</p>
<p style="margin:0 0 ${hours ? '6' : '14'}px;font-size:15px;color:#111;line-height:1.45;">${djName ? `<strong>${djName}</strong><br>` : ''}${addrLines.join('<br>')}</p>` : ''}
${hours ? `<p style="margin:0 0 14px;font-size:14px;color:#333;">${hours}</p>` : ''}
<p style="margin:0;color:#888;font-size:13px;line-height:1.6;">Your ${kindLabel} is marked paid once your DJ receives and confirms the cash.</p>`;
      }
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({ from: FROM, to, subject, html: shell(content) });
      } catch { /* non-fatal */ }
    }
  }

  return NextResponse.json({ ok: true });
}

function kindLabelFor(kind: string): string {
  return kind === 'balance' ? 'balance' : kind === 'deposit' ? 'deposit' : 'payment';
}
