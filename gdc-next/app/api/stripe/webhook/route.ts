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
//
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS RE-FETCHES INSTEAD OF TRUSTING THE PAYLOAD
//
// Stripe does not guarantee delivery ORDER, and it retries on any non-2xx —
// so this route must assume it will receive the same event twice, and two
// events in the wrong order, and it must be right anyway.
//
// The old version applied `event.data.object` directly. That's a photograph of
// the subscription at the moment the event fired, and writing photographs in
// arrival order gets you:
//
//   • REPLAY: Stripe retries a `subscription.updated` from an hour ago (its
//     first attempt timed out). We re-apply an hour-old tier over the current
//     one. A DJ who upgraded in between is silently downgraded.
//   • REORDER: `updated`(active) and `deleted`(canceled) fire seconds apart and
//     arrive backwards. We write `active` last. A cancelled account keeps Pro
//     forever, and nothing ever corrects it because no further event is coming.
//
// Both are the same bug: the payload says what WAS true, and we're writing it
// as what IS true.
//
// So every handler here re-fetches the subscription from Stripe and applies
// THAT. Stripe's answer is current by definition, which makes this route
// idempotent and order-independent for free — replay the same event ten times
// in any order and the row lands on the same value, because the value doesn't
// come from the event at all. The event is only a signal that something
// changed; Stripe is the source of truth for what it changed TO.
//
// Cost: one API call per event. Correctness for a fraction of a second.
// ─────────────────────────────────────────────────────────────────────────

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

/**
 * Sync a subscription's CURRENT state onto the user.
 *
 * Takes an id, not an object — see the header. The caller has a payload; it is
 * deliberately not used for anything but the id, because it may be stale.
 */
async function applySubscription(admin: Admin, subscriptionId: string) {
  const stripe = getStripe();
  // The whole point. Stripe's copy is current; the webhook's copy is a
  // photograph of some earlier moment that may already be wrong.
  const sub = await stripe.subscriptions.retrieve(subscriptionId);

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

  // Period bounds live on the subscription item in current Stripe API versions.
  // Both are stored: the [start, end) window is what the monthly contract quota
  // is counted against (see lib/contractQuota.ts).
  const periodEndUnix = sub.items?.data?.[0]?.current_period_end;
  const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;
  const periodStartUnix = sub.items?.data?.[0]?.current_period_start;
  const periodStart = periodStartUnix ? new Date(periodStartUnix * 1000).toISOString() : null;

  await admin
    .from('users')
    .update({
      sub_tier: tier,
      sub_status: status,
      sub_period_start: periodStart,
      sub_period_end: periodEnd,
      stripe_customer_id: cid,
      stripe_subscription_id: sub.id,
    } as unknown as never)
    .eq('id', userId);
}

/**
 * A failed payment.
 *
 * Does NOT write 'grace' directly. The old version did, and it had the replay
 * bug in its purest form: Stripe retries this event, dunning succeeds in the
 * meantime, and the retry lands 'grace' on an account that is now healthily
 * active. The DJ gets a lapse banner for a payment that went through.
 *
 * Instead: find the subscription, re-fetch it, apply whatever Stripe says it
 * is NOW. past_due maps to grace through the same mapStatus as everything
 * else, so a genuine failure still reaches grace — via the current truth
 * rather than an assumption about it.
 */
async function onPaymentFailed(admin: Admin, invoice: Stripe.Invoice) {
  // `subscription` is a top-level field on older API versions and lives on the
  // line item on newer ones. Read both — an invoice with neither is a one-off
  // payment, not a subscription, and there's nothing here to sync.
  const inv = invoice as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null } | null;
  };
  const raw = inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null;
  const subId = typeof raw === 'string' ? raw : raw?.id ?? null;
  if (!subId) return;
  await applySubscription(admin, subId);
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
        // The id is the only thing taken from the payload. An id can't go stale.
        const { id } = event.data.object as Stripe.Subscription;
        await applySubscription(admin, id);
        break;
      }
      case 'invoice.payment_failed': {
        await onPaymentFailed(admin, event.data.object as Stripe.Invoice);
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
