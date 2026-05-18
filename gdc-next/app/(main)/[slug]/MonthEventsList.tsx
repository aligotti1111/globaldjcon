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
}

interface Props {
  djId: string;
  isOwnProfile: boolean;
  year: number;
  month: number;  // 0-indexed
}

export default function MonthEventsList({ djId, isOwnProfile, year, month }: Props) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

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
      const supabase = createClient();
      const { data } = await supabase
        .from('bookings')
        .select('id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, set_type, flyer_url, is_manual')
        .eq('dj_id', djId)
        .gte('event_date', startBound)
        .lt('event_date', monthEnd)
        .or('status.eq.approved,is_manual.eq.true')
        .order('event_date', { ascending: true })
        .order('start_time', { ascending: true });
      if (!mounted) return;
      setEvents((data as EventRow[]) || []);
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, [djId, year, month]);

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
          />
        ))}
      </div>
    </div>
  );
}

function EventListItem({
  event, djId, isOwnProfile, onFlyerChange,
}: {
  event: EventRow;
  djId: string;
  isOwnProfile: boolean;
  onFlyerChange: (url: string | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const dateLabel = formatDateLabel(event.event_date);
  const timeRange = formatTimeRange(event.start_time, event.end_time);
  const venueLine = event.venue_name?.trim()
    || event.venue_address?.split(',')[0]
    || '—';

  const mapUrl = event.venue_address
    ? (event.venue_lat != null && event.venue_lon != null
        ? `https://www.google.com/maps/search/?api=1&query=${event.venue_lat},${event.venue_lon}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue_address)}`)
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

  const hasFlyer = !!event.flyer_url;

  return (
    <div className={styles.row}>
      {/* Left column: flyer image (if set) OR upload button (owner only). */}
      {hasFlyer ? (
        <div className={styles.flyerWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={event.flyer_url || ''} alt="Event flyer" className={styles.flyerImg} />
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
        >
          {uploading ? 'Uploading…' : '+ Upload Flyer'}
        </button>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFile}
      />

      {/* Right: event details. */}
      <div className={styles.details}>
        <div className={styles.date}>{dateLabel}</div>
        <div className={styles.time}>{timeRange}</div>
        <div className={styles.venue}>
          {mapUrl ? (
            <a href={mapUrl} target="_blank" rel="noreferrer" className={styles.venueLink}>
              {venueLine}
            </a>
          ) : venueLine}
          {event.set_type && (
            <span className={styles.setType}> · {formatSetType(event.set_type)}</span>
          )}
        </div>
        {uploadErr && <div className={styles.errMsg}>{uploadErr}</div>}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatDateLabel(d: string): string {
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

function formatSetType(s: string): string {
  return s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
