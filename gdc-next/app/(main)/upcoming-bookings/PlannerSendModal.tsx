'use client';

// Request planner — the confirmation, and the editor behind it.
//
// A CONFIRMATION, NOT A QUESTIONNAIRE. It opens already decided: the booking's
// event type resolved to a template, so it says "Wedding planner · 34 questions
// · going to Jordan" and offers one button. The 90% case is Send and gone.
//
// The other planners are listed right in the box rather than hidden behind a
// link: a DJ who doesn't know an alternative exists never goes looking for one,
// and the list is four lines.
//
// Preview shows the client's actual questions, and Customize lives inside it —
// because "change this" is a thought you have while READING it, not before.
//
// AND CUSTOMISING SAVES. That's the whole point of the editor existing here
// rather than being a per-send scratchpad: edit the wedding planner once, and
// every wedding after that resolves to your version with zero clicks. You can
// still open it and change it whenever. (Spec §6b: "save once, send forever".)
//
// THE EDITOR IS DELIBERATELY NOT A FORM BUILDER. A blank canvas is weeks of
// work whose main achievement is letting a DJ build a broken form. It's
// constrained editing of a known field set: hide, rename, re-order, add your
// own. Stock questions are HIDDEN, never deleted — `responses` is keyed by
// field id, and a deleted field takes every answer ever given to it with it.

import { useEffect, useState } from 'react';
import type { PlannerField, PlannerFieldType } from '@/lib/planner';
import { NOTES_FIELD_ID, DO_NOT_PLAY_FIELD_ID } from '@/lib/planner';
import PlannerBuilder from './PlannerBuilder';
import styles from './plannerSend.module.css';

interface TemplateLite {
  id: string;
  name: string;
  eventType: string | null;
  isStandard: boolean;
  isMine: boolean;
  count: number;
}

interface Loaded {
  resolved: { id: string; name: string; eventType: string | null; isStandard: boolean; isMine: boolean };
  fields: PlannerField[];
  prefillCount: number;
  prefilledIds: string[];
  recipient: { name: string | null; email: string | null; hasAccount: boolean };
  eventType: string | null;
  event: { date: string | null; venue: string | null };
  templates: TemplateLite[];
}

// "2027-01-11" -> "January 11, 2027".
// T12:00:00, not bare — `new Date('2027-01-11')` is UTC midnight and renders as
// the 10th in every US timezone. Same bug as the check memo and the planner page.
function fmtDate(d: string | null): string {
  if (!d) return 'Date TBC';
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

const TYPE_LABELS: Record<PlannerFieldType, string> = {
  text: 'Short text', longtext: 'Paragraph', time: 'Time', song: 'One song',
  songlist: 'Song list', textlist: 'Text list', people: 'People', timeline: 'Run of show',
  yesno: 'Yes / no', select: 'Choice', link: 'Link',
};

export default function PlannerSendModal({
  bookingId, onClose, onSent,
}: {
  bookingId: string;
  onClose: () => void;
  onSent: (r: { id: string; status: 'sent' | 'partial' | 'submitted'; warning?: string }) => void;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<'confirm' | 'preview' | 'edit'>('confirm');
  // Which template to send. null = whatever the server resolves, which is the
  // default and the one-click path.
  const [forcedId, setForcedId] = useState<string | null>(null);
  const [fields, setFields] = useState<PlannerField[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/planners?bookingId=${bookingId}`);
        const j = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) { setErr(j?.error || 'Could not load.'); return; }
        setData(j);
        setFields(j.fields || []);
      } catch {
        if (active) setErr('Could not load.');
      }
    })();
    return () => { active = false; };
  }, [bookingId]);

  // If we know it, we show it; if we don't, we ask it. `prefilledIds` is what
  // the server's own applyPrefill came back with for THIS booking — so a field
  // with no value on this booking correctly stays a question.
  const prefilled = new Set(data?.prefilledIds || []);
  const visible = fields.filter((f) => !f.hidden);
  const asked = visible.filter((f) => !prefilled.has(f.id));
  const shown = visible.filter((f) => prefilled.has(f.id));
  // The number the client actually faces. Counting the ones we fill in for them
  // would overstate the form by four and understate the feature.
  const visibleCount = asked.length;

  function patch(id: string, p: Partial<PlannerField>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f)));
    setDirty(true);
  }

  // Drag-drop reorder: pull `from` out and splice it back at `to`. move() (the
  // arrow version) is a special case of this, but keeping both is cheaper than
  // rewriting the arrow calls.
  function moveTo(from: number, to: number) {
    setFields((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });
    setDirty(true);
  }

  function addField(type: PlannerFieldType) {
    setFields((prev) => [
      ...prev,
      {
        // A FRESH uuid, always. Reusing or deriving an id is how two questions
        // collide in `responses` and the second silently overwrites the first.
        id: crypto.randomUUID(),
        type,
        label: '',
        is_custom: true,
      },
    ]);
    setDirty(true);
  }

  function removeCustom(id: string) {
    // Only ever a custom field the DJ just added, and only here in the editor.
    // Stock fields hide; they never splice.
    setFields((prev) => prev.filter((f) => f.id !== id));
    setDirty(true);
  }

  async function saveTemplate(): Promise<boolean> {
    if (!data) return false;
    setErr(null);
    const blank = fields.find((f) => !f.label.trim());
    if (blank) { setErr('Every question needs a label.'); return false; }
    try {
      const res = await fetch('/api/planners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Scoped to THIS booking's event type. Editing from a wedding saves
          // your wedding planner — it doesn't touch your Sweet 16 one.
          eventType: data.eventType,
          name: data.eventType ? `My ${data.eventType} planner` : 'My planner',
          fields,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j?.error || 'Could not save.'); return false; }
      setDirty(false);
      // Saved as THEIR template — so the send must now resolve to it, not to
      // the stock row that was picked when the modal opened.
      setForcedId(null);
      return true;
    } catch {
      setErr('Could not save.');
      return false;
    }
  }

  async function send() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      // Unsaved edits get saved first. A DJ who edited, hit Send, and watched
      // the old questions go out would be right to never trust the editor again.
      if (dirty) {
        const ok = await saveTemplate();
        if (!ok) { setBusy(false); return; }
      }
      const res = await fetch('/api/planner/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, ...(forcedId ? { plannerId: forcedId } : {}) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j?.error || 'Could not send.'); setBusy(false); return; }
      onSent({ id: j.id, status: j.status || 'sent', warning: j.warning });
    } catch {
      setErr('Could not send.');
      setBusy(false);
    }
  }

  const chosen = forcedId ? data?.templates.find((t) => t.id === forcedId) : null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2 className={styles.title}>
            {mode === 'edit' ? 'Customize questions' : mode === 'preview' ? 'Preview / customize' : 'Send Planner & Playlist'}
          </h2>
          <button type="button" className={styles.x} onClick={onClose} aria-label="Close">×</button>
        </div>

        {!data && !err && <div className={styles.quiet}>Loading…</div>}
        {err && <div className={styles.err}>{err}</div>}

        {data && mode === 'confirm' && (
          <>
            <div className={styles.summary}>
              <div className={styles.sumRow}>
                <span className={styles.k}>Planner</span>
                <span className={styles.v}>
                  {chosen ? chosen.name : data.resolved.name}
                  {/* "yours" vs "standard" is the difference between "I set this
                      up" and "this is what everyone gets" — and it's the only
                      hint that customising is a thing that exists. */}
                  <span className={styles.tag}>
                    {(chosen ? chosen.isMine : data.resolved.isMine) ? 'yours' : 'standard'}
                  </span>
                </span>
              </div>

              {/* The alternatives, in the box. The auto pick is a row like any
                  other so it can be chosen BACK after a wander down the list —
                  a link that only goes one way is a trap. */}
              {data.templates.length > 1 && (
                <div className={styles.altList}>
                  <button
                    type="button"
                    className={!forcedId ? styles.altOn : styles.alt}
                    onClick={() => setForcedId(null)}
                  >
                    <span className={styles.altDot} aria-hidden="true" />
                    {data.resolved.name}
                    <span className={styles.tagAuto}>auto</span>
                  </button>
                  {data.templates
                    .filter((t) => t.id !== data.resolved.id)
                    .map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={forcedId === t.id ? styles.altOn : styles.alt}
                        onClick={() => setForcedId(t.id)}
                      >
                        <span className={styles.altDot} aria-hidden="true" />
                        {t.name}
                        {t.isMine && <span className={styles.tag}>yours</span>}
                      </button>
                    ))}
                </div>
              )}

              {/* Date · venue · who, on one line. The DJ is confirming they're
                  on the right ROW as much as the right planner — "am I about to
                  mail the Venetian wedding's planner to the birthday party?" —
                  and a question count can't answer that. */}
              <div className={styles.sumRow}>
                <span className={styles.k}>Event</span>
                <span className={styles.v}>
                  {fmtDate(data.event.date)}
                  {data.event.venue ? <span className={styles.sep}> · </span> : null}
                  {data.event.venue}
                  <span className={styles.sep}> · </span>
                  {data.recipient.email
                    ? data.recipient.email
                    : data.recipient.hasAccount
                      ? <span className={styles.dim}>their account email</span>
                      : <em className={styles.warn}>no email</em>}
                </span>
              </div>

              {data.prefillCount > 0 && (
                <div className={styles.sumRow}>
                  <span className={styles.k}>Prefilled</span>
                  {/* Worth saying out loud: it's the reason the client doesn't
                      abandon the form on question three retyping their venue. */}
                  <span className={styles.v}>{data.prefillCount} answers from the booking</span>
                </div>
              )}
            </div>

            <div className={styles.links}>
              <button type="button" className={styles.linkBtn} onClick={() => setMode('preview')}>
                Preview / customize
              </button>
              <span className={styles.dot}>·</span>
              <span className={styles.dim}>{visibleCount} questions</span>
            </div>

            <div className={styles.foot}>
              <button type="button" className={styles.ghost} onClick={onClose}>Cancel</button>
              <button type="button" className={styles.primary} onClick={send} disabled={busy}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}

        {data && mode === 'preview' && (
          <>
            <p className={styles.note}>
              What your client sees. Nothing is required — they fill in what they know
              and come back for the rest.
            </p>

            {/* Shown, not asked. Anything we already have off the booking is a
                read-only line at the top of their form — asking a client to type
                their own venue back to us is how they abandon it on question
                three and never tell you the first dance. They're listed here so
                the count below is the real one. */}
            {shown.length > 0 && (
              <div className={styles.shown}>
                <span className={styles.shownHead}>Filled in for them</span>
                {shown.map((f) => f.label).join(' · ')}
              </div>
            )}

            <ol className={styles.preview}>
              {asked.map((f) => (
                <li key={f.id} className={styles.pvRow}>
                  <span className={styles.pvLabel}>
                    {f.label}
                    {f.required ? <span className={styles.req}>required</span> : null}
                  </span>
                  {f.help ? <span className={styles.pvHelp}>{f.help}</span> : null}
                  <span className={styles.pvType}>{TYPE_LABELS[f.type]}</span>
                </li>
              ))}
            </ol>
            <div className={styles.foot}>
              <button type="button" className={styles.ghost} onClick={() => setMode('confirm')}>Back</button>
              {/* Customize is here, not on the confirm screen: "change this" is
                  a thought you have while reading the questions. */}
              <button type="button" className={styles.primary} onClick={() => setMode('edit')}>
                Customize
              </button>
            </div>
          </>
        )}

        {data && mode === 'edit' && (
          <>
            <PlannerBuilder
              fields={fields}
              eventType={data.eventType}
              onPatch={patch}
              onMoveTo={moveTo}
              onRemove={removeCustom}
              onAdd={addField}
            />

            <div className={styles.foot}>
              {/* Back to the preview, not the confirm screen — that's where you
                  came from, and you'll want to see what you just changed. */}
              <button type="button" className={styles.ghost} onClick={() => setMode('preview')}>Back</button>
              <button
                type="button"
                className={styles.primary}
                disabled={busy}
                onClick={async () => { const ok = await saveTemplate(); if (ok) setMode('preview'); }}
              >
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
