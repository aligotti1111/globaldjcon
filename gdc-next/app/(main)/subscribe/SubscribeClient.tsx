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
import Link from 'next/link';
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

interface Props {
  isLoggedIn: boolean;
  currentTier: Tier;
  currentState: AccessState;
  // Where the current access comes from: 'stripe' = paid subscription,
  // 'admin'/'code' = complimentary (comp), null = none.
  source: AccessSource;
  // End date of the current access (paid period end or comp expiry), ISO.
  accessUntil: string | null;
  // The DJ's type — tailors club-only vs mobile-only feature bullets. null =
  // logged-out / unknown, in which case both sets show.
  djType?: 'mobile' | 'club' | null;
}

function fmtPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

// Itemized feature list built from the tier's flags — no hand-written copy to
// drift from the table. `included` drives the check vs cross styling.
function planFeatures(d: TierDef, djType?: 'mobile' | 'club' | null): { text: string; included: boolean; emphasis?: boolean }[] {
  const feats: { text: string; included: boolean; emphasis?: boolean }[] = [
    { text: 'Take bookings', included: d.booking },
    { text: `${d.contractQuota} signed contracts / month`, included: d.contractQuota > 0, emphasis: true },
    { text: 'Deposits', included: d.proFeatures },
    { text: 'Invoicing', included: d.proFeatures },
    { text: 'Receipts', included: d.proFeatures },
    { text: 'Inbox messaging', included: true },
    { text: 'QR code to your profile', included: d.qrCode },
    { text: `${d.photos} profile photos`, included: d.photos > 0, emphasis: true },
    { text: `${d.videos} videos`, included: d.videos > 0, emphasis: true },
    { text: `${d.mixes} mixes`, included: d.mixes > 0, emphasis: true },
    { text: 'Embeddable calendar', included: d.embedCalendar },
  ];
  // Mobile-DJ-only extras (also shown to logged-out visitors: djType null).
  if (djType !== 'club') {
    feats.push({ text: 'Event planner', included: true });
    feats.push({ text: 'Playlist & song requests', included: true });
  }
  // Club/Bar-DJ-only extras.
  if (djType !== 'mobile') {
    feats.push({ text: 'Send rider', included: true });
    feats.push({ text: 'Guest list', included: true });
  }
  return feats;
}

function planName(tier: Tier): string {
  return TIER_LABELS[tier] ?? 'Free';
}

function SubscribeInner({ isLoggedIn, currentTier, currentState, source, accessUntil, djType }: Props) {
  const searchParams = useSearchParams();
  const subResult = searchParams.get('sub'); // 'success' | 'cancelled' | null

  const isSubscribed = currentTier >= 1;
  // Complimentary (admin/code) access has no Stripe subscription, so we hide
  // all the billing controls (manage/switch/cancel) and label it as comp.
  const isComp = source === 'admin' || source === 'code';
  const isPaid = source === 'stripe';
  const accessUntilLabel = accessUntil
    ? new Date(accessUntil).toLocaleDateString()
    : null;

  const [interval, setBillingInterval] = useState<Interval>('monthly');
  const [loadingTier, setLoadingTier] = useState<PaidTier | null>(null);
  // When set, the embedded Stripe Checkout renders in an on-site modal.
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switchingTier, setSwitchingTier] = useState<PaidTier | null>(null);
  const [switchMsg, setSwitchMsg] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelInfo, setCancelInfo] = useState<{ scheduled: boolean; date: string | null } | null>(null);

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

  async function openPortal() {
    setError(null);
    setPortalLoading(true);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.status === 401) {
        window.location.href = '/login?redirect=/subscribe';
        return;
      }
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Could not open the billing portal.');
      }
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setPortalLoading(false);
    }
  }

  // In-app plan switch — updates the existing subscription (no Stripe portal).
  async function changePlan(tier: PaidTier) {
    setError(null);
    setSwitchMsg(null);
    setSwitchingTier(tier);
    try {
      const res = await fetch('/api/stripe/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, interval }),
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
      setSwitchMsg('Plan updated — refreshing\u2026');
      setTimeout(() => window.location.reload(), 1600);
    } catch (e) {
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
          {currentState === 'grace' && (
            <span className={styles.graceNote}>
              {' '}Your last payment didn&apos;t go through — please update your card to keep your access.
            </span>
          )}
        </div>
      )}

      <div className={styles.header}>
        <h1 className={styles.title}>
          {isPaid ? 'Your plan' : 'Choose your plan'}
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
          const isCurrent = isPaid && currentTier === tier;
          const isLoading = loadingTier === tier;
          const featured = tier === FEATURED_TIER;
          // Buyable only when a Stripe price ID exists for this tier+interval.
          const purchasable = !!priceIdFor(tier, interval);

          return (
            <div
              key={tier}
              className={`${styles.card} ${featured ? styles.cardFeatured : ''} ${isCurrent ? styles.cardCurrent : ''}`}
            >
              {featured && <div className={styles.popularBadge}>Most Popular</div>}
              {isCurrent && <div className={styles.currentBadge}>Current plan</div>}
              <div className={styles.planName}>{def.label}</div>
              <div className={styles.price}>
                {price}
                <span className={styles.period}>{period}</span>
              </div>
              <ul className={styles.blurb} style={{ listStyle: 'none', margin: '0 0 1rem', padding: 0, display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                {planFeatures(def, djType).map((feat) => (
                  <li key={feat.text} style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', opacity: feat.included ? 1 : 0.45 }}>
                    <span aria-hidden style={{ color: feat.included ? 'var(--neon,#00e0a4)' : 'var(--muted,#8a8aa0)', fontWeight: 700, lineHeight: 1.4 }}>
                      {feat.included ? '\u2713' : '\u2717'}
                    </span>
                    <span style={feat.emphasis && feat.included ? { fontWeight: 700, color: 'var(--white,#fff)' } : undefined}>{feat.text}</span>
                  </li>
                ))}
              </ul>

              {!isPaid && (
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
                  onClick={() => changePlan(tier)}
                  disabled={switchingTier !== null || !purchasable}
                  title={!purchasable ? 'Not available yet' : undefined}
                >
                  {!purchasable ? 'Coming soon' : switchingTier === tier ? 'Switching\u2026' : `Switch to ${def.label}`}
                </button>
              )}

              {isSubscribed && isCurrent && isPaid && (
                <button
                  type="button"
                  className={styles.manageCardBtn}
                  onClick={openPortal}
                  disabled={portalLoading}
                >
                  {portalLoading ? 'Opening…' : 'Manage plan'}
                </button>
              )}

              {isSubscribed && isCurrent && isComp && (
                <div className={styles.compNote}>
                  Complimentary access
                  {accessUntilLabel ? ` through ${accessUntilLabel}` : ''} — no billing.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Subscribed → send them to set up / activate booking. */}
      {isSubscribed && (
        <div className={styles.manageRow}>
          <Link href="/booking-settings" className={styles.subscribeBtn} style={{ textDecoration: 'none', display: 'inline-block' }}>
            Go to Booking Settings
          </Link>
        </div>
      )}

      {/* Bottom manage — on-site cancel / resume; card update still via portal. */}
      {isSubscribed && isPaid && (
        <div className={styles.manageRow} style={{ flexDirection: 'column', gap: '.6rem', alignItems: 'center' }}>
          {cancelInfo?.scheduled ? (
            <>
              <span style={{ fontSize: '.85rem', color: 'var(--muted,#8a8aa0)' }}>
                Your subscription is set to cancel
                {cancelInfo.date ? ` on ${new Date(cancelInfo.date).toLocaleDateString()}` : ''}. You keep access until then.
              </span>
              <button type="button" className={styles.manageBtn} onClick={() => cancelSub('resume')} disabled={cancelBusy}>
                {cancelBusy ? 'Working…' : 'Resume subscription'}
              </button>
            </>
          ) : confirmCancel ? (
            <>
              <span style={{ fontSize: '.85rem', color: 'var(--muted,#8a8aa0)' }}>
                Cancel your subscription? You&apos;ll keep access until the end of the current billing period.
              </span>
              <div style={{ display: 'flex', gap: '.5rem' }}>
                <button type="button" className={styles.manageBtn} onClick={() => setConfirmCancel(false)} disabled={cancelBusy}>
                  Keep plan
                </button>
                <button type="button" className={styles.manageBtn} onClick={() => cancelSub('cancel')} disabled={cancelBusy}>
                  {cancelBusy ? 'Cancelling…' : 'Yes, cancel'}
                </button>
              </div>
            </>
          ) : (
            <>
              <button type="button" className={styles.manageBtn} onClick={openPortal} disabled={portalLoading}>
                {portalLoading ? 'Opening…' : 'Update payment method'}
              </button>
              <button type="button" className={styles.manageBtn} onClick={() => setConfirmCancel(true)}>
                Cancel subscription
              </button>
            </>
          )}
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
