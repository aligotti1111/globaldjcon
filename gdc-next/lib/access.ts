// Subscription access — the single source of truth for "what is this DJ
// allowed to do right now."
//
// WHY THIS FILE EXISTS
// Every paid surface (taking bookings, contracts, deposits, the event info
// sheet, expanded media caps, the embed calendar) has to answer the same
// question: is this DJ paid, comped, in grace, or lapsed — and at what tier.
// If each surface checks Stripe fields and dates on its own, those checks
// drift and contradict each other. So the rule is: NOBODY reads sub_/comp_
// columns or compares dates directly. Everything calls into this module.
//
// TWO DISTINCT QUESTIONS — do not conflate them:
//   1. "Can this DJ start something NEW?" (take a new booking, send a new
//      contract) → depends on their CURRENT standing → use getAccess()/canBook().
//   2. "What can this DJ do on an EXISTING booking?" → depends on the tier that
//      booking was STAMPED with at creation → use bookingAllows().
//
// This module is PURE: no database calls, no Stripe calls, no imports. The
// caller reads the columns (server or client) and passes them in.

// ───────────────────────────────────────────────────────────────────
// TIER TABLE — THE ONE SOURCE OF TRUTH
//
// Every per-tier fact lives here and nowhere else: label, monthly/yearly
// price, the monthly signed-contract quota, and the feature flags. The gate
// functions below READ this table — they no longer hardcode tier numbers.
// Adding a 6th tier is one row here (+ its Stripe price IDs in
// lib/stripe/config.ts); changing a price or a quota is one field.
//
// The ladder is strict/inclusive: a higher tier has ≥ everything below it.
//
//   0 Free     $0       — account + profile + discovery listing. No booking,
//                         no contracts, no embed calendar.
//   1 Starter  $14.99   — booking engine + contracts (5/cycle) + deposits +
//                         event info sheet. NO embed calendar.
//   2 Pro      $29.99   — Starter + embed calendar + 30 contracts/cycle.
//   3 Business $49.99   — Pro + 100 contracts/cycle.
//   4 Premium  $99.99   — Business + 250 contracts/cycle.
//
// NOTE: tier LABELS and the exact FEATURE split for deposits/event-sheet were
// not fully specified — Starter+ get the "pro" suite by default here; flip the
// `proFeatures` flag per row to change that. Yearly = 10× monthly (2 months
// free), matching the current billing UI. Prices/quotas are pre-launch values.
// ───────────────────────────────────────────────────────────────────

export type Tier = 0 | 1 | 2 | 3 | 4;

export interface TierDef {
  tier: Tier;
  label: string;
  monthlyPrice: number;   // USD
  yearlyPrice: number;    // USD (10× monthly = 2 months free)
  contractQuota: number;  // signed contracts allowed per billing cycle (0 = none)
  booking: boolean;       // can take NEW bookings
  proFeatures: boolean;   // contracts / deposits / event info sheet available at all
  embedCalendar: boolean; // the embeddable calendar shows live availability
}

export const TIERS: Record<Tier, TierDef> = {
  0: { tier: 0, label: 'Free',     monthlyPrice: 0,     yearlyPrice: 0,      contractQuota: 0,   booking: false, proFeatures: false, embedCalendar: false },
  1: { tier: 1, label: 'Starter',  monthlyPrice: 14.99, yearlyPrice: 149.90, contractQuota: 5,   booking: true,  proFeatures: true,  embedCalendar: false },
  2: { tier: 2, label: 'Pro',      monthlyPrice: 29.99, yearlyPrice: 299.90, contractQuota: 30,  booking: true,  proFeatures: true,  embedCalendar: true  },
  3: { tier: 3, label: 'Premium Pro', monthlyPrice: 49.99, yearlyPrice: 499.90, contractQuota: 100, booking: true,  proFeatures: true,  embedCalendar: true  },
  4: { tier: 4, label: 'Enterprise',  monthlyPrice: 99.99, yearlyPrice: 999.90, contractQuota: 250, booking: true,  proFeatures: true,  embedCalendar: true  },
};

export const MAX_TIER = 4 as const;

// Named handles kept for existing call sites. BOOKING = lowest paid tier
// (where booking + the pro suite begin); PRO = lowest tier with the embed
// calendar. These are convenience aliases INTO the table above, not a second
// source of truth.
export const TIER = {
  FREE: 0,
  BOOKING: 1,
  PRO: 2,
  BUSINESS: 3,
  PREMIUM: 4,
} as const;

// Derived from the table so a label/price is never restated.
export const TIER_LABELS: Record<Tier, string> =
  (Object.values(TIERS) as TierDef[]).reduce((m, d) => { m[d.tier] = d.label; return m; }, {} as Record<Tier, string>);

export const TIER_MONTHLY_PRICE: Record<Tier, number> =
  (Object.values(TIERS) as TierDef[]).reduce((m, d) => { m[d.tier] = d.monthlyPrice; return m; }, {} as Record<Tier, number>);

export const TIER_YEARLY_PRICE: Record<Tier, number> =
  (Object.values(TIERS) as TierDef[]).reduce((m, d) => { m[d.tier] = d.yearlyPrice; return m; }, {} as Record<Tier, number>);

// The monthly signed-contract quota for a tier. 0 for Free/lapsed.
export const CONTRACT_QUOTA: Record<Tier, number> =
  (Object.values(TIERS) as TierDef[]).reduce((m, d) => { m[d.tier] = d.contractQuota; return m; }, {} as Record<Tier, number>);

// ───────────────────────────────────────────────────────────────────
// ACCESS STATE
//   active — paid & current, or comped & unexpired. Full access.
//   grace  — a Stripe payment failed; inside the retry window. STILL full access.
//   lapsed — was paid/comped, now isn't. New actions blocked; existing bookings
//            still operate via their tier_stamp.
//   none   — never had paid access.
// ───────────────────────────────────────────────────────────────────

export type AccessState = 'active' | 'grace' | 'lapsed' | 'none';
export type AccessSource = 'stripe' | 'admin' | 'code' | null;

// The subset of public.users columns this module reads.
export interface AccessFields {
  sub_tier: number | null;          // paid tier from Stripe: 0..4
  sub_status: string | null;        // 'active' | 'grace' | 'lapsed' | 'none'
  sub_period_start?: string | null; // ISO; start of current paid period (billing-cycle quota window)
  sub_period_end: string | null;    // ISO; end of current paid period
  comp_tier: number | null;         // tier granted by admin/code (null = none)
  comp_expires_at: string | null;   // ISO; when the comp ends
  comp_source: string | null;       // 'admin' | 'code' (null = not comped)
}

export interface Access {
  tier: Tier;
  state: AccessState;
  source: AccessSource;
}

// ───────────────────────────────────────────────────────────────────
// CORE RESOLVER
// ───────────────────────────────────────────────────────────────────

function clampTier(n: number | null | undefined): Tier {
  const v = Math.trunc(Number(n ?? 0));
  if (v >= MAX_TIER) return MAX_TIER;
  if (v <= 0) return 0;
  return v as Tier;
}

function compActive(f: AccessFields, now: Date): boolean {
  const t = clampTier(f.comp_tier);
  if (t === 0) return false;
  if (!f.comp_expires_at) return false;
  const end = new Date(f.comp_expires_at);
  return !isNaN(end.getTime()) && end.getTime() > now.getTime();
}

function subCounts(f: AccessFields): boolean {
  return f.sub_status === 'active' || f.sub_status === 'grace';
}

export function getAccess(f: AccessFields, now: Date = new Date()): Access {
  const subTier = subCounts(f) ? clampTier(f.sub_tier) : 0;
  const compTier = compActive(f, now) ? clampTier(f.comp_tier) : 0;

  const tier = (Math.max(subTier, compTier) as Tier);

  if (tier === 0) {
    const everHad =
      f.sub_status === 'lapsed' ||
      f.sub_status === 'grace' ||
      (clampTier(f.comp_tier) > 0 && !!f.comp_expires_at);
    return { tier: 0, state: everHad ? 'lapsed' : 'none', source: null };
  }

  const subWins = subTier >= compTier && subTier === tier;
  if (subWins) {
    return {
      tier,
      state: f.sub_status === 'grace' ? 'grace' : 'active',
      source: 'stripe',
    };
  }

  return {
    tier,
    state: 'active',
    source: (f.comp_source === 'admin' || f.comp_source === 'code') ? f.comp_source : 'admin',
  };
}

// ───────────────────────────────────────────────────────────────────
// NEW-ACTION GATES  (question #1: "can they start something new?")
// ───────────────────────────────────────────────────────────────────

export function effectiveTier(f: AccessFields, now: Date = new Date()): Tier {
  return getAccess(f, now).tier;
}

function live(a: Access): boolean {
  return a.state === 'active' || a.state === 'grace';
}

// Can the DJ take a NEW booking?
export function canBook(f: AccessFields, now: Date = new Date()): boolean {
  const a = getAccess(f, now);
  return live(a) && TIERS[a.tier].booking;
}

// Can the DJ use the pro suite (contracts / deposits / event info sheet) on
// NEW bookings at all? The NUMBER of contracts is further bounded by the
// monthly quota — see CONTRACT_QUOTA / contractQuotaFor + the usage reader in
// lib/contractQuota.ts.
export function canUsePro(f: AccessFields, now: Date = new Date()): boolean {
  const a = getAccess(f, now);
  return live(a) && TIERS[a.tier].proFeatures;
}

// The DJ's signed-contract quota for the current cycle (0 when free/lapsed).
export function contractQuotaFor(f: AccessFields, now: Date = new Date()): number {
  const a = getAccess(f, now);
  return live(a) ? TIERS[a.tier].contractQuota : 0;
}

// ───────────────────────────────────────────────────────────────────
// BOOKING STAMP  (question #2: "what can they do on THIS booking?")
// ───────────────────────────────────────────────────────────────────

export function tierStampFor(f: AccessFields, now: Date = new Date()): Tier {
  return effectiveTier(f, now);
}

export function bookingAllows(tierStamp: number | null | undefined, minTier: Tier): boolean {
  return clampTier(tierStamp) >= minTier;
}

// ───────────────────────────────────────────────────────────────────
// MEDIA CAPS — any paid tier unlocks the expanded allowance.
// ───────────────────────────────────────────────────────────────────

export interface MediaCaps {
  photos: number;
  videos: number;
}

export const MEDIA_CAPS_FREE: MediaCaps = { photos: 4, videos: 3 }; // TODO: confirm vs current enforcement
export const MEDIA_CAPS_PAID: MediaCaps = { photos: 100, videos: 10 };

export function mediaCaps(f: AccessFields, now: Date = new Date()): MediaCaps {
  const a = getAccess(f, now);
  return live(a) && TIERS[a.tier].booking ? MEDIA_CAPS_PAID : MEDIA_CAPS_FREE;
}

// ───────────────────────────────────────────────────────────────────
// EMBED CALENDAR — gated per-tier (Pro and up). Free/Starter show the
// "Calendar unavailable / View DJ profile" fallback (rendered at the embed
// surface, not here).
// ───────────────────────────────────────────────────────────────────

export function embedShowsCalendar(f: AccessFields, now: Date = new Date()): boolean {
  const a = getAccess(f, now);
  return live(a) && TIERS[a.tier].embedCalendar;
}
