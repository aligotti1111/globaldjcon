'use client';

import { useState } from 'react';
import { saveProfile } from '../profileSave';
import { ExpandableDesc } from './bio';

// ─────────────────────────────────────────────────────────────────────────
// MediaAddButton — owner-only inline add for mixes or videos. The DJ
// pastes a URL (SoundCloud/Mixcloud/etc for mixes, YouTube/Vimeo for
// videos) and we save it to the next empty mix_url_1/2/3 or
// video_url_1/2/3 slot, then reload so the embed appears in the tab.
// Two visual modes: `big` (centered + button on empty tab) and inline
// (smaller button rendered after existing media when slots remain).
// ─────────────────────────────────────────────────────────────────────────
type VideoItem = { url: string; title: string | null; desc: string | null };

export function VideoAddButton({
  userId,
  list,
  cap,
  isPaid,
  big,
}: {
  userId: string;
  list: VideoItem[];
  cap: number;
  isPaid: boolean;
  big?: boolean;
}) {
  const [expanded, setExpanded] = useState(!!big);
  const [value, setValue] = useState('');
  const [titleVal, setTitleVal] = useState('');
  const [descVal, setDescVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const atCap = list.length >= cap;

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) { setError('Paste a URL first.'); return; }
    if (atCap) { setError(`You've reached ${cap} videos. Remove one first.`); return; }
    setError(null);
    setSaving(true);
    try {
      let resolvedTitle = titleVal.trim();
      if (!resolvedTitle) {
        try {
          const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(trimmed)}&format=json`;
          const r = await fetch(oembedUrl);
          if (r.ok) {
            const j = await r.json() as { title?: string };
            if (j.title) resolvedTitle = j.title;
          }
        } catch { /* ignore */ }
      }
      const next: VideoItem[] = [...list, { url: trimmed, title: resolvedTitle || null, desc: descVal.trim() || null }];
      await saveProfile(userId, { video_urls: next });
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'video');
      window.location.href = url.toString();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setSaving(false);
    }
  }

  if (atCap && !isPaid) {
    return (
      <div style={{ padding: '.75rem .9rem', border: '1px solid var(--neon)', borderRadius: 8, background: 'rgba(0,245,196,.06)', fontFamily: 'DM Sans, sans-serif', fontSize: '.82rem', color: 'var(--white,#fff)' }}>
        You&apos;ve reached the free limit of {cap} videos.{' '}
        <a href="/subscribe" style={{ color: 'var(--neon)', fontWeight: 700 }}>Upgrade</a> for unlimited.
      </div>
    );
  }
  if (atCap) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        style={{ background: 'rgba(0,245,196,.05)', border: '2px dashed var(--neon)', borderRadius: 8, color: 'var(--neon)', cursor: 'pointer', padding: big ? '1.5rem' : '.9rem', fontFamily: "'Space Mono', monospace", fontSize: '.8rem', letterSpacing: '.05em', width: '100%' }}
      >
        + Add a video
      </button>
    );
  }
  const inputStyle: React.CSSProperties = { padding: '.6rem .75rem', borderRadius: 6, border: '1px solid var(--border, rgba(255,255,255,.2))', background: 'transparent', color: 'var(--white,#fff)', fontFamily: 'DM Sans, sans-serif', width: '100%', boxSizing: 'border-box' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', maxWidth: 460 }}>
      <input type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste YouTube or Vimeo URL" autoFocus style={inputStyle} />
      <input type="text" value={titleVal} onChange={(e) => setTitleVal(e.target.value)} placeholder="Title (optional — auto-filled from YouTube)" style={inputStyle} />
      <textarea value={descVal} onChange={(e) => setDescVal(e.target.value)} placeholder="Description (optional)" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
      {error && <div style={{ color: '#ff5f5f', fontSize: '.78rem' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
        <button type="button" onClick={() => { setExpanded(false); setValue(''); setTitleVal(''); setDescVal(''); setError(''); }} style={{ background: 'transparent', border: '1px solid var(--border, rgba(255,255,255,.25))', color: 'var(--white,#fff)', borderRadius: 6, padding: '.5rem 1rem', cursor: 'pointer', fontSize: '.8rem' }}>Cancel</button>
        <button type="button" onClick={handleSave} disabled={saving} style={{ background: 'var(--neon)', border: 'none', color: '#000', borderRadius: 6, padding: '.5rem 1.1rem', cursor: 'pointer', fontWeight: 700, fontSize: '.8rem' }}>{saving ? 'Saving…' : 'Add'}</button>
      </div>
    </div>
  );
}

export function MixAddButton({
  userId,
  list,
  cap,
  isPaid,
  big,
}: {
  userId: string;
  list: string[];
  cap: number;
  isPaid: boolean;
  big?: boolean;
}) {
  const [expanded, setExpanded] = useState(!!big);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const atCap = list.length >= cap;

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) { setError('Paste a URL first.'); return; }
    if (atCap) {
      setError(isPaid ? `You've reached ${cap} mixes. Remove one first.` : `Free accounts can add ${cap} mixes. Upgrade for unlimited.`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const next = [...list, trimmed];
      await saveProfile(userId, { mix_urls: next });
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'mixes');
      window.location.href = url.toString();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setSaving(false);
    }
  }

  if (atCap && !isPaid) {
    return (
      <div style={{ padding: '.75rem .9rem', border: '1px solid var(--neon)', borderRadius: 8, background: 'rgba(0,245,196,.06)', fontFamily: 'DM Sans, sans-serif', fontSize: '.82rem', color: 'var(--white,#fff)' }}>
        You&apos;ve reached the free limit of {cap} mixes.{' '}
        <a href="/subscribe" style={{ color: 'var(--neon)', fontWeight: 700 }}>Upgrade</a> for unlimited.
      </div>
    );
  }
  if (atCap) return null;

  if (!expanded) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{ background: 'var(--neon)', border: 'none', borderRadius: 8, color: '#000', cursor: 'pointer', padding: '.55rem 1.1rem', fontFamily: "'Space Mono', monospace", fontSize: '.75rem', fontWeight: 700, letterSpacing: '.05em', whiteSpace: 'nowrap', textTransform: 'uppercase' }}
        >
          + Add a mix
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } else if (e.key === 'Escape') { setExpanded(false); setValue(''); setError(''); } }}
          placeholder="Paste SoundCloud, Mixcloud, or other mix URL"
          autoFocus
          style={{ padding: '.6rem .75rem', borderRadius: 6, border: '1px solid var(--border, rgba(255,255,255,.2))', background: 'transparent', color: 'var(--white,#fff)', fontFamily: 'DM Sans, sans-serif', flex: '1 1 260px', minWidth: 0, maxWidth: 460 }}
        />
        <button type="button" onClick={() => { setExpanded(false); setValue(''); setError(''); }} style={{ background: 'transparent', border: '1px solid var(--border, rgba(255,255,255,.25))', color: 'var(--white,#fff)', borderRadius: 6, padding: '.5rem 1rem', cursor: 'pointer', fontSize: '.8rem', whiteSpace: 'nowrap' }}>Cancel</button>
        <button type="button" onClick={handleSave} disabled={saving} style={{ background: 'var(--neon)', border: 'none', color: '#000', borderRadius: 6, padding: '.5rem 1.1rem', cursor: 'pointer', fontWeight: 700, fontSize: '.8rem', whiteSpace: 'nowrap' }}>{saving ? 'Saving…' : 'Add'}</button>
      </div>
      {error && <div style={{ color: '#ff5f5f', fontSize: '.78rem' }}>{error}</div>}
    </div>
  );
}

export function MediaAddButton({
  userId,
  kind,
  existing,
  big,
}: {
  userId: string;
  kind: 'mix' | 'video';
  // Current values of all 3 slots in DB order. Used to find the first
  // empty slot to write to. Order matters — we always fill the lowest
  // empty index so the slots stay packed.
  existing: (string | null)[];
  big?: boolean;
}) {
  // When `big` is true the tab has zero entries — auto-expand the form
  // so the URL input is visible immediately (no need to click +).
  const [expanded, setExpanded] = useState(!!big);
  const [value, setValue] = useState('');
  // Optional title + description — only shown for videos. DJ leaves
  // blank if they don't want them; both are nullable in the DB.
  const [titleVal, setTitleVal] = useState('');
  const [descVal, setDescVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const colPrefix = kind === 'mix' ? 'mix_url_' : 'video_url_';
  const verb = kind === 'mix' ? 'mix' : 'video';
  const placeholder = kind === 'mix'
    ? 'Paste SoundCloud, Mixcloud, or other mix URL'
    : 'Paste YouTube or Vimeo URL';

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Paste a URL first.');
      return;
    }
    // Find first empty slot (1, 2, or 3). If all full, bail — the
    // calling tab already hides the button when 3 are filled, but
    // belt-and-suspenders.
    const emptyIdx = existing.findIndex((v) => !v);
    if (emptyIdx === -1) {
      setError(`You already have 3 ${verb}s. Remove one first.`);
      return;
    }
    const slotNum = emptyIdx + 1;
    const column = `${colPrefix}${slotNum}`;
    setError(null);
    setSaving(true);
    try {
      // Build payload: always the URL, plus title/desc for videos.
      // Title/desc are sent as null if empty so the DB row stays clean.
      const payload: Record<string, string | null> = { [column]: trimmed };
      if (kind === 'video') {
        // Try to auto-fetch the YouTube title when the DJ left the
        // title blank. oEmbed is keyless and free; we just shrug it
        // off if the request fails (non-YouTube link, network blip,
        // etc) and store null. Description is never auto-filled.
        let resolvedTitle = titleVal.trim();
        if (!resolvedTitle) {
          try {
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(trimmed)}&format=json`;
            const r = await fetch(oembedUrl);
            if (r.ok) {
              const j = await r.json() as { title?: string };
              if (j.title) resolvedTitle = j.title;
            }
          } catch {
            // Ignore — leave title null
          }
        }
        payload[`video_title_${slotNum}`] = resolvedTitle || null;
        payload[`video_desc_${slotNum}`] = descVal.trim() || null;
      }
      await saveProfile(userId, payload);
      // Reload with ?tab=mixes or ?tab=video so the user lands back on
      // the tab they were adding to instead of jumping to the default
      // (booking/about).
      const tabParam = kind === 'mix' ? 'mixes' : 'video';
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tabParam);
      window.location.href = url.toString();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save.';
      setError(msg);
      setSaving(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      setExpanded(false);
      setValue('');
      setError(null);
    }
  }

  // Collapsed — neon button. Big variant is the centered empty-state
  // call to action; inline variant is the smaller post-content add.
  if (!expanded) {
    if (big) {
      return (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title={`Add a ${verb}`}
          aria-label={`Add a ${verb}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 96,
            height: 96,
            margin: '2.5rem auto',
            background: 'rgba(0, 245, 196, .08)',
            border: '2px solid var(--neon)',
            borderRadius: '50%',
            color: 'var(--neon)',
            cursor: 'pointer',
            fontSize: '3rem',
            lineHeight: 1,
            fontWeight: 300,
            padding: 0,
          }}
        >
          +
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        title={`Add another ${verb}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '.4rem',
          alignSelf: 'flex-start',
          padding: '.55rem 1rem',
          marginTop: '.75rem',
          background: 'rgba(0, 245, 196, .08)',
          border: '1px solid var(--neon)',
          borderRadius: 6,
          color: 'var(--neon)',
          cursor: 'pointer',
          fontFamily: "'Space Mono', monospace",
          fontSize: '.7rem',
          letterSpacing: '.08em',
          textTransform: 'uppercase',
        }}
      >
        + Add another {verb}
      </button>
    );
  }

  // Expanded — input row.
  return (
    <div style={{
      // When inline (non-big), break to a new row inside the flex
      // parent (videoList/mediaList) and cap width so the panel reads
      // as a small input bar, not a full media-card-sized box.
      // alignSelf flex-start prevents flex from stretching this item
      // to match the tallest sibling (the square video cards).
      ...(big ? {} : { flexBasis: '100%', order: 999, alignSelf: 'flex-start' }),
      display: 'flex',
      flexDirection: 'column',
      gap: '.5rem',
      padding: '.75rem',
      margin: big ? '2rem auto' : '.75rem 0 0',
      width: big ? undefined : 'fit-content',
      maxWidth: big ? 520 : 480,
      background: 'rgba(0, 245, 196, .06)',
      border: '1px solid var(--neon)',
      borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0, 245, 196, .12)',
    }}>
      <div style={{
        fontFamily: "'Space Mono', monospace",
        fontSize: '.7rem',
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: 'var(--neon)',
      }}>
        Add a {verb}
      </div>
      {/* Optional title + description — only shown for videos. Both
          can be left blank; the rendered card just hides them then. */}
      {kind === 'video' && (
        <>
          <input
            type="text"
            value={titleVal}
            onChange={(e) => setTitleVal(e.target.value)}
            placeholder="Title (optional)"
            disabled={saving}
            style={{
              width: 320,
              padding: '.5rem .7rem',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid var(--border, rgba(255,255,255,0.15))',
              borderRadius: 4,
              color: 'var(--white, #fff)',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: '.85rem',
            }}
          />
          <textarea
            value={descVal}
            onChange={(e) => setDescVal(e.target.value)}
            placeholder="Description (optional)"
            disabled={saving}
            rows={2}
            style={{
              width: 320,
              padding: '.5rem .7rem',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid var(--border, rgba(255,255,255,0.15))',
              borderRadius: 4,
              color: 'var(--white, #fff)',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: '.85rem',
              resize: 'vertical',
              minHeight: 56,
            }}
          />
        </>
      )}
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
          onKeyDown={handleKey}
          placeholder={placeholder}
          disabled={saving}
          style={{
            flex: 1,
            minWidth: 0,
            width: 320,
            padding: '.55rem .7rem',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid var(--border, rgba(255,255,255,0.15))',
            borderRadius: 4,
            color: 'var(--white, #fff)',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: '.85rem',
          }}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '.55rem 1rem',
            background: 'var(--neon)',
            border: 'none',
            borderRadius: 4,
            color: '#000',
            fontFamily: "'Space Mono', monospace",
            fontSize: '.7rem',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? '…' : 'Add'}
        </button>
        <button
          type="button"
          onClick={() => { setExpanded(false); setValue(''); setError(null); }}
          disabled={saving}
          aria-label="Cancel"
          style={{
            padding: '.35rem .55rem',
            background: 'transparent',
            border: 'none',
            color: 'var(--muted, #888)',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: '1.1rem',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
      {error && (
        <div style={{
          color: '#ff5f5f',
          fontSize: '.78rem',
          fontFamily: 'DM Sans, sans-serif',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// VideoMetaEditor — owner-only inline editor for a video's title +
// description. Renders in the description area of each video card.
// View mode: shows the description (if set) with a small pencil button
// to start editing. Edit mode: textarea for description + input for
// title + Save/Cancel. Saves directly to public.users.video_title_N /
// video_desc_N for the slot. Reloads on save so the rendered card
// reflects the new values.
// ─────────────────────────────────────────────────────────────────────────
export function VideoMetaEditor({
  userId,
  list,
  index,
  initialTitle,
  initialDesc,
}: {
  userId: string;
  list: VideoItem[];
  index: number;
  initialTitle: string | null;
  initialDesc: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initialTitle || '');
  const [descDraft, setDescDraft] = useState(initialDesc || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setTitleDraft(initialTitle || '');
    setDescDraft(initialDesc || '');
    setError(null);
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setError(null);
  }
  async function save() {
    setError(null);
    setSaving(true);
    try {
      const next = list.map((v, i) =>
        i === index ? { ...v, title: titleDraft.trim() || null, desc: descDraft.trim() || null } : v
      );
      await saveProfile(userId, { video_urls: next });
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'video');
      window.location.href = url.toString();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save.';
      setError(msg);
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div style={{
        padding: '.6rem 1rem .85rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '.45rem',
      }}>
        <input
          autoFocus
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          placeholder="Title (optional)"
          disabled={saving}
          style={{
            width: '100%',
            padding: '.45rem .6rem',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid var(--neon)',
            borderRadius: 4,
            color: 'var(--white, #fff)',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: '.85rem',
            boxSizing: 'border-box',
          }}
        />
        <textarea
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          placeholder="Description (optional)"
          disabled={saving}
          rows={3}
          style={{
            width: '100%',
            padding: '.45rem .6rem',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid var(--neon)',
            borderRadius: 4,
            color: 'var(--white, #fff)',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: '.82rem',
            resize: 'vertical',
            boxSizing: 'border-box',
            lineHeight: 1.5,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.4rem' }}>
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            style={{
              padding: '.4rem .75rem',
              background: 'transparent',
              border: '1px solid var(--border, rgba(255,255,255,0.2))',
              borderRadius: 4,
              color: 'var(--muted, #888)',
              fontFamily: "'Space Mono', monospace",
              fontSize: '.65rem',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{
              padding: '.4rem .85rem',
              background: 'var(--neon)',
              border: 'none',
              borderRadius: 4,
              color: '#000',
              fontFamily: "'Space Mono', monospace",
              fontSize: '.65rem',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {error && (
          <div style={{
            color: '#ff5f5f',
            fontSize: '.75rem',
            fontFamily: 'DM Sans, sans-serif',
          }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // View mode — description text + pencil button to start editing.
  // Show pencil even when both title + desc are empty so the owner
  // has a way to add them later.
  return (
    <div style={{
      padding: '.5rem 1rem .85rem',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: '.5rem',
    }}>
      <div style={{
        flex: 1,
        minWidth: 0,
      }}>
        {initialDesc ? (
          <ExpandableDesc text={initialDesc} />
        ) : (
          <div style={{
            fontFamily: 'DM Sans, sans-serif',
            fontSize: '.82rem',
            color: 'rgba(255,255,255,.35)',
            lineHeight: 1.5,
            fontStyle: 'italic',
          }}>
            No description yet.
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={startEdit}
        title="Edit title and description"
        aria-label="Edit title and description"
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: 4,
          background: 'transparent',
          border: '1px solid var(--border, rgba(255,255,255,0.15))',
          color: 'var(--neon)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        {/* Inline pencil SVG */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
      </button>
    </div>
  );
}
