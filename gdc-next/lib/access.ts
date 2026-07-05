// Subscription access — the single source of truth for "what is this DJ
// allowed to do right now."
//
// WHY THIS FILE EXISTS
// Every paid surface (taking bookings, contracts, deposits, the event info
// sheet, expanded media caps, the embed calendar) has to answer the same
// question: is this DJ paid, comped, in grace, or lapsed — and at what tier.
// If each surface checks Stripe fields and dates on its own, those checks
// drift and contradict each other (exactly what happened with CURRENCY_SYMBOLS
// before lib/constants.ts). So the rule is: NOBODY reads sub_/comp_ columns
// or compares dates directly. Everything calls into this module.
//
// TWO DISTINCT QUESTIONS — do not conflate them:
//   1. "Can this DJ start something NEW?" (take a new booking, send a new
//      contract) → depends on their CURRENT standing → use getAccess()/canBook().
//   2. "What can this DJ do on an EXISTING booking?" (deploy a contract to a
//      booking they already have) → depends on the tier that booking was
//      STAMPED with at creation, NOT their current sub → use bookingAllows().
//
// That split is the whole reason a lapsed DJ keeps full control of bookings
// they already made while being blocked from new ones. The booking remembers
// the rights it was born with (tier_stamp); the account's live standing only
// governs new activity.
//
// This module is PURE: no database calls, no Stripe calls, no imports. The
// caller reads the columns (server or client) and passes them in. That keeps
// it testable and callable from anywhere without a round-trip.

// ───────────────────────────────────────────────────────────────────
// TIERS
// The tier ladder is strict: Tier 2 includes everything in Tier 1.
// So access reduces to a single number and a minimum-tier comparison.
//   0 = Free   (account + profile + discovery listing; no booking)
//   1 = Booking ($19.99/mo)  — booking engine + expanded media + embed
//   2 = Pro    ($29.99/mo)   — everything in Tier 1 + contracts, deposits,
//                              event info sheet
// ───────────────────────────────────────────────────────────────────

export type Tier = 0 | 1 | 2;

export const TIER = {
  FREE: 0,
  BOOKING: 1,
  PRO: 2,
} as const;

export const TIER_LABELS: Record<Tier, string> = {
  0: 'Free',
  1: 'Booking',
  2: 'Pro',
};

// Monthly prices (USD). Annual pricing is a discounted variant handled at
// the Stripe layer — the exact annual numbers are TBD and intentionally not
// hard-coded here yet. Keep these as the single source of truth so no price
// string is ever inlined in UI copy.
export const TIER_MONTHLY_PRICE: Record<Tier, number> = {
  0: 0,
  1: 19.99,
  2: 29.99,
};

// ───────────────────────────────────────────────────────────────────
// ACCESS STATE
// The account's live standing. Drives new-action gating and which banner
// (if any) the DJ sees.
//   active — paid & current, or comped & unexpired. Full access.
//   grace  — a Stripe payment failed; inside the 3-day retry window. STILL
//            full access — this is a soft warning state, not a downgrade.
//   lapsed — was paid/comped, now isn't. New actions blocked; existing
//            bookings still fully operate via their tier_stamp.
//   none   — never had paid access (a plain free account).
// ───────────────────────────────────────────────────────────────────

export type AccessState = 'active' | 'grace' | 'lapsed' | 'none';

// Where the DJ's current access comes from — powers the "access source"
// visibility in the admin panel so a paying DJ is distinguishable from a
// comped one at a glance.
export type AccessSource = 'stripe' | 'admin' | 'code' | null;

// ───────────────────────────────────────────────────────────────────
// INPUT SHAPE
// The subset of public.users columns this module reads. The caller loads
// these however it already loads the user and passes them in. Kept as its
// own interface (not the full user row) so this file has zero coupling to
// the generated Supabase types and never breaks when the schema regenerates.
// ───────────────────────────────────────────────────────────────────

export interface AccessFields {
  sub_tier: number | null;        // paid tier from Stripe: 0/1/2
  sub_status: string | null;      // 'active' | 'grace' | 'lapsed' | 'none'
  sub_period_end: string | null;  // ISO timestamp; end of current paid period
  comp_tier: number | null;       // tier granted by admin/code (null = none)
  comp_expires_at: string | null; // ISO timestamp; when the comp ends
  comp_source: string | null;     // 'admin' | 'code' (null = not comped)
}

// Resolved standing — what the rest of the app consumes.
export interface Access {
  tier: Tier;          // effective tier right now (0 if no access)
  state: AccessState;  // active / grace / lapsed / none
  source: AccessSource; // where the effective tier comes from
}

// ───────────────────────────────────────────────────────────────────
// CORE RESOLVER
// ───────────────────────────────────────────────────────────────────

function clampTier(n: number | null | undefined): Tier {
  const v = Math.trunc(Number(n ?? 0));
  if (v >= 2) return 2;
  if (v === 1) return 1;
  return 0;
}

// Is the comp currently valid? A comp grants access only while it has a tier
// and an expiry that is still in the future. A missing expiry is treated as
// NO active comp (grants are always issued with a chosen number of days, so a
// null expiry means "no grant," not "forever").
function compActive(f: AccessFields, now: Date): boolean {
  const t = clampTier(f.comp_tier);
  if (t === 0) return false;
  if (!f.comp_expires_at) return false;
  const end = new Date(f.comp_expires_at);
  return !isNaN(end.getTime()) && end.getTime() > now.getTime();
}

// Does the Stripe subscription count toward access right now? Only when its
// status is active or grace. A lapsed/none sub contributes nothing (but any
// bookings it already stamped stay valid — that's handled by bookingAllows,
// not here).
function subCounts(f: AccessFields): boolean {
  return f.sub_status === 'active' || f.sub_status === 'grace';
}

// The resolver. Effective tier is the higher of the two live sources.
export function getAccess(f: AccessFields, now: Date = new Date()): Access {
  const subTier = subCounts(f) ? clampTier(f.sub_tier) : 0;
  const compTier = compActive(f, now) ? clampTier(f.comp_tier) : 0;

  const tier = (Math.max(subTier, compTier) as Tier);

  // No live access. Distinguish "lapsed" (had something, lost it) from "none"
  // (never had anything) so we can message correctly and only show a lapse
  // banner to people who actually lapsed.
  if (tier === 0) {
    const everHad =
      f.sub_status === 'lapsed' ||
      f.sub_status === 'grace' || // grace with tier 0 shouldn't happen, but be safe
      (clampTier(f.comp_tier) > 0 && !!f.comp_expires_at); // had a comp that has now expired
    return { tier: 0, state: everHad ? 'lapsed' : 'none', source: null };
  }

  // Has access. Determine which source wins and the resulting state.
  // Prefer 'stripe' as the source when the sub is what grants (or ties for)
  // the effective tier — a paying customer is reported as paying even if they
  // also hold a comp.
  const subWins = subTier >= compTier && subTier === tier;

  if (subWins) {
    return {
      tier,
      state: f.sub_status === 'grace' ? 'grace' : 'active',
      source: 'stripe',
    };
  }

  // Comp wins. Comps have no grace concept — they're active until they expire
  // (with a warning email/banner beforehand, handled elsewhere).
  return {
    tier,
    state: 'active',
    source: (f.comp_source === 'admin' || f.comp_source === 'code')
      ? f.comp_source
      : 'admin',
  };
}

// ───────────────────────────────────────────────────────────────────
// NEW-ACTION GATES  (question #1: "can they start something new?")
// All of these require the account to be active OR in grace. lapsed/none
// blocks new activity.
// ───────────────────────────────────────────────────────────────────

export function effectiveTier(f: AccessFields, now: Date = new Date()): Tier {
  return getAccess(f, now).tier;
}

function live(a: Access): boolean {
  return a.state === 'active' || a.state === 'grace';
}

// Can the DJ take a NEW booking? (Tier 1+)
export function canBook(f: AccessFields, now: Date = new Date()): boolean {
  const a = getAccess(f, now);
  return live(a) && a.tier >= TIER.BOOKING;
}

// Can the DJ use the Pro suite (contracts / deposits / event info sheet) on
// NEW bookings? (Tier 2)
export function canUsePro(f: AccessFields, now: Date = new Date()): boolean {
  const a = getAccess(f, now);
  return live(a) && a.tier >= TIER.PRO;
}

// ───────────────────────────────────────────────────────────────────
// BOOKING STAMP  (question #2: "what can they do on THIS booking?")
// ───────────────────────────────────────────────────────────────────

// The tier to freeze onto a booking at the moment it's created. This is the
// DJ's effective tier at creation time — the booking then carries these
// rights permanently.
export function tierStampFor(f: AccessFields, now: Date = new Date()): Tier {
  return effectiveTier(f, now);
}

// Is an action requiring `minTier` allowed on an existing booking? Reads the
// booking's frozen stamp ONLY — deliberately ignores the DJ's current sub, so
// a lapsed DJ can still (e.g.) deploy a contract to a booking that was stamped
// Tier 2. A missing/null stamp is treated as 0 (no Pro rights).
export function bookingAllows(tierStamp: number | null | undefined, minTier: Tier): boolean {
  return clampTier(tierStamp) >= minTier;
}

// ───────────────────────────────────────────────────────────────────
// MEDIA CAPS
// Any paid tier unlocks the same expanded allowance. On lapse the DJ drops
// back to the free cap — extra media is HIDDEN (never deleted), restored on
// resubscribe. The hide/show enforcement lives at the media surfaces; this
// just answers "how many are visible for this standing."
//
// ⚠️ FREE caps below MUST match whatever PhotosTab / VideoTab currently
// enforce. They are placeholders pending confirmation of the live numbers —
// do not treat them as final until verified against the actual upload limits.
// PAID caps are confirmed: 100 photos, 10 videos.
// ───────────────────────────────────────────────────────────────────

export interface MediaCaps {
  photos: number;
  videos: number;
}

export const MEDIA_CAPS_FREE: MediaCaps = { photos: 4, videos: 3 }; // TODO: confirm vs current enforcement
export const MEDIA_CAPS_PAID: MediaCaps = { photos: 100, videos: 10 };

export function mediaCaps(f: AccessFields, now: Date = new Date()): MediaCaps {
  const a = getAccess(f, now);
  return live(a) && a.tier >= TIER.BOOKING ? MEDIA_CAPS_PAID : MEDIA_CAPS_FREE;
}

// ───────────────────────────────────────────────────────────────────
// EMBED CALENDAR
// The embed mirrors booking availability. Live calendar only while the DJ can
// take bookings; otherwise the embed shows the "Calendar unavailable / View
// DJ profile" fallback (rendered at the embed surface, not here).
// ───────────────────────────────────────────────────────────────────

export function embedShowsCalendar(f: AccessFields, now: Date = new Date()): boolean {
  return canBook(f, now);
}
