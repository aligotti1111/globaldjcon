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
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/server';
import { priceIdFor } from '@/lib/stripe/config';
import { getActingContext, canBilling } from '@/lib/acting';
import { pickBestCoupon } from '@/lib/siteSale';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  // 1. Auth — must be a logged-in user.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  // OWNER ONLY. Billing belongs to the account owner: a teammate must never be
  // able to start a subscription — that would bind a paid plan to the teammate's
  // own row (invisible to the owner) instead of the account they work on.
  const acting = await getActingContext(user.id);
  if (!canBilling(acting.role)) {
    return NextResponse.json({ error: 'Only the account owner can manage billing.' }, { status: 403 });
  }

  // 2. Parse + validate the plan choice.
  let body: { tier?: unknown; interval?: unknown; embedded?: unknown; promoCode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const tier = Number(body.tier);
  const interval = String(body.interval);
  const embedded = body.embedded === true;
  // Optional discount code entered in our "Apply Promo Code" box before picking
  // a plan. We resolve it to the Stripe promotion code and pre-apply it below.
  const promoCode = typeof body.promoCode === 'string' ? body.promoCode.trim().toUpperCase() : '';
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

    // ONE DISCOUNT CODE PER ACCOUNT. A discount code applies as a Stripe coupon
    // at checkout; the webhook records each use in code_redemptions with a
    // UNIQUE(code_type, code_id, user_id) constraint. But nothing stopped the
    // SAME account from re-entering the same code on a later checkout (e.g.
    // cancel then re-subscribe) and getting the discount again. Guard it here:
    // if the entered code exists and this account already redeemed it — or the
    // code has hit its overall max_redemptions — reject before we build the
    // session. (Site-wide sales are applied automatically and are not gated
    // per-account; only the explicitly-entered code is.)
    if (promoCode) {
      // These promo tables aren't in the generated Supabase types, so query them
      // through an untyped view of the same admin client (pattern used across
      // the codebase).
      const db = admin as unknown as SupabaseClient;
      const { data: dcRow } = await db
        .from('discount_codes')
        .select('id, active, max_redemptions')
        .eq('code', promoCode)
        .maybeSingle();
      const dc = dcRow as unknown as { id: string; active: boolean; max_redemptions: number | null } | null;
      if (dc && dc.active) {
        // Already used by THIS account?
        const { data: mine } = await db
          .from('code_redemptions')
          .select('id')
          .eq('code_type', 'discount')
          .eq('code_id', dc.id)
          .eq('user_id', user.id)
          .maybeSingle();
        if (mine) {
          return NextResponse.json(
            { error: 'You’ve already used this code. Discount codes can only be used once per account.' },
            { status: 409 },
          );
        }
        // Overall cap reached across all accounts?
        if (dc.max_redemptions != null) {
          const { count } = await db
            .from('code_redemptions')
            .select('id', { count: 'exact', head: true })
            .eq('code_type', 'discount')
            .eq('code_id', dc.id);
          if ((count ?? 0) >= dc.max_redemptions) {
            return NextResponse.json(
              { error: 'This code has been fully redeemed.' },
              { status: 409 },
            );
          }
        }
      }
    }

    // Resolve the winning discount COUPON for this plan: the bigger of any live
    // site-wide sale for this interval and the DJ's personal code (scope-matched
    // in pickBestCoupon). When present we PRE-APPLY it via `discounts`. We do NOT
    // turn on Stripe's own "Add code" field: our "Apply Promo Code" box already
    // takes codes before checkout and pre-applies them here, so the Stripe field
    // is a redundant, confusing second place to enter a code. Leaving
    // allow_promotion_codes unset hides it.
    const best = await pickBestCoupon(admin, interval, promoCode);
    const couponId = best?.couponId ?? null;
    const discountFields = couponId
      ? { discounts: [{ coupon: couponId }] }
      : {};
    // If a code/sale coupon is applied, remember WHICH one on the subscription
    // so the webhook can record the redemption (who used it) once payment
    // completes. Stripe metadata values must be strings.
    const redemptionMeta: Record<string, string> = best?.sourceId
      ? { discount_kind: best.source, discount_id: best.sourceId }
      : {};

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
            metadata: { user_id: user.id, tier: String(tier), ...redemptionMeta },
            ...(trialEnd ? { trial_end: trialEnd } : {}),
          },
          ...(trialMsg ? { custom_text: { submit: { message: trialMsg } } } : {}),
          ...discountFields,
        }
      : {
          mode: 'subscription' as const,
          customer: custId,
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: `${origin}/subscribe?sub=success`,
          cancel_url: `${origin}/subscribe?sub=cancelled`,
          client_reference_id: user.id,
          subscription_data: {
            metadata: { user_id: user.id, tier: String(tier), ...redemptionMeta },
            ...(trialEnd ? { trial_end: trialEnd } : {}),
          },
          ...(trialMsg ? { custom_text: { submit: { message: trialMsg } } } : {}),
          ...discountFields,
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
