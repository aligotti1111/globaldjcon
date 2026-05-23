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
  drivingMiles,
} from './helpers';
import BookingCardShell, { SectionFrame, StatusBadge, type BookingCardShellProps } from './BookingCardShell';
import {
  CLUB_SET_TYPE_LABELS,
  CLUB_EQUIPMENT_LABELS,
  CLUB_VENUE_TYPE_LABELS,
  currencySymbol,
} from '@/lib/constants';
import type { BookingRow } from './page';

type Props = Omit<BookingCardShellProps, 'eventLabel' | 'detailsSlot' | 'pricingSlot'> & {
  djZip: string | null;
  djCity: string | null;
  djState: string | null;
  djTravelDistance: string | null;
};

export default function ClubBookingCard(props: Props) {
  const {
    booking: b, isIncoming, djZip, djCity, djState, djTravelDistance, ...shellProps
  } = props;
  // Pull onSendQuote so the in-card "Add Custom Rate" / "Edit Quote"
  // buttons can open the QuoteModal directly. The shellProps spread
  // still passes it through to BookingCardShell for any other use.
  // Pull onViewHistory so the in-card "View History" link can open
  // the read-only HistoryModal.
  const { onSendQuote, onViewHistory } = shellProps;

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
      if (b.venue_lat == null || b.venue_lon == null) return;
      if (!djZip && !djCity) return;
      // Primary: Google driving distance via the /api/distance route.
      const driving = await drivingMiles(
        { zip: djZip, city: djCity, state: djState },
        b.venue_lat!,
        b.venue_lon!,
      );
      if (cancelled) return;
      if (driving != null) {
        setMilesNum(driving);
        setMilesDisplay(driving.toFixed(1));
        return;
      }
      // Fallback: straight-line distance if the driving lookup failed.
      const djCoords = await lookupZipCoords({ zip: djZip, city: djCity, state: djState });
      if (cancelled || !djCoords) return;
      const miles = haversineMiles(djCoords.lat, djCoords.lon, b.venue_lat!, b.venue_lon!);
      setMilesNum(miles);
      setMilesDisplay(miles.toFixed(1));
    }
    compute();
    return () => { cancelled = true; };
  }, [b.venue_lat, b.venue_lon, djZip, djCity, djState]);

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
  // Mirror of the shell's hasRateSent rule for club + quote-mode bookings:
  // a price is only "visible" (to either side) once quote_sent_at is set.
  // For non-quote club bookings (offer/flat-rate accept), quoted_rate alone
  // signals visibility — there's no draft phase.
  const hasRateSent = isQuote
    ? b.quote_sent_at != null
    : b.quoted_rate != null;
  // DJ has typed a price into the QuoteModal but hasn't released it to
  // the booker yet. Used to show a small "Drafted: $X" preview on the
  // DJ side only, plus the Add/Edit + Send buttons in the actions row.
  const hasDraftedRate = isQuote && b.quoted_rate != null && b.quote_sent_at == null;
  const hasPrice = hasRateSent;
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
            {/* Address — shown on both sides. Booker entered it, but
                surfacing it on their card is useful for quick reference
                (open in maps, copy, share). Distance + range warning
                stay DJ-only since they're tied to the DJ's travel radius. */}
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
            {isIncoming && milesDisplay && (
              <div className={styles.distLine}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={distColor} strokeWidth="2" style={{ verticalAlign: 'middle', marginRight: '3px' }}>
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span style={{ color: distColor }}>{milesDisplay} mi to venue</span>
              </div>
            )}
            {showRangeWarning && limitMiles != null && milesNum != null && (
              <div className={styles.rangeWarn}>
                ⚠ {(milesNum - limitMiles).toFixed(1)} mi beyond your {limitMiles} mi travel range
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
  // Always rendered so the status badge has a home. Inner content may
  // be null for terminal states without a rate; the badge alone is
  // still useful in that case.
  const pricingSlot = (
    <SectionFrame label="Rate">
      {/* Status badge — top-right of the rate section. Replaces the
          old top-of-card badge. Sits over the price content via
          absolute positioning. */}
      <div style={{
        position: 'absolute',
        top: -2,
        right: 8,
        zIndex: 2,
      }}>
        <StatusBadge booking={b} />
      </div>
      {(() => {
        const sym = currencySymbol(b.currency);
        const cur = b.currency || 'USD';
        // Approved short-circuit — once the booking is locked in, always
        // show "Agreed Price" with the most recent meaningful amount.
        // Priority: counter_rate (last counter that was accepted) →
        // quoted_rate (DJ's quote) → offer_amount (booker's original offer).
        // Without this, an approved offers-mode booking with no quoted_rate
        // would fall through to the "Booker's Offer" branch and display
        // the original offer amount instead of the agreed counter.
        if (isApproved) {
          const agreedPrice = b.counter_rate ?? b.quoted_rate ?? b.offer_amount;
          if (agreedPrice != null) {
            return (
              <div className={styles.priceRow}>
                <div className={styles.priceCol}>
                  <div className={styles.tinyLabel} style={{ color: 'var(--neon)' }}>
                    Agreed Price
                  </div>
                  <div className={styles.bigPrice}>
                    {sym}{Number(agreedPrice).toLocaleString()} <span className={styles.priceSub}>{cur}</span>
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
        }
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
          // Once a rate has been set, the booking acts like a normal
          // priced booking — even if it started life as a quote request.
          // Per spec: "after rate is sent quote mode should no longer show".
          // The DJ uses the standard Counter button (in the actions row)
          // to adjust their rate; no separate Edit affordance here.
          const showLabel = isApproved ? 'Agreed Price' : 'Rate';
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
          // Quote-mode booking with no rate sent yet. The in-box action
          // (Add Custom Rate / Edit Quote) lives here so it's part of
          // the Rate section, not floating in the actions row.
          if (isIncoming) {
            // DJ has typed a price but hasn't released it — show the
            // price plain (same visual as "Rate"), then an Edit Quote
            // button below. Send Quote lives in the actions row below.
            if (hasDraftedRate && b.quoted_rate != null) {
              return (
                <>
                  <div className={styles.priceRow}>
                    <div className={styles.priceCol}>
                      <div className={styles.tinyLabel} style={{ color: 'var(--white)' }}>
                        Rate
                      </div>
                      <div className={styles.bigPrice}>
                        {sym}{Number(b.quoted_rate).toLocaleString()}{' '}
                        <span className={styles.priceSub}>{cur}</span>
                      </div>
                    </div>
                    {durationLabel && (
                      <div className={styles.priceCol}>
                        <div className={styles.tinyLabel}>Duration</div>
                        <div className={styles.bigPriceNeon}>{durationLabel}</div>
                      </div>
                    )}
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    marginTop: '.65rem',
                  }}>
                    <button
                      type="button"
                      onClick={() => onSendQuote(b)}
                      style={{
                        background: 'rgba(0, 245, 196, 0.08)',
                        border: '1px solid var(--neon)',
                        color: 'var(--neon)',
                        fontFamily: "'Space Mono', monospace",
                        fontSize: '.7rem',
                        letterSpacing: '.12em',
                        textTransform: 'uppercase',
                        fontWeight: 700,
                        padding: '.5rem .95rem',
                        borderRadius: 5,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '.4rem',
                        transition: 'background 120ms ease',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0, 245, 196, 0.18)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0, 245, 196, 0.08)';
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                      Edit Quote
                    </button>
                  </div>
                </>
              );
            }
            // DJ hasn't typed a price yet — show the centered Add
            // Custom Rate button (original layout).
            return (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '.5rem',
                padding: '.4rem 0 .2rem',
              }}>
                <div className={styles.tinyLabel} style={{ color: 'var(--muted)' }}>
                  Quote Requested
                </div>
                <button
                  type="button"
                  onClick={() => onSendQuote(b)}
                  className={`${styles.actBtn} ${styles.actBtnPrimary}`}
                  style={{ minWidth: 180 }}
                >
                  + Add Custom Rate
                </button>
              </div>
            );
          }
          // Booker side — keep the existing awaiting message.
          return (
            <div className={styles.awaitingQuote}>
              Awaiting price from {b.dj_name || 'DJ'}
            </div>
          );
        }
        return null;
      })()}
      {/* View History — read-only modal of all counters/quotes on this
          booking. Only shown once there are 2+ entries (a single entry
          isn't really "history"). The negotiation_log column is seeded
          on initial offer/quote and appended to by every counter. */}
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
  );

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
