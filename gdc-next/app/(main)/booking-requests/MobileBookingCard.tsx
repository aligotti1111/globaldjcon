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
  drivingMiles,
} from './helpers';
import BookingCardShell, { SectionFrame, type BookingCardShellProps } from './BookingCardShell';
import type { BookingRow } from './page';
import { currencySymbol } from '@/lib/constants';
import { parseBookingAddons } from '@/lib/addons';
import { isPackageEdited } from './packageDiff';

// Same prop shape as BookingCardShell except eventLabel/detailsSlot/
// pricingSlot are derived inside this component.
type Props = Omit<BookingCardShellProps, 'eventLabel' | 'detailsSlot' | 'pricingSlot'> & {
  djZip: string | null;          // current user's zip (DJ when isIncoming)
  djCity: string | null;         // current user's city — used with zip for
  djState: string | null;        // an accurate home-base geocode
  djTravelDistance: string | null;
};

export default function MobileBookingCard(props: Props) {
  const {
    booking: b, isIncoming, djZip, djCity, djState, djTravelDistance, ...shellProps
  } = props;
  // Pull onViewHistory so the in-card "View History" link can open
  // the read-only HistoryModal. onSendQuote opens the Add Offer modal
  // (used by the "Add price" link in the quote-stage add-on block).
  // shellProps still passes both through.
  const { onViewHistory, onSendQuote } = shellProps;
  // The booking's frozen currency symbol (legacy rows → USD).
  const cur = currencySymbol((b as BookingRow & { currency?: string }).currency || 'USD');

  // ── Computed values used by both detailsSlot and pricingSlot ──
  const isQuote = !!b.is_quote;
  const status = (b.status || 'pending') as 'pending' | 'approved' | 'denied' | 'counter' | 'cancelled';
  const eventLabel = MOB_EVENT_LABELS[b.event_type || ''] || b.event_type || '—';
  // event_details: readable string composed at booking time from the
  // event-type-specific sub-fields (e.g. "25th Anniversary", or
  // "Guest of honor age: 30 · Surprise party: Yes"). New column — not yet
  // in the Booking TS type, so read it via a narrow cast.
  const eventDetails = ((b as { event_details?: string | null }).event_details || '').trim();
  const durationLabel = calcDurationLabel(b);
  // Cocktail-hour duration (half-hour granularity) from cocktail start to
  // event start, for display on the card.
  const cocktailDurationLabel = (() => {
    if (!b.cocktail_start_time || !b.start_time) return '';
    const [csh, csm] = b.cocktail_start_time.split(':').map(Number);
    const [esh, esm] = b.start_time.split(':').map(Number);
    let mins = (esh * 60 + esm) - (csh * 60 + csm);
    if (mins <= 0) mins += 1440;
    const hrs = Math.round(mins / 30) / 2;
    if (hrs <= 0) return '';
    if (hrs === 0.5) return '30 mins';
    return `${hrs} ${hrs === 1 ? 'hr' : 'hrs'}`;
  })();
  // Ceremony shows its start time only — no duration in hours.
  const cleanedAddr = cleanAddress(b.venue_address);

  // ── Distance + outside-range warning ─────────────────────────────
  // venue_lat/lon are captured at submit time from the booker's address
  // pick. Distance is the DRIVING distance (road network) from the DJ's
  // home base — the meaningful measure for a travel range. If the
  // driving lookup fails, fall back to straight-line haversine so the
  // card still shows something.
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
  const hasPrice = !!b.quoted_rate;
  const isApproved = status === 'approved';
  // NOTE: on a mobile QUOTE booking, counter_rate is overloaded to store the
  // hourly OVERTIME rate (see QuoteModal) — it is NOT a counter offer. The
  // quote flow is request → DJ offer → booker approve/decline, with no
  // counter-back, so we must never render counter_rate as the price here.
  // Exclude quote bookings so the offer (quoted_rate) shows as the price and
  // counter_rate is rendered separately as overtime below.
  const hasCounter = !!b.counter_rate && !isApproved && !isQuote;
  // Overtime rate to display on quote bookings (the overloaded counter_rate).
  // Overtime rate now lives in its own column. Fall back to the legacy
  // overloaded counter_rate for quote bookings not yet backfilled.
  const overtimeRaw = b.overtime_rate ?? (isQuote ? b.counter_rate : null);
  const overtimeRate = overtimeRaw != null ? Number(overtimeRaw) : null;
  // Agreed price for an approved booking. The negotiation_log holds the
  // full back-and-forth; its LAST entry's amount is what both sides
  // settled on — authoritative regardless of which column stored it.
  // When there's no log we fall back to the same precedence the approval
  // email uses (counter_rate → quoted_rate → offer_amount) so the card
  // and the email never disagree.
  const agreedPrice = (() => {
    const log = b.negotiation_log;
    if (log && log.length > 0) {
      const amt = log[log.length - 1].amount;
      if (typeof amt === 'number' && !Number.isNaN(amt)) return amt;
    }
    return (b.counter_rate as number | null | undefined)
      ?? (b.quoted_rate as number | null | undefined)
      ?? (b.offer_amount as number | null | undefined)
      ?? null;
  })();
  const bigPriceVal = hasCounter
    ? b.counter_rate!
    : (isApproved && agreedPrice != null ? agreedPrice : b.quoted_rate);

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
          {eventDetails && (
            <div
              className={styles.infoValue}
              style={{ marginTop: '.2rem', opacity: .85 }}
            >
              {eventDetails.split(' · ').map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
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
        {b.ceremony_needed && (
          <div className={styles.timeBlock}>
            <div className={styles.tinyLabel}>Ceremony</div>
            <div className={styles.cocktailLine}>
              {b.ceremony_start_time ? formatTime(b.ceremony_start_time) : 'TBD'}
              {b.ceremony_same_room ? ' · Same room' : ' · Separate room'}
            </div>
          </div>
        )}
        {b.cocktail_needed && (
          <div className={styles.timeBlock}>
            <div className={styles.tinyLabel}>Cocktail Hour</div>
            <div className={styles.cocktailLine}>
              {b.cocktail_start_time ? formatTime(b.cocktail_start_time) : 'TBD'}
              {cocktailDurationLabel ? ` · ${cocktailDurationLabel}` : ''}
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
            {showRangeWarning && limitMiles != null && milesNum != null && (
              <div className={styles.rangeWarn}>
                ⚠ {(milesNum - limitMiles).toFixed(1)} mi beyond your {limitMiles} mi travel range
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
        {b.setup_hours && (
          <div className={styles.infoBlock}>
            <div className={styles.tinyLabel}>Setup Time Required</div>
            <div className={styles.infoValue}>
              {b.setup_hours} hr{b.setup_hours === '1' ? '' : 's'} before start
            </div>
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
      {/* Offer-sent confirmation — shown on the DJ's card once they've
          sent their offer on a mobile quote booking (status='counter').
          Reassures the DJ the booker now has the offer and it's their move. */}
      {isIncoming && isQuote && status === 'counter' && (
        <div
          style={{
            marginBottom: '0.7rem',
            padding: '.55rem .75rem',
            background: 'rgba(0, 245, 196, 0.08)',
            border: '1px solid rgba(0, 245, 196, 0.3)',
            borderRadius: 5,
            fontSize: '.74rem',
            lineHeight: 1.4,
            color: 'rgba(255,255,255,.85)',
          }}
        >
          ✓ Your offer has been sent to {b.requester_name || 'the booker'}. Awaiting their response.
        </div>
      )}
      {hasPrice ? (
        <div className={styles.priceRow}>
          <div className={styles.priceCol}>
            <div className={styles.tinyLabel} style={{ color: hasCounter ? 'var(--amber)' : isApproved ? 'var(--neon)' : 'var(--amber)' }}>
              Total Event Cost
            </div>
            <div className={styles.bigPrice} style={{ color: hasCounter ? 'var(--amber)' : 'var(--white)' }}>
              {(() => {
                // Big top number = the taxed total (what the event costs all-in).
                // The full itemized breakdown lives in the block below the package.
                // Mirror the breakdown's freshness check: the stored snapshot is
                // frozen at the original offer, so after a counter trust it only
                // when it still matches the current price, else recompute.
                const bt = b as typeof b & { tax_pct?: number | null; tax_amount?: number | null; total_with_tax?: number | null };
                const r2 = (n: number) => Math.round(n * 100) / 100;
                const subtotal = Number(bigPriceVal) || 0;
                const snapTotal = bt.total_with_tax != null ? Number(bt.total_with_tax) : null;
                const snapTax = Number(bt.tax_amount) || 0;
                const snapshotFresh = snapTotal != null && Math.abs(r2(snapTotal - snapTax) - subtotal) < 0.01;
                const taxPct = Number(bt.tax_pct) || 0;
                const taxAmt = snapshotFresh ? snapTax : (taxPct > 0 ? r2(subtotal * taxPct / 100) : 0);
                const totalWithTax = (snapshotFresh && snapTotal != null) ? snapTotal : r2(subtotal + taxAmt);
                return `${cur}${totalWithTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              })()}
            </div>
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
        <div
          className={styles.packageBlock}
          style={{
            marginTop: '.4rem',
            padding: '1rem',
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid var(--border)',
            borderRadius: 8,
          }}
        >
          <div className={styles.tinyLabel} style={{ fontSize: 11, letterSpacing: '.14em', color: 'var(--muted)', fontWeight: 700 }}>
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
          <div style={{ borderTop: '1px solid var(--border)', margin: '.5rem 0 .7rem' }} />
          <div className={styles.packageTitle} style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--white)' }}>{b.package_title}</div>
          {b.package_details && (
            <>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.18)', margin: '.5rem 0 .6rem' }} />
              <div
                className={styles.packageDetails}
                style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--white)' }}
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
          {(() => {
            // Chosen add-ons, itemized at the bottom of the package block.
            const reqAddons = parseBookingAddons((b as { addons?: unknown }).addons);
            if (reqAddons.length === 0) return null;
            // For a QUOTE package the host still chose priced add-ons, and any
            // promo code / site sale was applied to those add-ons — so show the
            // DJ the add-on prices, the saving, and the discounted add-on
            // subtotal (the package itself is still "price on request"). For a
            // PRICED booking the full Cost Breakdown below already itemizes the
            // add-ons, so here we keep it to titles only.
            const bq = b as typeof b & { discount_amount?: number | null; discount_label?: string | null; discount_code?: string | null };
            const money2 = (n: number) => `${cur}${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const addonSum = reqAddons.reduce((s, a) => s + (Number(a.price) || 0), 0);
            const qDiscount = (isQuote && bq.discount_amount != null && Number(bq.discount_amount) > 0) ? Number(bq.discount_amount) : 0;
            // Only before the DJ has priced the quote. Once a price exists the
            // full Cost Breakdown below itemizes the add-ons and the single
            // booking-wide discount, so showing prices here too would double them.
            const showQuotePricing = isQuote && !hasPrice && addonSum > 0;
            // Per-add-on discount factor (the host's promo/sale was applied to
            // the add-ons at booking time). Each add-on shows its ORIGINAL price
            // struck through next to the discounted one.
            const discFactor = (qDiscount > 0 && addonSum > 0) ? Math.max(0, addonSum - qDiscount) / addonSum : 1;
            const canAddPrice = showQuotePricing && isIncoming && typeof onSendQuote === 'function';
            return (
              <div style={{ marginTop: '.9rem' }}>
                <div style={{ borderTop: '1px solid var(--border)', margin: '0 0 .7rem' }} />
                {/* Package price — blank until the DJ adds an offer. The "Add
                    price" link opens the same Add Offer modal as the button. */}
                {showQuotePricing && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 14, color: 'var(--white)', padding: '3px 0', marginBottom: 2 }}>
                    <span style={{ fontWeight: 700 }}>Package price</span>
                    {canAddPrice ? (
                      <button
                        type="button"
                        onClick={() => onSendQuote!(b)}
                        style={{ background: 'none', border: 'none', color: 'var(--neon)', fontWeight: 700, fontSize: 14, cursor: 'pointer', padding: 0, textDecoration: 'underline', textTransform: 'uppercase', letterSpacing: '.04em' }}
                      >
                        Add price
                      </button>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>Price on request</span>
                    )}
                  </div>
                )}
                <div className={styles.tinyLabel} style={{ marginTop: showQuotePricing ? 14 : 0, marginBottom: 6, fontSize: 13, letterSpacing: '.08em', color: 'var(--neon)', fontWeight: 700 }}>Add-ons/Extras</div>
                {reqAddons.map((a, i) => {
                  const p = Number(a.price) || 0;
                  const dp = Math.round(p * discFactor * 100) / 100;
                  return (
                    <div
                      key={i}
                      style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, color: 'var(--white)', padding: '3px 0' }}
                    >
                      <span>{a.title}</span>
                      {showQuotePricing && (
                        <span>
                          {qDiscount > 0 ? (
                            <span style={{ textDecoration: 'line-through', color: 'var(--muted)', marginRight: 6 }}>{money2(p)}</span>
                          ) : null}
                          {money2(qDiscount > 0 ? dp : p)}
                        </span>
                      )}
                    </div>
                  );
                })}
                {showQuotePricing && (
                  <>
                    {qDiscount > 0 && (
                      <div style={{ textAlign: 'center', padding: '6px 0 2px', fontSize: 12.5, fontWeight: 600, color: 'var(--neon)' }}>
                        {(bq.discount_code || '').trim()
                          ? `Promo Code: ${bq.discount_label || (bq.discount_code || '').trim()}`
                          : ((bq.discount_label || '').trim() ? `Site Promotion: ${(bq.discount_label || '').trim()}` : 'Site-wide Promotion')}
                        {' · Host saved '}{money2(qDiscount)}
                      </div>
                    )}
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.18)', margin: '.5rem 0' }} />
                    {/* Total Event Cost — blank (—) until the DJ adds a package
                        price. Once priced, the full Cost Breakdown replaces this. */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, fontWeight: 700, color: 'var(--white)', padding: '2px 0' }}>
                      <span>Total Event Cost</span>
                      <span style={{ color: 'var(--muted)' }}>—</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                      {canAddPrice
                        ? 'Add your package price to set the Total Event Cost. The host’s discount carries over automatically to your whole quote (package + add-ons).'
                        : 'Package price is still on request.'}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}
      {/* Full cost breakdown + payment schedule — the complete itemized
          math (package, add-ons, tax, total with tax) and the deposit/balance
          split, shown at the bottom of Package & Price. */}
      {hasPrice && bigPriceVal != null && (() => {
        const bt = b as typeof b & {
          tax_pct?: number | null; tax_amount?: number | null; total_with_tax?: number | null;
          deposit_pct?: number | null; deposit_amount?: number | null;
          discount_amount?: number | null; discount_label?: string | null; discount_code?: string | null;
        };
        const r2 = (n: number) => Math.round(n * 100) / 100;
        const money2 = (n: number) =>
          `${cur}${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const reqAddons = parseBookingAddons((b as { addons?: unknown }).addons);
        const addonSum = reqAddons.reduce((s, a) => s + (Number(a.price) || 0), 0);
        const cocktailP = Number(b.cocktail_price) || 0;
        const ceremonyP = Number(b.ceremony_price) || 0;
        const subtotal = Number(bigPriceVal) || 0;
        const basePackage = r2(subtotal - addonSum - cocktailP - ceremonyP);
        const taxPct = Number(bt.tax_pct) || 0;
        // The stored tax/total/deposit snapshot was frozen at the ORIGINAL offer.
        // After a counter, bigPriceVal (subtotal) changes but those fields don't,
        // so they'd be stale. Trust the snapshot only when it still matches the
        // current subtotal (total − tax ≈ subtotal); otherwise recompute from the
        // frozen percentages so every row adds up.
        const snapTotal = bt.total_with_tax != null ? Number(bt.total_with_tax) : null;
        const snapTax = Number(bt.tax_amount) || 0;
        const snapshotFresh = snapTotal != null && Math.abs(r2(snapTotal - snapTax) - subtotal) < 0.01;
        const taxAmt = snapshotFresh ? snapTax : (taxPct > 0 ? r2(subtotal * taxPct / 100) : 0);
        const totalWithTax = (snapshotFresh && snapTotal != null) ? snapTotal : r2(subtotal + taxAmt);
        const depPct = Number(bt.deposit_pct) || 0;
        const depAmt = (snapshotFresh && bt.deposit_amount != null)
          ? Number(bt.deposit_amount)
          : (depPct > 0 ? r2(totalWithTax * depPct / 100) : 0);
        const balance = depAmt > 0 ? r2(totalWithTax - depAmt) : null;
        // The subtotal (and thus basePackage) is already post-discount. Show the
        // Package line PRE-discount so the "−Discount" row below reconciles —
        // otherwise the discount is subtracted twice.
        const discountAmt = (bt.discount_amount != null && Number(bt.discount_amount) > 0) ? Number(bt.discount_amount) : 0;
        const basePackageShown = r2(basePackage + discountAmt);
        const row = (l: string, v: string, strong = false, accent = false) => (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 14, fontWeight: strong ? 700 : 400 }}>
            <span style={{ color: strong ? 'var(--white)' : 'var(--muted)' }}>{l}</span>
            <span style={{ color: accent ? 'var(--neon)' : 'var(--white)' }}>{v}</span>
          </div>
        );
        const divider = <div style={{ borderTop: '1px solid rgba(255,255,255,0.18)', margin: '.5rem 0' }} />;
        return (
          <div style={{ marginTop: '.75rem', padding: '1rem', background: 'rgba(0,0,0,0.28)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div className={styles.tinyLabel} style={{ marginBottom: 8, fontSize: 11, letterSpacing: '.14em', color: 'var(--muted)', fontWeight: 700 }}>Cost Breakdown</div>
            {divider}
            {row('Package', money2(basePackageShown))}
            {reqAddons.map((a, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 14 }}>
                <span style={{ color: 'var(--muted)' }}>{a.title || 'Add-on'}</span>
                <span style={{ color: 'var(--white)' }}>{money2(Number(a.price) || 0)}</span>
              </div>
            ))}
            {ceremonyP > 0 && row('Ceremony', money2(ceremonyP))}
            {cocktailP > 0 && row('Cocktail hour', money2(cocktailP))}
            {taxAmt > 0 && row(`Sales tax (${taxPct}%)`, money2(taxAmt))}
            {row('Total Event Cost (with tax)', money2(totalWithTax), true)}
            {/* Saving sits tucked right under the Total (not as an itemized
                line), and says WHY: a promo code the host entered ("Promo Code:
                CODE") vs the DJ's account-wide sale (no code — its name is kept
                in discount_label, shown as "Site Promotion: NAME"). */}
            {bt.discount_amount != null && Number(bt.discount_amount) > 0 && (
              <div style={{ textAlign: 'center', padding: '4px 0 0', fontSize: 12.5, fontWeight: 600, color: 'var(--neon)' }}>
                {(bt.discount_code || '').trim()
                  ? `Promo Code: ${bt.discount_label || (bt.discount_code || '').trim()}`
                  : ((bt.discount_label || '').trim() ? `Site Promotion: ${(bt.discount_label || '').trim()}` : 'Site-wide Promotion')}
                {' · Host saved '}{money2(Number(bt.discount_amount))}
              </div>
            )}
            {depAmt > 0 && (
              <>
                {divider}
                <div className={styles.tinyLabel} style={{ marginBottom: 6, fontSize: 13, letterSpacing: '.08em', color: 'var(--neon)', fontWeight: 700 }}>Payment Schedule</div>
                {row(depPct > 0 ? `Deposit (${depPct}%)` : 'Deposit', money2(depAmt))}
                {balance != null && row('Balance due day of event', money2(balance))}
              </>
            )}
            {overtimeRate != null && row('Overtime', `${money2(overtimeRate)}/hr`)}
          </div>
        );
      })()}
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
