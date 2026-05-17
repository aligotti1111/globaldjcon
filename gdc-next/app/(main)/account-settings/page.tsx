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

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AccountSettingsClient from './AccountSettingsClient';

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
  sms_phone: string | null;
  sms_enabled: boolean | null;
  sms_notify_booking_request: boolean | null;
  sms_notify_booking_status: boolean | null;
  sms_notify_inbox_message: boolean | null;
}

export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) redirect('/login?redirect=/account-settings');

  const { data: profile } = await supabase
    .from('users')
    .select('id, name, slug, role, country, city, state, zip, address, venue_name, blocked_users, phone, sms_phone, sms_enabled, sms_notify_booking_request, sms_notify_booking_status, sms_notify_inbox_message')
    .eq('id', authUser.id)
    .single<ProfileRow>();

  if (!profile) redirect('/login?redirect=/account-settings');

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
      currentEmail={authUser.email || ''}
      initialBlocked={blockedNames}
      initialSmsPrefs={{
        sms_phone: profile.sms_phone || '',
        sms_enabled: !!profile.sms_enabled,
        sms_notify_booking_request: profile.sms_notify_booking_request !== false,
        sms_notify_booking_status: profile.sms_notify_booking_status !== false,
        sms_notify_inbox_message: profile.sms_notify_inbox_message !== false,
      }}
    />
  );
}
