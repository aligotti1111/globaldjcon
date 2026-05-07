'use client';

// BookingCardShell — the shared chrome around every booking card.
//
// Renders status accent strip, status badge, header (event label),
// contact info + Message button, notes, actions row (Approve/Deny/
// Counter/Cancel/Block), and optional Block/Unblock pill. The bits
// that vary between mobile and club bookings (date+event details,
// pricing block) come in as slot props so the shell stays generic.
//
// MobileBookingCard and ClubBookingCard are both thin wrappers that
// compute their type-specific labels and details, then pass them to
// this shell. New booking-card features should be added HERE if they
// apply to both types.

import type { ReactNode } from 'react';
import styles from './bookingRequests.module.css';
import type { BookingRow } from './page';

// Re-exported here so callers can import everything from the shell file.
// Matches the props every Card variant needs from BookingRequestsClient.
export interface BookingCardShellProps {
  booking: BookingRow;
  isIncoming: boolean;
  orderNum: number | null;
  isBlocked: boolean;
  // Variant-specific bits — passed in by Mobile/ClubBookingCard
  eventLabel: string;          // Header big text (e.g. "Wedding" / "Club · Headliner")
  detailsSlot: ReactNode;      // Date+venue/equipment/etc — replaces the unique middle
  pricingSlot: ReactNode;      // Package&Price (mobile) or Rate (club)
  // Action callbacks (same set across both card types)
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onCancel: (id: string) => void;
  onBlock: (userId: string, userName: string) => void;
  onUnblock: (userId: string) => void;
  onCounter: (b: BookingRow, group: 'in' | 'out') => void;
  onSendQuote: (b: BookingRow) => void;
  // Releases a drafted quote to the booker (sets quote_sent_at).
  // Club + quote-mode only — mobile and non-quote bookings use the
  // existing one-shot flow.
  onSendDraftQuote: (b: BookingRow) => void;
  onAcceptCounter: (id: string) => void;
  onDeclineCounter: (id: string) => void;
  onMessage: (recipientUserId: string, recipientName: string, subject: string) => void;
}

export default function BookingCardShell({
  booking: b,
  isIncoming,
  orderNum,
  isBlocked,
  eventLabel,
  detailsSlot,
  pricingSlot,
  onApprove, onDeny, onCancel, onBlock, onUnblock,
  onCounter, onSendQuote, onSendDraftQuote, onAcceptCounter, onDeclineCounter,
  onMessage,
}: BookingCardShellProps) {
  // ── Derived state shared by every card type ────────────────────
  const isQuote = !!b.is_quote;
  const isClub = b.booking_type === 'club';
  const status = (b.status || 'pending') as 'pending' | 'approved' | 'denied' | 'counter' | 'cancelled';

  // "Rate sent" — different signal per booking type because club quote-mode
  // has a draft → send two-step flow:
  //   - Club + quote-mode: quote_sent_at must be non-null. quoted_rate alone
  //     means "DJ drafted but didn't send"; booker shouldn't see the price.
  //   - Mobile + quote-mode: one-shot; quoted_rate alone counts as sent.
  //   - Non-quote bookings (offers mode, flat-rate accept): quoted_rate alone
  //     counts as sent — booker established the price by submitting.
  const hasRateSent = (isClub && isQuote)
    ? b.quote_sent_at != null
    : b.quoted_rate != null;

  // Drafted-but-not-sent — only meaningful for club + quote-mode bookings
  // where the DJ has typed a price (quoted_rate set) but hasn't released
  // it to the booker yet (quote_sent_at still null).
  const hasDraftedRate = isClub && isQuote && b.quoted_rate != null && b.quote_sent_at == null;

  // "Quote Requested" status label only applies BEFORE the DJ has sent
  // a rate. Once a rate has been sent, the booking acts like a normal
  // priced booking and shows the regular status.
  const statusLabel = isQuote && !hasRateSent && status === 'pending'
    ? 'Quote Requested'
    : status;

  const targetId = isIncoming ? b.requester_id : b.dj_id;
  const targetName = isIncoming ? (b.requester_name || 'this user') : (b.dj_name || 'this DJ');
  const targetLabel = isIncoming ? (b.requester_name || 'Booker') : (b.dj_name || 'DJ');

  // Status badge color class — keys match existing CSS module names
  // (.statusPending, .accentApproved, etc).
  const statusAccentClass = {
    pending: styles.accentPending,
    approved: styles.accentApproved,
    denied: styles.accentDenied,
    counter: styles.accentCounter,
    cancelled: styles.accentCancelled,
  }[status];

  const statusBadgeClass = {
    pending: styles.statusPending,
    approved: styles.statusApproved,
    denied: styles.statusDenied,
    counter: styles.statusCounter,
    cancelled: styles.statusCancelled,
  }[status];

  // Action visibility — DJ-side (incoming) vs booker-side (outgoing).
  // Approve/Deny/Counter/Send Quote → DJ when status is 'pending'.
  // Cancel → booker (outgoing) at any non-terminal status.
  // Accept/Decline counter → booker when DJ has countered.
  const showIncomingActions = isIncoming && status === 'pending';
  const showOutgoingCancel = !isIncoming && (status === 'pending' || status === 'counter');
  const showOutgoingCounterResponse = !isIncoming && status === 'counter';

  return (
    <div className={`${styles.card} ${styles[`card_${status}`]}`}>
      {/* The colored status accent strip used to render here at the top
          of the card. Removed — status is now communicated by the badge
          inside the Package & Price section, so the strip became
          redundant visual noise. statusAccentClass is kept above in case
          we want to reintroduce a subtle treatment later. */}

      {/* Header — order# only when present (grouped views).
          The event type is no longer rendered here as a big title. It now
          lives inside the detailsSlot in its own bracketed Section Frame
          ("EVENT TYPE" label) so all the event metadata is visually
          grouped consistently with Date & Time, Venue, etc. */}
      {orderNum != null && (
        <div className={styles.cardSection}>
          <div className={styles.orderBadgeWrap}>
            <span className={styles.orderBadge}>#{orderNum}</span>
          </div>
        </div>
      )}

      {/* Variant-specific middle: Date+Time, Venue, Equipment, etc.
          MobileBookingCard renders cocktail logic here too; ClubBookingCard
          renders venue+equipment. The shell stays agnostic. */}
      {detailsSlot}

      {/* Contact Info — DJ sees the booker's contact (host + phone always).
          Booker sees the DJ name always, plus DJ's email + phone only after
          the DJ approves the booking (server stitches dj_email/dj_phone
          onto approved outgoing rows). Message button appears for both. */}
      <SectionFrame label="Contact Info">
        <div className={styles.infoBlock}>
          <div className={styles.contactLine}>
            {isIncoming ? 'Host Name' : 'To'}: <span>{targetLabel}</span>
          </div>
          {/* DJ side: always show booker's phone */}
          {isIncoming && b.phone && (
            <div className={styles.contactLine}>
              Phone: <a href={`tel:${b.phone}`}>{b.phone}</a>
            </div>
          )}
          {/* Booker side: DJ's email + phone only after approval */}
          {!isIncoming && status === 'approved' && b.dj_email && (
            <div className={styles.contactLine}>
              Email: <a href={`mailto:${b.dj_email}`}>{b.dj_email}</a>
            </div>
          )}
          {!isIncoming && status === 'approved' && b.dj_phone && (
            <div className={styles.contactLine}>
              Phone: <a href={`tel:${b.dj_phone}`}>{b.dj_phone}</a>
            </div>
          )}
        </div>
        {/* Message button — opens the compose modal (parent owns it).
            Subject is pre-filled with the event date so the recipient
            can see at a glance which booking the message is about. */}
        <button
          type="button"
          className={styles.messageBtn}
          onClick={() => {
            const dateStr = b.event_date
              ? new Date(b.event_date + 'T12:00:00').toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                })
              : '';
            const subj = dateStr
              ? `Re: Booking on ${dateStr}`
              : 'Re: Your booking';
            onMessage(targetId, targetName, subj);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          {' '}Message {targetLabel}
        </button>
      </SectionFrame>

      {/* Notes (booker's message attached to the request) */}
      {b.notes && (
        <SectionFrame label="Message From Booker">
          <div className={styles.notesBlock}>
            <div className={styles.notesText}>&quot;{b.notes}&quot;</div>
          </div>
        </SectionFrame>
      )}

      {/* Variant-specific pricing block (Package & Price for mobile, Rate
          for club). Falls in here so the actions row stays at the bottom. */}
      {pricingSlot}

      {/* Actions row — Approve/Deny/Counter (incoming pending) OR Cancel
          (outgoing pending/counter) OR Accept/Counter Back/Decline (when
          DJ has countered an outgoing). Right side: Block/Unblock pill.

          For club + quote-mode bookings, the DJ-side flow has THREE phases:
            1. No rate drafted → in-card "Add Custom Rate" + Deny here
            2. Rate drafted, not sent → in-card "Edit Quote" + "Send Quote" here + Deny
            3. Rate sent (or non-quote/mobile) → Approve + Deny + Counter
          The Add/Edit Custom Rate button itself lives inside the Rate
          section of the card, not in this row. */}
      <div className={styles.actionsRow}>
        <div className={styles.actionsLeft}>
          {showIncomingActions && (
            <>
              {/* Phase 2: Send Quote. Only when DJ has a draft to release.
                  Sets quote_sent_at on the booking, exposing the price to
                  the booker. After send, hasRateSent becomes true and the
                  Approve/Counter buttons take over. */}
              {hasDraftedRate && (
                <button
                  type="button"
                  onClick={() => onSendDraftQuote(b)}
                  className={`${styles.actBtn} ${styles.actBtnPrimary}`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  {' '}Send Quote
                </button>
              )}

              {/* Phase 3 (and the only Approve path for non-quote / mobile):
                  Approve directly. Hidden when we're still in the
                  draft/no-rate-yet phase of a quote booking. */}
              {!(isQuote && !hasRateSent) && (
                <button
                  type="button"
                  onClick={() => onApprove(b.id)}
                  className={`${styles.actBtn} ${styles.actBtnPrimary}`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {' '}Approve
                </button>
              )}

              <button
                type="button"
                onClick={() => onDeny(b.id)}
                className={`${styles.actBtn} ${styles.actBtnDanger}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                {' '}Deny
              </button>

              {/* Counter — DJ proposes a different price. Only visible
                  AFTER a rate has been established and sent. Before that,
                  the DJ's first response IS the rate, sent via Send Quote
                  (club quote) or Approve (mobile/offers) — there's nothing
                  to "counter" yet. */}
              {hasRateSent && (
                <button
                  type="button"
                  onClick={() => onCounter(b, 'in')}
                  className={`${styles.actBtn} ${styles.actBtnAmber}`}
                >
                  Counter
                </button>
              )}
            </>
          )}
          {showOutgoingCancel && (
            <button
              type="button"
              onClick={() => onCancel(b.id)}
              className={`${styles.actBtn} ${styles.actBtnDanger}`}
            >
              Cancel
            </button>
          )}
          {showOutgoingCounterResponse && (
            <>
              {/* DJ countered our request → we (the booker) can Accept,
                  Counter Back, or Decline. */}
              <button
                type="button"
                onClick={() => onAcceptCounter(b.id)}
                className={`${styles.actBtn} ${styles.actBtnPrimary}`}
              >
                Accept Counter
              </button>
              <button
                type="button"
                onClick={() => onCounter(b, 'out')}
                className={`${styles.actBtn} ${styles.actBtnAmber}`}
              >
                Counter Back
              </button>
              <button
                type="button"
                onClick={() => onDeclineCounter(b.id)}
                className={`${styles.actBtn} ${styles.actBtnDanger}`}
              >
                Decline
              </button>
            </>
          )}
        </div>
        <div className={styles.actionsRight}>
          <div className={styles.requestedDate}>
            Requested {new Date(b.created_at).toLocaleDateString()}
          </div>
          {/* Block / Unblock — only meaningful for incoming side, but we show
              for outgoing too (a booker can block a DJ to avoid future contact). */}
          {isBlocked ? (
            <button
              type="button"
              onClick={() => onUnblock(targetId)}
              className={styles.unblockBtn}
            >
              Unblock
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onBlock(targetId, targetName)}
              className={styles.blockBtn}
            >
              Block
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// SectionFrame — bordered container with the floating uppercase label badge.
// Exported so MobileBookingCard / ClubBookingCard can use the same wrapper
// inside their detailsSlot / pricingSlot props.
//
// Uses styles.sectionFrame (which has `position: relative` + the white
// border + padding for the floating label). An earlier version used
// styles.sectionWrap by mistake — that class has no border and no
// `position: relative`, which caused the absolute-positioned label to
// escape its container and float to the top of the page.
export function SectionFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.sectionFrame}>
      <span className={styles.sectionLabel}>{label}</span>
      {children}
    </div>
  );
}
