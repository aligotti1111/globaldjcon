// /subscribe — plan picker + subscription management.
//
// Server Component: reads the logged-in user's current subscription standing
// (via the access module) and hands it to the client, so the page can show
// "you're on X / manage" instead of always showing Subscribe buttons. This
// also prevents an already-subscribed DJ from starting a SECOND subscription
// by clicking Subscribe again — subscribed users are routed to the portal.
//
// Logged-out visitors still see the plans (Subscribe bounces them to login).

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAccess, type AccessFields, type AccessState, type AccessSource, type Tier } from '@/lib/access';
import { getStripe } from '@/lib/stripe/server';
import { getLiveSales } from '@/lib/siteSale';
import SubscribeClient from './SubscribeClient';

export const dynamic = 'force-dynamic';

export default async function SubscribePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let currentTier: Tier = 0;
  let currentState: AccessState = 'none';
  let source: AccessSource = null;
  let accessUntil: string | null = null;
  // Admin/code comp expiry, surfaced separately so a paid subscriber who ALSO
  // has a comp beyond their billing period shows "active until <comp date>" if
  // they cancel.
  let compUntil: string | null = null;
  let djType: 'mobile' | 'club' | null = null;
  // Whether a paid subscriber is billed monthly or yearly — so the plan picker
  // can offer "switch to yearly/monthly" on the tier they're already on.
  let currentInterval: 'monthly' | 'yearly' | null = null;
  // Whether the subscription is set to cancel at period end — so the banner
  // reads "Active until <date>" persistently (survives a reload), not just in
  // the session where they clicked cancel.
  let cancelScheduled = false;

  // Live site-wide PERCENT sales → the client shows discounted prices + a banner.
  let liveSales: { percentOff: number; appliesTo: 'monthly' | 'yearly' | 'both' }[] = [];
  try {
    const sales = await getLiveSales(createAdminClient());
    liveSales = sales
      .filter((s) => s.kind === 'percent' && s.percent_off && s.applies_to)
      .map((s) => ({ percentOff: s.percent_off as number, appliesTo: s.applies_to as 'monthly' | 'yearly' | 'both' }));
  } catch { /* no sale */ }

  if (user) {
    const { data } = await supabase
      .from('users')
      .select('sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source, dj_type, stripe_subscription_id')
      .eq('id', user.id)
      .maybeSingle();
    const fields = data as unknown as (AccessFields & {
      sub_period_end?: string | null;
      comp_expires_at?: string | null;
      dj_type?: string | null;
      stripe_subscription_id?: string | null;
    }) | null;
    if (fields?.dj_type === 'club' || fields?.dj_type === 'mobile') djType = fields.dj_type;
    if (fields?.comp_expires_at) compUntil = fields.comp_expires_at;
    if (fields) {
      const access = getAccess(fields);
      currentTier = access.tier;
      currentState = access.state;
      source = access.source;
      // The relevant end date depends on where access comes from.
      accessUntil =
        access.source === 'stripe'
          ? fields.sub_period_end ?? null
          : access.source === 'admin' || access.source === 'code' || access.source === 'sale'
          ? fields.comp_expires_at ?? null
          : null;

      // Read the live billing interval for a paid subscriber. Best-effort: a
      // Stripe hiccup just leaves currentInterval null (the picker falls back to
      // tier-only "current plan" — no interval switch shown, nothing breaks).
      if (access.source === 'stripe' && fields.stripe_subscription_id) {
        try {
          const stripe = getStripe();
          const sub = await stripe.subscriptions.retrieve(fields.stripe_subscription_id);
          const recurring = sub.items?.data?.[0]?.price?.recurring?.interval;
          if (recurring === 'year') currentInterval = 'yearly';
          else if (recurring === 'month') currentInterval = 'monthly';
          cancelScheduled = !!sub.cancel_at_period_end;
        } catch {
          currentInterval = null;
        }
      }
    }
  }

  return (
    <SubscribeClient
      isLoggedIn={!!user}
      currentTier={currentTier}
      currentState={currentState}
      source={source}
      accessUntil={accessUntil}
      compUntil={compUntil}
      djType={djType}
      currentInterval={currentInterval}
      cancelScheduled={cancelScheduled}
      liveSales={liveSales}
    />
  );
}
