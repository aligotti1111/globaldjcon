// Stripe configuration — price IDs, publishable key, and the mapping between
// Stripe prices and our tier ladder.
//
// ✅ LIVE-MODE VALUES. The publishable key and price IDs below are from the
// Stripe LIVE account (products recreated in live mode on 2026-09-05; test mode
// has its own separate catalog). Swapping this one file is the whole price-wiring
// side of "go live"; the matching sk_live_ secret + live webhook signing secret
// live in env vars (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET), not here.
//
// The publishable key is safe to ship to the browser (that's its purpose).
// The SECRET key never appears here — it lives only in the STRIPE_SECRET_KEY
// environment variable, read server-side in lib/stripe/server.ts.

import { TIER, type Tier } from '@/lib/access';

export const STRIPE_PUBLISHABLE_KEY =
  'pk_live_51TWriFPHp43e0bAtsBbReygC4QTaoumxnDgA03C9fLjDZNmJndvAsVPrMPE63MbdlvmfX31ZC3G7FQJtFSdD3HOc009O1jOUYc';

export type BillingInterval = 'monthly' | 'yearly';

// A paid tier is one of 1 (Booking) or 2 (Pro). Tier 0 (Free) has no price.
export type PaidTier = 1 | 2 | 3 | 4;

// Price IDs per (tier, interval). The source of truth for "which Stripe price
// does this plan choice map to."
export const STRIPE_PRICES: Record<PaidTier, Record<BillingInterval, string>> = {
  1: {
    monthly: 'price_1UCEMRPHp43e0bAtd8YAnjxf', // Starter – $14.99/mo
    yearly: 'price_1UCEMRPHp43e0bAtIQxv98Z5',  // Starter – $149.90/yr
  },
  2: {
    monthly: 'price_1UCENxPHp43e0bAtzRFprfTb', // Pro – $29.99/mo
    yearly: 'price_1UCENxPHp43e0bAtgcC57s4J',  // Pro – $299.90/yr
  },
  3: {
    monthly: 'price_1UCEOyPHp43e0bAtIN3RqUuk', // Premium Pro – $49.99/mo
    yearly: 'price_1UCEOyPHp43e0bAt8dAbGwwp',  // Premium Pro – $499.90/yr
  },
  4: {
    monthly: 'price_1UCEPyPHp43e0bAtoqwwqEUW', // Enterprise – $99.99/mo
    yearly: 'price_1UCEPyPHp43e0bAth6kQU1ez',  // Enterprise – $999.90/yr
  },
};

// Reverse lookup: a Stripe price ID → which tier/interval it represents.
// Used by the webhook to translate an incoming subscription's price back into
// a tier for the users table.
export const PRICE_TO_PLAN: Record<string, { tier: PaidTier; interval: BillingInterval }> = (() => {
  const map: Record<string, { tier: PaidTier; interval: BillingInterval }> = {};
  (Object.keys(STRIPE_PRICES) as unknown as PaidTier[]).forEach((tier) => {
    (Object.keys(STRIPE_PRICES[tier]) as BillingInterval[]).forEach((interval) => {
      map[STRIPE_PRICES[tier][interval]] = { tier, interval };
    });
  });
  return map;
})();

// The price ID for a given plan choice, or null if the inputs are invalid.
export function priceIdFor(tier: number, interval: string): string | null {
  if (!Number.isInteger(tier) || tier < 1 || tier > 4) return null;
  if (interval !== 'monthly' && interval !== 'yearly') return null;
  return STRIPE_PRICES[tier as PaidTier][interval as BillingInterval];
}

// The plan (tier + interval) a Stripe price ID maps to, or null if unknown.
export function planForPrice(priceId: string | null | undefined): { tier: PaidTier; interval: BillingInterval } | null {
  if (!priceId) return null;
  return PRICE_TO_PLAN[priceId] ?? null;
}

// Guard: is this a real paid tier the app sells? (keeps TIER import meaningful
// and gives callers a single check.)
export function isPaidTier(tier: number): tier is PaidTier {
  return tier === TIER.BOOKING || tier === TIER.PRO;
}

// Re-export Tier for convenience so callers can import both from one place.
export type { Tier };
