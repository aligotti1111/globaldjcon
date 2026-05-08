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

import { useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './clubBookingForm.module.css';
import {
  type BookingSettings,
  type DayData,
  formatTime12,
} from './bookingSettings';
import {
  MOB_TIME_OPTIONS,
  formatLongDate,
  formatUSPhone,
  searchAddresses,
  type AddressSuggestion,
} from './mobileBookingForm';

import {
  CLUB_VENUE_TYPE_LABELS,
  CLUB_SET_TYPE_LABELS,
  currencySymbol,
} from '@/lib/constants';

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
  const symbol = currencySymbol(currency);

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

  // Pick the correct global rate field for this equipment AND rate type.
  // Hourly mode reads the rate_hourly_* fields; flat mode reads the
  // rate_* (flat) fields. They're independent — a DJ who has flat
  // values set but switches to hourly without entering hourly values
  // will show no rate for hourly until they configure them.
  if (baseType !== 'offers') {
    let raw: number | string | null | undefined = null;
    const isHourly = baseType === 'hourly';
    if (equipment === 'sound_system') {
      raw = isHourly ? bs.rate_hourly_with_system : bs.rate_with_system;
    } else if (equipment === 'decks_only') {
      raw = isHourly ? bs.rate_hourly_with_decks : bs.rate_with_decks;
    } else if (equipment === 'venue_provides') {
      raw = isHourly ? bs.rate_hourly_no_equip : bs.rate_no_equip;
    }

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
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('US');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [equipment, setEquipment] = useState<string>('');
  const [venueEquipDetail, setVenueEquipDetail] = useState('');
  const [offerAmount, setOfferAmount] = useState('');
  const [notes, setNotes] = useState('');

  // ── Address autocomplete (Nominatim) ─────────────────────────────
  // Suggestions are fetched debounced (350ms) when the user has typed
  // 3+ chars. Coords from a picked suggestion stick on a ref so we can
  // include them in the booking insert (DJ uses them for distance check).
  const [addrSuggestions, setAddrSuggestions] = useState<AddressSuggestion[]>([]);
  const [showAddrSuggestions, setShowAddrSuggestions] = useState(false);
  const addrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const venueCoordsRef = useRef<{ lat: number; lon: number } | null>(null);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Per-day data (rate overrides etc) — read once at mount
  const dayData: DayData = useMemo(
    () => bookingSettings.booking_days?.[dateKey] || {},
    [bookingSettings.booking_days, dateKey]
  );

  // Equipment options — ALL THREE are always shown to the booker so they
  // see every choice. We tag each with `supported` so the UI can mark
  // unsupported ones (the DJ doesn't bring that gear) and show an inline
  // "DJ won't bring this — pick another" message instead of a rate.
  //
  // Support rules:
  //   - sound_system  → DJ supports it if equip_full
  //   - decks_only    → DJ supports it if equip_full OR equip_decks
  //   - venue_provides → ALWAYS supported (DJ shows up empty-handed)
  const equipmentOptions = useMemo(() => {
    return [
      {
        value: 'sound_system',
        label: 'Full sound system and decks/controller must be provided by DJ',
        supported: !!bookingSettings.equip_full,
      },
      {
        value: 'decks_only',
        label: 'Decks or controller must be provided by DJ',
        supported: !!(bookingSettings.equip_full || bookingSettings.equip_decks),
      },
      {
        value: 'venue_provides',
        label: 'Venue provides all equipment',
        supported: true,
      },
    ];
  }, [bookingSettings.equip_full, bookingSettings.equip_decks]);

  // Helper — is the currently-picked equipment supported by this DJ?
  const isEquipmentSupported = useMemo(() => {
    const opt = equipmentOptions.find((o) => o.value === equipment);
    return opt ? opt.supported : true;
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

  // Quote mode — DJ has booking enabled and equipment picked, but no
  // rate configured for the picked equipment option (and they're not in
  // offers mode). The form stays open as a normal booking flow but
  // skips the rate display and flags the booking with is_quote=true so
  // the DJ can respond with a custom rate via the existing counter flow.
  // Triggered when: not offers mode AND equipment is supported AND no
  // matching rate field has a value > 0.
  const isQuoteMode = !isOffers && isEquipmentSupported && rateInfo.rate == null;

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
    if (!phone.trim()) { setError('Please enter your phone number.'); return; }
    if (!startTime) { setError('Please select a start time.'); return; }
    if (!endTime) { setError('Please select an end time.'); return; }
    if (!equipment) { setError('Please select an equipment option.'); return; }
    if (!isEquipmentSupported) {
      setError('This DJ isn\'t able to bring that equipment. Please pick another option.');
      return;
    }
    if (isOffers && !offerAmount.trim()) {
      setError('Please enter your offer amount.');
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const offerNum = offerAmount ? Number(offerAmount) : null;

      // For flat-rate bookings, rateInfo.rate IS the total. For hourly
      // bookings, the total is rate × hours (rateInfo.hourlyTotal). The
      // booking card and emails treat quoted_rate as the FULL price
      // agreed for the gig, so we save the computed total here — saving
      // the per-hour rate to quoted_rate would make the card display
      // $400 instead of $1400 for a 3.5-hour booking at $400/hr.
      const computedTotal = !isOffers && rateInfo.rate
        ? (rateInfo.rateType === 'hourly' && rateInfo.hourlyTotal
            ? rateInfo.hourlyTotal
            : rateInfo.rate)
        : null;

      // Initial negotiation log entry. We seed the log at insert time so
      // the booking-requests history modal can replay the full thread —
      // CounterModal already appends to this column on each counter, but
      // the FIRST price (booker's offer or flat-rate accept) was never
      // recorded until now. Quote-mode bookings have no price yet and
      // get an empty log; sendDraftQuote will seed it later.
      const initialPrice = isOffers && offerNum && !isNaN(offerNum)
        ? offerNum
        : computedTotal;
      const initialLog: Array<{ from: 'dj' | 'booker'; amount: number; message: string; created_at: string }> =
        initialPrice != null
          ? [{
              from: 'booker' as const,
              amount: initialPrice,
              message: notes.trim() || '',
              created_at: new Date().toISOString(),
            }]
          : [];

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
        phone: phone.trim(),
        // Coords from a Nominatim suggestion the booker picked. Null when
        // they typed freehand or the search returned nothing. The
        // booking-requests card uses these for the venue distance check.
        venue_lat: venueCoordsRef.current?.lat ?? null,
        venue_lon: venueCoordsRef.current?.lon ?? null,
        start_time: startTime,
        end_time: endTime,
        equipment,
        venue_equip_detail: venueEquipDetail.trim() || null,
        offer_amount: isOffers && offerNum && !isNaN(offerNum) ? offerNum : null,
        // Full computed total — see computedTotal derivation above.
        // For flat: per-event rate. For hourly: rate × hours. For offers:
        // null — there's no quoted rate, only the visitor's offer.
        quoted_rate: computedTotal,
        currency: rateInfo.currency,
        notes: notes.trim() || null,
        // is_quote=true when DJ has booking enabled but hasn't set rates
        // for this equipment option. The DJ will respond with a custom
        // rate via the existing counter flow on the booking-requests page.
        is_quote: isQuoteMode,
        negotiation_log: initialLog,
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
                {CLUB_VENUE_TYPE_LABELS[v]}
              </button>
            ))}
          </div>
        </FormSection>

        {/* Set Type — only after venue type picked */}
        {venueType && (
          <FormSection label="Set Type">
            <div className={styles.pillCol}>
              {Object.entries(CLUB_SET_TYPE_LABELS).map(([val, lbl]) => (
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
          {/* Country sits between venue name and address so picking it
              first scopes the address autocomplete to that country. */}
          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              // Suggestions + picked coords were country-scoped, so they're
              // stale now. Clear them so the booker re-searches under the
              // new country before they pick a result.
              setAddrSuggestions([]);
              setShowAddrSuggestions(false);
              venueCoordsRef.current = null;
            }}
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
          {/* Venue Address — Nominatim autocomplete dropdown.
              Coords from a picked suggestion are stored in the ref so
              they can be sent with the booking insert (DJ uses them
              for distance check on the booking-requests card). */}
          <div style={{ position: 'relative', marginTop: '.5rem' }}>
            <input
              type="text"
              placeholder="Venue address"
              value={venueAddress}
              onChange={(e) => {
                const val = e.target.value;
                setVenueAddress(val);
                // User edited again — invalidate previously picked coords
                venueCoordsRef.current = null;
                // Debounce the Nominatim fetch (matches MobileBookingForm)
                if (addrTimerRef.current) clearTimeout(addrTimerRef.current);
                if (val.trim().length < 3) {
                  setAddrSuggestions([]);
                  setShowAddrSuggestions(false);
                  return;
                }
                addrTimerRef.current = setTimeout(async () => {
                  const results = await searchAddresses(val.trim(), country);
                  setAddrSuggestions(results);
                  setShowAddrSuggestions(results.length > 0);
                }, 350);
              }}
              onBlur={() => {
                // Delay so a click on a suggestion fires before we hide
                setTimeout(() => setShowAddrSuggestions(false), 150);
              }}
              onFocus={() => {
                if (addrSuggestions.length > 0) setShowAddrSuggestions(true);
              }}
              className={styles.input}
              autoComplete="off"
            />
            {showAddrSuggestions && addrSuggestions.length > 0 && (
              <div className={styles.addrSuggestions}>
                {addrSuggestions.map((s, i) => (
                  <div
                    key={i}
                    className={styles.addrSuggestion}
                    // onMouseDown not onClick — fires before the input's
                    // onBlur, so the dropdown isn't dismissed first.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setVenueAddress(s.display);
                      if (s.lat != null && s.lon != null) {
                        venueCoordsRef.current = { lat: s.lat, lon: s.lon };
                      } else {
                        venueCoordsRef.current = null;
                      }
                      setShowAddrSuggestions(false);
                    }}
                  >
                    {s.display}
                  </div>
                ))}
              </div>
            )}
          </div>
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
                  <option key={t.val} value={t.val}>{t.label}</option>
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
                  <option key={t.val} value={t.val}>{t.label}</option>
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
        <FormSection label="Equipment for venue">
          <div className={styles.pillCol}>
            {equipmentOptions.map((opt) => {
              const isActive = equipment === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEquipment(opt.value)}
                  className={`${styles.pillWide} ${isActive ? styles.pillActive : ''} ${
                    !opt.supported ? styles.pillUnsupported : ''
                  }`}
                  // Always allow click — the warning below explains the
                  // problem rather than silently disabling the option,
                  // which matches the requested UX.
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Inline warning when the booker picks something the DJ can't
              fulfill. Message names the DJ + the gear they can't bring,
              so the user knows exactly what's not possible. Submitting
              is blocked too — see handleSubmit. */}
          {equipment && !isEquipmentSupported && (
            <div className={styles.equipWarning}>
              {dj.name || 'This DJ'} is unable to provide{' '}
              {equipment === 'sound_system'
                ? 'a full sound system and decks'
                : 'decks/controller'}
              . Please pick a different option below.
            </div>
          )}

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

        {/* Rate display — only when the picked equipment is something the
            DJ actually supports. If unsupported, the warning above tells
            the booker why no rate is shown. In quote mode (DJ has no rate
            configured for the picked equipment), the entire section is
            skipped per spec — booker sees the same form layout with no
            price shown, and the booking is flagged is_quote=true on submit
            so the DJ supplies the rate via the existing counter flow. */}
        {canShowRate && isEquipmentSupported && !isQuoteMode && (
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

        {/* Phone — collected so the DJ can reach the booker about
            day-of logistics. Same US-style auto-formatter mobile uses. */}
        <FormSection label="Phone Number">
          <input
            id="cbf-phone"
            type="tel"
            inputMode="tel"
            placeholder="(555) 555-5555"
            value={phone}
            onChange={(e) => setPhone(formatUSPhone(e.target.value))}
            className={styles.input}
            autoComplete="tel"
          />
        </FormSection>

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
