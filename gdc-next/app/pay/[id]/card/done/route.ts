// Return leg of the public card flow. Stripe redirects here with the session
// id after checkout. We retrieve the session ON the DJ's connected account,
// confirm it's ours and paid, then mark the payment row settled — the same
// logic as the authenticated verify-checkout, but public (no login) and keyed
// solely on the Stripe session, which is the trust anchor. Idempotent: the
// partial unique index on stripe_session_id + the `.is(null)` guard make a
// refresh or double-open a no-op.
import { NextResponse } from 'next/server';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/server';
import { buildBookingDocAttachment } from '@/lib/receiptDocs';
import { bookingProgressBox } from '@/lib/bookingProgressBox';
import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';

// The SAME branded email shell every other Global DJ Connect email uses
// (600px, black header with the Bebas wordmark, white body, grey footer). Kept
// as a local copy — the payments route and send-email route each carry their
// own copy of this identical shell; the money logic that matters is shared via
// lib/paymentMethods, so these wrappers can't disagree on anything substantive.
function shell(content: string): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000000;padding:24px 32px;" align="center">
<div style="font-family:'Bebas Neue',Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div>
</td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;">
<p style="margin:0;color:#888;font-size:11px;line-height:1.6;">© ${new Date().getFullYear()} Global DJ Connect · <a href="${SITE_URL}" style="color:#888;">globaldjconnect.com</a></p>
</td></tr></table>
</td></tr></table>`;
}

export const dynamic = 'force-dynamic';

const round2 = (n: number) => Number(n.toFixed(2));
function money(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function page(title: string, msg: string) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#0b0b12;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;"><div style="max-width:440px;padding:36px 28px;text-align:center;"><div style="width:56px;height:56px;border-radius:50%;background:rgba(99,91,255,.15);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:26px;">✓</div><div style="font-size:22px;font-weight:800;margin:0 0 10px;">${title}</div><p style="color:#c9c9d6;font-size:15px;line-height:1.6;margin:0 0 24px;">${msg}</p><a href="https://globaldjconnect.com" style="display:inline-block;background:#635BFF;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:8px;">Global DJ Connect</a></div></body></html>`;
  return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

interface PaymentRow {
  id: string;
  booking_id: string;
  kind: string;
  amount: number;
  amount_paid: number | null;
  currency: string | null;
  status: string;
  stripe_session_id: string | null;
}
interface BookingRow {
  id: string;
  dj_id: string | null;
  requester_id: string | null;
  host_email: string | null;
  requester_name: string | null;
  event_date: string | null;
  venue_name: string | null;
}
interface DjRow {
  stripe_connect_id: string | null;
  name: string | null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: paymentId } = await params;
  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('e');
  const sessionId = (url.searchParams.get('session_id') || '').trim();

  if (state === 'settled') return page('Already paid', 'This request has already been paid — nothing more to do.');
  if (state === 'cancelled') return page('Payment cancelled', 'No charge was made. Reopen the invoice email if you’d like to try again.');
  if (err === 'notready') return page('Card not available', 'This DJ isn’t set up for card payments right now. Reply to the invoice to arrange another method.');
  if (err) return page('Something went wrong', 'We couldn’t start the checkout. Please reopen the invoice email and try again.');
  if (!sessionId.startsWith('cs_')) return page('Missing details', 'This link is incomplete. Please reopen the invoice email.');

  // Generated Supabase types omit booking_payments, so use a generically-typed
  // client — same pattern as the payments route. Service-role; no RLS.
  const db = createAdminClient() as unknown as SupabaseClient;
  const { data: pData } = await db
    .from('booking_payments')
    .select('id, booking_id, kind, amount, amount_paid, currency, status, stripe_session_id')
    .eq('id', paymentId)
    .maybeSingle();
  const p = pData as PaymentRow | null;
  if (!p) return page('Not found', 'We couldn’t find this payment.');

  if (p.stripe_session_id === sessionId) return page('Payment received', 'Thanks! Your card payment is confirmed.');
  if (p.stripe_session_id) return page('Already recorded', 'A card payment was already recorded for this request.');

  const { data: bData } = await db
    .from('bookings')
    .select('id, dj_id, requester_id, host_email, requester_name, event_date, venue_name')
    .eq('id', p.booking_id)
    .maybeSingle();
  const b = bData as BookingRow | null;

  const { data: djData } = b?.dj_id
    ? await db.from('users').select('stripe_connect_id, name').eq('id', b.dj_id).maybeSingle()
    : { data: null };
  const dj = djData as unknown as DjRow | null;
  if (!dj?.stripe_connect_id) return page('Payment received', 'Thanks! Your payment is being processed.');

  let session;
  try {
    const stripe = getStripe();
    session = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: dj.stripe_connect_id });
  } catch {
    return page('Couldn’t confirm yet', 'Your card may have been charged. We’ll confirm shortly — please don’t pay again.');
  }

  if (session.metadata?.payment_id !== p.id) return page('Mismatch', 'This checkout doesn’t match the request.');
  if (session.payment_status !== 'paid') return page('Not completed', 'This checkout wasn’t completed. Reopen the invoice to try again.');

  const received = round2((session.amount_total ?? 0) / 100);
  const nextPaid = round2(Number(p.amount_paid || 0) + received);
  const status = nextPaid >= Number(p.amount) ? 'paid' : 'partial';

  const { data: updRows } = await db
    .from('booking_payments')
    .update({
      amount_paid: nextPaid,
      status,
      method: 'card',
      client_intent: 'pay_now',
      stripe_session_id: sessionId,
      confirmed_at: new Date().toISOString(),
    } as unknown as never)
    .eq('id', paymentId)
    .is('stripe_session_id', null)
    .select('id');

  const applied = ((updRows as unknown[] | null)?.length ?? 0) > 0;
  const hostEmail = b?.host_email || (b?.requester_id ? await resolveUserEmail(b.requester_id) : null);

  // Receipt to the host (best-effort). Same branded receipt PDF the app sends
  // for every other paid rail — a card payer should get one too.
  if (applied && b && hostEmail && process.env.RESEND_API_KEY) {
    try {
      const cur = p.currency || 'USD';
      const receiptAtt = await buildBookingDocAttachment(db, {
        docKind: 'receipt',
        bookingId: p.booking_id,
        djId: b.dj_id || '',
        currency: cur,
        paymentKind: p.kind as 'deposit' | 'balance' | 'other',
        receivedNow: received,
        method: 'card',
        paidToDate: nextPaid,
        clientEmail: hostEmail,
      });
      // Same content shape as the manual 'confirm' receipt in the payments
      // route: an h1 + line, wrapped in the shared shell, with the booking
      // progress box appended — so a card receipt reads identically to every
      // other paid-rail receipt.
      const outstanding = round2(Math.max(0, Number(p.amount) - nextPaid));
      const kindNoun = p.kind === 'balance' ? 'balance' : p.kind === 'deposit' ? 'deposit' : 'payment';
      const content = status === 'paid'
        ? `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Payment received — ${money(nextPaid, cur)}</h1>
<p style="margin:0;color:#333;font-size:15px;line-height:1.6;">Thanks! Your ${kindNoun} is settled${b.event_date ? ` for ${b.event_date}` : ''}. A receipt is attached.</p>`
        : `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Partial payment received</h1>
<p style="margin:0;color:#333;font-size:15px;line-height:1.6;">${money(nextPaid, cur)} of ${money(Number(p.amount), cur)} received — <strong>${money(outstanding, cur)} still due</strong>. A receipt is attached.</p>`;
      // The shared booking progress tracker ('' for club bookings). The ledger
      // is already updated above, so it reflects this payment.
      const progressBox = await bookingProgressBox(p.booking_id);
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: FROM,
        to: hostEmail,
        subject: `Receipt — ${money(received, cur)}`,
        html: shell(content + (progressBox ? `<div style="margin-top:24px;">${progressBox}</div>` : '')),
        attachments: receiptAtt ? [receiptAtt] : undefined,
      });
    } catch {
      /* receipt is best-effort */
    }
  }

  // Tell the DJ (best-effort; a failure here never blocks the confirmation).
  const djId = b?.dj_id;
  if (applied && b && djId && process.env.RESEND_API_KEY) {
    try {
      const djEmail = await resolveUserEmail(djId);
      if (djEmail) {
        const cur = p.currency || 'USD';
        const who = b.requester_name || 'Your client';
        const left = round2(Math.max(0, Number(p.amount) - nextPaid));
        const djContent = `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">${who} paid ${money(received, cur)} by card</h1>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="min-width:100%;background:#fafafa;border:1px solid #ededed;border-radius:10px;margin:0 0 16px;">
<tr><td style="padding:14px 18px;font-size:15px;color:#333;line-height:1.6;">
Paid straight into your Stripe account${b.event_date ? ` for <strong>${b.event_date}</strong>` : ''}${b.venue_name ? ` · ${b.venue_name}` : ''}.<br>
${status === 'paid' ? 'This request is now <strong style="color:#0a8f74;">fully settled</strong>.' : `<strong style="color:#c08a3e;">${money(left, cur)} still due</strong> on this request.`}
</td></tr></table>
<p style="margin:0;color:#999;font-size:12px;line-height:1.6;">Already confirmed — nothing for you to do. Stripe's fee (2.9% + 30&cent;) comes out before payout; your first payout can take 7–14 days, then about 2 business days after that.</p>`;
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: FROM,
          to: djEmail,
          subject: `${who} paid ${money(received, cur)} by card`,
          html: shell(djContent),
        });
      }
    } catch {
      /* notification is best-effort */
    }
  }

  return page('Payment received', `Thanks! Your ${money(received, p.currency || 'USD')} card payment is confirmed. A receipt will follow.`);
}
