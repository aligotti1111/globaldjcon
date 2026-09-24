// /past-events — host/venue view of their events that have already happened,
// most recent first. Same data + card as /upcoming-events (it reuses
// UpcomingEventsClient), just filtered to event_date < today and reversed.
//
// Auth/redirect rules:
//   - Not logged in → /login
//   - Logged in as a DJ → /upcoming-bookings (DJs have their own history there)

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import UpcomingEventsClient from '../upcoming-events/UpcomingEventsClient';
import { buildHostPipeline } from '@/lib/hostPipeline';
import type { UpcomingEvent } from '../upcoming-events/page';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Past Events — Global DJ Connect',
  description: 'View your past events.',
};

interface ProfileRow {
  role: string | null;
  country: string | null;
  name: string | null;
}

export default async function PastEventsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('users')
    .select('role, country, name')
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();

  if (profile?.role === 'dj') redirect('/upcoming-bookings');

  const country = profile?.country || 'United States';
  const userName = profile?.name || 'Your';
  const today = new Date().toISOString().slice(0, 10);

  // Past approved-or-manual bookings made by this host/venue, most recent first.
  const { data: rows } = await supabase
    .from('bookings')
    .select('id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, event_type, booking_type, is_manual, dj_id, flyer_url, link_url, link_label, notes, status, created_at, offer_amount, currency, room_details, guest_count, phone, package_title, cocktail_needed, cocktail_start_time, cocktail_same_room, ceremony_needed, ceremony_start_time, ceremony_same_room, contract_status, deposit_pct, deposit_amount, planner_status, total_with_tax, tax_pct, tax_amount, counter_rate, quoted_rate, package_details')
    .eq('requester_id', user.id)
    .lt('event_date', today)
    .or('status.eq.approved,is_manual.eq.true')
    .order('event_date', { ascending: false })
    .order('start_time', { ascending: false })
    .limit(200);

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
  const djEmailById: Record<string, string | null> = {};
  for (const id of djIds) djEmailById[id] = await resolveUserEmail(id);

  for (const e of events) {
    if (e.dj_id && djInfoById[e.dj_id]) {
      e.dj_name = djInfoById[e.dj_id].name || null;
      e.dj_slug = djInfoById[e.dj_id].slug || null;
      e.dj_email = djEmailById[e.dj_id] || null;
    }
  }

  // Booking-progress pipeline (read-only) — same as the upcoming page.
  const eventIds = events.map((e) => e.id);
  const payByBooking: Record<string, { id: string; kind: string; status: string }[]> = {};
  const riderConfirmed: Record<string, boolean> = {};
  const guestlistConfirmed: Record<string, boolean> = {};
  const plannerIdByBooking: Record<string, string> = {};
  if (eventIds.length > 0) {
    type AnyFrom = {
      from: (t: string) => {
        select: (c: string) => { in: (col: string, v: string[]) => Promise<{ data: Record<string, unknown>[] | null }> };
      };
    };
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
    };
    const pays = payByBooking[e.id] || [];
    const settled = (s: string) => s === 'paid' || s === 'waived';
    const deposits = pays.filter((p) => p.kind === 'deposit');
    const balances = pays.filter((p) => p.kind === 'balance');
    const depositPaid = deposits.length > 0 && deposits.every((p) => settled(p.status));
    const balancePaid = balances.length > 0 && balances.every((p) => settled(p.status));
    const openDeposit = deposits.find((p) => !settled(p.status));
    const openBalance = balances.find((p) => !settled(p.status));
    const bookingType = raw.booking_type === 'club' ? 'club' : raw.booking_type === 'mobile' ? 'mobile' : null;
    e.pipelineDjType = bookingType === 'club' ? 'club' : 'mobile';

    e.pipeline = buildHostPipeline({
      bookingType,
      contractStatus: raw.contract_status ?? null,
      hasDeposit: raw.deposit_pct != null || raw.deposit_amount != null || deposits.length > 0,
      depositPaid,
      plannerStatus: raw.planner_status ?? null,
      riderConfirmed: !!riderConfirmed[e.id],
      guestlistConfirmed: !!guestlistConfirmed[e.id],
      hasBalance: balances.length > 0,
      balancePaid,
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
      title="Past Events"
      subtitle="Your events that have already happened, most recent first."
      emptyText="You don't have any past events yet."
      emptyHint="Events move here automatically once their date has passed."
      newestFirst
      readOnly
    />
  );
}
