// /upcoming-events — page for hosts/venues showing all their booked events
// (approved real bookings + manual events they added), nearest first.
//
// Auth/redirect rules:
//   - Not logged in → /login
//   - Logged in as a DJ → /upcoming-bookings (the DJ-side equivalent)
//
// "Events" terminology distinguishes this view from the DJ-side
// "/upcoming-bookings" page. Underlying data is the same `bookings` table —
// these are rows where requester_id matches the current user.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import UpcomingEventsClient from './UpcomingEventsClient';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Upcoming Events — Global DJ Connect',
  description: 'View and manage your upcoming events.',
};

export interface UpcomingEvent {
  id: string;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_lat: number | null;
  venue_lon: number | null;
  venue_type: string | null;
  event_type: string | null;
  booking_type: string | null;
  is_manual: boolean;
  dj_id?: string | null;
  dj_name?: string | null;
  dj_slug?: string | null;
  flyer_url?: string | null;
  link_url?: string | null;
  link_label?: string | null;
  notes?: string | null;
  status?: string | null;
  created_at?: string;
  // Rate fields (visible only to DJ + host who created the booking).
  offer_amount?: number | null;
  currency?: string | null;
  // Mobile / private booking detail fields — shown in the expanded card
  // for mobile bookings so the host sees the full event context.
  room_details?: string | null;
  guest_count?: number | null;
  phone?: string | null;
  package_title?: string | null;
  cocktail_needed?: boolean | null;
  cocktail_start_time?: string | null;
  cocktail_same_room?: boolean | null;
  ceremony_needed?: boolean | null;
  ceremony_start_time?: string | null;
  ceremony_same_room?: boolean | null;
  // Source flag — when present, this booking originated from a DJ-side
  // manual entry. Hosts viewing it can edit detail fields but can't
  // attach a different DJ (the DJ is already locked).
  requester_id?: string | null;
}

interface ProfileRow {
  role: string | null;
  country: string | null;
  name: string | null;
}

export default async function UpcomingEventsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('users')
    .select('role, country, name')
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();

  // DJs have their own equivalent page; bounce them there.
  if (profile?.role === 'dj') redirect('/upcoming-bookings');

  const country = profile?.country || 'United States';
  const userName = profile?.name || 'Your';
  const today = new Date().toISOString().slice(0, 10);

  // Fetch future approved-or-manual bookings made by this host/venue.
  // requester_id is what links a booking to the user who initiated it
  // (or, for manual events, the user who recorded it).
  const { data: rows } = await supabase
    .from('bookings')
    .select('id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, event_type, booking_type, is_manual, dj_id, flyer_url, link_url, link_label, notes, status, created_at, offer_amount, currency, room_details, guest_count, phone, package_title, cocktail_needed, cocktail_start_time, cocktail_same_room, ceremony_needed, ceremony_start_time, ceremony_same_room')
    .eq('requester_id', user.id)
    .gte('event_date', today)
    .or('status.eq.approved,is_manual.eq.true')
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(200);

  // For approved bookings, also look up the DJ name. Manual events without
  // a dj_id have no DJ to look up.
  const events = (rows || []) as UpcomingEvent[];
  const djIds = Array.from(
    new Set(events.map((e) => e.dj_id).filter((id): id is string => !!id)),
  );
  let djInfoById: Record<string, { name: string; slug: string | null }> = {};
  if (djIds.length > 0) {
    const { data: djs } = await supabase
      .from('users')
      .select('id, name, slug')
      .in('id', djIds);
    djInfoById = (djs || []).reduce(
      (acc: Record<string, { name: string; slug: string | null }>, row: { id: string; name: string | null; slug: string | null }) => {
        acc[row.id] = { name: row.name || '', slug: row.slug };
        return acc;
      },
      {},
    );
  }
  for (const e of events) {
    if (e.dj_id && djInfoById[e.dj_id]) {
      e.dj_name = djInfoById[e.dj_id].name || null;
      e.dj_slug = djInfoById[e.dj_id].slug || null;
    }
  }

  return (
    <UpcomingEventsClient
      userId={user.id}
      userCountry={country}
      userName={userName}
      initialEvents={events}
    />
  );
}
