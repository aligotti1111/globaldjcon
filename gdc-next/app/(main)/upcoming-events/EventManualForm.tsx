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
  userId, userCountry, existing, onClose, onAdded, onUpdated,
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

    setSaving(true);
    try {
      const supabase = createClient();
      const coords = venueCoordsRef.current;
      const payload = {
        event_date: eventDate,
        start_time: startTime,
        end_time: endTime || null,
        venue_name: venueName.trim() || null,
        venue_address: venueAddress.trim() || null,
        venue_lat: coords?.lat ?? null,
        venue_lon: coords?.lon ?? null,
        notes: notes.trim() || null,
      };
      const selectCols = 'id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, event_type, booking_type, is_manual, dj_id, flyer_url, link_url, link_label, notes, status, created_at';

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
        const insertRow = {
          ...payload,
          requester_id: userId,
          dj_id: null,
          booking_type: null,
          is_manual: true,
          status: 'approved',
        };
        const { data, error: e } = await supabase
          .from('bookings')
          .insert(insertRow as unknown as never)
          .select(selectCols)
          .single();
        if (e) throw e;
        onAdded(data as unknown as UpcomingEvent);
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

          <div className={styles.fieldRow}>
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
                    {(COUNTRY_CODES_ADDR[c] || '??').toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>

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
