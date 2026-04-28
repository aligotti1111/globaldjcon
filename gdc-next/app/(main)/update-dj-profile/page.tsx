// /update-dj-profile — page where DJs configure their listing.
// Faithful port of vanilla update-dj-profile.html shell + auth gating.
//
// Server Component fetches the current user's profile + booking_settings
// once on first render so the client form is hydrated with real values
// instead of flashing empty inputs on mount. Subsequent edits save back
// via the Supabase client SDK.
//
// Tabs in this session: General + Booking (mobile DJ section). Other tabs
// (Socials, Mixes, Photos, Video, Testimonials, Club DJ booking section,
// Embed code, Avatar crop modal, slug availability check, zip lookup)
// are placeholders, to be filled in subsequent sessions.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import UpdateDjProfileClient from './UpdateDjProfileClient';
import type { UserProfile } from '@/types/db';

export const dynamic = 'force-dynamic';

export default async function UpdateDjProfilePage() {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (!authUser) {
    redirect('/login?redirect=/update-dj-profile');
  }

  // Fetch the user row so the client form hydrates with current values.
  // We pull *all* fields the form will ever touch — even ones the deferred
  // tabs use — so they're visible when those tabs come online later.
  const { data: profile, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single();

  if (error || !profile) {
    // Should be impossible — every authenticated user has a row — but
    // guard anyway. The auth callback creates the row on first login.
    redirect('/login?error=profile_not_found');
  }

  // Only DJs can use this page. Hosts and venues have separate forms
  // (account-settings for hosts, venue-profile for venues).
  if (profile.role !== 'dj') {
    redirect('/account-settings');
  }

  return (
    <UpdateDjProfileClient
      initialProfile={profile as UserProfile & {
        // Extra fields beyond the strict UserProfile type — these live on
        // the actual users table and the form needs them. db.ts is incomplete,
        // same as the bookings type. Fixing that is a separate cleanup task.
        bio?: string | null;
        phone?: string | null;
        website?: string | null;
        soundcloud?: string | null;
        instagram?: string | null;
        tiktok?: string | null;
        facebook?: string | null;
        twitch?: string | null;
        avatar_url?: string | null;
        travel_distance?: string | null;
        dj_start_year?: string | null;
        event_types?: string | null;
        club_genres?: string[] | null;
        profile_private?: boolean | null;
        mix_url_1?: string | null;
        mix_url_2?: string | null;
        mix_url_3?: string | null;
        gallery_img_1?: string | null;
        gallery_img_2?: string | null;
        gallery_img_3?: string | null;
        gallery_img_4?: string | null;
        video_url_1?: string | null;
        video_url_2?: string | null;
        video_url_3?: string | null;
        testimonials?: string | null;
      }}
      authEmail={authUser.email || ''}
    />
  );
}
