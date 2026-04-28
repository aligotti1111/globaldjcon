// Homepage — DJ directory.
// SERVER COMPONENT: fetches the full DJ list with all fields needed for
// filtering/sorting/rendering. The client component handles search,
// filters, view toggle, near-me geolocation, and country picker.
//
// Fetched fields cover both grid + list view needs and any client-side
// filtering: location data for distance, booking_settings for the
// list-view "Book" button, etc. We pull more than the previous version
// (which only had basic display fields).

import { createClient } from '@/lib/supabase/server';
import HomeClient, { type HomeDj } from './HomeClient';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await createClient();

  const { data: djs } = await supabase
    .from('users')
    .select(`
      id, name, slug, dj_type,
      city, state, country, zip,
      avatar_url, rate, travel_distance,
      booking_settings, profile_private
    `)
    .eq('role', 'dj')
    .not('slug', 'is', null)
    // Hide intentionally-private profiles from the directory.
    .or('profile_private.is.null,profile_private.eq.false')
    .order('created_at', { ascending: false })
    .returns<HomeDj[]>();

  return <HomeClient initialDjs={djs || []} />;
}
