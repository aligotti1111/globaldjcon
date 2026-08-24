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
import { Resend } from 'resend';

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

  const admin = createAdminClient();
  const { data: pData } = await admin
    .from('booking_payments')
    .select('id, booking_id, kind, amount, amount_paid, currency, status, stripe_session_id')
    .eq('id', paymentId)
    .maybeSingle();
  const p = pData as PaymentRow | null;
  if (!p) return page('Not found', 'We couldn’t find this payment.');

  if (p.stripe_session_id === sessionId) return page('Payment received', 'Thanks! Your card payment is confirmed.');
  if (p.stripe_session_id) return page('Already recorded', 'A card payment was already recorded for this request.');

  const { data: bData } = await admin
    .from('bookings')
    .select('id, dj_id, requester_name, event_date, venue_name')
    .eq('id', p.booking_id)
    .maybeSingle();
  const b = bData as BookingRow | null;

  const { data: djData } = b?.dj_id
    ? await admin.from('users').select('stripe_connect_id, name').eq('id', b.dj_id).maybeSingle()
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

  const { data: updRows } = await admin
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

  // Tell the DJ (best-effort; a failure here never blocks the confirmation).
  if ((updRows as unknown[] | null)?.length && b?.dj_id && process.env.RESEND_API_KEY) {
    try {
      const djEmail = await resolveUserEmail(b.dj_id);
      if (djEmail) {
        const cur = p.currency || 'USD';
        const who = b.requester_name || 'Your client';
        const left = round2(Math.max(0, Number(p.amount) - nextPaid));
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Global DJ Connect <info@globaldjconnect.com>',
          to: djEmail,
          subject: `${who} paid ${money(received, cur)} by card`,
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111;"><h1 style="margin:0 0 10px;font-size:20px;">${who} paid ${money(received, cur)} by card</h1><p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#333;">Paid into your Stripe account${b.event_date ? ` for ${b.event_date}` : ''}${b.venue_name ? ` · ${b.venue_name}` : ''} — already confirmed, nothing to do. ${status === 'paid' ? 'This request is now fully settled.' : `<strong>${money(left, cur)} still due</strong> on this request.`}</p><p style="margin:0;font-size:13px;color:#888;">Stripe's fee (2.9% + 30¢) comes out before payout; your first payout can take 7–14 days.</p></div>`,
        });
      }
    } catch {
      /* notification is best-effort */
    }
  }

  return page('Payment received', `Thanks! Your ${money(received, p.currency || 'USD')} card payment is confirmed. A receipt will follow.`);
}
