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

// What a DJ can add. Deliberately a subset — `select` needs options and
// `prefill` needs a booking column, neither of which a free-text editor can
// safely invent.
const ADDABLE: PlannerFieldType[] = ['text', 'longtext', 'time', 'song', 'songlist', 'textlist', 'people', 'yesno'];

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

  const visibleCount = fields.filter((f) => !f.hidden).length;

  function patch(id: string, p: Partial<PlannerField>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f)));
    setDirty(true);
  }

  function move(i: number, dir: -1 | 1) {
    setFields((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      // Do NOT play and Notes are pinned to the end by the server on save, so
      // dragging them is theatre. Don't offer the move rather than silently
      // undoing it.
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
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
              What your client sees. {data.prefillCount > 0 ? `${data.prefillCount} answers arrive already filled in from the booking. ` : ''}
              Nothing is required — they fill in what they know and come back for the rest.
            </p>
            <ol className={styles.preview}>
              {fields.filter((f) => !f.hidden).map((f) => (
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
            <p className={styles.note}>
              Saves to <strong>your {data.eventType || 'default'} planner</strong> — every {data.eventType || 'booking'} after
              this one uses it automatically. Turned-off questions are kept, not deleted, so you can turn them back on.
            </p>

            <div className={styles.editList}>
              {fields.map((f, i) => {
                const pinned = f.id === NOTES_FIELD_ID || f.id === DO_NOT_PLAY_FIELD_ID;
                return (
                  <div key={f.id} className={f.hidden ? styles.rowOff : styles.row}>
                    <div className={styles.rowTop}>
                      <input
                        className={styles.labelInput}
                        value={f.label}
                        placeholder="Question"
                        onChange={(e) => patch(f.id, { label: e.target.value })}
                      />
                      <span className={styles.type}>{TYPE_LABELS[f.type]}</span>
                    </div>
                    <input
                      className={styles.helpInput}
                      value={f.help || ''}
                      placeholder="Help text (optional)"
                      onChange={(e) => patch(f.id, { help: e.target.value })}
                    />
                    <div className={styles.rowTools}>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={!f.hidden}
                          onChange={(e) => patch(f.id, { hidden: !e.target.checked })}
                        />
                        Ask this
                      </label>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={!!f.required}
                          onChange={(e) => patch(f.id, { required: e.target.checked })}
                        />
                        Required
                      </label>
                      <span className={styles.spacer} />
                      {/* Pinned questions don't move — the server re-pins them
                          to the end on save, so an arrow here would be a lie. */}
                      {!pinned && (
                        <>
                          <button type="button" className={styles.mv} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                          <button type="button" className={styles.mv} onClick={() => move(i, 1)} disabled={i === fields.length - 1}>↓</button>
                        </>
                      )}
                      {/* Only a custom field can be removed, and only because it
                          has no answers anywhere yet. Stock fields hide. */}
                      {f.is_custom && (
                        <button type="button" className={styles.rm} onClick={() => removeCustom(f.id)}>Remove</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={styles.addRow}>
              <span className={styles.addLabel}>Add a question:</span>
              {ADDABLE.map((t) => (
                <button key={t} type="button" className={styles.addBtn} onClick={() => addField(t)}>
                  + {TYPE_LABELS[t]}
                </button>
              ))}
            </div>

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
