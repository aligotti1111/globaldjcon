'use client';

// Subscribe page — standalone plan picker at /subscribe.
//
// Shows the two paid tiers with a monthly/yearly toggle. Clicking Subscribe
// POSTs { tier, interval } to /api/stripe/checkout, which returns a Stripe
// Checkout URL; we redirect the browser there. On return, Stripe's webhook
// has written the tier onto the user (see app/api/stripe/webhook/route.ts).
//
// "Manage your plan" opens Stripe's hosted customer portal (cancel, switch
// plan, update card) via /api/stripe/portal.
//
// After checkout, Stripe returns the browser to /subscribe?sub=success (or
// ?sub=cancelled), which drives the banner at the top.
//
// This is a first, functional version — copy approved in chat, styling meant
// to be refined later.

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import styles from './subscribe.module.css';

type Interval = 'monthly' | 'yearly';
type PaidTier = 1 | 2;

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

function SubscribeInner() {
  const searchParams = useSearchParams();
  const subResult = searchParams.get('sub'); // 'success' | 'cancelled' | null

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

      <div className={styles.header}>
        <h1 className={styles.title}>Choose your plan</h1>

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
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.cards}>
        {PLANS.map((plan) => {
          const price = interval === 'monthly' ? plan.monthly : plan.yearly;
          const period = interval === 'monthly' ? '/mo' : '/yr';
          const isLoading = loadingTier === plan.tier;
          return (
            <div
              key={plan.tier}
              className={`${styles.card} ${plan.featured ? styles.cardFeatured : ''}`}
            >
              <div className={styles.planName}>{plan.name}</div>
              <div className={styles.price}>
                {price}
                <span className={styles.period}>{period}</span>
              </div>
              <div className={styles.blurb}>{plan.blurb}</div>
              <button
                type="button"
                className={styles.subscribeBtn}
                onClick={() => subscribe(plan.tier)}
                disabled={loadingTier !== null}
              >
                {isLoading ? 'Redirecting\u2026' : 'Subscribe'}
              </button>
            </div>
          );
        })}
      </div>

      <div className={styles.manageRow}>
        <button
          type="button"
          className={styles.manageBtn}
          onClick={openPortal}
          disabled={portalLoading}
        >
          {portalLoading ? 'Opening\u2026' : 'Already subscribed? Manage your plan'}
        </button>
      </div>
    </div>
  );
}

export default function SubscribePage() {
  return (
    <Suspense fallback={null}>
      <SubscribeInner />
    </Suspense>
  );
}
