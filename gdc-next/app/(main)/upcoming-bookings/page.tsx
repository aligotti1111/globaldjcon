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
import { parseBookingSettings, type BookingSettings } from '../[slug]/bookingSettings';
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
  venue_address: string | null;
  venue_lat: number | null;
  venue_lon: number | null;
  venue_type: string | null;
  set_type: string | null;
  equipment: string | null;
  room_details: string | null;
  guest_count: number | null;
  event_type: string | null;
  event_details: string | null;
  booking_type: string | null;
  is_manual: boolean;
  flyer_url?: string | null;
  // Host invitation fields — only meaningful for manual bookings.
  host_email?: string | null;
  host_email_sent_at?: string | null;
  requester_name?: string | null;
  requester_id?: string | null;
  phone?: string | null;
  package_title?: string | null;
  package_details?: string | null;
  package_category?: string | null;
  package_index?: number | null;
  cocktail_needed?: boolean | null;
  cocktail_start_time?: string | null;
  cocktail_same_room?: boolean | null;
  cocktail_price?: number | null;
  cocktail_included?: boolean | null;
  setup_hours?: string | null;
  quoted_rate?: number | null;
  counter_rate?: number | null;
  overtime_rate?: number | null;
  offer_amount?: number | null;
  deposit_pct?: number | null;
  deposit_amount?: number | null;
  currency?: string | null;
  notes?: string | null;
  status?: string | null;
  created_at?: string;
}

interface ProfileRow {
  role: string | null;
  dj_type: string | null;
  country: string | null;
  name: string | null;
  booking_settings: string | null;
}

export default async function UpcomingBookingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('users')
    .select('role, dj_type, country, name, booking_settings')
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();

  if (profile?.role !== 'dj') redirect('/booking-requests');

  const djType: 'club' | 'mobile' = profile?.dj_type === 'club' ? 'club' : 'mobile';
  // booking_settings is stored as a JSON string (same as the public profile),
  // so parse it before reading packages / per-day limit. Guard the rare case
  // where it's already an object.
  const settings: BookingSettings | null = (() => {
    const raw = profile?.booking_settings as unknown;
    if (typeof raw === 'string') return parseBookingSettings(raw);
    return (raw as BookingSettings | null) || null;
  })();
  const bookingsPerDay = settings?.mob_bookings_per_day || 1;
  const djCountry = profile?.country || 'United States';
  const djName = profile?.name || 'Your DJ';

  // Today's date in YYYY-MM-DD (server-side; Supabase stores event_date as
  // a plain date so a string compare works).
  const today = new Date().toISOString().slice(0, 10);

  // Fetch future approved-or-manual bookings for this DJ.
  const { data: rows } = await supabase
    .from('bookings')
    .select('id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, set_type, equipment, room_details, guest_count, event_type, event_details, booking_type, is_manual, flyer_url, host_email, host_email_sent_at, requester_name, requester_id, phone, package_title, package_details, package_category, package_index, cocktail_needed, cocktail_start_time, cocktail_same_room, cocktail_price, cocktail_included, setup_hours, quoted_rate, counter_rate, overtime_rate, offer_amount, deposit_pct, deposit_amount, currency, notes, status, created_at')
    .eq('dj_id', user.id)
    .gte('event_date', today)
    .or('status.eq.approved,is_manual.eq.true')
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(200);

  // Backfill the booker (host) name from requester_id when not already
  // denormalized on the row, so the "Booked By" field shows a name.
  let bookingRows = (rows || []) as UpcomingBooking[];
  const missingRequesterIds = [
    ...new Set(
      bookingRows
        .filter((b) => !b.requester_name && b.requester_id)
        .map((b) => b.requester_id as string)
    ),
  ];
  if (missingRequesterIds.length > 0) {
    const { data: rRows } = await supabase
      .from('users')
      .select('id, name')
      .in('id', missingRequesterIds);
    const rMap = Object.fromEntries(
      (((rRows as { id: string; name: string | null }[] | null) || []).map((r) => [r.id, r.name]))
    );
    bookingRows = bookingRows.map((b) =>
      b.requester_name ? b : { ...b, requester_name: rMap[b.requester_id as string] || null }
    );
  }

  // Resolve each priced booking's overtime rate from the DJ's package
  // definition when it wasn't snapshotted onto the row (older bookings).
  // A value stored on the row always wins; otherwise fall back to the live
  // package (category-specific, then the general package at the same index).
  const mobPackages = settings?.mob_packages;
  if (mobPackages) {
    bookingRows = bookingRows.map((b) => {
      if (b.overtime_rate != null || b.package_index == null) return b;
      const cat = b.package_category || '';
      const idx = b.package_index;
      const ot =
        mobPackages[cat]?.[idx]?.overtime ??
        mobPackages['general']?.[idx]?.overtime ??
        null;
      const otNum = ot != null ? Number(ot) : NaN;
      return otNum > 0 ? { ...b, overtime_rate: otNum } : b;
    });
  }

  return (
    <UpcomingBookingsClient
      userId={user.id}
      djType={djType}
      djCountry={djCountry}
      djName={djName}
      bookingsPerDay={bookingsPerDay}
      initialBookings={bookingRows}
      mobPackages={mobPackages ?? null}
    />
  );
}
