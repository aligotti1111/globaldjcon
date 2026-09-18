// lib/siteSale.ts — server-side helpers for SITE-WIDE SALES (see site-sales.sql).
// SERVER-ONLY: every function takes the service-role admin client.
//
// Two kinds of sale:
//   'percent' — a Stripe-coupon % off applied at checkout.
//   'free'    — a comp (free access, no card) granted to new DJ signups.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { createAdminClient } from '@/lib/supabase/admin';

export interface LiveSale {
  id: string;
  kind: 'percent' | 'free';
  percent_off: number | null;
  applies_to: 'monthly' | 'yearly' | 'both' | null;
  stripe_coupon_id: string | null;
  grant_tier: number | null;
  grant_months: number | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
}

type Admin = ReturnType<typeof createAdminClient>;
const untyped = (a: Admin): SupabaseClient => a as unknown as SupabaseClient;

// A sale scope covers an interval when it's the same interval or 'both'.
export function scopeMatches(appliesTo: string | null | undefined, interval: string): boolean {
  return appliesTo === 'both' || appliesTo === interval;
}

// All sales that are ON right now: active AND within their date window.
// Newest first, so a "pick one" (free sale) takes the most recent.
export async function getLiveSales(admin: Admin): Promise<LiveSale[]> {
  const now = Date.now();
  const { data } = await untyped(admin)
    .from('site_sales')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false });
  const rows = (data as LiveSale[] | null) || [];
  // Compare as real timestamps (not lexical strings) so a non-UTC DB session
  // can't break the window check.
  return rows.filter(
    (s) =>
      (!s.starts_at || new Date(s.starts_at).getTime() <= now) &&
      (!s.ends_at || new Date(s.ends_at).getTime() >= now),
  );
}

// The best % discount for a given billing interval, considering every live
// percent sale PLUS an optional personal discount code — "bigger wins".
// Returns the Stripe coupon id to apply (or null for full price).
export async function pickBestCoupon(
  admin: Admin,
  interval: string,
  promoCode?: string,
): Promise<{ couponId: string; percent: number } | null> {
  let best: { couponId: string; percent: number } | null = null;
  const consider = (couponId: string | null | undefined, percent: number | null | undefined) => {
    if (!couponId || !percent) return;
    if (!best || percent > best.percent) best = { couponId, percent };
  };

  // Live site-wide percent sales that cover this interval.
  const live = await getLiveSales(admin);
  for (const s of live) {
    if (s.kind === 'percent' && scopeMatches(s.applies_to, interval)) {
      consider(s.stripe_coupon_id, s.percent_off);
    }
  }

  // The DJ's personal discount code, if any (and if it covers this interval).
  const code = (promoCode || '').trim().toUpperCase();
  if (code) {
    const { data: dc } = await untyped(admin)
      .from('discount_codes')
      .select('stripe_coupon_id, active, applies_to, percent_off, expires_at')
      .eq('code', code)
      .maybeSingle<{ stripe_coupon_id: string; active: boolean; applies_to: string; percent_off: number; expires_at: string | null }>();
    // Ignore an expired code so we never hand Stripe a coupon it will reject
    // (which would 500 the whole checkout instead of just skipping the code).
    const notExpired = !dc?.expires_at || new Date(dc.expires_at).getTime() > Date.now();
    if (dc && dc.active && notExpired && scopeMatches(dc.applies_to, interval)) {
      consider(dc.stripe_coupon_id, dc.percent_off);
    }
  }

  return best;
}

// The active FREE (comp) sale, if one is live. Used at signup to grant new DJs
// free access with no card.
export async function getLiveFreeSale(admin: Admin): Promise<LiveSale | null> {
  const live = await getLiveSales(admin);
  return live.find((s) => s.kind === 'free' && s.grant_tier && s.grant_months) || null;
}
