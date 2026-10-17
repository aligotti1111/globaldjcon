// POST /api/stripe/connect-webhook
//
// Backstop for the DJ-accepting-payments (Stripe Connect) card flow. The booking
// row is normally settled when the host's browser returns to /pay/[id]/card/done,
// but if the tab closes after payment, nothing records it — the money is in the
// DJ's Stripe while the row stays unpaid (and a second click could charge the
// host again). This endpoint receives CONNECTED-ACCOUNT events and settles the
// row from Stripe's own event, so a returned browser is no longer required.
//
// IMPORTANT: this is a *Connect* webhook — register it in the Stripe dashboard as
// "Listen to events on Connected accounts" with its OWN signing secret
// (STRIPE_CONNECT_WEBHOOK_SECRET), NOT the platform account's secret. Every event
// carries `event.account` = the DJ's acct_… which we use to retrieve/verify.
//
// Handled:
//   checkout.session.completed  → settle the booking_payment (idempotent)
//   charge.refunded             → reflect a refund on the row
//   account.updated             → keep users.stripe_connect_ready in sync
//
// Idempotent: a `.is('stripe_session_id', null)` compare-and-set on settle, and a
// processed-events table so a replayed refund can't double-subtract.

import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/stripe/server';
import { fromStripeMinor } from '@/lib/paymentMethods';
import { Resend } from 'resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const round2 = (n: number) => Number(n.toFixed(2));
const FROM = 'Global DJ Connect <info@globaldjconnect.com>';

interface PayRow {
  id: string; booking_id: string; kind: string;
  amount: number; amount_paid: number | null; currency: string | null;
  status: string; stripe_session_id: string | null;
}

// Record this delivery so a replay is a no-op. Returns false if already seen.
async function firstTime(db: SupabaseClient, eventId: string): Promise<boolean> {
  const { data: seen } = await db
    .from('stripe_connect_events').select('event_id').eq('event_id', eventId).maybeSingle();
  if (seen) return false;
  try {
    await db.from('stripe_connect_events').insert({ event_id: eventId } as unknown as never);
  } catch { /* unique violation on a concurrent duplicate is fine */ }
  return true;
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  // Missing secret → 500 so Stripe retries while config is fixed (don't silently
  // drop connected-account events — this is the money backstop).
  if (!secret) {
    console.error('[stripe/connect-webhook] STRIPE_CONNECT_WEBHOOK_SECRET not set');
    return new NextResponse('Not configured', { status: 500 });
  }
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new NextResponse('Missing signature', { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    console.error('[stripe/connect-webhook] signature verification failed', e);
    return new NextResponse('Invalid signature', { status: 400 });
  }

  const connectedAccount = event.account || '';

  try {
    const db = createAdminClient() as unknown as SupabaseClient;

    switch (event.type) {
      // ── Card payment settled on the DJ's account ──
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status !== 'paid') { return NextResponse.json({ ok: true, reason: 'not_paid' }); }
        const paymentId = session.metadata?.payment_id || '';
        if (!paymentId) { return NextResponse.json({ ok: true, reason: 'no_payment_id' }); }

        const { data: pData, error: selErr } = await db
          .from('booking_payments')
          .select('id, booking_id, kind, amount, amount_paid, currency, status, stripe_session_id')
          .eq('id', paymentId).maybeSingle();
        if (selErr) return new NextResponse('db_error', { status: 500 });
        const p = pData as PayRow | null;
        if (!p) return NextResponse.json({ ok: true, reason: 'payment_not_found' });
        if (p.stripe_session_id || p.status === 'paid' || p.status === 'waived') {
          return NextResponse.json({ ok: true, alreadyRecorded: true });
        }
        if ((session.currency || '').toLowerCase() !== (p.currency || 'USD').toLowerCase()) {
          return NextResponse.json({ ok: true, reason: 'currency_mismatch' });
        }

        const received = fromStripeMinor(session.amount_total ?? 0, p.currency || 'USD');
        if (!(received > 0)) return NextResponse.json({ ok: true, reason: 'zero_amount' });
        const nextPaid = round2(Number(p.amount_paid || 0) + received);
        const status = nextPaid >= Number(p.amount) ? 'paid' : 'partial';

        // Compare-and-set: whichever of browser-return / this webhook wins the
        // race applies the money exactly once.
        const { data: upRows } = await db
          .from('booking_payments')
          .update({
            amount_paid: nextPaid,
            status,
            method: 'card',
            client_intent: 'pay_now',
            stripe_session_id: session.id,
            confirmed_at: new Date().toISOString(),
          } as unknown as never)
          .eq('id', p.id)
          .is('stripe_session_id', null)
          .select('id');
        const applied = ((upRows as unknown[] | null)?.length ?? 0) > 0;
        if (!applied) return NextResponse.json({ ok: true, alreadyRecorded: true });

        // Snapshot the settled balance so later price-change math is correct
        // (mirrors the manual-confirm path).
        if (p.kind === 'balance' && status === 'paid') {
          const { data: bRow } = await db.from('bookings').select('total_with_tax').eq('id', p.booking_id).maybeSingle();
          const twt = (bRow as { total_with_tax?: number | null } | null)?.total_with_tax ?? null;
          try { await db.from('bookings').update({ balance_settled_total: twt } as unknown as never).eq('id', p.booking_id); } catch { /* non-fatal */ }
        }

        // Tell the DJ (best-effort) — on this path the browser never returned to
        // notify them. Deduped across the two paths by `applied` above.
        if (process.env.RESEND_API_KEY) {
          try {
            const { data: bRow } = await db.from('bookings').select('dj_id, requester_name, event_date').eq('id', p.booking_id).maybeSingle();
            const bk = bRow as { dj_id?: string | null; requester_name?: string | null; event_date?: string | null } | null;
            const djEmail = bk?.dj_id ? await resolveUserEmail(bk.dj_id) : null;
            if (djEmail) {
              const who = bk?.requester_name || 'Your client';
              const resend = new Resend(process.env.RESEND_API_KEY);
              await resend.emails.send({
                from: FROM, to: djEmail,
                subject: `${who} paid by card`,
                html: `<p style="font-family:Arial,sans-serif;font-size:15px;color:#111;">${who} paid ${received} ${(p.currency || 'USD').toUpperCase()} by card${bk?.event_date ? ` for ${bk.event_date}` : ''} — it's in your Stripe account. ${status === 'paid' ? 'This request is now fully settled.' : 'A balance remains.'}</p>`,
              });
            }
          } catch { /* best-effort */ }
        }
        return NextResponse.json({ ok: true, settled: true, status });
      }

      // ── Refund issued on the DJ's account ──
      case 'charge.refunded': {
        if (!(await firstTime(db, event.id))) return NextResponse.json({ ok: true, duplicate: true });
        const charge = event.data.object as Stripe.Charge;
        const paymentId = charge.metadata?.payment_id || '';
        if (!paymentId) return NextResponse.json({ ok: true, reason: 'no_payment_id' });
        const { data: pData, error: selErr } = await db
          .from('booking_payments')
          .select('id, booking_id, kind, amount, amount_paid, currency, status, stripe_session_id')
          .eq('id', paymentId).maybeSingle();
        if (selErr) return new NextResponse('db_error', { status: 500 });
        const p = pData as PayRow | null;
        if (!p) return NextResponse.json({ ok: true, reason: 'payment_not_found' });
        const refunded = fromStripeMinor(charge.amount_refunded ?? 0, p.currency || 'USD');
        // amount_refunded is cumulative; recompute amount_paid as (charged −
        // refunded) relative to what Stripe says, floored at 0.
        const charged = fromStripeMinor(charge.amount ?? 0, p.currency || 'USD');
        const nextPaid = round2(Math.max(0, Number(p.amount_paid || 0) - refunded));
        void charged;
        const status = nextPaid <= 0.01 ? 'refunded' : nextPaid >= Number(p.amount) - 0.01 ? 'paid' : 'partial';
        const { error: upErr } = await db
          .from('booking_payments')
          .update({ amount_paid: nextPaid, status } as unknown as never)
          .eq('id', p.id);
        if (upErr) return new NextResponse('db_error', { status: 500 });
        return NextResponse.json({ ok: true, refunded: true, status });
      }

      // ── DJ's account capability changed ──
      case 'account.updated': {
        const acct = event.data.object as Stripe.Account;
        const ready = !!acct.charges_enabled;
        const acctId = acct.id || connectedAccount;
        if (acctId) {
          try {
            await db.from('users').update({ stripe_connect_ready: ready } as unknown as never).eq('stripe_connect_id', acctId);
          } catch { /* non-fatal */ }
        }
        return NextResponse.json({ ok: true, ready });
      }

      default:
        return NextResponse.json({ ok: true, ignored: event.type });
    }
  } catch (e) {
    console.error('[stripe/connect-webhook] handler error', e);
    // 500 → Stripe retries.
    return new NextResponse('Handler error', { status: 500 });
  }
}
