'use client';

// ClubBookingCard — booking card for booking_type='club' rows.
// Thin wrapper around BookingCardShell that supplies the club-specific
// middle (Date+Venue+Equipment) and pricing block (rate / offer / counter).
// All shared chrome lives in BookingCardShell.

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
import BookingCardShell, { SectionFrame, type BookingCardShellProps } from './BookingCardShell';
import {
  CLUB_SET_TYPE_LABELS,
  CLUB_EQUIPMENT_LABELS,
  CLUB_VENUE_TYPE_LABELS,
  currencySymbol,
} from '@/lib/constants';
import type { BookingRow } from './page';

type Props = Omit<BookingCardShellProps, 'eventLabel' | 'detailsSlot' | 'pricingSlot'> & {
  djZip: string | null;
  djTravelDistance: string | null;
};

export default function ClubBookingCard(props: Props) {
  const {
    booking: b, isIncoming, djZip, djTravelDistance, ...shellProps
  } = props;

  // ── Computed values ────────────────────────────────────────────
  const isQuote = !!b.is_quote;
  const status = (b.status || 'pending') as 'pending' | 'approved' | 'denied' | 'counter' | 'cancelled';
  // Title shows venue type + set type (e.g. "Club · Headliner")
  const venueTypeLabel = CLUB_VENUE_TYPE_LABELS[b.venue_type || ''] || b.venue_type || '—';
  const setTypeLabel = CLUB_SET_TYPE_LABELS[b.set_type || ''] || b.set_type || null;
  const eventLabel = setTypeLabel
    ? `${venueTypeLabel} · ${setTypeLabel}`
    : venueTypeLabel;
  const equipmentLabel = CLUB_EQUIPMENT_LABELS[b.equipment || ''] || b.equipment || null;

  const durationLabel = calcDurationLabel(b);
  const cleanedAddr = cleanAddress(b.venue_address);

  // ── Distance + outside-range warning ─────────────────────────────
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
  const labelText = hasCounter ? 'New Offer' : '';
  const bigPriceVal = hasCounter ? b.counter_rate! : b.quoted_rate;

  // ── Date + Venue + Equipment slot ──────────────────────────────
  const detailsSlot = (
    <div style={{ marginTop: '0.8rem' }}>
      {/* Venue Type / Set — shown in its own bracketed section so it
          reads as a labeled field consistent with Date & Time, Venue,
          Equipment. eventLabel combines the venue type (Bar/Club) and
          set type (Headliner/Opener/etc.) — both pieces of context the
          DJ needs. Skip the section if eventLabel is empty/dash. */}
      {eventLabel && eventLabel !== '—' && (
        <SectionFrame label="Venue Type / Set">
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
    </div>
  );

  // ── Rate / Offer slot ──────────────────────────────────────────
  const pricingSlot = (hasPrice || b.offer_amount != null || isQuote) ? (
    <SectionFrame label="Rate">
      {(() => {
        const sym = currencySymbol(b.currency);
        const cur = b.currency || 'USD';
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
