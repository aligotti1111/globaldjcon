'use client';

// Request planner — the confirmation.
//
// A CONFIRMATION, NOT A QUESTIONNAIRE. It opens already decided: the booking's
// event type resolved to a template, so it shows the event up top and the
// planner that's about to go, with one Send button. The 90% case is Send and
// gone.
//
// The other planners are listed right in the box rather than hidden behind a
// link: a DJ who doesn't know an alternative exists never goes looking for one.
//
// EVERYTHING IS PER-ROW. Preview, Customize, and a pencil to rename sit next to
// each planner's NAME — because "let me look at this one", "let me change this
// one", and "rename this one" are all thoughts you have about a SPECIFIC
// planner, not about "the selection" in the abstract.
//
//   · Preview opens the REAL client page (/planner-preview), read-only, in its
//     own window — same header, logo, "Your booking" strip and questions the
//     client gets. Not a summary of field labels.
//   · Customize opens the editor (/customize-planner) in its own window.
//   · The pencil renames inline; saving persists (a stock planner becomes the
//     DJ's own copy, keeping its questions — handled server-side).
//
// Both open in their own window (window.open, not a link) so this bookings list
// stays put behind them and the opened tab can close itself when done.

import { useEffect, useState, type CSSProperties } from 'react';
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

// New per-row controls use inline styles so this component doesn't depend on
// new classes being added to plannerSend.module.css.
const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '.5rem',
  flexWrap: 'wrap', padding: '.4rem 0',
};
const nameStyle: CSSProperties = {
  fontWeight: 600, fontSize: '.95rem', display: 'inline-flex',
  alignItems: 'center', gap: '.4rem',
};
const iconBtnStyle: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: '.9rem', lineHeight: 1, padding: '.15rem .3rem',
  color: 'var(--muted, #8a8aa0)',
};
const miniBtnStyle: CSSProperties = {
  background: 'none', border: '1px solid rgba(140,140,170,.35)',
  borderRadius: 8, cursor: 'pointer', fontSize: '.78rem',
  padding: '.2rem .55rem', color: 'inherit', whiteSpace: 'nowrap',
};
const inputStyle: CSSProperties = {
  fontSize: '.9rem', padding: '.25rem .45rem', borderRadius: 8,
  border: '1px solid rgba(140,140,170,.5)', minWidth: 160,
  background: 'transparent', color: 'inherit',
};
const dotStyle = (on: boolean): CSSProperties => ({
  width: 16, height: 16, borderRadius: '50%', flex: '0 0 auto',
  border: '2px solid rgba(140,140,170,.6)',
  boxShadow: on ? 'inset 0 0 0 3px var(--accent, #6a6aff)' : 'none',
  borderColor: on ? 'var(--accent, #6a6aff)' : 'rgba(140,140,170,.6)',
  cursor: 'pointer',
});

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

  // Which template to send. null = whatever the server resolves (the auto,
  // one-click path).
  const [forcedId, setForcedId] = useState<string | null>(null);

  // Inline rename: which row is being renamed, the draft, and a saving flag.
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch(`/api/planners?bookingId=${bookingId}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j?.error || 'Could not load.'); return; }
      setData(j);
    } catch {
      setErr('Could not load.');
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/planners?bookingId=${bookingId}`);
        const j = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) { setErr(j?.error || 'Could not load.'); return; }
        setData(j);
      } catch {
        if (active) setErr('Could not load.');
      }
    })();
    return () => { active = false; };
  }, [bookingId]);

  // Preview the REAL client page for a specific planner, in its own window.
  function openPreview(plannerId: string) {
    const qs = new URLSearchParams({ bookingId, plannerId });
    window.open(`/planner-preview?${qs.toString()}`, '_blank');
  }

  // Open the editor for a SPECIFIC planner, in its own window.
  function openCustomize(eventType: string | null, name: string) {
    const qs = new URLSearchParams({ bookingId, name });
    if (eventType) qs.set('eventType', eventType);
    window.open(`/customize-planner?${qs.toString()}`, '_blank');
  }

  function startRename(t: TemplateLite) {
    setRenameId(t.id);
    setRenameDraft(t.name);
  }

  async function saveRename(t: TemplateLite) {
    const name = renameDraft.trim();
    if (!name || name === t.name) { setRenameId(null); return; }
    setRenameBusy(true);
    try {
      const res = await fetch('/api/planners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renamePlannerId: t.id, name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j?.error || 'Could not rename.'); setRenameBusy(false); return; }
      // Renaming a stock planner creates the DJ's own copy — reload so the list
      // (and which one is "yours") reflects it.
      await load();
      setRenameId(null);
    } catch {
      setErr('Could not rename.');
    } finally {
      setRenameBusy(false);
    }
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

  // The planner rows, resolved-first. The resolved one is the "auto" pick;
  // selecting it means forcedId = null (the one-click path).
  const rows: TemplateLite[] = data
    ? [
        ...data.templates.filter((t) => t.id === data.resolved.id),
        ...data.templates.filter((t) => t.id !== data.resolved.id),
      ]
    : [];

  function rowSelected(t: TemplateLite): boolean {
    return t.id === data?.resolved.id ? forcedId === null : forcedId === t.id;
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2 className={styles.title}>Send Planner &amp; Playlist</h2>
          <button type="button" className={styles.x} onClick={onClose} aria-label="Close">×</button>
        </div>

        {!data && !err && <div className={styles.quiet}>Loading…</div>}
        {err && <div className={styles.err}>{err}</div>}

        {data && (
          <>
            <div className={styles.summary}>
              {/* Event info at the TOP — date, kind of party, venue — so the DJ
                  is sure they're on the right booking before anything else. */}
              <div className={styles.sumRow}>
                <span className={styles.k}>Date</span>
                <span className={styles.v}>{fmtDate(data.event.date)}</span>
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
            </div>

            {/* One row per planner. Name, then its own Preview / Customize, with
                a pencil to rename inline. The dot selects which one Send uses. */}
            <div className={styles.altList}>
              {rows.map((t) => {
                const selected = rowSelected(t);
                const isAuto = t.id === data.resolved.id;
                return (
                  <div key={t.id} style={rowStyle}>
                    <span
                      role="radio"
                      aria-checked={selected}
                      tabIndex={0}
                      onClick={() => setForcedId(isAuto ? null : t.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setForcedId(isAuto ? null : t.id); }}
                      style={dotStyle(selected)}
                      aria-label={`Send ${t.name}`}
                    />
                    {renameId === t.id ? (
                      <>
                        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                        <input
                          autoFocus
                          value={renameDraft}
                          disabled={renameBusy}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveRename(t);
                            if (e.key === 'Escape') setRenameId(null);
                          }}
                          style={inputStyle}
                        />
                        <button
                          type="button"
                          onClick={() => void saveRename(t)}
                          disabled={renameBusy}
                          style={{ ...miniBtnStyle }}
                        >
                          {renameBusy ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenameId(null)}
                          disabled={renameBusy}
                          style={iconBtnStyle}
                          aria-label="Cancel rename"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <span
                          style={{ ...nameStyle, cursor: 'pointer' }}
                          onClick={() => setForcedId(isAuto ? null : t.id)}
                        >
                          {t.name}
                          {isAuto && <span className={styles.tagAuto}>auto</span>}
                          {!isAuto && t.isMine && <span className={styles.tag}>yours</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => startRename(t)}
                          style={iconBtnStyle}
                          title="Rename"
                          aria-label={`Rename ${t.name}`}
                        >
                          ✎
                        </button>
                        <span style={{ flex: 1 }} />
                        <button type="button" onClick={() => openPreview(t.id)} style={miniBtnStyle}>
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => openCustomize(isAuto ? data.editEventType : t.eventType, t.name)}
                          style={miniBtnStyle}
                        >
                          Customize
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div className={styles.foot}>
              <button type="button" className={styles.ghost} onClick={onClose}>Cancel</button>
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
