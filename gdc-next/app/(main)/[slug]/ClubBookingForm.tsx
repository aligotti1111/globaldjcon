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

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

  // Pick the correct rate for this equipment AND rate type.
  // Day-level overrides win — when present, the day's rate fields take
  // priority over the DJ's universal rates. This lets the DJ promote a
  // special rate for a specific date (e.g. high-demand Saturday) without
  // changing their default rates.
  // Hourly mode reads the rate_hourly_* fields; flat mode reads the
  // rate_* (flat) fields. They're independent — a DJ who has flat values
  // set but switches to hourly without entering hourly values will show
  // no rate for hourly until they configure them.
  if (baseType !== 'offers') {
    let raw: number | string | null | undefined = null;
    const isHourly = baseType === 'hourly';
    // Day-level field name matching equipment + rateType
    const dayFlatKey = equipment === 'sound_system' ? 'rate_with_system'
      : equipment === 'decks_only' ? 'rate_with_decks'
      : equipment === 'venue_provides' ? 'rate_no_equip'
      : null;
    const dayHourlyKey = equipment === 'sound_system' ? 'rate_hourly_with_system'
      : equipment === 'decks_only' ? 'rate_hourly_with_decks'
      : equipment === 'venue_provides' ? 'rate_hourly_no_equip'
      : null;
    const dayKey = isHourly ? dayHourlyKey : dayFlatKey;
    const dayRaw = dayKey ? (dayData as DayData & Record<string, number | string | undefined>)[dayKey] : undefined;
    if (dayRaw != null && dayRaw !== '') {
      raw = dayRaw;
    } else {
      // Fall back to global rate
      if (equipment === 'sound_system') {
        raw = isHourly ? bs.rate_hourly_with_system : bs.rate_with_system;
      } else if (equipment === 'decks_only') {
        raw = isHourly ? bs.rate_hourly_with_decks : bs.rate_with_decks;
      } else if (equipment === 'venue_provides') {
        raw = isHourly ? bs.rate_hourly_no_equip : bs.rate_no_equip;
      }
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

  // Approved bookings already on this date for this DJ. Shown in red
  // under Set Times so the customer can see what's already booked.
  // Fetched via /api/dj-booked-sets — a customer's anon session can't
  // read another user's bookings directly (RLS), so the server route
  // returns just the time ranges. Pending requests are excluded.
  const [bookedSets, setBookedSets] = useState<Array<{ start: string | null; end: string | null }>>([]);
  useEffect(() => {
    if (!dateKey || !dj?.id) { setBookedSets([]); return; }
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/dj-booked-sets?djId=${encodeURIComponent(dj.id)}&date=${encodeURIComponent(dateKey)}`,
        );
        if (!res.ok) { if (active) setBookedSets([]); return; }
        const json = await res.json();
        if (!active) return;
        setBookedSets(Array.isArray(json.sets) ? json.sets : []);
      } catch {
        if (active) setBookedSets([]);
      }
    })();
    return () => { active = false; };
  }, [dateKey, dj?.id]);

  // Booked sets whose time range overlaps the customer's chosen Set
  // Start/End. Times are "HH:MM"; an end at/before start wraps midnight.
  const overlappingSets = useMemo(() => {
    if (!startTime || !endTime || bookedSets.length === 0) return [];
    const toRange = (s: string | null, e: string | null): [number, number] | null => {
      if (!s || !e) return null;
      const [sh, sm] = s.split(':').map(Number);
      const [eh, em] = e.split(':').map(Number);
      if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
      const start = sh * 60 + sm;
      let end = eh * 60 + em;
      if (end <= start) end += 24 * 60;
      return [start, end];
    };
    const mine = toRange(startTime, endTime);
    if (!mine) return [];
    return bookedSets.filter((b) => {
      const r = toRange(b.start, b.end);
      if (!r) return false;
      return mine[0] < r[1] && r[0] < mine[1];
    });
  }, [startTime, endTime, bookedSets]);

  // ── SSR-safe portal flag — Next.js renders on server where document
  // doesn't exist. Render null until mounted, then portal to body so
  // the modal escapes any parent stacking context. ──────────────────
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ── Address autocomplete (Nominatim) ─────────────────────────────
  // Suggestions are fetched debounced (350ms) when the user has typed
  // 3+ chars. Coords from a picked suggestion stick on a ref so we can
  // include them in the booking insert (DJ uses them for distance check).
  const [addrSuggestions, setAddrSuggestions] = useState<AddressSuggestion[]>([]);
  const [showAddrSuggestions, setShowAddrSuggestions] = useState(false);
  const addrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const venueCoordsRef = useRef<{ lat: number; lon: number } | null>(null);
  // True once an address is chosen from the autocomplete dropdown — used
  // (with a 10-char minimum) to decide when the address checkmark shows.
  const [addressPicked, setAddressPicked] = useState(false);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ── Field-level validation state ─────────────────────────────────
  // Tracks which required fields are missing after a submit attempt.
  // Used by FormSection (red label + inline error message) and inputs
  // (red border via inline style). Once the user starts typing/picking
  // in a flagged field, it's removed from this set so the highlight
  // clears immediately. Field IDs are arbitrary string keys.
  const [missingFields, setMissingFields] = useState<Set<string>>(new Set());
  function clearMissing(field: string) {
    setMissingFields((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  }
  // hasError(f) — true when this field is in the missing set. Inputs
  // call this to switch to the red border state.
  function hasError(field: string): boolean {
    return missingFields.has(field);
  }

  // ── Per-field "valid → show checkmark" flags ───────────────────────
  // Mirrors the mobile booking form: a green ✓ appears in a field once
  // its value is valid. Phone needs a real 10–15 digit number; text
  // fields need content (address needs 10+ chars or a dropdown pick);
  // time selects need a non-placeholder choice.
  const phoneValid = (() => {
    const d = phone.replace(/\D/g, '');
    return d.length >= 10 && d.length <= 15;
  })();
  const venueNameValid = venueName.trim() !== '';
  const venueAddressValid = addressPicked || venueAddress.trim().length >= 10;
  const startTimeValid = startTime !== '';
  const endTimeValid = endTime !== '';

  // Set duration — computed straight from the picked times so it shows
  // whenever both are selected, regardless of rate type. Times are
  // "HH:MM" 24h; an end at/before start wraps past midnight.
  const setDurationLabel = (() => {
    if (!startTime || !endTime) return null;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const hPart = h > 0 ? `${h} hr${h !== 1 ? 's' : ''}` : '';
    const mPart = m > 0 ? `${m} min` : '';
    return [hPart, mPart].filter(Boolean).join(' ');
  })();

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
        label: 'DJ Provides System + Decks',
        supported: !!bookingSettings.equip_full,
      },
      {
        value: 'decks_only',
        label: 'DJ Provides Decks',
        supported: !!(bookingSettings.equip_full || bookingSettings.equip_decks),
      },
      {
        value: 'venue_provides',
        label: 'Venue Provides All',
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

    // Collect ALL missing required fields up front so the booker sees
    // every problem at once instead of having to fix → submit → fix
    // each one. The set drives both the top-of-form summary and the
    // per-field red-border / inline-error highlights.
    const missing = new Set<string>();
    if (!venueType) missing.add('venueType');
    if (!setType) missing.add('setType');
    if (!venueName.trim()) missing.add('venueName');
    if (!venueAddress.trim()) missing.add('venueAddress');
    if (!phone.trim()) missing.add('phone');
    if (!startTime) missing.add('startTime');
    if (!endTime) missing.add('endTime');
    if (!equipment) missing.add('equipment');
    if (isOffers && !offerAmount.trim()) missing.add('offerAmount');

    if (missing.size > 0) {
      setMissingFields(missing);
      // Top-of-form banner reads directly from missingFields.size — no
      // duplicate error text. setError stays null so the bottom area
      // remains clean (it's reserved for non-field errors like the
      // equipment compatibility check or network failures).
      // Scroll the first missing field into view so the booker isn't
      // confused about WHERE the highlights are.
      const firstFieldId = (() => {
        // Order matches the form layout top → bottom for natural scroll
        const order = ['venueType','setType','venueName','venueAddress','phone','startTime','endTime','equipment','offerAmount'];
        for (const f of order) {
          if (missing.has(f)) return f;
        }
        return null;
      })();
      if (firstFieldId) {
        // Defer to next paint so the new error UI is in the DOM
        setTimeout(() => {
          const el = document.querySelector(`[data-field="${firstFieldId}"]`);
          if (el && 'scrollIntoView' in el) {
            (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 50);
      }
      return;
    }

    // Equipment-supported check happens AFTER all required fields are
    // filled — it's not a "missing field" in the same sense, more a
    // compatibility error, so keep it as a top-level error message.
    if (!isEquipmentSupported) {
      setError('This DJ isn\'t able to bring that equipment. Please pick another option.');
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
            // Per-hour rate — only meaningful for hourly bookings; lets the
            // email show "$330/hr × 3 hr" alongside the total.
            hourlyRate: rateInfo.rateType === 'hourly' ? rateInfo.rate : null,
            currency: rateInfo.currency,
          }),
        });
      } catch {
        // Email is best-effort; ignore failures
      }

      // Confirmation copy to the booker — gives them a record of the
      // request they just sent and confirms it landed. Same info-card
      // layout as the DJ-side notification for visual consistency.
      try {
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'booking_request_confirmation',
            requesterUserId: currentUser.id,
            requesterName: currentUser.name,
            djName: dj.name,
            eventDate: dateKey,
            venueName: venueName.trim(),
            venueAddress: venueAddress.trim(),
            venueType,
            setType,
            startTime,
            endTime,
            equipment,
            offerAmount: insertPayload.offer_amount,
            quotedRate: insertPayload.quoted_rate,
            totalHours: rateInfo.hours,
            hourlyRate: rateInfo.rateType === 'hourly' ? rateInfo.rate : null,
            currency: rateInfo.currency,
          }),
        });
      } catch {
        // Best-effort
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
    if (!mounted) return null;
    return createPortal(
      <div className={styles.formWrap}>
        <div className={styles.successCard}>
          <div className={styles.successIcon}>✓</div>
          <div className={styles.successTitle}>Booking request sent!</div>
          <div className={styles.successBody}>
            We&apos;ve sent your request to {dj.name || 'the DJ'}.
            They&apos;ll be in touch shortly.
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Form UI ──────────────────────────────────────────────────────
  if (!mounted) return null;
  return createPortal(
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

        {/* Top-of-form summary for missing-required-fields validation.
            The booker needs to see this BEFORE scrolling through the
            fields, since the inline highlights are below. Non-field
            errors (equipment-not-supported, submit network failures)
            still render in the submit area below. */}
        {missingFields.size > 0 && (
          <div style={{
            background: 'rgba(255, 95, 95, .08)',
            border: '1px solid rgba(255, 95, 95, .35)',
            borderRadius: 6,
            padding: '.6rem .8rem',
            color: '#ff5f5f',
            fontSize: '.82rem',
            fontFamily: 'DM Sans, sans-serif',
            marginBottom: '.75rem',
          }}>
            {missingFields.size === 1
              ? 'Please complete the highlighted field below.'
              : `Please complete the ${missingFields.size} highlighted fields below.`}
          </div>
        )}

        {/* Event Type */}
        <FormSection
          label="Event Type"
          fieldKey="venueType"
          hasError={hasError('venueType')}
          errorText="Please select Bar or Club."
          showCheck={venueType !== ''}
        >
          <div className={styles.pillRow}>
            {(['bar', 'club'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setVenueType(v); clearMissing('venueType'); }}
                className={`${styles.pill} ${venueType === v ? styles.pillActive : ''}`}
              >
                {CLUB_VENUE_TYPE_LABELS[v]}
              </button>
            ))}
          </div>
        </FormSection>

        {/* Set Type — only after venue type picked */}
        {venueType && (
          <FormSection
            label="Set Type"
            fieldKey="setType"
            hasError={hasError('setType')}
            errorText="Please select a set type."
          >
            <FieldCheck valid={setType !== ''}>
              <select
                value={setType}
                onChange={(e) => { setSetType(e.target.value); clearMissing('setType'); }}
                className={`${styles.input} ${styles.hasCheckSelect}`}
                style={hasError('setType') ? { borderColor: '#ff5f5f' } : undefined}
              >
                <option value="">Select…</option>
                {Object.entries(CLUB_SET_TYPE_LABELS).map(([val, lbl]) => (
                  <option key={val} value={val}>{lbl}</option>
                ))}
              </select>
            </FieldCheck>
          </FormSection>
        )}

        {/* Venue */}
        <FormSection
          label="Venue"
          fieldKey="venueName"
          hasError={hasError('venueName') || hasError('venueAddress')}
          errorText={
            hasError('venueName') && hasError('venueAddress')
              ? 'Please enter the venue name and address.'
              : hasError('venueName')
                ? 'Please enter the venue name.'
                : 'Please enter the venue address.'
          }
        >
          <FieldCheck valid={venueNameValid}>
            <input
              type="text"
              placeholder="Venue name"
              value={venueName}
              onChange={(e) => { setVenueName(e.target.value); clearMissing('venueName'); }}
              className={`${styles.input} ${styles.hasCheck}`}
              style={hasError('venueName') ? { borderColor: '#ff5f5f' } : undefined}
            />
          </FieldCheck>
          {/* Address with compact country picker pill on the right.
              Picking a country first scopes the address autocomplete. */}
          <div className={styles.addrRow} style={{ marginTop: '.5rem' }}>
            <div className={styles.addrInputWrap}>
              <input
                type="text"
                placeholder="Venue address"
                value={venueAddress}
                onChange={(e) => {
                  const val = e.target.value;
                  setVenueAddress(val);
                  clearMissing('venueAddress');
                  venueCoordsRef.current = null;
                  setAddressPicked(false);
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
                  setTimeout(() => setShowAddrSuggestions(false), 150);
                }}
                onFocus={() => {
                  if (addrSuggestions.length > 0) setShowAddrSuggestions(true);
                }}
                className={`${styles.input} ${styles.hasCheck}`}
                style={hasError('venueAddress') ? { borderColor: '#ff5f5f' } : undefined}
                autoComplete="off"
              />
              {venueAddressValid && (
                <span className={styles.fieldCheckMark} aria-hidden="true">✓</span>
              )}
              {showAddrSuggestions && addrSuggestions.length > 0 && (
                <div className={styles.addrSuggestions}>
                  {addrSuggestions.map((s, i) => (
                    <div
                      key={i}
                      className={styles.addrSuggestion}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setVenueAddress(s.display);
                        setAddressPicked(true);
                        if (s.lat != null && s.lon != null) {
                          venueCoordsRef.current = { lat: s.lat, lon: s.lon };
                        } else {
                          venueCoordsRef.current = null;
                        }
                        setShowAddrSuggestions(false);
                        clearMissing('venueAddress');
                      }}
                    >
                      {s.display}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <CountryPicker
              value={country}
              onChange={(code) => {
                setCountry(code);
                setAddrSuggestions([]);
                setShowAddrSuggestions(false);
                venueCoordsRef.current = null;
              }}
            />
          </div>
        </FormSection>

        {/* Times */}
        <FormSection
          label="Set Times"
          fieldKey="startTime"
          hasError={hasError('startTime') || hasError('endTime')}
          errorText={
            hasError('startTime') && hasError('endTime')
              ? 'Please select start and end times.'
              : hasError('startTime')
                ? 'Please select a start time.'
                : 'Please select an end time.'
          }
        >
          <div className={styles.timeRow}>
            <div className={styles.timeCol}>
              <label className={styles.timeLabel}><span className={styles.timeLabelHl}>Set</span> Start</label>
              <FieldCheck valid={startTimeValid}>
                <select
                  value={startTime}
                  onChange={(e) => { setStartTime(e.target.value); clearMissing('startTime'); }}
                  className={`${styles.input} ${styles.hasCheckSelect}`}
                  style={hasError('startTime') ? { borderColor: '#ff5f5f' } : undefined}
                >
                  <option value="">Select…</option>
                  {MOB_TIME_OPTIONS.map((t) => (
                    <option key={t.val} value={t.val}>{t.label}</option>
                  ))}
                </select>
              </FieldCheck>
            </div>
            <div className={styles.timeCol}>
              <label className={styles.timeLabel}><span className={styles.timeLabelHl}>Set</span> End</label>
              <FieldCheck valid={endTimeValid}>
                <select
                  value={endTime}
                  onChange={(e) => { setEndTime(e.target.value); clearMissing('endTime'); }}
                  className={`${styles.input} ${styles.hasCheckSelect}`}
                  style={hasError('endTime') ? { borderColor: '#ff5f5f' } : undefined}
                >
                  <option value="">Select…</option>
                  {MOB_TIME_OPTIONS.map((t) => (
                    <option key={t.val} value={t.val}>{t.label}</option>
                  ))}
                </select>
              </FieldCheck>
            </div>
          </div>
          {/* Set duration — shows as soon as both times are picked. */}
          {setDurationLabel && (
            <div className={styles.durationHint}>
              {formatTime12(startTime)} → {formatTime12(endTime)} ({setDurationLabel})
            </div>
          )}
          {/* Overlap warning — chosen times collide with a booked set.
              Heads-up only; the booking is still allowed to go through. */}
          {overlappingSets.map((b, i) => (
            <div key={`ov-${i}`} className={styles.overlapWarn}>
              Chosen Time Overlaps {formatTime12(b.start || '')} – {formatTime12(b.end || '')} Booking
            </div>
          ))}
        </FormSection>

        {/* Equipment */}
        <FormSection
          label="Equipment for venue"
          fieldKey="equipment"
          hasError={hasError('equipment')}
          errorText="Please select an equipment option."
          showCheck={equipment !== ''}
        >
          <div className={styles.equipCol}>
            {equipmentOptions.map((opt) => {
              const isActive = equipment === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setEquipment(opt.value); clearMissing('equipment'); }}
                  className={`${styles.equipBtn} ${isActive ? styles.pillActive : ''} ${
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

        {/* Rate — always rendered. Inside, the content branches on form
            completeness: a calculating placeholder while required fields
            are missing, a quote-mode message when the DJ has no rate for
            the picked equipment, an equipment-unsupported notice, or the
            real rate display when everything's filled in. */}
        <FormSection
          label="Rate"
          fieldKey="offerAmount"
          hasError={isOffers && hasError('offerAmount')}
          errorText="Please enter your offer amount."
        >
          {(() => {
            // Path 1 — full rate display ready to render
            if (canShowRate && isEquipmentSupported && !isQuoteMode) {
              return (
                <RateDisplay
                  info={rateInfo}
                  allowOffers={allowOffers && !isOffers}
                  isOffersOnly={isOffers}
                  offerAmount={offerAmount}
                  setOfferAmount={(v) => { setOfferAmount(v); clearMissing('offerAmount'); }}
                  offerHasError={isOffers && hasError('offerAmount')}
                  baseRate={
                    (dayData as DayData & { base_rate?: number | string }).base_rate
                      || bookingSettings.base_rate
                      || rateInfo.rate
                  }
                />
              );
            }
            // Path 2 — DJ has no rate configured for this equipment.
            // Booking goes through as a quote; DJ replies with custom
            // pricing through the counter flow.
            if (equipment && isEquipmentSupported && isQuoteMode) {
              return (
                <div className={styles.rateBox}>
                  <div className={styles.rateOffersHint}>
                    Rate not yet configured for this option — the DJ will
                    reply with a quote after you submit.
                  </div>
                </div>
              );
            }
            // Path 3 — equipment picked but DJ can't bring it. The
            // pillUnsupported warning above already explains; just keep
            // the rate box empty-stated here.
            if (equipment && !isEquipmentSupported) {
              return (
                <div className={styles.rateBox}>
                  <div className={styles.rateOffersHint} style={{ color: 'var(--amber)' }}>
                    Pick a supported equipment option above to see the rate.
                  </div>
                </div>
              );
            }
            // Path 4 — required fields aren't all filled yet. Show a
            // calm, static "we're waiting on you" message so the booker
            // knows the price will appear here. No animation.
            return (
              <div className={styles.rateBox}>
                <div style={{
                  padding: '1.1rem .5rem',
                  textAlign: 'center',
                }}>
                  <div style={{
                    color: 'var(--neon)',
                    fontSize: '.8rem',
                    lineHeight: 1.5,
                    fontFamily: 'DM Sans, sans-serif',
                  }}>
                    Once all required fields are populated, the estimated
                    price will display here.
                  </div>
                </div>
              </div>
            );
          })()}
        </FormSection>

        {/* Phone — collected so the DJ can reach the booker about
            day-of logistics. Same US-style auto-formatter mobile uses. */}
        <FormSection
          label="Phone Number"
          fieldKey="phone"
          hasError={hasError('phone')}
          errorText="Please enter your phone number."
        >
          <FieldCheck valid={phoneValid}>
            <input
              id="cbf-phone"
              type="tel"
              inputMode="tel"
              placeholder="(555) 555-5555"
              value={phone}
              onChange={(e) => { setPhone(formatUSPhone(e.target.value)); clearMissing('phone'); }}
              className={`${styles.input} ${styles.hasCheck}`}
              style={hasError('phone') ? { borderColor: '#ff5f5f' } : undefined}
              autoComplete="tel"
            />
          </FieldCheck>
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
    </form>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FormSection — small wrapper that gives each section its own padded card
// row + label. Mirrors the look of the vanilla form.
// ─────────────────────────────────────────────────────────────────────────
function FormSection({
  label, children, hasError, fieldKey, errorText, showCheck,
}: {
  label: string;
  children: React.ReactNode;
  // When true, label turns red. Set by parent based on missing-fields set.
  hasError?: boolean;
  // Used by handleSubmit's scroll-to-first-error logic to find the section.
  fieldKey?: string;
  // Optional inline message rendered below children when hasError is true.
  errorText?: string;
  // When true, a green ✓ shows on the label line — used for pill-based
  // sections (Event Type, Set Type) where the check can't sit in a field.
  showCheck?: boolean;
}) {
  return (
    <div className={styles.section} data-field={fieldKey}>
      <div
        className={styles.sectionLabel}
        style={
          hasError
            ? { color: '#ff5f5f' }
            : showCheck
              ? { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
              : undefined
        }
      >
        <span>{label}{hasError && ' *'}</span>
        {showCheck && !hasError && (
          <span className={styles.labelCheckMark} aria-hidden="true">✓</span>
        )}
      </div>
      {children}
      {hasError && errorText && (
        <div style={{
          marginTop: '.4rem',
          color: '#ff5f5f',
          fontSize: '.78rem',
          fontFamily: 'DM Sans, sans-serif',
        }}>
          {errorText}
        </div>
      )}
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
  offerHasError,
  baseRate,
}: {
  info: RateInfo;
  allowOffers: boolean;
  isOffersOnly: boolean;
  offerAmount: string;
  setOfferAmount: (v: string) => void;
  offerHasError?: boolean;
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
            style={offerHasError ? { borderColor: '#ff5f5f' } : undefined}
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

// ──────────────────────────────────────────────────────────────────────────
// CountryPicker — compact flag + ISO-code pill that opens a dropdown
// for picking the country that scopes address autocomplete.
// ──────────────────────────────────────────────────────────────────────────
const COUNTRIES: { code: string; name: string; flag: string }[] = [
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
  { code: 'AE', name: 'UAE', flag: '🇦🇪' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭' },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪' },
];

function CountryPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  const sel = COUNTRIES.find((c) => c.code === value) || COUNTRIES[0];

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: '0 0 auto' }}>
      <div
        className={styles.countryPill}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        title="Filter by country"
      >
        <span className={styles.flag}>{sel.flag}</span>
        <span className={styles.code}>{sel.code}</span>
        <span className={styles.caret}>▾</span>
      </div>
      {open && (
        <div className={styles.countryPopover}>
          {COUNTRIES.map((c) => (
            <div
              key={c.code}
              className={`${styles.countryItem} ${c.code === value ? styles.countryItemActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(c.code);
                setOpen(false);
              }}
            >
              <span className={styles.flag}>{c.flag}</span>
              <span className={styles.name}>{c.name}</span>
              <span className={styles.code}>{c.code}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// FieldCheck — wraps a form control and shows a green ✓ at its right edge
// once `valid` is true. Matches the mobile booking form's checkmark. The
// wrapper is position:relative; the control gets .hasCheck (text inputs)
// or .hasCheckSelect (native selects) so its text clears the mark.
function FieldCheck({
  valid,
  children,
}: {
  valid: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.fieldCheckWrap}>
      {children}
      {valid && (
        <span className={styles.fieldCheckMark} aria-hidden="true">✓</span>
      )}
    </div>
  );
}
