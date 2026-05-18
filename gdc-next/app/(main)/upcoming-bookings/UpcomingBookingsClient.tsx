'use client';

// UpcomingBookingsClient — DJ's own future schedule view.
//
// Renders the list grouped by month (most recent month first), shows each
// upcoming approved/manual booking as a single row, and provides an
// "+ Add Manual Booking" CTA that opens a modal with the right fields for
// the DJ's type.
//
// Form fields per role:
//   - Club/Bar DJ: date · start · end · venue name · address (Nominatim) ·
//     venue type (bar/club) · set type (opening/headliner/closing/opening+closing)
//   - Mobile DJ:   date · start · end · venue name (optional) · address ·
//     event type
//
// Daily-cap rule applied at form save:
//   - Club: max 1 booking per date (real + manual combined). Soft block.
//   - Mobile: max users.booking_settings.mob_bookings_per_day per date. Soft block.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { searchAddresses } from '../[slug]/mobileBookingForm';
import styles from './upcomingBookings.module.css';
import type { UpcomingBooking } from './page';

interface Props {
  userId: string;
  djType: 'club' | 'mobile';
  bookingsPerDay: number;
  initialBookings: UpcomingBooking[];
}

// Mobile-DJ event-type labels (kept aligned with the public booking form).
const MOBILE_EVENT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'wedding', label: 'Wedding' },
  { value: 'birthday', label: 'Birthday Party' },
  { value: 'corporate', label: 'Corporate Event' },
  { value: 'private_party', label: 'Private Party' },
  { value: 'school_dance', label: 'School Dance' },
  { value: 'graduation', label: 'Graduation' },
  { value: 'anniversary', label: 'Anniversary' },
  { value: 'holiday_party', label: 'Holiday Party' },
  { value: 'other', label: 'Other' },
];

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

// Build 48 half-hour time options ("12:00 AM" → "11:30 PM"). Each option's
// value is HH:MM (24h, to store cleanly), label is 12h-with-AM/PM for display.
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

export default function UpcomingBookingsClient({
  userId, djType, bookingsPerDay, initialBookings,
}: Props) {
  const [bookings, setBookings] = useState<UpcomingBooking[]>(initialBookings);
  const [showAddModal, setShowAddModal] = useState(false);

  // Group by month (YYYY-MM); keys sorted descending (most recent month first).
  const grouped = useMemo(() => {
    const map = new Map<string, UpcomingBooking[]>();
    for (const b of bookings) {
      if (!b.event_date) continue;
      const key = b.event_date.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    // Sort ascending: soonest month first.
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [bookings]);

  function monthLabel(key: string): string {
    const [y, m] = key.split('-').map((s) => parseInt(s, 10));
    const date = new Date(y, m - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
  }

  async function handleAdded(newBooking: UpcomingBooking) {
    setBookings((prev) => {
      const next = [...prev, newBooking];
      next.sort((a, b) => {
        const da = (a.event_date || '') + ' ' + (a.start_time || '');
        const db = (b.event_date || '') + ' ' + (b.start_time || '');
        return da.localeCompare(db);
      });
      return next;
    });
    setShowAddModal(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this manual booking? This cannot be undone.')) return;
    const supabase = createClient();
    const { error } = await supabase.from('bookings').delete().eq('id', id).eq('dj_id', userId);
    if (error) { alert('Delete failed: ' + error.message); return; }
    setBookings((prev) => prev.filter((b) => b.id !== id));
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Upcoming Bookings</h1>
          <Link href="/booking-requests" className={styles.backLink}>← Back to booking requests</Link>
        </div>
        <button type="button" onClick={() => setShowAddModal(true)} className={styles.addBtn}>
          + Add Manual Booking
        </button>
      </div>

      {bookings.length === 0 ? (
        <div className={styles.empty}>
          <p>No upcoming bookings yet.</p>
          <p className={styles.emptyHint}>
            Approved booking requests show up here automatically. You can also add bookings
            manually using the button above.
          </p>
        </div>
      ) : (
        <div className={styles.monthList}>
          {grouped.map(([monthKey, items]) => (
            <section key={monthKey} className={styles.month}>
              <h2 className={styles.monthLabel}>{monthLabel(monthKey)}</h2>
              <div className={styles.monthItems}>
                {items.map((b) => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    djType={djType}
                    onDelete={b.is_manual ? () => handleDelete(b.id) : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {showAddModal && (
        <AddManualBookingModal
          userId={userId}
          djType={djType}
          bookingsPerDay={bookingsPerDay}
          existingBookings={bookings}
          onClose={() => setShowAddModal(false)}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// BookingRow — single-line summary for one booking in the month list.
// ───────────────────────────────────────────────────────────────────────

function BookingRow({
  booking, djType, onDelete,
}: {
  booking: UpcomingBooking;
  djType: 'club' | 'mobile';
  onDelete?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const dateLabel = formatDayLabel(booking.event_date);
  const timeRange = formatTimeRange(booking.start_time, booking.end_time);

  let context = '';
  if (djType === 'club') {
    const venue = booking.venue_name?.trim() || '—';
    const type = booking.venue_type ? ` (${booking.venue_type})` : '';
    context = `${venue}${type}`;
  } else {
    const ev = booking.event_type || '';
    const found = MOBILE_EVENT_TYPES.find((e) => e.value === ev);
    context = found ? found.label : (ev || 'Event');
    if (booking.venue_name) context = `${context} · ${booking.venue_name}`;
  }

  // Stop the delete button from also expanding/collapsing the row.
  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    onDelete && onDelete();
  }

  return (
    <div className={`${styles.rowWrap} ${expanded ? styles.rowWrapExpanded : ''}`}>
      <button
        type="button"
        className={styles.row}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className={styles.rowDate}>{dateLabel}</div>
        <div className={styles.rowTime}>{timeRange}</div>
        <div className={styles.rowContext}>{context}</div>
        {booking.is_manual && (
          <span className={styles.manualPill} title="Added manually by you">MANUAL</span>
        )}
        {onDelete && (
          <span
            onClick={handleDelete}
            className={styles.deleteBtn}
            role="button"
            aria-label="Delete manual booking"
            title="Delete"
          >
            ✕
          </span>
        )}
        <svg
          className={`${styles.rowChevron} ${expanded ? styles.rowChevronOpen : ''}`}
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && <BookingDetails booking={booking} djType={djType} />}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// BookingDetails — full info panel shown when a row is expanded inline.
// Renders every field we have on file for the booking, grouped sensibly.
// Empty/null fields are hidden so the panel stays clean for manual bookings
// (which won't have requester/package/quote info).
// ───────────────────────────────────────────────────────────────────────

function BookingDetails({
  booking, djType,
}: {
  booking: UpcomingBooking;
  djType: 'club' | 'mobile';
}) {
  // Pretty-format the helper labels.
  const setTypeLabel = booking.set_type
    ? (booking.set_type
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '))
    : null;

  const eventTypeLabel = booking.event_type
    ? (MOBILE_EVENT_TYPES.find((e) => e.value === booking.event_type)?.label
        || booking.event_type)
    : null;

  // Currency-aware money formatting. Default USD if no currency set.
  function money(n: number | null | undefined): string | null {
    if (n == null) return null;
    const cur = booking.currency || 'USD';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n);
    } catch {
      return `${cur} ${n}`;
    }
  }

  // Linkified address — clicking opens Google Maps directions to that address.
  // If we have lat/lon we use those for a more precise pin; otherwise fall
  // back to URL-encoded address text.
  const addressUrl = booking.venue_address
    ? (booking.venue_lat != null && booking.venue_lon != null
        ? `https://www.google.com/maps/search/?api=1&query=${booking.venue_lat},${booking.venue_lon}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.venue_address)}`)
    : null;

  // Each row in `rows` is one or two label/value pairs. A pair appears
  // side-by-side; a single appears alone. We pre-filter empties so a row
  // collapses to a single column when one of its halves is empty.
  type Cell = { label: string; value: React.ReactNode | string | null | undefined };
  type DetailRow = Cell[];

  // Build the rows. Null values get filtered out below.
  const rows: DetailRow[] = [
    // Row 1: Event Date + Venue/Event Type
    [
      { label: 'Event Date', value: booking.event_date ? formatLongDate(booking.event_date) : null },
      djType === 'club'
        ? { label: 'Venue Type', value: booking.venue_type ? capitalize(booking.venue_type) : null }
        : { label: 'Event Type', value: eventTypeLabel },
    ],
    // Row 2: Start Time + End Time
    [
      { label: 'Start Time', value: booking.start_time ? formatTime12(booking.start_time) : null },
      { label: 'End Time', value: booking.end_time ? formatTime12(booking.end_time) : null },
    ],
    // Row 3: Venue Name + Venue Address (linkified to Google Maps)
    [
      { label: 'Venue Name', value: booking.venue_name },
      {
        label: 'Venue Address',
        value: addressUrl ? (
          <a href={addressUrl} target="_blank" rel="noreferrer" className={styles.addressLink}>
            {booking.venue_address}
          </a>
        ) : booking.venue_address,
      },
    ],
    // Row 4: DJ-type-specific extra info
    djType === 'club'
      ? [
          { label: 'Set Type', value: setTypeLabel },
          { label: 'Equipment', value: booking.equipment ? capitalize(booking.equipment.replace(/_/g, ' ')) : null },
        ]
      : [
          { label: 'Guest Count', value: booking.guest_count != null ? String(booking.guest_count) : null },
          { label: 'Room Details', value: booking.room_details },
        ],
    // Row 5: Booked By + Contact Phone
    [
      { label: 'Booked By', value: booking.is_manual ? 'You (manual)' : (booking.requester_name || null) },
      { label: 'Contact Phone', value: booking.phone },
    ],
    // Row 6: Package + Agreed Rate
    [
      { label: 'Package', value: booking.package_title },
      { label: 'Agreed Rate', value: money(booking.counter_rate ?? booking.quoted_rate ?? booking.offer_amount) },
    ],
    // Row 7: Deposit + Status
    [
      {
        label: 'Deposit',
        value: booking.deposit_amount != null
          ? money(booking.deposit_amount)
          : booking.deposit_pct != null
            ? `${booking.deposit_pct}%`
            : null,
      },
      { label: 'Status', value: booking.status ? booking.status.toUpperCase() : null },
    ],
    // Row 8: Booked On (alone)
    [
      { label: 'Booked On', value: booking.created_at ? formatLongDate(booking.created_at) : null },
    ],
  ];

  // Filter empty cells from each row; drop rows that become entirely empty.
  const visibleRows = rows
    .map((row) => row.filter((c) => c.value != null && c.value !== ''))
    .filter((row) => row.length > 0);

  const hasNotes = booking.notes && booking.notes.trim().length > 0;
  const hasPackageDetails = booking.package_details && booking.package_details.trim().length > 0;

  return (
    <div className={styles.detailsPanel}>
      <div className={styles.detailsStack}>
        {visibleRows.map((row, i) => (
          <div key={i} className={styles.detailPairRow}>
            {row.map((cell) => (
              <div key={cell.label} className={styles.detailRow}>
                <div className={styles.detailLabel}>{cell.label}</div>
                <div className={styles.detailValue}>{cell.value}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {hasPackageDetails && (
        <div className={styles.detailLongBlock}>
          <div className={styles.detailLabel}>Package Details</div>
          <div
            className={styles.detailLongValue}
            dangerouslySetInnerHTML={{ __html: booking.package_details || '' }}
          />
        </div>
      )}
      {hasNotes && (
        <div className={styles.detailLongBlock}>
          <div className={styles.detailLabel}>Notes</div>
          <div className={styles.detailLongValue}>{booking.notes}</div>
        </div>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatLongDate(d: string): string {
  // Accepts YYYY-MM-DD OR an ISO timestamp; handle both.
  const onlyDate = d.length === 10 ? d : d.slice(0, 10);
  const [y, m, day] = onlyDate.split('-').map((s) => parseInt(s, 10));
  if (!y || !m || !day) return d;
  const date = new Date(y, m - 1, day);
  return date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

// ───────────────────────────────────────────────────────────────────────
// AddManualBookingModal — form to create a manual booking row.
// ───────────────────────────────────────────────────────────────────────

function AddManualBookingModal({
  userId, djType, bookingsPerDay, existingBookings, onClose, onAdded,
}: {
  userId: string;
  djType: 'club' | 'mobile';
  bookingsPerDay: number;
  existingBookings: UpcomingBooking[];
  onClose: () => void;
  onAdded: (b: UpcomingBooking) => void;
}) {
  const [eventDate, setEventDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [venueType, setVenueType] = useState<string>(''); // club only — no default
  const [setType, setSetType] = useState<string>(''); // club only — no default
  const [eventType, setEventType] = useState<string>('wedding'); // mobile only
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Address autocomplete state
  const [addrSuggestions, setAddrSuggestions] = useState<Array<{ display: string; lat: number | null; lon: number | null }>>([]);
  const [showAddrSuggestions, setShowAddrSuggestions] = useState(false);
  const addrTimerRef = useRef<NodeJS.Timeout | null>(null);
  const venueCoordsRef = useRef<{ lat: number; lon: number } | null>(null);

  // Native date picker behavior: clicking ANYWHERE on the wrapping field
  // (label, the styled box, etc.) should fire .showPicker() so the system
  // calendar opens even if the click missed the small native picker icon.
  const dateInputRef = useRef<HTMLInputElement>(null);

  const todayStr = new Date().toISOString().slice(0, 10);

  // Clean up the debounce timer if the modal unmounts mid-typing.
  useEffect(() => () => { if (addrTimerRef.current) clearTimeout(addrTimerRef.current); }, []);

  function openDatePicker() {
    const el = dateInputRef.current;
    if (!el) return;
    // showPicker is the modern API. Fall back to focus() on older browsers.
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch { /* fall through */ }
    }
    el.focus();
  }

  async function handleSave() {
    setError(null);
    if (!eventDate) { setError('Pick a date.'); return; }
    if (!startTime) { setError('Pick a start time.'); return; }
    // End time required only for mobile DJs. Club/bar DJs often don't know
    // the exact end (open-ended sets), so it's optional for them.
    if (djType === 'mobile' && !endTime) { setError('Pick an end time.'); return; }
    if (djType === 'club' && !venueName.trim()) { setError('Venue name is required.'); return; }

    // Daily-cap check.
    const onSameDay = existingBookings.filter((b) => b.event_date === eventDate).length;
    const cap = djType === 'club' ? 1 : Math.max(1, bookingsPerDay || 1);
    if (onSameDay >= cap) {
      const msg = djType === 'club'
        ? `You already have a booking on ${eventDate}. Club/bar DJs can only have one booking per day. Add anyway?`
        : `You already have ${onSameDay} booking(s) on ${eventDate} (your daily cap is ${cap}). Add anyway?`;
      if (!confirm(msg)) return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const coords = venueCoordsRef.current;
      const insertRow = {
        dj_id: userId,
        requester_id: userId, // self-attributed so NOT NULL constraints pass
        booking_type: djType,
        event_date: eventDate,
        start_time: startTime,
        end_time: endTime,
        venue_name: venueName.trim() || null,
        venue_address: venueAddress.trim() || null,
        venue_lat: coords?.lat ?? null,
        venue_lon: coords?.lon ?? null,
        venue_type: djType === 'club' ? (venueType || null) : null,
        set_type: djType === 'club' ? (setType || null) : null,
        event_type: djType === 'mobile' ? eventType : null,
        is_manual: true,
        status: 'approved',
      };
      const { data, error: e } = await supabase
        .from('bookings')
        .insert(insertRow as unknown as never)
        .select('id, event_date, start_time, end_time, venue_name, venue_type, event_type, booking_type, is_manual')
        .single();
      if (e) throw e;
      onAdded({ ...(data as unknown as UpcomingBooking), is_manual: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Add Manual Booking</h2>
          <button type="button" onClick={onClose} className={styles.modalClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.modalBody}>
          {/* Date — clicking ANYWHERE on the field opens the native picker. */}
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

          {/* Venue name + address — applies to both DJ types, address required field name is the same */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Venue Name {djType === 'mobile' && <span className={styles.optional}>(optional)</span>}
            </span>
            <input
              type="text"
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
              placeholder={djType === 'club' ? 'e.g. Black Velvet Lounge' : 'e.g. Riverside Park Pavilion'}
              className={styles.input}
            />
          </label>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Venue Location</span>
            <div className={styles.addrWrap}>
              <input
                type="text"
                value={venueAddress}
                onChange={(e) => {
                  const val = e.target.value;
                  setVenueAddress(val);
                  venueCoordsRef.current = null; // user re-typed → invalidate previous pick
                  if (addrTimerRef.current) clearTimeout(addrTimerRef.current);
                  if (val.trim().length < 3) {
                    setAddrSuggestions([]);
                    setShowAddrSuggestions(false);
                    return;
                  }
                  addrTimerRef.current = setTimeout(async () => {
                    const results = await searchAddresses(val.trim());
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
          </div>

          {djType === 'club' ? (
            <>
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
            </>
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

          {error && <div className={styles.errorBox}>{error}</div>}
        </div>

        <div className={styles.modalFooter}>
          <button type="button" onClick={onClose} className={styles.cancelBtn} disabled={saving}>Cancel</button>
          <button type="button" onClick={handleSave} className={styles.saveBtn} disabled={saving}>
            {saving ? 'Saving…' : 'Add Booking'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Display helpers ────────────────────────────────────────────────────

function formatDayLabel(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map((s) => parseInt(s, 10));
  const date = new Date(y, m - 1, day);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const md = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${weekday} · ${md}`;
}

function formatTimeRange(s: string | null, e: string | null): string {
  const start = s ? formatTime12(s) : '';
  const end = e ? formatTime12(e) : '';
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  return '—';
}

function formatTime12(t: string): string {
  const [hStr, mStr] = t.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}
