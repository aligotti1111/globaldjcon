'use client';

// UpcomingBookingsClient — DJ's own future schedule view.
//
// Renders the list grouped by month (most recent month first per the spec,
// then ascending within the month). Provides an "Add Manual Booking" CTA
// that opens a modal form with the right fields for the DJ's type:
//   - Club/Bar DJ: date, start, end, venue name, venue type (bar/club)
//   - Mobile DJ: date, start, end, event type
//
// Daily-cap rule applied at form save:
//   - Club: max 1 booking per date (real + manual combined). Soft block.
//   - Mobile: max users.bookings_per_day per date. Soft block.
// "Soft" = we surface a warning + require confirm, but don't refuse outright,
// because DJs sometimes legitimately overbook themselves.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from './upcomingBookings.module.css';
import type { UpcomingBooking } from './page';

interface Props {
  userId: string;
  djType: 'club' | 'mobile';
  bookingsPerDay: number;
  initialBookings: UpcomingBooking[];
}

// Mobile-DJ event-type labels — keep aligned with the public booking form.
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

export default function UpcomingBookingsClient({
  userId, djType, bookingsPerDay, initialBookings,
}: Props) {
  const [bookings, setBookings] = useState<UpcomingBooking[]>(initialBookings);
  const [showAddModal, setShowAddModal] = useState(false);

  // Group by month (YYYY-MM) and sort the keys descending (most recent
  // month first per spec). Within each month, ascending date order is
  // already established by the server query.
  const grouped = useMemo(() => {
    const map = new Map<string, UpcomingBooking[]>();
    for (const b of bookings) {
      if (!b.event_date) continue;
      const monthKey = b.event_date.slice(0, 7); // YYYY-MM
      if (!map.has(monthKey)) map.set(monthKey, []);
      map.get(monthKey)!.push(b);
    }
    // Sort descending: most recent month first.
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [bookings]);

  // Format a month key (YYYY-MM) into a display label like "MAY 2026".
  function monthLabel(key: string): string {
    const [y, m] = key.split('-').map((s) => parseInt(s, 10));
    const date = new Date(y, m - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
  }

  async function handleAdded(newBooking: UpcomingBooking) {
    // Optimistic insert: add the new row to local state in the correct
    // sorted position (ascending by date+time). Falls within the right
    // month group automatically via the useMemo above.
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
    if (error) {
      alert('Delete failed: ' + error.message);
      return;
    }
    setBookings((prev) => prev.filter((b) => b.id !== id));
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Upcoming Bookings</h1>
          <Link href="/booking-requests" className={styles.backLink}>← Back to booking requests</Link>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className={styles.addBtn}
        >
          + Add Manual Booking
        </button>
      </div>

      {bookings.length === 0 ? (
        <div className={styles.empty}>
          <p>No upcoming bookings yet.</p>
          <p className={styles.emptyHint}>
            Approved booking requests show up here automatically. You can also add
            bookings manually using the button above.
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
// Layout: date · time range · venue/event · optional manual pill + delete
// ───────────────────────────────────────────────────────────────────────

function BookingRow({
  booking,
  djType,
  onDelete,
}: {
  booking: UpcomingBooking;
  djType: 'club' | 'mobile';
  onDelete?: () => void;
}) {
  const dateLabel = formatDayLabel(booking.event_date);
  const timeRange = formatTimeRange(booking.start_time, booking.end_time);

  // Right-side context label: venue type for club, event type for mobile.
  let context = '';
  if (djType === 'club') {
    const venue = booking.venue_name?.trim() || '—';
    const type = booking.venue_type ? ` (${booking.venue_type})` : '';
    context = `${venue}${type}`;
  } else {
    const ev = booking.event_type || '';
    const found = MOBILE_EVENT_TYPES.find((e) => e.value === ev);
    context = found ? found.label : (ev ? ev : 'Event');
    if (booking.venue_name) context = `${context} · ${booking.venue_name}`;
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowDate}>{dateLabel}</div>
      <div className={styles.rowTime}>{timeRange}</div>
      <div className={styles.rowContext}>{context}</div>
      {booking.is_manual && (
        <span className={styles.manualPill} title="Added manually by you">MANUAL</span>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className={styles.deleteBtn}
          aria-label="Delete manual booking"
          title="Delete"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// AddManualBookingModal — form to create a manual booking row.
// ───────────────────────────────────────────────────────────────────────

function AddManualBookingModal({
  userId, djType, bookingsPerDay, existingBookings,
  onClose, onAdded,
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
  const [venueType, setVenueType] = useState<string>('bar'); // club only
  const [eventType, setEventType] = useState<string>('wedding'); // mobile only
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Today (server-rendered timezone) as the minimum allowed date.
  const todayStr = new Date().toISOString().slice(0, 10);

  async function handleSave() {
    setError(null);
    if (!eventDate) { setError('Pick a date.'); return; }
    if (!startTime) { setError('Pick a start time.'); return; }
    if (!endTime) { setError('Pick an end time.'); return; }
    if (djType === 'club' && !venueName.trim()) { setError('Venue name is required.'); return; }

    // Daily-cap check. Club = 1 per day. Mobile = bookingsPerDay (or 1 if unset).
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
      const insertRow = {
        dj_id: userId,
        requester_id: userId, // self-attributed so NOT NULL constraints are satisfied
        booking_type: djType,
        event_date: eventDate,
        start_time: startTime,
        end_time: endTime,
        venue_name: venueName.trim() || null,
        venue_type: djType === 'club' ? venueType : null,
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
      onAdded({
        ...(data as unknown as UpcomingBooking),
        is_manual: true,
      });
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
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Date</span>
            <input
              type="date"
              min={todayStr}
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className={styles.input}
            />
          </label>

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Start Time</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={styles.input}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>End Time</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={styles.input}
              />
            </label>
          </div>

          {djType === 'club' ? (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Venue Name</span>
                <input
                  type="text"
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  placeholder="e.g. Black Velvet Lounge"
                  className={styles.input}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Venue Type</span>
                <select
                  value={venueType}
                  onChange={(e) => setVenueType(e.target.value)}
                  className={styles.input}
                >
                  {CLUB_VENUE_TYPES.map((v) => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Event Type</span>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  className={styles.input}
                >
                  {MOBILE_EVENT_TYPES.map((v) => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Venue Name (optional)</span>
                <input
                  type="text"
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  placeholder="e.g. Riverside Park Pavilion"
                  className={styles.input}
                />
              </label>
            </>
          )}

          {error && <div className={styles.errorBox}>{error}</div>}
        </div>

        <div className={styles.modalFooter}>
          <button type="button" onClick={onClose} className={styles.cancelBtn} disabled={saving}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} className={styles.saveBtn} disabled={saving}>
            {saving ? 'Saving…' : 'Add Booking'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Display helpers — local to this file because the formatting is specific
// to the upcoming-bookings list layout (compact "Thu · May 30").
// ───────────────────────────────────────────────────────────────────────

function formatDayLabel(d: string | null): string {
  if (!d) return '—';
  // Parse as local date (Y-M-D), not UTC. Otherwise dates near midnight
  // shift by one day in some timezones.
  const [y, m, day] = d.split('-').map((s) => parseInt(s, 10));
  const date = new Date(y, m - 1, day);
  // Format: "Thu · May 30"
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
  // Accept "HH:MM" or "HH:MM:SS". Render as "H:MM AM/PM".
  const [hStr, mStr] = t.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}
