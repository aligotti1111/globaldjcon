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
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import UpcomingEventsClient from './UpcomingEventsClient';
import { buildHostPipeline, type HostStep } from '@/lib/hostPipeline';
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
  dj_email?: string | null;
  flyer_url?: string | null;
  link_url?: string | null;
  link_label?: string | null;
  notes?: string | null;
  status?: string | null;
  created_at?: string;
  // Rate fields (visible only to DJ + host who created the booking).
  offer_amount?: number | null;
  currency?: string | null;
  // Pricing-breakdown fields, so the host's Pricing card mirrors the DJ's
  // receipt (Agreed Rate → Tax → Total, then a Deposit/Balance schedule). The
  // agreed rate lives in counter_rate ?? quoted_rate ?? offer_amount, same as
  // the DJ card — offer_amount alone is often null.
  counter_rate?: number | null;
  quoted_rate?: number | null;
  tax_pct?: number | null;
  tax_amount?: number | null;
  total_with_tax?: number | null;
  deposit_pct?: number | null;
  deposit_amount?: number | null;
  package_details?: string | null;
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
  // Cancellation request state (host can ask the DJ to cancel).
  cancel_status?: string | null;
  // Read-only "booking progress" pipeline shown at the top of the expanded
  // card — only the stages this booking actually has, computed server-side.
  // Uses the DJ-side PipelineStep shape so the host renders the real hero.
  pipeline?: HostStep[];
  pipelineDjType?: 'club' | 'mobile';
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
    .select('id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, event_type, booking_type, is_manual, dj_id, flyer_url, link_url, link_label, notes, status, created_at, offer_amount, currency, room_details, guest_count, phone, package_title, cocktail_needed, cocktail_start_time, cocktail_same_room, ceremony_needed, ceremony_start_time, ceremony_same_room, contract_status, deposit_pct, deposit_amount, planner_status, total_with_tax, tax_pct, tax_amount, counter_rate, quoted_rate, package_details, cancel_status, status_overrides')
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
  // DJ emails (for the host's "Name / Email / Message" box). Resolved from auth
  // since the email may not live on the users row.
  const djEmailById: Record<string, string | null> = {};
  for (const id of djIds) djEmailById[id] = await resolveUserEmail(id);

  for (const e of events) {
    if (e.dj_id && djInfoById[e.dj_id]) {
      e.dj_name = djInfoById[e.dj_id].name || null;
      e.dj_slug = djInfoById[e.dj_id].slug || null;
      e.dj_email = djEmailById[e.dj_id] || null;
    }
  }

  // ── Booking progress pipeline (read-only) ────────────────────────────────
  // Pull the deposit/balance payment rows for these bookings so the Deposit and
  // Balance nodes can show paid/unpaid. The generated types predate
  // booking_payments, so cast the client for this one query.
  const eventIds = events.map((e) => e.id);
  const payByBooking: Record<string, { id: string; kind: string; status: string }[]> = {};
  // Rider + guest-list confirmations live on their OWN tables (booking_riders /
  // booking_guestlists), NOT on bookings — keyed by booking_id. Best-effort:
  // these lookups must never break the events query.
  const riderConfirmed: Record<string, boolean> = {};
  const guestlistConfirmed: Record<string, boolean> = {};
  // Planner id per booking, so the host can open their planner from the node.
  const plannerIdByBooking: Record<string, string> = {};
  if (eventIds.length > 0) {
    type AnyFrom = {
      from: (t: string) => {
        select: (c: string) => { in: (col: string, v: string[]) => Promise<{ data: Record<string, unknown>[] | null }> };
      };
    };
    // Payments / planner / rider / guestlist rows are owned by the DJ, so the
    // host's RLS-scoped client can't read them — but these are the host's OWN
    // bookings (we already scoped events to requester_id === user.id), so it's
    // safe to read them with the admin client here.
    const db = createAdminClient() as unknown as AnyFrom;

    const { data: payRows } = await db.from('booking_payments').select('id, booking_id, kind, status').in('booking_id', eventIds);
    for (const p of (payRows || []) as { id: string; booking_id: string; kind: string; status: string }[]) {
      (payByBooking[p.booking_id] ||= []).push({ id: p.id, kind: p.kind, status: p.status });
    }

    const { data: riderRows } = await db.from('booking_riders').select('booking_id, confirmed_at').in('booking_id', eventIds);
    for (const r of (riderRows || []) as { booking_id: string; confirmed_at: string | null }[]) {
      if (r.confirmed_at) riderConfirmed[r.booking_id] = true;
    }
    const { data: glRows } = await db.from('booking_guestlists').select('booking_id, confirmed_at').in('booking_id', eventIds);
    for (const g of (glRows || []) as { booking_id: string; confirmed_at: string | null }[]) {
      if (g.confirmed_at) guestlistConfirmed[g.booking_id] = true;
    }
    const { data: plRows } = await db.from('booking_planners').select('id, booking_id').in('booking_id', eventIds);
    for (const pl of (plRows || []) as { id: string; booking_id: string }[]) {
      if (!plannerIdByBooking[pl.booking_id]) plannerIdByBooking[pl.booking_id] = pl.id;
    }
  }

  for (const e of events) {
    const raw = e as unknown as {
      booking_type: string | null;
      contract_status?: string | null;
      deposit_pct?: number | null;
      deposit_amount?: number | null;
      planner_status?: 'sent' | 'partial' | 'submitted' | null;
      status_overrides?: Record<string, boolean> | string | null;
    };
    // The DJ can mark a stage complete manually (paid in full in cash, contract
    // done on paper) via status_overrides — no payment row exists then. Honor the
    // same flags so the host sees the same state as the DJ.
    let overrides: Record<string, boolean> = {};
    if (raw.status_overrides) {
      try {
        overrides = typeof raw.status_overrides === 'string'
          ? JSON.parse(raw.status_overrides)
          : raw.status_overrides;
      } catch { overrides = {}; }
    }
    const pays = payByBooking[e.id] || [];
    const settled = (s: string) => s === 'paid' || s === 'waived';
    const deposits = pays.filter((p) => p.kind === 'deposit');
    const balances = pays.filter((p) => p.kind === 'balance');
    const depositPaid = (deposits.length > 0 && deposits.every((p) => settled(p.status))) || !!overrides.deposit;
    const balancePaid = (balances.length > 0 && balances.every((p) => settled(p.status))) || !!overrides.invoice;
    // The still-owed payment row the host can click through to pay.
    const openDeposit = deposits.find((p) => !settled(p.status));
    const openBalance = balances.find((p) => !settled(p.status));
    const bookingType = raw.booking_type === 'club' ? 'club' : raw.booking_type === 'mobile' ? 'mobile' : null;
    e.pipelineDjType = bookingType === 'club' ? 'club' : 'mobile';

    e.pipeline = buildHostPipeline({
      bookingType,
      // Contract signed on paper (override) reads the same as e-signed.
      contractStatus: overrides.contract ? 'signed' : (raw.contract_status ?? null),
      hasDeposit: raw.deposit_pct != null || raw.deposit_amount != null || deposits.length > 0 || !!overrides.deposit,
      depositPaid,
      plannerStatus: raw.planner_status ?? null,
      riderConfirmed: !!riderConfirmed[e.id],
      guestlistConfirmed: !!guestlistConfirmed[e.id],
      hasBalance: balances.length > 0 || !!overrides.invoice,
      balancePaid,
      // Clickable actions for the host: pay deposit/balance, open planner.
      depositHref: openDeposit ? `/pay/${openDeposit.id}` : undefined,
      balanceHref: openBalance ? `/pay/${openBalance.id}` : undefined,
      plannerHref: plannerIdByBooking[e.id] ? `/planner/${plannerIdByBooking[e.id]}` : undefined,
      // Settled deposit/balance → let the host download their receipt.
      depositReceiptHref: depositPaid ? `/api/host/receipt?bookingId=${e.id}&kind=deposit` : undefined,
      balanceReceiptHref: balancePaid ? `/api/host/receipt?bookingId=${e.id}&kind=balance` : undefined,
    });
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
