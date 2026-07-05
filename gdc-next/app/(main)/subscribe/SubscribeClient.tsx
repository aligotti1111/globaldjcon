'use client';

// SubscribeClient — the interactive part of /subscribe.
//
// Behavior depends on the current subscription (passed from the server page):
//   • Not subscribed (tier 0): show the monthly/yearly toggle + Subscribe
//     buttons → Stripe Checkout.
//   • Subscribed (tier 1/2): show which plan they're on, mark the current
//     card, and route ALL changes (switch/cancel) through the Stripe portal
//     — never a second checkout.
//
// Copy approved in chat; styling to be refined later.

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { AccessState, AccessSource, Tier } from '@/lib/access';
import styles from './subscribe.module.css';

type Interval = 'monthly' | 'yearly';
type PaidTier = 1 | 2;

interface Props {
  isLoggedIn: boolean;
  currentTier: Tier;
  currentState: AccessState;
  // Where the current access comes from: 'stripe' = paid subscription,
  // 'admin'/'code' = complimentary (comp), null = none.
  source: AccessSource;
  // End date of the current access (paid period end or comp expiry), ISO.
  accessUntil: string | null;
}

const PLANS: {
  tier: PaidTier;
  name: string;
  monthly: string;
  yearly: string;
  blurb: string;
  featured?: boolean;
}[] = [
  {
    tier: 1,
    name: 'Booking',
    monthly: '$19.99',
    yearly: '$199.90',
    blurb: 'Take bookings, expanded media, embeddable calendar',
  },
  {
    tier: 2,
    name: 'Pro',
    monthly: '$29.99',
    yearly: '$299.90',
    blurb: 'Everything in Booking, plus contracts, deposits, and event info sheets',
    featured: true,
  },
];

function planName(tier: Tier): string {
  return tier === 2 ? 'Pro' : tier === 1 ? 'Booking' : 'Free';
}

function SubscribeInner({ isLoggedIn, currentTier, currentState, source, accessUntil }: Props) {
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
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function subscribe(tier: PaidTier) {
    setError(null);
    setLoadingTier(tier);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, interval }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.status === 401) {
        window.location.href = '/login?redirect=/subscribe';
        return;
      }
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Could not start checkout. Please try again.');
      }
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
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

  return (
    <div className={styles.wrap}>
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
          {isSubscribed ? 'Your plan' : 'Choose your plan'}
        </h1>

        {/* Interval toggle only matters for new subscriptions. */}
        {!isSubscribed && (
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

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.cards}>
        {PLANS.map((plan) => {
          const price = interval === 'monthly' ? plan.monthly : plan.yearly;
          const period = interval === 'monthly' ? '/mo' : '/yr';
          const isCurrent = isSubscribed && currentTier === plan.tier;
          const isLoading = loadingTier === plan.tier;

          return (
            <div
              key={plan.tier}
              className={`${styles.card} ${plan.featured ? styles.cardFeatured : ''} ${isCurrent ? styles.cardCurrent : ''}`}
            >
              {isCurrent && <div className={styles.currentBadge}>Current plan</div>}
              <div className={styles.planName}>{plan.name}</div>
              <div className={styles.price}>
                {price}
                <span className={styles.period}>{period}</span>
              </div>
              <div className={styles.blurb}>{plan.blurb}</div>

              {!isSubscribed && (
                <button
                  type="button"
                  className={styles.subscribeBtn}
                  onClick={() => subscribe(plan.tier)}
                  disabled={loadingTier !== null}
                >
                  {isLoading ? 'Redirecting\u2026' : 'Subscribe'}
                </button>
              )}

              {isSubscribed && isCurrent && isPaid && (
                <button
                  type="button"
                  className={styles.manageCardBtn}
                  onClick={openPortal}
                  disabled={portalLoading}
                >
                  {portalLoading ? 'Opening\u2026' : 'Manage plan'}
                </button>
              )}

              {isSubscribed && isCurrent && isComp && (
                <div className={styles.compNote}>
                  Complimentary access
                  {accessUntilLabel ? ` through ${accessUntilLabel}` : ''} — no billing.
                </div>
              )}

              {isSubscribed && !isCurrent && isPaid && (
                <button
                  type="button"
                  className={styles.switchBtn}
                  onClick={openPortal}
                  disabled={portalLoading}
                >
                  {portalLoading ? 'Opening\u2026' : `Switch to ${plan.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom manage link — only for a PAID subscription (comps have no
          Stripe billing to manage). */}
      {isSubscribed && isPaid && (
        <div className={styles.manageRow}>
          <button
            type="button"
            className={styles.manageBtn}
            onClick={openPortal}
            disabled={portalLoading}
          >
            {portalLoading ? 'Opening\u2026' : 'Cancel or update payment method'}
          </button>
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
