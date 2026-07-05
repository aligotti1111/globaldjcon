// Stripe Checkout route.
//
// POST here with { tier, interval } to start a subscription. Flow:
//   1. Confirm the caller is logged in (server session).
//   2. Resolve the plan → a Stripe price ID (from lib/stripe/config).
//   3. Ensure the user has a Stripe customer (create once, store the id).
//   4. Create a Checkout Session in subscription mode and return its URL.
// The client then redirects the browser to that URL (Stripe-hosted payment
// page). When payment completes, Stripe fires webhooks that write the tier
// back onto the user (see app/api/stripe/webhook/route.ts).
//
// The user's id is stamped into the subscription metadata so the webhook can
// map the subscription back to the right account.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/server';
import { priceIdFor } from '@/lib/stripe/config';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  // 1. Auth — must be a logged-in user.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  // 2. Parse + validate the plan choice.
  let body: { tier?: unknown; interval?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const tier = Number(body.tier);
  const interval = String(body.interval);
  const priceId = priceIdFor(tier, interval);
  if (!priceId) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const admin = createAdminClient();

    // 3. Look up the user's row for an existing Stripe customer + name.
    // These columns aren't in the generated Supabase types yet, so the
    // result is cast (same pattern used across the codebase).
    const { data: rowData } = await admin
      .from('users')
      .select('stripe_customer_id, name')
      .eq('id', user.id)
      .maybeSingle();
    const row = rowData as unknown as { stripe_customer_id: string | null; name: string | null } | null;

    let customerId = row?.stripe_customer_id || null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        name: row?.name || undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      // Persist the customer id so future checkouts reuse it.
      await admin
        .from('users')
        .update({ stripe_customer_id: customerId } as unknown as never)
        .eq('id', user.id);
    }

    // 4. Create the Checkout Session.
    const origin =
      req.headers.get('origin') ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'https://globaldjconnect.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/account-settings?sub=success`,
      cancel_url: `${origin}/account-settings?sub=cancelled`,
      client_reference_id: user.id,
      subscription_data: {
        metadata: { user_id: user.id, tier: String(tier) },
      },
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[stripe/checkout] error', e);
    return NextResponse.json({ error: 'Checkout failed' }, { status: 500 });
  }
}
