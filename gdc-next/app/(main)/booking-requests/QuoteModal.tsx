'use client';

// QuoteModal — DJ responds with a price on a mobile DJ booking that was
// submitted in "quote mode" (booker didn't pick a package; they just asked
// for a quote).
//
// Inputs:
//   - Event Price (required) — the all-in price for the event hours
//   - Hourly Overtime Rate (optional) — stored in counter_rate column
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

export default function QuoteModal({ booking, depositPct, onClose, onSaved }: Props) {
  const [price, setPrice] = useState('');
  const [overtime, setOvertime] = useState('');
  const [message, setMessage] = useState('');
  const hasCocktail = !!booking.cocktail_needed;
  const [cocktailIncluded, setCocktailIncluded] = useState(true);
  const [cocktailPrice, setCocktailPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Club bookings don't have packages, cocktail hour, or hourly overtime —
  // those concepts are mobile-DJ specific. For club, the modal becomes a
  // simpler "set the rate for this set" flow with read-only set time
  // context at the top.
  const isClubBooking = booking.booking_type === 'club';

  const eventHours = eventHoursFromTimes(booking.start_time, booking.end_time);
  const hoursLabel = eventHours ? `${eventHours} Hour Event Price` : 'Event Price';
  // For club, use simpler "Set Rate" wording rather than tying to hours
  // (a flat per-set price reads more naturally for a club gig).
  const priceLabel = isClubBooking ? 'Set Rate' : hoursLabel;

  // Live deposit preview — recomputes as user types
  const priceNum = parseFloat(price);
  const depositAmount = (depositPct > 0 && priceNum > 0)
    ? (priceNum * depositPct / 100).toFixed(2)
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

      // Cocktail values — only relevant if booking includes cocktail hour
      // (mobile DJ only). Forced null for club bookings.
      let cocktailPriceFinal: number | null = null;
      if (!isClubBooking && hasCocktail && !cocktailIncluded) {
        const cp = parseFloat(cocktailPrice);
        cocktailPriceFinal = !isNaN(cp) && cp > 0 ? cp : null;
      }

      // Overtime — mobile DJ only; clubs don't use overtime per spec.
      const overtimeNum = parseFloat(overtime);
      const overtimeFinal = !isClubBooking && !isNaN(overtimeNum) && overtimeNum > 0
        ? overtimeNum
        : null;

      const updatePayload = {
        quoted_rate: priceNum,
        deposit_amount: depositAmount ? parseFloat(depositAmount) : null,
        // Vanilla stores overtime in counter_rate (overloaded field); we
        // do the same so the existing read paths work. Always null for clubs.
        counter_rate: overtimeFinal,
        counter_message: message.trim() || null,
        cocktail_price: cocktailPriceFinal,
        cocktail_included: !isClubBooking && hasCocktail ? cocktailIncluded : null,
        status: 'pending',
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
        quoted_rate: priceNum,
        deposit_amount: depositAmount ? parseFloat(depositAmount) : null,
        counter_rate: overtimeFinal,
        counter_message: message.trim() || null,
        cocktail_price: cocktailPriceFinal,
        cocktail_included: !isClubBooking && hasCocktail ? cocktailIncluded : null,
        status: 'pending',
        updated_at: new Date().toISOString(),
      });
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
            {isClubBooking ? 'Add Custom Rate' : 'Send Price'}
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

        {/* Mobile DJ context — package title (clubs don't have packages). */}
        {!isClubBooking && booking.package_title && (
          <div className={styles.quotePkgLine}>
            Package: <strong>{booking.package_title}</strong>
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

            {/* Date row — sits below the times */}
            {booking.event_date && (
              <div
                style={{
                  marginTop: '.65rem',
                  paddingTop: '.55rem',
                  borderTop: '1px solid var(--border)',
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
                  Date
                </div>
                <div style={{ color: 'var(--neon)', fontWeight: 600 }}>
                  {formatLongDate(booking.event_date)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Event price */}
        <div className={styles.counterFormGroup}>
          <label className={styles.counterFormLabel}>{priceLabel}</label>
          <div className={styles.counterAmountRow}>
            <span className={styles.counterCurrencySym}>$</span>
            <input
              type="number"
              min="0"
              placeholder="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={styles.counterAmountInput}
            />
          </div>
          {depositPct > 0 && (
            <div className={styles.depositPreview}>
              Deposit ({depositPct}%): {depositAmount ? `$${Number(depositAmount).toLocaleString()}` : '—'}
            </div>
          )}
        </div>

        {/* Cocktail pricing — mobile DJ weddings only. */}
        {!isClubBooking && hasCocktail && (
          <div className={styles.cocktailBox}>
            <div className={styles.cocktailHeader}>🍸 Cocktail Hour Pricing</div>
            <label className={styles.cocktailCheckLabel}>
              <input
                type="checkbox"
                checked={cocktailIncluded}
                onChange={(e) => setCocktailIncluded(e.target.checked)}
                style={{ accentColor: 'var(--neon)', width: 15, height: 15 }}
              />
              <span>Included in package price</span>
            </label>
            {!cocktailIncluded && (
              <div className={styles.counterAmountRow} style={{ marginTop: '.6rem' }}>
                <span className={styles.counterCurrencySym}>$</span>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={cocktailPrice}
                  onChange={(e) => setCocktailPrice(e.target.value)}
                  className={styles.counterAmountInput}
                />
                <span className={styles.counterCurrencyCode}>Add-on</span>
              </div>
            )}
          </div>
        )}

        {/* Overtime — mobile DJ only. Club bar/club bookings don't use
            overtime rates per spec. */}
        {!isClubBooking && (
          <div className={styles.counterFormGroup}>
            <label className={styles.counterFormLabel}>Hourly Overtime Rate</label>
            <div className={styles.counterAmountRow}>
              <span className={styles.counterCurrencySym}>$</span>
              <input
                type="number"
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

        {error && <div className={styles.counterErr}>{error}</div>}

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
            {submitting ? 'Sending…' : isClubBooking ? 'Add Quote' : 'Send Price'}
          </button>
        </div>
      </div>
    </div>
  );
}
