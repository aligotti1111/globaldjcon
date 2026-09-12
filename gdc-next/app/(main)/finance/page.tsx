// /finance — the account owner's Finance report. OWNER-ONLY: team members
// (admin/manager/assistant seats) never see money totals, not even via a direct
// link — the gate below 404-redirects anyone whose acting role isn't 'owner'.
//
// What it computes (see lib/finance.ts for the math):
//   • Received  — money actually collected, every rail + paid overtime
//   • Outstanding — invoiced but unconfirmed
//   • Expected  — remaining agreed amount on accepted bookings (incl. accepted
//                 counter-offers), not yet invoiced
//   • In Stripe now / paid out — CARD money only, pulled live from the DJ's
//     connected account (labelled separately so it's never confused with total
//     earnings, which span every rail)
//
// All booking/payment reads use the service-role client, scoped hard to djId —
// same pattern as /upcoming-bookings.

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActingContext, canBilling } from '@/lib/acting';
import { getStripe } from '@/lib/stripe/server';
import { effectiveTimezone, todayInTz } from '@/lib/bookingExpiry';
import { canBook, type AccessFields } from '@/lib/access';
import {
  buildReceivedEvents,
  computeOutstanding,
  buildExpectedItems,
  type FinanceBookingInput,
  type FinancePaymentInput,
} from '@/lib/finance';
import FinanceClient from './FinanceClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Finance — Global DJ Connect',
  description: 'Your earnings, payouts and outstanding balances.',
};

interface ProfileRow {
  role: string | null;
  name: string | null;
  timezone: string | null;
  stripe_connect_id: string | null;
  stripe_connect_ready: boolean | null;
  // Subscription/comp access fields — Finance is a paid feature.
  sub_tier: number | null;
  sub_status: string | null;
  sub_period_end: string | null;
  comp_tier: number | null;
  comp_expires_at: string | null;
  comp_source: string | null;
}

export interface StripeSnapshot {
  connected: boolean;
  ready: boolean;
  available: number | null;   // card money settled, available to pay out
  pending: number | null;     // card money still settling
  paidOutRecent: number | null; // sum of recent payouts to bank
  currency: string;
  error?: string;
}

export default async function FinancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // OWNER-ONLY. A teammate resolves to a non-'owner' acting role; bounce them to
  // the dashboard rather than showing the owner's money.
  const acting = await getActingContext(user.id);
  if (!canBilling(acting.role)) redirect('/upcoming-bookings');

  const djId = acting.djId;
  const admin = createAdminClient() as unknown as SupabaseClient;

  const { data: profileData } = await admin
    .from('users')
    .select('role, name, timezone, stripe_connect_id, stripe_connect_ready, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source')
    .eq('id', djId)
    .maybeSingle<ProfileRow>();
  const profile = profileData;
  // Owner gate already passed (canBilling). Only bounce genuine host accounts —
  // don't hard-require role === 'dj', so a query hiccup can never lock an owner
  // out of their own finances.
  if (profile?.role === 'host') redirect('/booking-requests');
  // Finance is a paid feature — free (never-subscribed / lapsed, no comp)
  // accounts get sent to the plans page instead.
  if (!profile || !canBook(profile as unknown as AccessFields)) redirect('/subscribe');

  // All bookings for this DJ (past + future), excluding soft-deleted. Only the
  // financial columns the report needs.
  const { data: bRows } = await admin
    .from('bookings')
    .select('id, event_date, status, accepted_at, event_type, venue_name, booking_type, tax_amount, total_with_tax, counter_rate, quoted_rate, offer_amount, currency, overtime_amount, overtime_tax, overtime_paid_at, deposit_amount, deposit_pct, deposit_completed_at, balance_completed_at, status_overrides')
    .eq('dj_id', djId)
    .is('deleted_at', null)
    .limit(2000);
  const bookings = (bRows || []) as FinanceBookingInput[];

  // The ledger for those bookings. booking_payments has no dj_id, so scope by
  // the booking ids we just loaded. Chunk the .in() to stay well under URL limits.
  const ids = bookings.map((b) => b.id);
  const db = admin as unknown as SupabaseClient;
  let payments: FinancePaymentInput[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (chunk.length === 0) break;
    const { data: pRows } = await db
      .from('booking_payments')
      .select('id, booking_id, kind, amount, amount_paid, status, method, currency, confirmed_at, requested_at, marked_sent_at, due_date')
      .in('booking_id', chunk);
    payments = payments.concat((pRows || []) as FinancePaymentInput[]);
  }

  const events = buildReceivedEvents(bookings, payments);
  const outstanding = computeOutstanding(bookings, payments);

  // Primary currency = most common on the bookings (fallback to profile/USD).
  const curCount = new Map<string, number>();
  for (const b of bookings) {
    const c = (b.currency || '').toUpperCase();
    if (c) curCount.set(c, (curCount.get(c) || 0) + 1);
  }
  const primaryCurrency =
    [...curCount.entries()].sort((a, z) => z[1] - a[1])[0]?.[0] || 'USD';

  // Live Stripe snapshot — CARD money only. Best-effort; never blocks the page.
  const stripeSnap: StripeSnapshot = {
    connected: !!profile?.stripe_connect_id,
    ready: !!profile?.stripe_connect_ready,
    available: null,
    pending: null,
    paidOutRecent: null,
    currency: primaryCurrency,
  };
  if (profile?.stripe_connect_id) {
    try {
      const stripe = getStripe();
      const acct = profile.stripe_connect_id;
      // The connected-account selector is a REQUEST OPTION (2nd arg), not a
      // params field — passing it first would read the platform's own balance.
      const bal = await stripe.balance.retrieve({}, { stripeAccount: acct });
      const sum = (arr: { amount: number; currency: string }[] | undefined) =>
        (arr || []).reduce((s, x) => s + x.amount, 0) / 100;
      stripeSnap.available = Number(sum(bal.available).toFixed(2));
      stripeSnap.pending = Number(sum(bal.pending).toFixed(2));
      if (bal.available?.[0]?.currency) stripeSnap.currency = bal.available[0].currency.toUpperCase();
      try {
        const payouts = await stripe.payouts.list({ limit: 100 }, { stripeAccount: acct });
        const paidOut = (payouts.data || [])
          .filter((p) => p.status === 'paid')
          .reduce((s, p) => s + p.amount, 0) / 100;
        stripeSnap.paidOutRecent = Number(paidOut.toFixed(2));
      } catch { /* payouts optional */ }
    } catch (e) {
      stripeSnap.error = e instanceof Error ? e.message : 'Could not reach Stripe.';
    }
  }

  // "Today" in the DJ's timezone, not UTC — so month/period boundaries flip at
  // the DJ's local midnight instead of at 8pm ET.
  const today = todayInTz(effectiveTimezone(profile?.timezone, null));
  const expectedItems = buildExpectedItems(bookings, payments, today);

  return (
    <FinanceClient
      events={events}
      outstanding={outstanding}
      expectedItems={expectedItems}
      stripe={stripeSnap}
      primaryCurrency={primaryCurrency}
      djName={profile?.name || 'Your'}
      today={today}
    />
  );
}
