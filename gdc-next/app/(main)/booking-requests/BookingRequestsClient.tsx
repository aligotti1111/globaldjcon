'use client';

// BookingRequestsClient — top-level container for /booking-requests.
// Manages: state (incoming/outgoing arrays, blocked list), section visibility
// (incoming only for DJs), per-section tabs, and the list rendering router.
//
// All actions (approve/deny/cancel/block/unblock) update local state
// optimistically + write to DB. No re-fetch round-trip needed.
//
// Faithful port of vanilla br-load-render.js renderList + br-shared-actions.js.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from './bookingRequests.module.css';
import MobileBookingCard from './MobileBookingCard';
import ClubBookingCard from './ClubBookingCard';
import PaymentOptions from './PaymentOptions';
import CounterModal from './CounterModal';
import QuoteModal from './QuoteModal';
import HistoryModal from './HistoryModal';
import ComposeMessageModal from '@/components/ComposeMessageModal';
import { useConfirm } from '@/components/ConfirmModal';
import { bookingsOverlap, formatShortDate, formatTime, timeToMins, MOB_EVENT_LABELS } from './helpers';
import type { PaymentMethod } from '@/lib/paymentMethods';
import type { BookingRow, BookingPayment } from './page';

interface CurrentUser {
  id: string;
  name: string;
  // Email is from auth.users (passed in by the page). Used as the From:
  // when this user sends a message via the compose modal.
  email: string | null;
  role: string;
  djType: 'mobile' | 'club' | null;
  zip: string | null;
  // City + state are used alongside zip to geocode the DJ's home base
  // accurately for the venue-distance check (zip alone is imprecise).
  city: string | null;
  state: string | null;
  travelDistance: string | null;
  // Deposit percentage from DJ's booking_settings (0-100). Used for the
  // Quote modal's live deposit preview. 0 means DJ doesn't take a deposit.
  depositPct: number;
  // DJ's mobile packages keyed by category — used to resolve a booking's
  // overtime rate (by package_category + package_index) when it wasn't
  // snapshotted onto the booking row, so the approval email can include it.
  mobPackages?: Record<string, Array<{ overtime?: number | string | null }>> | null;
}

interface Props {
  currentUser: CurrentUser;
  initialIncoming: BookingRow[];
  initialOutgoing: BookingRow[];
  initialBlocked: string[];
  // Manual-payment rows for the user's OUTGOING bookings, keyed by
  // booking_id. Loaded server-side by the page (the generated Supabase types
  // predate booking_payments, so the page casts for that one query).
  initialPayments?: Record<string, BookingPayment[]>;
  // The DJ's saved payment handles, keyed by dj_id — populated by the page
  // ONLY for DJs with a payment row on this user's bookings. These are the
  // handles PaymentOptions renders; they must never reach a general payload.
  djPaymentMethods?: Record<string, PaymentMethod[]>;
  // Whether each DJ's Stripe Connect account can take card charges
  // (users.stripe_connect_ready, cached from Stripe). Drives the "Pay with
  // Card" button — separate from djPaymentMethods because card has no handle.
  djCardReady?: Record<string, boolean>;
}

// Tab filters for both sections. 'respond' = bookings the viewer must
// act on; 'awaiting' = bookings the viewer is waiting on the other side
// for. The split is computed per-booking from whose move it is.
type BookingFilter = 'respond' | 'awaiting' | 'approved' | 'denied' | 'all';

// Whose move is it on a booking? Reads negotiation_log (last entry's
// `from`) as the authority — that's set whenever either side counters or
// the DJ sends a mobile offer. Falls back to status when the log is
// empty (a fresh request that's never been countered).
//   Returns 'dj' if the DJ owes the next response, 'booker' if the
//   booker does, or null for terminal states (approved/denied/cancelled).
function whoseMove(b: BookingRow): 'dj' | 'booker' | null {
  const status = b.status || 'pending';
  if (status === 'approved' || status === 'denied' || status === 'cancelled') {
    return null;
  }
  const log = b.negotiation_log;
  if (log && log.length > 0) {
    // Last actor made the most recent move → the OTHER side owes a reply.
    return log[log.length - 1].from === 'dj' ? 'booker' : 'dj';
  }
  // No negotiation history. A fresh 'pending' request is the booker's
  // submission awaiting the DJ; a bare 'counter' (shouldn't normally
  // happen without a log) is treated as the DJ having made the move.
  return status === 'counter' ? 'booker' : 'dj';
}

// Resolve a booking's overtime rate: prefer the value snapshotted onto the
// booking row; otherwise look it up live from the DJ's package definition by
// package_category + package_index (falling back to the general package at
// the same index). Returns null when there's no overtime rate.
function resolveBookingOvertime(
  b: BookingRow,
  mobPackages?: Record<string, Array<{ overtime?: number | string | null }>> | null,
): number | null {
  const stored = (b as BookingRow & { overtime_rate?: number | null }).overtime_rate;
  if (stored != null) return Number(stored);
  const pkgIdx = (b as BookingRow & { package_index?: number | null }).package_index;
  if (pkgIdx == null || !mobPackages) return null;
  const cat = (b as BookingRow & { package_category?: string | null }).package_category || '';
  const ot = mobPackages[cat]?.[pkgIdx]?.overtime ?? mobPackages['general']?.[pkgIdx]?.overtime ?? null;
  const n = ot != null ? Number(ot) : NaN;
  return n > 0 ? n : null;
}

export default function BookingRequestsClient({
  currentUser,
  initialIncoming,
  initialOutgoing,
  initialBlocked,
  initialPayments,
  djPaymentMethods,
  djCardReady,
}: Props) {
  const [incoming, setIncoming] = useState<BookingRow[]>(initialIncoming);
  const [outgoing, setOutgoing] = useState<BookingRow[]>(initialOutgoing);
  const [blocked, setBlocked] = useState<string[]>(initialBlocked);
  // Manual-payment rows per outgoing booking. Kept in state so a host action
  // (mark-sent / pay-at-event) updates the card without a refetch.
  const [payments, setPayments] = useState<Record<string, BookingPayment[]>>(initialPayments || {});
  const [incomingTab, setIncomingTab] = useState<BookingFilter>('respond');
  const [outgoingTab, setOutgoingTab] = useState<BookingFilter>('respond');

  // Modal state — only one is ever open at a time.
  // counterModal: which booking we're countering, and from which side
  //   ('in' = DJ countering an incoming, 'out' = booker re-countering)
  // quoteModal: which booking the DJ is sending a price for
  const [counterModal, setCounterModal] = useState<{
    booking: BookingRow;
    group: 'in' | 'out';
  } | null>(null);
  const [quoteModal, setQuoteModal] = useState<{ booking: BookingRow } | null>(null);
  // historyModal: which booking's negotiation log to display in the
  // read-only History modal (opened from the Rate box "View History" link).
  const [historyModal, setHistoryModal] = useState<{ booking: BookingRow; isIncoming: boolean } | null>(null);
  // Compose-message modal — opened by Message button on each booking card.
  // The card gives us the recipient + a pre-filled subject describing
  // which booking the message is about ("Re: Booking on Aug 12, 2026").
  const [composeModal, setComposeModal] = useState<{
    recipientUserId: string;
    recipientName: string;
    defaultSubject: string;
  } | null>(null);
  const openComposeModal = (
    recipientUserId: string,
    recipientName: string,
    defaultSubject: string,
  ) => {
    setComposeModal({ recipientUserId, recipientName, defaultSubject });
  };

  // Site-uniform confirm dialog — replaces window.confirm() for Approve /
  // Deny / Cancel / Decline counter / Block actions. Hook returns the
  // imperative async helper + a JSX element to render at top level.
  const { confirm, confirmDialog } = useConfirm();

  // ── Section visibility — vanilla br-core.js + br-load-render.js ─
  const isDj = currentUser.role === 'dj';
  // Incoming section: DJs only. Vanilla restricts further to club DJs but
  // mobile DJs receive bookings too; show for any DJ.
  const showIncoming = isDj;
  // Outgoing section: shown if user has any outgoing bookings, OR if the user
  // isn't a DJ (DJs don't typically book other DJs but they can).
  const showOutgoing = !isDj || outgoing.length > 0;

  // ── Tab counts (recomputed on each render) ─────────────────────
  // For each section a booking falls into exactly one of:
  //   respond  — the viewer owes the next move
  //   awaiting — the viewer is waiting on the other side
  //   approved / denied — terminal
  // Incoming = DJ's view, so "respond" = DJ's move. Outgoing = booker's
  // view, so "respond" = booker's move. cancelled rows are excluded
  // everywhere except they simply never match a tab.
  const inCounts = { respond: 0, awaiting: 0, approved: 0, denied: 0 };
  incoming.forEach((b) => {
    const s = b.status || 'pending';
    if (s === 'approved') { inCounts.approved++; return; }
    if (s === 'denied') { inCounts.denied++; return; }
    if (s === 'cancelled') return;
    const mv = whoseMove(b);
    if (mv === 'dj') inCounts.respond++;
    else if (mv === 'booker') inCounts.awaiting++;
  });

  const outCounts = { respond: 0, awaiting: 0, approved: 0, denied: 0 };
  outgoing.forEach((b) => {
    const s = b.status || 'pending';
    if (s === 'approved') { outCounts.approved++; return; }
    if (s === 'denied') { outCounts.denied++; return; }
    if (s === 'cancelled') return;
    const mv = whoseMove(b);
    if (mv === 'booker') outCounts.respond++;
    else if (mv === 'dj') outCounts.awaiting++;
  });

  // ── Filtered lists ─────────────────────────────────────────────
  // matchesTab decides if a booking belongs in the chosen tab. `mySide`
  // is whichever role owes a 'respond' for this section ('dj' for the
  // incoming list, 'booker' for the outgoing list).
  function matchesTab(b: BookingRow, tab: BookingFilter, mySide: 'dj' | 'booker'): boolean {
    const s = b.status || 'pending';
    if (s === 'cancelled') return false;
    if (tab === 'all') return true;
    if (tab === 'approved') return s === 'approved';
    if (tab === 'denied') return s === 'denied';
    if (s === 'approved' || s === 'denied') return false;
    const mv = whoseMove(b);
    if (tab === 'respond') return mv === mySide;
    if (tab === 'awaiting') return mv !== null && mv !== mySide;
    return false;
  }

  const filteredIncoming = incoming.filter((b) => matchesTab(b, incomingTab, 'dj'));
  const filteredOutgoing = outgoing.filter((b) => matchesTab(b, outgoingTab, 'booker'));

  // ── Mutators (optimistic updates + DB write) ───────────────────
  function updateIncomingStatus(bookingId: string, status: string) {
    setIncoming((prev) => prev.map((b) => (b.id === bookingId ? { ...b, status } : b)));
  }
  function updateOutgoingStatus(bookingId: string, status: string) {
    setOutgoing((prev) => prev.map((b) => (b.id === bookingId ? { ...b, status } : b)));
  }

  // Approve / Deny — DJ side. On approve, decrement bookings_available
  // for that date so the calendar reflects the spent slot.
  async function djUpdateStatus(bookingId: string, status: 'approved' | 'denied') {
    const isApprove = status === 'approved';
    // Look up the booking up front so we can address the booker by name
    // in the confirm dialog rather than the generic "the booker".
    const bookingRef = incoming.find((x) => x.id === bookingId);
    const requesterName = bookingRef?.requester_name?.trim() || 'the booker';

    // Club/bar conflict warning — if the DJ already manually added a
    // booking for this same date, warn before approving. They can still
    // continue (approve) or cancel. Club/bar DJs are one-per-day.
    if (
      isApprove
      && bookingRef?.booking_type === 'club'
      && bookingRef?.event_date
    ) {
      const supabaseChk = createClient();
      const { data: manualSameDay } = await supabaseChk
        .from('bookings')
        .select('id')
        .eq('dj_id', currentUser.id)
        .eq('event_date', bookingRef.event_date)
        .eq('is_manual', true)
        .eq('status', 'approved')
        .neq('id', bookingId);
      if (manualSameDay && manualSameDay.length > 0) {
        const proceed = await confirm({
          title: 'Booking already exists for this day',
          message: `You manually added a booking for ${bookingRef.event_date}. Approving this request will book the same day. Continue?`,
          confirmLabel: 'Continue',
          variant: 'primary',
        });
        if (!proceed) return;
      }
    }

    const ok = await confirm({
      title: isApprove ? 'Approve this booking?' : 'Decline this booking?',
      message: isApprove
        ? `${requesterName} will be notified by email and the date will be marked as booked on your calendar.`
        : `${requesterName} will be notified by email that you cannot accept this booking.`,
      confirmLabel: isApprove ? 'Approve' : 'Decline',
      variant: isApprove ? 'primary' : 'danger',
    });
    if (!ok) return;
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status, updated_at: new Date().toISOString() } as unknown as never)
        .eq('id', bookingId)
        .eq('dj_id', currentUser.id);
      if (error) throw error;

      const b = incoming.find((x) => x.id === bookingId);
      updateIncomingStatus(bookingId, status);

      // Email side — branches on approved vs denied.
      // - APPROVED: fire booking_approved to BOTH booker and DJ. Both
      //   parties get a confirmation with the full info card and the
      //   agreed price. Two requests, one per recipient.
      // - DENIED: fire the existing booker-only status email (unchanged).
      // Failures are swallowed so the DB update isn't undone.
      if (b) {
        if (status === 'approved') {
          // Agreed price: prefer counter_rate (most-recent active offer)
          // then fall back to quoted_rate then offer_amount.
          const agreedPrice = (b.counter_rate as number | null | undefined)
            ?? (b.quoted_rate as number | null | undefined)
            ?? (b.offer_amount as number | null | undefined)
            ?? null;
          const sharedFields = {
            type: 'booking_approved',
            agreedPrice,
            overtimeRate: resolveBookingOvertime(b, currentUser.mobPackages),
            currency: (b as BookingRow & { currency?: string }).currency || 'USD',
            eventDate: b.event_date,
            startTime: b.start_time,
            endTime: b.end_time,
            setType: (b as BookingRow & { set_type?: string | null }).set_type,
            venueType: (b as BookingRow & { venue_type?: string | null }).venue_type,
            eventType: (b as BookingRow & { event_type?: string | null }).event_type,
            eventDetails: (b as BookingRow & { event_details?: string | null }).event_details ?? null,
            venueName: b.venue_name,
            venueAddress: (b as BookingRow & { venue_address?: string | null }).venue_address,
            packageTitle: b.package_title,
            isWedding: (b as BookingRow & { event_type?: string | null }).event_type === 'weddings',
            cocktailNeeded: (b as BookingRow & { cocktail_needed?: boolean | null }).cocktail_needed ?? null,
            cocktailStart: (b as BookingRow & { cocktail_start_time?: string | null }).cocktail_start_time ?? null,
            cocktailSameRoom: (b as BookingRow & { cocktail_same_room?: boolean | null }).cocktail_same_room ?? null,
            ceremonyNeeded: (b as BookingRow & { ceremony_needed?: boolean | null }).ceremony_needed ?? null,
            ceremonyStart: (b as BookingRow & { ceremony_start_time?: string | null }).ceremony_start_time ?? null,
            ceremonySameRoom: (b as BookingRow & { ceremony_same_room?: boolean | null }).ceremony_same_room ?? null,
            setupHours: (b as BookingRow & { setup_hours?: string | null }).setup_hours ?? null,
          };
          try {
            await fetch('/api/send-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...sharedFields,
                recipientUserId: b.requester_id,
                recipientName: b.requester_name,
                recipientRole: 'booker',
                otherPartyName: currentUser.name,
              }),
            });
          } catch (e) {
            console.warn('Booker approval email failed:', e);
          }
          // To DJ (self) — confirmation copy in their inbox
          try {
            await fetch('/api/send-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...sharedFields,
                recipientUserId: currentUser.id,
                recipientName: currentUser.name,
                recipientRole: 'dj',
                otherPartyName: b.requester_name,
              }),
            });
          } catch (e) {
            console.warn('DJ approval email failed:', e);
          }
        } else {
          // Deny path — existing booker-only email.
          try {
            await fetch('/api/send-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: b.booking_type === 'club' ? 'booking_status' : 'mob_booking_status',
                requesterUserId: b.requester_id,
                requesterName: b.requester_name,
                djName: currentUser.name,
                status,
                eventDate: b.event_date,
                venueName: b.venue_name,
                packageTitle: b.package_title,
              }),
            });
          } catch (e) {
            console.warn('Booker status email failed:', e);
          }
        }
      }

      // Calendar update on approve. Branches by DJ type:
      // - CLUB DJs: mark booking_days[date].booked = true so the day turns
      //   red on the calendar and no more bookings can be made on it.
      // - MOBILE DJs: decrement mob_booking_days[date].bookings_available so
      //   the per-day capacity tracker reflects the new approved booking.
      // Re-read settings first so we don't clobber concurrent edits — same
      // defensive pattern as the owner calendar's persistBookingDays.
      if (status === 'approved' && b && b.event_date) {
        const isClubBooking = !!(b as BookingRow & { set_type?: string | null }).set_type;
        try {
          const { data: djRow } = await supabase
            .from('users')
            .select('booking_settings')
            .eq('id', currentUser.id)
            .single<{ booking_settings: string | null }>();
          let bs: {
            mob_bookings_per_day?: number;
            mob_booking_days?: Record<string, {
              bookings_available?: number;
              booked?: boolean;
              unavailable?: boolean;
              eventName?: string;
              location?: string;
              startTime?: string;
              endTime?: string;
            }>;
            booking_days?: Record<string, {
              booked?: boolean;
              unavailable?: boolean;
              eventName?: string;
              startTime?: string;
              endTime?: string;
              location?: string;
            }>;
          } = {};
          if (djRow?.booking_settings) {
            try {
              bs = JSON.parse(djRow.booking_settings);
            } catch {
              bs = {};
            }
          }
          if (isClubBooking) {
            // CLUB DJ — flip the date's booked flag to true so the public
            // calendar shows it red and the booking form refuses it.
            if (!bs.booking_days) bs.booking_days = {};
            const existing = bs.booking_days[b.event_date] || {};
            bs.booking_days[b.event_date] = { ...existing, booked: true };
          } else {
            // MOBILE DJ — decrement bookings_available.
            const defaultPerDay = bs.mob_bookings_per_day || 1;
            if (!bs.mob_booking_days) bs.mob_booking_days = {};
            const dayData = bs.mob_booking_days[b.event_date] || {};
            const current = dayData.bookings_available != null ? dayData.bookings_available : defaultPerDay;
            const newCount = Math.max(0, current - 1);
            bs.mob_booking_days[b.event_date] = { ...dayData, bookings_available: newCount };
          }
          await supabase
            .from('users')
            .update({ booking_settings: JSON.stringify(bs) } as unknown as never)
            .eq('id', currentUser.id);
        } catch (calErr) {
          console.error('Calendar update on approve failed:', calErr);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      alert('Error: ' + msg);
    }
  }

  // Cancel outgoing — booker side
  async function cancelOutgoing(bookingId: string) {
    if (!(await confirm({
      title: 'Cancel this booking request?',
      message: 'The DJ will be notified that you no longer need them for this event.',
      confirmLabel: 'Cancel Booking',
      cancelLabel: 'Keep It',
      variant: 'danger',
    }))) return;
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() } as unknown as never)
        .eq('id', bookingId)
        .eq('requester_id', currentUser.id);
      if (error) throw error;
      updateOutgoingStatus(bookingId, 'cancelled');
      // Notify BOTH parties by email that the booker cancelled. The route
      // resolves the booking + both emails server-side from the bookingId.
      // Best-effort — a failed email never undoes the cancellation.
      try {
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'booking_cancelled',
            bookingId,
            cancelledByName: currentUser.name || 'The booker',
          }),
        });
      } catch (e) {
        console.warn('Cancellation email failed:', e);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      alert('Error: ' + msg);
    }
  }

  // DJ-side cancel — filters by dj_id (mirror of cancelOutgoing's
  // requester_id filter). DJ can cancel a booking they've received at
  // any non-terminal status: pending OR counter (after they've sent a
  // quote and are waiting on the booker).
  async function cancelIncoming(bookingId: string) {
    if (!(await confirm({
      title: 'Cancel this booking?',
      message: 'The booker will see that this booking has been cancelled. This cannot be undone.',
      confirmLabel: 'Cancel Booking',
      cancelLabel: 'Keep It',
      variant: 'danger',
    }))) return;
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() } as unknown as never)
        .eq('id', bookingId)
        .eq('dj_id', currentUser.id);
      if (error) throw error;
      updateIncomingStatus(bookingId, 'cancelled');
      // Refresh the header badge in case the cancelled booking was a
      // pending one that contributed to the count.
      try {
        window.dispatchEvent(new Event('gdc:refresh-booking-count'));
      } catch {
        // Non-fatal — next 30s poll catches up.
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      alert('Error: ' + msg);
    }
  }

  // ── Counter response (booker side) ─────────────────────────────────
  // Booker accepts the DJ's counter offer → status becomes 'approved'
  // with the counter rate locked in. Same calendar-decrement effect as
  // a normal approve.
  async function acceptCounter(bookingId: string) {
    const target = outgoing.find((x) => x.id === bookingId);
    const ok = await confirm({
      title: 'Approve this offer?',
      message: `This confirms the booking with ${target?.dj_name || 'the DJ'} and locks in the offered rate. They'll be notified by email.`,
      confirmLabel: 'Approve Offer',
      variant: 'primary',
    });
    if (!ok) return;

    const supabase = createClient();
    try {
      const b = outgoing.find((x) => x.id === bookingId);
      // Mobile quote-mode offers: the booker approving means the date
      // must be marked on the DJ's calendar — a write the booker can't
      // do under RLS. Route it through /api/booking-approve, which sets
      // status='approved' AND updates the DJ's calendar server-side.
      // Club counters and offers-mode counters keep the direct update.
      const isMobileQuote = !!b && b.booking_type !== 'club' && !!b.is_quote;
      if (isMobileQuote) {
        const res = await fetch('/api/booking-approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || 'Approval failed');
        }
      } else {
        const { error } = await supabase
          .from('bookings')
          .update({ status: 'approved', updated_at: new Date().toISOString() } as unknown as never)
          .eq('id', bookingId)
          .eq('requester_id', currentUser.id);
        if (error) throw error;
      }
      setOutgoing((prev) =>
        prev.map((x) => (x.id === bookingId ? { ...x, status: 'approved' } : x))
      );
      // Fire booking_approved to BOTH parties — same as DJ-side approve.
      // booker accepting a counter = booking confirmed at counter_rate.
      if (b) {
        const agreedPrice = (b.counter_rate as number | null | undefined)
          ?? (b.quoted_rate as number | null | undefined)
          ?? (b.offer_amount as number | null | undefined)
          ?? null;
        const sharedFields = {
          type: 'booking_approved',
          agreedPrice,
          overtimeRate: resolveBookingOvertime(b, currentUser.mobPackages),
          currency: (b as BookingRow & { currency?: string }).currency || 'USD',
          eventDate: b.event_date,
          startTime: b.start_time,
          endTime: b.end_time,
          setType: (b as BookingRow & { set_type?: string | null }).set_type,
          venueType: (b as BookingRow & { venue_type?: string | null }).venue_type,
          eventType: (b as BookingRow & { event_type?: string | null }).event_type,
          eventDetails: (b as BookingRow & { event_details?: string | null }).event_details ?? null,
          venueName: b.venue_name,
          venueAddress: (b as BookingRow & { venue_address?: string | null }).venue_address,
          packageTitle: b.package_title,
          isWedding: (b as BookingRow & { event_type?: string | null }).event_type === 'weddings',
          cocktailNeeded: (b as BookingRow & { cocktail_needed?: boolean | null }).cocktail_needed ?? null,
          cocktailStart: (b as BookingRow & { cocktail_start_time?: string | null }).cocktail_start_time ?? null,
          cocktailSameRoom: (b as BookingRow & { cocktail_same_room?: boolean | null }).cocktail_same_room ?? null,
          ceremonyNeeded: (b as BookingRow & { ceremony_needed?: boolean | null }).ceremony_needed ?? null,
          ceremonyStart: (b as BookingRow & { ceremony_start_time?: string | null }).ceremony_start_time ?? null,
          ceremonySameRoom: (b as BookingRow & { ceremony_same_room?: boolean | null }).ceremony_same_room ?? null,
          setupHours: (b as BookingRow & { setup_hours?: string | null }).setup_hours ?? null,
        };
        // To DJ
        try {
          await fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...sharedFields,
              recipientUserId: b.dj_id,
              recipientName: b.dj_name,
              recipientRole: 'dj',
              otherPartyName: currentUser.name,
            }),
          });
        } catch (e) {
          console.warn('DJ approval email failed:', e);
        }
        // To booker (self) — confirmation copy in their inbox
        try {
          await fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...sharedFields,
              recipientUserId: currentUser.id,
              recipientName: currentUser.name,
              recipientRole: 'booker',
              otherPartyName: b.dj_name,
            }),
          });
        } catch (e) {
          console.warn('Booker approval email failed:', e);
        }
      }
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'Unknown'));
    }
  }

  // Booker declines the DJ's counter → status='denied'.
  // Vanilla also lets the booker counter back instead — for that they'd
  // open the CounterModal with group='out' (handled by openCounter('out')).
  async function declineCounter(bookingId: string) {
    if (!(await confirm({
      title: 'Decline this counter offer?',
      message: 'The booking will be marked as denied. You can always start a new booking later.',
      confirmLabel: 'Decline',
      variant: 'danger',
    }))) return;
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'denied', updated_at: new Date().toISOString() } as unknown as never)
        .eq('id', bookingId)
        .eq('requester_id', currentUser.id);
      if (error) throw error;
      setOutgoing((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, status: 'denied' } : b))
      );
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'Unknown'));
    }
  }

  // Deep-link from the offer email's buttons:
  //   ?action=approve&booking=ID → open the Approve-offer confirm
  //   ?action=decline&booking=ID → open the Decline-offer confirm
  // The action runs through the same in-app confirm flow (so nothing is
  // changed without the booker confirming on the logged-in page). We strip
  // the params first so a refresh doesn't re-trigger it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const bid = params.get('booking');
    if (!bid || (action !== 'approve' && action !== 'decline')) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('action');
    url.searchParams.delete('booking');
    window.history.replaceState({}, '', url.pathname + url.search);
    if (action === 'approve') acceptCounter(bid);
    else declineCounter(bid);
    // Run once on mount; handlers are hoisted function declarations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Card return leg. Stripe Checkout sends the host back to
  //   /booking-requests?paid=<paymentId>&session_id=<cs_...>
  // and we POST verify-checkout — the ONLY place the session is trusted
  // (retrieved server-side on the DJ's connected account, never taken at the
  // URL's word). The route is idempotent (stripe_session_id is recorded), so
  // a refresh or back-button re-post applies nothing — we still strip the
  // params first to avoid burning the round-trip.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const paidId = params.get('paid');
    const sessionId = params.get('session_id');
    if (!paidId || !sessionId) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('paid');
    url.searchParams.delete('session_id');
    window.history.replaceState({}, '', url.pathname + url.search);
    (async () => {
      try {
        const res = await fetch('/api/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verify-checkout', paymentId: paidId, sessionId }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean; error?: string; amount_paid?: number; status?: string;
        };
        if (!res.ok) throw new Error(json.error || 'Could not verify the card payment');
        if (!json.ok || json.status == null) return;
        // Fold the server's verdict into local state — server values, never
        // client math (the route recomputed everything from Stripe's session).
        setPayments((prev) => {
          const next: Record<string, BookingPayment[]> = {};
          for (const [bid, rows] of Object.entries(prev)) {
            next[bid] = rows.map((p) =>
              p.id === paidId
                ? {
                    ...p,
                    amount_paid: Number(json.amount_paid ?? p.amount_paid),
                    status: String(json.status),
                    method: 'card',
                    client_intent: 'pay_now',
                  }
                : p,
            );
          }
          return next;
        });
      } catch (err) {
        // Even on failure no money is lost: the charge lives in Stripe and
        // the DJ's manual "Confirm received" still settles the row.
        alert(
          'Card payment: ' +
            (err instanceof Error ? err.message : 'could not verify') +
            '. If you were charged, your DJ can still confirm it manually.',
        );
      }
    })();
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Manual payments (host side) ────────────────────────────────────
  // Both actions are CLAIMS/intents — 'mark-sent' tops out at
  // pending_confirmation and 'intent' only records "I'll pay at the event".
  // Only the DJ's confirm (on their upcoming-bookings page) reaches
  // partial/paid. Purely informational — never blocks any booking action.
  async function paymentAction(
    bookingId: string,
    paymentId: string,
    action: 'mark-sent' | 'intent',
    method?: string,
  ) {
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'mark-sent'
            ? { action, paymentId, method: method || null }
            : { action, paymentId }
        ),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Request failed');
      setPayments((prev) => ({
        ...prev,
        [bookingId]: (prev[bookingId] || []).map((p) => {
          if (p.id !== paymentId) return p;
          if (action === 'intent') return { ...p, client_intent: 'pay_at_event' };
          // Settled rows never regress — mirrors the route's early return.
          if (p.status === 'paid' || p.status === 'waived') return p;
          return { ...p, status: 'pending_confirmation', method: method || null, client_intent: 'pay_now' };
        }),
      }));
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'Unknown'));
    }
  }

  // PaymentOptions block(s) for one OUTGOING booking — one per payment row.
  // Passed into the card as its paymentsSlot. Only ever built for the
  // outgoing list, so the DJ's handles are only rendered to the host of the
  // specific booking they were requested on.
  function renderOutgoingPayments(b: BookingRow): React.ReactNode {
    const rows = payments[b.id] || [];
    if (rows.length === 0) return null;
    const methods = (djPaymentMethods || {})[b.dj_id] || [];
    const djName = b.dj_name || 'the DJ';
    return (
      <>
        {rows.map((p) => (
          <div key={p.id}>
            <PaymentOptions
              bookingId={b.id}
              paymentId={p.id}
              cardEnabled={!!(djCardReady || {})[b.dj_id]}
              kind={p.kind}
              amount={Number(p.amount)}
              currency={p.currency || 'USD'}
              amountPaid={Number(p.amount_paid || 0)}
              status={p.status}
              djName={djName}
              methods={methods}
              onMarkSent={(m) => paymentAction(b.id, p.id, 'mark-sent', m)}
              onPayAtEvent={() => paymentAction(b.id, p.id, 'intent')}
              eventDate={b.event_date}
              venueName={b.venue_name}
            />
            {p.client_intent === 'pay_at_event' && p.status !== 'paid' && p.status !== 'waived' && (
              <p style={{ margin: '.4rem 0 0', fontSize: '.72rem', color: 'var(--muted)' }}>
                You told {djName} you&apos;ll pay at the event. You can still pay ahead with an option above.
              </p>
            )}
          </div>
        ))}
      </>
    );
  }

  // ── Modal open helpers ─────────────────────────────────────────────
  function openCounterModal(booking: BookingRow, group: 'in' | 'out') {
    setCounterModal({ booking, group });
  }
  function openQuoteModal(booking: BookingRow) {
    setQuoteModal({ booking });
  }
  function openHistoryModal(booking: BookingRow, isIncoming: boolean) {
    setHistoryModal({ booking, isIncoming });
  }

  // ── Send drafted quote (club + quote-mode flow) ────────────────────
  // The DJ has saved a quoted_rate via the QuoteModal but quote_sent_at
  // is still null — meaning the booker can't see the price yet. This
  // handler stamps quote_sent_at = now(), which flips the booking out
  // of "draft" mode and into "rate sent" mode for both sides.
  async function sendDraftQuote(b: BookingRow) {
    if (!currentUser) return;
    if (b.quoted_rate == null) {
      alert('Add a custom rate first, then send.');
      return;
    }
    if (!(await confirm({
      title: 'Send this quote to the booker?',
      message: `Once sent, ${b.requester_name || 'the booker'} will see your rate of $${Number(b.quoted_rate).toLocaleString()} and be able to accept, counter, or decline. You'll still be able to counter from there.`,
      confirmLabel: 'Send Quote',
      cancelLabel: 'Cancel',
      variant: 'primary',
    }))) return;
    try {
      const supabase = createClient();
      const nowIso = new Date().toISOString();
      // Fetch current negotiation_log so we can append the DJ's quote
      // entry. Same pattern CounterModal uses — read first, then write,
      // to avoid clobbering concurrent updates from the other side.
      const { data: current } = await supabase
        .from('bookings')
        .select('negotiation_log')
        .eq('id', b.id)
        .single<{ negotiation_log: BookingRow['negotiation_log'] }>();
      const log: Array<{ from: 'dj' | 'booker'; amount: number; message: string; created_at: string }> =
        (current?.negotiation_log as Array<{ from: 'dj' | 'booker'; amount: number; message: string; created_at: string }> | null) || [];
      log.push({
        from: 'dj' as const,
        amount: Number(b.quoted_rate),
        message: b.counter_message || '',
        created_at: nowIso,
      });
      // Flip status to 'counter' so:
      //  - The booking leaves the DJ's Pending tab (filter is status==='pending')
      //  - The booker sees Accept / Counter Back / Decline buttons
      //    (booker actions gate on status === 'counter')
      //  - DJ no longer sees Approve/Decline on a quote they themselves
      //    just sent — the ball is in the booker's court.
      const { error } = await supabase
        .from('bookings')
        .update({
          quote_sent_at: nowIso,
          status: 'counter',
          negotiation_log: log,
          updated_at: nowIso,
        } as unknown as never)
        .eq('id', b.id)
        .eq('dj_id', currentUser.id);
      if (error) throw error;
      // Patch local state so the UI flips immediately.
      applyBookingUpdate({
        ...b,
        quote_sent_at: nowIso,
        status: 'counter',
        negotiation_log: log,
        updated_at: nowIso,
      });
      // Refresh the header badge count immediately. Without this, the
      // badge stays at its old number until the next 30s poll tick.
      try {
        window.dispatchEvent(new Event('gdc:refresh-booking-count'));
      } catch {
        // Non-fatal — the badge will catch up on the next poll.
      }
      // Notify the booker — fire-and-forget. Uses the dedicated
      // 'quote_sent' email type. Pass the full booking context so the
      // email can render the same info card the original request did.
      try {
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'quote_sent',
            recipientUserId: b.requester_id,
            recipientName: b.requester_name,
            djName: currentUser.name,
            quotedRate: b.quoted_rate,
            quoteMessage: b.counter_message || null,
            currency: b.currency || 'USD',
            eventDate: b.event_date,
            startTime: b.start_time,
            endTime: b.end_time,
            setType: b.set_type,
            venueType: b.venue_type,
            venueName: b.venue_name,
            venueAddress: b.venue_address,
          }),
        });
      } catch (e) {
        console.warn('Quote-sent email failed:', e);
      }
    } catch (e) {
      console.error('Send draft quote failed:', e);
      alert('Failed to send quote. Please try again.');
    }
  }

  // After a modal saves, patch the relevant local list with the updated row.
  function applyBookingUpdate(updated: BookingRow) {
    if (incoming.find((b) => b.id === updated.id)) {
      setIncoming((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    }
    if (outgoing.find((b) => b.id === updated.id)) {
      setOutgoing((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    }
  }

  // Block — DJ side. Adds requester to blocked_users array; auto-denies
  // any pending bookings from them; removes them from the visible list.
  async function blockUser(userId: string, userName: string) {
    if (!(await confirm({
      title: `Block ${userName}?`,
      message: 'They will no longer be able to send you booking requests or messages.',
      confirmLabel: 'Block',
      variant: 'danger',
    }))) return;
    const supabase = createClient();
    try {
      const updated = [...new Set([...blocked, userId])];
      const { error } = await supabase
        .from('users')
        .update({ blocked_users: updated } as unknown as never)
        .eq('id', currentUser.id);
      if (error) throw error;
      setBlocked(updated);
      // Deny pending bookings from this user. Server-side update + filter the
      // local list so they vanish from the UI.
      await supabase
        .from('bookings')
        .update({ status: 'denied', updated_at: new Date().toISOString() } as unknown as never)
        .eq('requester_id', userId)
        .eq('dj_id', currentUser.id)
        .eq('status', 'pending');
      setIncoming((prev) =>
        prev
          .map((b) => (b.requester_id === userId && b.status === 'pending' ? { ...b, status: 'denied' } : b))
          .filter((b) => b.requester_id !== userId)
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      alert('Error: ' + msg);
    }
  }

  async function unblockUser(userId: string) {
    const supabase = createClient();
    try {
      const updated = blocked.filter((id) => id !== userId);
      await supabase
        .from('users')
        .update({ blocked_users: updated } as unknown as never)
        .eq('id', currentUser.id);
      setBlocked(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      alert('Error: ' + msg);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.pageTitle}>Booking Requests</h1>
        {isDj ? (
          <Link href="/upcoming-bookings" className={styles.upcomingBtn}>
            View Upcoming Bookings →
          </Link>
        ) : (
          <Link href="/upcoming-events" className={styles.upcomingBtn}>
            View All Events →
          </Link>
        )}
      </div>

      {/* INCOMING — DJs only */}
      {showIncoming && (
        <div className={styles.section}>
          <div className={styles.sectionLabelIn}>Incoming Booking Requests</div>
          <div className={styles.tabs}>
            <TabButton active={incomingTab === 'respond'} onClick={() => setIncomingTab('respond')}>
              Response Required ({inCounts.respond})
            </TabButton>
            <TabButton active={incomingTab === 'awaiting'} onClick={() => setIncomingTab('awaiting')}>
              Awaiting Response ({inCounts.awaiting})
            </TabButton>
            <TabButton active={incomingTab === 'approved'} onClick={() => setIncomingTab('approved')}>
              Approved ({inCounts.approved})
            </TabButton>
            <TabButton active={incomingTab === 'denied'} onClick={() => setIncomingTab('denied')}>
              Declined ({inCounts.denied})
            </TabButton>
          </div>
          <div>
            {/* Same-day grouping for the action tab (Response Required) only */}
            {incomingTab === 'respond' ? (
              <SameDayGrouped
                bookings={filteredIncoming}
                isIncoming={true}
                blocked={blocked}
                currentUser={currentUser}
                currentTab={incomingTab}
                onApprove={(id) => djUpdateStatus(id, 'approved')}
                onDeny={(id) => djUpdateStatus(id, 'denied')}
                onCancel={cancelOutgoing}
                onCancelIncoming={cancelIncoming}
                onBlock={blockUser}
                onUnblock={unblockUser}
                onCounter={openCounterModal}
                onSendQuote={openQuoteModal}
                onSendDraftQuote={sendDraftQuote}
                onViewHistory={openHistoryModal}
                onAcceptCounter={acceptCounter}
                onDeclineCounter={declineCounter}
                onMessage={openComposeModal}
              />
            ) : (
              <FlatList
                bookings={filteredIncoming}
                isIncoming={true}
                blocked={blocked}
                currentUser={currentUser}
                currentTab={incomingTab}
                onApprove={(id) => djUpdateStatus(id, 'approved')}
                onDeny={(id) => djUpdateStatus(id, 'denied')}
                onCancel={cancelOutgoing}
                onCancelIncoming={cancelIncoming}
                onBlock={blockUser}
                onUnblock={unblockUser}
                onCounter={openCounterModal}
                onSendQuote={openQuoteModal}
                onSendDraftQuote={sendDraftQuote}
                onViewHistory={openHistoryModal}
                onAcceptCounter={acceptCounter}
                onDeclineCounter={declineCounter}
                onMessage={openComposeModal}
              />
            )}
            {filteredIncoming.length === 0 && (
              <EmptyState>{emptyLabel(incomingTab)}</EmptyState>
            )}
          </div>
        </div>
      )}

      {/* OUTGOING — all roles */}
      {showOutgoing && (
        <div className={styles.section}>
          {/* The "Outgoing" label only adds meaning alongside an Incoming
              section (DJ accounts). Host/venue accounts only ever have
              outgoing requests, so the label is redundant — hide it. */}
          {showIncoming && (
            <div className={styles.sectionLabelOut}>Outgoing Booking Requests</div>
          )}
          <div className={styles.tabs}>
            <TabButton active={outgoingTab === 'respond'} onClick={() => setOutgoingTab('respond')}>
              Response Required ({outCounts.respond})
            </TabButton>
            <TabButton active={outgoingTab === 'awaiting'} onClick={() => setOutgoingTab('awaiting')}>
              Awaiting Response ({outCounts.awaiting})
            </TabButton>
            <TabButton active={outgoingTab === 'approved'} onClick={() => setOutgoingTab('approved')}>
              Approved ({outCounts.approved})
            </TabButton>
            <TabButton active={outgoingTab === 'denied'} onClick={() => setOutgoingTab('denied')}>
              Declined ({outCounts.denied})
            </TabButton>
          </div>
          <div>
            <FlatList
              bookings={filteredOutgoing}
              isIncoming={false}
              renderPayments={renderOutgoingPayments}
              blocked={blocked}
              currentUser={currentUser}
              currentTab={outgoingTab}
              onApprove={(id) => djUpdateStatus(id, 'approved')}
              onDeny={(id) => djUpdateStatus(id, 'denied')}
              onCancel={cancelOutgoing}
                onCancelIncoming={cancelIncoming}
              onBlock={blockUser}
              onUnblock={unblockUser}
              onCounter={openCounterModal}
              onSendQuote={openQuoteModal}
                onSendDraftQuote={sendDraftQuote}
                onViewHistory={openHistoryModal}
              onAcceptCounter={acceptCounter}
              onDeclineCounter={declineCounter}
              onMessage={openComposeModal}
            />
            {filteredOutgoing.length === 0 && (
              <EmptyState>{emptyLabel(outgoingTab)}</EmptyState>
            )}
          </div>
        </div>
      )}

      {/* Edge case: no sections visible at all */}
      {!showIncoming && !showOutgoing && (
        <EmptyState>You don&apos;t have any booking requests yet.</EmptyState>
      )}

      {/* Modals — only one open at a time */}
      {counterModal && (
        <CounterModal
          booking={counterModal.booking}
          group={counterModal.group}
          onClose={() => setCounterModal(null)}
          onSaved={(updated) => applyBookingUpdate(updated)}
        />
      )}
      {quoteModal && (
        <QuoteModal
          booking={quoteModal.booking}
          depositPct={currentUser.depositPct}
          onClose={() => setQuoteModal(null)}
          onSaved={(updated) => applyBookingUpdate(updated)}
        />
      )}
      {historyModal && (
        <HistoryModal
          booking={historyModal.booking}
          isIncoming={historyModal.isIncoming}
          onClose={() => setHistoryModal(null)}
        />
      )}
      {composeModal && (
        <ComposeMessageModal
          sender={{
            id: currentUser.id,
            name: currentUser.name || 'A user',
            email: currentUser.email || null,
          }}
          recipientUserId={composeModal.recipientUserId}
          recipientName={composeModal.recipientName}
          defaultSubject={composeModal.defaultSubject}
          onClose={() => setComposeModal(null)}
        />
      )}
      {/* Site-uniform confirm dialog (replaces window.confirm). Rendered
          at the top level so it sits above all card content. */}
      {confirmDialog}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.tabBtn} ${active ? styles.tabBtnActive : ''}`}
    >
      {children}
    </button>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className={styles.emptyState}>{children}</div>;
}

// Empty-state copy per tab — reads naturally for each filter name.
function emptyLabel(tab: BookingFilter): string {
  switch (tab) {
    case 'respond': return 'Nothing needs your response right now.';
    case 'awaiting': return 'Nothing is awaiting a response.';
    case 'approved': return 'No approved bookings.';
    case 'denied': return 'No declined bookings.';
    case 'all': return 'No bookings yet.';
    default: return 'No bookings.';
  }
}

interface ListProps {
  bookings: BookingRow[];
  isIncoming: boolean;
  blocked: string[];
  currentUser: CurrentUser;
  /** Current tab filter — used to decide whether collapsed banners show
      a status pill (only on the "all" tab where statuses actually vary). */
  currentTab: string;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onCancel: (id: string) => void;
  onCancelIncoming: (id: string) => void;
  onBlock: (userId: string, userName: string) => void;
  onUnblock: (userId: string) => void;
  // Counter / Quote / counter-response handlers
  onCounter: (b: BookingRow, group: 'in' | 'out') => void;
  onSendQuote: (b: BookingRow) => void;
  onSendDraftQuote: (b: BookingRow) => void;
  onViewHistory: (b: BookingRow, isIncoming: boolean) => void;
  onAcceptCounter: (id: string) => void;
  onDeclineCounter: (id: string) => void;
  onMessage: (recipientUserId: string, recipientName: string, subject: string) => void;
  // Builds the card's paymentsSlot for a booking (PaymentOptions blocks).
  // Only supplied for the OUTGOING list — payment handles must never render
  // outside the host's own booking card.
  renderPayments?: (b: BookingRow) => React.ReactNode;
}

function FlatList({
  bookings, isIncoming, blocked, currentUser, currentTab,
  onApprove, onDeny, onCancel, onCancelIncoming, onBlock, onUnblock,
  onCounter, onSendQuote, onSendDraftQuote, onViewHistory, onAcceptCounter, onDeclineCounter,
  onMessage, renderPayments,
}: ListProps) {
  // Track which bookings are currently expanded. Default rules:
  //   - On the "pending" tab: ALL bookings expanded by default (the user
  //     can collapse individually). Pending requests are the most action-
  //     oriented — keep them visible.
  //   - On any other tab: only the FIRST booking expanded, rest collapsed.
  // The user's manual collapse/expand actions are preserved until they
  // switch tabs (the useEffect below resets on tab change).
  const firstId = bookings[0]?.id;
  function defaultExpanded(tab: string, list: BookingRow[]): Set<string> {
    // Response Required is the action tab — expand every card so the DJ
    // / booker sees all items needing attention at once.
    if (tab === 'respond') return new Set(list.map((b) => b.id));
    return new Set(list[0] ? [list[0].id] : []);
  }
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => defaultExpanded(currentTab, bookings),
  );

  // When the user switches tabs, reset expansion to the default for that
  // tab. We deliberately only watch currentTab — the bookings array also
  // changes when a status mutates (approve / deny etc.) but resetting on
  // every mutation would close cards mid-action.
  useEffect(() => {
    setExpandedIds(defaultExpanded(currentTab, bookings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTab]);

  function toggle(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      {bookings.map((b) => {
        if (!expandedIds.has(b.id)) {
          return (
            <CollapsibleBanner
              key={b.id}
              booking={b}
              isIncoming={isIncoming}
              currentTab={currentTab}
              onClick={() => toggle(b.id)}
            />
          );
        }
        // Pick card by booking_type. Treat unknown / null as 'mobile' for
        // legacy rows (vanilla didn't always set booking_type early on).
        const Card = b.booking_type === 'club' ? ClubBookingCard : MobileBookingCard;
        return (
          <div key={b.id} className={styles.expandableWrap}>
            <div
              className={styles.collapseBar}
              onClick={() => toggle(b.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(b.id); } }}
              aria-label="Collapse booking"
              title="Collapse"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </div>
            <Card
              booking={b}
              isIncoming={isIncoming}
              orderNum={null}
              isBlocked={blocked.includes(isIncoming ? b.requester_id : b.dj_id)}
              djZip={currentUser.zip}
              djCity={currentUser.city}
              djState={currentUser.state}
              djTravelDistance={currentUser.travelDistance}
              onApprove={onApprove}
              onDeny={onDeny}
              onCancel={onCancel}
              onCancelIncoming={onCancelIncoming}
              onBlock={onBlock}
              onUnblock={onUnblock}
              onCounter={onCounter}
              onSendQuote={onSendQuote}
              onSendDraftQuote={onSendDraftQuote}
              onViewHistory={onViewHistory}
              onAcceptCounter={onAcceptCounter}
              onDeclineCounter={onDeclineCounter}
              onMessage={onMessage}
              paymentsSlot={renderPayments ? renderPayments(b) : null}
            />
          </div>
        );
      })}
    </>
  );
}

// Same-day grouping for incoming pending. When the DJ has multiple pending
// requests for the same date, they're rendered in a wrapper card showing
// the count + an overlap warning if their times conflict + a time-gap
// label between the two events when only two bookings exist.
//
// Collapsible behavior: each day-group is treated as a single expandable
// unit. By default the FIRST day-group is expanded; the rest collapse into
// individual banners (one banner per booking, even within the same day).
// Clicking any banner expands the entire day-group at once — matching the
// "overlap rule": if one booking on a day is open, ALL bookings that day are.
function SameDayGrouped({
  bookings, isIncoming, blocked, currentUser, currentTab,
  onApprove, onDeny, onCancel, onCancelIncoming, onBlock, onUnblock,
  onCounter, onSendQuote, onSendDraftQuote, onViewHistory, onAcceptCounter, onDeclineCounter,
  onMessage,
}: ListProps) {
  // Group by event_date. Sort within group by created_at (oldest first
  // = first-come-first-served visual order).
  const groups: Record<string, BookingRow[]> = {};
  bookings.forEach((b) => {
    const key = b.event_date || 'no-date';
    if (!groups[key]) groups[key] = [];
    groups[key].push(b);
  });
  Object.values(groups).forEach((g) =>
    g.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  );
  // Sort groups by their first item's created_at — so the most recent group
  // shows up at the top.
  const sortedGroups = Object.values(groups).sort(
    (a, b) => new Date(b[0].created_at).getTime() - new Date(a[0].created_at).getTime()
  );

  // Group-level expansion state. Keyed by event_date (the group key).
  // SameDayGrouped is only rendered on the incoming "pending" tab, so all
  // day-groups are expanded by default. The user can collapse individual
  // groups manually if they want.
  function defaultExpandedGroups(groups: BookingRow[][]): Set<string> {
    return new Set(groups.map((g) => g[0].event_date || g[0].id));
  }
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => defaultExpandedGroups(sortedGroups),
  );

  // Reset to "all groups expanded" on tab change.
  useEffect(() => {
    setExpandedGroups(defaultExpandedGroups(sortedGroups));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTab]);

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      {sortedGroups.map((group) => {
        const groupKey = group[0].event_date || group[0].id;
        const isExpanded = expandedGroups.has(groupKey);

        // Collapsed state — render a banner for each booking in the group.
        // Clicking any banner expands the whole group (overlap rule).
        if (!isExpanded) {
          return (
            <div key={groupKey} className={styles.collapsedGroup}>
              {group.map((b) => (
                <CollapsibleBanner
                  key={b.id}
                  booking={b}
                  isIncoming={isIncoming}
                  currentTab={currentTab}
                  onClick={() => toggleGroup(groupKey)}
                />
              ))}
            </div>
          );
        }

        // Expanded state — original rendering logic.
        const hasMultiple = group.length > 1;
        const hasOverlap =
          hasMultiple &&
          group.some((a, i) => group.slice(i + 1).some((b) => bookingsOverlap(a, b)));

        // Time gap label for 2-booking groups
        let timeGapLabel: string | null = null;
        let timeGapColor = 'var(--neon)';
        if (hasMultiple && group.length === 2) {
          const [a, b] = group;
          if (a.start_time && a.end_time && b.start_time) {
            const aStartMins = timeToMins(a.start_time)!;
            let aEndMins = timeToMins(a.end_time)!;
            const bStartMins = timeToMins(b.start_time)!;
            if (aEndMins < aStartMins) aEndMins += 1440;
            const gapMins = bStartMins - aEndMins;
            if (gapMins < 0) {
              timeGapLabel = 'SETS OVERLAP';
              timeGapColor = 'var(--error)';
            } else {
              const gapHrs = Math.floor(gapMins / 60);
              const gapRem = gapMins % 60;
              timeGapLabel =
                (gapHrs > 0
                  ? `${gapHrs}h${gapRem > 0 ? ' ' + gapRem + 'm' : ''}`
                  : `${gapRem}m`) + ' GAP BETWEEN SETS';
              timeGapColor = gapMins < 60 ? 'var(--amber)' : 'var(--neon)';
            }
          }
        }

        const cards = group.map((b, idx) => {
          const Card = b.booking_type === 'club' ? ClubBookingCard : MobileBookingCard;
          return (
            <Card
              key={b.id}
              booking={b}
              isIncoming={isIncoming}
              orderNum={hasMultiple ? idx + 1 : null}
              isBlocked={blocked.includes(b.requester_id)}
              djZip={currentUser.zip}
              djCity={currentUser.city}
              djState={currentUser.state}
              djTravelDistance={currentUser.travelDistance}
              onApprove={onApprove}
              onDeny={onDeny}
              onCancel={onCancel}
              onCancelIncoming={onCancelIncoming}
              onBlock={onBlock}
              onUnblock={onUnblock}
              onCounter={onCounter}
              onSendQuote={onSendQuote}
              onSendDraftQuote={onSendDraftQuote}
              onViewHistory={onViewHistory}
              onAcceptCounter={onAcceptCounter}
              onDeclineCounter={onDeclineCounter}
              onMessage={onMessage}
            />
          );
        });

        // Single-booking day, expanded: render the card with a collapse chevron
        // appended (matches FlatList's expanded-card UX).
        if (!hasMultiple) {
          return (
            <div key={groupKey} className={styles.expandableWrap}>
              <div
                className={styles.collapseBar}
                onClick={() => toggleGroup(groupKey)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(groupKey); } }}
                aria-label="Collapse booking"
                title="Collapse"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </div>
              {cards}
            </div>
          );
        }

        // Multi-booking day, expanded: original wrapper + a collapse chevron
        // on the group header.
        return (
          <div
            key={groupKey}
            className={`${styles.groupWrap} ${hasOverlap ? styles.groupWrapOverlap : ''}`}
          >
            <div className={`${styles.groupHeader} ${hasOverlap ? styles.groupHeaderOverlap : ''}`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>
                {hasOverlap
                  ? `${group.length} OVERLAPPING REQUESTS FOR ${formatShortDate(group[0].event_date).toUpperCase()} — ORDER RECEIVED`
                  : `${group.length} REQUESTS FOR ${formatShortDate(group[0].event_date).toUpperCase()} — TIMES DON'T OVERLAP, CAN ACCEPT BOTH`}
              </span>
              <button
                type="button"
                className={styles.collapseBtnInline}
                onClick={() => toggleGroup(groupKey)}
                aria-label="Collapse group"
                title="Collapse"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
            </div>
            {timeGapLabel && (
              <div className={styles.logisticsBar}>
                <span style={{ color: timeGapColor }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {' '}{timeGapLabel}
                </span>
              </div>
            )}
            {cards}
          </div>
        );
      })}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CollapsibleBanner — single-line summary for collapsed bookings.
//
// Content varies by booking type AND direction:
//   - Incoming Club/Bar DJ: date · start–end time · venue
//   - Incoming Mobile DJ:   date · start–end time · event type
//   - Outgoing (host/venue): date · start time
//
// Clicking anywhere on the banner triggers onClick (parent toggles the
// expanded state). Chevron icon on the right signals it's expandable.
// ─────────────────────────────────────────────────────────────────────────

function CollapsibleBanner({
  booking,
  isIncoming,
  currentTab,
  onClick,
}: {
  booking: BookingRow;
  isIncoming: boolean;
  currentTab: string;
  onClick: () => void;
}) {
  // Stacked-pill date parts (big day, stacked DOW + month) — matches
  // the upcoming-bookings row and the public-profile event list.
  const dateParts = (() => {
    const d = booking.event_date;
    if (!d) return { day: '—', dow: '', mo: '' };
    const [y, m, day] = d.split('-').map((s) => parseInt(s, 10));
    const dt = new Date(y, m - 1, day);
    return {
      day: String(day),
      dow: dt.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
      mo: dt.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
    };
  })();
  const startTime = formatTime(booking.start_time);
  const endTime = formatTime(booking.end_time);
  const timeStr = endTime ? `${startTime}–${endTime}` : startTime;

  // Build the right-hand "context" cell per role/section. This is the
  // last text column before the status pill / chevron.
  let context = '';
  if (!isIncoming) {
    // Outgoing: no extra context, just date + time.
    context = '';
  } else if (booking.booking_type === 'club') {
    // Incoming club: venue name (or TBD)
    context = booking.venue_name?.trim() || 'Venue TBD';
  } else {
    // Incoming mobile: event type label
    const eventTypeRaw = booking.event_type || '';
    context =
      (MOB_EVENT_LABELS as Record<string, string>)[eventTypeRaw] ||
      (eventTypeRaw
        ? eventTypeRaw.charAt(0).toUpperCase() + eventTypeRaw.slice(1)
        : 'Event');
  }

  // Status pill — only rendered when the user is viewing the "all" tab,
  // where statuses vary. On Pending/Approved/Denied/Counter tabs every
  // booking has the same status so the pill would be noise.
  const showStatus = currentTab === 'all';
  const statusRaw = (booking.status || '').toLowerCase();
  const statusClass =
    statusRaw === 'pending' ? styles.statusPillPending :
    statusRaw === 'approved' ? styles.statusPillApproved :
    statusRaw === 'denied' ? styles.statusPillDenied :
    statusRaw === 'counter' ? styles.statusPillCounter :
    statusRaw === 'cancelled' ? styles.statusPillCancelled :
    '';

  // Build aria-label that flattens the columns for screen readers.
  const ariaDate = [dateParts.dow, dateParts.day, dateParts.mo].filter(Boolean).join(' ');
  const ariaLabel = `Expand booking: ${[ariaDate, timeStr, context].filter(Boolean).join(' · ')}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={styles.collapsedBanner}
      aria-label={ariaLabel}
    >
      <span className={styles.collapsedBannerDate}>
        <span className={styles.dayNum}>{dateParts.day}</span>
        <span className={styles.dayMeta}>
          <span className={styles.dow}>{dateParts.dow}</span>
          <span className={styles.mo}>{dateParts.mo}</span>
        </span>
      </span>
      {timeStr && <span className={styles.collapsedBannerTime}>{timeStr}</span>}
      {context && <span className={styles.collapsedBannerContext}>{context}</span>}
      {showStatus && statusRaw && (
        <span className={`${styles.statusPill} ${statusClass}`}>
          {statusRaw.toUpperCase()}
        </span>
      )}
      <svg
        className={styles.collapsedBannerChevron}
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}
