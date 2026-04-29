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

export default function QuoteModal({ booking, depositPct, onClose, onSaved }: Props) {
  const [price, setPrice] = useState('');
  const [overtime, setOvertime] = useState('');
  const [message, setMessage] = useState('');
  const hasCocktail = !!booking.cocktail_needed;
  const [cocktailIncluded, setCocktailIncluded] = useState(true);
  const [cocktailPrice, setCocktailPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventHours = eventHoursFromTimes(booking.start_time, booking.end_time);
  const hoursLabel = eventHours ? `${eventHours} Hour Event Price` : 'Event Price';

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
      let cocktailPriceFinal: number | null = null;
      if (hasCocktail && !cocktailIncluded) {
        const cp = parseFloat(cocktailPrice);
        cocktailPriceFinal = !isNaN(cp) && cp > 0 ? cp : null;
      }

      const overtimeNum = parseFloat(overtime);
      const overtimeFinal = !isNaN(overtimeNum) && overtimeNum > 0 ? overtimeNum : null;

      const updatePayload = {
        quoted_rate: priceNum,
        deposit_amount: depositAmount ? parseFloat(depositAmount) : null,
        // Vanilla stores overtime in counter_rate (overloaded field); we
        // do the same so the existing read paths work.
        counter_rate: overtimeFinal,
        counter_message: message.trim() || null,
        cocktail_price: cocktailPriceFinal,
        cocktail_included: hasCocktail ? cocktailIncluded : null,
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
        cocktail_included: hasCocktail ? cocktailIncluded : null,
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
          <div className={styles.modalTitle}>Send Price</div>
          <button
            type="button"
            onClick={onClose}
            className={styles.modalCloseBtn}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {booking.package_title && (
          <div className={styles.quotePkgLine}>
            Package: <strong>{booking.package_title}</strong>
          </div>
        )}

        {/* Event price */}
        <div className={styles.counterFormGroup}>
          <label className={styles.counterFormLabel}>{hoursLabel}</label>
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

        {/* Cocktail pricing */}
        {hasCocktail && (
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

        {/* Overtime */}
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
            {submitting ? 'Sending…' : 'Send Price'}
          </button>
        </div>
      </div>
    </div>
  );
}
