'use client';

// PlannerLibrarySection — the "Planner & Playlist" pane in Booking Settings.
//
// It's the same template list the Send Planner & Playlist modal shows, lifted
// OUT of the booking context: the DJ can preview each planner, open the editor
// to customise it (or make it their own), and rename their own — all BEFORE any
// booking exists. Reuses /api/planners in its no-booking mode (no bookingId):
//   · GET /api/planners → the template list
//   · Preview → /planner-preview?eventType=… (fields only, no booking data)
//   · Edit → /customize-planner?eventType=… (the real editor / PlannerBuilder)
//   · Rename → PUT /api/planners { renamePlannerId, name } (their own only)

import { useEffect, useState, type CSSProperties } from 'react';
import { createClient } from '@/lib/supabase/client';
import SectionBanner from '../update-dj-profile/SectionBanner';

const LEAD_OPTIONS = [7, 10, 14, 21, 30];

type TemplateLite = {
  id: string;
  name: string;
  eventType: string | null;
  isStandard: boolean;
  isMine: boolean;
  count: number;
};

const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '.55rem',
  flexWrap: 'nowrap', padding: '.7rem .35rem',
  borderTop: '1px solid rgba(140,140,170,.14)',
};
// A small colour dot per event type — a quiet way to tell the rows apart at a
// glance without leaning on icons. Custom planners get the neon accent.
const dotStyle: CSSProperties = {
  width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto',
};
// The "Custom" tag — only on planners the DJ built from scratch.
const customTagStyle: CSSProperties = {
  flex: '0 0 auto', fontSize: '.6rem', letterSpacing: '.08em', textTransform: 'uppercase',
  color: 'var(--neon,#00e0a4)', background: 'rgba(0,224,164,.12)',
  borderRadius: 5, padding: '2px 7px', fontWeight: 700,
};
// Right-hand actions cluster (Preview · Edit).
const actionsWrapStyle: CSSProperties = {
  flex: '0 0 auto', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1rem',
};
// A blank event type marks a from-scratch custom planner.
const isCustomTemplate = (t: TemplateLite) =>
  typeof t.eventType === 'string' && t.eventType.startsWith('custom:');
// The same palette the Finance page uses to colour event types (its
// TYPE_COLORS), so a type reads the same colour on both pages.
const FINANCE_TYPE_COLORS = [
  '#00f5c4', '#635BFF', '#e6b455', '#ef6f9c', '#4cc2ff',
  '#9b8cff', '#5fd08a', '#c98bff', '#ff9f6b', '#f45b69',
  '#3ec6c0', '#b0c94a', '#ff8ac4', '#7aa5ff', '#d99a2b',
];
// Fixed slot per event type (matched on the type key, loosely, so a stray
// 'sweet_16' vs 'sweet16' still lands right) → a stable colour from the palette.
const EVENT_COLOR_SLOT: Array<[string, number]> = [
  ['wedding', 0], ['birthday', 1], ['corporate', 2], ['anniversary', 3],
  ['graduation', 4], ['sweet', 5], ['16', 5], ['quince', 6], ['mitzvah', 7],
  ['reunion', 8], ['holiday', 9], ['school', 10], ['community', 11], ['other', 12],
];
function dotColor(t: TemplateLite): string {
  if (isCustomTemplate(t)) return '#00e0a4';
  const s = `${t.eventType || ''} ${t.name}`.toLowerCase();
  for (const [needle, slot] of EVENT_COLOR_SLOT) {
    if (s.includes(needle)) return FINANCE_TYPE_COLORS[slot];
  }
  return '#8a8aa0';
}
const nameStyle: CSSProperties = {
  flex: '0 1 auto', minWidth: 0,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  fontWeight: 600, fontSize: '.88rem', color: 'var(--white,#fff)',
};
// The rename pencil — a clean line icon, muted until hovered.
const pencilBtnStyle: CSSProperties = {
  flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: '1.4rem', height: '1.4rem', background: 'transparent', border: 'none',
  borderRadius: 6, color: '#6f6f88', cursor: 'pointer', padding: 0,
};
function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
const miniBtnStyle: CSSProperties = {
  flex: '0 0 auto', background: 'transparent', border: '1px solid rgba(140,140,170,.35)',
  color: 'var(--white,#fff)', borderRadius: 6, padding: '.32rem .7rem',
  fontSize: '.72rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
};
// Preview / Edit Template render as plain underlined text links — no button frame.
const linkBtnStyle: CSSProperties = {
  flex: '0 0 auto', background: 'transparent', border: 'none', padding: '.2rem .15rem',
  color: 'var(--white,#fff)', fontSize: '.72rem', fontWeight: 600, cursor: 'pointer',
  whiteSpace: 'nowrap', textDecoration: 'underline', textUnderlineOffset: '3px',
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

/** Cluster templates by event type so all rows of a type sit together (the two
 * wedding planners land next to each other), keeping first-seen order otherwise. */
function groupByEventType(list: TemplateLite[]): TemplateLite[] {
  const order: string[] = [];
  const groups = new Map<string, TemplateLite[]>();
  for (const t of list) {
    const key = t.eventType ?? '~base~';
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key)!.push(t);
  }
  return order.flatMap((k) => groups.get(k)!);
}

export default function PlannerLibrarySection() {
  const [templates, setTemplates] = useState<TemplateLite[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // "Create custom planner" — a blank template the DJ builds from scratch. The
  // button reveals a name field; naming it opens the editor on an empty sheet.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  // How many days before the event the DJ wants the planner submitted. Saved on
  // users.planner_lead_days and shown on the client planner. Default 14.
  const [leadDays, setLeadDays] = useState(14);
  const [leadSaved, setLeadSaved] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;
        const { data } = await supabase.from('users').select('planner_lead_days').eq('id', user.id).maybeSingle();
        const v = (data as { planner_lead_days?: number | null } | null)?.planner_lead_days;
        if (active && typeof v === 'number') setLeadDays(v);
      } catch { /* falls back to 14 */ }
    })();
    return () => { active = false; };
  }, []);

  async function saveLeadDays(days: number) {
    setLeadDays(days);
    setLeadSaved(false);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from('users')
        .update({ planner_lead_days: days } as unknown as never)
        .eq('id', user.id);
      if (!error) { setLeadSaved(true); setTimeout(() => setLeadSaved(false), 2000); }
    } catch { /* non-fatal */ }
  }

  async function load() {
    try {
      const res = await fetch('/api/planners');
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j?.error || 'Could not load planners.'); return; }
      setErr(null);
      setTemplates(groupByEventType(Array.isArray(j.templates) ? j.templates : []));
    } catch {
      setErr('Could not load planners.');
    }
  }
  useEffect(() => { void load(); }, []);

  // The editor (and preview) open in their OWN tab, so a planner the DJ just
  // created or renamed there won't show here until this list re-fetches. Reload
  // it whenever the DJ comes back to this tab — closing the editor and clicking
  // back lands a fresh list without a manual refresh.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  function openEdit(t: TemplateLite) {
    const qs = new URLSearchParams({ name: t.name, templateId: t.id });
    if (t.eventType) qs.set('eventType', t.eventType);
    window.open(`/customize-planner?${qs}`, '_blank');
  }

  // Preview = the read-only client view of this exact template (no booking).
  function openPreview(t: TemplateLite) {
    const qs = new URLSearchParams({ name: t.name, templateId: t.id });
    if (t.eventType) qs.set('eventType', t.eventType);
    window.open(`/planner-preview?${qs}`, '_blank');
  }

  // Delete a custom planner (only ever offered on custom rows). Confirmed first
  // — it can't be undone — then removed and the list re-fetched.
  async function deleteCustom(t: TemplateLite) {
    if (!window.confirm(`Delete "${t.name}"? This planner and its questions will be removed for good.`)) return;
    setDeletingId(t.id);
    try {
      const res = await fetch('/api/planners', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plannerId: t.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j?.error || 'Could not delete.'); setDeletingId(null); return; }
      setDeletingId(null);
      void load();
    } catch {
      setErr('Could not delete.');
      setDeletingId(null);
    }
  }

  // Open the editor on a BLANK sheet. The `custom:` marker becomes the new
  // planner's event_type, so it's saved as a standalone template (no base spine
  // folded in) and never auto-resolves onto a booking — it's chosen by hand.
  function openCreateCustom() {
    const name = newName.trim();
    if (!name) return;
    const key = `custom:${crypto.randomUUID()}`;
    const qs = new URLSearchParams({ name, custom: key });
    window.open(`/customize-planner?${qs}`, '_blank');
    setCreating(false);
    setNewName('');
    // The new planner won't show in the list until it's saved in the editor.
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
      <SectionBanner
        icon="planner"
        title="Planner & Playlist"
        subtitle="Preview and customise the planners your clients fill out."
      />
      <p style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.85rem', lineHeight: 1.5, margin: '1rem 0 1rem', maxWidth: 620 }}>
        These are the planners your clients fill out — first dances, song requests, run of show. Preview
        what a client sees, or open one to customise the questions and make it your own. Your edits are
        used automatically the next time you send that event type&rsquo;s planner.
      </p>

      {/* Submission deadline — how far ahead of the event the client is asked to
          finish. Shows on the client's planner. Saved to the DJ, default 14 days. */}
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem',
        maxWidth: 720, padding: '.7rem .8rem', marginBottom: '1.1rem',
        border: '1px solid rgba(140,140,170,.18)', borderRadius: 9,
        background: 'rgba(255,255,255,.02)',
      }}>
        <label htmlFor="planner-lead" style={{ fontSize: '.85rem', color: 'var(--white,#fff)' }}>
          Ask clients to submit their Planner &amp; Playlist at least
        </label>
        <select
          id="planner-lead"
          value={leadDays}
          onChange={(e) => void saveLeadDays(Number(e.target.value))}
          style={{
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(140,140,170,.4)',
            borderRadius: 6, color: '#fff', padding: '.35rem .5rem', fontSize: '.85rem',
          }}
        >
          {LEAD_OPTIONS.map((d) => (
            <option key={d} value={d}>{d} days before the event</option>
          ))}
        </select>
        {leadSaved && <span style={{ fontSize: '.78rem', color: 'var(--neon,#00e0a4)' }}>✓ Saved</span>}
      </div>

      {err && <div style={{ color: '#ff7676', fontSize: '.82rem', marginBottom: '.7rem' }}>{err}</div>}
      {templates === null && !err && <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.85rem' }}>Loading…</div>}

      {templates && templates.length > 0 && (
        <div style={{ maxWidth: 720 }}>
          {templates.map((t, i) => (
            <div
              key={t.id}
              style={i === 0 ? { ...rowStyle, borderTop: 'none' } : rowStyle}
            >
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
                  <span style={{ ...dotStyle, background: dotColor(t) }} aria-hidden="true" />
                  <span style={nameStyle} title={t.name}>{t.name}</span>
                  {isCustomTemplate(t) && <span style={customTagStyle}>Custom</span>}
                  <button
                    type="button"
                    onClick={() => { setRenameId(t.id); setRenameDraft(t.name); }}
                    style={pencilBtnStyle}
                    title="Rename"
                    aria-label={`Rename ${t.name}`}
                  ><PencilIcon /></button>
                  <span style={actionsWrapStyle}>
                    {/* Delete sits to the LEFT of Preview so Preview/Edit stay
                        pinned right and line up across every row. */}
                    {isCustomTemplate(t) && (
                      <button
                        type="button"
                        onClick={() => void deleteCustom(t)}
                        disabled={deletingId === t.id}
                        style={{ ...linkBtnStyle, color: '#ff5f5f' }}
                      >
                        {deletingId === t.id ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                    <button type="button" onClick={() => openPreview(t)} style={linkBtnStyle}>Preview</button>
                    <button type="button" onClick={() => openEdit(t)} style={linkBtnStyle}>Edit</button>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create a custom planner from scratch — a blank sheet the DJ builds by
          adding their own questions. Sits below the list, set apart by a rule. */}
      {templates && (
        <div style={{
          marginTop: '1rem', paddingTop: '1rem',
          borderTop: '1px solid rgba(140,140,170,.28)', maxWidth: 720,
        }}>
          {creating ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'nowrap' }}>
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input
                autoFocus
                value={newName}
                placeholder="Name your planner (e.g. Corporate Gala)"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') openCreateCustom(); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
                style={inputStyle}
              />
              <button type="button" onClick={openCreateCustom} disabled={!newName.trim()} style={miniBtnStyle}>
                Create
              </button>
              <button type="button" onClick={() => { setCreating(false); setNewName(''); }} style={iconBtnStyle} aria-label="Cancel">✕</button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '.4rem',
                background: 'transparent', border: '1px solid var(--neon,#00e0a4)',
                color: 'var(--neon,#00e0a4)', borderRadius: 8, padding: '.5rem .9rem',
                fontSize: '.82rem', fontWeight: 700, cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: '1rem', lineHeight: 1 }}>＋</span> Create custom planner
            </button>
          )}
          <p style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.78rem', lineHeight: 1.5, margin: '.6rem 0 0' }}>
            Starts blank — add your own questions to build it, then send it to any booking.
          </p>
        </div>
      )}
    </div>
  );
}
