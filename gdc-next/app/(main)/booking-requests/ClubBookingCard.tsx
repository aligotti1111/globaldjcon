'use client';

// ClubBookingCard — booking-requests card for CLUB DJ bookings.
// Counterpart to MobileBookingCard; same actions (Approve/Deny/Counter/
// Send Quote/Block) but renders club-specific fields (venue type + set
// type + equipment + rate) instead of mobile package/event/cocktail.

import { useEffect, useState } from 'react';
import styles from './bookingRequests.module.css';
import {
  formatLongDate,
  formatTime,
  calcDurationLabel,
  haversineMiles,
  hasFiniteTravelLimit,
  cleanAddress,
  lookupZipCoords,
} from './helpers';
import type { BookingRow } from './page';

// Club-side label maps (mirror of vanilla br-club-flow.js)
const CLUB_SET_TYPE_LABELS: Record<string, string> = {
  opening: 'Opening Set',
  headliner: 'Headliner',
  closing: 'Closing Set',
  opening_close: 'Opening – Close',
  opening_and_closing: 'Opening & Closing',
};

const CLUB_EQUIPMENT_LABELS: Record<string, string> = {
  sound_system: 'DJ provides Sound System & Decks',
  decks_only: 'DJ provides Decks/Controller only',
  venue_provides: 'Venue provides all equipment',
};

// Currency code → symbol (subset matching the rate picker on the DJ form).
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', CAD: '$', AUD: '$',
  JPY: '¥', KRW: '₩', CNY: '¥', INR: '₹', BRL: 'R$', MXN: '$',
};

interface Props {
  booking: BookingRow;
  isIncoming: boolean;
  orderNum: number | null;
  isBlocked: boolean;
  djZip: string | null;          // current user's zip (DJ when isIncoming)
  djTravelDistance: string | null;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onCancel: (id: string) => void;
  onBlock: (userId: string, userName: string) => void;
  onUnblock: (userId: string) => void;
  // Modal openers (open via parent state) + counter response handlers
  onCounter: (b: BookingRow, group: 'in' | 'out') => void;
  onSendQuote: (b: BookingRow) => void;
  onAcceptCounter: (id: string) => void;
  onDeclineCounter: (id: string) => void;
  // Compose-message modal opener (parent owns the modal state)
  onMessage: (recipientUserId: string, recipientName: string, subject: string) => void;
}

export default function ClubBookingCard({
  booking: b, isIncoming, orderNum, isBlocked,
  djZip, djTravelDistance,
  onApprove, onDeny, onCancel, onBlock, onUnblock,
  onCounter, onSendQuote, onAcceptCounter, onDeclineCounter,
  onMessage,
}: Props) {
  const isQuote = !!b.is_quote;
  const status = (b.status || 'pending') as 'pending' | 'approved' | 'denied' | 'counter' | 'cancelled';
  const statusLabel = isQuote && status === 'pending' ? 'Quote Requested' : status;
  // Club bookings: title shows venue type + set type (e.g. "Club · Headliner")
  // rather than a generic event-type label (which is mobile-only).
  const venueTypeLabel = b.venue_type === 'bar' ? 'Bar'
    : b.venue_type === 'club' ? 'Club'
    : (b.venue_type || '—');
  const setTypeLabel = CLUB_SET_TYPE_LABELS[b.set_type || ''] || b.set_type || null;
  const eventLabel = setTypeLabel
    ? `${venueTypeLabel} · ${setTypeLabel}`
    : venueTypeLabel;
  const equipmentLabel = CLUB_EQUIPMENT_LABELS[b.equipment || ''] || b.equipment || null;
  const targetId = isIncoming ? b.requester_id : b.dj_id;
  const targetName = isIncoming ? (b.requester_name || 'this user') : (b.dj_name || 'this DJ');
  const targetLabel = isIncoming ? (b.requester_name || 'Booker') : (b.dj_name || 'DJ');

  const durationLabel = calcDurationLabel(b);
  const cleanedAddr = cleanAddress(b.venue_address);

  // ── Distance + outside-range warning ─────────────────────────────
  // Strategy: prefer venue_lat/lon stored on the booking row (captured at
  // submit time when the booker picked a Nominatim suggestion). If we don't
  // have those AND we have djZip, we'd need to geocode the address — but
  // that's expensive and many older bookings won't have coords. For now,
  // skip the distance display when coords are missing. Vanilla geocoded
  // both addresses on every render; we use stored coords for accuracy +
  // performance.
  const [milesDisplay, setMilesDisplay] = useState<string | null>(null);
  const [milesNum, setMilesNum] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function compute() {
      if (b.venue_lat == null || b.venue_lon == null || !djZip) return;
      const djCoords = await lookupZipCoords(djZip);
      if (cancelled || !djCoords) return;
      const miles = haversineMiles(djCoords.lat, djCoords.lon, b.venue_lat!, b.venue_lon!);
      setMilesNum(miles);
      setMilesDisplay(miles.toFixed(1));
    }
    compute();
    return () => { cancelled = true; };
  }, [b.venue_lat, b.venue_lon, djZip]);

  const distColor = milesNum == null
    ? 'var(--muted)'
    : milesNum < 5 ? 'var(--neon)'
    : milesNum < 15 ? 'var(--amber)'
    : 'var(--error)';

  // Outside-range warning — only shown to DJ for incoming bookings
  const showRangeWarning =
    isIncoming &&
    milesNum != null &&
    hasFiniteTravelLimit(djTravelDistance) &&
    milesNum > Number(djTravelDistance);
  const limitMiles = hasFiniteTravelLimit(djTravelDistance) ? Number(djTravelDistance) : null;

  // ── Action buttons ──────────────────────────────────────────────
  // Approve/Deny/Counter for incoming pending. Cancel for outgoing pending.
  // Accept/Decline buttons appear for outgoing counter status (DJ countered
  // back, requester needs to choose).
  const showIncomingActions = isIncoming && status === 'pending';
  const showOutgoingCancel = !isIncoming && (status === 'pending' || status === 'counter');
  const showOutgoingCounterResponse = !isIncoming && status === 'counter';

  // ── Status visual ───────────────────────────────────────────────
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

  // ── Counter price view ──────────────────────────────────────────
  const hasPrice = !!b.quoted_rate;
  const isApproved = status === 'approved';
  const hasCounter = !!b.counter_rate && !isApproved;
  const labelText = hasCounter
    ? 'New Offer'
    : hasPrice
    ? (isApproved ? 'Agreed Price' : isQuote ? 'Quoted Price' : 'Package Price')
    : '';
  const bigPriceVal = hasCounter ? b.counter_rate! : b.quoted_rate;

  return (
    <div className={`${styles.card} ${styles[`card_${status}`]}`}>
      <div className={statusAccentClass} />

      <div className={styles.statusBadgeWrap}>
        <span className={`${styles.statusBadge} ${statusBadgeClass}`}>{statusLabel}</span>
      </div>

      {/* Header */}
      <div className={styles.cardSection}>
        {orderNum != null && (
          <div className={styles.orderBadgeWrap}>
            <span className={styles.orderBadge}>#{orderNum}</span>
          </div>
        )}
        <div>
          <div className={styles.eyebrow}>Event</div>
          <div className={styles.bigTitle}>{eventLabel}</div>
        </div>
      </div>

      {/* Date & Time */}
      <SectionFrame label="Date & Time">
        <div className={styles.dateRow}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span className={styles.dateText}>{formatLongDate(b.event_date)}</span>
        </div>
        <div className={styles.timeBlock}>
          <div className={styles.tinyLabel}>Set Start</div>
          <div className={styles.bigTimeNeon}>{b.start_time ? formatTime(b.start_time) : '—'}</div>
        </div>
        <div className={styles.timeBlock}>
          <div className={styles.tinyLabel}>Set End</div>
          <div className={styles.bigTimeNeon}>{b.end_time ? formatTime(b.end_time) : '—'}</div>
        </div>
        {durationLabel && (
          <div className={styles.timeBlock}>
            <div className={styles.tinyLabel}>Duration</div>
            <div className={styles.bigTimeNeon}>{durationLabel}</div>
          </div>
        )}
      </SectionFrame>

      {/* Venue */}
      <SectionFrame label="Venue">
        {b.venue_name && (
          <div className={styles.infoBlock}>
            <div className={styles.tinyLabel}>Venue</div>
            <div className={styles.venueName}>{b.venue_name}</div>
            {cleanedAddr && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.venue_address || '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.venueLink}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                {cleanedAddr}
              </a>
            )}
            {milesDisplay && (
              <div className={styles.distLine}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={distColor} strokeWidth="2" style={{ verticalAlign: 'middle', marginRight: '3px' }}>
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span style={{ color: distColor }}>{milesDisplay} mi to venue</span>
              </div>
            )}
            {showRangeWarning && limitMiles != null && (
              <div className={styles.rangeWarn}>
                ⚠ Outside your {limitMiles} mi travel range
              </div>
            )}
          </div>
        )}
      </SectionFrame>

      {/* Equipment */}
      {(equipmentLabel || b.venue_equip_detail) && (
        <SectionFrame label="Equipment">
          {equipmentLabel && (
            <div className={styles.infoBlock}>
              <div className={styles.infoValue}>{equipmentLabel}</div>
            </div>
          )}
          {b.venue_equip_detail && (
            <div className={styles.infoBlock}>
              <div className={styles.tinyLabel}>Provided gear details</div>
              <div className={styles.infoValue}>{b.venue_equip_detail}</div>
            </div>
          )}
        </SectionFrame>
      )}

      {/* Contact Info */}
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

      {/* Notes (booker message) */}
      {b.notes && (
        <SectionFrame label="Message From Booker">
          <div className={styles.notesBlock}>
            <div className={styles.notesText}>&quot;{b.notes}&quot;</div>
          </div>
        </SectionFrame>
      )}

      {/* Rate / Offer */}
      {(hasPrice || b.offer_amount != null || isQuote) && (
        <SectionFrame label="Rate">
          {(() => {
            const sym = CURRENCY_SYMBOLS[b.currency || 'USD'] || '$';
            const cur = b.currency || 'USD';
            // Counter view takes precedence
            if (hasCounter) {
              return (
                <div className={styles.priceRow}>
                  <div className={styles.priceCol}>
                    <div className={styles.tinyLabel} style={{ color: 'var(--amber)' }}>{labelText}</div>
                    <div className={styles.bigPrice} style={{ color: 'var(--amber)' }}>
                      {sym}{Number(bigPriceVal).toLocaleString()} <span className={styles.priceSub}>{cur}</span>
                    </div>
                    <div className={styles.priceSub}>
                      Initial Offer: <span>{sym}{Number(b.quoted_rate ?? b.offer_amount).toLocaleString()}</span>
                    </div>
                  </div>
                  {durationLabel && (
                    <div className={styles.priceCol}>
                      <div className={styles.tinyLabel}>Duration</div>
                      <div className={styles.bigPriceNeon}>{durationLabel}</div>
                    </div>
                  )}
                </div>
              );
            }
            // Quoted rate (DJ has set a price). Mode-aware label.
            if (hasPrice) {
              const showLabel = isApproved
                ? 'Agreed Price'
                : isQuote ? 'Quoted Price'
                : 'Rate';
              return (
                <div className={styles.priceRow}>
                  <div className={styles.priceCol}>
                    <div className={styles.tinyLabel} style={{ color: isApproved ? 'var(--neon)' : 'var(--white)' }}>
                      {showLabel}
                    </div>
                    <div className={styles.bigPrice}>
                      {sym}{Number(b.quoted_rate).toLocaleString()} <span className={styles.priceSub}>{cur}</span>
                    </div>
                  </div>
                  {durationLabel && (
                    <div className={styles.priceCol}>
                      <div className={styles.tinyLabel}>Duration</div>
                      <div className={styles.bigPriceNeon}>{durationLabel}</div>
                    </div>
                  )}
                </div>
              );
            }
            // Offer-mode booking (no fixed rate, booker submitted an offer)
            if (b.offer_amount != null) {
              return (
                <div className={styles.priceRow}>
                  <div className={styles.priceCol}>
                    <div className={styles.tinyLabel} style={{ color: 'var(--amber)' }}>Booker&apos;s Offer</div>
                    <div className={styles.bigPrice}>
                      {sym}{Number(b.offer_amount).toLocaleString()} <span className={styles.priceSub}>{cur}</span>
                    </div>
                  </div>
                  {durationLabel && (
                    <div className={styles.priceCol}>
                      <div className={styles.tinyLabel}>Duration</div>
                      <div className={styles.bigPriceNeon}>{durationLabel}</div>
                    </div>
                  )}
                </div>
              );
            }
            // Pure quote-request mode (no price yet)
            if (isQuote) {
              return (
                <div className={styles.awaitingQuote}>
                  Awaiting price from {b.dj_name || 'DJ'}
                </div>
              );
            }
            return null;
          })()}
        </SectionFrame>
      )}

      {/* Actions */}
      <div className={styles.actionsRow}>
        <div className={styles.actionsLeft}>
          {showIncomingActions && (
            <>
              {/* Quote-mode booking with no quoted_rate yet → Send Quote opens
                  the QuoteModal. Otherwise Approve is a direct status flip. */}
              {isQuote && !b.quoted_rate ? (
                <button
                  type="button"
                  onClick={() => onSendQuote(b)}
                  className={`${styles.actBtn} ${styles.actBtnPrimary}`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {' '}Send Quote
                </button>
              ) : (
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
              {/* Counter — DJ proposes a different price. Hidden for quote-mode
                  bookings without a quote yet (DJ should Send Quote first). */}
              {!(isQuote && !b.quoted_rate) && (
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
// Vanilla repeats this pattern for every section; encapsulating it here keeps
// the card render readable.
function SectionFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.sectionWrap}>
      <div className={styles.sectionFrame}>
        <div className={styles.sectionLabel}>{label}</div>
        {children}
      </div>
    </div>
  );
}

