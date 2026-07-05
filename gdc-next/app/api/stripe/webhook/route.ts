// Stripe webhook route.
//
// Stripe calls this URL to report subscription lifecycle events. This is the
// ONLY thing that writes subscription state onto a user — checkout starts the
// flow, but the tier/status only become real when Stripe confirms here.
//
// Events handled:
//   customer.subscription.created / updated / deleted → sync tier + status
//   invoice.payment_failed                            → enter grace
//
// Mapping Stripe status → our sub_status:
//   active / trialing → 'active'
//   past_due          → 'grace'   (Stripe is retrying the payment)
//   anything else     → 'lapsed'  (canceled, unpaid, incomplete, paused…)
//
// The user is found via the user_id we stamped into subscription metadata at
// checkout; falls back to matching on stripe_customer_id.
//
// SECURITY: every request is verified against STRIPE_WEBHOOK_SECRET. An
// unsigned or tampered request is rejected before any DB write.

import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { planForPrice } from '@/lib/stripe/config';

export const runtime = 'nodejs';

type SubStatus = 'active' | 'grace' | 'lapsed';

function mapStatus(s: Stripe.Subscription.Status): SubStatus {
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'past_due') return 'grace';
  return 'lapsed';
}

type Admin = ReturnType<typeof createAdminClient>;

// Find our user id for a Stripe customer id (fallback when metadata is absent).
async function userIdByCustomer(admin: Admin, customer: string | null): Promise<string | null> {
  if (!customer) return null;
  const { data } = await admin
    .from('users')
    .select('id')
    .eq('stripe_customer_id' as never, customer)
    .maybeSingle();
  return (data as unknown as { id: string } | null)?.id ?? null;
}

function customerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

// Sync a subscription's current state onto the user.
async function applySubscription(admin: Admin, sub: Stripe.Subscription) {
  const cid = customerId(sub.customer);
  const userId = sub.metadata?.user_id || (await userIdByCustomer(admin, cid));
  if (!userId) {
    console.warn('[stripe/webhook] no user for subscription', sub.id);
    return;
  }

  const priceId = sub.items?.data?.[0]?.price?.id || null;
  const plan = planForPrice(priceId);
  const tier = plan?.tier ?? 0;
  const status = mapStatus(sub.status);

  // Period end lives on the subscription item in current Stripe API versions.
  const periodEndUnix = sub.items?.data?.[0]?.current_period_end;
  const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;

  await admin
    .from('users')
    .update({
      sub_tier: tier,
      sub_status: status,
      sub_period_end: periodEnd,
      stripe_customer_id: cid,
      stripe_subscription_id: sub.id,
    } as unknown as never)
    .eq('id', userId);
}

// A failed payment puts the account into the grace window. Stripe's dunning
// retries; if it recovers, a subscription.updated (active) event restores it,
// and if it gives up, a subscription.deleted (lapsed) event lands.
async function markGrace(admin: Admin, invoice: Stripe.Invoice) {
  const cid = customerId(invoice.customer);
  const userId = await userIdByCustomer(admin, cid);
  if (!userId) return;
  await admin
    .from('users')
    .update({ sub_status: 'grace' } as unknown as never)
    .eq('id', userId);
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET not set');
    return new NextResponse('Not configured', { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return new NextResponse('Missing signature', { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    console.error('[stripe/webhook] signature verification failed', e);
    return new NextResponse('Invalid signature', { status: 400 });
  }

  try {
    const admin = createAdminClient();
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await applySubscription(admin, event.data.object as Stripe.Subscription);
        break;
      }
      case 'invoice.payment_failed': {
        await markGrace(admin, event.data.object as Stripe.Invoice);
        break;
      }
      default:
        // Ignore other event types.
        break;
    }
  } catch (e) {
    console.error('[stripe/webhook] handler error', e);
    return new NextResponse('Handler error', { status: 500 });
  }

  return NextResponse.json({ received: true });
}
