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
import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';

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
      const inner = `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f5f7;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;"><tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" role="presentation" style="max-width:480px;width:100%;background:#ffffff;border:1px solid #ececf1;border-radius:16px;overflow:hidden;">
<tr><td style="background:#0b1f1a;padding:18px 28px;"><div style="color:#7ff3d0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;">Global DJ Connect</div></td></tr>
<tr><td style="padding:30px 28px 8px;text-align:center;">
<div style="width:54px;height:54px;border-radius:50%;background:#e7fbf3;color:#0a8f74;line-height:54px;font-size:26px;font-weight:700;margin:0 auto 14px;">&#10003;</div>
<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0a8f74;font-weight:700;">Payment received</div>
<div style="font-size:36px;font-weight:800;color:#0b1f1a;margin:8px 0 2px;letter-spacing:-.01em;">${money(received, cur)}</div>
<div style="font-size:14px;color:#6b7280;">paid by card</div>
</td></tr>
<tr><td style="padding:16px 28px 28px;text-align:center;"><p style="margin:0;font-size:14px;color:#333333;line-height:1.6;">Thank you! Your ${p.kind === 'deposit' ? 'deposit' : 'payment'}${b.event_date ? ` for <strong>${b.event_date}</strong>` : ''} is confirmed. A receipt is attached for your records.</p></td></tr>
</table>
<div style="color:#b4b8c0;font-size:11px;margin:14px 0 0;">© 2026 Global DJ Connect · globaldjconnect.com</div>
</td></tr></table>`;
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: FROM,
        to: hostEmail,
        subject: `Receipt — ${money(received, cur)}`,
        html: inner,
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
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Global DJ Connect <info@globaldjconnect.com>',
          to: djEmail,
          subject: `${who} paid ${money(received, cur)} by card`,
          html: `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f5f7;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;"><tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" role="presentation" style="max-width:480px;width:100%;background:#ffffff;border:1px solid #ececf1;border-radius:16px;overflow:hidden;">
<tr><td style="background:#0b1f1a;padding:18px 28px;"><div style="color:#7ff3d0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;">Global DJ Connect</div></td></tr>
<tr><td style="padding:30px 28px 6px;text-align:center;">
<div style="width:54px;height:54px;border-radius:50%;background:#e7fbf3;color:#0a8f74;line-height:54px;font-size:26px;font-weight:700;margin:0 auto 14px;">&#10003;</div>
<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0a8f74;font-weight:700;">Payment received</div>
<div style="font-size:36px;font-weight:800;color:#0b1f1a;margin:8px 0 2px;letter-spacing:-.01em;">${money(received, cur)}</div>
<div style="font-size:14px;color:#6b7280;">by card from ${who}</div>
</td></tr>
<tr><td style="padding:18px 28px 0;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#fafafa;border:1px solid #eeeeee;border-radius:12px;"><tr><td style="padding:14px 18px;font-size:14px;color:#333333;line-height:1.6;">
Paid straight into your Stripe account${b.event_date ? ` for <strong>${b.event_date}</strong>` : ''}${b.venue_name ? ` · ${b.venue_name}` : ''}.<br>
${status === 'paid' ? 'This request is now <strong style="color:#0a8f74;">fully settled</strong>.' : `<strong style="color:#c08a3e;">${money(left, cur)} still due</strong> on this request.`}
</td></tr></table>
</td></tr>
<tr><td style="padding:16px 28px 28px;">
<p style="margin:0;font-size:12px;color:#9aa0a6;line-height:1.6;">Already confirmed — nothing for you to do. Stripe's fee (2.9% + 30&cent;) comes out before payout; your first payout can take 7–14 days, then about 2 business days after that.</p>
</td></tr></table>
<div style="color:#b4b8c0;font-size:11px;margin:14px 0 0;">© 2026 Global DJ Connect · globaldjconnect.com</div>
</td></tr></table>`,
        });
      }
    } catch {
      /* notification is best-effort */
    }
  }

  return page('Payment received', `Thanks! Your ${money(received, p.currency || 'USD')} card payment is confirmed. A receipt will follow.`);
}
