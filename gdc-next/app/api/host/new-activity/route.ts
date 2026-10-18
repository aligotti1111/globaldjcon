// GET /api/host/new-activity
//
// The host notification bell's data: the DJ-driven activity on the host's own
// bookings (rows where requester_id === the current user). Unlike the DJ bell
// (one newest item per booking), the host bell lists EACH distinct update so a
// host sees every thing waiting on them — a contract to sign AND a deposit
// request on the same booking are two rows.
//
// Signals, newest first:
//   • Booking accepted / counter-offered / declined          (bookings.status)
//   • Contract ready to sign            (contract_status awaiting_client)
//   • Deposit requested / Balance requested   (booking_payments.marked_sent_at)
//   • Planner & Playlist sent                 (bookings.planner_sent_at)
//   • Planner reminder sent              (booking_planners.last_reminder_at)
//   • Guest list sent                        (booking_guestlists.sent_at)
//   • Rider sent                             (booking_riders.sent_at)
//   • Booking cancelled / cancellation requested by the DJ   (cancel_*)
//
// Everything is the host's OWN data, so after scoping bookings to
// requester_id === user.id we read the DJ-owned child tables with the admin
// client (the host's RLS-scoped client can't see them directly).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MOB_EVENT_LABELS } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Slot =
  | 'accepted' | 'countered' | 'denied'
  | 'contract_sign' | 'contract_ready'
  | 'deposit_request' | 'balance_request'
  | 'deposit_reminder' | 'balance_reminder'
  | 'deposit_receipt' | 'balance_receipt'
  | 'planner_sent' | 'planner_reminder'
  | 'guestlist_sent' | 'rider_sent'
  | 'cancelled' | 'cancel_requested';

interface BookingRow {
  id: string;
  event_date: string | null;
  event_type: string | null;
  venue_type: string | null;
  status: string | null;
  accepted_at: string | null;
  quote_sent_at: string | null;
  updated_at: string | null;
  contract_status: string | null;
  contract_sent_at: string | null;
  contract_signed_at: string | null;
  planner_sent_at: string | null;
  cancel_status: string | null;
  cancel_requested_by: string | null;
  cancel_requested_at: string | null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ items: [], count: 0 });

  // The host's own bookings — scoped by requester_id, which is the gate that
  // makes reading the DJ-owned child tables below safe.
  const { data: rows } = await supabase
    .from('bookings')
    .select('id, event_date, event_type, venue_type, status, accepted_at, quote_sent_at, updated_at, contract_status, contract_sent_at, contract_signed_at, planner_sent_at, cancel_status, cancel_requested_by, cancel_requested_at')
    .eq('requester_id', user.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(150);
  const bookings = (rows || []) as unknown as BookingRow[];
  const ids = bookings.map((b) => b.id);
  const byId = Object.fromEntries(bookings.map((b) => [b.id, b]));

  // Each distinct update is its own item (not deduped per booking).
  const items: { bookingId: string; slot: Slot; at: string; t: number }[] = [];
  const note = (bid: string, ts: string | null | undefined, slot: Slot) => {
    if (!ts) return;
    const t = Date.parse(ts);
    if (Number.isNaN(t)) return;
    items.push({ bookingId: bid, slot, at: ts, t });
  };

  // ── Booking-row signals ──
  for (const b of bookings) {
    if (b.status === 'approved') note(b.id, b.accepted_at, 'accepted');
    // 'countered' is intentionally NOT a bell notification — a counter offer
    // already surfaces on the booking card / booking tab, so it'd be redundant.
    if (b.status === 'denied') note(b.id, b.updated_at, 'denied');
    // Contract waiting on the host's signature → "ready to sign". Once signed,
    // it becomes "ready to view" so the host can open their signed copy.
    if (b.contract_status === 'awaiting_client') note(b.id, b.contract_sent_at, 'contract_sign');
    else if (b.contract_status === 'signed') note(b.id, b.contract_signed_at, 'contract_ready');
    // Planner & Playlist was sent to the host.
    note(b.id, b.planner_sent_at, 'planner_sent');
    // Cancelled outright, or the DJ asked the host to cancel.
    if (b.status === 'cancelled') note(b.id, b.cancel_requested_at || b.updated_at, 'cancelled');
    else if (b.cancel_status === 'requested' && b.cancel_requested_by === 'dj') {
      note(b.id, b.cancel_requested_at, 'cancel_requested');
    }
  }

  // Per-booking links to the host's pages for each stage, so a notification
  // opens the actual page (pay the deposit/balance, open the planner, view the
  // rider / guest list) rather than the event card.
  const depositPayId: Record<string, string> = {};
  const balancePayId: Record<string, string> = {};
  const plannerId: Record<string, string> = {};
  const riderId: Record<string, string> = {};
  const guestlistId: Record<string, string> = {};

  // ── Child-table signals (admin client — host's own bookings) ──
  if (ids.length > 0) {
    const admin = createAdminClient() as unknown as SupabaseClient;
    const [{ data: pay }, { data: planners }, { data: riders }, { data: gls }] = await Promise.all([
      admin.from('booking_payments').select('id, booking_id, kind, marked_sent_at, status, confirmed_at, manual_reminder_sends').in('booking_id', ids),
      admin.from('booking_planners').select('id, booking_id, last_reminder_at').in('booking_id', ids),
      admin.from('booking_riders').select('id, booking_id, sent_at').in('booking_id', ids),
      admin.from('booking_guestlists').select('id, booking_id, sent_at').in('booking_id', ids),
    ]);
    for (const p of ((pay as { id: string; booking_id: string; kind: string | null; marked_sent_at: string | null; status: string | null; confirmed_at: string | null; manual_reminder_sends: unknown }[] | null) || [])) {
      const isDeposit = p.kind === 'deposit';
      (isDeposit ? depositPayId : balancePayId)[p.booking_id] = p.id;
      // The request going out.
      note(p.booking_id, p.marked_sent_at, isDeposit ? 'deposit_request' : 'balance_request');
      // A manual payment reminder the DJ sent — surface the most recent one.
      const sends = Array.isArray(p.manual_reminder_sends) ? (p.manual_reminder_sends as unknown[]) : [];
      const lastReminder = sends
        .map((s) => (typeof s === 'string' ? s : ''))
        .filter(Boolean)
        .sort()
        .pop() || null;
      note(p.booking_id, lastReminder, isDeposit ? 'deposit_reminder' : 'balance_reminder');
      // Settled → a receipt is now downloadable.
      const settled = p.status === 'paid' || p.status === 'partial' || p.status === 'waived' || !!p.confirmed_at;
      if (settled) note(p.booking_id, p.confirmed_at, isDeposit ? 'deposit_receipt' : 'balance_receipt');
    }
    for (const p of ((planners as { id: string; booking_id: string; last_reminder_at: string | null }[] | null) || [])) {
      if (!plannerId[p.booking_id]) plannerId[p.booking_id] = p.id;
      note(p.booking_id, p.last_reminder_at, 'planner_reminder');
    }
    for (const r of ((riders as { id: string; booking_id: string; sent_at: string | null }[] | null) || [])) {
      if (!riderId[r.booking_id]) riderId[r.booking_id] = r.id;
      note(r.booking_id, r.sent_at, 'rider_sent');
    }
    for (const g of ((gls as { id: string; booking_id: string; sent_at: string | null }[] | null) || [])) {
      if (!guestlistId[g.booking_id]) guestlistId[g.booking_id] = g.id;
      note(g.booking_id, g.sent_at, 'guestlist_sent');
    }
  }

  const out = items
    .sort((x, y) => y.t - x.t)
    .slice(0, 20)
    .map((it) => {
      const b = byId[it.bookingId];
      const label = b?.event_type
        ? (MOB_EVENT_LABELS[b.event_type] || b.event_type)
        : (b?.venue_type || 'Booking');
      // Route each notification to the page it's about (sign the contract, pay
      // the deposit/balance, open the planner, view the rider / guest list)
      // instead of the event card. Falls back to the card (href null) when the
      // target id isn't available.
      const bid = it.bookingId;
      let href: string | null = null;
      switch (it.slot) {
        // Awaiting signature → straight to DocuSeal. Already signed
        // (contract_ready) → the event card (handled by the default: href null).
        case 'contract_sign': href = `/api/contracts/sign-redirect?bookingId=${bid}`; break;
        case 'deposit_request':
        case 'deposit_reminder': href = depositPayId[bid] ? `/pay/${depositPayId[bid]}` : null; break;
        case 'balance_request':
        case 'balance_reminder': href = balancePayId[bid] ? `/pay/${balancePayId[bid]}` : null; break;
        case 'planner_sent':
        case 'planner_reminder': href = plannerId[bid] ? `/planner/${plannerId[bid]}` : null; break;
        case 'rider_sent': href = riderId[bid] ? `/rider/${riderId[bid]}` : null; break;
        case 'guestlist_sent': href = guestlistId[bid] ? `/guestlist/${guestlistId[bid]}` : null; break;
        default: href = null;
      }
      return { bookingId: bid, slot: it.slot, at: it.at, eventDate: b?.event_date || null, label, href };
    });

  return NextResponse.json({ items: out, count: out.length });
}
