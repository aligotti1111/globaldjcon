'use client';

// ManualBookingForm — reusable form for creating or editing a manual booking.
//
// Used in two places:
//   1. /upcoming-bookings (inside a modal — see AddManualBookingModal wrapper)
//   2. /[slug] OwnerDayEditPopup (inline, when status is "Booked")
//
// Caller controls the surrounding chrome (modal vs inline). This component
// owns only the form fields, validation, save logic, and host-invite flow.
//
// Behaviour summary:
//   - Save inserts (no existing) or updates (existing) into the bookings
//     table with is_manual=true, status=approved.
//   - Daily cap: club = 1/day, mobile = bookings_per_day. Soft confirm.
//   - Host email + optional "send invite" checkbox. Edit mode shows
//     sent-state + Resend if email already went out.
//   - Calls onAdded/onUpdated when done so the caller can refresh state.

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { searchAddresses, EVENT_SUBFIELDS, buildEventDetails, MOB_EVENT_TYPE_LABELS } from './mobileBookingForm';
import { COUNTRIES, COUNTRY_CODES_ADDR } from '../account-settings/helpers';
import styles from './manualBookingForm.module.css';

export interface ManualBookingRow {
  id: string;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_lat: number | null;
  venue_lon: number | null;
  venue_type: string | null;
  set_type: string | null;
  event_type: string | null;
  event_details?: string | null;
  booking_type: string | null;
  is_manual: boolean;
  host_email?: string | null;
  host_email_sent_at?: string | null;
  link_url?: string | null;
  link_label?: string | null;
}

interface Props {
  userId: string;
  djType: 'club' | 'mobile';
  djCountry: string;
  djName: string;
  bookingsPerDay: number;
  // All bookings on this DJ's schedule. Used for daily-cap conflict check.
  // Caller should pass minimum: { id, event_date } for each row.
  existingBookings: Array<{ id: string; event_date: string | null; status: string | null }>;
  existing: ManualBookingRow | null;
  prefillDate?: string;
  // Lock the date input — used when this form is rendered inside a calendar
  // day-edit context where the date is already determined.
  lockDate?: boolean;
  onSaved: (row: ManualBookingRow, mode: 'added' | 'updated') => void;
  onCancel?: () => void;
}

// Mobile event types — kept in sync with the public booking-request form
// (and EVENT_SUBFIELDS) by deriving from the canonical label map. Ensures
// the same options + conditional sub-fields appear in both places.
const MOBILE_EVENT_TYPES: Array<{ value: string; label: string }> =
  Object.entries(MOB_EVENT_TYPE_LABELS).map(([value, label]) => ({ value, label }));

const CLUB_VENUE_TYPES: Array<{ value: string; label: string }> = [
  { value: 'bar', label: 'Bar' },
  { value: 'club', label: 'Club' },
];

const CLUB_SET_TYPES: Array<{ value: string; label: string }> = [
  { value: 'opening', label: 'Opening' },
  { value: 'headliner', label: 'Headliner' },
  { value: 'closing', label: 'Closing' },
  { value: 'opening_and_closing', label: 'Opening + Closing' },
];

const TIME_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      const value = `${hh}:${mm}`;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = ((h % 12) || 12);
      const label = `${h12}:${mm} ${ampm}`;
      out.push({ value, label });
    }
  }
  return out;
})();

// Convert a 2-letter ISO country code to its flag emoji. A flag emoji is
// just the country's two letters expressed as Unicode regional-indicator
// symbols, so no lookup table is needed.
function flagEmoji(code: string): string {
  const cc = (code || '').trim().toUpperCase();
  if (cc.length !== 2 || !/^[A-Z]{2}$/.test(cc)) return '';
  const base = 0x1f1e6; // regional indicator 'A'
  return String.fromCodePoint(
    base + (cc.charCodeAt(0) - 65),
    base + (cc.charCodeAt(1) - 65),
  );
}

export default function ManualBookingForm({
  userId, djType, djCountry, djName, bookingsPerDay, existingBookings,
  existing, prefillDate, lockDate, onSaved, onCancel,
}: Props) {
  const isEdit = existing !== null;

  function trimTime(t: string | null): string {
    if (!t) return '';
    return t.length >= 5 ? t.slice(0, 5) : t;
  }
  const [eventDate, setEventDate] = useState(existing?.event_date || prefillDate || '');
  const [startTime, setStartTime] = useState(trimTime(existing?.start_time || null));
  const [endTime, setEndTime] = useState(trimTime(existing?.end_time || null));
  const [venueName, setVenueName] = useState(existing?.venue_name || '');
  const [venueAddress, setVenueAddress] = useState(existing?.venue_address || '');
  const [country, setCountry] = useState<string>(djCountry || 'United States');
  const [venueType, setVenueType] = useState<string>(existing?.venue_type || '');
  const [setType, setSetType] = useState<string>(existing?.set_type || '');
  const [eventType, setEventType] = useState<string>(existing?.event_type || 'weddings');
  // Event-type-specific sub-fields, mirrored from the booking-request form.
  // Pre-fill from an existing booking's event_details so edits round-trip:
  // for the six text types event_details IS the value; for birthday we parse
  // the composed "Guest of honor age: X · Surprise party: Yes" string.
  const initEd = existing?.event_details || '';
  const initBirthday = existing?.event_type === 'birthday';
  const [eventSubType, setEventSubType] = useState<string>(
    initBirthday ? '' : (EVENT_SUBFIELDS[existing?.event_type || ''] ? initEd : '')
  );
  const [birthdayAge, setBirthdayAge] = useState<string>(
    initBirthday ? (initEd.match(/age:\s*([^·]+)/i)?.[1]?.trim() || '') : ''
  );
  const [surprise, setSurprise] = useState<boolean>(
    initBirthday ? /surprise party:\s*yes/i.test(initEd) : false
  );
  const eventTypeMounted = useRef(false);

  // Clear sub-fields when the user switches event type (but not on first
  // render, so an edit's pre-filled values survive mount).
  useEffect(() => {
    if (!eventTypeMounted.current) {
      eventTypeMounted.current = true;
      return;
    }
    setEventSubType('');
    setBirthdayAge('');
    setSurprise(false);
  }, [eventType]);
  const [hostEmail, setHostEmail] = useState<string>(existing?.host_email || '');
  const [sendInvite, setSendInvite] = useState<boolean>(false);
  // Optional flat rate the DJ charged/will charge for this gig. Stored as
  // offer_amount + currency so it flows through the same fields used by
  // the normal booking flow. Display-only on the booking record — purely
  // for the DJ's own bookkeeping.
  const [rate, setRate] = useState<string>(
    existing && (existing as { offer_amount?: number | null }).offer_amount != null
      ? String((existing as { offer_amount?: number | null }).offer_amount)
      : '',
  );
  const [rateCurrency, setRateCurrency] = useState<string>(
    (existing as { currency?: string | null } | null)?.currency || 'USD',
  );
  const hostEmailAlreadySent = !!existing?.host_email_sent_at;
  const [hostEmailSentAt, setHostEmailSentAt] = useState<string | null>(
    existing?.host_email_sent_at || null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  const [addrSuggestions, setAddrSuggestions] = useState<Array<{ display: string; lat: number | null; lon: number | null }>>([]);
  const [showAddrSuggestions, setShowAddrSuggestions] = useState(false);
  const addrTimerRef = useRef<NodeJS.Timeout | null>(null);
  const venueCoordsRef = useRef<{ lat: number; lon: number } | null>(
    existing?.venue_lat != null && existing?.venue_lon != null
      ? { lat: existing.venue_lat, lon: existing.venue_lon }
      : null,
  );

  const dateInputRef = useRef<HTMLInputElement>(null);
  const todayStr = new Date().toISOString().slice(0, 10);

  // True once an address is picked from the autocomplete dropdown — used
  // (with a 10-char minimum) to drive the address field's checkmark.
  const [addressPicked, setAddressPicked] = useState(
    existing?.venue_lat != null && existing?.venue_lon != null,
  );

  // ── Per-field "valid → show checkmark" flags ───────────────────────
  // A green ✓ shows in a field once its value is valid, matching the
  // mobile/club booking forms.
  const startTimeValid = startTime !== '';
  const venueNameValid = venueName.trim() !== '';
  const venueAddressValid = addressPicked || venueAddress.trim().length >= 10;
  const hostEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hostEmail.trim());

  // Set duration — computed from the picked times so it shows whenever
  // both are selected. Times are "HH:MM" 24h; an end at/before start
  // wraps past midnight.
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

  useEffect(() => () => { if (addrTimerRef.current) clearTimeout(addrTimerRef.current); }, []);

  function openDatePicker() {
    if (lockDate) return;
    const el = dateInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch { /* fall through */ }
    }
    el.focus();
  }

  async function sendHostInviteEmail(opts: {
    bookingId: string;
    recipientEmail: string;
    isResend: boolean;
    snapshot: {
      eventDate: string; startTime: string; endTime: string;
      venueName: string; venueAddress: string;
      venueType: string; setType: string; eventType: string;
    };
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'manual_booking_invite',
          hostEmail: opts.recipientEmail,
          djName,
          djType,
          bookingId: opts.bookingId,
          eventDate: opts.snapshot.eventDate,
          startTime: opts.snapshot.startTime,
          endTime: opts.snapshot.endTime || null,
          venueName: opts.snapshot.venueName || null,
          venueAddress: opts.snapshot.venueAddress || null,
          venueType: opts.snapshot.venueType || null,
          setType: opts.snapshot.setType || null,
          eventType: opts.snapshot.eventType || null,
          isResend: opts.isResend,
        }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'Email send failed' };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  }

  async function handleResend() {
    setResendBusy(true);
    setResendSuccess(false);
    setError(null);
    if (!existing) { setResendBusy(false); return; }
    const recipientEmail = (hostEmail || existing.host_email || '').trim();
    if (!recipientEmail || !recipientEmail.includes('@')) {
      setError('No valid host email on file to resend to.');
      setResendBusy(false);
      return;
    }
    const result = await sendHostInviteEmail({
      bookingId: existing.id,
      recipientEmail,
      isResend: true,
      snapshot: {
        eventDate, startTime, endTime, venueName, venueAddress,
        venueType, setType, eventType,
      },
    });
    if (!result.ok) {
      setError(result.error || 'Resend failed.');
      setResendBusy(false);
      return;
    }
    const supabase = createClient();
    const nowIso = new Date().toISOString();
    await supabase
      .from('bookings')
      .update({ host_email: recipientEmail, host_email_sent_at: nowIso } as unknown as never)
      .eq('id', existing.id)
      .eq('dj_id', userId);
    setHostEmailSentAt(nowIso);
    setResendSuccess(true);
    setResendBusy(false);
  }

  async function handleSave() {
    setError(null);
    if (!eventDate) { setError('Pick a date.'); return; }
    if (!startTime) { setError('Pick a start time.'); return; }
    if (djType === 'mobile' && !endTime) { setError('Pick an end time.'); return; }
    if (djType === 'club' && !venueName.trim()) { setError('Venue name is required.'); return; }

    // Conflict check. Club/bar DJs are one-per-day: warn if the date
    // already has an active booking — approved (a confirmed booking) or
    // pending/countered (a live request) — with a message matching which.
    // Mobile DJs use their configured per-day cap instead.
    const sameDayActive = existingBookings.filter(
      (b) =>
        b.event_date === eventDate
        && (!isEdit || b.id !== existing.id)
        && (b.status === 'approved' || b.status === 'pending' || b.status === 'countered'),
    );
    if (djType === 'club') {
      const hasApproved = sameDayActive.some((b) => b.status === 'approved');
      const hasPending = sameDayActive.some(
        (b) => b.status === 'pending' || b.status === 'countered',
      );
      if (hasApproved || hasPending) {
        const msg = hasApproved
          ? `You already have a confirmed booking on ${eventDate}. Club/bar DJs can only have one booking per day. Save anyway?`
          : `You have a pending booking request for ${eventDate} that hasn't been confirmed yet. Adding this booking won't cancel it. Save anyway?`;
        if (!confirm(msg)) return;
      }
    } else {
      const cap = Math.max(1, bookingsPerDay || 1);
      if (sameDayActive.length >= cap) {
        const msg = `You already have ${sameDayActive.length} booking(s) on ${eventDate} (your daily cap is ${cap}). Save anyway?`;
        if (!confirm(msg)) return;
      }
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const coords = venueCoordsRef.current;
      const trimmedEmail = hostEmail.trim();
      // Parse rate. Empty → null (don't save). Invalid → error.
      const rateTrimmed = rate.trim();
      let rateNum: number | null = null;
      if (rateTrimmed) {
        rateNum = Number(rateTrimmed);
        if (!Number.isFinite(rateNum) || rateNum < 0) {
          setError('Rate must be a positive number.');
          setSaving(false);
          return;
        }
      }
      const payload = {
        booking_type: djType,
        event_date: eventDate,
        start_time: startTime,
        end_time: endTime || null,
        venue_name: venueName.trim() || null,
        venue_address: venueAddress.trim() || null,
        venue_lat: coords?.lat ?? null,
        venue_lon: coords?.lon ?? null,
        venue_type: djType === 'club' ? (venueType || null) : null,
        set_type: djType === 'club' ? (setType || null) : null,
        event_type: djType === 'mobile' ? eventType : null,
        event_details: djType === 'mobile'
          ? buildEventDetails(eventType, { subType: eventSubType, birthdayAge, surprise })
          : null,
        host_email: trimmedEmail || null,
        offer_amount: rateNum,
        currency: rateNum != null ? rateCurrency : null,
      };
      const selectCols = 'id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, set_type, event_type, event_details, booking_type, is_manual, host_email, host_email_sent_at, link_url, link_label, offer_amount, currency';
      const shouldSend = sendInvite && !!trimmedEmail && trimmedEmail.includes('@') && !hostEmailAlreadySent;

      if (isEdit) {
        const { data, error: e } = await supabase
          .from('bookings')
          .update(payload as unknown as never)
          .eq('id', existing.id)
          .eq('dj_id', userId)
          .select(selectCols)
          .single();
        if (e) throw e;
        let updated = { ...(data as unknown as ManualBookingRow), is_manual: true };
        if (shouldSend) {
          const result = await sendHostInviteEmail({
            bookingId: existing.id,
            recipientEmail: trimmedEmail,
            isResend: false,
            snapshot: { eventDate, startTime, endTime, venueName, venueAddress, venueType, setType, eventType },
          });
          if (result.ok) {
            const nowIso = new Date().toISOString();
            await supabase
              .from('bookings')
              .update({ host_email_sent_at: nowIso } as unknown as never)
              .eq('id', existing.id)
              .eq('dj_id', userId);
            updated = { ...updated, host_email_sent_at: nowIso };
            setHostEmailSentAt(nowIso);
          } else {
            setError('Booking saved, but email failed: ' + (result.error || 'unknown'));
            setSaving(false);
            onSaved(updated, 'updated');
            return;
          }
        }
        onSaved(updated, 'updated');
      } else {
        const insertRow = {
          ...payload,
          dj_id: userId,
          requester_id: userId,
          is_manual: true,
          status: 'approved',
        };
        const { data, error: e } = await supabase
          .from('bookings')
          .insert(insertRow as unknown as never)
          .select(selectCols)
          .single();
        if (e) throw e;
        let inserted = { ...(data as unknown as ManualBookingRow), is_manual: true };
        if (shouldSend) {
          const result = await sendHostInviteEmail({
            bookingId: inserted.id,
            recipientEmail: trimmedEmail,
            isResend: false,
            snapshot: { eventDate, startTime, endTime, venueName, venueAddress, venueType, setType, eventType },
          });
          if (result.ok) {
            const nowIso = new Date().toISOString();
            await supabase
              .from('bookings')
              .update({ host_email_sent_at: nowIso } as unknown as never)
              .eq('id', inserted.id)
              .eq('dj_id', userId);
            inserted = { ...inserted, host_email_sent_at: nowIso };
          } else {
            setError('Booking saved, but email failed: ' + (result.error || 'unknown'));
            setSaving(false);
            onSaved(inserted, 'added');
            return;
          }
        }
        onSaved(inserted, 'added');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.form}>
      {/* Date — hidden when the date is locked by the caller (e.g. day-edit
          popup where the date is already shown in the modal header). */}
      {!lockDate && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Date</span>
          <div
            className={styles.dateWrap}
            onClick={openDatePicker}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDatePicker(); } }}
          >
            <input
              ref={dateInputRef}
              type="date"
              min={todayStr}
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className={styles.dateInput}
            />
          </div>
        </div>
      )}

      {/* Time */}
      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Start Time</span>
          <FieldCheck valid={startTimeValid}>
            <select value={startTime} onChange={(e) => setStartTime(e.target.value)} className={`${styles.input} ${styles.hasCheckSelect}`}>
              <option value="">Select…</option>
              {TIME_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </FieldCheck>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            End Time {djType === 'club' && <span className={styles.optional}>(optional)</span>}
          </span>
          <select value={endTime} onChange={(e) => setEndTime(e.target.value)} className={styles.input}>
            <option value="">Select…</option>
            {TIME_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
      </div>
      {/* Set duration — shows once both times are picked. */}
      {setDurationLabel && (
        <div className={styles.durationHint}>Duration: {setDurationLabel}</div>
      )}

      {/* Venue name + Rate on one line. Venue name takes the remaining
          width; the rate box is narrow (~5 chars). */}
      <div className={styles.venueRateRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            Venue Name {djType === 'mobile' && <span className={styles.optional}>(optional)</span>}
          </span>
          <FieldCheck valid={venueNameValid}>
            <input
              type="text"
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
              placeholder={djType === 'club' ? 'e.g. Black Velvet Lounge' : 'e.g. Riverside Park Pavilion'}
              className={`${styles.input} ${styles.hasCheck}`}
            />
          </FieldCheck>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            Rate <span className={styles.optional}>(optional)</span>
          </span>
          <div className={styles.rateRow}>
            <div className={styles.rateInputWrap}>
              <span className={styles.rateSymbol}>
                {rateCurrency === 'USD' ? '$' : rateCurrency === 'EUR' ? '€' : rateCurrency === 'GBP' ? '£' : rateCurrency === 'CAD' ? '$' : rateCurrency === 'AUD' ? '$' : rateCurrency}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="0"
                className={styles.rateInput}
              />
            </div>
            <select
              value={rateCurrency}
              onChange={(e) => setRateCurrency(e.target.value)}
              className={styles.rateCurrencySelect}
              aria-label="Currency"
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="CAD">CAD</option>
              <option value="AUD">AUD</option>
            </select>
          </div>
          <span className={styles.rateNote}>The rate is not shown publicly.</span>
        </label>
      </div>

      {/* Venue location (address + country) */}
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Venue Location</span>
        <div className={styles.addrRow}>
          <div className={styles.addrWrap}>
            <input
              type="text"
              value={venueAddress}
              onChange={(e) => {
                const val = e.target.value;
                setVenueAddress(val);
                venueCoordsRef.current = null;
                setAddressPicked(false);
                if (addrTimerRef.current) clearTimeout(addrTimerRef.current);
                if (val.trim().length < 3) {
                  setAddrSuggestions([]);
                  setShowAddrSuggestions(false);
                  return;
                }
                addrTimerRef.current = setTimeout(async () => {
                  const cc = COUNTRY_CODES_ADDR[country] || null;
                  const results = await searchAddresses(val.trim(), cc);
                  setAddrSuggestions(results);
                  setShowAddrSuggestions(results.length > 0);
                }, 350);
              }}
              onBlur={() => setTimeout(() => setShowAddrSuggestions(false), 150)}
              onFocus={() => { if (addrSuggestions.length > 0) setShowAddrSuggestions(true); }}
              placeholder="Start typing address…"
              className={`${styles.input} ${styles.hasCheck}`}
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
                    }}
                  >
                    {s.display}
                  </div>
                ))}
              </div>
            )}
          </div>
          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setAddrSuggestions([]);
              setShowAddrSuggestions(false);
              venueCoordsRef.current = null;
            }}
            className={styles.countrySelect}
            aria-label="Country for address search"
          >
            {COUNTRIES.filter((c) => c !== 'Other').map((c) => {
              const code = (COUNTRY_CODES_ADDR[c] || '').toUpperCase();
              const flag = flagEmoji(code);
              return (
                <option key={c} value={c}>
                  {flag ? `${flag} ` : ''}{code || '??'}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {/* Type-specific fields */}
      {djType === 'club' ? (
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Venue Type</span>
            <select value={venueType} onChange={(e) => setVenueType(e.target.value)} className={styles.input}>
              <option value="">Select…</option>
              {CLUB_VENUE_TYPES.map((v) => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Set Type</span>
            <select value={setType} onChange={(e) => setSetType(e.target.value)} className={styles.input}>
              <option value="">Select…</option>
              {CLUB_SET_TYPES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Event Type</span>
          <select value={eventType} onChange={(e) => setEventType(e.target.value)} className={styles.input}>
            {MOBILE_EVENT_TYPES.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </label>
      )}

      {/* Event-type-specific sub-fields — mirrors the public booking form. */}
      {djType === 'mobile' && EVENT_SUBFIELDS[eventType]?.textLabel && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{EVENT_SUBFIELDS[eventType].textLabel}</span>
          <input
            type="text"
            value={eventSubType}
            onChange={(e) => setEventSubType(e.target.value)}
            placeholder={EVENT_SUBFIELDS[eventType].textPlaceholder}
            className={styles.input}
            autoComplete="off"
          />
        </label>
      )}
      {djType === 'mobile' && EVENT_SUBFIELDS[eventType]?.isBirthday && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Guest of Honor Age?</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={birthdayAge}
              onChange={(e) => setBirthdayAge(e.target.value)}
              placeholder="e.g. 30"
              className={styles.input}
              style={{ width: '90px', flexShrink: 0 }}
              autoComplete="off"
            />
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '.55rem', cursor: 'pointer', fontSize: '.85rem' }}
            >
              <input
                type="checkbox"
                checked={surprise}
                onChange={(e) => setSurprise(e.target.checked)}
                style={{ width: 16, height: 16, flexShrink: 0, accentColor: 'var(--neon)', cursor: 'pointer' }}
              />
              Is this a Surprise Party?
            </label>
          </div>
        </div>
      )}

      {/* Host invite section */}
      <div className={styles.hostInviteBlock}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Host Email {hostEmailAlreadySent && <span className={styles.optional}>(sent)</span>}</span>
          <FieldCheck valid={hostEmailValid}>
            <input
              type="email"
              value={hostEmail}
              onChange={(e) => setHostEmail(e.target.value)}
              placeholder="host@example.com"
              className={`${styles.input} ${styles.hasCheck}`}
              autoComplete="off"
            />
          </FieldCheck>
        </label>
        {hostEmailAlreadySent ? (
          <div className={styles.sentBanner}>
            <div className={styles.sentBannerText}>
              Booking details sent {hostEmailSentAt ? `on ${formatSentDate(hostEmailSentAt)}` : ''}.
            </div>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendBusy || saving}
              className={styles.resendBtn}
            >
              {resendBusy ? 'Sending…' : (resendSuccess ? 'Sent ✓' : 'Resend Email')}
            </button>
          </div>
        ) : (
          <label className={styles.inviteCheckRow}>
            <input
              type="checkbox"
              checked={sendInvite}
              onChange={(e) => setSendInvite(e.target.checked)}
              disabled={!hostEmail.trim() || !hostEmail.includes('@')}
            />
            <span>
              Send booking details to host
              {(!hostEmail.trim() || !hostEmail.includes('@')) && (
                <span className={styles.checkHint}> · enter a valid email first</span>
              )}
            </span>
          </label>
        )}
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.actions}>
        {onCancel && (
          <button type="button" onClick={onCancel} className={styles.cancelBtn} disabled={saving}>
            Cancel
          </button>
        )}
        <button type="button" onClick={handleSave} className={styles.saveBtn} disabled={saving}>
          {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Add Booking')}
        </button>
      </div>
    </div>
  );
}

function formatSentDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

// FieldCheck — wraps a control and shows a green ✓ at its right edge once
// `valid` is true. Matches the mobile/club booking forms. The control
// gets .hasCheck (text inputs) or .hasCheckSelect (native selects).
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
