// /booking-requests — page where users see incoming + outgoing booking requests.
// Faithful port of vanilla booking-requests.html + br-core.js + br-load-render.js.
//
// SCOPE FOR THIS SESSION (mobile DJ flow only):
//   - Incoming: pending / approved / denied / all  — shown to DJs (mobile)
//   - Outgoing: pending / counter / approved / denied / all  — shown to all roles
//   - Full mobile booking card render with date/time, event info, contact,
//     message, package & price, action buttons
//   - Distance display from stored venue_lat/venue_lon (no need to geocode!)
//   - Outside-travel-range warning to DJ when booking exceeds their travel limit
//   - Approve/Deny + bookings_available decrement
//   - Cancel (outgoing)
//   - Block/Unblock buttons
//   - Same-day grouping for incoming pending
//
// DEFERRED TO LATER SESSIONS:
//   - Counter-offer modal (vanilla br-shared-actions.js openCounter — UI rich)
//   - Quote response modal (vanilla openMobQuoteModal)
//   - Message modal (depends on inbox/messaging system)
//   - Club DJ flow (br-club-flow.js — totally different render path)
//   - Email notifications (deferred globally; vanilla mob_booking_status etc
//     don't exist either, fail silently)
//   - Package edit modal for counters (pkgEditOriginalItems machinery)

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveUserEmail } from '@/lib/supabase/admin';
import type { PaymentMethod } from '@/lib/paymentMethods';
import BookingRequestsClient from './BookingRequestsClient';

export const dynamic = 'force-dynamic';

interface BookingRow {
  id: string;
  dj_id: string;
  requester_id: string;
  dj_slug: string | null;
  booking_type: string | null;
  event_date: string | null;
  event_type: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_lat: number | null;
  venue_lon: number | null;
  room_details: string | null;
  guest_count: number | null;
  start_time: string | null;
  end_time: string | null;
  phone: string | null;
  cocktail_needed: boolean | null;
  cocktail_start_time: string | null;
  cocktail_same_room: boolean | null;
  package_title: string | null;
  package_category: string | null;
  package_index: number | null;
  package_details: string | null;
  quoted_rate: number | null;
  counter_rate: number | null;
  overtime_rate: number | null;
  // Discount snapshot (from the booking form). quoted_rate is already the
  // DISCOUNTED total; original_rate holds the pre-discount price.
  original_rate: number | null;
  discount_code: string | null;
  discount_label: string | null;
  discount_amount: number | null;
  // ── Club-DJ specific fields ─────────────────────────────────────
  // Vanilla writes these on club bookings only; null for mobile.
  venue_type: string | null;          // 'bar' | 'club'
  set_type: string | null;            // 'opening' | 'headliner' | 'closing' | 'opening_close' | 'opening_and_closing'
  equipment: string | null;           // 'sound_system' | 'decks_only' | 'venue_provides'
  venue_equip_detail: string | null;  // free text when equipment = 'venue_provides'
  offer_amount: number | null;        // when DJ accepts offers
  country: string | null;
  currency: string | null;
  // Optional message attached to a counter offer or quote response
  counter_message: string | null;
  // Negotiation log: append-only array of { from, amount, message, created_at }
  // Stored as JSON. Populated when DJ or booker counters; vanilla schema is jsonb.
  negotiation_log: Array<{
    from: 'dj' | 'booker';
    amount: number;
    message: string;
    created_at: string;
  }> | null;
  deposit_pct: number | null;
  deposit_amount: number | null;
  // Frozen sales-tax snapshot, written at booking creation (null on legacy
  // rows). tax_amount / total_with_tax stay null for quote-mode bookings
  // until a price exists — QuoteModal fills them when the DJ sets the price.
  // Rows arrive via select('*'), so no query change is needed here.
  tax_pct: number | null;
  tax_amount: number | null;
  total_with_tax: number | null;
  // Cocktail pricing — only for mobile DJ wedding bookings
  cocktail_price: number | null;
  cocktail_included: boolean | null;
  setup_hours: string | null;
  is_quote: boolean | null;
  // Set when the DJ explicitly sends a drafted quote to the booker.
  // Null = rate may be drafted (quoted_rate set) but not yet visible to booker.
  // Non-null = booker can see the price and respond. Club + quote-mode only;
  // for mobile and non-quote bookings, quoted_rate alone signals "sent".
  quote_sent_at: string | null;
  notes: string | null;
  status: string | null;
  created_at: string;
  updated_at: string | null;
  // Backfilled denormalized name fields (vanilla also backfills these in JS;
  // we do it server-side instead so the client renders synchronously.)
  dj_name?: string | null;
  requester_name?: string | null;
  // DJ contact info — only stitched onto APPROVED outgoing rows so the booker
  // can reach the DJ to coordinate the gig. Never sent for pending/denied.
  dj_phone?: string | null;
  dj_email?: string | null;
}

// One booking_payments row — the manual-payment ledger (see
// payments-setup.sql). amount = what the DJ asked for; amount_paid = what the
// DJ has confirmed actually arrived.
export interface BookingPayment {
  id: string;
  booking_id: string;
  kind: string;               // 'deposit' | 'balance' | 'other'
  label?: string | null;
  amount: number;
  amount_paid: number;
  currency: string | null;
  status: string;             // requested | pending_confirmation | partial | paid | waived
  method: string | null;
  client_intent: string | null; // 'pay_now' | 'pay_at_event' | null
  due_date: string | null;
  requested_at?: string | null;
}

export default async function BookingRequestsPage() {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) redirect('/login?redirect=/booking-requests');

  // Fetch the current user's profile — we need role + dj_type + zip + travel +
  // blocked_users for filtering and distance / warning logic. Also pull
  // booking_settings so we can extract depositPct for the Quote modal.
  const { data: me } = await supabase
    .from('users')
    .select('id, name, role, dj_type, zip, city, state, travel_distance, blocked_users, booking_settings')
    .eq('id', authUser.id)
    .single<{
      id: string;
      name: string | null;
      role: string;
      dj_type: 'mobile' | 'club' | null;
      zip: string | null;
      city: string | null;
      state: string | null;
      travel_distance: string | null;
      blocked_users: string[] | null;
      booking_settings: string | null;
    }>();

  if (!me) redirect('/login?redirect=/booking-requests');

  const blockedUsers = me.blocked_users || [];

  // Outgoing: requests this user made (as requester). All roles see this.
  const { data: outRows } = await supabase
    .from('bookings')
    .select('*')
    .eq('requester_id', authUser.id)
    .order('created_at', { ascending: false });
  let outgoing: BookingRow[] = (outRows as BookingRow[] | null) || [];

  // Incoming: requests sent TO this user. DJs only.
  // For mobile DJs, they're the bookings their public profile generated.
  // For club DJs, vanilla also includes incoming — but we're deferring the
  // club render; their bookings still load and outgoing still works.
  let incoming: BookingRow[] = [];
  if (me.role === 'dj') {
    const { data: inRows } = await supabase
      .from('bookings')
      .select('*')
      .eq('dj_id', authUser.id)
      .order('created_at', { ascending: false });
    incoming = ((inRows as BookingRow[] | null) || []).filter(
      (b) => !blockedUsers.includes(b.requester_id)
    );
  }

  // Backfill denormalized names server-side. Vanilla does this in JS after
  // load; doing it here means the client component renders cleanly without
  // a second fetch flicker.
  const missingDjIds = [
    ...new Set(outgoing.filter((b) => !b.dj_name && b.dj_id).map((b) => b.dj_id)),
  ];
  if (missingDjIds.length > 0) {
    const { data: djRows } = await supabase
      .from('users')
      .select('id, name')
      .in('id', missingDjIds);
    const djMap = Object.fromEntries(((djRows as { id: string; name: string | null }[] | null) || []).map((d) => [d.id, d.name]));
    outgoing = outgoing.map((b) => (b.dj_name ? b : { ...b, dj_name: djMap[b.dj_id] || 'DJ' }));
  }

  const missingRequesterIds = [
    ...new Set(
      incoming.filter((b) => !b.requester_name && b.requester_id).map((b) => b.requester_id)
    ),
  ];
  if (missingRequesterIds.length > 0) {
    const { data: rRows } = await supabase
      .from('users')
      .select('id, name')
      .in('id', missingRequesterIds);
    const rMap = Object.fromEntries(((rRows as { id: string; name: string | null }[] | null) || []).map((r) => [r.id, r.name]));
    incoming = incoming.map((b) =>
      b.requester_name ? b : { ...b, requester_name: rMap[b.requester_id] || 'Unknown' }
    );
  }

  // For approved outgoing bookings, fetch the DJ's phone + email so the
  // booker can contact them to coordinate the gig. Email lives in
  // auth.users (admin lookup); phone is on public.users.
  // Only approved → no leakage of contact info on pending/denied requests.
  const approvedDjIds = [
    ...new Set(
      outgoing.filter((b) => b.status === 'approved' && b.dj_id).map((b) => b.dj_id)
    ),
  ];
  if (approvedDjIds.length > 0) {
    const { data: phoneRows } = await supabase
      .from('users')
      .select('id, phone')
      .in('id', approvedDjIds);
    const phoneMap = Object.fromEntries(
      ((phoneRows as { id: string; phone: string | null }[] | null) || []).map((r) => [r.id, r.phone])
    );
    // Email lookups go through the admin client one at a time. Parallel
    // resolves so a slow auth call doesn't serialize the others.
    const emailEntries = await Promise.all(
      approvedDjIds.map(async (id) => [id, await resolveUserEmail(id)] as const)
    );
    const emailMap = Object.fromEntries(emailEntries);
    outgoing = outgoing.map((b) =>
      b.status === 'approved' && approvedDjIds.includes(b.dj_id)
        ? { ...b, dj_phone: phoneMap[b.dj_id] || null, dj_email: emailMap[b.dj_id] || null }
        : b
    );
  }

  // Extract DJ's depositPct from booking_settings — used by the Quote
  // modal to show a live deposit preview as the DJ types.
  let depositPct = 0;
  if (me.booking_settings) {
    try {
      const bs = typeof me.booking_settings === 'string'
        ? JSON.parse(me.booking_settings)
        : me.booking_settings;
      // Pick the key that matches this DJ's type. `bs?.depositPct` was a
      // phantom key — nothing ever wrote it, so this silently resolved to 0
      // and every DJ-typed quote stored deposit_amount: null, discarding the
      // DJ's deposit policy. The real keys are mob_deposit_pct / club_deposit_pct.
      depositPct = Number(
        me.dj_type === 'club' ? bs?.club_deposit_pct : bs?.mob_deposit_pct
      ) || 0;
    } catch {
      // non-fatal — default to 0
    }
  }

  // ── Manual payments (host side) ──────────────────────────────────────
  // Payment rows for the user's OUTGOING bookings only (RLS additionally
  // limits booking_payments reads to the requester/DJ of the booking). One
  // .in() query, keyed by booking_id for the client.
  //
  // The generated types/supabase.ts predates booking_payments, so
  // .from('booking_payments') on the typed client is a build error — cast to
  // an untyped client for this ONE table (same fix as /api/payments). Known
  // tables stay on the typed client.
  const db = supabase as unknown as SupabaseClient;
  const paymentsByBooking: Record<string, BookingPayment[]> = {};
  const djMethodsByDj: Record<string, PaymentMethod[]> = {};
  // Whether each DJ's Stripe Connect account can take card charges — cached
  // in users.stripe_connect_ready by /api/stripe/connect. This is what makes
  // the "Pay with Card" button appear; it is NOT a payment_methods entry.
  const djCardReadyByDj: Record<string, boolean> = {};
  const outgoingIds = outgoing.map((b) => b.id);
  if (outgoingIds.length > 0) {
    const { data: payRows } = await db
      .from('booking_payments')
      .select('id, booking_id, kind, label, amount, amount_paid, currency, status, method, client_intent, due_date, requested_at')
      .in('booking_id', outgoingIds)
      .order('requested_at', { ascending: true });
    for (const p of ((payRows as BookingPayment[] | null) || [])) {
      if (!paymentsByBooking[p.booking_id]) paymentsByBooking[p.booking_id] = [];
      paymentsByBooking[p.booking_id].push(p);
    }

    // The DJ's payment handles — ONLY for DJs who have an actual payment row
    // on one of THIS user's bookings. Handles are a phishing-list-grade leak
    // if they ever reach a general payload; scoping to
    // bookings-with-payment-rows keeps them strictly host-of-this-booking.
    const djIdsWithPayments = [
      ...new Set(
        outgoing
          .filter((b) => (paymentsByBooking[b.id] || []).length > 0 && b.dj_id)
          .map((b) => b.dj_id)
      ),
    ];
    if (djIdsWithPayments.length > 0) {
      // payment_methods is a NEW column on users — fine on the typed client
      // as long as it's selected explicitly (only the new TABLE needs the
      // cast). Result cast goes through unknown because the generated types
      // don't know the column yet.
      const { data: mRows } = await supabase
        .from('users')
        .select('id, payment_methods, stripe_connect_ready')
        .in('id', djIdsWithPayments);
      const methodRows = (mRows as unknown as {
        id: string;
        payment_methods: unknown;
        stripe_connect_ready: boolean | null;
      }[] | null) || [];
      for (const r of methodRows) {
        djMethodsByDj[r.id] = (Array.isArray(r.payment_methods) ? r.payment_methods : []) as PaymentMethod[];
        djCardReadyByDj[r.id] = !!r.stripe_connect_ready;
      }
    }
  }

  return (
    <BookingRequestsClient
      currentUser={{
        id: me.id,
        name: me.name || '',
        email: authUser.email || null,
        role: me.role,
        djType: me.dj_type,
        zip: me.zip,
        city: me.city,
        state: me.state,
        travelDistance: me.travel_distance,
        depositPct,
      }}
      initialIncoming={incoming}
      initialOutgoing={outgoing}
      initialBlocked={blockedUsers}
      initialPayments={paymentsByBooking}
      djPaymentMethods={djMethodsByDj}
      djCardReady={djCardReadyByDj}
    />
  );
}

export type { BookingRow };
