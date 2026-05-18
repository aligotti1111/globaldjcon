// /upcoming-bookings — DJ-only page showing all future approved bookings
// (real + DJ-added manual entries), grouped by month.
//
// Auth/redirect rules:
//   - Not logged in → /login
//   - Logged in but role is not 'dj' → /booking-requests
//
// Data shape sent to the client:
//   - bookings: future-dated rows where dj_id matches the logged-in user
//     AND (status = 'approved' OR is_manual = true).
//   - djType: 'mobile' or 'club' (from users.dj_type).
//   - bookingsPerDay: mob_bookings_per_day from users.booking_settings JSON
//     (defaults to 1 if unset). Used only for mobile DJs.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import UpcomingBookingsClient from './UpcomingBookingsClient';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Upcoming Bookings — Global DJ Connect',
  description: 'View and manage your upcoming bookings.',
};

export interface UpcomingBooking {
  id: string;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  venue_type: string | null;
  event_type: string | null;
  booking_type: string | null;
  is_manual: boolean;
  requester_name?: string | null;
  package_title?: string | null;
  notes?: string | null;
}

interface ProfileRow {
  role: string | null;
  dj_type: string | null;
  booking_settings: { mob_bookings_per_day?: number } | null;
}

export default async function UpcomingBookingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Pull role + dj_type + booking_settings. The role is a single value 'dj'
  // (not split into mobile_dj/club_dj — that distinction is in dj_type).
  const { data: profile } = await supabase
    .from('users')
    .select('role, dj_type, booking_settings')
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();

  if (profile?.role !== 'dj') redirect('/booking-requests');

  // Normalize djType. Default to 'mobile' if somehow unset.
  const djType: 'club' | 'mobile' = profile?.dj_type === 'club' ? 'club' : 'mobile';
  const bookingsPerDay = profile?.booking_settings?.mob_bookings_per_day || 1;

  // Today's date in YYYY-MM-DD (server-side; Supabase stores event_date as
  // a plain date so a string compare works).
  const today = new Date().toISOString().slice(0, 10);

  // Fetch future approved-or-manual bookings for this DJ.
  const { data: rows } = await supabase
    .from('bookings')
    .select('id, event_date, start_time, end_time, venue_name, venue_type, event_type, booking_type, is_manual, requester_name, package_title, notes')
    .eq('dj_id', user.id)
    .gte('event_date', today)
    .or('status.eq.approved,is_manual.eq.true')
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(200);

  return (
    <UpcomingBookingsClient
      userId={user.id}
      djType={djType}
      bookingsPerDay={bookingsPerDay}
      initialBookings={(rows || []) as UpcomingBooking[]}
    />
  );
}
