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
import { getAccess, type AccessFields, type AccessState, type AccessSource, type Tier } from '@/lib/access';
import SubscribeClient from './SubscribeClient';

export const dynamic = 'force-dynamic';

export default async function SubscribePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let currentTier: Tier = 0;
  let currentState: AccessState = 'none';
  let source: AccessSource = null;
  let accessUntil: string | null = null;
  let djType: 'mobile' | 'club' | null = null;

  if (user) {
    const { data } = await supabase
      .from('users')
      .select('sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source, dj_type')
      .eq('id', user.id)
      .maybeSingle();
    const fields = data as unknown as (AccessFields & {
      sub_period_end?: string | null;
      comp_expires_at?: string | null;
      dj_type?: string | null;
    }) | null;
    if (fields?.dj_type === 'club' || fields?.dj_type === 'mobile') djType = fields.dj_type;
    if (fields) {
      const access = getAccess(fields);
      currentTier = access.tier;
      currentState = access.state;
      source = access.source;
      // The relevant end date depends on where access comes from.
      accessUntil =
        access.source === 'stripe'
          ? fields.sub_period_end ?? null
          : access.source === 'admin' || access.source === 'code'
          ? fields.comp_expires_at ?? null
          : null;
    }
  }

  return (
    <SubscribeClient
      isLoggedIn={!!user}
      currentTier={currentTier}
      currentState={currentState}
      source={source}
      accessUntil={accessUntil}
      djType={djType}
    />
  );
}
