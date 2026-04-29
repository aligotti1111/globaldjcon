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
import CounterModal from './CounterModal';
import QuoteModal from './QuoteModal';
import { bookingsOverlap, formatShortDate, timeToMins } from './helpers';
import type { BookingRow } from './page';

interface CurrentUser {
  id: string;
  name: string;
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
    const verb = status === 'approved' ? 'Approve' : 'Deny';
    if (!confirm(`${verb} this booking?`)) return;
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
    if (!confirm('Cancel this booking request? The DJ will be notified.')) return;
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
      setOutgoing((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, status: 'approved' } : b))
      );
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'Unknown'));
    }
  }

  // Booker declines the DJ's counter → status='denied'.
  // Vanilla also lets the booker counter back instead — for that they'd
  // open the CounterModal with group='out' (handled by openCounter('out')).
  async function declineCounter(bookingId: string) {
    if (!confirm('Decline this counter offer?')) return;
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
    if (!confirm(`Block ${userName}? They will no longer be able to send you booking requests or messages.`)) return;
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
                onBlock={blockUser}
                onUnblock={unblockUser}
                onCounter={openCounterModal}
                onSendQuote={openQuoteModal}
                onAcceptCounter={acceptCounter}
                onDeclineCounter={declineCounter}
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
                onBlock={blockUser}
                onUnblock={unblockUser}
                onCounter={openCounterModal}
                onSendQuote={openQuoteModal}
                onAcceptCounter={acceptCounter}
                onDeclineCounter={declineCounter}
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
              onBlock={blockUser}
              onUnblock={unblockUser}
              onCounter={openCounterModal}
              onSendQuote={openQuoteModal}
              onAcceptCounter={acceptCounter}
              onDeclineCounter={declineCounter}
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
  onBlock: (userId: string, userName: string) => void;
  onUnblock: (userId: string) => void;
  // Counter / Quote / counter-response handlers
  onCounter: (b: BookingRow, group: 'in' | 'out') => void;
  onSendQuote: (b: BookingRow) => void;
  onAcceptCounter: (id: string) => void;
  onDeclineCounter: (id: string) => void;
}

function FlatList({
  bookings, isIncoming, blocked, currentUser,
  onApprove, onDeny, onCancel, onBlock, onUnblock,
  onCounter, onSendQuote, onAcceptCounter, onDeclineCounter,
}: ListProps) {
  return (
    <>
      {bookings.map((b) => (
        <MobileBookingCard
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
          onBlock={onBlock}
          onUnblock={onUnblock}
          onCounter={onCounter}
          onSendQuote={onSendQuote}
          onAcceptCounter={onAcceptCounter}
          onDeclineCounter={onDeclineCounter}
        />
      ))}
    </>
  );
}

// Same-day grouping for incoming pending. When the DJ has multiple pending
// requests for the same date, they're rendered in a wrapper card showing
// the count + an overlap warning if their times conflict + a time-gap
// label between the two events when only two bookings exist.
function SameDayGrouped({
  bookings, isIncoming, blocked, currentUser,
  onApprove, onDeny, onCancel, onBlock, onUnblock,
  onCounter, onSendQuote, onAcceptCounter, onDeclineCounter,
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

        const cards = group.map((b, idx) => (
          <MobileBookingCard
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
            onBlock={onBlock}
            onUnblock={onUnblock}
            onCounter={onCounter}
            onSendQuote={onSendQuote}
            onAcceptCounter={onAcceptCounter}
            onDeclineCounter={onDeclineCounter}
          />
        ));

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
