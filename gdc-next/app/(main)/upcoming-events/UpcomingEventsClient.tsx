'use client';

// UpcomingEventsClient — host/venue view of all their booked events,
// nearest first. Mirrors UpcomingBookingsClient (the DJ-side equivalent)
// but stripped down: no rate/package fields, no DJ-specific UI. Manual
// events are events the user added themselves (no DJ may be attached).
//
// Capabilities for any row the user authored (requester_id === userId):
//   - Edit details (manual only)
//   - Add/replace flyer (manual only, since flyer is for promo)
//   - Add/edit external link (any row owned by the user)
//   - Delete (manual only)

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { UpcomingEvent } from './page';
import styles from './upcomingEvents.module.css';
import EventManualForm from './EventManualForm';

interface Props {
  userId: string;
  userCountry: string;
  userName: string;
  initialEvents: UpcomingEvent[];
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function UpcomingEventsClient({
  userId, userCountry, userName, initialEvents,
}: Props) {
  const [events, setEvents] = useState<UpcomingEvent[]>(initialEvents);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editing, setEditing] = useState<UpcomingEvent | null>(null);

  // Group events by year-month for "Aug 2026" / "Sep 2026" section headers.
  const grouped = groupByMonth(events);

  async function handleAdded(newEvent: UpcomingEvent) {
    setEvents((prev) => {
      const next = [...prev, newEvent];
      next.sort(sortByDateTimeAsc);
      return next;
    });
    setShowAddModal(false);
  }
  async function handleUpdated(updated: UpcomingEvent) {
    setEvents((prev) => {
      const next = prev.map((e) => (e.id === updated.id ? updated : e));
      next.sort(sortByDateTimeAsc);
      return next;
    });
    setEditing(null);
  }
  async function handleDeleted(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Upcoming Events</h1>
          <p className={styles.subtitle}>All your confirmed events, nearest first.</p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/booking-requests" className={styles.linkBack}>← Back to bookings</Link>
          <button
            type="button"
            className={styles.addBtn}
            onClick={() => setShowAddModal(true)}
          >
            + Add Event
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <div className={styles.empty}>
          <p>You don&apos;t have any upcoming events yet.</p>
          <p className={styles.emptyHint}>
            Click <strong>Add Event</strong> to record one manually.
          </p>
        </div>
      ) : (
        grouped.map(({ key, label, items }) => (
          <section key={key} className={styles.monthGroup}>
            <h2 className={styles.monthHeading}>{label}</h2>
            <div className={styles.eventList}>
              {items.map((ev) => (
                <EventRow
                  key={ev.id}
                  event={ev}
                  userId={userId}
                  onEdit={() => setEditing(ev)}
                  onDeleted={() => handleDeleted(ev.id)}
                  onLinkSaved={(url, label) => {
                    setEvents((prev) => prev.map((e) => (
                      e.id === ev.id ? { ...e, link_url: url, link_label: label } : e
                    )));
                  }}
                  onFlyerSaved={(url) => {
                    setEvents((prev) => prev.map((e) => (
                      e.id === ev.id ? { ...e, flyer_url: url } : e
                    )));
                  }}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {(showAddModal || editing) && (
        <EventManualForm
          userId={userId}
          userCountry={userCountry}
          userName={userName}
          existing={editing}
          existingEvents={events}
          onClose={() => { setShowAddModal(false); setEditing(null); }}
          onAdded={handleAdded}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────

function EventRow({
  event, userId, onEdit, onDeleted, onLinkSaved, onFlyerSaved,
}: {
  event: UpcomingEvent;
  userId: string;
  onEdit: () => void;
  onDeleted: () => void;
  onLinkSaved: (url: string | null, label: string | null) => void;
  onFlyerSaved: (url: string | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const isManual = event.is_manual;
  // Hosts/venues can upload a flyer to:
  //   - Any manual event they added (no DJ or any DJ)
  //   - Any approved club/bar booking they made
  // Mobile (private-party) bookings don't get flyer slots — those aren't
  // public-facing promotional events.
  const canUploadFlyer = isManual || event.booking_type === 'club';

  const dateParts = parseDateParts(event.event_date);
  const timeRange = formatTimeRange(event.start_time, event.end_time);
  const venueLine = event.venue_name?.trim() || event.venue_address?.split(',')[0] || '—';
  const mapUrl = event.venue_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue_address)}`
    : null;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${userId}/flyers/${event.id}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) throw uploadErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
      const { error: updErr } = await supabase
        .from('bookings')
        .update({ flyer_url: publicUrl } as unknown as never)
        .eq('id', event.id)
        .eq('requester_id', userId);
      if (updErr) throw updErr;
      onFlyerSaved(publicUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this event? This cannot be undone.')) return;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', event.id)
        .eq('requester_id', userId)
        .eq('is_manual', true);
      if (error) throw error;
      onDeleted();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className={styles.row}>
      {/* Flyer / upload slot. Manual events + approved club/bar bookings
          can have flyers uploaded by the host/venue. Mobile bookings stay
          read-only (private events, no flyer). */}
      {event.flyer_url ? (
        <img src={event.flyer_url} alt="Event flyer" className={styles.flyer} />
      ) : canUploadFlyer ? (
        <button
          type="button"
          className={styles.flyerSlot}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Upload flyer"
        >
          {uploading ? '…' : '+ Flyer'}
        </button>
      ) : (
        <div className={styles.flyerEmpty} />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFile}
      />

      <div className={styles.datePill}>
        <div className={styles.dayNum}>{dateParts.day}</div>
        <div className={styles.dayMeta}>
          <div className={styles.dow}>{dateParts.dow}</div>
          <div className={styles.mo}>{dateParts.mo}</div>
        </div>
      </div>

      <div className={styles.middle}>
        <div className={styles.venue}>{venueLine}</div>
        <div className={styles.meta}>{timeRange}</div>
        {event.venue_address && (
          <div className={styles.meta}>
            {mapUrl ? (
              <a href={mapUrl} target="_blank" rel="noreferrer" className={styles.metaLink}>
                {event.venue_address}
              </a>
            ) : event.venue_address}
          </div>
        )}
        {event.dj_name && (
          <div className={styles.metaDj}>DJ: {event.dj_name}</div>
        )}
      </div>

      <div className={styles.actions}>
        {event.link_url && (
          <a
            href={event.link_url}
            target="_blank"
            rel="noreferrer"
            className={styles.linkCta}
          >
            {event.link_label?.trim() || 'More Info'}
          </a>
        )}
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => setShowLinkModal(true)}
          title={event.link_url ? 'Edit link' : 'Add link'}
          aria-label={event.link_url ? 'Edit link' : 'Add link'}
        >
          <PaperclipIcon />
        </button>
        {isManual && (
          <>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onEdit}
              title="Edit details"
              aria-label="Edit details"
            >
              <PencilIcon />
            </button>
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
              onClick={handleDelete}
              title="Delete event"
              aria-label="Delete event"
            >
              <TrashIcon />
            </button>
          </>
        )}
      </div>

      {showLinkModal && (
        <LinkModal
          bookingId={event.id}
          requesterId={userId}
          initialUrl={event.link_url || ''}
          initialLabel={event.link_label || ''}
          onClose={() => setShowLinkModal(false)}
          onSaved={(url, label) => {
            onLinkSaved(url, label);
            setShowLinkModal(false);
          }}
        />
      )}
    </div>
  );
}

// ── Link modal ────────────────────────────────────────────────────────

function LinkModal({
  bookingId, requesterId, initialUrl, initialLabel, onClose, onSaved,
}: {
  bookingId: string;
  requesterId: string;
  initialUrl: string;
  initialLabel: string;
  onClose: () => void;
  onSaved: (url: string | null, label: string | null) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [label, setLabel] = useState(initialLabel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const trimmedUrl = url.trim();
    const trimmedLabel = label.trim();
    if (trimmedUrl && !/^https?:\/\//i.test(trimmedUrl)) {
      setError('URL must start with http:// or https://');
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: e } = await supabase
        .from('bookings')
        .update({
          link_url: trimmedUrl || null,
          link_label: trimmedLabel || null,
        } as unknown as never)
        .eq('id', bookingId)
        .eq('requester_id', requesterId);
      if (e) throw e;
      onSaved(trimmedUrl || null, trimmedLabel || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  }
  async function handleRemove() {
    if (!confirm('Remove this link?')) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: e } = await supabase
        .from('bookings')
        .update({ link_url: null, link_label: null } as unknown as never)
        .eq('id', bookingId)
        .eq('requester_id', requesterId);
      if (e) throw e;
      onSaved(null, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove failed');
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modalSmall} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{initialUrl ? 'Edit Link' : 'Add Link'}</h3>
          <button type="button" className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>URL</span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/tickets"
              className={styles.input}
              autoFocus
              autoComplete="off"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Button Label <span className={styles.fieldOptional}>(optional — defaults to &ldquo;More Info&rdquo;, {20 - label.length} left)</span>
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Purchase Tickets"
              className={styles.input}
              maxLength={20}
            />
          </label>
          {error && <div className={styles.error}>{error}</div>}
        </div>
        <div className={styles.modalActions}>
          {initialUrl && (
            <button type="button" className={styles.removeBtn} onClick={handleRemove} disabled={saving}>
              Remove
            </button>
          )}
          <div className={styles.actionsRight}>
            <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className={styles.saveBtn} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function groupByMonth(events: UpcomingEvent[]): Array<{ key: string; label: string; items: UpcomingEvent[] }> {
  const map = new Map<string, { label: string; items: UpcomingEvent[] }>();
  for (const ev of events) {
    if (!ev.event_date) continue;
    const [y, m] = ev.event_date.split('-').map((s) => parseInt(s, 10));
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const label = `${MONTH_NAMES[m - 1]} ${y}`;
    if (!map.has(key)) map.set(key, { label, items: [] });
    map.get(key)!.items.push(ev);
  }
  return Array.from(map.entries()).map(([key, { label, items }]) => ({ key, label, items }));
}

function sortByDateTimeAsc(a: UpcomingEvent, b: UpcomingEvent): number {
  const da = (a.event_date || '') + ' ' + (a.start_time || '');
  const db = (b.event_date || '') + ' ' + (b.start_time || '');
  return da.localeCompare(db);
}

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
  return '';
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

// ── Icons ─────────────────────────────────────────────────────────────

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  );
}
function PaperclipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
