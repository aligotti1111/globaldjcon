// /upcoming-bookings — DJ-only page showing all future approved bookings
// (real + DJ-added manual entries), grouped by month, most recent first.
//
// Auth/redirect rules:
//   - Not logged in → /login
//   - Logged in but role is not a DJ → /booking-requests (since the page is
//     DJ-specific; hosts/venues don't have an "own schedule" view)
//
// Data shape sent to the client:
//   - bookings: future-dated rows where dj_id matches the logged-in user AND
//     (status = 'approved' OR is_manual = true).
//   - djType: 'mobile' or 'club' so the form/list can vary fields.
//   - bookingsPerDay: the mobile DJ's daily cap; ignored for club.
//
// Manual booking inserts and deletes happen client-side via Supabase RLS;
// server only renders the initial list.

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
  // Real-booking metadata: present for non-manual rows, useful for context
  requester_name?: string | null;
  package_title?: string | null;
  notes?: string | null;
}

export default async function UpcomingBookingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Fetch the DJ's role + bookings_per_day to gate access + drive form rules.
  const { data: profile } = await supabase
    .from('users')
    .select('role, dj_type, bookings_per_day')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null; dj_type: string | null; bookings_per_day: number | null }>();

  // Only DJs (mobile or club) get this page. Hosts/venues fall back to
  // booking-requests where their outgoing list lives.
  const role = profile?.role || '';
  const djType = profile?.dj_type || '';
  const isDj = role === 'dj' || role === 'mobile_dj' || role === 'club_dj' || djType === 'mobile' || djType === 'club';
  if (!isDj) redirect('/booking-requests');

  // Today's date in YYYY-MM-DD format (server-side timezone — Supabase stores
  // event_date as a plain date, so a string compare against today is fine).
  const today = new Date().toISOString().slice(0, 10);

  // Pull future approved-or-manual bookings for this DJ. Sort ascending by
  // date so the list naturally reads earliest → latest; we'll group on the
  // client. Limit 200 — DJs almost never have more queued; if they do we
  // can paginate later.
  const { data: rows } = await supabase
    .from('bookings')
    .select('id, event_date, start_time, end_time, venue_name, venue_type, event_type, booking_type, is_manual, requester_name, package_title, notes')
    .eq('dj_id', user.id)
    .gte('event_date', today)
    .or('status.eq.approved,is_manual.eq.true')
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(200);

  // Normalize djType: if profile.dj_type isn't set, infer from role.
  let resolvedDjType: 'club' | 'mobile' = 'mobile';
  if (djType === 'club' || role === 'club_dj') resolvedDjType = 'club';
  else if (djType === 'mobile' || role === 'mobile_dj') resolvedDjType = 'mobile';

  return (
    <UpcomingBookingsClient
      userId={user.id}
      djType={resolvedDjType}
      bookingsPerDay={profile?.bookings_per_day ?? 1}
      initialBookings={(rows || []) as UpcomingBooking[]}
    />
  );
}
