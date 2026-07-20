'use client';

// QuoteModal — DJ responds with a price on a mobile DJ booking that was
// submitted in "quote mode" (booker didn't pick a package; they just asked
// for a quote).
//
// Inputs:
//   - Event Price (required) — the all-in price for the event hours
//   - Hourly Overtime Rate (optional) — stored in overtime_rate column
//     (vanilla overloads this field; works because there's no real "counter"
//     until a quote-mode booking has its initial price set)
//   - Cocktail hour pricing (only when booking has cocktail_needed) —
//     either included in main price OR add-on with separate price
//   - Message (optional) — stored in counter_message
//
// On save, status stays 'pending' (booker still needs to approve the price).
//
// Faithful port of vanilla openMobQuoteModal + sendMobQuote in br-mob-flow.js.

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './bookingRequests.module.css';
import { formatLongDate } from './helpers';
import type { BookingRow } from './page';

interface Props {
  booking: BookingRow;
  // DJ's deposit_pct from booking_settings — used for the live deposit
  // preview. 0 or null means no deposit.
  depositPct: number;
  // DJ's CURRENT sales-tax setting. A request-price offer is taxed at the
  // moment the DJ makes it — that's the agreement point for quote bookings,
  // which had no price to freeze at creation.
  taxEnabled: boolean;
  taxPct: number;
  onClose: () => void;
  onSaved: (updated: BookingRow) => void;
}

function eventHoursFromTimes(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 1440;
  return Math.ceil(mins / 60);
}

// "13:30" → "1:30 PM" — local helper so we don't pull in another module.
function formatTime12(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  const p = h < 12 ? 'AM' : 'PM';
  const h12 = (h % 12) || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${p}`;
}

export default function QuoteModal({ booking, depositPct, taxEnabled, taxPct, onClose, onSaved }: Props) {
  // Pre-fill from existing values when the DJ is editing a previously
  // sent quote. Empty strings on first quote, populated when re-opening.
  // quoted_rate is stored ALREADY discounted, so re-opening an offer has to add
  // the discount back to show the DJ the number they originally typed —
  // otherwise the saved % would get applied a second time.
  const [price, setPrice] = useState(
    booking.quoted_rate != null
      ? String(Number(booking.quoted_rate) + Number(booking.offer_discount_amount || 0))
      : ''
  );
  // Add Offer always starts with an empty overtime box — the DJ sets the
  // rate fresh per offer. We intentionally do NOT pre-fill from the
  // package's snapshotted overtime_rate (or counter_rate).
  const [overtime, setOvertime] = useState('');
  const [message, setMessage] = useState(booking.counter_message || '');
  // Cocktail hour and ceremony are shown here for CONTEXT ONLY. An offer is a
  // single all-in number — the DJ prices the whole night in one box and these
  // extras are understood to be covered by it. (Package-priced bookings still
  // itemize add-ons; that path is unchanged.)
  const hasCocktail = !!booking.cocktail_needed;
  const hasCeremony = !!booking.ceremony_needed;
  // Percentage off, as a string ('' = none). Re-opening a sent offer restores
  // the % that was applied.
  const [discountPct, setDiscountPct] = useState(
    booking.offer_discount_pct != null && Number(booking.offer_discount_pct) > 0
      ? String(Math.round(Number(booking.offer_discount_pct)))
      : ''
  );
  // The discount box stays hidden behind a link until the DJ wants it —
  // opens automatically when re-editing an offer that already has one.
  const [showDiscount, setShowDiscount] = useState(
    booking.offer_discount_pct != null && Number(booking.offer_discount_pct) > 0
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Club bookings don't have packages, cocktail hour, or hourly overtime —
  // those concepts are mobile-DJ specific. For club, the modal becomes a
  // simpler "set the rate for this set" flow with read-only set time
  // context at the top.
  const isClubBooking = booking.booking_type === 'club';
  // Edit mode — the DJ has already sent a quote and is re-opening to
  // adjust it. Title and submit button reflect this.
  const isEditMode = booking.quoted_rate != null;

  const eventHours = eventHoursFromTimes(booking.start_time, booking.end_time);
  // Mobile: plain "Event Price" label — the hour count is shown as a soft
  // sub-hint next to it rather than crammed into the uppercase label,
  // which read awkwardly (e.g. "6 HOUR EVENT PRICE").
  const priceLabel = isClubBooking ? 'Set Rate' : 'Event Price';

  // Live deposit preview — recomputes as user types. Tax comes from the
  // booking's FROZEN snapshot % (tax_pct, stamped at creation) — never the
  // DJ's current settings — and the deposit is taken on the tax-inclusive
  // total, matching the public booking form and /api/bookings/create.
  // Legacy rows with no snapshot keep the old pre-tax behavior (taxPct 0).
  const priceNum = parseFloat(price);
  // One number, no add-on math: whatever the DJ types is the all-in price
  // for everything listed in this modal.
  const grossPriceNum = !isNaN(priceNum) && priceNum > 0 ? Number(priceNum.toFixed(2)) : 0;
  // Optional straight % off. Tax and deposit are both calculated on the
  // DISCOUNTED price — the booker is only taxed on what they actually pay.
  const discountPctNum = discountPct ? Number(discountPct) : 0;
  const discountAmount = discountPctNum > 0 && grossPriceNum > 0
    ? Number(((grossPriceNum * discountPctNum) / 100).toFixed(2))
    : 0;
  const netPriceNum = Number((grossPriceNum - discountAmount).toFixed(2));
  const subtotalNum = netPriceNum;
  // Tax the offer at the DJ's CURRENT rate when they have tax turned on now
  // (the agreement point for a request-price booking). Otherwise fall back to
  // the booking's frozen snapshot %, so a package-priced row keeps its stamped
  // rate and legacy rows with no snapshot stay tax-free.
  const quoteTaxPct = taxEnabled ? taxPct : (booking.tax_pct != null ? Number(booking.tax_pct) : 0);
  const quoteTaxAmount = (quoteTaxPct > 0 && subtotalNum > 0)
    ? Number(((subtotalNum * quoteTaxPct) / 100).toFixed(2))
    : 0;
  const quoteTotalWithTax = subtotalNum > 0
    ? Number((subtotalNum + quoteTaxAmount).toFixed(2))
    : null;
  const depositAmount = (depositPct > 0 && quoteTotalWithTax != null)
    ? ((quoteTotalWithTax * depositPct) / 100).toFixed(2)
    : null;

  async function submit() {
    setError(null);
    if (!price.trim() || isNaN(priceNum) || priceNum <= 0) {
      setError('Please enter a price.');
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');

      // An offer is a single all-in price, so there are no separate add-on
      // charges to store. Mark cocktail/ceremony as INCLUDED (price null) —
      // that's what makes the emailed bill say "includes cocktail hour /
      // music for ceremony" under one Event price instead of itemizing.
      const cocktailPriceFinal: number | null = null;
      const ceremonyPriceFinal: number | null = null;


      // Overtime — mobile DJ only; clubs don't use overtime per spec.
      const overtimeNum = parseFloat(overtime);
      const overtimeFinal = !isClubBooking && !isNaN(overtimeNum) && overtimeNum > 0
        ? overtimeNum
        : null;

      // Status after sending. For a mobile quote-mode booking, sending the
      // offer hands the decision to the booker → 'counter' (DJ has made a
      // priced response, awaiting booker approve/decline). Club bookings
      // keep their existing draft→send flow and stay 'pending' here.
      const nextStatus = (!isClubBooking && !!booking.is_quote) ? 'counter' : 'pending';

      // For a mobile quote offer, append a negotiation_log entry marking
      // the DJ as the last actor — the Response Required / Awaiting
      // Response tabs read this to decide whose move it is. Re-read the
      // log first so concurrent updates aren't clobbered.
      let negotiationLog = booking.negotiation_log || [];
      if (nextStatus === 'counter') {
        const { data: current } = await supabase
          .from('bookings')
          .select('negotiation_log')
          .eq('id', booking.id)
          .single<{ negotiation_log: typeof negotiationLog }>();
        negotiationLog = current?.negotiation_log || [];
        negotiationLog = [
          ...negotiationLog,
          {
            from: 'dj' as const,
            amount: subtotalNum,
            message: message.trim(),
            created_at: new Date().toISOString(),
          },
        ];
      }

      const updatePayload = {
        // Stored price is the all-in subtotal (base + add-ons), pre-tax —
        // same convention the public booking form uses, so the emailed
        // bill can itemize the add-ons back out of it.
        quoted_rate: subtotalNum,
        deposit_amount: depositAmount ? parseFloat(depositAmount) : null,
        // Keep the frozen tax snapshot coherent: quote-mode bookings have no
        // price at creation, so their tax AMOUNTS were left null — fill them
        // now from the frozen % and the price the DJ just set. Never written
        // for legacy rows (no snapshot %), which keep their old behavior.
        ...(quoteTaxPct > 0
          ? { tax_pct: quoteTaxPct, tax_amount: quoteTaxAmount, total_with_tax: quoteTotalWithTax }
          : {}),
        // Overtime now has its own dedicated column (no longer overloaded onto
        // counter_rate, which is reserved for genuine counter offers). Always
        // null for clubs — overtime is mobile-only per spec.
        overtime_rate: overtimeFinal,
        counter_message: message.trim() || null,
        offer_discount_pct: discountAmount > 0 ? discountPctNum : null,
        offer_discount_amount: discountAmount > 0 ? discountAmount : null,
        cocktail_price: cocktailPriceFinal,
        cocktail_included: !isClubBooking && hasCocktail ? true : null,
        ceremony_price: ceremonyPriceFinal,
        ceremony_included: !isClubBooking && hasCeremony ? true : null,
        status: nextStatus,
        ...(nextStatus === 'counter' ? { negotiation_log: negotiationLog } : {}),
        updated_at: new Date().toISOString(),
      };

      const { error: updErr } = await supabase
        .from('bookings')
        .update(updatePayload as unknown as never)
        .eq('id', booking.id)
        .eq('dj_id', user.id);
      if (updErr) throw updErr;

      onSaved({
        ...booking,
        quoted_rate: subtotalNum,
        deposit_amount: depositAmount ? parseFloat(depositAmount) : null,
        ...(quoteTaxPct > 0
          ? { tax_pct: quoteTaxPct, tax_amount: quoteTaxAmount, total_with_tax: quoteTotalWithTax }
          : {}),
        overtime_rate: overtimeFinal,
        counter_message: message.trim() || null,
        offer_discount_pct: discountAmount > 0 ? discountPctNum : null,
        offer_discount_amount: discountAmount > 0 ? discountAmount : null,
        cocktail_price: cocktailPriceFinal,
        cocktail_included: !isClubBooking && hasCocktail ? true : null,
        ceremony_price: ceremonyPriceFinal,
        ceremony_included: !isClubBooking && hasCeremony ? true : null,
        status: nextStatus,
        negotiation_log: negotiationLog,
        updated_at: new Date().toISOString(),
      });

      // Mobile quote offer just went to the booker — email both parties
      // (booker gets the offer to decide, DJ gets a copy of the details).
      // Best-effort: a failed email never undoes the saved offer.
      if (nextStatus === 'counter') {
        try {
          await fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'offer_sent', bookingId: booking.id }),
          });
        } catch (e) {
          console.warn('offer_sent email failed:', e);
        }
      }

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            {isClubBooking
              ? (isEditMode ? 'Edit Custom Rate' : 'Add Custom Rate')
              : (isEditMode ? 'Edit Offer' : 'Add Offer')}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={styles.modalCloseBtn}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Mobile DJ context — date + event times first, then the package
            title + details so the DJ has full event context while pricing. */}
        {!isClubBooking && (booking.package_title || booking.package_details
          || booking.event_date || booking.start_time || booking.end_time) && (
          <div
            style={{
              padding: '.7rem .85rem',
              marginBottom: '.9rem',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'rgba(255,255,255,.02)',
            }}
          >
            {/* Date + time row */}
            {(booking.event_date || booking.start_time || booking.end_time) && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '1.25rem',
                }}
              >
                {booking.event_date && (
                  <div>
                    <div
                      style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: '.5rem',
                        letterSpacing: '.1em',
                        textTransform: 'uppercase',
                        color: 'var(--muted)',
                        marginBottom: '.15rem',
                      }}
                    >
                      Date
                    </div>
                    <div style={{ color: 'var(--neon)', fontWeight: 600, fontSize: '.78rem' }}>
                      {formatLongDate(booking.event_date)}
                    </div>
                  </div>
                )}
                {booking.start_time && (
                  <div>
                    <div
                      style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: '.5rem',
                        letterSpacing: '.1em',
                        textTransform: 'uppercase',
                        color: 'var(--muted)',
                        marginBottom: '.15rem',
                      }}
                    >
                      Start
                    </div>
                    <div style={{ color: 'var(--neon)', fontWeight: 600 }}>
                      {formatTime12(booking.start_time)}
                    </div>
                  </div>
                )}
                {booking.end_time && (
                  <div>
                    <div
                      style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: '.5rem',
                        letterSpacing: '.1em',
                        textTransform: 'uppercase',
                        color: 'var(--muted)',
                        marginBottom: '.15rem',
                      }}
                    >
                      End
                    </div>
                    <div style={{ color: 'var(--neon)', fontWeight: 600 }}>
                      {formatTime12(booking.end_time)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Package title + details — below the date/time row. */}
            {booking.package_title && (
              <div
                style={{
                  marginTop: (booking.event_date || booking.start_time || booking.end_time)
                    ? '.5rem' : 0,
                  paddingTop: (booking.event_date || booking.start_time || booking.end_time)
                    ? '.45rem' : 0,
                  borderTop: (booking.event_date || booking.start_time || booking.end_time)
                    ? '1px solid var(--border)' : 'none',
                }}
              >
                <div
                  style={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: '.5rem',
                    letterSpacing: '.1em',
                    textTransform: 'uppercase',
                    color: 'var(--muted)',
                    marginBottom: '.15rem',
                  }}
                >
                  Package
                </div>
                <div style={{ color: 'var(--white)', fontWeight: 600, fontSize: '.85rem' }}>
                  {booking.package_title}
                </div>
                {booking.package_details && booking.package_details.trim() && (
                  <div
                    style={{
                      marginTop: '.35rem',
                      fontSize: '.75rem',
                      lineHeight: 1.5,
                      color: 'rgba(255,255,255,.7)',
                    }}
                    // Trusted HTML — package details authored by the DJ in
                    // their own profile editor (same source the booking
                    // form renders).
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: booking.package_details }}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Club booking context — read-only set times + duration so the
            DJ can size the rate against the actual hours requested. Date
            sits below the time row for full event context. */}
        {isClubBooking && (booking.start_time || booking.end_time || booking.event_date) && (
          <div
            style={{
              padding: '.65rem .85rem',
              marginBottom: '.9rem',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'rgba(255,255,255,.02)',
            }}
          >
            {/* Time row — Set Start / Set End / Duration */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem' }}>
              {booking.start_time && (
                <div>
                  <div
                    style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '.5rem',
                      letterSpacing: '.1em',
                      textTransform: 'uppercase',
                      color: 'var(--muted)',
                      marginBottom: '.15rem',
                    }}
                  >
                    Set Start
                  </div>
                  <div style={{ color: 'var(--neon)', fontWeight: 600 }}>
                    {formatTime12(booking.start_time)}
                  </div>
                </div>
              )}
              {booking.end_time && (
                <div>
                  <div
                    style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '.5rem',
                      letterSpacing: '.1em',
                      textTransform: 'uppercase',
                      color: 'var(--muted)',
                      marginBottom: '.15rem',
                    }}
                  >
                    Set End
                  </div>
                  <div style={{ color: 'var(--neon)', fontWeight: 600 }}>
                    {formatTime12(booking.end_time)}
                  </div>
                </div>
              )}
              {eventHours != null && (
                <div>
                  <div
                    style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '.5rem',
                      letterSpacing: '.1em',
                      textTransform: 'uppercase',
                      color: 'var(--muted)',
                      marginBottom: '.15rem',
                    }}
                  >
                    Duration
                  </div>
                  <div style={{ color: 'var(--neon)', fontWeight: 600 }}>
                    {eventHours} hr{eventHours !== 1 ? 's' : ''}
                  </div>
                </div>
              )}
            </div>

            {/* Date row — sits snug below the times */}
            {booking.event_date && (
              <div
                style={{
                  marginTop: '.4rem',
                  paddingTop: '.35rem',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: '.45rem',
                    letterSpacing: '.1em',
                    textTransform: 'uppercase',
                    color: 'var(--muted)',
                    marginBottom: '.1rem',
                  }}
                >
                  Date
                </div>
                <div style={{ color: 'var(--neon)', fontWeight: 600, fontSize: '.78rem' }}>
                  {formatLongDate(booking.event_date)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* What the price covers — read-only. Cocktail hour and ceremony are
            listed FIRST so the DJ sees everything they're pricing before the
            single Event Price box that follows. */}
        {!isClubBooking && (hasCocktail || hasCeremony) && (
          <div className={styles.cocktailBox}>
            <div className={styles.cocktailHeader}>Your price also covers</div>
            {hasCeremony && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  padding: '.3rem 0',
                  fontSize: '.78rem',
                  color: 'rgba(255,255,255,.85)',
                }}
              >
                <span>💍 Music for ceremony</span>
                <span style={{ color: 'var(--muted)' }}>
                  {[
                    booking.ceremony_start_time ? formatTime12(booking.ceremony_start_time) : null,
                    booking.ceremony_same_room == null
                      ? null
                      : booking.ceremony_same_room ? 'Same room' : 'Different room',
                  ].filter(Boolean).join(' · ')}
                </span>
              </div>
            )}
            {hasCocktail && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  padding: '.3rem 0',
                  fontSize: '.78rem',
                  color: 'rgba(255,255,255,.85)',
                }}
              >
                <span>🍸 Cocktail hour</span>
                <span style={{ color: 'var(--muted)' }}>
                  {[
                    booking.cocktail_start_time ? formatTime12(booking.cocktail_start_time) : null,
                    booking.cocktail_same_room == null
                      ? null
                      : booking.cocktail_same_room ? 'Same room' : 'Different room',
                  ].filter(Boolean).join(' · ')}
                </span>
              </div>
            )}
            <div
              style={{
                marginTop: '.5rem',
                paddingTop: '.5rem',
                borderTop: '1px solid rgba(255,255,255,.12)',
                fontSize: '.7rem',
                lineHeight: 1.45,
                color: 'var(--muted)',
              }}
            >
              Your Event Price below is the all-in quote — it covers the reception
              plus everything listed here. No separate add-on charges.
            </div>
          </div>
        )}

        {/* Event price — half-width, with the optional discount box opening
            beside it rather than taking its own full row. */}
        <div className={styles.counterFormGroup}>
          <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end' }}>
            <div style={{ width: showDiscount ? '50%' : '50%' }}>
              <label className={styles.counterFormLabel}>{priceLabel}</label>
              <div className={styles.counterAmountRow}>
                <span className={styles.counterCurrencySym}>$</span>
                <input
                  type="number"
                  onWheel={(e) => e.currentTarget.blur()}
                  min="0"
                  placeholder="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className={styles.counterAmountInput}
                />
              </div>
            </div>

            {showDiscount && (
              <div style={{ width: '50%' }}>
                <label className={styles.counterFormLabel}>Discount</label>
                <div className={styles.counterAmountRow}>
                  <select
                    value={discountPct}
                    // Same guard as the money inputs: a focused dropdown changes
                    // its own value when the mouse wheel passes over it. Blur on
                    // wheel so scrolling can never silently alter the discount.
                    onWheel={(e) => e.currentTarget.blur()}
                    onChange={(e) => setDiscountPct(e.target.value)}
                    className={styles.counterAmountInput}
                    style={{ width: '100%', padding: '.5rem .4rem' }}
                  >
                    <option value="">—</option>
                    {Array.from({ length: 100 }, (_, i) => i + 1).map((p) => (
                      <option key={p} value={String(p)}>{p}%</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Neon link toggles the discount box open / closed. */}
          <button
            type="button"
            onClick={() => {
              if (showDiscount) setDiscountPct('');
              setShowDiscount(!showDiscount);
            }}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              marginTop: '.5rem',
              color: 'var(--neon)',
              fontSize: '.72rem',
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            {showDiscount ? 'Remove discount' : '+ Add discount'}
          </button>

          {discountAmount > 0 && (
            <div className={styles.depositPreview}>
              Takes ${discountAmount.toLocaleString()} off — new price ${netPriceNum.toLocaleString()}
            </div>
          )}
        </div>

        {/* Overtime — mobile DJ only. Club bar/club bookings don't use
            overtime rates per spec. Half width to match Event Price. */}
        {!isClubBooking && (
          <div className={styles.counterFormGroup} style={{ width: '50%' }}>
            <label className={styles.counterFormLabel}>Hourly Overtime Rate</label>
            <div className={styles.counterAmountRow}>
              <span className={styles.counterCurrencySym}>$</span>
              <input
                type="number"
                onWheel={(e) => e.currentTarget.blur()}
                min="0"
                placeholder="0"
                value={overtime}
                onChange={(e) => setOvertime(e.target.value)}
                className={styles.counterAmountInput}
              />
              <span className={styles.counterCurrencyCode}>Per Hour</span>
            </div>
          </div>
        )}

        {/* Optional message */}
        <div className={styles.counterFormGroup}>
          <label className={styles.counterFormLabel}>
            Message <span className={styles.counterFormOpt}>(optional)</span>
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Any details about this price..."
            rows={3}
            className={styles.counterMsgInput}
          />
        </div>

        {/* Offer summary — the all-in bill, exactly as the booker will see it
            in the offer email. Lives at the bottom so it reflects every field
            above it (base price + add-ons + tax + deposit). */}
        {subtotalNum > 0 && (
          <div
            style={{
              margin: '.2rem 0 1rem',
              padding: '.75rem .9rem',
              background: 'rgba(255,255,255,.03)',
              border: '1px solid rgba(255,255,255,.12)',
              borderRadius: 6,
            }}
          >
            {(() => {
              const money = (n: number) =>
                `$${Number(n).toLocaleString(undefined, {
                  minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
                  maximumFractionDigits: 2,
                })}`;
              const line = (
                label: string,
                val: string,
                o?: { bold?: boolean; muted?: boolean; top?: boolean },
              ) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    padding: '.3rem 0',
                    fontSize: '.78rem',
                    fontWeight: o?.bold ? 700 : 400,
                    color: o?.bold
                      ? 'var(--neon)'
                      : o?.muted
                        ? 'var(--muted)'
                        : 'rgba(255,255,255,.85)',
                    borderTop: o?.top ? '1px solid rgba(255,255,255,.12)' : undefined,
                    marginTop: o?.top ? '.25rem' : undefined,
                    paddingTop: o?.top ? '.45rem' : undefined,
                  }}
                >
                  <span>{label}</span>
                  <span>{val}</span>
                </div>
              );
              const rows = [];
              rows.push(line(isClubBooking ? 'Rate' : 'Event price', money(grossPriceNum)));
              if (discountAmount > 0) {
                rows.push(line(`Discount (${discountPctNum}%)`, `−${money(discountAmount)}`, { muted: true }));
                rows.push(line('Discounted price', money(netPriceNum), { top: true }));
              }
              if (quoteTaxAmount > 0) {
                rows.push(line(`Sales tax (${quoteTaxPct}%)`, money(quoteTaxAmount)));
              }
              rows.push(
                line('Total', quoteTotalWithTax != null ? money(quoteTotalWithTax) : '—', {
                  bold: true,
                  top: true,
                }),
              );
              if (depositPct > 0 && depositAmount) {
                rows.push(
                  line(`Deposit (${depositPct}%) — to reserve`, money(Number(depositAmount)), { top: true }),
                );
                rows.push(
                  line(
                    'Balance due day of event',
                    money(Number(((quoteTotalWithTax || 0) - Number(depositAmount)).toFixed(2))),
                    { bold: true },
                  ),
                );
              }
              rows.push(
                <div
                  key="__allin"
                  style={{
                    marginTop: '.55rem',
                    paddingTop: '.5rem',
                    borderTop: '1px solid rgba(255,255,255,.12)',
                    fontSize: '.7rem',
                    lineHeight: 1.45,
                    color: 'var(--muted)',
                  }}
                >
                  This total quote covers everything listed above
                  {!isClubBooking && (hasCocktail || hasCeremony)
                    ? `, including ${[hasCeremony ? 'music for the ceremony' : null, hasCocktail ? 'cocktail hour' : null].filter(Boolean).join(' and ')}`
                    : ''}
                  .
                </div>,
              );
              return rows;
            })()}
          </div>
        )}

        {error && <div className={styles.counterErr}>{error}</div>}

        {isClubBooking && (
          <div style={{
            marginTop: '.4rem',
            marginBottom: '.6rem',
            padding: '.55rem .75rem',
            background: 'rgba(255, 176, 32, 0.08)',
            border: '1px solid rgba(255, 176, 32, 0.3)',
            borderRadius: 5,
            fontSize: '.72rem',
            lineHeight: 1.4,
            color: 'rgba(255,255,255,.8)',
          }}>
            <strong style={{ color: 'var(--amber)' }}>This saves a draft.</strong>{' '}
            The booker will not see your price until you click{' '}
            <strong>Send Quote</strong> on the booking card afterwards.
          </div>
        )}

        <div className={styles.counterActions}>
          <button
            type="button"
            onClick={onClose}
            className={styles.counterCancelBtn}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className={styles.counterSubmitBtn}
          >
            {submitting
              ? 'Saving…'
              : isClubBooking
                ? (isEditMode ? 'Update Draft' : 'Save Draft')
                : (isEditMode ? 'Update Offer' : 'Send Offer')}
          </button>
        </div>
      </div>
    </div>
  );
}
