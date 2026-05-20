'use client';

// EventManualForm — modal form for hosts/venues to add or edit a manual
// event. Simpler than the DJ-side ManualBookingForm — no rate fields, no
// packages, no DJ-specific dropdowns. Just date, time, venue, address.
//
// Inserts a `bookings` row with requester_id = userId, is_manual = true,
// status = 'approved', dj_id = null. (dj_id was made nullable in a recent
// migration to support host/venue-created events without a DJ assigned.)

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { searchAddresses } from '../[slug]/mobileBookingForm';
import { COUNTRIES, COUNTRY_CODES_ADDR } from '../account-settings/helpers';

// Country flag emojis — matches the homepage country picker so the look
// is consistent across the app. Maps country name → flag emoji.
const COUNTRY_FLAGS: Record<string, string> = {
  'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'Canada': '🇨🇦',
  'Australia': '🇦🇺', 'Germany': '🇩🇪', 'France': '🇫🇷', 'Netherlands': '🇳🇱',
  'Spain': '🇪🇸', 'Italy': '🇮🇹', 'Brazil': '🇧🇷', 'Mexico': '🇲🇽',
  'Japan': '🇯🇵', 'South Africa': '🇿🇦', 'New Zealand': '🇳🇿',
  'Ireland': '🇮🇪', 'Sweden': '🇸🇪', 'Norway': '🇳🇴', 'Denmark': '🇩🇰',
  'Belgium': '🇧🇪', 'Switzerland': '🇨🇭', 'Portugal': '🇵🇹', 'Other': '🌍',
};
import type { UpcomingEvent } from './page';
import styles from './upcomingEvents.module.css';

interface Props {
  userId: string;
  userCountry: string;
  userName: string;
  existing: UpcomingEvent | null;
  existingEvents: UpcomingEvent[];
  onClose: () => void;
  onAdded: (row: UpcomingEvent) => void;
  onUpdated: (row: UpcomingEvent) => void;
}

const TIME_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = ((h % 12) || 12);
      out.push({ value: `${hh}:${mm}`, label: `${h12}:${mm} ${ampm}` });
    }
  }
  return out;
})();

export default function EventManualForm({
  userId, userCountry, userName, existing, onClose, onAdded, onUpdated,
}: Props) {
  const isEdit = existing !== null;
  const trim = (t: string | null) => (t ? (t.length >= 5 ? t.slice(0, 5) : t) : '');

  const [eventDate, setEventDate] = useState(existing?.event_date || '');
  const [startTime, setStartTime] = useState(trim(existing?.start_time || null));
  const [endTime, setEndTime] = useState(trim(existing?.end_time || null));
  const [venueName, setVenueName] = useState(existing?.venue_name || '');
  const [venueAddress, setVenueAddress] = useState(existing?.venue_address || '');
  const [country, setCountry] = useState<string>(userCountry || 'United States');
  const [notes, setNotes] = useState(existing?.notes || '');
  // Required event type — drives booking_type column. Club/Bar share the
  // 'club' value (matches club_dj); Mobile is 'mobile'. No default — host
  // must pick. The form validates this before submit.
  const [eventType, setEventType] = useState<'club' | 'mobile' | ''>(
    (existing?.booking_type as 'club' | 'mobile' | undefined) || '',
  );
  // Optional recipient DJ email. If the email matches a DJ on the platform,
  // the booking is saved with their dj_id + status='pending' (they approve
  // via booking-requests). If no match, an invite email is sent and the
  // booking stays dj_id=null until they sign up.
  const [djEmail, setDjEmail] = useState('');
  // Optional flat rate (number) + currency. Stored on the bookings row as
  // offer_amount + currency so it flows through the normal booking flow.
  const [rate, setRate] = useState<string>(
    existing?.offer_amount != null ? String(existing.offer_amount) : '',
  );
  const [rateCurrency, setRateCurrency] = useState<string>(
    existing?.currency || 'USD',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => () => { if (addrTimerRef.current) clearTimeout(addrTimerRef.current); }, []);

  function openDatePicker() {
    const el = dateInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch { /* fall through */ }
    }
    el.focus();
  }

  async function handleSave() {
    setError(null);
    if (!eventDate) { setError('Pick a date.'); return; }
    if (!startTime) { setError('Pick a start time.'); return; }
    if (!eventType) { setError('Pick an event type.'); return; }

    setSaving(true);
    try {
      const supabase = createClient();
      const coords = venueCoordsRef.current;
      const trimmedEmail = djEmail.trim().toLowerCase();
      const rateNum = rate.trim() ? Number(rate.trim()) : null;
      if (rateNum != null && (!Number.isFinite(rateNum) || rateNum < 0)) {
        setError('Rate must be a positive number.');
        setSaving(false);
        return;
      }

      // Look up the recipient DJ if email provided. If no DJ exists in the
      // system we save with dj_id=null and send an invite email; if a DJ
      // exists we attach dj_id and the booking enters their pending tab.
      // Also requests capacity info for the event date so we can warn the
      // host before submitting if the DJ is already at their daily cap.
      let djId: string | null = null;
      let djLookupResult: {
        found: boolean;
        id?: string;
        dj_type?: string | null;
        name?: string | null;
        isDj?: boolean;
        capacity?: { max: number; existing: number; atCap: boolean } | null;
      } | null = null;
      if (trimmedEmail && trimmedEmail.includes('@')) {
        try {
          const res = await fetch(
            `/api/lookup-dj-by-email?email=${encodeURIComponent(trimmedEmail)}&date=${encodeURIComponent(eventDate)}`,
          );
          if (res.ok) {
            djLookupResult = await res.json();
            if (djLookupResult?.found && djLookupResult.isDj) {
              djId = djLookupResult.id || null;
              // Capacity warning — only blocks if the host confirms NO.
              const cap = djLookupResult.capacity;
              if (cap && cap.atCap) {
                const djLabel = djLookupResult.name || 'this DJ';
                const msg = djLookupResult.dj_type === 'club'
                  ? `${djLabel} already has a booking on ${eventDate} (club/bar DJs can only accept 1 booking per day). Send anyway?`
                  : `${djLabel} already has ${cap.existing} booking(s) on ${eventDate} (their daily cap is ${cap.max}). Send anyway?`;
                if (!confirm(msg)) {
                  setSaving(false);
                  return;
                }
              }
            }
          }
        } catch (e) {
          console.error('[EventManualForm] DJ lookup failed', e);
        }
      }

      const payload = {
        event_date: eventDate,
        start_time: startTime,
        end_time: endTime || null,
        venue_name: venueName.trim() || null,
        venue_address: venueAddress.trim() || null,
        venue_lat: coords?.lat ?? null,
        venue_lon: coords?.lon ?? null,
        notes: notes.trim() || null,
        booking_type: eventType,
        offer_amount: rateNum,
        currency: rateNum != null ? rateCurrency : null,
        // Persist the DJ email regardless of whether they're on the system
        // yet. If they sign up later (or click claim from email), the
        // /api/claim-booking route uses this to attach dj_id.
        dj_email: trimmedEmail || null,
      };
      const selectCols = 'id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, event_type, booking_type, is_manual, dj_id, dj_email, flyer_url, link_url, link_label, notes, status, created_at';

      if (isEdit && existing) {
        const { data, error: e } = await supabase
          .from('bookings')
          .update(payload as unknown as never)
          .eq('id', existing.id)
          .eq('requester_id', userId)
          .select(selectCols)
          .single();
        if (e) throw e;
        onUpdated(data as unknown as UpcomingEvent);
      } else {
        // For new bookings: if a DJ is attached, the booking enters their
        // booking-requests pending tab (status='pending'). Otherwise it's
        // immediately approved (host's own manual event).
        const insertRow = {
          ...payload,
          requester_id: userId,
          dj_id: djId,
          is_manual: true,
          status: djId ? 'pending' : 'approved',
          host_email: null,
        };
        const { data, error: e } = await supabase
          .from('bookings')
          .insert(insertRow as unknown as never)
          .select(selectCols)
          .single();
        if (e) throw e;
        const inserted = data as unknown as UpcomingEvent;

        // Send invite email if an email was entered. Two cases:
        //  - DJ on system → "you've been added to an event" notification
        //  - Not on system → "create an account to manage this event"
        if (trimmedEmail) {
          fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'event_invite_from_host',
              recipientEmail: trimmedEmail,
              hostName: userName,
              // Any existing account (DJ, host, or venue) should get the
              // "add booking to my account" CTA. Only send the create-account
              // version when no account is found at all.
              djFound: !!djLookupResult?.found,
              djName: djLookupResult?.name || null,
              djType: djLookupResult?.dj_type || null,
              bookingId: inserted.id,
              eventDate,
              startTime,
              endTime: endTime || null,
              eventType,
              venueName: venueName || null,
              venueAddress: venueAddress || null,
              rate: rateNum,
              currency: rateCurrency,
            }),
          }).catch((e) => console.error('[EventManualForm] email send failed', e));
        }

        onAdded(inserted);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{isEdit ? 'Edit Event' : 'Add Event'}</h3>
          <button type="button" className={styles.modalClose} onClick={onClose}>✕</button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.fieldRow3}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Date</span>
              <div className={styles.dateWrap} onClick={openDatePicker}>
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
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Start Time</span>
              <select value={startTime} onChange={(e) => setStartTime(e.target.value)} className={styles.input}>
                <option value="">Select…</option>
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                End Time <span className={styles.fieldOptional}>(optional)</span>
              </span>
              <select value={endTime} onChange={(e) => setEndTime(e.target.value)} className={styles.input}>
                <option value="">Select…</option>
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Venue Name</span>
            <input
              type="text"
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
              placeholder="e.g. Riverside Park Pavilion"
              className={styles.input}
            />
          </label>

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
                  className={styles.input}
                  autoComplete="off"
                />
                {showAddrSuggestions && addrSuggestions.length > 0 && (
                  <div className={styles.addrSuggestions}>
                    {addrSuggestions.map((s, i) => (
                      <div
                        key={i}
                        className={styles.addrSuggestion}
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
                {COUNTRIES.filter((c) => c !== 'Other').map((c) => (
                  <option key={c} value={c}>
                    {COUNTRY_FLAGS[c] || '🌍'} {(COUNTRY_CODES_ADDR[c] || '??').toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Event Type <span className={styles.required}>*</span></span>
              <select
                value={eventType}
                onChange={(e) => setEventType(e.target.value as 'club' | 'mobile' | '')}
                className={styles.input}
              >
                <option value="">Select…</option>
                <option value="club">Club / Bar</option>
                <option value="mobile">Mobile (private event)</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Rate <span className={styles.fieldOptional}>(optional)</span>
              </span>
              <div className={styles.rateRow}>
                <span className={styles.rateCurrencyPrefix}>
                  {rateCurrency === 'USD' ? '$' : rateCurrency === 'EUR' ? '€' : rateCurrency === 'GBP' ? '£' : rateCurrency}
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
            </label>
          </div>
          <span className={styles.fieldHint}>
            Rate will only be visible to you and the DJ.
          </span>

          {/* Optional recipient DJ. Email-based: looked up against the user
              base on save. If found, the DJ gets a pending booking they
              must approve. If not found, an invite email is sent.
              Only shown when ADDING a new event. When editing an existing
              event, the DJ is either already attached or this is a host's
              own private event — either way the recipient field doesn't
              apply. */}
          {!isEdit && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Recipient DJ Email <span className={styles.fieldOptional}>(optional)</span>
              </span>
              <input
                type="email"
                value={djEmail}
                onChange={(e) => setDjEmail(e.target.value)}
                placeholder="dj@example.com"
                className={styles.input}
                autoComplete="off"
              />
            </label>
          )}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Notes <span className={styles.fieldOptional}>(optional)</span></span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything else you want to remember…"
              className={styles.textarea}
              rows={2}
            />
          </label>

          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.modalActions}>
          <div className={styles.actionsRight}>
            <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className={styles.saveBtn} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Add Event')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
