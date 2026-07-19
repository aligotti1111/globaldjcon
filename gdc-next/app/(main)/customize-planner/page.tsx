'use client';

// /customize-planner?bookingId=…&eventType=… — the planner editor, on its OWN
// page so it opens in a new window.
//
// The "Preview / customize" and "Customize" buttons in the send modal open this
// with window.open, so the DJ arranges their template in a full browser window
// (not a modal-inside-a-page) and their bookings list stays put behind it.
//
// It reuses the exact same PlannerBuilder and the same /api/planners GET/PUT the
// modal used — this is just a different frame around them. Keyed by the DJ's
// event type (templates are per-DJ per-event-type, not per-booking); the
// bookingId is only there so the API can mark which fields the booking prefills.

import { useEffect, useState } from 'react';
import PlannerBuilder from '@/app/(main)/upcoming-bookings/PlannerBuilder';
import type { PlannerField, PlannerFieldType } from '@/lib/planner';
import styles from '@/app/(main)/upcoming-bookings/plannerSend.module.css';

export const dynamic = 'force-dynamic';

export default function CustomizePlannerPage() {
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [eventType, setEventType] = useState<string | null>(null);
  const [name, setName] = useState('your planner');

  const [fields, setFields] = useState<PlannerField[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Read params from the URL (client-only, so no Suspense boundary needed), then
  // load the template the same way the modal did.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const bId = q.get('bookingId') || '';
    const et = q.get('eventType'); // '' or null => the base/default template
    setBookingId(bId);
    setEventType(et && et.trim() ? et : null);
    if (q.get('name')) setName(q.get('name') as string);

    if (!/^[0-9a-f-]{36}$/i.test(bId)) { setErr('Missing booking.'); setLoaded(true); return; }
    (async () => {
      try {
        const qs = et && et.trim() ? `&eventType=${encodeURIComponent(et)}` : '';
        const res = await fetch(`/api/planners?bookingId=${bId}${qs}`);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { setErr(j?.error || 'Could not open the planner.'); setLoaded(true); return; }
        setFields(j.fields || []);
        setLoaded(true);
      } catch {
        setErr('Could not open the planner.');
        setLoaded(true);
      }
    })();
  }, []);

  // Editor callbacks — same as the modal's editFields handlers.
  function patch(id: string, p: Partial<PlannerField>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f)));
    setDirty(true); setSaved(false);
  }
  function reorder(next: PlannerField[]) { setFields(next); setDirty(true); setSaved(false); }
  function add(type: PlannerFieldType) {
    setFields((prev) => [...prev, { id: crypto.randomUUID(), type, label: '', is_custom: true }]);
    setDirty(true); setSaved(false);
  }
  function remove(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
    setDirty(true); setSaved(false);
  }

  async function save() {
    if (saving) return;
    setErr(null);
    const blank = fields.find((f) => !f.label.trim());
    if (blank) { setErr('Every question needs a label.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/planners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType,
          name: eventType ? `My ${eventType} planner` : 'My planner',
          fields,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j?.error || 'Could not save.'); setSaving(false); return; }
      setDirty(false);
      setSaved(true);
    } catch {
      setErr('Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.editor}>
      <div className={styles.editorBar}>
        <button type="button" className={styles.ghost} onClick={() => window.close()}>
          {dirty ? 'Close (unsaved)' : 'Close'}
        </button>
        <span className={styles.editorTitle}>Customize {name}</span>
        <button type="button" className={styles.primary} disabled={saving || !loaded} onClick={save}>
          {saving ? 'Saving…' : saved && !dirty ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      {err && <div className={styles.editorErr}>{err}</div>}
      <div className={styles.editorSheet}>
        {!loaded ? (
          <div style={{ color: '#8a8aa0', padding: '2rem 0' }}>Loading…</div>
        ) : (
          <PlannerBuilder
            fields={fields}
            eventType={eventType}
            onPatch={patch}
            onReorder={reorder}
            onRemove={remove}
            onAdd={add}
          />
        )}
      </div>
    </div>
  );
}
