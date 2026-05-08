'use client';

// BookingRequestsClient — top-level container for /booking-requests.
// Manages: state (incoming/outgoing arrays, blocked list), section visibility
// (incoming only for DJs), per-section tabs, and the list rendering router.
//
// All actions (approve/deny/cancel/block/unblock) update local state
// optimistically + write to DB. No re-fetch round-trip needed.
//
// Faithful port of vanilla br-load-render.js renderList + br-shared-actions.js.

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './bookingRequests.module.css';
import MobileBookingCard from './MobileBookingCard';
import ClubBookingCard from './ClubBookingCard';
import CounterModal from './CounterModal';
import QuoteModal from './QuoteModal';
import ComposeMessageModal from '@/components/ComposeMessageModal';
import { useConfirm } from '@/components/ConfirmModal';
import { bookingsOverlap, formatShortDate, timeToMins } from './helpers';
import type { BookingRow } from './page';

interface CurrentUser {
  id: string;
  name: string;
  // Email is from auth.users (passed in by the page). Used as the From:
  // when this user sends a message via the compose modal.
  email: string | null;
  role: string;
  djType: 'mobile' | 'club' | null;
  zip: string | null;
  travelDistance: string | null;
  // Deposit percentage from DJ's booking_settings (0-100). Used for the
  // Quote modal's live deposit preview. 0 means DJ doesn't take a deposit.
  depositPct: number;
}

interface Props {
  currentUser: CurrentUser;
  initialIncoming: BookingRow[];
  initialOutgoing: BookingRow[];
  initialBlocked: string[];
}

type IncomingFilter = 'pending' | 'approved' | 'denied' | 'all';
type OutgoingFilter = 'pending' | 'counter' | 'approved' | 'denied' | 'all';

export default function BookingRequestsClient({
  currentUser,
  initialIncoming,
  initialOutgoing,
  initialBlocked,
}: Props) {
  const [incoming, setIncoming] = useState<BookingRow[]>(initialIncoming);
  const [outgoing, setOutgoing] = useState<BookingRow[]>(initialOutgoing);
  const [blocked, setBlocked] = useState<string[]>(initialBlocked);
  const [incomingTab, setIncomingTab] = useState<IncomingFilter>('pending');
  const [outgoingTab, setOutgoingTab] = useState<OutgoingFilter>('pending');

  // Modal state — only one is ever open at a time.
  // counterModal: which booking we're countering, and from which side
  //   ('in' = DJ countering an incoming, 'out' = booker re-countering)
  // quoteModal: which booking the DJ is sending a price for
  const [counterModal, setCounterModal] = useState<{
    booking: BookingRow;
    group: 'in' | 'out';
  } | null>(null);
  const [quoteModal, setQuoteModal] = useState<{ booking: BookingRow } | null>(null);
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
  const inCounts = { pending: 0, approved: 0, denied: 0, counter: 0, cancelled: 0 };
  incoming.forEach((b) => {
    const s = b.status as keyof typeof inCounts;
    if (s in inCounts) inCounts[s]++;
  });
  const inAll = inCounts.pending + inCounts.approved + inCounts.denied + inCounts.counter;

  const outCounts = { pending: 0, counter: 0, approved: 0, denied: 0, cancelled: 0 };
  outgoing.forEach((b) => {
    const s = b.status as keyof typeof outCounts;
    if (s in outCounts) outCounts[s]++;
  });
  // Show counter bookings under pending for the requester (awaiting their response)
  const outPendingCount = outCounts.pending + outCounts.counter;
  const outAll = outPendingCount + outCounts.approved + outCounts.denied;

  // ── Filtered lists ─────────────────────────────────────────────
  const filteredIncoming = (() => {
    if (incomingTab === 'all') return incoming.filter((b) => b.status !== 'cancelled');
    return incoming.filter((b) => b.status === incomingTab);
  })();

  const filteredOutgoing = (() => {
    if (outgoingTab === 'all') return outgoing.filter((b) => b.status !== 'cancelled');
    if (outgoingTab === 'pending') return outgoing.filter((b) => b.status === 'pending' || b.status === 'counter');
    return outgoing.filter((b) => b.status === outgoingTab);
  })();

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
    const ok = await confirm({
      title: isApprove ? 'Approve this booking?' : 'Deny this booking?',
      message: isApprove
        ? 'The booker will be notified by email and the date will be marked as booked on your calendar.'
        : 'The booker will be notified by email that you cannot accept this booking.',
      confirmLabel: isApprove ? 'Approve' : 'Deny',
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
            currency: (b as BookingRow & { currency?: string }).currency || 'USD',
            eventDate: b.event_date,
            startTime: b.start_time,
            endTime: b.end_time,
            setType: (b as BookingRow & { set_type?: string | null }).set_type,
            venueType: (b as BookingRow & { venue_type?: string | null }).venue_type,
            eventType: (b as BookingRow & { event_type?: string | null }).event_type,
            venueName: b.venue_name,
            venueAddress: (b as BookingRow & { venue_address?: string | null }).venue_address,
            packageTitle: b.package_title,
          };
          // To booker
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

      // Decrement bookings_available on approve. Re-read settings first so
      // we don't clobber concurrent edits — same defensive pattern as the
      // owner calendar's persistBookingDays.
      if (status === 'approved' && b && b.event_date) {
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
          } = {};
          if (djRow?.booking_settings) {
            try {
              bs = JSON.parse(djRow.booking_settings);
            } catch {
              bs = {};
            }
          }
          const defaultPerDay = bs.mob_bookings_per_day || 1;
          if (!bs.mob_booking_days) bs.mob_booking_days = {};
          const dayData = bs.mob_booking_days[b.event_date] || {};
          const current = dayData.bookings_available != null ? dayData.bookings_available : defaultPerDay;
          const newCount = Math.max(0, current - 1);
          bs.mob_booking_days[b.event_date] = { ...dayData, bookings_available: newCount };
          await supabase
            .from('users')
            .update({ booking_settings: JSON.stringify(bs) } as unknown as never)
            .eq('id', currentUser.id);
        } catch (calErr) {
          console.error('Calendar decrement failed:', calErr);
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
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'approved', updated_at: new Date().toISOString() } as unknown as never)
        .eq('id', bookingId)
        .eq('requester_id', currentUser.id);
      if (error) throw error;
      const b = outgoing.find((x) => x.id === bookingId);
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
          currency: (b as BookingRow & { currency?: string }).currency || 'USD',
          eventDate: b.event_date,
          startTime: b.start_time,
          endTime: b.end_time,
          setType: (b as BookingRow & { set_type?: string | null }).set_type,
          venueType: (b as BookingRow & { venue_type?: string | null }).venue_type,
          eventType: (b as BookingRow & { event_type?: string | null }).event_type,
          venueName: b.venue_name,
          venueAddress: (b as BookingRow & { venue_address?: string | null }).venue_address,
          packageTitle: b.package_title,
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

  // ── Modal open helpers ─────────────────────────────────────────────
  function openCounterModal(booking: BookingRow, group: 'in' | 'out') {
    setCounterModal({ booking, group });
  }
  function openQuoteModal(booking: BookingRow) {
    setQuoteModal({ booking });
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
      // Flip status to 'counter' so:
      //  - The booking leaves the DJ's Pending tab (filter is status==='pending')
      //  - The booker sees Accept / Counter Back / Decline buttons
      //    (booker actions gate on status === 'counter')
      //  - DJ no longer sees Approve/Deny on a quote they themselves
      //    just sent — the ball is in the booker's court.
      const { error } = await supabase
        .from('bookings')
        .update({
          quote_sent_at: nowIso,
          status: 'counter',
          updated_at: nowIso,
        } as unknown as never)
        .eq('id', b.id)
        .eq('dj_id', currentUser.id);
      if (error) throw error;
      // Patch local state so the UI flips immediately.
      applyBookingUpdate({ ...b, quote_sent_at: nowIso, status: 'counter', updated_at: nowIso });
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

  // Page subtitle echoes the user's role so the page makes sense at a glance.
  const pageSub = isDj
    ? 'Manage incoming requests + your outgoing bookings'
    : 'Manage your booking requests';

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Booking Requests</h1>
      <div className={styles.pageSub}>{pageSub}</div>

      {/* INCOMING — DJs only */}
      {showIncoming && (
        <div className={styles.section}>
          <div className={styles.sectionLabelIn}>Incoming Booking Requests</div>
          <div className={styles.tabs}>
            <TabButton active={incomingTab === 'pending'} onClick={() => setIncomingTab('pending')}>
              Pending ({inCounts.pending})
            </TabButton>
            <TabButton active={incomingTab === 'approved'} onClick={() => setIncomingTab('approved')}>
              Approved ({inCounts.approved})
            </TabButton>
            <TabButton active={incomingTab === 'denied'} onClick={() => setIncomingTab('denied')}>
              Denied ({inCounts.denied})
            </TabButton>
            <TabButton active={incomingTab === 'all'} onClick={() => setIncomingTab('all')}>
              All ({inAll})
            </TabButton>
          </div>
          <div>
            {/* Same-day grouping for incoming pending only */}
            {incomingTab === 'pending' ? (
              <SameDayGrouped
                bookings={filteredIncoming}
                isIncoming={true}
                blocked={blocked}
                currentUser={currentUser}
                onApprove={(id) => djUpdateStatus(id, 'approved')}
                onDeny={(id) => djUpdateStatus(id, 'denied')}
                onCancel={cancelOutgoing}
                onCancelIncoming={cancelIncoming}
                onBlock={blockUser}
                onUnblock={unblockUser}
                onCounter={openCounterModal}
                onSendQuote={openQuoteModal}
                onSendDraftQuote={sendDraftQuote}
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
                onApprove={(id) => djUpdateStatus(id, 'approved')}
                onDeny={(id) => djUpdateStatus(id, 'denied')}
                onCancel={cancelOutgoing}
                onCancelIncoming={cancelIncoming}
                onBlock={blockUser}
                onUnblock={unblockUser}
                onCounter={openCounterModal}
                onSendQuote={openQuoteModal}
                onSendDraftQuote={sendDraftQuote}
                onAcceptCounter={acceptCounter}
                onDeclineCounter={declineCounter}
                onMessage={openComposeModal}
              />
            )}
            {filteredIncoming.length === 0 && (
              <EmptyState>No {incomingTab} requests.</EmptyState>
            )}
          </div>
        </div>
      )}

      {/* OUTGOING — all roles */}
      {showOutgoing && (
        <div className={styles.section}>
          <div className={styles.sectionLabelOut}>Outgoing Booking Requests</div>
          <div className={styles.tabs}>
            <TabButton active={outgoingTab === 'pending'} onClick={() => setOutgoingTab('pending')}>
              Pending ({outPendingCount})
            </TabButton>
            <TabButton active={outgoingTab === 'counter'} onClick={() => setOutgoingTab('counter')}>
              Counter ({outCounts.counter})
            </TabButton>
            <TabButton active={outgoingTab === 'approved'} onClick={() => setOutgoingTab('approved')}>
              Approved ({outCounts.approved})
            </TabButton>
            <TabButton active={outgoingTab === 'denied'} onClick={() => setOutgoingTab('denied')}>
              Denied ({outCounts.denied})
            </TabButton>
            <TabButton active={outgoingTab === 'all'} onClick={() => setOutgoingTab('all')}>
              All ({outAll})
            </TabButton>
          </div>
          <div>
            <FlatList
              bookings={filteredOutgoing}
              isIncoming={false}
              blocked={blocked}
              currentUser={currentUser}
              onApprove={(id) => djUpdateStatus(id, 'approved')}
              onDeny={(id) => djUpdateStatus(id, 'denied')}
              onCancel={cancelOutgoing}
                onCancelIncoming={cancelIncoming}
              onBlock={blockUser}
              onUnblock={unblockUser}
              onCounter={openCounterModal}
              onSendQuote={openQuoteModal}
                onSendDraftQuote={sendDraftQuote}
              onAcceptCounter={acceptCounter}
              onDeclineCounter={declineCounter}
              onMessage={openComposeModal}
            />
            {filteredOutgoing.length === 0 && (
              <EmptyState>No {outgoingTab} bookings.</EmptyState>
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

interface ListProps {
  bookings: BookingRow[];
  isIncoming: boolean;
  blocked: string[];
  currentUser: CurrentUser;
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
  onAcceptCounter: (id: string) => void;
  onDeclineCounter: (id: string) => void;
  onMessage: (recipientUserId: string, recipientName: string, subject: string) => void;
}

function FlatList({
  bookings, isIncoming, blocked, currentUser,
  onApprove, onDeny, onCancel, onCancelIncoming, onBlock, onUnblock,
  onCounter, onSendQuote, onSendDraftQuote, onAcceptCounter, onDeclineCounter,
  onMessage,
}: ListProps) {
  return (
    <>
      {bookings.map((b) => {
        // Pick card by booking_type. Treat unknown / null as 'mobile' for
        // legacy rows (vanilla didn't always set booking_type early on).
        const Card = b.booking_type === 'club' ? ClubBookingCard : MobileBookingCard;
        return (
          <Card
            key={b.id}
            booking={b}
            isIncoming={isIncoming}
            orderNum={null}
            isBlocked={blocked.includes(isIncoming ? b.requester_id : b.dj_id)}
            djZip={currentUser.zip}
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
            onAcceptCounter={onAcceptCounter}
            onDeclineCounter={onDeclineCounter}
            onMessage={onMessage}
          />
        );
      })}
    </>
  );
}

// Same-day grouping for incoming pending. When the DJ has multiple pending
// requests for the same date, they're rendered in a wrapper card showing
// the count + an overlap warning if their times conflict + a time-gap
// label between the two events when only two bookings exist.
function SameDayGrouped({
  bookings, isIncoming, blocked, currentUser,
  onApprove, onDeny, onCancel, onCancelIncoming, onBlock, onUnblock,
  onCounter, onSendQuote, onSendDraftQuote, onAcceptCounter, onDeclineCounter,
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

  return (
    <>
      {sortedGroups.map((group) => {
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
              onAcceptCounter={onAcceptCounter}
              onDeclineCounter={onDeclineCounter}
              onMessage={onMessage}
            />
          );
        });

        if (!hasMultiple) return cards;

        return (
          <div
            key={group[0].id}
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
