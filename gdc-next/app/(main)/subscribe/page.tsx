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
import { getAccess, type AccessFields, type AccessState, type Tier } from '@/lib/access';
import SubscribeClient from './SubscribeClient';

export const dynamic = 'force-dynamic';

export default async function SubscribePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let currentTier: Tier = 0;
  let currentState: AccessState = 'none';

  if (user) {
    const { data } = await supabase
      .from('users')
      .select('sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source')
      .eq('id', user.id)
      .maybeSingle();
    const fields = data as unknown as AccessFields | null;
    if (fields) {
      const access = getAccess(fields);
      currentTier = access.tier;
      currentState = access.state;
    }
  }

  return (
    <SubscribeClient
      isLoggedIn={!!user}
      currentTier={currentTier}
      currentState={currentState}
    />
  );
}
