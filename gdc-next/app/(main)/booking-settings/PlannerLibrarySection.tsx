'use client';

// PlannerLibrarySection — the "Planner & Playlist" pane in Booking Settings.
//
// It's the same template list the Send Planner & Playlist modal shows, lifted
// OUT of the booking context: the DJ can preview each planner, open the editor
// to customise it (or make it their own), and rename their own — all BEFORE any
// booking exists. Reuses /api/planners in its no-booking mode (no bookingId):
//   · GET  /api/planners                 → the template list
//   · Preview → /planner-preview?eventType=…   (fields only, no booking data)
//   · Edit   → /customize-planner?eventType=…  (the real editor / PlannerBuilder)
//   · Rename → PUT /api/planners { renamePlannerId, name }   (their own only)

import { useEffect, useState, type CSSProperties } from 'react';

type TemplateLite = {
  id: string;
  name: string;
  eventType: string | null;
  isStandard: boolean;
  isMine: boolean;
  count: number;
};

const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '.4rem',
  flexWrap: 'nowrap', padding: '.4rem .5rem',
  borderTop: '1px solid rgba(140,140,170,.12)', borderRadius: 7,
};
const nameStyle: CSSProperties = {
  flex: '1 1 auto', minWidth: 0,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  fontWeight: 600, fontSize: '.85rem', color: 'var(--white,#fff)',
};
const countStyle: CSSProperties = {
  flex: '0 0 auto', fontSize: '.66rem', color: 'var(--muted,#8a8aa0)',
  fontFamily: "'Space Mono', monospace",
};
const miniBtnStyle: CSSProperties = {
  flex: '0 0 auto', background: 'transparent', border: '1px solid rgba(140,140,170,.35)',
  color: 'var(--white,#fff)', borderRadius: 6, padding: '.32rem .7rem',
  fontSize: '.72rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
};
const iconBtnStyle: CSSProperties = {
  flex: '0 0 auto', background: 'transparent', border: 'none',
  color: 'var(--muted,#8a8aa0)', cursor: 'pointer', fontSize: '.85rem', padding: '.2rem .35rem',
};
const inputStyle: CSSProperties = {
  flex: '1 1 auto', minWidth: 0, background: 'rgba(255,255,255,.06)',
  border: '1px solid rgba(140,140,170,.4)', borderRadius: 6, color: '#fff',
  padding: '.35rem .5rem', fontSize: '.85rem',
};

export default function PlannerLibrarySection() {
  const [templates, setTemplates] = useState<TemplateLite[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/planners');
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j?.error || 'Could not load planners.'); return; }
      setErr(null);
      setTemplates(Array.isArray(j.templates) ? j.templates : []);
    } catch {
      setErr('Could not load planners.');
    }
  }
  useEffect(() => { void load(); }, []);

  function openPreview(t: TemplateLite) {
    const qs = new URLSearchParams();
    if (t.eventType) qs.set('eventType', t.eventType);
    window.open(`/planner-preview${qs.toString() ? `?${qs}` : ''}`, '_blank');
  }
  function openEdit(t: TemplateLite) {
    const qs = new URLSearchParams({ name: t.name });
    if (t.eventType) qs.set('eventType', t.eventType);
    window.open(`/customize-planner?${qs}`, '_blank');
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
      setRenameId(null);
      setRenameBusy(false);
      void load();
    } catch {
      setErr('Could not rename.');
      setRenameBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.6rem', margin: '0 0 .3rem' }}>
        Planner &amp; Playlist
      </h2>
      <p style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.85rem', lineHeight: 1.5, margin: '0 0 1rem', maxWidth: 620 }}>
        These are the planners your clients fill out — first dances, song requests, run of show. Preview
        what a client sees, or open one to customise the questions and make it your own. Your edits are
        used automatically the next time you send that event type&rsquo;s planner.
      </p>

      {err && <div style={{ color: '#ff7676', fontSize: '.82rem', marginBottom: '.7rem' }}>{err}</div>}
      {templates === null && !err && <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.85rem' }}>Loading…</div>}

      {templates && templates.length > 0 && (
        <div style={{ maxWidth: 720 }}>
          {templates.map((t) => (
            <div key={t.id} style={rowStyle}>
              {renameId === t.id ? (
                <>
                  {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                  <input
                    autoFocus
                    value={renameDraft}
                    disabled={renameBusy}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void saveRename(t); if (e.key === 'Escape') setRenameId(null); }}
                    style={inputStyle}
                  />
                  <button type="button" onClick={() => void saveRename(t)} disabled={renameBusy} style={miniBtnStyle}>
                    {renameBusy ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setRenameId(null)} disabled={renameBusy} style={iconBtnStyle} aria-label="Cancel rename">✕</button>
                </>
              ) : (
                <>
                  <span style={nameStyle} title={t.name}>{t.name}</span>
                  <span style={countStyle}>{t.count} questions</span>
                  {t.isMine && (
                    <button
                      type="button"
                      onClick={() => { setRenameId(t.id); setRenameDraft(t.name); }}
                      style={iconBtnStyle}
                      title="Rename"
                      aria-label={`Rename ${t.name}`}
                    >✎</button>
                  )}
                  <button type="button" onClick={() => openPreview(t)} style={miniBtnStyle}>Preview</button>
                  <button type="button" onClick={() => openEdit(t)} style={miniBtnStyle}>Edit Template</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
