// DJ directory — moved from the homepage (/) to /djs.
// SERVER COMPONENT: fetches the full DJ list with all fields needed for
// filtering/sorting/rendering. The client component handles search,
// filters, view toggle, near-me geolocation, and country picker.
//
// NOTE: HomeClient lives at app/(main)/HomeClient.tsx, so from this
// nested route the import is '../HomeClient' (was './HomeClient' when
// this file sat at app/(main)/page.tsx).

import { createClient } from '@/lib/supabase/server';
import HomeClient, { type HomeDj } from '../HomeClient';

export const revalidate = 300;

export default async function DjsDirectoryPage() {
  const supabase = await createClient();

  const { data: djs } = await supabase
    .from('users')
    .select(`
      id, name, slug, dj_type,
      city, state, country, zip,
      home_lat, home_lon,
      avatar_url, rate, travel_distance,
      booking_settings, profile_private
    `)
    .eq('role', 'dj')
    .not('slug', 'is', null)
    .or('profile_private.is.null,profile_private.eq.false')
    .order('created_at', { ascending: false })
    .returns<HomeDj[]>();

  return <HomeClient initialDjs={djs || []} />;
}
