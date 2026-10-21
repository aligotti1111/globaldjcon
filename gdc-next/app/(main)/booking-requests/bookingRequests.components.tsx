'use client';

import { useEffect, useState } from 'react';
import styles from './bookingRequests.module.css';
import MobileBookingCard from './MobileBookingCard';
import ClubBookingCard from './ClubBookingCard';
import ExpiryBadge from './ExpiryBadge';
import { bookingsOverlap, formatShortDate, formatTime, timeToMins, MOB_EVENT_LABELS } from './helpers';
import type { BookingRow } from './page';
import type { CurrentUser } from './BookingRequestsClient';

export function TabButton({
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

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className={styles.emptyState}>{children}</div>;
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
  /** Deep-link target — expand + scroll to this booking on mount. */
  focusId?: string | null;
  /** Sort order for the day-groups (newest = most recently received first). */
  sortOrder?: 'newest' | 'oldest';
}

export function FlatList({
  bookings, isIncoming, blocked, currentUser, currentTab, focusId,
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

  // Deep-link focus: if the ?open target lives in this list, make sure it's
  // expanded and scroll it into view.
  useEffect(() => {
    if (!focusId || !bookings.some((b) => b.id === focusId)) return;
    setExpandedIds((prev) => (prev.has(focusId) ? prev : new Set(prev).add(focusId)));
    const t = setTimeout(() => {
      document.querySelector(`[data-booking-id="${focusId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 220);
    return () => clearTimeout(t);
  }, [focusId, bookings]);

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
          <div key={b.id} data-booking-id={b.id} className={styles.expandableWrap}>
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
              expirySlot={<ExpiryBadge booking={b} tz={currentUser.timezone} />}
              isBlocked={blocked.includes(isIncoming ? b.requester_id : b.dj_id)}
              canAct={currentUser.canAct && (isIncoming ? currentUser.canDecide : true)}
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
export function SameDayGrouped({
  bookings, isIncoming, blocked, currentUser, currentTab,
  onApprove, onDeny, onCancel, onCancelIncoming, onBlock, onUnblock,
  onCounter, onSendQuote, onSendDraftQuote, onViewHistory, onAcceptCounter, onDeclineCounter,
  onMessage, sortOrder = 'newest',
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
  // Sort groups by their first item's created_at, honoring the newest/oldest
  // toggle (newest group at the top by default).
  const sortedGroups = Object.values(groups).sort((a, b) => {
    const ta = new Date(a[0].created_at).getTime();
    const tb = new Date(b[0].created_at).getTime();
    return sortOrder === 'newest' ? tb - ta : ta - tb;
  });

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
              canAct={currentUser.canAct && (isIncoming ? currentUser.canDecide : true)}
              djZip={currentUser.zip}
              djCity={currentUser.city}
              djState={currentUser.state}
              djTravelDistance={currentUser.travelDistance}
              expirySlot={<ExpiryBadge booking={b} tz={currentUser.timezone} />}
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

export function CollapsibleBanner({
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
