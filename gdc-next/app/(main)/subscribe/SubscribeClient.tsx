'use client';

// SubscribeClient — the interactive part of /subscribe.
//
// Behavior depends on the current subscription (passed from the server page):
//   • Not subscribed (tier 0): show the monthly/yearly toggle + Subscribe
//     buttons → Stripe Checkout.
//   • Subscribed: show which plan they're on, mark the current card, and route
//     ALL changes (switch/cancel) through the Stripe portal — never a second
//     checkout.
//
// The plan CARDS are generated from the TIERS table in lib/access.ts — the one
// source of truth for label / price / contract quota / features. Adding a tier
// or changing a price is a one-row edit there; this file never restates them.
// A card is only PURCHASABLE when lib/stripe/config.ts has a price ID for that
// tier+interval; tiers without an ID yet render as "Coming soon" and turn on
// automatically once their IDs are added.

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { STRIPE_PUBLISHABLE_KEY, priceIdFor } from '@/lib/stripe/config';

// Stripe.js loaded once, module-level (recommended).
const stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
import type { AccessState, AccessSource, Tier } from '@/lib/access';
import { TIERS, TIER_LABELS, type TierDef } from '@/lib/access';
import styles from './subscribe.module.css';

type Interval = 'monthly' | 'yearly';
// Every non-free tier is a potential plan card.
type PaidTier = 1 | 2 | 3 | 4;

const PAID_TIERS: PaidTier[] = [1, 2, 3, 4];
// The card we visually highlight as the popular pick.
const FEATURED_TIER: PaidTier = 2;

// Per-tier accent colors — tint each card's hero band, name, Most Popular label
// and (for the featured card) its border/glow.
const TIER_ACCENTS: Record<PaidTier, string> = {
  1: '#9aa3a0', // Starter — gray
  2: '#00e0a4', // Pro — neon
  3: '#31d0ff', // Premium Pro — blue
  4: '#f5c451', // Enterprise — gold
};

interface Props {
  isLoggedIn: boolean;
  currentTier: Tier;
  currentState: AccessState;
  // Where the current access comes from: 'stripe' = paid subscription,
  // 'admin'/'code' = complimentary (comp), null = none.
  source: AccessSource;
  // End date of the current access (paid period end or comp expiry), ISO.
  accessUntil: string | null;
  // Admin/code comp expiry, ISO — when a paid subscriber ALSO has a comp that
  // outlasts their billing period, this is what keeps them active if they
  // cancel. Used to show "active until <comp date>" on a scheduled cancel.
  compUntil?: string | null;
  // The DJ's type — tailors club-only vs mobile-only feature bullets. null =
  // logged-out / unknown, in which case both sets show.
  djType?: 'mobile' | 'club' | null;
  // A paid subscriber's current billing interval, so the picker can offer a
  // switch to the other interval on the tier they're already on. null = unknown
  // (comp, logged-out, or Stripe read failed) → falls back to tier-only current.
  currentInterval?: Interval | null;
}

function fmtPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

type Feat = { key: string; text: string; included: boolean; emphasis?: boolean };

// Itemized feature list built from the tier's flags — no hand-written copy to
// drift from the table. Each item carries a stable `key` (independent of the
// number in its label) so tiers can be diffed against each other.
function planFeatures(d: TierDef, djType?: 'mobile' | 'club' | null): Feat[] {
  const feats: Feat[] = [
    { key: 'booking', text: 'Booking Engine', included: d.booking },
    { key: 'contracts', text: `${d.contractQuota}x e-signed contracts / month`, included: d.contractQuota > 0, emphasis: true },
    // Deposits + invoicing combined: the DJ adds their payment options and
    // collects deposits & balances through the platform, paid straight to them.
    { key: 'deposits', text: 'Collect deposits & balances', included: d.proFeatures },
    { key: 'receipts', text: 'Auto receipts', included: d.proFeatures },
    { key: 'finance', text: 'Finance & earnings reports', included: d.proFeatures },
    { key: 'inbox', text: 'Inbox messaging', included: true },
    { key: 'qr', text: 'QR code to your profile', included: d.qrCode },
    { key: 'photos', text: `${d.photos} profile photos`, included: d.photos > 0, emphasis: true },
    // Paid tiers get unlimited embedded videos/mixes; Free keeps its small count.
    { key: 'videos', text: d.tier > 0 ? 'Unlimited videos' : `${d.videos} videos`, included: d.videos > 0, emphasis: true },
    { key: 'mixes', text: d.tier > 0 ? 'Unlimited mixes' : `${d.mixes} mixes`, included: d.mixes > 0, emphasis: true },
    { key: 'calendar', text: 'Embeddable calendar', included: d.embedCalendar },
    { key: 'seats', text: d.seats > 0 ? `${d.seats} team logins` : 'Team logins', included: d.seats > 0, emphasis: d.seats > 0 },
  ];
  // A logged-in DJ sees only the features for their own account type; a
  // logged-out visitor (djType null, e.g. the front-page pricing) sees all,
  // each with a type label so it's clear which DJ type it applies to.
  if (djType !== 'club') {
    feats.push({ key: 'planner', text: 'Planner & Playlist (Mobile DJs)', included: true });
  }
  if (djType !== 'mobile') {
    feats.push({ key: 'rider', text: 'DJ Rider (Club/Bar DJs)', included: true });
    feats.push({ key: 'guestlist', text: 'Guest list (Club/Bar DJs)', included: true });
  }
  return feats;
}

function planName(tier: Tier): string {
  return TIER_LABELS[tier] ?? 'Free';
}

// Full feature list for a tier, ordered for display: Booking Engine pinned
// first, then the items that are new or increased vs the tier below (flagged
// `hot`), then the rest. `hot` drives the inline highlight. For the lowest paid
// tier (no `prev`), its own emphasis items are treated as the highlights.
type OrderedFeat = Feat & { hot: boolean };
function orderedFeatures(d: TierDef, prev: TierDef | null, djType?: 'mobile' | 'club' | null): OrderedFeat[] {
  const prevByKey = prev
    ? new Map(planFeatures(prev, djType).filter((f) => f.included).map((f) => [f.key, f.text]))
    : null;
  const feats: OrderedFeat[] = planFeatures(d, djType).map((f) => {
    const hot = !f.included
      ? false
      : prevByKey
        ? (!prevByKey.has(f.key) || prevByKey.get(f.key) !== f.text)
        : !!f.emphasis;
    return { ...f, hot };
  });
  const rank = (f: OrderedFeat) => (f.key === 'booking' ? 0 : f.hot ? 1 : 2);
  return feats.map((f, i) => [f, i] as const)
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([f]) => f);
}

const CHECK_SVG = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const X_SVG = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function SubscribeInner({ isLoggedIn, currentTier, currentState, source, accessUntil, compUntil, djType, currentInterval }: Props) {
  const searchParams = useSearchParams();
  const subResult = searchParams.get('sub'); // 'success' | 'cancelled' | null

  const isSubscribed = currentTier >= 1;
  // Complimentary (admin/code) access has no Stripe subscription, so we hide
  // all the billing controls (manage/switch/cancel) and label it as comp.
  const isComp = source === 'admin' || source === 'code';
  const isPaid = source === 'stripe';
  const accessUntilLabel = accessUntil
    ? new Date(accessUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  // If a paid subscriber ALSO has a comp that outlasts their billing period,
  // cancelling doesn't drop them at period end — the comp keeps them active
  // until its date. So the "active until" date on a scheduled cancel is the
  // LATER of the two.
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const periodMs = accessUntil ? new Date(accessUntil).getTime() : 0;
  const compMs = compUntil ? new Date(compUntil).getTime() : 0;
  const cancelEndLabel = compMs > periodMs && compUntil
    ? fmtDate(compUntil)
    : accessUntilLabel;

  // Open on the interval the DJ is already billed at, so their current plan
  // reads as current and the OTHER interval is one toggle away.
  const [interval, setBillingInterval] = useState<Interval>(currentInterval ?? 'monthly');
  const [loadingTier, setLoadingTier] = useState<PaidTier | null>(null);
  // When set, the embedded Stripe Checkout renders in an on-site modal.
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switchingTier, setSwitchingTier] = useState<PaidTier | null>(null);
  const [switchMsg, setSwitchMsg] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelInfo, setCancelInfo] = useState<{ scheduled: boolean; date: string | null } | null>(null);
  const [previewingTier, setPreviewingTier] = useState<PaidTier | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<
    { tier: PaidTier; label: string; forward: string; amountDue: number | null; currency: string; interval: Interval } | null
  >(null);

  const money = (cents: number, cur: string) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format(cents / 100);

  async function subscribe(tier: PaidTier) {
    setError(null);
    setLoadingTier(tier);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, interval, embedded: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { clientSecret?: string; error?: string };
      if (res.status === 401) {
        window.location.href = '/login?redirect=/subscribe';
        return;
      }
      if (!res.ok || !data.clientSecret) {
        throw new Error(data.error || 'Could not start checkout. Please try again.');
      }
      setClientSecret(data.clientSecret);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoadingTier(null);
    }
  }

  // Update the card ON-SITE: fetch an embedded setup session and mount it in the
  // same modal the subscription checkout uses — no redirect to Stripe's portal.
  async function updateCard() {
    setError(null);
    setCardLoading(true);
    try {
      const res = await fetch('/api/stripe/update-card', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { clientSecret?: string; error?: string };
      if (res.status === 401) {
        window.location.href = '/login?redirect=/subscribe';
        return;
      }
      if (!res.ok || !data.clientSecret) {
        throw new Error(data.error || 'Could not start card update.');
      }
      setClientSecret(data.clientSecret);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setCardLoading(false);
    }
  }

  // Step 1 — ask Stripe what switching would cost right now, then open the
  // confirmation dialog so the DJ sees the charge before committing.
  async function requestSwitch(tier: PaidTier, label: string, forward: string, targetInterval: Interval = interval) {
    setError(null);
    setSwitchMsg(null);
    setPreviewingTier(tier);
    try {
      const res = await fetch('/api/stripe/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, interval: targetInterval, preview: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; amountDue?: number | null; currency?: string };
      if (res.status === 401) { window.location.href = '/login?redirect=/subscribe'; return; }
      if (!res.ok) throw new Error(data.error || 'Could not preview the change.');
      setPendingSwitch({
        tier,
        label,
        forward,
        amountDue: typeof data.amountDue === 'number' ? data.amountDue : null,
        currency: data.currency || 'usd',
        interval: targetInterval,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setPreviewingTier(null);
    }
  }

  // Step 2 — confirmed: update the existing subscription (no Stripe portal).
  async function changePlan(tier: PaidTier, targetInterval: Interval = interval) {
    setError(null);
    setSwitchMsg(null);
    setSwitchingTier(tier);
    try {
      const res = await fetch('/api/stripe/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, interval: targetInterval }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.status === 401) {
        window.location.href = '/login?redirect=/subscribe';
        return;
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Could not change your plan.');
      }
      // The webhook writes the new tier a moment later — reload to reflect it.
      setPendingSwitch(null);
      setSwitchMsg('Plan updated — refreshing\u2026');
      setTimeout(() => window.location.reload(), 1600);
    } catch (e) {
      setPendingSwitch(null);
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSwitchingTier(null);
    }
  }

  // On-site cancel / resume (no Stripe portal). Cancel is at period end.
  async function cancelSub(action: 'cancel' | 'resume') {
    setError(null);
    setCancelBusy(true);
    try {
      const res = await fetch('/api/stripe/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; cancelAtPeriodEnd?: boolean; periodEnd?: string | null };
      if (res.status === 401) { window.location.href = '/login?redirect=/subscribe'; return; }
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not update your subscription.');
      setConfirmCancel(false);
      setCancelInfo({ scheduled: !!data.cancelAtPeriodEnd, date: data.periodEnd || null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setCancelBusy(false);
    }
  }

  // Which tiers to render: the current one when subscribed, else all paid tiers.
  // Everyone sees every tier: new visitors + comps to pick a plan, paid
  // subscribers to switch. (A comp can subscribe mid-comp — billing starts when
  // the comp ends; see the checkout route's trial_end.)
  const visibleTiers = PAID_TIERS;

  return (
    <div className={styles.wrap}>
      {/* Embedded Stripe Checkout — renders on-site in a modal overlay. */}
      {clientSecret && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            overflowY: 'auto', padding: '2rem 1rem',
          }}
        >
          <div style={{ width: '100%', maxWidth: 560, background: '#fff', borderRadius: 14, overflow: 'hidden', position: 'relative' }}>
            <button
              type="button"
              onClick={() => setClientSecret(null)}
              aria-label="Close"
              style={{
                position: 'absolute', top: 10, right: 12, zIndex: 2,
                background: 'rgba(0,0,0,.06)', border: 'none', borderRadius: 999,
                width: 30, height: 30, fontSize: 18, cursor: 'pointer', color: '#333',
              }}
            >
              ×
            </button>
            <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        </div>
      )}

      {subResult === 'success' && (
        <div className={styles.success}>
          &#10003; You&apos;re subscribed! Your plan is now active.
        </div>
      )}
      {subResult === 'cancelled' && (
        <div className={styles.notice}>
          Checkout was cancelled &mdash; you haven&apos;t been charged.
        </div>
      )}

      {/* Subscribed banner */}
      {isSubscribed && (
        <div className={styles.currentBanner}>
          You&apos;re on the <strong>{planName(currentTier)}</strong> plan
          {isComp && <span className={styles.compTag}>{' '}complimentary</span>}.
          {isComp && accessUntilLabel && (
            <span className={styles.graceNote}>{' '}Access through {accessUntilLabel}.</span>
          )}
          {isPaid && accessUntilLabel && currentState === 'active' && (
            <span className={styles.graceNote}>
              {' '}{cancelInfo?.scheduled ? `Active until ${cancelEndLabel}.` : `Renews ${accessUntilLabel}.`}
            </span>
          )}
          {currentState === 'grace' && (
            <span className={styles.graceNote}>
              {' '}Your last payment didn&apos;t go through — please update your card to keep your access.
            </span>
          )}
        </div>
      )}

      <div className={styles.header}>
        <div className={styles.eyebrow}>Membership</div>
        <h1 className={styles.title}>
          {isPaid ? 'Your Plan' : 'Choose Your Plan'}
        </h1>

        {/* Interval toggle — buying (new/comp) and switching (paid). */}
        {(!isPaid || isSubscribed) && (
          <div className={styles.toggle}>
            <button
              type="button"
              className={`${styles.toggleBtn} ${interval === 'monthly' ? styles.toggleActive : ''}`}
              onClick={() => setBillingInterval('monthly')}
            >
              Monthly
            </button>
            <button
              type="button"
              className={`${styles.toggleBtn} ${interval === 'yearly' ? styles.toggleActive : ''}`}
              onClick={() => setBillingInterval('yearly')}
            >
              Yearly
              <span className={styles.saveTag}>2 months free</span>
            </button>
          </div>
        )}
      </div>

      {isComp && !isPaid && accessUntilLabel && (
        <div className={styles.compBanner}>
          You&apos;re complimentary through {accessUntilLabel} &mdash; subscribe now and billing starts then, with no charge until.
        </div>
      )}
      {error && <div className={styles.error}>{error}</div>}
      {switchMsg && <div className={styles.success}>{switchMsg}</div>}

      <div className={styles.cards}>
        {visibleTiers.map((tier) => {
          const def = TIERS[tier];
          const price = fmtPrice(interval === 'monthly' ? def.monthlyPrice : def.yearlyPrice);
          const period = interval === 'monthly' ? '/mo' : '/yr';
          // Current = the tier you're on, whether that's a paid subscription OR
          // a complimentary grant. For a PAID subscriber whose billing interval
          // we know, the card is only "current" when the toggled interval also
          // matches — so switching monthly⇄yearly on the same tier surfaces a
          // Switch button instead of dead-ending on "current plan". Comps and
          // unknown-interval subs fall back to tier-only (no interval switch).
          const sameTier = isSubscribed && currentTier === tier;
          const isCurrent = sameTier && (!isPaid || !currentInterval || interval === currentInterval);
          // A same-tier switch is really a billing-interval change, not a tier move.
          const isIntervalSwitch = sameTier && isPaid && !!currentInterval && interval !== currentInterval;
          const isLoading = loadingTier === tier;
          // When subscribed, the neon-green featured treatment marks the plan
          // they're managing (the current one) — not "Most Popular". When just
          // browsing, the featured tier gets the Most Popular highlight.
          const featured = isSubscribed ? isCurrent : tier === FEATURED_TIER;
          // The current (managed) plan is always neon green; browsing keeps each
          // tier's own accent.
          const accent = isSubscribed && isCurrent ? '#00e0a4' : TIER_ACCENTS[tier];
          // Buyable only when a Stripe price ID exists for this tier+interval.
          const purchasable = !!priceIdFor(tier, interval);

          // v3 price parts + progressive feature ordering.
          const prevDef = tier > 1 ? TIERS[(tier - 1) as PaidTier] : null;
          const feats = orderedFeatures(def, prevDef, djType);
          const priceNum = interval === 'monthly' ? def.monthlyPrice : def.yearlyPrice;
          const amtStr = priceNum.toFixed(2);
          const perLabel = interval === 'monthly' ? '/ month' : '/ year';
          const altLine = interval === 'monthly'
            ? `or ${fmtPrice(def.yearlyPrice)} / yr`
            : `or ${fmtPrice(def.monthlyPrice)} / mo`;
          void price; void period; // superseded by the parts above

          return (
            <div
              key={tier}
              className={`${styles.card} ${featured ? styles.cardFeatured : ''} ${isCurrent ? styles.cardCurrent : ''}`}
              style={{ ['--accent' as string]: TIER_ACCENTS[tier] } as React.CSSProperties}
            >
              <div className={styles.hero}>
                {featured && <span className={styles.popularBadge}>Most Popular</span>}
                <div className={styles.planName}>{def.label}</div>
                <div className={styles.price}>
                  <span className={styles.cur}>$</span>
                  <span className={styles.amt}>{amtStr}</span>
                  <span className={styles.period}>{perLabel}</span>
                </div>
                <div className={styles.yr}>{altLine}</div>
              </div>
              <div className={styles.body}>
              <ul className={styles.featList}>
                {feats.map((feat) => (
                  <li
                    key={feat.key}
                    className={`${styles.feat} ${feat.included ? '' : styles.featOff} ${feat.hot ? styles.featHot : ''}`}
                  >
                    <span aria-hidden className={styles.featChk}>{feat.included ? CHECK_SVG : X_SVG}</span>
                    <span>{feat.text}</span>
                  </li>
                ))}
              </ul>

              {!isPaid && !isCurrent && (
                <>
                  <button
                    type="button"
                    className={styles.subscribeBtn}
                    onClick={() => subscribe(tier)}
                    disabled={loadingTier !== null || !purchasable}
                    title={!purchasable ? 'Not available yet' : undefined}
                  >
                    {!purchasable ? 'Coming soon' : isLoading ? 'Redirecting\u2026' : 'Subscribe'}
                  </button>

                </>
              )}

              {isSubscribed && isPaid && !isCurrent && (
                <button
                  type="button"
                  className={styles.subscribeBtn}
                  onClick={() => requestSwitch(tier, def.label, `${price}${period}`)}
                  disabled={switchingTier !== null || previewingTier !== null || !purchasable}
                  title={!purchasable ? 'Not available yet' : undefined}
                >
                  {!purchasable ? 'Coming soon' : previewingTier === tier ? 'Checking\u2026' : switchingTier === tier ? 'Switching\u2026' : isIntervalSwitch ? `Switch to ${interval} billing` : `Switch to ${def.label}`}
                </button>
              )}

              {isSubscribed && isCurrent && isPaid && (() => {
                // On the plan they're on, offer a one-click switch to the OTHER
                // billing interval (monthly⇄yearly) right here — no need to flip
                // the top toggle first. Only when we know their current interval.
                const other: Interval | null = currentInterval === 'monthly' ? 'yearly' : currentInterval === 'yearly' ? 'monthly' : null;
                const otherPrice = other ? fmtPrice(other === 'monthly' ? def.monthlyPrice : def.yearlyPrice) : '';
                const otherPeriod = other === 'monthly' ? '/mo' : '/yr';
                const busySwitch = previewingTier === tier || switchingTier === tier;
                return (
                  <div style={{ textAlign: 'center', padding: '.4rem 0 0' }}>
                    <div style={{ fontWeight: 700, color: 'var(--neon,#00e0a4)', fontSize: '.95rem', padding: '.2rem 0 .5rem' }}>
                      {'✓'} Your current plan
                    </div>
                    {other && purchasable && (
                      <button
                        type="button"
                        className={styles.switchLink}
                        onClick={() => requestSwitch(tier, def.label, `${otherPrice}${otherPeriod}`, other)}
                        disabled={switchingTier !== null || previewingTier !== null}
                      >
                        {busySwitch
                          ? 'Checking…'
                          : other === 'yearly'
                            ? 'Switch To Yearly'
                            : 'Switch To Monthly'}
                      </button>
                    )}
                  </div>
                );
              })()}

              {isSubscribed && isCurrent && isComp && (
                <div className={styles.compNote}>
                  Complimentary access
                  {accessUntilLabel ? ` through ${accessUntilLabel}` : ''} — no billing.
                </div>
              )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Confirm-switch dialog — shows the exact prorated charge before committing. */}
      {pendingSwitch && (() => {
        const p = pendingSwitch;
        const willCharge = typeof p.amountDue === 'number' && p.amountDue > 0;
        const willCredit = typeof p.amountDue === 'number' && p.amountDue === 0;
        const busy = switchingTier === p.tier;
        return (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
            onClick={(e) => { if (e.target === e.currentTarget && !busy) setPendingSwitch(null); }}
          >
            <div style={{ background: 'var(--panel,#14141c)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '1.6rem', maxWidth: 430, width: '100%', textAlign: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: '1.15rem', marginBottom: '.7rem' }}>Switch to {p.label}?</div>
              <p style={{ color: 'var(--muted,#9a9ab0)', fontSize: '.92rem', lineHeight: 1.55, margin: '0 0 1.2rem' }}>
                {willCharge ? (
                  <>You&apos;ll be charged{' '}
                    <strong style={{ color: 'var(--white,#fff)' }}>{money(p.amountDue as number, p.currency)}</strong>{' '}
                    now for the rest of this billing period, then{' '}
                    <strong style={{ color: 'var(--white,#fff)' }}>{p.forward}</strong> going forward. Your plan changes immediately.</>
                ) : willCredit ? (
                  <>No charge now &mdash; you&apos;ll get account credit for the unused time, then pay{' '}
                    <strong style={{ color: 'var(--white,#fff)' }}>{p.forward}</strong> going forward. Your plan changes immediately.</>
                ) : (
                  <>You&apos;ll be charged the prorated difference for the days left in this billing period, then{' '}
                    <strong style={{ color: 'var(--white,#fff)' }}>{p.forward}</strong> going forward. Your plan changes immediately.</>
                )}
              </p>
              <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'center' }}>
                <button type="button" className={styles.manageBtn} onClick={() => setPendingSwitch(null)} disabled={busy}>
                  Keep current plan
                </button>
                <button type="button" className={styles.subscribeBtn} onClick={() => changePlan(p.tier, p.interval)} disabled={busy}>
                  {busy ? 'Switching…' : willCharge ? `Pay ${money(p.amountDue as number, p.currency)} & switch` : 'Confirm switch'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Subscribed → one row of ACTION BUTTONS: Booking Settings + (for paid)
          Update payment method + Cancel subscription, side by side. */}
      {isSubscribed && (
        <div className={styles.manageRow} style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem', justifyContent: 'center', alignItems: 'center' }}>
          {isPaid && !cancelInfo?.scheduled && !confirmCancel && (
            <>
              <button
                type="button"
                onClick={updateCard}
                disabled={cardLoading}
                style={{
                  width: 'auto', border: '1px solid var(--neon,#00e0a4)', background: 'transparent',
                  color: 'var(--neon,#00e0a4)', borderRadius: 10, padding: '0.85rem 1.2rem',
                  fontSize: '0.95rem', fontWeight: 700, cursor: cardLoading ? 'default' : 'pointer',
                  opacity: cardLoading ? 0.6 : 1,
                }}
              >
                {cardLoading ? 'Opening…' : 'Update payment method'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                style={{
                  width: 'auto', border: '1px solid rgba(255,120,120,.55)', background: 'transparent',
                  color: '#ff8b8b', borderRadius: 10, padding: '0.85rem 1.2rem',
                  fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer',
                }}
              >
                Cancel subscription
              </button>
            </>
          )}
        </div>
      )}

      {/* Scheduled-cancel notice — inline status once a cancel is queued. */}
      {isSubscribed && isPaid && cancelInfo?.scheduled && (
        <div className={styles.manageRow} style={{ display: 'flex', flexDirection: 'column', gap: '.6rem', alignItems: 'center', marginTop: '1rem' }}>
          <span style={{ fontSize: '.85rem', color: 'var(--muted,#8a8aa0)' }}>
            Your subscription is set to cancel
            {cancelInfo.date ? ` on ${new Date(cancelInfo.date).toLocaleDateString()}` : ''}. You keep access until then.
          </span>
          <button type="button" className={styles.manageBtn} onClick={() => cancelSub('resume')} disabled={cancelBusy}>
            {cancelBusy ? 'Working…' : 'Resume subscription'}
          </button>
        </div>
      )}

      {/* Cancel confirmation — styled modal popup (matches the switch dialog). */}
      {isSubscribed && isPaid && confirmCancel && !cancelInfo?.scheduled && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
          onClick={(e) => { if (e.target === e.currentTarget && !cancelBusy) setConfirmCancel(false); }}
        >
          <div style={{ background: 'var(--panel,#14141c)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '1.6rem', maxWidth: 430, width: '100%', textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: '1.15rem', marginBottom: '.7rem' }}>Cancel your subscription?</div>
            <p style={{ color: 'var(--muted,#9a9ab0)', fontSize: '.92rem', lineHeight: 1.55, margin: '0 0 1.2rem' }}>
              You&apos;ll keep full access until the end of your current billing period, and you can resume any time before then.
            </p>
            <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                disabled={cancelBusy}
                style={{ width: 'auto', border: '1px solid var(--neon,#00e0a4)', background: 'transparent', color: 'var(--neon,#00e0a4)', borderRadius: 10, padding: '0.8rem 1.2rem', fontSize: '0.95rem', fontWeight: 700, cursor: cancelBusy ? 'default' : 'pointer' }}
              >
                Keep plan
              </button>
              <button
                type="button"
                onClick={() => cancelSub('cancel')}
                disabled={cancelBusy}
                style={{ width: 'auto', border: 'none', background: '#ff5f5f', color: '#2a0000', borderRadius: 10, padding: '0.8rem 1.2rem', fontSize: '0.95rem', fontWeight: 700, cursor: cancelBusy ? 'default' : 'pointer', opacity: cancelBusy ? 0.6 : 1 }}
              >
                {cancelBusy ? 'Cancelling…' : 'Yes, cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!isLoggedIn && (
        <div className={styles.manageRow}>
          <span className={styles.loginHint}>Choosing a plan will ask you to sign in first.</span>
        </div>
      )}
    </div>
  );
}

export default function SubscribeClient(props: Props) {
  return (
    <Suspense fallback={null}>
      <SubscribeInner {...props} />
    </Suspense>
  );
}
