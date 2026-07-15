// /upcoming-bookings — DJ-only page showing all FUTURE approved bookings
// (real + DJ-added manual entries), grouped by month. Past events live on the
// dedicated /past-bookings page (same client component in `archive` mode).
//
// Auth/redirect rules:
//   - Not logged in → /login
//   - Logged in but role is not 'dj' → /booking-requests
//
// Data shape sent to the client:
//   - bookings: ALL rows where dj_id matches the logged-in user AND
//     (status = 'approved' OR is_manual = true) — past and future.
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
  original_rate?: number | null;
  discount_code?: string | null;
  discount_label?: string | null;
  discount_amount?: number | null;
  deposit_pct?: number | null;
  deposit_amount?: number | null;
  // Frozen sales-tax snapshot, written at booking creation (null on legacy
  // rows). Display surfaces read THESE — never the DJ's current settings —
  // so later settings changes can't re-price existing bookings.
  tax_pct?: number | null;
  tax_amount?: number | null;
  total_with_tax?: number | null;
  currency?: string | null;
  notes?: string | null;
  status?: string | null;
  created_at?: string;
  contract_submission_id?: string | null;
  contract_status?: string | null;
  contract_sent_at?: string | null;
  contract_signed_at?: string | null;
  // Booking-readiness pipeline: manual step overrides + per-booking snapshot of
  // whether a contract was required at creation time (freezes the flow).
  status_overrides?: Record<string, boolean> | null;
  requires_contract?: boolean | null;
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

  // Today (YYYY-MM-DD). event_date is a plain date, so a string compare works.
  const today = new Date().toISOString().slice(0, 10);

  // Fetch FUTURE approved-or-manual bookings for this DJ. (Past bookings live on
  // the dedicated /past-bookings page.)
  const { data: rows } = await supabase
    .from('bookings')
    .select('id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, set_type, equipment, room_details, guest_count, event_type, event_details, booking_type, is_manual, flyer_url, host_email, host_email_sent_at, requester_name, requester_id, phone, package_title, package_details, package_category, package_index, cocktail_needed, cocktail_start_time, cocktail_same_room, cocktail_price, cocktail_included, setup_hours, quoted_rate, counter_rate, overtime_rate, offer_amount, original_rate, discount_code, discount_label, discount_amount, deposit_pct, deposit_amount, tax_pct, tax_amount, total_with_tax, currency, notes, status, created_at, contract_submission_id, contract_status, contract_sent_at, contract_signed_at, status_overrides, requires_contract')
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

  // NOTE: we deliberately do NOT hydrate overtime_rate from the DJ's current
  // packages. That fallback used to fire whenever the row's overtime_rate was
  // null — but null is ambiguous: it means both "not recorded" AND "this
  // booking genuinely had no overtime rate" (the insert stores null on purpose
  // for quote bookings). So adding an overtime rate to a package retroactively
  // injected that term into already-accepted bookings — and into their
  // contracts, which read overtime_rate. A booking shows only the terms it was
  // made with; "not listed" is the truthful answer.
  // mobPackages is still needed below: the client uses it for the manual
  // add-booking form's package picker.
  const mobPackages = settings?.mob_packages;
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
