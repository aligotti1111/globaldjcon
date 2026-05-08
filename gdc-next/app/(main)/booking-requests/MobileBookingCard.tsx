'use client';

// MobileBookingCard — booking card for booking_type='mobile' rows.
// Thin wrapper around BookingCardShell that supplies the mobile-specific
// middle (Date+cocktail+venue+room+guests) and pricing block (package +
// price + counter view). All shared chrome lives in BookingCardShell.

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
import BookingCardShell, { SectionFrame, type BookingCardShellProps } from './BookingCardShell';
import type { BookingRow } from './page';
import { isPackageEdited } from './packageDiff';

// Same prop shape as BookingCardShell except eventLabel/detailsSlot/
// pricingSlot are derived inside this component.
type Props = Omit<BookingCardShellProps, 'eventLabel' | 'detailsSlot' | 'pricingSlot'> & {
  djZip: string | null;          // current user's zip (DJ when isIncoming)
  djTravelDistance: string | null;
};

export default function MobileBookingCard(props: Props) {
  const {
    booking: b, isIncoming, djZip, djTravelDistance, ...shellProps
  } = props;
  // Pull onViewHistory so the in-card "View History" link can open
  // the read-only HistoryModal. shellProps still passes it through.
  const { onViewHistory } = shellProps;

  // ── Computed values used by both detailsSlot and pricingSlot ──
  const isQuote = !!b.is_quote;
  const status = (b.status || 'pending') as 'pending' | 'approved' | 'denied' | 'counter' | 'cancelled';
  const eventLabel = MOB_EVENT_LABELS[b.event_type || ''] || b.event_type || '—';
  const durationLabel = calcDurationLabel(b);
  const cleanedAddr = cleanAddress(b.venue_address);

  // ── Distance + outside-range warning ─────────────────────────────
  // Strategy: prefer venue_lat/lon stored on the booking row (captured at
  // submit time when the booker picked a Nominatim suggestion). If we don't
  // have those AND we have djZip, we'd need to geocode the address — but
  // that's expensive and many older bookings won't have coords. For now,
  // skip the distance display when coords are missing.
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

  const showRangeWarning =
    isIncoming &&
    milesNum != null &&
    hasFiniteTravelLimit(djTravelDistance) &&
    milesNum > Number(djTravelDistance);
  const limitMiles = hasFiniteTravelLimit(djTravelDistance) ? Number(djTravelDistance) : null;

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

  // ── Date + Time + Event Info slot ───────────────────────────────
  // Wrapping div adds top margin only — gives the first SectionFrame's
  // floating label badge clearance from the amber status accent strip.
  // No horizontal padding so SectionFrames keep their natural width
  // matching ContactInfo/PackagePrice frames rendered by the shell.
  const detailsSlot = (
    <div style={{ marginTop: '0.8rem' }}>
      {/* Event Type — shown in its own bracketed section so it reads as
          a labeled field consistent with Date & Time, Event Info, etc.
          eventLabel is the display label resolved from MOB_EVENT_LABELS
          (e.g. "Corporate Event", "Wedding"). Falls back to the raw
          event_type string if no canonical label exists, and we skip the
          section entirely if there's nothing meaningful to show. */}
      {eventLabel && eventLabel !== '—' && (
        <SectionFrame label="Event Type">
          {/* Use infoValueBold (same style as other field values) instead of
              bigTitle — keeps the box proportions consistent with Date &
              Time / Event Info / Contact Info frames. bigTitle was making
              this section noticeably taller than its neighbors. */}
          <div className={styles.infoValueBold}>{eventLabel}</div>
        </SectionFrame>
      )}

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
    </div>
  );

  // Status badge color — keys mirror the .statusPending/.statusApproved
  // CSS module classes that BookingCardShell used to render via the
  // floating top-right pill. Now rendered inline at the top of the
  // Package & Price section instead.
  const statusBadgeClass = {
    pending: styles.statusPending,
    approved: styles.statusApproved,
    denied: styles.statusDenied,
    counter: styles.statusCounter,
    cancelled: styles.statusCancelled,
  }[status];
  const statusLabel = isQuote && status === 'pending' ? 'Quote Requested' : status;

  // ── Package & Price slot ───────────────────────────────────────
  const pricingSlot = (hasPrice || b.package_title || isQuote) ? (
    <SectionFrame label="Package & Price">
      {/* Status badge — moved here from the floating top-right of the
          card. Sits above the price/package content so the booking's
          state is visually anchored next to the money line where it
          matters most. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.6rem' }}>
        <span className={`${styles.statusBadge} ${statusBadgeClass}`}>{statusLabel}</span>
      </div>
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
          <div className={styles.tinyLabel}>
            Package
            {isPackageEdited(b.package_details) && (
              <span
                style={{
                  marginLeft: 8,
                  padding: '2px 6px',
                  fontSize: 10,
                  background: 'rgba(245,158,11,0.15)',
                  color: '#f59e0b',
                  borderRadius: 3,
                  letterSpacing: 0.04,
                  textTransform: 'none',
                  fontWeight: 600,
                }}
                title="The DJ edited this package as part of their counter offer"
              >
                ✏ Edited by DJ
              </span>
            )}
          </div>
          <div className={styles.packageTitle}>{b.package_title}</div>
          {b.package_details && (
            <>
              <div
                className={styles.packageDetails}
                // package_details is admin/DJ-controlled HTML stored as a
                // pre-sanitized fragment from the package editor. When it
                // contains the GDJ_EDITED marker (DJ counter-edited the
                // package), the inline <s>/<ins> tags get rendered with
                // diff styling so the host sees what changed at a glance.
                dangerouslySetInnerHTML={{ __html: stripPkgMarkers(b.package_details) }}
              />
              {/* Diff styling — scoped to the package block so it doesn't
                  bleed into other parts of the card. Matches the styles
                  used inside CounterPackageEditor's preview. */}
              {isPackageEdited(b.package_details) && (
                <style>{`
                  .${styles.packageBlock} ins.gdj-diff-add {
                    background: rgba(16,185,129,0.2);
                    color: #6ee7b7;
                    text-decoration: none;
                    padding: 0 2px;
                    border-radius: 2px;
                  }
                  .${styles.packageBlock} s.gdj-diff-remove {
                    color: #f87171;
                    opacity: 0.8;
                  }
                `}</style>
              )}
            </>
          )}
        </div>
      )}
      {/* View History — read-only modal of all counters/quotes on this
          booking. Only shown once there are 2+ entries. */}
      {(() => {
        const log = (b.negotiation_log as Array<unknown> | null) || [];
        if (log.length < 2) return null;
        return (
          <div style={{
            marginTop: '.65rem',
            paddingTop: '.55rem',
            borderTop: '1px solid var(--border)',
            textAlign: 'center',
          }}>
            <button
              type="button"
              onClick={() => onViewHistory(b, isIncoming)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--neon)',
                fontFamily: "'Space Mono', monospace",
                fontSize: '.65rem',
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                padding: '.25rem .5rem',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              View History ({log.length})
            </button>
          </div>
        );
      })()}
    </SectionFrame>
  ) : null;

  return (
    <BookingCardShell
      booking={b}
      isIncoming={isIncoming}
      eventLabel={eventLabel}
      detailsSlot={detailsSlot}
      pricingSlot={pricingSlot}
      {...shellProps}
    />
  );
}

// Strip the GDJ marker comments from package_details so the card renders
// cleanly. There are TWO formats this function has to handle:
//
// 1. Legacy: original content + <!--GDJ_REMOVED--> + struck-through
//    content. Everything after the marker was visually footer'd.
//    We continue to support this by truncating at the marker boundary.
//
// 2. Current: inline diff using <s class="gdj-diff-remove"> and
//    <ins class="gdj-diff-add"> tags scattered through the content,
//    prefixed with the <!--GDJ_EDITED--> marker. We strip ONLY the
//    marker comment — the <s>/<ins> tags themselves stay so the host
//    sees the diff inline (with CSS giving them strikethrough/highlight
//    styling).
function stripPkgMarkers(html: string): string {
  let h = html;
  h = h.replace('<!--GDJ_EDITED-->', '');
  const idx = h.indexOf('<!--GDJ_REMOVED-->');
  if (idx !== -1) h = h.slice(0, idx);
  return h;
}
