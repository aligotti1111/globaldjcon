// /account-settings — page where users edit profile info, email, password,
// and (venue role) venue profile + slug + address.
// Faithful port of vanilla account-settings.html.
//
// Server Component: auth gate + fetch the user's profile + blocked users
// list. The client component handles all the form state + saves.
//
// Available to all roles. Vanilla also shows it to DJs (though it doesn't
// expose the venue card to them). DJs are normally directed to
// /update-dj-profile for their primary profile editing — this page covers
// the universal account stuff (email/password/blocked users).
//
// DEFERRED:
//   - Slug live-check + alternative suggestions (will be a shared helper
//     once we also build the slug check on /signup; until then the
//     uniqueness check happens at save time, with an inline error)
//
// SCOPE NOTES:
//   - Email change uses Supabase Auth's updateUser — sends a confirmation
//     link to the new address, doesn't change the email until clicked.
//   - Password change uses Supabase Auth's updateUser — requires current
//     password verified via signInWithPassword first.
//   - EXCEPT for hosts, who have neither. They sign in with a 6-digit code,
//     so their "email" here is the delivery address on users.contact_email
//     and it saves like any other profile field. See AccountSettingsClient.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AccountSettingsClient from './AccountSettingsClient';
import UpdateDjProfileClient from '@/app/(main)/update-dj-profile/UpdateDjProfileClient';
import type { UserProfile } from '@/types/db';

export const dynamic = 'force-dynamic';

interface ProfileRow {
  id: string;
  name: string | null;
  slug: string | null;
  role: string;
  country: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  address: string | null;
  venue_name: string | null;
  blocked_users: string[] | null;
  phone: string | null;
  // Delivery address for a host who signed up by phone — collected at their
  // first booking. Not a credential.
  contact_email: string | null;
}

export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) redirect('/login?redirect=/account-settings');

  const { data: profile } = await supabase
    .from('users')
    .select('id, name, slug, role, country, city, state, zip, address, venue_name, blocked_users, phone, contact_email')
    .eq('id', authUser.id)
    .single<ProfileRow>();

  if (!profile) redirect('/login?redirect=/account-settings');

  // A DJ's "account settings" IS their profile — so we render the DJ profile
  // editor right here, at the /account-settings URL. (The old /update-dj-profile
  // route now just redirects here, so this is the one canonical URL.) It has
  // their name, email, password, socials, logo — everything. Hosts and venues
  // fall through to the account-settings form below.
  if (profile.role === 'dj') {
    const { data: djData } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();
    const djProfile = djData as UserProfile | null;
    if (!djProfile) redirect('/login?error=profile_not_found');
    return (
      <UpdateDjProfileClient
        initialProfile={djProfile as UserProfile & {
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

  // Resolve names of blocked users so the client can show them. This is the
  // same "blockedUsers" array of UUIDs that booking-requests reads from —
  // only here we hydrate names for display.
  let blockedNames: { id: string; name: string }[] = [];
  const blockedIds = profile.blocked_users || [];
  if (blockedIds.length > 0) {
    const { data: rows } = await supabase
      .from('users')
      .select('id, name')
      .in('id', blockedIds);
    blockedNames = ((rows as { id: string; name: string | null }[] | null) || []).map((r) => ({
      id: r.id,
      name: r.name || 'Unknown User',
    }));
  }

  return (
    <AccountSettingsClient
      initialProfile={{
        id: profile.id,
        name: profile.name || '',
        slug: profile.slug || '',
        role: profile.role,
        country: profile.country || '',
        city: profile.city || '',
        state: profile.state || '',
        zip: profile.zip || '',
        address: profile.address || '',
        venueName: profile.venue_name || '',
      }}
      // Auth email first; then the delivery address. A host who signed up by
      // phone has no auth email, so without the fallback this page showed
      // them an empty Email box while their bookings were being mailed to an
      // address they couldn't see.
      currentEmail={authUser.email || profile.contact_email || ''}
      initialBlocked={blockedNames}
    />
  );
}
