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
  let body: { tier?: unknown; interval?: unknown; embedded?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const tier = Number(body.tier);
  const interval = String(body.interval);
  const embedded = body.embedded === true;
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
      .select('stripe_customer_id, name, comp_tier, comp_expires_at')
      .eq('id', user.id)
      .maybeSingle();
    const row = rowData as unknown as { stripe_customer_id: string | null; name: string | null; comp_tier: number | null; comp_expires_at: string | null } | null;

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

    // If the DJ currently holds a COMPLIMENTARY grant with a future expiry,
    // start BILLING at that expiry instead of now — they already have access
    // through the comp, so charging today would double up. A Stripe trial that
    // ends at the comp's expiry does exactly this: card captured now, no charge
    // until the comp runs out, then the plan bills normally. (Guarded to ≥48h
    // out, Stripe's minimum for a future trial_end; a comp ending sooner just
    // starts billing immediately.)
    let trialEnd: number | undefined;
    const compTier = Number(row?.comp_tier ?? 0);
    const compExpMs = row?.comp_expires_at ? new Date(row.comp_expires_at).getTime() : 0;
    if (compTier > 0 && compExpMs > Date.now() + 48 * 60 * 60 * 1000) {
      trialEnd = Math.floor(compExpMs / 1000);
    }
    // Clarifying line at checkout so the Stripe-labelled "trial" (the comp
    // window) doesn't read as a free trial that might lapse.
    const trialMsg = trialEnd
      ? `No charge today — your plan begins ${new Date(compExpMs).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}, when your complimentary access ends.`
      : null;

    // 4. Create the Checkout Session.
    const origin =
      req.headers.get('origin') ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'https://globaldjconnect.com';

    // Build the session params for whichever mode the client asked for. Embedded
    // renders Stripe's form inside our own page (returns a client_secret the
    // front-end mounts); hosted redirects the browser to Stripe's page.
    const paramsFor = (custId: string): Parameters<typeof stripe.checkout.sessions.create>[0] => embedded
      ? {
          mode: 'subscription' as const,
          // This account's pinned Stripe API version uses 'embedded_page' for
          // embedded checkout (NOT 'embedded', which it rejects as "no longer
          // supported"). Keep this value unless the account's API version changes.
          ui_mode: 'embedded_page' as const,
          customer: custId,
          line_items: [{ price: priceId, quantity: 1 }],
          return_url: `${origin}/subscribe/complete?session_id={CHECKOUT_SESSION_ID}`,
          client_reference_id: user.id,
          subscription_data: {
            metadata: { user_id: user.id, tier: String(tier) },
            ...(trialEnd ? { trial_end: trialEnd } : {}),
          },
          ...(trialMsg ? { custom_text: { submit: { message: trialMsg } } } : {}),
          allow_promotion_codes: true,
        }
      : {
          mode: 'subscription' as const,
          customer: custId,
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: `${origin}/subscribe?sub=success`,
          cancel_url: `${origin}/subscribe?sub=cancelled`,
          client_reference_id: user.id,
          subscription_data: {
            metadata: { user_id: user.id, tier: String(tier) },
            ...(trialEnd ? { trial_end: trialEnd } : {}),
          },
          ...(trialMsg ? { custom_text: { submit: { message: trialMsg } } } : {}),
          allow_promotion_codes: true,
        };

    // Create the session. If the stored customer id doesn't exist in the current
    // Stripe mode (e.g. it was created in test mode and we've since switched keys,
    // or it was deleted), Stripe throws resource_missing on `customer`. Recover
    // by minting a fresh customer, persisting it, and retrying once — otherwise
    // the DJ is permanently stuck on a dead customer id.
    let session;
    try {
      session = await stripe.checkout.sessions.create(paramsFor(customerId));
    } catch (err) {
      const se = err as { code?: string; param?: string; message?: string };
      const missingCustomer =
        se?.param === 'customer' ||
        (se?.code === 'resource_missing' && /customer/i.test(se?.message || '')) ||
        /No such customer/i.test(se?.message || '');
      if (!missingCustomer) throw err;
      const fresh = await stripe.customers.create({
        email: user.email || undefined,
        name: row?.name || undefined,
        metadata: { user_id: user.id },
      });
      customerId = fresh.id;
      await admin
        .from('users')
        .update({ stripe_customer_id: customerId } as unknown as never)
        .eq('id', user.id);
      session = await stripe.checkout.sessions.create(paramsFor(customerId));
    }

    return embedded
      ? NextResponse.json({ clientSecret: session.client_secret })
      : NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[stripe/checkout] error', e);
    // Surface the real Stripe error so failures are diagnosable from the client
    // instead of a blanket "Checkout failed". Stripe error messages ("No such
    // price…", "Invalid API Key…", "…similar object exists in live mode, but a
    // test mode key was used…") name the actual cause and aren't sensitive.
    const err = e as { message?: string; code?: string; type?: string };
    return NextResponse.json(
      { error: err?.message || 'Checkout failed', code: err?.code, type: err?.type },
      { status: 500 },
    );
  }
}
