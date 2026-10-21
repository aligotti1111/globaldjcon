'use client';

import { useEffect, useRef, useState } from 'react';
import styles from '../profile.module.css';
import { saveProfile } from '../profileSave';
import { sanitizeBioHtml } from '@/lib/sanitizeBio';

// ─────────────────────────────────────────────────────────────────────────
// OwnerEditableBio — inline About editor shown on the profile owner's
// own profile. Default state: shows the bio text (or a "Click to add"
// hint if empty). Click → switches to a textarea with Save / Cancel.
// Save writes to public.users.bio and updates local state so the new
// text shows immediately. No reload needed.
// ─────────────────────────────────────────────────────────────────────────
const BIO_FONTS = [
  { label: 'Default', value: '' },
  { label: 'DM Sans', value: "'DM Sans', sans-serif" },
  { label: 'Bebas Neue', value: "'Bebas Neue', sans-serif" },
  { label: 'Space Mono', value: "'Space Mono', monospace" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
];
const BIO_SIZES = [
  { label: 'Small', value: '2' },
  { label: 'Normal', value: '3' },
  { label: 'Large', value: '5' },
  { label: 'Huge', value: '7' },
];

export function OwnerEditableBio({ userId, initialBio }: { userId: string; initialBio: string | null }) {
  const [bio, setBio] = useState<string>(initialBio || '');
  // When the bio is empty by default, open straight into edit mode so
  // the DJ sees the textbox right away instead of a "Click to add"
  // affordance. If they already have a bio, we render in view mode
  // with the pencil to start editing.
  const [editing, setEditing] = useState(!initialBio);
  const [draft, setDraft] = useState<string>(initialBio || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only pull focus into the textarea when the DJ *deliberately* taps to
  // edit. When About auto-opens the empty-bio editor, an autoFocus would
  // pop the mobile keyboard and jerk the page on tab-switch (reads as a
  // "refresh"), so the auto-opened editor starts unfocused.
  const [autoFocusEdit, setAutoFocusEdit] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  // Load the draft HTML into the editor when edit mode opens.
  useEffect(() => {
    if (editing && editorRef.current) {
      editorRef.current.innerHTML = draft || '';
      if (autoFocusEdit) editorRef.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // Apply a formatting command to the current selection, then sync draft.
  function exec(cmd: string, value?: string) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* older browsers */ }
    document.execCommand(cmd, false, value);
    setDraft(el.innerHTML);
  }

  function startEdit() {
    setDraft(bio);
    setError(null);
    setAutoFocusEdit(true);
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
      const clean = sanitizeBioHtml(draft).trim();
      // Treat an editor that only holds empty markup (e.g. "<br>") as blank.
      const isEmpty = clean.replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').trim() === '';
      const toSave = isEmpty ? null : clean;
      await saveProfile(userId, { bio: toSave });
      setBio(toSave || '');
      setEditing(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    const tbBtn: React.CSSProperties = {
      minWidth: 30, height: 30, padding: '0 .5rem',
      background: 'rgba(255,255,255,.05)', border: '1px solid var(--border, rgba(255,255,255,.2))',
      borderRadius: 6, color: 'var(--white, #fff)', cursor: 'pointer',
      fontFamily: 'Georgia, serif', fontSize: '.9rem', lineHeight: 1,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    };
    const tbSelect: React.CSSProperties = {
      height: 30, background: 'rgba(255,255,255,.05)', border: '1px solid var(--border, rgba(255,255,255,.2))',
      borderRadius: 6, color: 'var(--white, #fff)', fontSize: '.75rem', padding: '0 .35rem', cursor: 'pointer',
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        {/* Formatting toolbar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.35rem' }}>
          <button type="button" title="Bold" onMouseDown={(e) => { e.preventDefault(); exec('bold'); }} style={{ ...tbBtn, fontWeight: 700 }}>B</button>
          <button type="button" title="Italic" onMouseDown={(e) => { e.preventDefault(); exec('italic'); }} style={{ ...tbBtn, fontStyle: 'italic' }}>I</button>
          <button type="button" title="Underline" onMouseDown={(e) => { e.preventDefault(); exec('underline'); }} style={{ ...tbBtn, textDecoration: 'underline' }}>U</button>
          <select title="Font" defaultValue="" onChange={(e) => { exec('fontName', e.target.value); e.target.selectedIndex = 0; }} style={tbSelect}>
            {BIO_FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
          </select>
          <select title="Size" defaultValue="" onChange={(e) => { exec('fontSize', e.target.value); e.target.selectedIndex = 0; }} style={tbSelect}>
            <option value="" disabled>Size</option>
            {BIO_SIZES.map((s) => <option key={s.label} value={s.value}>{s.label}</option>)}
          </select>
          <label title="Text color" style={{ ...tbBtn, position: 'relative', overflow: 'hidden' }}>
            A
            <input
              type="color"
              onChange={(e) => exec('foreColor', e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
            />
          </label>
        </div>
        <div
          ref={editorRef}
          className={styles.bioEditor}
          contentEditable={!saving}
          suppressContentEditableWarning
          data-placeholder="Tell people about yourself, your sound, your style…"
          onInput={(e) => setDraft((e.target as HTMLDivElement).innerHTML)}
          style={{
            width: '100%',
            minHeight: 140,
            padding: '.75rem',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid var(--neon)',
            borderRadius: 6,
            color: 'var(--white, #fff)',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: '.95rem',
            lineHeight: 1.6,
            boxSizing: 'border-box',
            outline: 'none',
            overflowY: 'auto',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem' }}>
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            style={{
              padding: '.5rem .9rem',
              background: 'transparent',
              border: '1px solid var(--border, rgba(255,255,255,0.2))',
              borderRadius: 6,
              color: 'var(--muted, #888)',
              fontFamily: "'Space Mono', monospace",
              fontSize: '.7rem',
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
              padding: '.5rem 1rem',
              background: 'var(--neon)',
              border: 'none',
              borderRadius: 6,
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
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {error && (
          <div style={{
            padding: '.5rem .7rem',
            background: 'rgba(255, 95, 95, .08)',
            border: '1px solid rgba(255, 95, 95, .35)',
            borderRadius: 6,
            color: '#ff5f5f',
            fontSize: '.78rem',
          }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // View mode — clickable surface that switches to edit on click. When
  // empty, shows a small centered text cue. When populated, shows the
  // bio text with a small "Click to edit" hint underneath.
  return (
    <div
      onClick={startEdit}
      style={{
        cursor: 'pointer',
        padding: 0,
        borderRadius: 6,
      }}
    >
      {bio ? (
        <>
          <div
            style={{
              margin: 0,
              color: 'var(--white, #fff)',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: '.95rem',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}
            dangerouslySetInnerHTML={{ __html: sanitizeBioHtml(bio) }}
          />
          <div style={{
            marginTop: '.5rem',
            color: 'var(--neon)',
            fontFamily: "'Space Mono', monospace",
            fontSize: '.65rem',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            opacity: 0.7,
          }}>
            ✏ Click to edit
          </div>
        </>
      ) : (
        <div style={{
          textAlign: 'center',
          padding: '.5rem 0',
        }}>
          <span style={{
            display: 'inline-block',
            color: 'var(--neon)',
            fontFamily: "'Space Mono', monospace",
            fontSize: '.7rem',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            padding: '.4rem .8rem',
            border: '1px dashed var(--neon)',
            borderRadius: 6,
          }}>
            + Click to add your bio
          </span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ExpandableDesc — clamps the description to 3 lines via -webkit-line-clamp.
// If the rendered text is taller than the clamp, shows a Show more / Show
// less toggle. Used inside video cards in both owner-view (VideoMetaEditor)
// and the read-only public render. Detection happens after layout via a
// ref + scrollHeight comparison.
// ─────────────────────────────────────────────────────────────────────────
export function ExpandableDesc({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOverflow, setIsOverflow] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Measure after paint. When clamped, scrollHeight > clientHeight
    // means there's hidden content beyond the 3-line cap. We only set
    // the toggle visible if there's overflow.
    const el = ref.current;
    if (!el) return;
    // Defer to next frame so the line-clamp has been applied.
    const id = window.requestAnimationFrame(() => {
      setIsOverflow(el.scrollHeight > el.clientHeight + 1);
    });
    return () => window.cancelAnimationFrame(id);
  }, [text]);

  // Style for the text body — when collapsed, line-clamp to 3 via the
  // webkit -webkit-line-clamp / -webkit-box trick (still the most
  // reliable cross-browser line clamp). Expanded just shows everything.
  const collapsedStyle: React.CSSProperties = {
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    fontFamily: 'DM Sans, sans-serif',
    fontSize: '.82rem',
    color: 'var(--white, #fff)',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  };
  const expandedStyle: React.CSSProperties = {
    fontFamily: 'DM Sans, sans-serif',
    fontSize: '.82rem',
    color: 'var(--white, #fff)',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  };

  return (
    <div>
      <div ref={ref} style={expanded ? expandedStyle : collapsedStyle}>
        {text}
      </div>
      {isOverflow && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginTop: '.25rem',
            background: 'transparent',
            border: 'none',
            color: 'var(--neon)',
            fontFamily: "'Space Mono', monospace",
            fontSize: '.65rem',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
