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
  // Which STOCK template this edit forks. Comes back from the API's GET
  // (editTemplateKey) and is handed to the save so the DJ's copy is stored as
  // an INDEPENDENT per-template fork — two templates of one event type (the two
  // Wedding variants) never share a row. null for a from-scratch custom.
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [name, setName] = useState('your planner');
  // A brand-new custom planner (from Booking Settings' "Create custom"). It's
  // standalone and starts empty — the DJ builds it from scratch — so there's no
  // template to fetch and its save carries the real name, not "My … planner".
  const [isCustom, setIsCustom] = useState(false);

  const [fields, setFields] = useState<PlannerField[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // ── Planner theme (per-DJ, not per-template) ──────────────────────────────
  // The background (dark/light) and accent colour apply to EVERY planner this DJ
  // sends, so these save to the DJ's row via /api/dj/planner-theme — separate
  // from the template's fields, which save to /api/planners. Auto-saved on change.
  const DEFAULT_ACCENT = '#00f5c4';
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [accent, setAccent] = useState<string | null>(null);
  const [themeStatus, setThemeStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/dj/planner-theme');
        const j = await res.json().catch(() => ({}));
        if (res.ok) {
          setTheme(j.theme === 'light' ? 'light' : 'dark');
          setAccent(typeof j.accent === 'string' ? j.accent : null);
        }
      } catch { /* non-fatal — the defaults stand */ }
    })();
  }, []);

  async function saveTheme(patch: { theme?: 'dark' | 'light'; accent?: string | null }) {
    setThemeStatus('saving');
    try {
      const res = await fetch('/api/dj/planner-theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      setThemeStatus(res.ok ? 'saved' : 'error');
    } catch {
      setThemeStatus('error');
    }
  }

  // Read params from the URL (client-only, so no Suspense boundary needed), then
  // load the template the same way the modal did.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const bId = q.get('bookingId') || '';
    const et = q.get('eventType'); // '' or null => the base/default template
    const tid = (q.get('templateId') || '').trim(); // exact row (weddings: with/without ceremony)
    // A NEW custom planner: ?custom=<key> carries its unique event_type marker.
    const customKey = (q.get('custom') || '').trim();
    setBookingId(bId);
    if (q.get('name')) setName(q.get('name') as string);

    // Brand-new custom planner — nothing to load, start with a blank sheet.
    if (customKey) {
      setIsCustom(true);
      setEventType(customKey);
      setFields([]);
      setLoaded(true);
      return;
    }

    setEventType(et && et.trim() ? et : null);

    (async () => {
      try {
        // Two ways in:
        //   · from a booking (send modal)      → ?bookingId=… (marks prefilled fields)
        //   · from Booking Settings' library   → no booking; compose by event type
        // With no booking we ALWAYS pass eventType (empty = the base planner) so
        // the API composes fields to edit rather than returning the template list.
        const hasBooking = /^[0-9a-f-]{36}$/i.test(bId);
        const apiUrl = hasBooking
          ? `/api/planners?bookingId=${bId}${et && et.trim() ? `&eventType=${encodeURIComponent(et)}` : ''}`
          // A specific template id (weddings: with / without ceremony) takes
          // priority over event type, which can't tell the two apart. Without an
          // id we still send the name so the API can disambiguate on it.
          : tid
            ? `/api/planners?templateId=${encodeURIComponent(tid)}`
            : `/api/planners?eventType=${encodeURIComponent(et && et.trim() ? et.trim() : '')}${q.get('name') ? `&name=${encodeURIComponent(q.get('name') as string)}` : ''}`;
        const res = await fetch(apiUrl);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { setErr(j?.error || 'Could not open the planner.'); setLoaded(true); return; }
        setFields(j.fields || []);
        // The key a save writes to — the stock template this edit forks. Kept
        // so reopening the same template loads the DJ's own version, not the
        // stock defaults again.
        if (typeof j.editTemplateKey === 'string') setTemplateKey(j.editTemplateKey);
        setLoaded(true);
      } catch {
        setErr('Could not open the planner.');
        setLoaded(true);
      }
    })();
  }, []);

  // Unsaved-changes guard. While there are edits that haven't been saved, the
  // browser warns on any attempt to close the tab, refresh, or navigate away —
  // the DJ's rearranged planner shouldn't vanish because they hit ⌘W. Cleared
  // the moment a save succeeds (dirty=false), so a saved page leaves silently.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // The Close button — a confirm when there's unsaved work, straight out when
  // there isn't. (beforeunload above doesn't fire for a scripted window.close().)
  function handleClose() {
    if (dirty && !window.confirm('You have unsaved changes to this planner. Leave without saving?')) return;
    window.close();
  }

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
    // Drop half-added questions that were never named — a DJ who clicked "add"
    // and didn't fill anything in shouldn't be blocked from saving. Dividers
    // never carry a label, so they're always kept; only the DJ's own labelled
    // additions (is_custom) are droppable when blank; a stock field never blanks.
    const structural = (t: string) => t === 'divider' || t === 'space' || t === 'section';
    const cleaned = fields.filter((f) => structural(f.type) || f.label.trim() !== '' || !f.is_custom);
    const blank = cleaned.find((f) => !structural(f.type) && !f.label.trim());
    if (blank) { setErr('Every question needs a label.'); return; }
    if (cleaned.length !== fields.length) setFields(cleaned);
    setSaving(true);
    try {
      const res = await fetch('/api/planners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType,
          // Forks the specific stock template (keeps the two Wedding variants
          // independent). Absent on a from-scratch custom, which keys on its
          // own event_type marker instead.
          templateKey,
          // A custom planner keeps the name the DJ typed; the derived
          // "My … planner" is only for editing a stock event-type template.
          name: isCustom ? name : (eventType ? `My ${eventType} planner` : 'My planner'),
          fields: cleaned,
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
        <button type="button" className={styles.ghost} onClick={handleClose}>
          {dirty ? 'Close (unsaved)' : 'Close'}
        </button>
        <span className={styles.editorTitle}>{isCustom ? `New: ${name}` : `Customize ${name}`}</span>
        <button type="button" className={styles.primary} disabled={saving || !loaded} onClick={save}>
          {saving ? 'Saving…' : saved && !dirty ? 'Saved ✓' : isCustom ? 'Create template' : 'Save'}
        </button>
      </div>
      {err && <div className={styles.editorErr}>{err}</div>}

      {/* Planner colours. One row: a light/dark background toggle and the accent
          picker. These are the DJ's, not this template's — the note says so. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '1.1rem', flexWrap: 'wrap',
          padding: '.7rem 1rem', borderBottom: '1px solid rgba(255,255,255,.08)',
          fontSize: '.82rem', color: '#c7c7d6',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span style={{ color: '#8a8aa0' }}>Background</span>
          <div style={{ display: 'inline-flex', border: '1px solid #2b2b40', borderRadius: 8, overflow: 'hidden' }}>
            {(['dark', 'light'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTheme(t); saveTheme({ theme: t }); }}
                style={{
                  padding: '.4rem .8rem', border: 'none', cursor: 'pointer',
                  background: theme === t ? '#00f5c4' : 'transparent',
                  color: theme === t ? '#06231b' : '#9a9ab0',
                  fontWeight: theme === t ? 700 : 500, fontSize: '.8rem',
                  textTransform: 'capitalize',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span style={{ color: '#8a8aa0' }}>Accent</span>
          <input
            type="color"
            aria-label="Accent colour"
            value={accent || DEFAULT_ACCENT}
            onChange={(e) => setAccent(e.target.value)}
            onBlur={() => saveTheme({ accent: accent || DEFAULT_ACCENT })}
            style={{
              width: 34, height: 28, padding: 0, border: '1px solid #2b2b40',
              borderRadius: 6, background: 'transparent', cursor: 'pointer',
            }}
          />
          <code style={{ color: '#9a9ab0', fontSize: '.76rem' }}>{(accent || DEFAULT_ACCENT).toUpperCase()}</code>
          {accent && accent.toLowerCase() !== DEFAULT_ACCENT && (
            <button
              type="button"
              onClick={() => { setAccent(null); saveTheme({ accent: null }); }}
              style={{
                background: 'none', border: 'none', color: '#6a6a80',
                textDecoration: 'underline', cursor: 'pointer', fontSize: '.74rem',
              }}
            >
              Reset
            </button>
          )}
        </div>

        {/* The editor below is the field BUILDER, not a themed preview — the
            colours only show on the page the client sees. This opens that page
            so the DJ can actually see the background/accent they picked. Colours
            auto-save on change, so the preview reflects the latest pick. */}
        <button
          type="button"
          onClick={() => {
            const q = /^[0-9a-f-]{36}$/i.test(bookingId || '')
              ? `bookingId=${bookingId}`
              : `eventType=${encodeURIComponent(eventType || '')}`;
            window.open(`/planner-preview?${q}`, '_blank');
          }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '.3rem',
            padding: '.4rem .7rem', borderRadius: 8, cursor: 'pointer',
            border: '1px solid #2b2b40', background: 'transparent',
            color: '#c7c7d6', fontSize: '.78rem', fontWeight: 600,
          }}
        >
          See preview ↗
        </button>

        <span style={{ color: '#6a6a80', fontSize: '.74rem', marginLeft: 'auto' }}>
          {themeStatus === 'saving' ? 'Saving…'
            : themeStatus === 'saved' ? 'Colours saved ✓ — open preview to see them'
            : themeStatus === 'error' ? 'Could not save colours'
            : 'Colours apply to what your client sees, on all your templates'}
        </span>
      </div>

      <div className={styles.editorSheet}>
        {!loaded ? (
          <div style={{ color: '#8a8aa0', padding: '2rem 0' }}>Loading…</div>
        ) : (
          <PlannerBuilder
            fields={fields}
            eventType={eventType}
            bookingId={bookingId}
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
