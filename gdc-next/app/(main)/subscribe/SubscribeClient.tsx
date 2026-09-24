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

import { Suspense, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { STRIPE_PUBLISHABLE_KEY, priceIdFor } from '@/lib/stripe/config';

// Stripe.js loaded once, module-level (recommended).
const stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
import type { AccessState, AccessSource, Tier } from '@/lib/access';
import { TIERS, TIER_LABELS, type TierDef } from '@/lib/access';
import RedeemCodeBox from './RedeemCodeBox';
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
  // Set to cancel at period end (read from Stripe on the server), so the banner
  // shows "Active until <date>" even after a reload — not only in the session
  // where they clicked cancel.
  cancelScheduled?: boolean;
  // Live site-wide PERCENT sales (from the server). The cards show the bigger of
  // any matching sale and the DJ's applied code.
  liveSales?: { percentOff: number; appliesTo: 'monthly' | 'yearly' | 'both' }[];
}

function fmtPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

// One row in the Invoices dialog (shape returned by /api/stripe/invoices).
interface InvoiceItem {
  id: string;
  number: string;
  dateText: string;
  amount: number;
  currency: string;
  status: string;
  description: string;
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
    // Photos — with named albums to group them on Premium Pro + up.
    { key: 'photos', text: d.tier >= 3 ? `${d.photos} photos + albums` : `${d.photos} photos`, included: d.photos > 0, emphasis: true },
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

function SubscribeInner({ isLoggedIn, currentTier, currentState, source, accessUntil, compUntil, djType, currentInterval, cancelScheduled = false, liveSales = [] }: Props) {
  const searchParams = useSearchParams();
  const subResult = searchParams.get('sub'); // 'success' | 'cancelled' | null

  const isSubscribed = currentTier >= 1;
  // Complimentary (admin/code) access has no Stripe subscription, so we hide
  // all the billing controls (manage/switch/cancel) and label it as comp.
  const isComp = source === 'admin' || source === 'code' || source === 'sale';
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

  // A comp that runs more than 2 years out can't have billing added early:
  // Stripe caps a scheduled first charge (trial_end) at 730 days, and we won't
  // start billing before the free period ends. So we hide "Add Billing" for
  // these and show a note instead — they can add a card once the comp is within
  // 2 years. (The comp end for a comp is accessUntil.)
  const TWO_YEARS_MS = 730 * 24 * 60 * 60 * 1000;
  const compEndMs = accessUntil ? new Date(accessUntil).getTime() : 0;
  const compTooFar = isComp && compEndMs > Date.now() + TWO_YEARS_MS;

  // Open on the interval requested via ?interval (carried from signup), else the
  // one the DJ is already billed at, so their current plan reads as current and
  // the OTHER interval is one toggle away.
  const intervalParam = searchParams.get('interval');
  const initialInterval: Interval = intervalParam === 'yearly' || intervalParam === 'monthly'
    ? intervalParam
    : (currentInterval ?? 'monthly');
  const [interval, setBillingInterval] = useState<Interval>(initialInterval);
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
  // Invoices — loaded lazily when the DJ opens the Invoices dialog.
  const [invoicesOpen, setInvoicesOpen] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceItem[] | null>(null);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Effective scheduled-cancel state: the client value once they click cancel/
  // resume this session, otherwise the server value read from Stripe — so a
  // reload still shows "set to cancel / Resume" instead of Cancel again.
  const cancelIsScheduled = cancelInfo?.scheduled ?? cancelScheduled;
  const cancelEndDate = cancelInfo?.date ?? accessUntil ?? null;
  const [previewingTier, setPreviewingTier] = useState<PaidTier | null>(null);
  // A paid discount code the DJ entered in the promo box before picking a plan.
  // Carried into Stripe checkout so the % comes off automatically, and used to
  // show discounted prices on the cards.
  const [pendingPromo, setPendingPromo] = useState<
    { code: string; description: string; percentOff: number; appliesTo: 'monthly' | 'yearly' | 'both' } | null
  >(null);
  const [pendingSwitch, setPendingSwitch] = useState<
    { tier: PaidTier; label: string; forward: string; amountDue: number | null; currency: string; interval: Interval } | null
  >(null);

  const money = (cents: number, cur: string) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format(cents / 100);

  async function subscribe(tier: PaidTier, promoOverride?: string) {
    setError(null);
    setLoadingTier(tier);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, interval, embedded: true, promoCode: (promoOverride ?? pendingPromo?.code) || undefined }),
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

  // Auto-start checkout when the DJ arrives having ALREADY picked a paid plan on
  // the signup page (?plan=N&interval=…&code=…). They chose the plan once — don't
  // make them pick it again here; open the embedded Stripe checkout straight
  // away. Only for a purchasable paid tier and a not-yet-paid account; a free
  // plan or a comp never reaches here (signup sends those to the success screen).
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    const t = Number(searchParams.get('plan'));
    if (!(t >= 1 && t <= 4)) return;
    if (isPaid) return;
    if (!priceIdFor(t as PaidTier, interval)) return;
    autoStartedRef.current = true;
    // Pass any signup code straight through so its discount rides along without
    // waiting for the promo box's async preview.
    subscribe(t as PaidTier, searchParams.get('code') || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Open the Invoices dialog, loading the list on first open. Comps never reach
  // here (the button is gated on isPaid) — and even if they did, the list shows
  // the REAL Stripe amounts, so a comp's $0 trial invoice reads $0, never the
  // plan price.
  async function openInvoices() {
    setInvoicesOpen(true);
    if (invoices) return;
    setError(null);
    setInvoicesLoading(true);
    try {
      const res = await fetch('/api/stripe/invoices');
      const data = (await res.json().catch(() => ({}))) as { invoices?: InvoiceItem[]; error?: string };
      if (res.status === 401) { window.location.href = '/login?redirect=/subscribe'; return; }
      if (!res.ok) throw new Error(data.error || 'Could not load your invoices.');
      setInvoices(data.invoices || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setInvoicesOpen(false);
    } finally {
      setInvoicesLoading(false);
    }
  }

  // Download our Global-DJ-Connect-branded PDF for one invoice.
  async function downloadInvoice(inv: InvoiceItem) {
    setDownloadingId(inv.id);
    try {
      const res = await fetch(`/api/stripe/invoices?id=${encodeURIComponent(inv.id)}&download=1`);
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || 'Could not download the invoice.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GlobalDJConnect-Invoice-${inv.number.replace(/[^\w-]/g, '')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setDownloadingId(null);
    }
  }

  const invMoney = (n: number, cur: string) => {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format(n); }
    catch { return `$${n.toFixed(2)}`; }
  };

  // The best discount that applies to the CURRENT interval — the bigger of the
  // DJ's entered code and any live site-wide sale that covers this interval.
  // Drives the discounted prices on every card (they all share the interval).
  const bestDiscount = (() => {
    const matches = (a: string) => a === 'both' || a === interval;
    const cands: { pct: number; appliesTo: 'monthly' | 'yearly' | 'both' }[] = [];
    if (pendingPromo && matches(pendingPromo.appliesTo)) cands.push({ pct: pendingPromo.percentOff, appliesTo: pendingPromo.appliesTo });
    for (const s of liveSales) if (matches(s.appliesTo)) cands.push({ pct: s.percentOff, appliesTo: s.appliesTo });
    if (!cands.length) return null;
    return cands.reduce((a, b) => (b.pct > a.pct ? b : a));
  })();
  // Headline for the sale banner (the biggest live sale %, any interval).
  const topSalePct = liveSales.reduce((m, s) => Math.max(m, s.percentOff), 0);

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
          {isComp && !isPaid && (
            <span className={styles.graceNote}>{' '}Select a package and add your billing information to begin your subscription immediately after the promotion ends.</span>
          )}
          {isPaid && accessUntilLabel && currentState === 'active' && (
            <span className={styles.graceNote}>
              {' '}{(cancelInfo?.scheduled ?? cancelScheduled) ? `Active until ${cancelEndLabel}.` : `Renews ${accessUntilLabel}.`}
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

      {topSalePct > 0 && (
        <div
          className={styles.success}
          style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto 1.25rem', fontWeight: 700 }}
        >
          🔥 Limited-time sale — up to {topSalePct}% off, applied automatically.
        </div>
      )}
      {isLoggedIn && (
        <RedeemCodeBox
          variant="link"
          initialCode={searchParams.get('code') || undefined}
          onDiscount={(code, description, percentOff, appliesTo) => {
            setPendingPromo({ code, description, percentOff, appliesTo });
            // Flip the toggle to the interval the code is for, so its discount
            // is what the DJ sees (a yearly code → show yearly prices).
            if (appliesTo === 'yearly') setBillingInterval('yearly');
            else if (appliesTo === 'monthly') setBillingInterval('monthly');
          }}
        />
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
          // Discounted price on the card = the best discount for this interval
          // (a code or a live site-wide sale, bigger wins; computed once above).
          const discPct = bestDiscount?.pct ?? 0;
          const scope = bestDiscount?.appliesTo ?? 'both';
          const showDisc = discPct > 0;
          const discAmt = showDisc ? priceNum * (1 - discPct / 100) : priceNum;
          const discStr = discAmt.toFixed(2);
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
                {/* "Most Popular" always marks the marketing pick (Pro), no
                    matter what the viewer is currently subscribed to. The
                    current-plan card gets its own neon-border treatment via
                    `featured`; the badge text is reserved for Pro. */}
                {tier === FEATURED_TIER && <span className={styles.popularBadge}>Most Popular</span>}
                <div className={styles.planName}>{def.label}</div>
                <div className={styles.price}>
                  <span className={styles.cur}>$</span>
                  <span className={styles.amt}>{showDisc ? discStr : amtStr}</span>
                  <span className={styles.period}>{perLabel}</span>
                </div>
                {showDisc ? (
                  <div className={styles.yr}>
                    <span style={{ textDecoration: 'line-through', opacity: 0.6, marginRight: 6 }}>${amtStr}</span>
                    {scope === 'both'
                      ? `${discPct}% off every ${interval === 'monthly' ? 'month' : 'year'}`
                      : `${discPct}% off first ${interval === 'monthly' ? 'month' : 'year'}, then $${amtStr}`}
                  </div>
                ) : (
                  <div className={styles.yr}>{altLine}</div>
                )}
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
                <>
                  {/* A comp is temporary access, NOT a paid plan — so still offer
                      Subscribe here so they can keep this plan past the free
                      period. Checkout starts a Stripe trial ending at the comp's
                      expiry, so there's no charge until then (see the checkout
                      route's trial_end).

                      EXCEPTION: a comp more than 2 years out can't have billing
                      scheduled yet (Stripe's trial_end cap), so hide the button
                      and tell them to add it later. */}
                  {compTooFar ? (
                    <p style={{ textAlign: 'center', fontSize: '.85rem', color: 'var(--muted,#9a9ab0)', lineHeight: 1.5, margin: '.4rem 0 0' }}>
                      You&apos;re covered through {accessUntilLabel}. You can add billing once your
                      complimentary access is within 2 years of ending — no card needed until then.
                    </p>
                  ) : (
                    <button
                      type="button"
                      className={styles.subscribeBtn}
                      onClick={() => subscribe(tier)}
                      disabled={loadingTier !== null || !purchasable}
                      title={!purchasable ? 'Not available yet' : undefined}
                      style={{ background: '#fff', color: '#000' }}
                    >
                      {!purchasable ? 'Coming soon' : isLoading ? 'Redirecting…' : 'Add Billing'}
                    </button>
                  )}
                  {/* No per-card note — the complimentary/billing message already
                      shows in the banner above the plans. */}
                </>
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

      {/* Subscribed (PAID) → the Manage Subscription toolbar: Invoices, Update
          payment method, Cancel subscription. Comps never see this — they have
          no Stripe subscription to manage or invoice for the plan amount. */}
      {isSubscribed && isPaid && !cancelIsScheduled && !confirmCancel && (
        <div className={styles.managePanel}>
          <div className={styles.manageHeading}>Manage Subscription</div>
          <div className={styles.manageToolbar}>
            <button
              type="button"
              className={`${styles.toolBtn}`}
              onClick={openInvoices}
              disabled={invoicesLoading}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1z" /><path d="M8 8h8M8 12h8M8 16h5" />
              </svg>
              {invoicesLoading ? 'Loading…' : 'Invoices'}
            </button>
            <button
              type="button"
              className={`${styles.toolBtn} ${styles.toolBtnPrimary}`}
              onClick={updateCard}
              disabled={cardLoading}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" />
              </svg>
              {cardLoading ? 'Opening…' : 'Update payment'}
            </button>
            <button
              type="button"
              className={`${styles.toolBtn} ${styles.toolBtnDanger}`}
              onClick={() => setConfirmCancel(true)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" />
              </svg>
              Cancel subscription
            </button>
          </div>
        </div>
      )}

      {/* Invoices dialog — the DJ's subscription billing history, each row with a
          branded-PDF download. Real Stripe amounts, so a $0 trial reads $0. */}
      {invoicesOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
          onClick={(e) => { if (e.target === e.currentTarget) setInvoicesOpen(false); }}
        >
          <div style={{ background: 'var(--panel,#14141c)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '1.4rem 1.5rem 1.6rem', maxWidth: 520, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.9rem' }}>
              <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>Invoices</div>
              <button type="button" onClick={() => setInvoicesOpen(false)} aria-label="Close" style={{ background: 'rgba(255,255,255,.06)', border: 'none', borderRadius: 999, width: 30, height: 30, fontSize: 18, cursor: 'pointer', color: '#fff' }}>×</button>
            </div>
            <div style={{ overflowY: 'auto' }}>
              {invoicesLoading && <div style={{ color: 'var(--muted,#9a9ab0)', fontSize: '.9rem', padding: '1rem 0' }}>Loading your invoices…</div>}
              {!invoicesLoading && invoices && invoices.length === 0 && (
                <div style={{ color: 'var(--muted,#9a9ab0)', fontSize: '.9rem', padding: '1rem 0' }}>No invoices yet.</div>
              )}
              {!invoicesLoading && invoices && invoices.map((inv) => {
                const paid = inv.status === 'paid';
                return (
                  <div key={inv.id} className={styles.invoiceRow}>
                    <div className={styles.invoiceMeta}>
                      <span className={styles.invoiceDate}>
                        {inv.dateText}
                        <span className={`${styles.invoiceStatus} ${paid ? styles.invoiceStatusPaid : styles.invoiceStatusOpen}`}>
                          {paid ? 'Paid' : inv.status}
                        </span>
                      </span>
                      <span className={styles.invoiceSub}>{inv.description} · #{inv.number}</span>
                    </div>
                    <span className={styles.invoiceAmt}>{invMoney(inv.amount, inv.currency)}</span>
                    <button
                      type="button"
                      className={styles.invoiceDownload}
                      onClick={() => downloadInvoice(inv)}
                      disabled={downloadingId === inv.id}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      {downloadingId === inv.id ? '…' : 'PDF'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Scheduled-cancel notice — inline status once a cancel is queued. */}
      {isSubscribed && isPaid && cancelIsScheduled && (
        <div className={styles.manageRow} style={{ display: 'flex', flexDirection: 'column', gap: '.6rem', alignItems: 'center', marginTop: '1rem' }}>
          <span style={{ fontSize: '.85rem', color: 'var(--muted,#8a8aa0)' }}>
            Your subscription is cancelled. If you would like to reactivate it, click Resume below.
          </span>
          <button type="button" className={styles.manageBtn} onClick={() => cancelSub('resume')} disabled={cancelBusy}>
            {cancelBusy ? 'Working…' : 'Resume subscription'}
          </button>
        </div>
      )}

      {/* Cancel confirmation — styled modal popup (matches the switch dialog). */}
      {isSubscribed && isPaid && confirmCancel && !cancelIsScheduled && (
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
