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
import { titleCaseLabel } from '@/lib/planner';
import type { PlannerField, PlannerFieldType } from '@/lib/planner';
import { MOB_EVENT_LABELS } from '@/lib/constants';
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
  editEventType: string | null;
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

  const [mode, setMode] = useState<'confirm' | 'preview'>('confirm');
  // Which template to send. null = whatever the server resolves, which is the
  // default and the one-click path.
  const [forcedId, setForcedId] = useState<string | null>(null);
  const [fields, setFields] = useState<PlannerField[]>([]);

  // Customising now happens in its own window (/customize-planner), not here —
  // so the modal stays a slim confirm/preview and the editor gets a full window.

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

  // Open the editor for a SPECIFIC planner — the "customise" link on each row.
  // Now opens in its OWN browser window (/customize-planner) so the DJ arranges
  // the template in a full window and this bookings list stays put behind it.
  // window.open (not a link) so the tab is script-opened and can close itself.
  function openCustomize(eventType: string | null, name: string) {
    const qs = new URLSearchParams({ bookingId, name });
    if (eventType) qs.set('eventType', eventType);
    window.open(`/customize-planner?${qs.toString()}`, '_blank');
  }

  async function send() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
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

  // Customising is a separate window now (openCustomize → /customize-planner),
  // so this component is only ever the slim confirm/preview modal.

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2 className={styles.title}>
            {mode === 'preview' ? 'Preview · how the host sees it' : 'Send Planner & Playlist'}
          </h2>
          <button type="button" className={styles.x} onClick={onClose} aria-label="Close">×</button>
        </div>

        {!data && !err && <div className={styles.quiet}>Loading…</div>}
        {err && <div className={styles.err}>{err}</div>}

        {data && mode === 'confirm' && (
          <>
            <div className={styles.summary}>
              {/* Event info at the TOP — date, kind of party, venue — so the DJ
                  is sure they're on the right booking before anything else. */}
              <div className={styles.sumRow}>
                <span className={styles.k}>Date</span>
                <span className={styles.v}>{fmtDate(data.event.date) || <span className={styles.dim}>—</span>}</span>
              </div>
              <div className={styles.sumRow}>
                <span className={styles.k}>Event</span>
                <span className={styles.v}>{data.eventType ? (MOB_EVENT_LABELS[data.eventType] || '—') : '—'}</span>
              </div>
              {data.event.venue && (
                <div className={styles.sumRow}>
                  <span className={styles.k}>Venue</span>
                  <span className={styles.v}>{data.event.venue}</span>
                </div>
              )}

              <div className={styles.sumRow}>
                <span className={styles.k}>Planner</span>
                <span className={styles.v}>
                  {chosen ? chosen.name : data.resolved.name}
                  <span className={styles.tag}>
                    {(chosen ? chosen.isMine : data.resolved.isMine) ? 'yours' : 'standard'}
                  </span>
                </span>
              </div>

              {/* Pick a different planner (radios). No per-row links — Customize
                  and Preview are single buttons below, acting on the selection. */}
              {data.templates.length > 1 && (
                <div className={styles.altList}>
                  <div className={styles.altRow}>
                    <button
                      type="button"
                      className={!forcedId ? styles.altOn : styles.alt}
                      onClick={() => setForcedId(null)}
                    >
                      <span className={styles.altDot} aria-hidden="true" />
                      {data.resolved.name}
                      <span className={styles.tagAuto}>auto</span>
                    </button>
                  </div>
                  {data.templates
                    .filter((t) => t.id !== data.resolved.id)
                    .map((t) => (
                      <div key={t.id} className={styles.altRow}>
                        <button
                          type="button"
                          className={forcedId === t.id ? styles.altOn : styles.alt}
                          onClick={() => setForcedId(t.id)}
                        >
                          <span className={styles.altDot} aria-hidden="true" />
                          {t.name}
                          {t.isMine && <span className={styles.tag}>yours</span>}
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className={styles.foot}>
              <button type="button" className={styles.ghost} onClick={onClose}>Cancel</button>
              <button type="button" className={styles.ghost} onClick={() => setMode('preview')}>Preview</button>
              {/* Customize the SELECTED planner — opens the editor in its own window. */}
              <button
                type="button"
                className={styles.ghost}
                onClick={() => openCustomize(
                  chosen ? chosen.eventType : data.editEventType,
                  chosen ? chosen.name : data.resolved.name,
                )}
              >
                Customize
              </button>
              <button type="button" className={styles.primary} onClick={send} disabled={busy}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}

        {data && mode === 'preview' && (
          <>
            <p className={styles.note}>
              This is the page your client fills in. The booking details up top are
              filled in for them; everything below is what they’ll be asked.
            </p>

            {/* Your booking — the read-only strip the host sees at the top of
                their page, populated with THIS event. */}
            <div className={styles.shown}>
              <span className={styles.shownHead}>Your booking</span>
              {[
                data.eventType ? (MOB_EVENT_LABELS[data.eventType] || '') : '',
                fmtDate(data.event.date),
                data.event.venue || '',
              ].filter(Boolean).join('  ·  ')}
              {shown.length > 0 && (
                <> · {shown.map((f) => titleCaseLabel(f.label)).join(' · ')}</>
              )}
            </div>

            <ol className={styles.preview}>
              {asked.map((f) => (
                <li key={f.id} className={styles.pvRow}>
                  <span className={styles.pvLabel}>
                    {titleCaseLabel(f.label)}
                    {f.required ? <span className={styles.req}>required</span> : null}
                  </span>
                  {f.help ? <span className={styles.pvHelp}>{f.help}</span> : null}
                  <span className={styles.pvType}>{TYPE_LABELS[f.type]}</span>
                </li>
              ))}
            </ol>
            <div className={styles.foot}>
              <button type="button" className={styles.ghost} onClick={() => setMode('confirm')}>Back</button>
              {/* Customize the SELECTED planner in its own window. */}
              <button
                type="button"
                className={styles.ghost}
                onClick={() => openCustomize(
                  chosen ? chosen.eventType : data.editEventType,
                  chosen ? chosen.name : data.resolved.name,
                )}
              >
                Customize
              </button>
              <button type="button" className={styles.primary} onClick={send} disabled={busy}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
