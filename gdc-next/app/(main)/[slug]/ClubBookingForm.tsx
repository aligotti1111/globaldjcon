'use client';

// ClubBookingForm — visitor-side booking request form for club DJ profiles.
// Mirror of MobileBookingForm but tailored to the club workflow:
//
//   - Event Type (Bar / Club)
//   - Set Type (Opening / Headliner / Closing / Opening–Close / Opening & Closing)
//   - Venue name + address (freehand for now; autocomplete is a follow-up)
//   - Date (driven by the calendar — passed in via dateKey)
//   - Start / end times
//   - Equipment selection (filtered by what the DJ provides):
//       * sound_system  → only if equip_full
//       * decks_only    → if equip_full OR equip_decks
//       * venue_provides → always
//   - Rate display (read from booking_settings; per-day overrides supported
//     once day editor adds them — for now we use globals)
//   - For 'offers' rate type: input field for the visitor's offer amount
//   - Notes
//   - Submit → INSERT into bookings + email DJ via /api/send-email
//
// The form is rendered inline in the booking tab below the calendar — it
// does NOT use a modal, matching MobileBookingForm's UX.

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './clubBookingForm.module.css';
import {
  type BookingSettings,
  type DayData,
  formatTime12,
} from './bookingSettings';
import { MOB_TIME_OPTIONS, formatLongDate } from './mobileBookingForm';

// Currency code → symbol. Mirror of the list in update-dj-profile/ClubBookingTab.
// Kept inline here (small + rarely changing) rather than extracted to a shared
// module since the two files have different contexts.
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', CAD: '$', AUD: '$',
  JPY: '¥', KRW: '₩', CNY: '¥', INR: '₹', BRL: 'R$', MXN: '$',
};

const VENUE_TYPE_LABELS: Record<string, string> = {
  bar: 'Bar',
  club: 'Club',
};

const SET_TYPE_LABELS: Record<string, string> = {
  opening: 'Opening Set',
  headliner: 'Headliner',
  closing: 'Closing Set',
  opening_close: 'Opening – Close',
  opening_and_closing: 'Opening & Closing',
};

interface DjLite {
  id: string;
  name: string | null;
  slug: string | null;
}

interface CurrentUser {
  id: string;
  email?: string | null;
  name?: string | null;
}

interface Props {
  dateKey: string;
  dj: DjLite;
  bookingSettings: BookingSettings;
  currentUser: CurrentUser;
  // Called when the visitor clicks Cancel or after a successful submit
  // — parent uses this to clear the selectedDate and dismiss the form.
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────
// Rate calculation — figures out what to show in the rate area based on
// equipment selection, rate type (flat/hourly/offers), and per-day
// overrides if present.
// ─────────────────────────────────────────────────────────────────────────

interface RateInfo {
  // Display rate (per booking for flat, per hour for hourly, base for offers)
  rate: number | null;
  // Rate type — drives what the visitor sees + what gets submitted
  rateType: 'flat' | 'hourly' | 'offers';
  // Currency symbol for display
  symbol: string;
  // Currency code for submit payload
  currency: string;
  // Hourly only — total when start + end are picked
  hourlyTotal: number | null;
  // Hourly only — number of hours computed
  hours: number | null;
  // Human label (e.g. "Rate with Sound System & Decks")
  label: string;
}

function computeRate(
  bs: BookingSettings,
  dayData: DayData,
  equipment: string,
  startTime: string,
  endTime: string,
): RateInfo {
  const currency = bs.rate_currency || 'USD';
  const symbol = CURRENCY_SYMBOLS[currency] || '$';

  // Effective rate type — per-day rateType wins, else global
  // Note: DayData.rateType isn't in the type yet (deferred from day-editor
  // session) but vanilla writes it. Cast to access defensively.
  const dayRateType = (dayData as DayData & { rateType?: string }).rateType;
  const baseType: 'flat' | 'hourly' | 'offers' =
    (dayRateType as 'flat' | 'hourly' | 'offers') ||
    ((bs.global_rate_type as 'flat' | 'hourly' | 'offers') || 'flat');

  let label = '';
  let rate: number | null = null;

  // Equipment-specific label
  if (equipment === 'sound_system') {
    label = 'Rate with Sound System & Decks/Controller';
  } else if (equipment === 'decks_only') {
    label = 'Rate with Decks/Controller only';
  } else if (equipment === 'venue_provides') {
    label = 'Rate with venue providing all equipment';
  }

  // Pick the correct global rate field for this equipment
  if (baseType !== 'offers') {
    let raw: number | string | null | undefined = null;
    if (equipment === 'sound_system') raw = bs.rate_with_system;
    else if (equipment === 'decks_only') raw = bs.rate_with_decks;
    else if (equipment === 'venue_provides') raw = bs.rate_no_equip;

    if (raw != null && raw !== '') {
      const n = Number(raw);
      if (!isNaN(n) && n > 0) rate = n;
    }
  }

  // Hourly total
  let hourlyTotal: number | null = null;
  let hours: number | null = null;
  if (baseType === 'hourly' && rate != null && startTime && endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    let [eh, em] = endTime.split(':').map(Number);
    let totalMins = (eh * 60 + em) - (sh * 60 + sm);
    if (totalMins <= 0) totalMins += 24 * 60;
    hours = totalMins / 60;
    hourlyTotal = hours * rate;
  }

  return {
    rate,
    rateType: baseType,
    symbol,
    currency,
    hourlyTotal,
    hours,
    label,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────

export default function ClubBookingForm({
  dateKey,
  dj,
  bookingSettings,
  currentUser,
  onClose,
}: Props) {
  // ── Form state ────────────────────────────────────────────────────
  const [venueType, setVenueType] = useState<'' | 'bar' | 'club'>('');
  const [setType, setSetType] = useState<string>('');
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [country, setCountry] = useState('US');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [equipment, setEquipment] = useState<string>('');
  const [venueEquipDetail, setVenueEquipDetail] = useState('');
  const [offerAmount, setOfferAmount] = useState('');
  const [notes, setNotes] = useState('');

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Per-day data (rate overrides etc) — read once at mount
  const dayData: DayData = useMemo(
    () => bookingSettings.booking_days?.[dateKey] || {},
    [bookingSettings.booking_days, dateKey]
  );

  // Equipment options the DJ supports — visitor can only pick from these.
  // Higher equipment tier = more options visible to visitor.
  const equipmentOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    if (bookingSettings.equip_full) {
      opts.push({ value: 'sound_system', label: 'Full sound system & decks' });
    }
    if (bookingSettings.equip_full || bookingSettings.equip_decks) {
      opts.push({ value: 'decks_only', label: 'Decks/controller only' });
    }
    // Venue-provides is always an option — even if DJ provides full system,
    // the venue might want to use their own. (Vanilla allows this too.)
    opts.push({ value: 'venue_provides', label: 'Venue provides all equipment' });
    return opts;
  }, [bookingSettings.equip_full, bookingSettings.equip_decks]);

  // Reset equipment if it's no longer valid (e.g. DJ changed config)
  useEffect(() => {
    if (equipment && !equipmentOptions.some((o) => o.value === equipment)) {
      setEquipment('');
    }
  }, [equipment, equipmentOptions]);

  // Allow offers? Either the global rate type is 'offers', or this specific
  // day was overridden to offers in the day editor.
  const dayRateType = (dayData as DayData & { rateType?: string }).rateType;
  const allowOffers = bookingSettings.allow_offers
    || bookingSettings.global_rate_type === 'offers'
    || dayRateType === 'offers';

  // Rate info — recomputed whenever the inputs that affect it change
  const rateInfo = useMemo(
    () => computeRate(bookingSettings, dayData, equipment, startTime, endTime),
    [bookingSettings, dayData, equipment, startTime, endTime]
  );

  const isOffers = rateInfo.rateType === 'offers';
  const isHourly = rateInfo.rateType === 'hourly';

  // Show rate area only when we have enough info — equipment picked AND
  // both times set (vanilla parity). For offers, equipment + offerAmount
  // is enough; times are still required for the booking but rate display
  // doesn't change with them.
  const canShowRate = equipment && (isOffers || (startTime && endTime));

  // ── Submit ───────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validation — keep the same order vanilla uses so the user gets the
    // most relevant message first.
    if (!venueType) { setError('Please select Bar or Club.'); return; }
    if (!setType) { setError('Please select a set type.'); return; }
    if (!venueName.trim()) { setError('Please enter the venue name.'); return; }
    if (!venueAddress.trim()) { setError('Please enter the venue address.'); return; }
    if (!startTime) { setError('Please select a start time.'); return; }
    if (!endTime) { setError('Please select an end time.'); return; }
    if (!equipment) { setError('Please select an equipment option.'); return; }
    if (isOffers && !offerAmount.trim()) {
      setError('Please enter your offer amount.');
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const offerNum = offerAmount ? Number(offerAmount) : null;

      const insertPayload = {
        dj_id: dj.id,
        requester_id: currentUser.id,
        dj_slug: dj.slug,
        booking_type: 'club',
        event_date: dateKey,
        country,
        venue_type: venueType,
        set_type: setType,
        venue_name: venueName.trim(),
        venue_address: venueAddress.trim(),
        start_time: startTime,
        end_time: endTime,
        equipment,
        venue_equip_detail: venueEquipDetail.trim() || null,
        offer_amount: isOffers && offerNum && !isNaN(offerNum) ? offerNum : null,
        // For flat: per-event rate. For hourly: per-hour rate (hourlyTotal
        // is calculated server-side from times if needed). For offers:
        // null — there's no quoted rate, only the visitor's offer.
        quoted_rate: !isOffers && rateInfo.rate ? rateInfo.rate : null,
        currency: rateInfo.currency,
        notes: notes.trim() || null,
        status: 'pending',
      };

      const { error: insertError } = await supabase
        .from('bookings')
        .insert(insertPayload as unknown as never);

      if (insertError) throw insertError;

      // Notify the DJ — fire-and-forget. Failures don't block the success
      // state since the booking is already saved.
      try {
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'booking_request',
            djUserId: dj.id,
            djName: dj.name,
            requesterName: currentUser.name,
            eventDate: dateKey,
            venueName: venueName.trim(),
            venueAddress: venueAddress.trim(),
            venueType,
            setType,
            startTime,
            endTime,
            equipment,
            notes: notes.trim() || null,
            offerAmount: insertPayload.offer_amount,
            quotedRate: insertPayload.quoted_rate,
            totalHours: rateInfo.hours,
            currency: rateInfo.currency,
          }),
        });
      } catch {
        // Email is best-effort; ignore failures
      }

      setSuccess(true);
      // Auto-dismiss the form after a short delay
      setTimeout(() => onClose(), 2500);
    } catch (err) {
      console.error('club booking submit failed', err);
      const msg = err instanceof Error ? err.message : 'Failed to submit booking.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success state ────────────────────────────────────────────────
  if (success) {
    return (
      <div className={styles.formWrap}>
        <div className={styles.successCard}>
          <div className={styles.successIcon}>✓</div>
          <div className={styles.successTitle}>Booking request sent!</div>
          <div className={styles.successBody}>
            We&apos;ve sent your request to {dj.name || 'the DJ'}.
            They&apos;ll be in touch shortly.
          </div>
        </div>
      </div>
    );
  }

  // ── Form UI ──────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className={styles.formWrap}>
      <div className={styles.formCard}>
        {/* Header */}
        <div className={styles.formHeader}>
          <div>
            <div className={styles.formHeaderEyebrow}>Booking Request</div>
            <div className={styles.formHeaderDate}>{formatLongDate(dateKey)}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={styles.formCloseBtn}
            aria-label="Close booking form"
          >
            ✕
          </button>
        </div>

        {/* Event Type */}
        <FormSection label="Event Type">
          <div className={styles.pillRow}>
            {(['bar', 'club'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVenueType(v)}
                className={`${styles.pill} ${venueType === v ? styles.pillActive : ''}`}
              >
                {VENUE_TYPE_LABELS[v]}
              </button>
            ))}
          </div>
        </FormSection>

        {/* Set Type — only after venue type picked */}
        {venueType && (
          <FormSection label="Set Type">
            <div className={styles.pillCol}>
              {Object.entries(SET_TYPE_LABELS).map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setSetType(val)}
                  className={`${styles.pillWide} ${setType === val ? styles.pillActive : ''}`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </FormSection>
        )}

        {/* Venue */}
        <FormSection label="Venue">
          <input
            type="text"
            placeholder="Venue name"
            value={venueName}
            onChange={(e) => setVenueName(e.target.value)}
            className={styles.input}
          />
          <input
            type="text"
            placeholder="Venue address"
            value={venueAddress}
            onChange={(e) => setVenueAddress(e.target.value)}
            className={styles.input}
            style={{ marginTop: '.5rem' }}
          />
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={styles.input}
            style={{ marginTop: '.5rem', cursor: 'pointer' }}
          >
            <option value="US">United States</option>
            <option value="GB">United Kingdom</option>
            <option value="CA">Canada</option>
            <option value="AU">Australia</option>
            <option value="DE">Germany</option>
            <option value="FR">France</option>
            <option value="ES">Spain</option>
            <option value="IT">Italy</option>
            <option value="NL">Netherlands</option>
            <option value="SE">Sweden</option>
            <option value="NO">Norway</option>
            <option value="DK">Denmark</option>
            <option value="NZ">New Zealand</option>
            <option value="SG">Singapore</option>
            <option value="ZA">South Africa</option>
            <option value="AE">UAE</option>
            <option value="IN">India</option>
            <option value="JP">Japan</option>
            <option value="MX">Mexico</option>
            <option value="BR">Brazil</option>
            <option value="CH">Switzerland</option>
            <option value="IE">Ireland</option>
          </select>
        </FormSection>

        {/* Times */}
        <FormSection label="Set Times">
          <div className={styles.timeRow}>
            <div className={styles.timeCol}>
              <label className={styles.timeLabel}>Set Start</label>
              <select
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={styles.input}
              >
                <option value="">Select…</option>
                {MOB_TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className={styles.timeCol}>
              <label className={styles.timeLabel}>Set End</label>
              <select
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={styles.input}
              >
                <option value="">Select…</option>
                {MOB_TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Set duration hint */}
          {startTime && endTime && rateInfo.hours != null && (
            <div className={styles.durationHint}>
              {formatTime12(startTime)} → {formatTime12(endTime)} ({rateInfo.hours} hr{rateInfo.hours !== 1 ? 's' : ''})
            </div>
          )}
        </FormSection>

        {/* Equipment */}
        <FormSection label="Equipment">
          <div className={styles.pillCol}>
            {equipmentOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setEquipment(opt.value)}
                className={`${styles.pillWide} ${equipment === opt.value ? styles.pillActive : ''}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {equipment === 'venue_provides' && (
            <input
              type="text"
              placeholder="Describe provided equipment (optional)"
              value={venueEquipDetail}
              onChange={(e) => setVenueEquipDetail(e.target.value)}
              className={styles.input}
              style={{ marginTop: '.5rem' }}
            />
          )}
        </FormSection>

        {/* Rate display */}
        {canShowRate && (
          <FormSection label="Rate">
            <RateDisplay
              info={rateInfo}
              allowOffers={allowOffers && !isOffers}
              isOffersOnly={isOffers}
              offerAmount={offerAmount}
              setOfferAmount={setOfferAmount}
              baseRate={
                (dayData as DayData & { base_rate?: number | string }).base_rate
                  || bookingSettings.base_rate
                  || rateInfo.rate
              }
            />
          </FormSection>
        )}

        {/* Notes */}
        <FormSection label="Notes (optional)">
          <textarea
            placeholder="Anything the DJ should know about the event…"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={styles.textarea}
          />
        </FormSection>

        {/* Submit */}
        <div className={styles.submitArea}>
          {error && <div className={styles.errorMsg}>{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            className={styles.submitBtn}
          >
            {submitting ? 'Sending…' : 'Request Booking'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FormSection — small wrapper that gives each section its own padded card
// row + label. Mirrors the look of the vanilla form.
// ─────────────────────────────────────────────────────────────────────────
function FormSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>{label}</div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// RateDisplay — shows rate amount + (for hourly) the running total. For
// offers mode, shows an input for the visitor's offer amount.
// ─────────────────────────────────────────────────────────────────────────
function RateDisplay({
  info,
  allowOffers,
  isOffersOnly,
  offerAmount,
  setOfferAmount,
  baseRate,
}: {
  info: RateInfo;
  allowOffers: boolean;
  isOffersOnly: boolean;
  offerAmount: string;
  setOfferAmount: (v: string) => void;
  baseRate: number | string | null | undefined;
}) {
  const { rate, symbol, currency, hourlyTotal, hours, label, rateType } = info;
  const isHourly = rateType === 'hourly';

  // Offers-only mode (DJ has no fixed rate): show an offer input + base rate
  if (isOffersOnly) {
    const baseRateNum = baseRate != null && baseRate !== '' ? Number(baseRate) : null;
    return (
      <div className={styles.rateBox}>
        {baseRateNum && !isNaN(baseRateNum) && (
          <>
            <div className={styles.rateLabelMini}>Base Rate</div>
            <div className={styles.rateValueLarge}>
              {symbol}{baseRateNum.toLocaleString()}{' '}
              <span className={styles.rateCurrency}>{currency}</span>
            </div>
          </>
        )}
        <div className={styles.rateOffersHint}>
          This DJ accepts offers
          {baseRateNum ? ' — enter an amount at or above the base rate' : ''}:
        </div>
        <div className={styles.offerInputRow}>
          <span className={styles.offerSymbol}>{symbol}</span>
          <input
            type="number"
            min={baseRateNum || 0}
            placeholder="Your offer"
            value={offerAmount}
            onChange={(e) => setOfferAmount(e.target.value)}
            className={styles.offerInput}
          />
        </div>
      </div>
    );
  }

  // Flat / Hourly with a configured rate
  if (rate != null) {
    return (
      <div className={styles.rateBox}>
        <div className={styles.rateLabelMini}>{label}</div>
        <div className={styles.rateValueLarge}>
          {symbol}{rate.toLocaleString()}{' '}
          <span className={styles.rateCurrency}>
            {currency}{isHourly ? '/hr' : ''}
          </span>
        </div>
        {isHourly && hourlyTotal != null && hours != null && (
          <div className={styles.rateTotalRow}>
            <span className={styles.rateTotalLabel}>
              {hours % 1 === 0 ? hours : hours.toFixed(1)} hr{hours !== 1 ? 's' : ''} × {symbol}{rate.toLocaleString()}/{currency}
            </span>
            <span className={styles.rateTotalValue}>
              {symbol}{hourlyTotal.toLocaleString(undefined, {
                minimumFractionDigits: 0, maximumFractionDigits: 2,
              })}{' '}
              <span className={styles.rateCurrency}>{currency}</span>
            </span>
          </div>
        )}
        {/* If DJ accepts offers in addition to flat rate, allow visitor
            to submit an offer instead. */}
        {allowOffers && (
          <div className={styles.offerInputRow} style={{ marginTop: '.65rem' }}>
            <span className={styles.offerSymbol}>{symbol}</span>
            <input
              type="number"
              min={0}
              placeholder="Or submit an offer"
              value={offerAmount}
              onChange={(e) => setOfferAmount(e.target.value)}
              className={styles.offerInput}
            />
          </div>
        )}
      </div>
    );
  }

  // No rate configured — fall back to a generic "request a quote" message
  return (
    <div className={styles.rateBox}>
      <div className={styles.rateOffersHint}>
        Rate not yet configured for this option — the DJ will reply with a quote.
      </div>
    </div>
  );
}
