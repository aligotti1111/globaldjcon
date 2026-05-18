'use client';

// MonthEventsList — list of upcoming events for the currently viewed month
// on the public club/bar DJ profile. Renders below the single-month calendar
// (hidden in 12-month view). Anyone can see the list; only the profile owner
// gets the flyer-upload button.
//
// Data: all bookings for this DJ where:
//   - event_date is within the [year, month] window (inclusive)
//   - status = 'approved' OR is_manual = true
//   - event_date >= today (no past events)
//
// Each row shows: date · set time · venue (linked to Google Maps).
// Owner sees: "+ Upload Flyer" if no flyer yet, or the flyer thumbnail on
// the left of the row + a "Replace" affordance. Replacement happens via
// the same file input (upsert).

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './monthEventsList.module.css';

interface EventRow {
  id: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_lat: number | null;
  venue_lon: number | null;
  set_type: string | null;
  flyer_url: string | null;
  is_manual: boolean;
  // Synthetic flag for calendar-marked booked dates that don't have a
  // corresponding bookings row. Such "private" entries render with date
  // only — no venue/time/flyer because none exists. Set by the merge
  // logic in load() below.
  is_private?: boolean;
}

interface Props {
  djId: string;
  isOwnProfile: boolean;
  year: number;
  month: number;  // 0-indexed
  // Calendar booking_days dict passed from PublicCalendar — used to detect
  // calendar-marked dates without a real bookings row (private events).
  // Avoids a client-side RLS-blocked re-fetch of users.booking_settings.
  bookingDays: Record<string, { booked?: boolean }>;
  // Owner-only callback: when the owner clicks "Edit Details" on a row, this
  // fires with the date key so the parent can open the day-edit popup.
  onEditDate?: (dateKey: string) => void;
}

export default function MonthEventsList({ djId, isOwnProfile, year, month, bookingDays, onEditDate }: Props) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Lightbox: when set, the enlarged flyer overlay shows this URL.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    // Build [first-of-month, first-of-next-month) as date strings.
    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const nextMonthDate = new Date(year, month + 1, 1);
    const monthEnd = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`;

    // Clamp to today so past events in the current month don't render.
    const today = new Date().toISOString().slice(0, 10);
    const startBound = today > monthStart ? today : monthStart;

    async function load() {
      // Use server-side admin-backed API instead of direct client query —
      // anon clients can't read other DJs' bookings via RLS, but we need
      // them visible on the public profile.
      let realRows: EventRow[] = [];
      try {
        const params = new URLSearchParams({
          djId,
          from: startBound,
          to: monthEnd,
        });
        const res = await fetch(`/api/dj-upcoming-events?${params.toString()}`);
        if (res.ok) {
          const json = await res.json();
          realRows = (json.events as EventRow[]) || [];
        } else {
          console.error('[MonthEventsList] events API error', res.status);
        }
      } catch (e) {
        console.error('[MonthEventsList] events API exception', e);
      }
      if (!mounted) return;

      const realDateSet = new Set(realRows.map((r) => r.event_date));

      // Use the bookingDays passed from PublicCalendar (server-loaded with
      // proper auth) to find calendar marks WITHOUT a matching real booking.
      const privateRows: EventRow[] = [];
      for (const [dateKey, day] of Object.entries(bookingDays)) {
        if (!day?.booked) continue;
        if (dateKey < startBound) continue;
        if (dateKey >= monthEnd) continue;
        if (realDateSet.has(dateKey)) continue;
        privateRows.push({
          id: `private:${dateKey}`,
          event_date: dateKey,
          start_time: null,
          end_time: null,
          venue_name: null,
          venue_address: null,
          venue_lat: null,
          venue_lon: null,
          set_type: null,
          flyer_url: null,
          is_manual: false,
          is_private: true,
        });
      }

      const merged = [...realRows, ...privateRows].sort((a, b) => {
        const da = a.event_date + ' ' + (a.start_time || '');
        const db = b.event_date + ' ' + (b.start_time || '');
        return da.localeCompare(db);
      });
      setEvents(merged);
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, [djId, year, month, bookingDays]);

  function updateFlyerUrl(id: string, url: string | null) {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, flyer_url: url } : e)));
  }

  if (loading) {
    return (
      <div className={styles.section}>
        <div className={styles.heading}>Upcoming Events</div>
        <div className={styles.empty}>Loading…</div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className={styles.section}>
        <div className={styles.heading}>Upcoming Events</div>
        <div className={styles.empty}>No upcoming events this month.</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.heading}>Upcoming Events</div>
      <div className={styles.list}>
        {events.map((ev) => (
          <EventListItem
            key={ev.id}
            event={ev}
            djId={djId}
            isOwnProfile={isOwnProfile}
            onFlyerChange={(url) => updateFlyerUrl(ev.id, url)}
            onEditDate={onEditDate}
            onFlyerClick={(url) => setLightboxUrl(url)}
          />
        ))}
      </div>

      {/* Flyer lightbox — click anywhere or press Esc to close. */}
      {lightboxUrl && (
        <div
          className={styles.lightboxOverlay}
          onClick={() => setLightboxUrl(null)}
          role="dialog"
          aria-modal="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Event flyer enlarged"
            className={styles.lightboxImg}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className={styles.lightboxClose}
            onClick={() => setLightboxUrl(null)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function EventListItem({
  event, djId, isOwnProfile, onFlyerChange, onEditDate, onFlyerClick,
}: {
  event: EventRow;
  djId: string;
  isOwnProfile: boolean;
  onFlyerChange: (url: string | null) => void;
  onEditDate?: (dateKey: string) => void;
  onFlyerClick?: (url: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const { day, dow, mo } = parseDateParts(event.event_date);

  // Private events (calendar mark without a real booking row).
  //   - Owner sees: full row with flyer-upload slot, placeholder fields, and
  //     an "Edit Details" button that opens the day-edit popup so they can
  //     fill in time/venue/address/etc in one flow.
  //   - Public sees: muted date pill + italic "Private Event" label only.
  if (event.is_private) {
    if (!isOwnProfile) {
      return (
        <div className={styles.row}>
          <div className={`${styles.datePill} ${styles.datePillMuted}`}>
            <div className={styles.dayNum}>{day}</div>
            <div className={styles.dayMeta}>
              <div className={styles.dow}>{dow}</div>
              <div className={styles.mo}>{mo}</div>
            </div>
          </div>
          <div className={styles.middle}>
            <div className={styles.privateLabel}>Private Event</div>
          </div>
        </div>
      );
    }
    // Owner view: full row with flyer-upload slot + placeholder fields.
    // "+ Flyer" creates a minimal manual booking row on the fly and uploads
    // the chosen image, transitioning the row from private → real. The
    // owner can fill in remaining details later via "Edit Details".
    const dateKey = event.event_date;
    async function handleFlyerForPrivate(e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0];
      if (!file || !dateKey) return;
      setUploading(true);
      setUploadErr(null);
      try {
        const supabase = createClient();
        // 1. Create the stub booking row.
        const { data: inserted, error: insertErr } = await supabase
          .from('bookings')
          .insert({
            dj_id: djId,
            requester_id: djId,
            booking_type: 'club',
            event_date: dateKey,
            is_manual: true,
            status: 'approved',
          } as unknown as never)
          .select('id')
          .single<{ id: string }>();
        if (insertErr || !inserted) throw insertErr || new Error('Insert failed');

        // 2. Upload the flyer keyed to the new booking id.
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${djId}/flyers/${inserted.id}.${ext}`;
        const { error: uploadErrInner } = await supabase.storage
          .from('avatars')
          .upload(path, file, { upsert: true, contentType: file.type });
        if (uploadErrInner) throw uploadErrInner;
        const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
        const publicUrl = `${pub.publicUrl}?t=${Date.now()}`;

        // 3. Save the URL on the booking row.
        const { error: updErr } = await supabase
          .from('bookings')
          .update({ flyer_url: publicUrl } as unknown as never)
          .eq('id', inserted.id)
          .eq('dj_id', djId);
        if (updErr) throw updErr;

        // Reload so the list refreshes — booking_days still has the calendar
        // mark, but now the date also has a real booking row with a flyer.
        window.location.reload();
      } catch (err) {
        setUploadErr(err instanceof Error ? err.message : 'Upload failed');
        setUploading(false);
        e.target.value = '';
      }
    }
    return (
      <div className={styles.row}>
        <div className={styles.datePill}>
          <div className={styles.dayNum}>{day}</div>
          <div className={styles.dayMeta}>
            <div className={styles.dow}>{dow}</div>
            <div className={styles.mo}>{mo}</div>
          </div>
        </div>
        <button
          type="button"
          className={styles.uploadBtn}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Upload flyer"
        >
          {uploading ? '…' : '+ Flyer'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFlyerForPrivate}
        />
        <div className={styles.middle}>
          <div className={`${styles.venue} ${styles.placeholderField}`}>Add venue name</div>
          <div className={styles.meta}>
            <span className={styles.placeholderField}>Add time</span>
            {' · '}
            <span className={styles.placeholderField}>Add address</span>
          </div>
          {uploadErr && <div className={styles.errMsg}>{uploadErr}</div>}
        </div>
        <button
          type="button"
          className={styles.editDetailsBtn}
          onClick={() => onEditDate?.(dateKey || '')}
        >
          Edit Details
        </button>
      </div>
    );
  }

  const hasTime = !!event.start_time;
  const hasVenue = !!event.venue_name?.trim();
  const hasAddress = !!event.venue_address?.trim();
  const hasFlyer = !!event.flyer_url;
  // Flyer-only state: row has a flyer image but no venue/time/address. For
  // public viewers we surface "See flyer for more info" so they know to
  // look at the image. Owners still see the Add X placeholders.
  const flyerOnly = hasFlyer && !hasTime && !hasVenue && !hasAddress;
  const timeRange = formatTimeRange(event.start_time, event.end_time);
  const venueLine = event.venue_name?.trim()
    || event.venue_address?.split(',')[0]
    || '—';

  const mapUrl = event.venue_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue_address)}`
    : null;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadErr(null);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      // Path: <dj_id>/flyers/<booking_id>.<ext>. Upsert so re-uploads
      // replace the previous flyer cleanly without leaking files.
      const path = `${djId}/flyers/${event.id}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) throw uploadErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
      // Save the URL on the booking row.
      const { error: updErr } = await supabase
        .from('bookings')
        .update({ flyer_url: publicUrl } as unknown as never)
        .eq('id', event.id)
        .eq('dj_id', djId);
      if (updErr) throw updErr;
      onFlyerChange(publicUrl);
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = ''; // reset so same file can be re-picked
    }
  }

  async function handleRemoveFlyer() {
    if (!confirm('Remove this flyer?')) return;
    setUploading(true);
    setUploadErr(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('bookings')
        .update({ flyer_url: null } as unknown as never)
        .eq('id', event.id)
        .eq('dj_id', djId);
      if (error) throw error;
      onFlyerChange(null);
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={styles.row}>
      {/* Date pill — big day number with DOW + MO stacked beside it. First
          thing users scan for. */}
      <div className={styles.datePill}>
        <div className={styles.dayNum}>{day}</div>
        <div className={styles.dayMeta}>
          <div className={styles.dow}>{dow}</div>
          <div className={styles.mo}>{mo}</div>
        </div>
      </div>

      {/* Flyer: thumbnail on the left when present, or upload button (owner)
          / nothing (public). 56x56 keeps the row compact while still
          surfacing the flyer visually. */}
      {hasFlyer ? (
        <div className={styles.flyerWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={event.flyer_url || ''}
            alt="Event flyer"
            className={styles.flyerImg}
            onClick={(e) => {
              e.stopPropagation();
              if (event.flyer_url) onFlyerClick?.(event.flyer_url);
            }}
            style={{ cursor: event.flyer_url ? 'pointer' : 'default' }}
          />
          {isOwnProfile && (
            <div className={styles.flyerActions}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={styles.flyerAction}
                disabled={uploading}
              >
                {uploading ? '…' : 'Replace'}
              </button>
              <button
                type="button"
                onClick={handleRemoveFlyer}
                className={`${styles.flyerAction} ${styles.flyerActionDanger}`}
                disabled={uploading}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      ) : isOwnProfile ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={styles.uploadBtn}
          disabled={uploading}
          title="Upload flyer"
        >
          {uploading ? '…' : '+ Flyer'}
        </button>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFile}
      />

      {/* Middle: venue (bold) on top, time + map link below. Owner sees
          "Add X" placeholders for missing fields; public viewers see only
          what's actually been filled in. If only a flyer is set, public
          viewers see "See flyer for more info" instead of an empty row. */}
      <div className={styles.middle}>
        {hasVenue ? (
          <div className={styles.venue}>{venueLine}</div>
        ) : isOwnProfile ? (
          <div className={`${styles.venue} ${styles.placeholderField}`}>Add venue name</div>
        ) : flyerOnly ? (
          <div className={`${styles.venue} ${styles.flyerHint}`}>See flyer for more info</div>
        ) : null}
        <div className={styles.meta}>
          {hasTime ? timeRange : isOwnProfile ? (
            <span className={styles.placeholderField}>Add time</span>
          ) : null}
          {(hasTime && (hasAddress || (isOwnProfile && !hasAddress))) && ' · '}
          {hasAddress ? (
            mapUrl ? (
              <a href={mapUrl} target="_blank" rel="noreferrer" className={styles.metaLink}>
                {event.venue_address}
              </a>
            ) : (
              <span>{event.venue_address}</span>
            )
          ) : isOwnProfile ? (
            <span className={styles.placeholderField}>Add address</span>
          ) : null}
        </div>
        {uploadErr && <div className={styles.errMsg}>{uploadErr}</div>}
      </div>
      {/* Owner-only: small "public" hint pill + Edit Details button. The
          pill signals to the owner that this booking row is publicly
          visible on their profile (since any populated field shows up). */}
      {isOwnProfile && event.is_manual && (
        <div className={styles.ownerActions}>
          <span className={styles.publicHint} title="This event is visible on your public profile">
            <span className={styles.publicDot} /> Public
          </span>
          <button
            type="button"
            className={styles.editDetailsBtn}
            onClick={() => onEditDate?.(event.event_date || '')}
          >
            Edit Details
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

// Parse an event_date "YYYY-MM-DD" string into the three parts the date
// pill needs: day number, abbreviated weekday (Thu), abbreviated month (May).
function parseDateParts(d: string | null): { day: string; dow: string; mo: string } {
  if (!d) return { day: '—', dow: '', mo: '' };
  const [y, m, day] = d.split('-').map((s) => parseInt(s, 10));
  const date = new Date(y, m - 1, day);
  return {
    day: String(day),
    dow: date.toLocaleDateString('en-US', { weekday: 'short' }),
    mo: date.toLocaleDateString('en-US', { month: 'short' }),
  };
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
