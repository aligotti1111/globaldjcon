// /past-bookings — DJ-only archive of events whose date has passed. Reuses the
// UpcomingBookingsClient in `archive` mode (read-only-ish, newest-first). Not
// gated by subscription, so a DJ keeps their records even if their plan lapses.
//
// Auth/redirect rules:
//   - Not logged in → /login
//   - Logged in but role is not 'dj' → /booking-requests

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import UpcomingBookingsClient from '../upcoming-bookings/UpcomingBookingsClient';
import type { UpcomingBooking, BookingPayment } from '../upcoming-bookings/page';
import { parseBookingSettings, type BookingSettings } from '../[slug]/bookingSettings';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Past Bookings — Global DJ Connect',
  description: 'Your archive of past bookings.',
};

interface ProfileRow {
  role: string | null;
  dj_type: string | null;
  country: string | null;
  name: string | null;
  booking_settings: string | null;
}

export default async function PastBookingsPage() {
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
  const settings: BookingSettings | null = (() => {
    const raw = profile?.booking_settings as unknown;
    if (typeof raw === 'string') return parseBookingSettings(raw);
    return (raw as BookingSettings | null) || null;
  })();
  const bookingsPerDay = settings?.mob_bookings_per_day || 1;
  const djCountry = profile?.country || 'United States';
  const djName = profile?.name || 'Your DJ';

  const today = new Date().toISOString().slice(0, 10);

  // Past approved-or-manual bookings for this DJ (event_date strictly before
  // today), newest first.
  const { data: rows } = await supabase
    .from('bookings')
    .select('id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, set_type, equipment, room_details, guest_count, event_type, event_details, booking_type, is_manual, flyer_url, host_email, host_email_sent_at, requester_name, requester_id, phone, package_title, package_details, package_category, package_index, cocktail_needed, cocktail_start_time, cocktail_same_room, cocktail_price, cocktail_included, setup_hours, quoted_rate, counter_rate, overtime_rate, offer_amount, original_rate, discount_code, discount_label, discount_amount, deposit_pct, deposit_amount, tax_pct, tax_amount, total_with_tax, currency, notes, status, created_at, contract_submission_id, contract_status, contract_sent_at, contract_signed_at, status_overrides, requires_contract')
    .eq('dj_id', user.id)
    .lt('event_date', today)
    .or('status.eq.approved,is_manual.eq.true')
    .order('event_date', { ascending: false })
    .limit(500);

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

  // Payment rows for these bookings, keyed by booking_id. One .in() query.
  // The generated types/supabase.ts predates booking_payments, so
  // .from('booking_payments') on the typed client is a build error — cast to
  // an untyped client for this ONE table (same fix as /api/payments).
  const db = supabase as unknown as SupabaseClient;
  const paymentsByBooking: Record<string, BookingPayment[]> = {};
  const bookingIds = bookingRows.map((b) => b.id);
  if (bookingIds.length > 0) {
    const { data: payRows } = await db
      .from('booking_payments')
      .select('id, booking_id, kind, label, amount, amount_paid, currency, status, method, client_intent, due_date, requested_at')
      .in('booking_id', bookingIds)
      .order('requested_at', { ascending: true });
    for (const p of ((payRows as BookingPayment[] | null) || [])) {
      if (!paymentsByBooking[p.booking_id]) paymentsByBooking[p.booking_id] = [];
      paymentsByBooking[p.booking_id].push(p);
    }
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
      initialPayments={paymentsByBooking}
      archive
    />
  );
}
