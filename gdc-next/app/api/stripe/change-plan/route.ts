// POST /api/stripe/change-plan   { tier, interval }
//
// In-app plan switching — no Stripe-hosted portal. Updates the DJ's EXISTING
// active subscription to a different tier/interval by swapping the price on its
// single line item, with proration. Stripe then fires
// customer.subscription.updated, and the webhook writes the new sub_tier /
// sub_period_* back onto the user, so the app stays in sync automatically.
//
// Used for BOTH upgrades and downgrades. A brand-new subscriber (no active
// subscription) still goes through /api/stripe/checkout, not here.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/server';
import { priceIdFor } from '@/lib/stripe/config';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { tier?: unknown; interval?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const tier = Number(body.tier);
  const interval = String(body.interval || '');
  const newPriceId = priceIdFor(tier, interval);
  if (!newPriceId) {
    return NextResponse.json({ error: 'That plan isn’t available yet.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: rowData } = await admin
    .from('users')
    .select('stripe_subscription_id')
    .eq('id', user.id)
    .maybeSingle();
  const subId = (rowData as unknown as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id || null;
  if (!subId) {
    return NextResponse.json(
      { error: 'No active subscription to change. Please subscribe first.' },
      { status: 400 },
    );
  }

  try {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subId);

    // A cancelled/incomplete sub can't be switched — send them to re-subscribe.
    if (sub.status !== 'active' && sub.status !== 'trialing' && sub.status !== 'past_due') {
      return NextResponse.json(
        { error: 'Your subscription isn’t active. Please start a new subscription.' },
        { status: 400 },
      );
    }

    const item = sub.items?.data?.[0];
    if (!item) return NextResponse.json({ error: 'Subscription has no plan to change.' }, { status: 400 });

    // Already on this exact price — nothing to do.
    if (item.price?.id === newPriceId) {
      return NextResponse.json({ ok: true, unchanged: true });
    }

    await stripe.subscriptions.update(subId, {
      items: [{ id: item.id, price: newPriceId }],
      // Prorate the difference onto the next invoice (credit on downgrade,
      // charge on upgrade) — the standard mid-cycle switch behavior.
      proration_behavior: 'create_prorations',
      // If they'd scheduled a cancel, switching plans keeps them subscribed.
      cancel_at_period_end: false,
      // Keep the mapping the webhook relies on.
      metadata: { user_id: user.id, tier: String(tier) },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[stripe/change-plan] error', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not change your plan.' },
      { status: 500 },
    );
  }
}
