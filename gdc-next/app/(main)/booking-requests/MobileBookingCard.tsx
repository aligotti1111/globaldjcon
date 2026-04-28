'use client';

// MobileBookingCard — single booking card render. Faithful port of vanilla
// br-mob-flow.js renderMobileCard.
//
// Sections (top → bottom):
//   1. Status accent strip + status badge (top-right)
//   2. Header (event type label + optional order # for grouped cards)
//   3. Date & Time (event_date + start/end + cocktail if wedding + duration)
//   4. Event Info (venue + room + guests + venue link + distance + warning)
//   5. Contact Info (host name + phone + Message button — DEFERRED)
//   6. Message (notes block — only if notes present)
//   7. Package & Price (price block + package details + counter offer view)
//   8. Actions (approve/deny/counter/cancel + requested-on date + block/unblock)
//
// DEFERRED in this card:
//   - Counter button → modal (vanilla openCounter — complex modal UI)
//   - Send Quote button (modal)
//   - Message button → modal (depends on inbox/messaging system)
//   - Package edit modal (vanilla pkgEditOriginalItems machinery)

import { useEffect, useState } from 'react';
import styles from './bookingRequests.module.css';
import {
  MOB_EVENT_LABELS,
  formatLongDate,
  formatTime,
  calcDurationLabel,
  haversineMiles,
  hasFiniteTravelLimit,
  cleanAddress,
  lookupZipCoords,
} from './helpers';
import type { BookingRow } from './page';

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
}

export default function MobileBookingCard({
  booking: b, isIncoming, orderNum, isBlocked,
  djZip, djTravelDistance,
  onApprove, onDeny, onCancel, onBlock, onUnblock,
}: Props) {
  const isQuote = !!b.is_quote;
  const status = (b.status || 'pending') as 'pending' | 'approved' | 'denied' | 'counter' | 'cancelled';
  const statusLabel = isQuote && status === 'pending' ? 'Quote Requested' : status;
  const eventLabel = MOB_EVENT_LABELS[b.event_type || ''] || b.event_type || '—';
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
        {b.cocktail_needed && b.event_type === 'weddings' && (
          <div className={styles.timeBlock}>
            <div className={styles.tinyLabel}>Cocktail Hour</div>
            <div className={styles.cocktailLine}>
              {b.cocktail_start_time ? formatTime(b.cocktail_start_time) : 'TBD'}
              {b.cocktail_same_room ? ' · Same room' : ' · Separate room'}
            </div>
          </div>
        )}
        <div className={styles.timeBlock}>
          <div className={styles.tinyLabel}>
            {b.event_type === 'weddings' ? 'Reception Start' : 'Event Start'}
          </div>
          <div className={styles.bigTimeNeon}>{b.start_time ? formatTime(b.start_time) : '—'}</div>
        </div>
        <div className={styles.timeBlock}>
          <div className={styles.tinyLabel}>
            {b.event_type === 'weddings' ? 'Reception End' : 'Event End'}
          </div>
          <div className={styles.bigTimeNeon}>{b.end_time ? formatTime(b.end_time) : '—'}</div>
        </div>
        {durationLabel && (
          <div className={styles.timeBlock}>
            <div className={styles.tinyLabel}>Duration</div>
            <div className={styles.bigTimeNeon}>{durationLabel}</div>
          </div>
        )}
        {b.cocktail_needed && b.event_type !== 'weddings' && (
          <div className={styles.timeBlock} style={{ marginTop: '.7rem' }}>
            <div className={styles.tinyLabel}>Cocktail Hour</div>
            <div className={styles.cocktailLine}>
              {b.cocktail_start_time ? formatTime(b.cocktail_start_time) : 'TBD'}
              {b.cocktail_same_room ? ' · Same room' : ' · Separate room'}
            </div>
          </div>
        )}
      </SectionFrame>

      {/* Event Info */}
      <SectionFrame label="Event Info">
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
        {b.room_details && b.room_details !== 'None' && (
          <div className={styles.infoBlock}>
            <div className={styles.tinyLabel}>Room</div>
            <div className={styles.infoValue}>{b.room_details}</div>
          </div>
        )}
        {b.guest_count != null && (
          <div className={styles.infoBlock}>
            <div className={styles.tinyLabel}>Guests</div>
            <div className={styles.infoValueBold}>{b.guest_count}</div>
          </div>
        )}
      </SectionFrame>

      {/* Contact Info */}
      <SectionFrame label="Contact Info">
        <div className={styles.infoBlock}>
          <div className={styles.contactLine}>
            {isIncoming ? 'Host Name' : 'To'}: <span>{targetLabel}</span>
          </div>
          {b.phone && (
            <div className={styles.contactLine}>
              Phone: <a href={`tel:${b.phone}`}>{b.phone}</a>
            </div>
          )}
        </div>
        {/* Message button — modal deferred to a later session.
            Placeholder shows what it WILL be without breaking layout. */}
        <button type="button" className={styles.messageBtn} disabled title="Coming soon">
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

      {/* Package & Price */}
      {(hasPrice || b.package_title || isQuote) && (
        <SectionFrame label="Package & Price">
          {hasPrice ? (
            <div className={styles.priceRow}>
              <div className={styles.priceCol}>
                <div className={styles.tinyLabel} style={{ color: hasCounter ? 'var(--amber)' : isApproved ? 'var(--neon)' : 'var(--amber)' }}>
                  {labelText}
                </div>
                <div className={styles.bigPrice} style={{ color: hasCounter ? 'var(--amber)' : 'var(--white)' }}>
                  ${Number(bigPriceVal).toLocaleString()}
                </div>
                {hasCounter && (
                  <div className={styles.priceSub}>
                    Initial Offer: <span>${Number(b.quoted_rate).toLocaleString()}</span>
                  </div>
                )}
                {!hasCounter && b.deposit_amount != null && (
                  <div className={styles.priceDeposit}>
                    Deposit ({b.deposit_pct}%): ${Number(b.deposit_amount).toLocaleString()}
                  </div>
                )}
              </div>
              {durationLabel && (
                <div className={styles.priceCol}>
                  <div className={styles.tinyLabel}>Duration</div>
                  <div className={styles.bigPriceNeon}>{durationLabel}</div>
                </div>
              )}
            </div>
          ) : isQuote ? (
            <div className={styles.awaitingQuote}>
              Awaiting price from {b.dj_name || 'DJ'}
            </div>
          ) : null}
          {b.package_title && (
            <div className={styles.packageBlock}>
              <div className={styles.tinyLabel}>Package</div>
              <div className={styles.packageTitle}>{b.package_title}</div>
              {b.package_details && (
                <div
                  className={styles.packageDetails}
                  // package_details is admin/DJ-controlled HTML stored as a
                  // pre-sanitized fragment from the package editor. Same
                  // rendering pattern as vanilla br-mob-flow.js.
                  dangerouslySetInnerHTML={{ __html: stripPkgMarkers(b.package_details) }}
                />
              )}
            </div>
          )}
        </SectionFrame>
      )}

      {/* Actions */}
      <div className={styles.actionsRow}>
        <div className={styles.actionsLeft}>
          {showIncomingActions && (
            <>
              <button
                type="button"
                onClick={() => onApprove(b.id)}
                className={`${styles.actBtn} ${styles.actBtnPrimary}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {' '}{isQuote ? 'Send Quote' : 'Approve'}
              </button>
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
              {/* Counter / Send Price buttons — modals deferred. Disabled
                  placeholders so the visual layout matches vanilla. */}
              <button
                type="button"
                disabled
                className={`${styles.actBtn} ${styles.actBtnAmber}`}
                title="Counter offer — coming soon"
              >
                {isQuote ? 'Send Price' : 'Counter'}
              </button>
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
              <button type="button" disabled className={`${styles.actBtn} ${styles.actBtnPrimary}`} title="Coming soon">
                Accept
              </button>
              <button type="button" disabled className={`${styles.actBtn} ${styles.actBtnDanger}`} title="Coming soon">
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

// Strip the GDJ_EDITED + GDJ_REMOVED markers from package_details so the card
// renders cleanly. The package edit modal (deferred) uses these markers to
// preserve which items the DJ struck through. For the read-only render here
// we just drop everything after GDJ_REMOVED + the marker comment itself.
function stripPkgMarkers(html: string): string {
  let h = html;
  h = h.replace('<!--GDJ_EDITED-->', '');
  const idx = h.indexOf('<!--GDJ_REMOVED-->');
  if (idx !== -1) h = h.slice(0, idx);
  return h;
}
