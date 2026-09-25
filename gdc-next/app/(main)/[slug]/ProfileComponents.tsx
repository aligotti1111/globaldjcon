'use client';

// ProfileComponents — sub-components extracted from ProfileView.tsx
// (banner pills, hero actions, owner-editing controls, media editors,
// and all the profile modals). Kept in one module to avoid a tangle of
// tiny files while still slimming ProfileView down to its main render.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './profile.module.css';
import { createClient } from '@/lib/supabase/client';
import { EVENT_TYPE_LABELS } from './constants';
import {
  PhoneIcon, WebsiteIcon, SoundcloudIcon, InstagramIcon, TiktokIcon,
  FacebookIcon, TwitchIcon, CalendarIcon, MailIcon,
} from './icons';
import type { DjProfileData, Testimonial, Faq, AboutStats } from './profileTypes';
import { thumbUrl, validateImageFile, MAX_IMAGE_BYTES } from './profilePhotoUtils';
import { saveProfile, profileUploadFolder } from './profileSave';
import { canCreateAlbums, albumLimitForTier, newAlbumId, type Album } from '@/lib/albums';
import { sanitizeBioHtml } from '@/lib/sanitizeBio';
import { mobEventLabel, type CustomEventType } from '@/lib/constants';
import {
  STAFF_MAX, AFFILIATES_MAX, newEntryId, initialsOf, normalizeUrl, safeHexColor, isLightHex,
  type StaffMember, type Affiliate,
} from '@/lib/staff';
import AvatarCrop from '../update-dj-profile/AvatarCrop';
import { useConfirm } from '@/components/ConfirmModal';

export function BannerTypeEventsDropdown({ events, customTypes = [] }: { events: string[]; customTypes?: CustomEventType[] }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const badgeRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest('[data-banner-type-dropdown]')) {
        setOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function update() {
      if (!badgeRef.current) return;
      const r = badgeRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  const hasEvents = events.length > 0;

  return (
    <div
      ref={badgeRef}
      data-banner-type-dropdown
      className={`${styles.bannerNameBadge} ${styles.bannerNameBadgeMobile}`}
      onClick={(e) => {
        if (!hasEvents) return;
        e.stopPropagation();
        setOpen(o => !o);
      }}
      role={hasEvents ? 'button' : undefined}
      tabIndex={hasEvents ? 0 : undefined}
      onKeyDown={(e) => {
        if (!hasEvents) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen(o => !o);
        }
      }}
      style={{ cursor: hasEvents ? 'pointer' : 'default' }}
    >
      Mobile DJ{hasEvents && ' ▾'}
      {mounted && open && hasEvents && pos && createPortal(
        <div
          className={styles.bannerTypeDropdown}
          data-banner-type-dropdown
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
        >
          {events.map(ev => (
            <div key={ev} className={styles.bannerTypeDropdownItem}>
              {EVENT_TYPE_LABELS[ev] || mobEventLabel(ev, customTypes)}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────────────
// HeroActions — buttons row in the hero (socials + Copy Link).
// Logged-out users see the phone button as a "View Phone" gate placeholder
// to match vanilla — the actual gate modal is wired up in a later session.
// For Session 1 it's just disabled with a tooltip.
// ──────────────────────────────────────────────────────────────────────────

export function HeroActions({
  data,
  isLoggedIn,
  isOwnProfile,
  onClickMessage,
  hideSocials,
}: {
  data: DjProfileData;
  isLoggedIn: boolean;
  isOwnProfile: boolean;
  onClickMessage: () => void;
  hideSocials?: boolean;
}) {
  // Tracks which SocialAddButton (if any) is expanded. Lifted here so
  // opening one auto-closes any other that was open — only one inline
  // social-add input can be active at a time across the row.
  const [openSocialField, setOpenSocialField] = useState<string | null>(null);

  // (Copy-link / share moved to UnderBannerSocials.)

  // Normalize social URLs the way vanilla does (handle "@username" inputs)
  function normalizedWebsite(s: string): string {
    return s.startsWith('http') ? s : 'https://' + s.replace('@', '');
  }
  function normalizedSoundcloud(s: string): string {
    return s.startsWith('http') ? s : 'https://soundcloud.com/' + s.replace('@', '');
  }
  function normalizedFacebook(s: string): string {
    return s.startsWith('http') ? s : 'https://facebook.com/' + s.replace('@', '');
  }
  function normalizedTwitch(s: string): string {
    return s.startsWith('http') ? s : 'https://twitch.tv/' + s.replace('@', '');
  }
  // Instagram + TikTok previously assumed the field was always a bare
  // username and always prepended the domain — a DJ pasting a full
  // URL would end up with "https://instagram.com/https://..." which
  // doesn't work. These now check for an existing http prefix first
  // and only build the URL when given a bare handle.
  function normalizedInstagram(s: string): string {
    return s.startsWith('http') ? s : 'https://instagram.com/' + s.replace('@', '');
  }
  function normalizedTiktok(s: string): string {
    return s.startsWith('http') ? s : 'https://tiktok.com/@' + s.replace('@', '');
  }

  return (
    <div className={styles.heroActions}>
      {/* Phone — different behavior for logged-in vs logged-out (vanilla parity).
          Logged-out users see a button that would open a gate modal (TBD next session) */}
      {data.phone && (
        isLoggedIn ? (
          <a
            href={`tel:${data.phone}`}
            className={`${styles.actionBtn} ${styles.actionBtnPhone}`}
            title={data.phone}
          >
            <PhoneIcon />
          </a>
        ) : (
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionBtnPhone}`}
            title="View Phone"
            disabled
          >
            <PhoneIcon />
          </button>
        )
      )}

      {/* Social platforms — filled links render FIRST in declared
          platform order. After all filled links, the owner-only "+"
          add-buttons for missing platforms render to the right so the
          hero reads "active socials | quick-adds" instead of mixed. */}
      {!hideSocials && data.website && (
        <a
          href={normalizedWebsite(data.website)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.actionBtn} ${styles.actionBtnWebsite}`}
          title="Website"
        >
          <WebsiteIcon />
        </a>
      )}
      {!hideSocials && data.soundcloud && (
        <a
          href={normalizedSoundcloud(data.soundcloud)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.actionBtn} ${styles.actionBtnSoundcloud}`}
          title="SoundCloud"
        >
          <SoundcloudIcon />
        </a>
      )}
      {!hideSocials && data.instagram && (
        <a
          href={normalizedInstagram(data.instagram)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.actionBtn} ${styles.actionBtnInstagram}`}
          title="Instagram"
        >
          <InstagramIcon />
        </a>
      )}
      {!hideSocials && data.tiktok && (
        <a
          href={normalizedTiktok(data.tiktok)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.actionBtn} ${styles.actionBtnTiktok}`}
          title="TikTok"
        >
          <TiktokIcon />
        </a>
      )}
      {!hideSocials && data.facebook && (
        <a
          href={normalizedFacebook(data.facebook)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.actionBtn} ${styles.actionBtnFacebook}`}
          title="Facebook"
        >
          <FacebookIcon />
        </a>
      )}
      {!hideSocials && data.twitch && (
        <a
          href={normalizedTwitch(data.twitch)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.actionBtn} ${styles.actionBtnTwitch}`}
          title="Twitch"
        >
          <TwitchIcon />
        </a>
      )}

      {/* Owner-only quick-add buttons for platforms not yet filled. */}
      {!hideSocials && isOwnProfile && !data.website && (
        <SocialAddButton
          userId={data.id}
          field="website"
          label="Website"
          placeholder="https://yoursite.com"
          icon={<WebsiteIcon />}
          colorClass={styles.actionBtnWebsite}
        openField={openSocialField}
        setOpenField={setOpenSocialField}
        />
      )}
      {!hideSocials && isOwnProfile && !data.soundcloud && (
        <SocialAddButton
          userId={data.id}
          field="soundcloud"
          label="SoundCloud"
          placeholder="https://soundcloud.com/yourname"
          icon={<SoundcloudIcon />}
          colorClass={styles.actionBtnSoundcloud}
        openField={openSocialField}
        setOpenField={setOpenSocialField}
        />
      )}
      {!hideSocials && isOwnProfile && !data.instagram && (
        <SocialAddButton
          userId={data.id}
          field="instagram"
          label="Instagram"
          placeholder="@djyourname"
          icon={<InstagramIcon />}
          colorClass={styles.actionBtnInstagram}
        openField={openSocialField}
        setOpenField={setOpenSocialField}
        />
      )}
      {!hideSocials && isOwnProfile && !data.tiktok && (
        <SocialAddButton
          userId={data.id}
          field="tiktok"
          label="TikTok"
          placeholder="@djyourname"
          icon={<TiktokIcon />}
          colorClass={styles.actionBtnTiktok}
        openField={openSocialField}
        setOpenField={setOpenSocialField}
        />
      )}
      {!hideSocials && isOwnProfile && !data.facebook && (
        <SocialAddButton
          userId={data.id}
          field="facebook"
          label="Facebook"
          placeholder="https://facebook.com/yourpage"
          icon={<FacebookIcon />}
          colorClass={styles.actionBtnFacebook}
        openField={openSocialField}
        setOpenField={setOpenSocialField}
        />
      )}
      {!hideSocials && isOwnProfile && !data.twitch && (
        <SocialAddButton
          userId={data.id}
          field="twitch"
          label="Twitch"
          placeholder="https://twitch.tv/yourname"
          icon={<TwitchIcon />}
          colorClass={styles.actionBtnTwitch}
        openField={openSocialField}
        setOpenField={setOpenSocialField}
        />
      )}

      {data.rate && (
        <span
          className={`${styles.actionBtn} ${styles.actionBtnRate}`}
        >
          💰 {data.rate}
        </span>
      )}

      {/* Copy Link / share button moved out of the hero — it now lives at
          the end of the UnderBannerSocials row (below the banner) so the
          banner stays clean and the hero height matches across profile
          types. */}

      {/* Calendar icon kept hidden for now — the booking calendar lives in
          the tabs below, not in the hero. Keeping the import wired so we
          can add it back later without re-importing. */}
      <span style={{ display: 'none' }}>
        <CalendarIcon />
      </span>
    </div>
  );
}



// ─────────────────────────────────────────────────────────────────────────
// SocialAddButton — owner-only quick add for a single social platform.
// Renders in the same hero action slot a normal social link would, but
// in placeholder form: the platform's icon with a subtle dashed border
// and a small "+" badge. Click expands an inline input row right after
// the button; DJ pastes their URL or handle, hits Add, save writes to
// public.users for that one field. On success we reload so the placeholder
// is replaced by the real link button (with the colored hover state).
//
// Handle vs. URL paste is handled downstream by the existing normalized*
// functions in HeroActions — we just save what the DJ types.
// ─────────────────────────────────────────────────────────────────────────
export function SocialAddButton({
  userId,
  field,
  label,
  placeholder,
  icon,
  colorClass,
  openField,
  setOpenField,
  initialValue,
}: {
  userId: string;
  field: 'website' | 'soundcloud' | 'instagram' | 'tiktok' | 'facebook' | 'twitch' | 'phone';
  label: string;
  placeholder: string;
  icon: React.ReactNode;
  colorClass: string;
  /** Prefill the input (e.g. editing an existing phone number). */
  initialValue?: string;
  // Lifted state — only one SocialAddButton can be expanded at a time.
  // Each button reads openField to know if IT is the open one, and
  // calls setOpenField(field) on click / setOpenField(null) on close.
  openField: string | null;
  setOpenField: (field: string | null) => void;
}) {
  const expanded = openField === field;
  const [value, setValue] = useState(initialValue || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the parent closes us (because another button got opened), reset
  // local input state (back to any prefill) so we don't show stale text.
  useEffect(() => {
    if (!expanded) {
      setValue(initialValue || '');
      setError(null);
    }
  }, [expanded, initialValue]);

  // Editing an existing value (vs. adding a brand-new one) changes the
  // affordance: a pencil badge instead of "+", and clearing the field is
  // allowed (empty save removes the link) rather than erroring.
  const isEdit = !!(initialValue && initialValue.trim());

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed && !isEdit) {
      setError('Enter something first.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // Empty while editing => clear the link (store null to remove it).
      const nextValue = trimmed ? trimmed : null;
      await saveProfile(userId, { [field]: nextValue });
      // Reload so HeroActions re-renders with the live link button in
      // place of this add button. Server-loaded props don't update
      // otherwise.
      window.location.reload();
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
      setOpenField(null);
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setOpenField(field)}
        title={isEdit ? `Change ${label}` : `Add ${label}`}
        aria-label={isEdit ? `Change ${label}` : `Add ${label}`}
        className={`${styles.actionBtn} ${colorClass}${isEdit ? '' : ` ${styles.actionBtnEmpty}`}`}
      >
        {icon}
        {/* Corner badge: "+" to add a new link, pencil to edit an existing one.
            The edit badge is bigger and neon-tinted so it reads as an obvious
            "tap to edit" affordance rather than a smudge on the icon. */}
        <span style={{
          position: 'absolute',
          top: -3,
          right: -3,
          width: isEdit ? 17 : 14,
          height: isEdit ? 17 : 14,
          borderRadius: '50%',
          background: isEdit ? 'transparent' : '#fff',
          color: '#08080d',
          fontSize: '0.66rem',
          fontWeight: 800,
          lineHeight: '13px',
          textAlign: 'center',
          border: isEdit ? 'none' : '1.5px solid #08080d',
          boxSizing: 'border-box',
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {isEdit ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ filter: 'drop-shadow(0 0 1.5px rgba(0,0,0,.9))' }}>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          ) : '+'}
        </span>
      </button>
    );
  }

  return (
    // Outer wrapper — owns the line break behavior. flex-basis: 100%
    // forces this child to wrap onto its own row inside the heroActions
    // flex container. The actual styled panel lives inside, constrained
    // and left-aligned, so it doesn't sprawl across the whole hero.
    <div style={{
      flexBasis: '100%',
      order: 999,
      marginTop: '.5rem',
      display: 'flex',
      justifyContent: 'center',
    }}>
      <div style={{
        maxWidth: 460,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: '.5rem',
        padding: '.5rem .6rem',
        background: 'rgba(0, 245, 196, .08)',
        border: '1px solid var(--neon)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0, 245, 196, .12)',
      }}>
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
          padding: '.5rem .7rem',
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid var(--border, rgba(255,255,255,0.15))',
          borderRadius: 4,
          color: 'var(--white, #fff)',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: '.78rem',
        }}
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        title={`Add ${label}`}
        style={{
          padding: '.35rem .65rem',
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
        {saving ? '…' : 'Add'}
      </button>
      <button
        type="button"
        onClick={() => setOpenField(null)}
        disabled={saving}
        title="Cancel"
        aria-label="Cancel"
        style={{
          padding: '.25rem .4rem',
          background: 'transparent',
          border: 'none',
          color: 'var(--muted, #888)',
          cursor: saving ? 'not-allowed' : 'pointer',
          fontSize: '1rem',
          lineHeight: 1,
        }}
      >
        ✕
      </button>
      {error && (
        <span style={{
          color: '#ff5f5f',
          fontSize: '.7rem',
          fontFamily: 'DM Sans, sans-serif',
          marginLeft: '.25rem',
        }}>
          {error}
        </span>
      )}
      </div>
    </div>
  );
}

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

// ─────────────────────────────────────────────────────────────────────────
// PhotoManagerModal — owner-only popup that shows all 4 gallery slots
// as boxes in a 2x2 grid. Empty boxes are click-to-upload, filled boxes
// show the image with a remove ✕. Each slot operates independently and
// writes directly to public.users.gallery_img_${slot} as it changes.
// Mirrors the look of update-dj-profile/PhotosTab but lives on the
// public profile so the DJ never has to leave.
//
// On close we reload (?tab=images) so the underlying photo grid in
// the tab reflects whatever was added/removed.
// ─────────────────────────────────────────────────────────────────────────
export function PhotoManagerModal({
  userId,
  photos,
  albums = [],
  tier = 0,
  cap,
  isPaid,
  onClose,
}: {
  userId: string;
  photos: string[];
  albums?: Album[];
  tier?: number;
  cap: number;
  isPaid: boolean;
  onClose: () => void;
}) {
  // Array-based gallery. Photos persist to public.users.gallery_photos
  // (a jsonb array). Upload appends up to `cap`; remove pulls from the array.
  const [list, setList] = useState<string[]>(photos);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const atCap = list.length >= cap;

  // ── Albums (Premium Pro + Enterprise) ──────────────────────────────
  const canAlbums = canCreateAlbums(tier);
  const albumLimit = albumLimitForTier(tier);
  const [albumList, setAlbumList] = useState<Album[]>(albums);
  // Which album's photos the manager grid is filtered to (null = all).
  const [viewAlbumId, setViewAlbumId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const viewAlbum = viewAlbumId ? albumList.find((a) => a.id === viewAlbumId) || null : null;
  // Photos shown in the grid, newest first. Filtered to the album when viewing.
  const shown = (viewAlbum ? list.filter((u) => viewAlbum.photos.includes(u)) : list).slice().reverse();

  async function persist(next: string[]) {
    await saveProfile(userId, { gallery_photos: next });
  }
  async function persistAlbums(next: Album[]) {
    setAlbumList(next);
    await saveProfile(userId, { gallery_albums: next });
  }

  function toggleSelect(url: string) {
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(url)) s.delete(url); else s.add(url);
      return s;
    });
  }

  async function createAlbum() {
    const name = newName.trim();
    if (!name) return;
    if (albumList.length >= albumLimit) { setError(`You've reached your album limit (${albumLimit}).`); return; }
    const members = Array.from(selected);
    const album: Album = { id: newAlbumId(), name, cover: members[members.length - 1] || null, photos: members };
    setBusy(true);
    try {
      await persistAlbums([...albumList, album]);
      setNewName(''); setCreating(false); setSelected(new Set()); setSelectMode(false);
    } catch { setError('Could not create album.'); } finally { setBusy(false); }
  }

  async function assignSelectedTo(albumId: string) {
    const urls = Array.from(selected);
    if (!urls.length) return;
    setBusy(true);
    try {
      const next = albumList.map((a) => {
        if (a.id !== albumId) return a;
        const merged = [...a.photos, ...urls.filter((u) => !a.photos.includes(u))];
        return { ...a, photos: merged, cover: a.cover || merged[merged.length - 1] || null };
      });
      await persistAlbums(next);
      setSelected(new Set()); setSelectMode(false); setAssignOpen(false);
    } catch { setError('Could not add to album.'); } finally { setBusy(false); }
  }

  async function removeSelectedFromAlbum(albumId: string) {
    const urls = new Set(selected);
    setBusy(true);
    try {
      const next = albumList.map((a) => {
        if (a.id !== albumId) return a;
        const photos = a.photos.filter((u) => !urls.has(u));
        return { ...a, photos, cover: photos.includes(a.cover || '') ? a.cover : photos[photos.length - 1] || null };
      });
      await persistAlbums(next);
      setSelected(new Set());
    } catch { setError('Could not update album.'); } finally { setBusy(false); }
  }

  async function deleteAlbum(albumId: string) {
    setBusy(true);
    try {
      await persistAlbums(albumList.filter((a) => a.id !== albumId));
      if (viewAlbumId === albumId) setViewAlbumId(null);
    } catch { setError('Could not delete album.'); } finally { setBusy(false); }
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setError(null);
    const room = cap - list.length;
    if (room <= 0) return;
    const toAdd = files.slice(0, room);
    setBusy(true);
    try {
      const supabase = createClient();
      const uploaded: string[] = [];
      for (const file of toAdd) {
        const valErr = await validateImageFile(file);
        if (valErr) { setError(valErr); continue; }
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
        const id = rand.replace(/[^a-z0-9]/gi, '');
        const path = `${profileUploadFolder(userId)}/gallery_${id}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) { setError(upErr.message); continue; }
        const { data } = supabase.storage.from('avatars').getPublicUrl(path);
        uploaded.push(`${data.publicUrl}?t=${Date.now()}`);
      }
      if (uploaded.length) {
        const next = [...list, ...uploaded];
        await persist(next);
        setList(next);
        // Uploading while viewing an album drops the new photos into it too
        // (bulk upload from device straight into the album).
        if (viewAlbumId) {
          const nextAlbums = albumList.map((a) =>
            a.id === viewAlbumId
              ? { ...a, photos: [...a.photos, ...uploaded], cover: a.cover || uploaded[uploaded.length - 1] }
              : a,
          );
          await persistAlbums(nextAlbums);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function removeUrl(url: string) {
    if (busy) return;
    if (typeof window !== 'undefined' && !window.confirm('Delete this photo? This removes it from your gallery and any albums it’s in.')) return;
    setBusy(true);
    setError(null);
    try {
      const next = list.filter((u) => u !== url);
      await persist(next);
      setList(next);
      // Removing a photo from the gallery also drops it from any album it was
      // in (the gallery is the source of truth).
      if (albumList.some((a) => a.photos.includes(url))) {
        const nextAlbums = albumList.map((a) => {
          const photos = a.photos.filter((u) => u !== url);
          return { ...a, photos, cover: a.cover === url ? photos[photos.length - 1] || null : a.cover };
        });
        await persistAlbums(nextAlbums);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg-card, #1a1a2e)', border: '1px solid var(--border, rgba(255,255,255,0.1))', borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', color: 'var(--white, #fff)', letterSpacing: '.04em' }}>
            Manage Photos
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'var(--muted, #888)', fontSize: '1.4rem', cursor: 'pointer', padding: '.25rem .5rem' }}>✕</button>
        </div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.7rem', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted, #888)', marginBottom: '1rem' }}>
          {list.length} of {cap} photos
        </div>

        {/* Album controls (Premium Pro + Enterprise). Chips filter the grid to
            an album; Select turns on multi-select to add/remove photos in bulk.
            Lower tiers see an upgrade line instead. */}
        {canAlbums ? (
          <div style={{ marginBottom: '.9rem' }}>
            <div style={{ display: 'flex', gap: '.4rem', overflowX: 'auto', paddingBottom: '.4rem' }}>
              <button type="button" onClick={() => { setViewAlbumId(null); setSelected(new Set()); }} style={{ flexShrink: 0, fontSize: '.68rem', padding: '.3rem .7rem', borderRadius: 100, border: `1px solid ${!viewAlbumId ? 'var(--neon)' : 'var(--border,rgba(255,255,255,.2))'}`, background: !viewAlbumId ? 'var(--neon)' : 'transparent', color: !viewAlbumId ? '#04121a' : 'var(--muted,#aaa)', cursor: 'pointer', fontWeight: 600 }}>All photos</button>
              {albumList.map((a) => (
                <button key={a.id} type="button" onClick={() => { setViewAlbumId(a.id); setSelected(new Set()); }} style={{ flexShrink: 0, fontSize: '.68rem', padding: '.3rem .7rem', borderRadius: 100, border: `1px solid ${viewAlbumId === a.id ? 'var(--neon)' : 'var(--border,rgba(255,255,255,.2))'}`, background: viewAlbumId === a.id ? 'var(--neon)' : 'transparent', color: viewAlbumId === a.id ? '#04121a' : 'var(--muted,#aaa)', cursor: 'pointer', fontWeight: 600 }}>{a.name} · {a.photos.length}</button>
              ))}
              {/* Always-visible create-album entry point (no Select needed). */}
              {albumList.length < albumLimit && (
                creating ? (
                  <span style={{ flexShrink: 0, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Album name" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') createAlbum(); }} style={{ fontSize: '.7rem', padding: '.3rem .5rem', borderRadius: 100, border: '1px solid var(--neon)', background: '#0c0c11', color: '#fff', width: 120 }} />
                    <button type="button" disabled={busy || !newName.trim()} onClick={createAlbum} style={{ fontSize: '.66rem', padding: '.3rem .6rem', borderRadius: 100, border: 'none', background: 'var(--neon)', color: '#04121a', cursor: 'pointer', fontWeight: 700 }}>Add</button>
                    <button type="button" onClick={() => { setCreating(false); setNewName(''); }} style={{ fontSize: '.66rem', padding: '.3rem .5rem', borderRadius: 100, border: '1px solid var(--border,rgba(255,255,255,.2))', background: 'transparent', color: 'var(--muted,#aaa)', cursor: 'pointer' }}>✕</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setCreating(true)} style={{ flexShrink: 0, fontSize: '.68rem', padding: '.3rem .7rem', borderRadius: 100, border: '1px dashed var(--neon)', background: 'transparent', color: 'var(--neon)', cursor: 'pointer', fontWeight: 600 }}>+ New album</button>
                )
              )}
            </div>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '.5rem' }}>
              <button type="button" onClick={() => { setSelectMode((m) => !m); setSelected(new Set()); setAssignOpen(false); }} style={{ fontSize: '.68rem', padding: '.35rem .8rem', borderRadius: 6, border: '1px solid var(--neon)', background: selectMode ? 'var(--neon)' : 'transparent', color: selectMode ? '#04121a' : 'var(--neon)', cursor: 'pointer' }}>{selectMode ? 'Cancel' : 'Select'}</button>
              {selectMode && (
                <>
                  <span style={{ fontSize: '.7rem', color: 'var(--muted,#888)' }}>{selected.size} selected</span>
                  <button type="button" disabled={!selected.size || busy} onClick={() => setAssignOpen((o) => !o)} style={{ fontSize: '.68rem', padding: '.35rem .8rem', borderRadius: 6, border: '1px solid var(--border,rgba(255,255,255,.25))', background: 'transparent', color: 'var(--white,#fff)', cursor: selected.size ? 'pointer' : 'not-allowed', opacity: selected.size ? 1 : 0.5 }}>Add to album ▾</button>
                  {viewAlbum && (
                    <button type="button" disabled={!selected.size || busy} onClick={() => removeSelectedFromAlbum(viewAlbum.id)} style={{ fontSize: '.68rem', padding: '.35rem .8rem', borderRadius: 6, border: '1px solid #ff5f5f', background: 'transparent', color: '#ff5f5f', cursor: 'pointer', opacity: selected.size ? 1 : 0.5 }}>Remove from {viewAlbum.name}</button>
                  )}
                </>
              )}
              {selectMode && assignOpen && (
                <div style={{ width: '100%', display: 'flex', flexWrap: 'wrap', gap: '.4rem', padding: '.5rem', border: '1px solid var(--border,rgba(255,255,255,.15))', borderRadius: 8 }}>
                  {albumList.map((a) => (
                    <button key={a.id} type="button" disabled={busy} onClick={() => assignSelectedTo(a.id)} style={{ fontSize: '.68rem', padding: '.3rem .7rem', borderRadius: 6, border: '1px solid var(--border,rgba(255,255,255,.2))', background: 'transparent', color: 'var(--white,#fff)', cursor: 'pointer' }}>{a.name}</button>
                  ))}
                  {albumList.length < albumLimit ? (
                    creating ? (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Album name" autoFocus style={{ fontSize: '.7rem', padding: '.3rem .5rem', borderRadius: 6, border: '1px solid var(--border,rgba(255,255,255,.25))', background: '#0c0c11', color: '#fff' }} />
                        <button type="button" disabled={busy || !newName.trim()} onClick={createAlbum} style={{ fontSize: '.68rem', padding: '.3rem .7rem', borderRadius: 6, border: 'none', background: 'var(--neon)', color: '#04121a', cursor: 'pointer', fontWeight: 700 }}>Create</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setCreating(true)} style={{ fontSize: '.68rem', padding: '.3rem .7rem', borderRadius: 6, border: '1px dashed var(--neon)', background: 'transparent', color: 'var(--neon)', cursor: 'pointer' }}>+ New album</button>
                    )
                  ) : (
                    <span style={{ fontSize: '.66rem', color: 'var(--muted,#888)' }}>Album limit reached ({albumLimit})</span>
                  )}
                </div>
              )}
              {!selectMode && viewAlbum && (
                <button type="button" onClick={() => deleteAlbum(viewAlbum.id)} style={{ fontSize: '.66rem', padding: '.35rem .8rem', borderRadius: 6, border: '1px solid #ff5f5f', background: 'transparent', color: '#ff5f5f', cursor: 'pointer', marginLeft: 'auto' }}>Delete album</button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: '.9rem', padding: '.6rem .8rem', border: '1px solid var(--border,rgba(255,255,255,.15))', borderRadius: 8, fontSize: '.76rem', color: 'var(--muted,#aaa)' }}>
            Organize photos into albums with <a href="/subscribe" style={{ color: 'var(--neon)', fontWeight: 700 }}>Premium Pro</a>.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.6rem' }}>
          {shown.map((url, idx) => {
            const isSel = selected.has(url);
            return (
            <div key={`${url}-${idx}`} onClick={() => { if (selectMode) toggleSelect(url); }} style={{ position: 'relative', aspectRatio: '1 / 1', background: '#000', border: `2px solid ${isSel ? 'var(--neon)' : 'var(--border, rgba(255,255,255,0.15))'}`, borderRadius: 8, overflow: 'hidden', cursor: selectMode ? 'pointer' : 'default' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbUrl(url, 400)} alt={`Photo ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: selectMode && !isSel ? 0.65 : 1 }} />
              {selectMode && (
                <span style={{ position: 'absolute', top: 4, left: 4, width: 20, height: 20, borderRadius: '50%', background: isSel ? 'var(--neon)' : 'rgba(0,0,0,.55)', color: '#04121a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{isSel ? '✓' : ''}</span>
              )}
              {!selectMode && (
                <button
                  type="button"
                  onClick={() => removeUrl(url)}
                  aria-label="Remove photo"
                  style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 13, cursor: 'pointer', lineHeight: 1 }}
                >✕</button>
              )}
            </div>
            );
          })}

          {!atCap && !selectMode && (
            <div
              onClick={() => { if (!busy) inputRef.current?.click(); }}
              style={{ aspectRatio: '1 / 1', background: 'rgba(0,245,196,.05)', border: '2px dashed var(--neon)', borderRadius: 8, cursor: busy ? 'wait' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--neon)', opacity: busy ? 0.6 : 1 }}
            >
              <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>+</span>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.05em', marginTop: 4 }}>ADD</span>
            </div>
          )}
        </div>

        <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onFiles} />

        {atCap && !isPaid && (
          <div style={{ marginTop: '1rem', padding: '.75rem .9rem', border: '1px solid var(--neon)', borderRadius: 8, background: 'rgba(0,245,196,.06)', fontFamily: 'DM Sans, sans-serif', fontSize: '.82rem', color: 'var(--white,#fff)' }}>
            You&apos;ve reached the free limit of {cap} photos.{' '}
            <a href="/subscribe" style={{ color: 'var(--neon)', fontWeight: 700 }}>Upgrade</a> to add up to 50.
          </div>
        )}

        {error && (
          <div style={{ marginTop: '.75rem', color: '#ff5f5f', fontSize: '.78rem', fontFamily: 'DM Sans, sans-serif' }}>{error}</div>
        )}

        <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '.6rem 1.4rem', background: 'var(--neon)', border: 'none', borderRadius: 6, color: '#000', fontFamily: "'Space Mono', monospace", fontSize: '.75rem', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, cursor: 'pointer' }}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CreateAlbumModal — the "New album" flow. Focused on CREATING one album:
// name it, then fill it either by uploading from the device or picking from
// the DJ's existing gallery photos. It intentionally has NO delete-photo
// capability — it only adds; managing/removing photos lives in the photo
// manager. Uploaded photos also land in the main gallery (source of truth).
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// AddPhotosModal — the lightweight "+ Add" flow. Just a Choose-photos button
// and a Save button: pick files (they preview), then Save uploads them and
// appends to the gallery. No delete/album/select clutter — that all lives in
// the full Manage Photos manager.
// ─────────────────────────────────────────────────────────────────────────
export function AddPhotosModal({
  userId,
  currentCount,
  cap,
  onClose,
}: {
  userId: string;
  currentCount: number;
  cap: number;
  onClose: () => void;
}) {
  const [staged, setStaged] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const room = cap - currentCount - staged.length;

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setError(null);
    const avail = cap - currentCount - staged.length;
    if (avail <= 0) { setError(`Photo limit reached (${cap}).`); return; }
    const toAdd = files.slice(0, avail).map((file) => ({ file, url: URL.createObjectURL(file) }));
    if (files.length > avail) setError(`Only ${avail} more photo${avail === 1 ? '' : 's'} allowed — extras were skipped.`);
    setStaged((prev) => [...prev, ...toAdd]);
  }

  function removeStaged(idx: number) {
    setStaged((prev) => {
      const removed = prev[idx];
      if (removed) URL.revokeObjectURL(removed.url);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function save() {
    if (!staged.length) { onClose(); return; }
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const uploaded: string[] = [];
      for (const { file } of staged) {
        const valErr = await validateImageFile(file);
        if (valErr) { setError(valErr); continue; }
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const rand = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
        const id = rand.replace(/[^a-z0-9]/gi, '');
        const path = `${profileUploadFolder(userId)}/gallery_${id}.${ext}`;
        const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) { setError(upErr.message); continue; }
        const { data } = supabase.storage.from('avatars').getPublicUrl(path);
        uploaded.push(`${data.publicUrl}?t=${Date.now()}`);
      }
      if (!uploaded.length) { setBusy(false); return; }
      // Append to the gallery (source of truth). Re-read first so we don't
      // clobber photos added elsewhere; the owner passes the full next array.
      const { data: row } = await supabase.from('users').select('gallery_photos').eq('id', userId).single();
      const rowPhotos = (row as unknown as { gallery_photos?: string[] } | null)?.gallery_photos;
      const existing: string[] = Array.isArray(rowPhotos) ? rowPhotos : [];
      await saveProfile(userId, { gallery_photos: [...existing, ...uploaded] });
      staged.forEach((s) => URL.revokeObjectURL(s.url));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
      setBusy(false);
    }
  }

  return (
    <div onClick={() => !busy && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card, #14141b)', border: '1px solid var(--border, rgba(255,255,255,0.12))', borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', color: 'var(--white, #fff)', letterSpacing: '.04em' }}>Add photos</div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'var(--muted, #888)', fontSize: '1.4rem', cursor: 'pointer', padding: '.25rem .5rem' }}>✕</button>
        </div>

        <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onPick} />
        <button type="button" disabled={busy || room <= 0} onClick={() => inputRef.current?.click()} style={{ width: '100%', padding: '.7rem 1rem', borderRadius: 8, border: '1.5px solid var(--neon)', background: 'rgba(0,245,196,.06)', color: 'var(--neon)', fontWeight: 700, fontSize: '.85rem', cursor: room <= 0 ? 'not-allowed' : 'pointer', opacity: room <= 0 ? 0.5 : 1 }}>
          {staged.length ? 'Choose more photos' : 'Choose photos'}
        </button>
        <div style={{ fontSize: '.7rem', color: 'var(--muted,#888)', marginTop: '.4rem', textAlign: 'center' }}>{currentCount + staged.length} of {cap} used · max {Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB per photo</div>

        {staged.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.5rem', marginTop: '1rem' }}>
            {staged.map((s, i) => (
              <div key={i} style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border,rgba(255,255,255,.15))' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {!busy && (
                  <button type="button" onClick={() => removeStaged(i)} aria-label="Remove" style={{ position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.6)', color: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}>✕</button>
                )}
              </div>
            ))}
          </div>
        )}

        {error && <div style={{ color: '#ff5f5f', fontSize: '.78rem', marginTop: '.75rem' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.6rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ padding: '.6rem 1.2rem', background: 'transparent', border: '1px solid var(--border,rgba(255,255,255,.25))', borderRadius: 6, color: 'var(--white,#fff)', fontSize: '.78rem', cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={save} disabled={busy || staged.length === 0} style={{ padding: '.6rem 1.4rem', background: 'var(--neon)', border: 'none', borderRadius: 6, color: '#04121a', fontWeight: 700, fontSize: '.78rem', letterSpacing: '.04em', textTransform: 'uppercase', cursor: busy || !staged.length ? 'not-allowed' : 'pointer', opacity: busy || !staged.length ? 0.6 : 1 }}>{busy ? 'Saving…' : `Save${staged.length ? ` (${staged.length})` : ''}`}</button>
        </div>
      </div>
    </div>
  );
}

export function CreateAlbumModal({
  userId,
  photos,
  albums,
  cap,
  editAlbum = null,
  onClose,
}: {
  userId: string;
  photos: string[];
  albums: Album[];
  cap: number;
  editAlbum?: Album | null; // when set, the modal edits this album
  onClose: () => void;
}) {
  const isEdit = !!editAlbum;
  const [name, setName] = useState(editAlbum?.name ?? '');
  const [gallery, setGallery] = useState<string[]>(photos); // grows on upload
  const [added, setAdded] = useState<string[]>([]); // uploaded THIS session
  const [chosen, setChosen] = useState<Set<string>>(new Set(editAlbum?.photos ?? []));
  // Which selected photo is the album cover/thumbnail (edit mode).
  const [coverSel, setCoverSel] = useState<string | null>(editAlbum?.cover ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Split the picker: photos uploaded from the device this session vs. the
  // DJ's pre-existing gallery. Newest first in each group.
  const justAdded = added.slice().reverse();
  const addedSet = new Set(added);
  const existing = photos.filter((u) => !addedSet.has(u)).slice().reverse();

  function toggle(url: string) {
    setChosen((prev) => {
      const s = new Set(prev);
      if (s.has(url)) s.delete(url); else s.add(url);
      return s;
    });
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setError(null);
    const room = cap - gallery.length;
    if (room <= 0) { setError(`Photo limit reached (${cap}).`); return; }
    const toAdd = files.slice(0, room);
    setBusy(true);
    try {
      const supabase = createClient();
      const uploaded: string[] = [];
      for (const file of toAdd) {
        const valErr = await validateImageFile(file);
        if (valErr) { setError(valErr); continue; }
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const rand = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
        const id = rand.replace(/[^a-z0-9]/gi, '');
        const path = `${profileUploadFolder(userId)}/gallery_${id}.${ext}`;
        const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) { setError(upErr.message); continue; }
        const { data } = supabase.storage.from('avatars').getPublicUrl(path);
        uploaded.push(`${data.publicUrl}?t=${Date.now()}`);
      }
      if (uploaded.length) {
        const nextGallery = [...gallery, ...uploaded];
        // Persist the grown gallery immediately (uploads belong to it).
        await saveProfile(userId, { gallery_photos: nextGallery });
        setGallery(nextGallery);
        setAdded((prev) => [...prev, ...uploaded]);
        // Newly uploaded photos are auto-selected for the album.
        setChosen((prev) => { const s = new Set(prev); uploaded.forEach((u) => s.add(u)); return s; });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const nm = name.trim();
    if (!nm) { setError('Name your album.'); return; }
    if (chosen.size === 0) { setError('Add at least one photo.'); return; }
    // Members in gallery order (oldest→newest) so album order matches feed.
    const members = gallery.filter((u) => chosen.has(u));
    setBusy(true);
    try {
      let nextAlbums: Album[];
      if (isEdit && editAlbum) {
        // Use the owner-picked cover if it's still a member; otherwise keep the
        // existing cover if valid, else fall back to the newest member.
        const cover = coverSel && chosen.has(coverSel)
          ? coverSel
          : (editAlbum.cover && chosen.has(editAlbum.cover) ? editAlbum.cover : members[members.length - 1] || null);
        nextAlbums = albums.map((a) => (a.id === editAlbum.id ? { ...a, name: nm, photos: members, cover } : a));
      } else {
        const album: Album = { id: newAlbumId(), name: nm, cover: members[members.length - 1] || null, photos: members };
        nextAlbums = [...albums, album];
      }
      await saveProfile(userId, { gallery_albums: nextAlbums });
      setSaved(true);
      onClose();
    } catch {
      setError(isEdit ? 'Could not save the album.' : 'Could not create the album.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAlbum() {
    if (!editAlbum) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete the album "${editAlbum.name}"? Your photos stay in the gallery — only the album is removed.`)) return;
    setBusy(true);
    try {
      await saveProfile(userId, { gallery_albums: albums.filter((a) => a.id !== editAlbum.id) });
      setSaved(true);
      onClose();
    } catch {
      setError('Could not delete the album.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card, #1a1a2e)', border: '1px solid var(--border, rgba(255,255,255,0.1))', borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.9rem' }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', color: 'var(--white, #fff)', letterSpacing: '.04em' }}>{isEdit ? 'Edit album' : 'New album'}</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'var(--muted, #888)', fontSize: '1.4rem', cursor: 'pointer', padding: '.25rem .5rem' }}>✕</button>
        </div>

        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Album name (e.g. Weddings)" autoFocus style={{ width: '100%', padding: '.6rem .8rem', borderRadius: 8, border: '1px solid var(--border,rgba(255,255,255,.25))', background: '#0c0c11', color: '#fff', fontSize: '.9rem', marginBottom: '1rem' }} />

        <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} style={{ padding: '.55rem 1rem', borderRadius: 8, border: '1px solid var(--neon)', background: 'var(--neon)', color: '#04121a', fontWeight: 700, fontSize: '.78rem', cursor: 'pointer' }}>Upload from device</button>
          <span style={{ fontSize: '.72rem', color: 'var(--muted,#888)' }}>{chosen.size} selected</span>
        </div>
        <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onFiles} />

        {(() => {
          const tile = (url: string, idx: number) => {
            const isSel = chosen.has(url);
            const isCover = isEdit && coverSel === url;
            return (
              <div key={`${url}-${idx}`} onClick={() => toggle(url)} style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', border: `2px solid ${isCover ? '#ffd24a' : isSel ? 'var(--neon)' : 'var(--border,rgba(255,255,255,.15))'}`, cursor: 'pointer' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbUrl(url, 300)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: isSel ? 1 : 0.7 }} />
                <span style={{ position: 'absolute', top: 3, left: 3, width: 18, height: 18, borderRadius: '50%', background: isSel ? 'var(--neon)' : 'rgba(0,0,0,.55)', color: '#04121a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{isSel ? '✓' : ''}</span>
                {/* Edit mode: set as album cover. Only for selected photos. */}
                {isEdit && isSel && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setCoverSel(url); }}
                    title={isCover ? 'Album cover' : 'Set as cover'}
                    aria-label={isCover ? 'Album cover' : 'Set as cover'}
                    style={{ position: 'absolute', top: 3, right: 3, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.6)', color: isCover ? '#ffd24a' : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill={isCover ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                  </button>
                )}
                {isCover && (
                  <span style={{ position: 'absolute', bottom: 3, left: 3, right: 3, textAlign: 'center', fontSize: '.55rem', letterSpacing: '.05em', textTransform: 'uppercase', color: '#ffd24a', background: 'rgba(0,0,0,.55)', borderRadius: 4, padding: '1px 0' }}>Cover</span>
                )}
              </div>
            );
          };
          const heading = (t: string) => (
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.66rem', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted,#888)', margin: '0 0 .6rem' }}>{t}</div>
          );
          return (
            <>
              {justAdded.length > 0 && (
                <>
                  {heading(`Just added · ${justAdded.length}`)}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.5rem', marginBottom: '1rem' }}>
                    {justAdded.map((u, i) => tile(u, i))}
                  </div>
                </>
              )}
              {heading('Or choose from your photos')}
              {existing.length === 0 ? (
                <div style={{ fontSize: '.78rem', color: 'var(--muted,#888)', marginBottom: '1rem' }}>{justAdded.length ? 'That’s all your existing photos.' : 'No photos yet — upload some above.'}</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.5rem', marginBottom: '1rem' }}>
                  {existing.map((u, i) => tile(u, i))}
                </div>
              )}
            </>
          );
        })()}

        {error && <div style={{ color: '#ff5f5f', fontSize: '.78rem', marginBottom: '.75rem' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '.6rem' }}>
          {isEdit && (
            <button type="button" disabled={busy} onClick={deleteAlbum} style={{ marginRight: 'auto', padding: '.6rem 1rem', background: 'transparent', border: '1px solid #ff5f5f', borderRadius: 6, color: '#ff5f5f', fontSize: '.75rem', cursor: 'pointer' }}>Delete album</button>
          )}
          <button type="button" onClick={onClose} style={{ padding: '.6rem 1.2rem', background: 'transparent', border: '1px solid var(--border,rgba(255,255,255,.25))', borderRadius: 6, color: 'var(--white,#fff)', fontSize: '.78rem', cursor: 'pointer' }}>Cancel</button>
          <button type="button" disabled={busy || saved} onClick={save} style={{ padding: '.6rem 1.4rem', background: 'var(--neon)', border: 'none', borderRadius: 6, color: '#04121a', fontFamily: "'Space Mono', monospace", fontSize: '.75rem', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create album'}</button>
        </div>
      </div>
    </div>
  );
}



// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─// ─
// EmbedCalendarModal — owner-only popup that generates a copy-pasteable
// iframe snippet pointing at /embed-calendar?slug=…. Mirrors the
// generator UX of update-dj-profile/EmbedCodeSection but inlined here
// so the public profile stays self-contained (no shared CSS module
// dependency).
//
// Settings: theme (dark | light), starting height in px. The snippet
// includes a tiny <script> that listens for the gdc-embed-height
// postMessage from /embed-calendar and resizes the iframe automatically.
// ─────────────────────────────────────────────────────────────────────────
export function EmbedCalendarModal({
  slug,
  onClose,
}: {
  slug: string;
  onClose: () => void;
}) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [height, setHeight] = useState<number>(520);
  const [copied, setCopied] = useState(false);

  // Hardcoded production base — the snippet has to be portable across
  // any third-party site, regardless of where the DJ generated it.
  const baseSrc = `https://globaldjconnect.com/embed-calendar?slug=${encodeURIComponent(slug)}&theme=${theme}&months=1`;
  const previewSrc = `/embed-calendar?slug=${encodeURIComponent(slug)}&theme=${theme}&months=1`;

  const snippet =
    `<!-- Global DJ Connect — availability calendar -->\n` +
    `<iframe id="gdc-cal-${slug}" src="${baseSrc}" ` +
    `style="width:100%;height:${height}px;border:0;display:block;" ` +
    `loading="lazy" title="DJ Availability Calendar"></iframe>\n` +
    `<script>\n` +
    `(function(){window.addEventListener('message',function(e){` +
    `if(e.data&&e.data.type==='gdc-embed-height'&&e.data.slug==='${slug}'){` +
    `var f=document.getElementById('gdc-cal-${slug}');if(f)f.style.height=e.data.height+'px';}});` +
    `})();\n` +
    `<\/script>`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Fallback for browsers that block the async clipboard API
      const ta = document.createElement('textarea');
      ta.value = snippet;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        // Give up silently
      }
      document.body.removeChild(ta);
    }
  }

  // No slug yet — should be effectively impossible from this entry
  // point (button only shows on an owned profile) but guard anyway.
  if (!slug) {
    return (
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'var(--bg-card, #1a1a2e)',
            border: '1px solid var(--border, rgba(255,255,255,0.1))',
            borderRadius: 12,
            padding: '1.5rem',
            width: '100%',
            maxWidth: 480,
            color: 'var(--white, #fff)',
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          Set your URL slug on the General tab first — the embed code
          needs a slug to point at.
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #1a1a2e)',
          border: '1px solid var(--border, rgba(255,255,255,0.1))',
          borderRadius: 12,
          padding: '1.5rem',
          width: '100%',
          maxWidth: 640,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '.4rem',
          }}
        >
          <div
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '1.4rem',
              color: 'var(--white, #fff)',
              letterSpacing: '.04em',
            }}
          >
            Embed Your Calendar
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted, #888)',
              fontSize: '1.4rem',
              cursor: 'pointer',
              padding: '.25rem .5rem',
            }}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '.82rem',
            color: 'var(--muted, #888)',
            marginBottom: '1rem',
            lineHeight: 1.5,
          }}
        >
          Paste this snippet on any website to display your live calendar.
          When visitors click an open date, they&apos;ll be sent to your
          Global DJ Connect profile to book.
        </div>

        {/* Settings row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '.75rem',
            marginBottom: '1rem',
          }}
        >
          <div>
            <label
              style={{
                display: 'block',
                fontFamily: "'Space Mono', monospace",
                fontSize: '.6rem',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: 'var(--muted, #888)',
                marginBottom: '.35rem',
              }}
            >
              Theme
            </label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}
              style={{
                width: '100%',
                background: 'var(--deep, #0a0a1a)',
                border: '1px solid var(--border, rgba(255,255,255,0.1))',
                borderRadius: 6,
                color: 'var(--white, #fff)',
                padding: '.55rem .75rem',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '.88rem',
              }}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontFamily: "'Space Mono', monospace",
                fontSize: '.6rem',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: 'var(--muted, #888)',
                marginBottom: '.35rem',
              }}
            >
              Starting Height (px)
            </label>
            <select
              value={height}
              onChange={(e) => setHeight(parseInt(e.target.value, 10))}
              style={{
                width: '100%',
                background: 'var(--deep, #0a0a1a)',
                border: '1px solid var(--border, rgba(255,255,255,0.1))',
                borderRadius: 6,
                color: 'var(--white, #fff)',
                padding: '.55rem .75rem',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '.88rem',
              }}
            >
              <option value={400}>400px — Compact</option>
              <option value={520}>520px — Standard</option>
              <option value={600}>600px — Medium</option>
              <option value={700}>700px — Tall</option>
              <option value={850}>850px — Extra Tall</option>
            </select>
          </div>
        </div>

        {/* Code block + copy */}
        <label
          style={{
            display: 'block',
            fontFamily: "'Space Mono', monospace",
            fontSize: '.6rem',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: 'var(--muted, #888)',
            marginBottom: '.35rem',
          }}
        >
          Embed Code
        </label>
        <textarea
          readOnly
          value={snippet}
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          rows={5}
          style={{
            width: '100%',
            background: 'var(--deep, #0a0a1a)',
            border: '1px solid var(--border, rgba(255,255,255,0.1))',
            borderRadius: 6,
            color: 'var(--white, #fff)',
            padding: '.75rem',
            fontFamily: "'Space Mono', monospace",
            fontSize: '.7rem',
            lineHeight: 1.55,
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        <button
          type="button"
          onClick={copy}
          style={{
            marginTop: '.65rem',
            fontFamily: "'Space Mono', monospace",
            fontSize: '.65rem',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            padding: '.6rem 1.2rem',
            borderRadius: 6,
            border: 'none',
            background: copied ? 'var(--success, #4caf50)' : 'var(--neon)',
            color: '#000',
            cursor: 'pointer',
            fontWeight: 700,
            transition: 'background .2s',
          }}
        >
          {copied ? '✓ Copied' : 'Copy Code'}
        </button>

        {/* Live preview */}
        <div style={{ marginTop: '1.25rem' }}>
          <div
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '.6rem',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              color: 'var(--muted, #888)',
              marginBottom: '.45rem',
            }}
          >
            Live Preview
          </div>
          <iframe
            // Re-mount when slug or theme changes so the iframe reloads
            key={`${slug}-${theme}`}
            src={previewSrc}
            style={{
              width: '100%',
              height: `${height}px`,
              border: '1px solid var(--border, rgba(255,255,255,0.1))',
              borderRadius: 6,
              display: 'block',
            }}
            loading="lazy"
            title="Embed preview"
          />
        </div>
      </div>
    </div>
  );
}

// ── BannerEditModal ────────────────────────────────────────────
// Self-contained modal for owner banner management:
//   - Upload / replace banner image
//   - Two side-by-side previews (DESKTOP 4:1 and MOBILE 1.6:1) — each
//     independently draggable to reposition the image vertically for
//     that viewport.
//   - Save commits banner_url (if new file uploaded), banner_position
//     (desktop), and banner_position_mobile (mobile) in one update.
// The modal reloads the page on save so the live banner refreshes.
export function BannerEditModal({
  userId,
  initialUrl,
  initialPosition,
  initialPositionMobile,
  onClose,
}: {
  userId: string;
  initialUrl: string | null;
  initialPosition: string | null;
  initialPositionMobile: string | null;
  onClose: () => void;
}) {
  function parsePosY(stored: string | null, fallback: number): number {
    const parts = (stored || '').split(' ');
    const y = parseFloat(parts[1] || '');
    return Number.isFinite(y) ? y : fallback;
  }

  // Working state — starts from props but tracks unsaved changes locally.
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialUrl);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingObjectUrl, setPendingObjectUrl] = useState<string | null>(null);
  const [posY, setPosY] = useState<number>(() => parsePosY(initialPosition, 50));
  // Mobile defaults to the desktop position if not yet set so the user has
  // a sane starting point on first edit.
  const [posYMobile, setPosYMobile] = useState<number>(() =>
    parsePosY(initialPositionMobile, parsePosY(initialPosition, 50))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True while a file is being dragged over the drop zone — drives the
  // highlighted "drop to upload" state.
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDesktopRef = useRef<{ startY: number; startPos: number } | null>(null);
  const dragMobileRef = useRef<{ startY: number; startPos: number } | null>(null);

  useEffect(() => {
    return () => {
      if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl);
    };
  }, [pendingObjectUrl]);

  // Shared file handler — used by both the file picker and drag-and-drop.
  async function applyFile(file: File | undefined | null) {
    if (!file) return;
    const valErr = await validateImageFile(file);
    if (valErr) {
      setError(valErr);
      return;
    }
    setError(null);
    if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl);
    const blobUrl = URL.createObjectURL(file);
    setPendingObjectUrl(blobUrl);
    setPreviewUrl(blobUrl);
    setPendingFile(file);
  }

  async function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    await applyFile(file);
  }

  // Drag-and-drop: accept an image file dropped anywhere on the drop zone.
  function onDropZoneDragOver(e: React.DragEvent) {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      setDragOver(true);
    }
  }
  function onDropZoneDragLeave(e: React.DragEvent) {
    // Only clear when leaving the zone itself, not when moving between
    // children (relatedTarget still inside).
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }
  async function onDropZoneDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    await applyFile(file);
  }

  // Generic drag handlers parameterized by which viewport we're editing.
  function makePointerDown(
    ref: React.MutableRefObject<{ startY: number; startPos: number } | null>,
    currentPos: number
  ) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (!previewUrl) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      ref.current = { startY: e.clientY, startPos: currentPos };
    };
  }
  function makePointerMove(
    ref: React.MutableRefObject<{ startY: number; startPos: number } | null>,
    setter: (v: number) => void
  ) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (!ref.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const delta = e.clientY - ref.current.startY;
      const deltaPct = (delta / rect.height) * 100;
      let next = ref.current.startPos - deltaPct;
      if (next < 0) next = 0;
      if (next > 100) next = 100;
      setter(next);
    };
  }
  function makePointerUp(
    ref: React.MutableRefObject<{ startY: number; startPos: number } | null>
  ) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (ref.current) {
        e.currentTarget.releasePointerCapture(e.pointerId);
        ref.current = null;
      }
    };
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      let newPublicUrl: string | null = null;
      if (pendingFile) {
        const ext = (pendingFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${profileUploadFolder(userId)}/banner.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, pendingFile, { upsert: true, contentType: pendingFile.type });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
        newPublicUrl = `${pub.publicUrl}?t=${Date.now()}`;
      }
      const patch: Record<string, string> = {
        banner_position: `50% ${posY}%`,
        banner_position_mobile: `50% ${posYMobile}%`,
      };
      if (newPublicUrl) patch.banner_url = newPublicUrl;
      await saveProfile(userId, patch);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      setBusy(false);
    }
  }

  async function removeBanner() {
    if (!confirm('Remove your banner?')) return;
    setBusy(true);
    setError(null);
    try {
      await saveProfile(userId, {
        banner_url: null,
        banner_position: null,
        banner_position_mobile: null,
      });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed.');
      setBusy(false);
    }
  }

  return (
    <div className={styles.bannerModalBackdrop} onClick={onClose}>
      <div className={styles.bannerModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.bannerModalHeader}>
          <h2 className={styles.bannerModalTitle}>Edit Banner</h2>
          <button
            type="button"
            onClick={onClose}
            className={styles.bannerModalClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className={styles.bannerModalBody}>
          {/* Two-up previews — desktop (4:1) on left, mobile (1.6:1) on
              right. Each is independently draggable so the DJ can position
              the image differently for each viewport. When no banner is
              set, clicking either preview opens the file picker. */}
          <div
            className={styles.bannerPreviewsRow}
            onDragOver={onDropZoneDragOver}
            onDragLeave={onDropZoneDragLeave}
            onDrop={onDropZoneDrop}
            style={dragOver ? { outline: '2px dashed var(--neon, #00e0a4)', outlineOffset: 4, borderRadius: 8 } : undefined}
          >
            <div className={styles.bannerPreviewBlock}>
              <div className={styles.bannerPreviewLabel}>
                Desktop view
                <span className={styles.bannerPreviewRatio}>1600 × 400 (4:1)</span>
              </div>
              <div
                className={`${styles.bannerModalPreview} ${styles.bannerModalPreviewDesktop} ${
                  !previewUrl ? styles.bannerModalPreviewEmpty : ''
                }`}
                style={
                  previewUrl
                    ? {
                        backgroundImage: `url(${previewUrl})`,
                        backgroundPosition: `50% ${posY}%`,
                        cursor: 'grab',
                      }
                    : undefined
                }
                onClick={!previewUrl ? () => fileRef.current?.click() : undefined}
                onPointerDown={previewUrl ? makePointerDown(dragDesktopRef, posY) : undefined}
                onPointerMove={previewUrl ? makePointerMove(dragDesktopRef, setPosY) : undefined}
                onPointerUp={previewUrl ? makePointerUp(dragDesktopRef) : undefined}
                onPointerCancel={previewUrl ? makePointerUp(dragDesktopRef) : undefined}
              >
                {!previewUrl && (
                  <div className={styles.bannerModalEmpty}>
                    {dragOver ? 'Drop image to upload' : 'Click or drop an image'}
                  </div>
                )}
                {previewUrl && (
                  <div className={styles.bannerModalDragHint}>Drag to reposition</div>
                )}
              </div>
            </div>

            <div className={styles.bannerPreviewBlock}>
              <div className={styles.bannerPreviewLabel}>
                Mobile view
                <span className={styles.bannerPreviewRatio}>~1.6:1</span>
              </div>
              <div
                className={`${styles.bannerModalPreview} ${styles.bannerModalPreviewMobile} ${
                  !previewUrl ? styles.bannerModalPreviewEmpty : ''
                }`}
                style={
                  previewUrl
                    ? {
                        backgroundImage: `url(${previewUrl})`,
                        backgroundPosition: `50% ${posYMobile}%`,
                        cursor: 'grab',
                      }
                    : undefined
                }
                onClick={!previewUrl ? () => fileRef.current?.click() : undefined}
                onPointerDown={previewUrl ? makePointerDown(dragMobileRef, posYMobile) : undefined}
                onPointerMove={previewUrl ? makePointerMove(dragMobileRef, setPosYMobile) : undefined}
                onPointerUp={previewUrl ? makePointerUp(dragMobileRef) : undefined}
                onPointerCancel={previewUrl ? makePointerUp(dragMobileRef) : undefined}
              >
                {!previewUrl && (
                  <div className={styles.bannerModalEmpty}>
                    {dragOver ? 'Drop image to upload' : 'Click or drop an image'}
                  </div>
                )}
                {previewUrl && (
                  <div className={styles.bannerModalDragHint}>Drag to reposition</div>
                )}
              </div>
            </div>
          </div>

          <div className={styles.bannerModalHint}>
            Drag &amp; drop an image onto the previews, or use the button below
            (recommended <strong>1600 × 400px</strong>, max 5 MB). Once set, drag
            each preview vertically to set the crop for desktop and mobile
            independently.
          </div>
          <div className={styles.bannerModalNote}>
            Note: if dragging doesn&apos;t move the image, the entire image is
            already fitting within the frame &mdash; no repositioning needed.
          </div>

          {error && <div className={styles.bannerModalError}>{error}</div>}

          <div className={styles.bannerModalActions}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className={styles.bannerModalBtn}
            >
              {previewUrl ? 'Choose new image' : 'Upload image'}
            </button>
            {initialUrl && (
              <button
                type="button"
                onClick={removeBanner}
                disabled={busy}
                className={`${styles.bannerModalBtn} ${styles.bannerModalBtnDanger}`}
              >
                Remove banner
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className={styles.bannerModalBtn}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !previewUrl}
              className={`${styles.bannerModalBtn} ${styles.bannerModalBtnPrimary}`}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onFilePick}
          />
        </div>
      </div>
    </div>
  );
}

// ── EditTabsModal ──────────────────────────────────────────────
// Owner-only modal to toggle which tabs are visible to public visitors.
// Booking tab is not in here — it's controlled separately by booking
// settings. Persists to users.tab_visibility as a JSON object.
export function EditTabsModal({
  userId,
  initial,
  initialOrder,
  isMobileDJ,
  onClose,
}: {
  userId: string;
  initial: {
    about: boolean;
    mixes: boolean;
    images: boolean;
    video: boolean;
    testimonials: boolean;
    faq: boolean;
    staff: boolean;
    affiliates: boolean;
  };
  // The owner's current tab order (keys), from users.tab_order.
  initialOrder?: string[];
  isMobileDJ: boolean;
  onClose: () => void;
}) {
  type TabRowKey = keyof typeof initial;
  const [vis, setVis] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: TabRowKey) {
    setVis(v => ({ ...v, [key]: !v[key] }));
  }

  // The keys that appear as draggable rows here. Testimonials + FAQ are only
  // relevant for mobile DJs, so club DJs never see (or reorder) them.
  const META: Record<TabRowKey, { label: string; hint?: string }> = {
    about: { label: 'About' },
    mixes: { label: 'Mixes' },
    images: { label: 'Photos' },
    video: { label: 'Video' },
    testimonials: { label: 'Testimonials', hint: 'Off by default for new mobile DJs' },
    faq: { label: 'FAQ', hint: 'Off by default — turn on to answer common questions' },
    staff: { label: 'Staff', hint: 'Off by default — show your team members' },
    affiliates: { label: 'Affiliates', hint: 'Off by default — companies you recommend' },
  };
  const AVAILABLE: TabRowKey[] = isMobileDJ
    ? ['about', 'mixes', 'images', 'video', 'testimonials', 'faq', 'staff', 'affiliates']
    : ['about', 'mixes', 'images', 'video'];

  // Working order: start from the saved order (filtered to what's available),
  // then append any available key the saved order didn't include.
  const [order, setOrder] = useState<TabRowKey[]>(() => {
    const avail = new Set<TabRowKey>(AVAILABLE);
    const seen = new Set<TabRowKey>();
    const out: TabRowKey[] = [];
    for (const k of initialOrder || []) {
      if (avail.has(k as TabRowKey) && !seen.has(k as TabRowKey)) {
        out.push(k as TabRowKey); seen.add(k as TabRowKey);
      }
    }
    for (const k of AVAILABLE) if (!seen.has(k)) out.push(k);
    return out;
  });

  // ── Drag to reorder (pointer-based, so it works on mouse AND touch) ──────
  const listRef = useRef<HTMLDivElement | null>(null);
  const [dragKey, setDragKey] = useState<TabRowKey | null>(null);

  function reorder(list: TabRowKey[], fromKey: TabRowKey, toKey: TabRowKey): TabRowKey[] {
    const from = list.indexOf(fromKey);
    const to = list.indexOf(toKey);
    if (from < 0 || to < 0 || from === to) return list;
    const next = list.slice();
    next.splice(from, 1);
    next.splice(to, 0, fromKey);
    return next;
  }

  useEffect(() => {
    if (!dragKey) return;
    const activeKey = dragKey; // narrowed, stable for this drag
    function onMove(e: PointerEvent) {
      const container = listRef.current;
      if (!container) return;
      const rowEls = Array.from(container.querySelectorAll<HTMLElement>('[data-tab-key]'));
      let targetKey: TabRowKey | null = null;
      for (const el of rowEls) {
        const r = el.getBoundingClientRect();
        // Pick the row whose vertical midpoint the pointer has crossed.
        if (e.clientY < r.top + r.height / 2) { targetKey = el.dataset.tabKey as TabRowKey; break; }
        targetKey = el.dataset.tabKey as TabRowKey;
      }
      if (targetKey && targetKey !== activeKey) {
        const dest = targetKey;
        setOrder(prev => reorder(prev, activeKey, dest));
      }
    }
    function onUp() { setDragKey(null); }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragKey]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveProfile(userId, { tab_visibility: vis, tab_order: order });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      setBusy(false);
    }
  }

  return (
    <div className={styles.bannerModalBackdrop} onClick={onClose}>
      <div className={styles.bannerModal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className={styles.bannerModalHeader}>
          <h2 className={styles.bannerModalTitle}>Edit Tabs</h2>
          <button
            type="button"
            onClick={onClose}
            className={styles.bannerModalClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className={styles.bannerModalBody}>
          <div className={styles.bannerModalHint}>
            Toggle which tabs are visible, and drag the handle to reorder them.
            The <strong>Booking</strong> tab is controlled separately by your
            booking settings.
          </div>

          <div className={styles.tabsList} ref={listRef}>
            {order.map(key => {
              const meta = META[key];
              return (
                <div
                  key={key}
                  data-tab-key={key}
                  className={`${styles.tabsRow} ${dragKey === key ? styles.tabsRowDragging : ''}`}
                >
                  <button
                    type="button"
                    className={styles.tabsDragHandle}
                    aria-label={`Reorder ${meta.label}`}
                    onPointerDown={(e) => { e.preventDefault(); setDragKey(key); }}
                    style={{ touchAction: 'none' }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                      <path d="M9 8 12 5l3 3" />
                      <path d="M9 16 12 19l3-3" />
                      <path d="M8 9 5 12l3 3" />
                      <path d="M16 9 19 12l-3 3" />
                    </svg>
                  </button>
                  <div className={styles.tabsRowText}>
                    <div className={styles.tabsRowLabel}>{meta.label}</div>
                    {meta.hint && (
                      <div className={styles.tabsRowHint}>{meta.hint}</div>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={vis[key]}
                    onChange={() => toggle(key)}
                    className={styles.tabsCheckbox}
                    aria-label={`Show ${meta.label} tab`}
                  />
                </div>
              );
            })}
          </div>

          {error && <div className={styles.bannerModalError}>{error}</div>}

          <div className={styles.bannerModalActions}>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className={styles.bannerModalBtn}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className={`${styles.bannerModalBtn} ${styles.bannerModalBtnPrimary}`}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TestimonialAddForm ─────────────────────────────────────────
// Owner-only inline form to append a new testimonial. Lives at the
// bottom of the Testimonials tab pane. On submit, appends to the
// existing array and writes back to users.testimonials (JSON-stringified).
export function TestimonialAddForm({
  userId,
  existing,
}: {
  userId: string;
  existing: Testimonial[];
}) {
  const [open, setOpen] = useState(false);
  const [blurb, setBlurb] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setBlurb('');
    setName('');
    setDate('');
    setError(null);
  }

  async function save() {
    if (!blurb.trim() || !name.trim()) {
      setError('Quote and name are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next: Testimonial[] = [
        ...existing,
        { blurb: blurb.trim(), name: name.trim(), date: date.trim() || undefined },
      ];
      await saveProfile(userId, { testimonials: JSON.stringify(next) });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={styles.testimonialAddBtn}
      >
        + Add testimonial
      </button>
    );
  }

  return (
    <div className={styles.testimonialAddForm}>
      <div className={styles.testimonialAddFormRow}>
        <div style={{ flex: 1 }}>
          <div className={styles.testimonialAddFormLabel}>Name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sarah J."
            className={styles.testimonialAddInput}
            disabled={busy}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div className={styles.testimonialAddFormLabel}>Date (optional)</div>
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            placeholder="May 2024"
            className={styles.testimonialAddInput}
            disabled={busy}
          />
        </div>
      </div>
      <div className={styles.testimonialAddFormLabel}>Quote</div>
      <textarea
        value={blurb}
        onChange={(e) => setBlurb(e.target.value)}
        rows={3}
        placeholder="What they said about you…"
        className={styles.testimonialAddInput}
        disabled={busy}
      />
      {error && <div className={styles.testimonialAddError}>{error}</div>}
      <div className={styles.testimonialAddActions}>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={busy}
          className={styles.testimonialAddCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className={styles.testimonialAddSave}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ── AboutStatsRow ──────────────────────────────────────────────
// About-tab highlight cards (mobile DJs only). Each card must be activated
// by the owner to show to visitors. The owner sets each value (established
// year, events tier, insured, deposit %, and the yes/no facts).
export function AboutStatsRow({
  userId,
  isOwnProfile,
  stats,
}: {
  userId: string;
  isOwnProfile: boolean;
  stats: AboutStats;
  // travelDistance is still passed by the caller but no longer surfaced here.
  travelDistance?: string | null;
}) {
  const [draft, setDraft] = useState<AboutStats>(stats);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build the list of cards to show to visitors (activated + has a value).
  type Card = { key: string; label: string; value: string };
  const cards: Card[] = [];
  if (stats.established?.on && stats.established.year) cards.push({ key: 'established', label: 'Established', value: String(stats.established.year) });
  if (stats.events?.on && stats.events.tier) cards.push({ key: 'events', label: 'Total events', value: stats.events.tier });
  if (stats.insured?.on) cards.push({ key: 'insured', label: 'Insured', value: stats.insured.answer || 'Yes' });
  if (stats.depositRequired?.on) cards.push({ key: 'depositRequired', label: 'Deposit required', value: stats.depositRequired.answer || 'Yes' });
  if (stats.deposit?.on && stats.deposit.value) cards.push({ key: 'deposit', label: 'Deposit %', value: /%\s*$/.test(stats.deposit.value.trim()) ? stats.deposit.value.trim() : `${stats.deposit.value.trim().replace(/[^0-9.]/g, '')}%` });
  if (stats.destination?.on) cards.push({ key: 'destination', label: 'Destination weddings', value: stats.destination.answer || 'Yes' });
  if (stats.backup?.on) cards.push({ key: 'backup', label: 'Backup equipment', value: stats.backup.answer || 'Yes' });

  async function save() {
    // Any fact that's turned on must have an answer before saving.
    const missing = STAT_FIELDS.filter(f => {
      if (!draft[f.key]?.on) return false;
      if (f.control === 'year') return !draft.established?.year;
      if (f.control === 'tier') return !draft.events?.tier;
      if (f.control === 'pct') return !draft.deposit?.value;
      return !(draft[f.key] as { answer?: string } | undefined)?.answer;
    });
    if (missing.length) {
      setError(`Please answer (or turn off): ${missing.map(f => f.label).join(', ')}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveProfile(userId, { about_stats: JSON.stringify(draft) });
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'about');
      window.location.href = url.toString();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      setBusy(false);
    }
  }

  function toggle(key: keyof AboutStats) {
    setDraft(d => ({ ...d, [key]: { ...(d[key] || {}), on: !(d[key]?.on) } }));
  }

  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = currentYear; y >= 1970; y--) years.push(y);
  const eventTiers = ['50+', '100+', '200+', '500+', '1000+'];
  const depositPcts = Array.from({ length: 99 }, (_, i) => `${i + 1}%`);

  // The editable facts, in display order. Labels match the public cards so the
  // owner sees exactly what a visitor sees as they fill each one in.
  const STAT_FIELDS: { key: keyof AboutStats; label: string; control: 'year' | 'tier' | 'pct' | 'yesno' }[] = [
    { key: 'established', label: 'Established', control: 'year' },
    { key: 'events', label: 'Total events', control: 'tier' },
    { key: 'insured', label: 'Insured', control: 'yesno' },
    { key: 'depositRequired', label: 'Deposit required', control: 'yesno' },
    { key: 'deposit', label: 'Deposit %', control: 'pct' },
    { key: 'destination', label: 'Destination weddings', control: 'yesno' },
    { key: 'backup', label: 'Backup equipment', control: 'yesno' },
  ];

  function setAnswer(key: keyof AboutStats, v: string) {
    setDraft(d => ({ ...d, [key]: { ...(d[key] || {}), answer: (v || undefined) as 'Yes' | 'No' | undefined } }));
  }

  // Renders the inline editor control that sits in place of a card's value, so
  // the owner edits the exact public box. `big` styles it like the teal value.
  function renderStatControl(key: keyof AboutStats, control: 'year' | 'tier' | 'pct' | 'yesno', big?: boolean) {
    const cls = big ? styles.aboutStatValueSelect : styles.aboutStatsSelect;
    if (control === 'year') {
      return (
        <select
          className={cls}
          value={draft.established?.year ?? ''}
          onChange={(e) => setDraft(d => ({ ...d, established: { ...(d.established || {}), year: e.target.value ? parseInt(e.target.value, 10) : undefined } }))}
        >
          <option value="">Year…</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      );
    }
    if (control === 'tier') {
      return (
        <select
          className={cls}
          value={draft.events?.tier ?? ''}
          onChange={(e) => setDraft(d => ({ ...d, events: { ...(d.events || {}), tier: e.target.value || undefined } }))}
        >
          <option value="">Amount…</option>
          {eventTiers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      );
    }
    if (control === 'pct') {
      return (
        <select
          className={cls}
          value={draft.deposit?.value ?? ''}
          onChange={(e) => setDraft(d => ({ ...d, deposit: { ...(d.deposit || {}), value: e.target.value || undefined } }))}
        >
          <option value="">Percent…</option>
          {depositPcts.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      );
    }
    return (
      <select
        className={cls}
        value={(draft[key] as { answer?: string } | undefined)?.answer ?? ''}
        onChange={(e) => setAnswer(key, e.target.value)}
      >
        <option value="">Yes / No…</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    );
  }

  // ── Owner view: the exact public boxes, made editable (list on mobile) ──
  if (isOwnProfile) {
    return (
      <div className={styles.aboutStatsWrap}>
        <div className={styles.aboutStatsHeading}>
          Quick Facts
          <span className={styles.aboutStatsHint}>Only checked facts show on your profile</span>
        </div>
        <div className={styles.aboutStatsEditCol}>
          <div className={styles.aboutStatsGrid}>
            {STAT_FIELDS.map(f => {
              const on = !!draft[f.key]?.on;
              return (
                <div key={f.key} className={`${styles.aboutStatCard} ${styles.aboutStatCardEdit} ${on ? '' : styles.aboutStatCardOff}`}>
                  <input
                    type="checkbox"
                    className={styles.aboutStatShowCheck}
                    checked={on}
                    onChange={() => toggle(f.key)}
                    title={on ? 'Showing to visitors — uncheck to hide' : 'Hidden — check to show'}
                  />
                  <div className={styles.aboutStatValue}>{renderStatControl(f.key, f.control, true)}</div>
                  <div className={styles.aboutStatLabel}>{f.label}?</div>
                </div>
              );
            })}
          </div>
          {error && <div className={styles.testimonialAddError}>{error}</div>}
          <div className={styles.aboutStatsActions}>
            <button type="button" className={styles.testimonialAddSave} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Visitor view: the activated facts as boxes (list on mobile) ──
  if (cards.length === 0) return null;
  return (
    <div className={styles.aboutStatsWrap}>
      <div className={styles.aboutStatsHeading}>Quick Facts</div>
      <div className={styles.aboutStatsGrid}>
        {cards.map(c => (
          <div key={c.key} className={styles.aboutStatCard}>
            <div className={styles.aboutStatValue}>{c.value}</div>
            <div className={styles.aboutStatLabel}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FaqAccordion ───────────────────────────────────────────────
// Read-only (visitor) + owner view of the FAQ list, rendered as an
// accordion. The first question is open by default; tapping any question
// toggles its answer. Owner sees a delete ✕ on each card. Question sits
// in a dark-grey banner; the answer opens into a light-grey panel.
export function FaqAccordion({
  faqs,
  userId,
  isOwnProfile,
}: {
  faqs: Faq[];
  userId: string;
  isOwnProfile: boolean;
}) {
  // Multiple can be open at once. First item open by default; toggling one
  // never closes the others.
  const [openSet, setOpenSet] = useState<Set<number>>(() => new Set([0]));
  function toggle(i: number) {
    setOpenSet(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // Styled delete confirm (replaces the native window.confirm). Holds the
  // index pending deletion, or null when no dialog is open.
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (pendingDelete == null) return;
    setDeleting(true);
    try {
      const next = faqs.filter((_, idx) => idx !== pendingDelete);
      await saveProfile(userId, { faqs: JSON.stringify(next) });
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'faq');
      window.location.href = url.toString();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed.');
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  return (
    <>
      {faqs.map((f, i) => {
        const open = openSet.has(i);
        return (
          <div key={i} className={styles.faqItem}>
            {isOwnProfile && (
              <button
                type="button"
                onClick={() => setPendingDelete(i)}
                className={styles.faqDeleteBtn}
                title="Delete FAQ"
                aria-label="Delete FAQ"
              >
                ✕
              </button>
            )}
            <button
              type="button"
              className={styles.faqQuestion}
              onClick={() => toggle(i)}
              aria-expanded={open}
            >
              <span className={styles.faqQuestionText}>{f.question || ''}</span>
              <span className={styles.faqChevron} aria-hidden="true">
                {open ? '−' : '+'}
              </span>
            </button>
            {open && (
              <div className={styles.faqAnswer}>{f.answer || ''}</div>
            )}
          </div>
        );
      })}

      {pendingDelete != null && (
        <div
          className={styles.faqConfirmBackdrop}
          onClick={() => !deleting && setPendingDelete(null)}
        >
          <div
            className={styles.faqConfirmModal}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.faqConfirmTitle}>Delete this FAQ?</div>
            <div className={styles.faqConfirmText}>
              This question and answer will be permanently removed from your
              profile.
            </div>
            <div className={styles.faqConfirmActions}>
              <button
                type="button"
                className={styles.faqConfirmCancel}
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.faqConfirmDelete}
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── FaqAddForm ─────────────────────────────────────────────────
// Owner-only inline form to append a new FAQ (question + answer). Lives at
// the bottom of the FAQ tab pane. Shows suggested questions the owner can
// tap to prefill the question field. On submit, appends to the existing
// array and writes back to users.faqs (JSON-stringified). Capped at 10 by
// the caller (the form is only rendered while there's room).
const FAQ_SUGGESTIONS = [
  'Do you provide your own equipment?',
  'How far are you willing to travel?',
  'What genres of music do you play?',
  'Do you take song requests?',
  "What's your deposit and cancellation policy?",
  'Do you offer MC / hosting services?',
  'How far in advance should I book?',
  'Do you have lighting?',
  'Are you insured?',
  'What happens if you get sick or have an emergency?',
];

export function FaqAddForm({
  userId,
  existing,
}: {
  userId: string;
  existing: Faq[];
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setQuestion('');
    setAnswer('');
    setError(null);
  }

  async function save() {
    if (!question.trim() || !answer.trim()) {
      setError('Question and answer are both required.');
      return;
    }
    if (existing.length >= 10) {
      setError('You can add up to 10 FAQs.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next: Faq[] = [
        ...existing,
        { question: question.trim(), answer: answer.trim() },
      ];
      await saveProfile(userId, { faqs: JSON.stringify(next) });
      // Reload with ?tab=faq so the user lands back on the FAQ tab
      // instead of jumping to the default (booking/about).
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'faq');
      window.location.href = url.toString();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={styles.testimonialAddBtn}
      >
        + Add FAQ
      </button>
    );
  }

  // Questions the owner hasn't already used, so suggestions stay useful.
  const usedQuestions = new Set(
    existing.map((f) => (f.question || '').trim().toLowerCase()),
  );
  const suggestions = FAQ_SUGGESTIONS.filter(
    (q) => !usedQuestions.has(q.toLowerCase()),
  );

  return (
    <div className={styles.testimonialAddForm}>
      <div className={styles.testimonialAddFormLabel}>Question</div>
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="e.g. Do you provide your own equipment?"
        className={styles.testimonialAddInput}
        disabled={busy}
      />
      {suggestions.length > 0 && (
        <div className={styles.faqSuggestWrap}>
          <div className={styles.faqSuggestLabel}>Need ideas? Tap one:</div>
          <div className={styles.faqSuggestList}>
            {suggestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setQuestion(q)}
                className={styles.faqSuggestChip}
                disabled={busy}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={styles.testimonialAddFormLabel}>Answer</div>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={3}
        placeholder="Your answer…"
        className={styles.testimonialAddInput}
        disabled={busy}
      />
      {error && <div className={styles.testimonialAddError}>{error}</div>}
      <div className={styles.testimonialAddActions}>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={busy}
          className={styles.testimonialAddCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className={styles.testimonialAddSave}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Staff + Affiliates (mobile DJs only)
//
// Two profile tabs backed by jsonb arrays on public.users (staff / affiliates),
// parsed with parseStaff() / parseAffiliates() from lib/staff.ts.
//
//   Staff       — image (optional) + name + job position, stacked photo→name→pos.
//   Affiliates  — image (optional) + name + company type + optional description.
//
// The *Grid components render the read-only display shown to visitors, plus a
// delete control for the owner. The *Editor components are the owner's "+ Add"
// form. Images are optional everywhere — the grid shows initials when absent.
// ──────────────────────────────────────────────────────────────────────────

// Shared: upload one optional entry image to the avatars bucket and return its
// public URL, or null if no file was chosen. Throws on a validation/upload
// failure so the caller can surface the message.
async function uploadEntryImage(
  userId: string,
  file: File | null,
  prefix: 'staff' | 'affiliate',
): Promise<string | null> {
  if (!file) return null;
  const valErr = await validateImageFile(file);
  if (valErr) throw new Error(valErr);
  const supabase = createClient();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const id = rand.replace(/[^a-z0-9]/gi, '');
  const path = `${profileUploadFolder(userId)}/${prefix}_${id}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) throw new Error(upErr.message);
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

// A round/tile image with an initials fallback when no photo is set.
function EntryImage({ src, name, size, square }: { src?: string | null; name: string; size: number; square?: boolean }) {
  const radius = square ? 12 : '50%';
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumbUrl(src, 400)}
        alt={name}
        style={{ width: size, height: size, objectFit: 'cover', borderRadius: radius, border: '1px solid rgba(255,255,255,.12)' }}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      style={{
        width: size, height: size, borderRadius: radius,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)',
        color: 'var(--neon,#00e0a4)', fontFamily: "'Bebas Neue', sans-serif",
        fontSize: size * 0.4, letterSpacing: '.03em',
      }}
    >
      {initialsOf(name)}
    </div>
  );
}

export function StaffSection({ userId, staff, isOwnProfile, onPhotoClick }: { userId: string; staff: StaffMember[]; isOwnProfile: boolean; onPhotoClick?: (src: string) => void }) {
  const { confirm, confirmDialog } = useConfirm();
  // mode: null (viewing), 'new' (adding), or an entry id (editing that one).
  const [mode, setMode] = useState<null | 'new' | string>(null);
  const [entryId, setEntryId] = useState('');
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function openNew() {
    if (staff.length >= STAFF_MAX) { setError(`You can add up to ${STAFF_MAX} team members.`); return; }
    setEntryId(newEntryId()); setName(''); setPosition(''); setPhoto(null); setError(null); setMode('new');
  }
  function openEdit(s: StaffMember) {
    setEntryId(s.id); setName(s.name); setPosition(s.position); setPhoto(s.photo || null); setError(null); setMode(s.id);
  }
  function close() { setMode(null); setCropFile(null); setError(null); }

  async function persist(next: StaffMember[]) {
    await saveProfile(userId, { staff: next });
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'staff');
    window.location.href = url.toString();
  }

  async function remove(s: StaffMember) {
    const ok = await confirm({
      title: 'Remove this team member?',
      message: `${s.name || 'This person'} will be removed from your Staff tab. You can add them back any time.`,
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try { await persist(staff.filter((x) => x.id !== s.id)); }
    catch (err) { setBusy(false); setError(err instanceof Error ? err.message : 'Could not remove.'); }
  }

  async function save() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError(null);
    try {
      const entry: StaffMember = { id: entryId, name: name.trim(), position: position.trim(), photo };
      const next = mode === 'new'
        ? [...staff, entry]
        : staff.map((s) => (s.id === entryId ? entry : s));
      await persist(next);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  }

  return (
    <>
      {staff.length > 0 && (
        <div className={styles.staffGrid}>
          {staff.map((s) => (
            <div key={s.id} className={styles.staffCard}>
              {s.photo && onPhotoClick ? (
                <button type="button" onClick={() => onPhotoClick(s.photo!)} className={styles.staffPhotoBtn} aria-label={`View ${s.name}'s photo`}>
                  <EntryImage src={s.photo} name={s.name} size={121} />
                </button>
              ) : (
                <EntryImage src={s.photo} name={s.name} size={121} />
              )}
              <div className={styles.staffName}>{s.name}</div>
              {s.position && <div className={styles.staffPosition}>{s.position}</div>}
              {isOwnProfile && (
                <div className={styles.entryCardActions}>
                  <button type="button" onClick={() => openEdit(s)} className={styles.entryEditBtn} title="Edit" aria-label="Edit team member">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  </button>
                  <button type="button" onClick={() => remove(s)} className={styles.entryDeleteBtn} title="Remove" aria-label="Remove team member">✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isOwnProfile && mode && (
        <div className={styles.testimonialAddForm}>
          <div className={styles.entryFormRow}>
            <div className={styles.entryPhotoCol}>
              <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className={styles.entryPhotoPick} aria-label="Add photo (optional)">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                ) : (
                  <span>Photo<br /><small>optional</small></span>
                )}
              </button>
              {photo && <button type="button" onClick={() => setPhoto(null)} disabled={busy} className={styles.entryPhotoClear}>Remove photo</button>}
            </div>
            <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0] || null; if (f) setCropFile(f); e.currentTarget.value = ''; }} />
            <div style={{ flex: 1 }}>
              <div className={styles.testimonialAddFormLabel}>Name</div>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jordan Reyes" className={styles.testimonialAddInput} disabled={busy} />
              <div className={styles.testimonialAddFormLabel}>Job position</div>
              <input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. MC / Host" className={styles.testimonialAddInput} disabled={busy} />
            </div>
          </div>
          {error && <div className={styles.testimonialAddError}>{error}</div>}
          <div className={styles.testimonialAddActions}>
            <button type="button" onClick={close} disabled={busy} className={styles.testimonialAddCancel}>Cancel</button>
            <button type="button" onClick={save} disabled={busy} className={styles.testimonialAddSave}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {isOwnProfile && !mode && staff.length < STAFF_MAX && (
        <button type="button" onClick={openNew} className={styles.testimonialAddBtn}>+ Add team member</button>
      )}
      {error && !mode && <div className={styles.testimonialAddError} style={{ marginTop: '.5rem' }}>{error}</div>}

      {confirmDialog}
      <AvatarCrop
        file={cropFile}
        userId={userId}
        uploadFolder={profileUploadFolder(userId)}
        storagePath={`${profileUploadFolder(userId)}/staff_${entryId}.png`}
        title="Position Photo"
        fitMode="contain"
        hint="The whole photo shows by default — drag to move, slide to zoom in."
        onClose={() => setCropFile(null)}
        onSuccess={(u) => { setPhoto(u); setCropFile(null); }}
      />
    </>
  );
}

export function AffiliatesSection({ userId, affiliates, isOwnProfile }: { userId: string; affiliates: Affiliate[]; isOwnProfile: boolean }) {
  const { confirm, confirmDialog } = useConfirm();
  const [mode, setMode] = useState<null | 'new' | string>(null);
  const [entryId, setEntryId] = useState('');
  const [name, setName] = useState('');
  const [companyType, setCompanyType] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    setFile(f);
    setPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return f ? URL.createObjectURL(f) : null; });
  }
  function openNew() {
    if (affiliates.length >= AFFILIATES_MAX) { setError(`You can add up to ${AFFILIATES_MAX} affiliates.`); return; }
    setEntryId(newEntryId()); setName(''); setCompanyType(''); setDescription(''); setWebsite(''); setImage(null); setBgColor(null); pick(null); setError(null); setMode('new');
  }
  function openEdit(a: Affiliate) {
    setEntryId(a.id); setName(a.name); setCompanyType(a.companyType); setDescription(a.description || ''); setWebsite(a.url || ''); setImage(a.image || null); setBgColor(a.bgColor || null); pick(null); setError(null); setMode(a.id);
  }
  function close() { setMode(null); pick(null); setError(null); }

  async function persist(next: Affiliate[]) {
    await saveProfile(userId, { affiliates: next });
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'affiliates');
    window.location.href = url.toString();
  }

  async function remove(a: Affiliate) {
    const ok = await confirm({
      title: 'Remove this affiliate?',
      message: `${a.name || 'This company'} will be removed from your Affiliates tab. You can add it back any time.`,
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try { await persist(affiliates.filter((x) => x.id !== a.id)); }
    catch (err) { setBusy(false); setError(err instanceof Error ? err.message : 'Could not remove.'); }
  }

  async function save() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError(null);
    try {
      const uploaded = file ? await uploadEntryImage(userId, file, 'affiliate') : image;
      const entry: Affiliate = { id: entryId, name: name.trim(), companyType: companyType.trim(), description: description.trim(), image: uploaded, url: normalizeUrl(website), bgColor: safeHexColor(bgColor) };
      const next = mode === 'new'
        ? [...affiliates, entry]
        : affiliates.map((a) => (a.id === entryId ? entry : a));
      await persist(next);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  }

  const shownPreview = preview || image;

  // The editor lives INSIDE a card shell (same box as the display card) so a DJ
  // edits the affiliate right where it shows — no separate form below.
  const editorCard = (
    <div className={`${styles.affiliateCard} ${styles.affiliateCardEditing}`}>
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className={styles.affiliateImgTop} style={{ cursor: 'pointer', padding: 0, marginBottom: '.85rem' }} aria-label="Add image (optional)">
        {shownPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shownPreview} alt="" />
        ) : (
          <span className={styles.affiliateImgFallback} style={{ fontFamily: "'Space Mono', monospace", fontSize: '.8rem', textTransform: 'uppercase', color: 'var(--muted,#8a8aa0)' }}>Image<br /><small style={{ fontSize: '.65rem' }}>optional</small></span>
        )}
      </button>
      {shownPreview && <button type="button" onClick={() => { pick(null); setImage(null); }} disabled={busy} className={styles.entryPhotoClear} style={{ marginBottom: '.6rem' }}>Remove image</button>}
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0] || null)} />

      <div className={styles.testimonialAddFormLabel}>Company name</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bloom & Co" className={styles.testimonialAddInput} disabled={busy} />
      <div className={styles.testimonialAddFormLabel}>Type of company</div>
      <input value={companyType} onChange={(e) => setCompanyType(e.target.value)} placeholder="e.g. Florist" className={styles.testimonialAddInput} disabled={busy} />
      <div className={styles.testimonialAddFormLabel}>Website <span style={{ opacity: .6 }}>(optional)</span></div>
      <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="e.g. bloomandco.com" className={styles.testimonialAddInput} disabled={busy} />
      <div className={styles.testimonialAddFormLabel}>Description <span style={{ opacity: .6 }}>(optional)</span></div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="A short note on why you recommend them…" className={styles.testimonialAddInput} disabled={busy} />

      <div className={styles.testimonialAddFormLabel}>Card background <span style={{ opacity: .6 }}>(optional)</span></div>
      <div className={styles.affiliateColorRow}>
        {/* Wheel stays a rainbow so it's always visible; the chosen color shows
            in the swatch + hex next to it. */}
        <label
          className={styles.affiliateColorWheel}
          title="Pick a color"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="color"
            value={safeHexColor(bgColor) || '#141414'}
            onChange={(e) => setBgColor(e.target.value)}
            onInput={(e) => setBgColor((e.target as HTMLInputElement).value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={busy}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
          />
        </label>
        {bgColor && <span className={styles.affiliateColorChip} style={{ background: bgColor }} aria-hidden="true" />}
        <span className={styles.affiliateColorLabel}>{bgColor ? bgColor.toUpperCase() : 'Default (black)'}</span>
        {bgColor && (
          <button type="button" className={styles.affiliateColorReset} onClick={() => setBgColor(null)} disabled={busy}>Reset</button>
        )}
      </div>

      {error && <div className={styles.testimonialAddError}>{error}</div>}
      <div className={styles.testimonialAddActions}>
        <button type="button" onClick={close} disabled={busy} className={styles.testimonialAddCancel}>Cancel</button>
        <button type="button" onClick={save} disabled={busy} className={styles.testimonialAddSave}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );

  return (
    <>
      {(affiliates.length > 0 || mode === 'new') && (
        <div className={styles.affiliateList}>
          {affiliates.map((a) => {
            // Editing THIS one → the card becomes its editor in place.
            if (mode === a.id) return <div key={a.id} className={styles.affiliateEditCell}>{editorCard}</div>;

            // Contrast: on a light custom bg, switch text + action buttons to dark
            // so they don't blend in (and vice-versa on dark).
            const light = isLightHex(a.bgColor);
            const nameColor = a.bgColor ? (light ? '#141414' : '#fff') : undefined;
            const typeColor = a.bgColor ? (light ? '#0a7f63' : undefined) : undefined;
            const descColor = a.bgColor ? (light ? 'rgba(0,0,0,.62)' : 'rgba(255,255,255,.72)') : undefined;
            const actionBtnStyle: React.CSSProperties | undefined = a.bgColor
              ? { background: light ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.14)', color: light ? '#141414' : '#fff' }
              : undefined;
            return (
            <div key={a.id} className={styles.affiliateCard} style={a.bgColor ? { background: a.bgColor } : undefined}>
              <div className={styles.affiliateMain}>
                {a.image ? (
                  a.url ? (
                    <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className={styles.affiliateImgTop} aria-label={`${a.name} website`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbUrl(a.image, 700)} alt={a.name} />
                    </a>
                  ) : (
                    <div className={styles.affiliateImgTop}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbUrl(a.image, 700)} alt={a.name} />
                    </div>
                  )
                ) : (
                  <div className={styles.affiliateImgTop}>
                    <span className={styles.affiliateImgFallback}>{initialsOf(a.name)}</span>
                  </div>
                )}
                <div className={styles.affiliateBody}>
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className={styles.affiliateNameLink} style={nameColor ? { color: nameColor } : undefined}>
                      {a.name}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 6, verticalAlign: 'middle', opacity: .8 }}><path d="M7 17 17 7M8 7h9v9"/></svg>
                    </a>
                  ) : (
                    <div className={styles.affiliateName} style={nameColor ? { color: nameColor } : undefined}>{a.name}</div>
                  )}
                  {a.companyType && <div className={styles.affiliateType} style={typeColor ? { color: typeColor } : undefined}>{a.companyType}</div>}
                  {a.description && <div className={styles.affiliateDesc} style={descColor ? { color: descColor } : undefined}>{a.description}</div>}
                </div>
              </div>
              {isOwnProfile && (
                <div className={styles.entryCardActions}>
                  <button type="button" onClick={() => openEdit(a)} className={styles.entryEditBtn} title="Edit" aria-label="Edit affiliate" style={actionBtnStyle}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  </button>
                  <button type="button" onClick={() => remove(a)} className={styles.entryDeleteBtn} title="Remove" aria-label="Remove affiliate" style={actionBtnStyle}>✕</button>
                </div>
              )}
            </div>
            );
          })}
          {/* Adding a new one → an editor card at the end of the grid. */}
          {mode === 'new' && <div className={styles.affiliateEditCell}>{editorCard}</div>}
        </div>
      )}

      {isOwnProfile && !mode && affiliates.length < AFFILIATES_MAX && (
        <button type="button" onClick={openNew} className={styles.testimonialAddBtn}>+ Add affiliate</button>
      )}
      {error && !mode && <div className={styles.testimonialAddError} style={{ marginTop: '.5rem' }}>{error}</div>}

      {confirmDialog}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// ShareCalendarModal — visible to all visitors. Two preview cards: month
// view and 12-month view, each with a small visual mockup + the share URL
// with a Copy button. The link includes a ?view= query param so the
// recipient lands directly on that view.
// ──────────────────────────────────────────────────────────────────────────
export function ShareCalendarModal({
  djSlug,
  onClose,
}: {
  djSlug: string;
  onClose: () => void;
}) {
  const baseUrl = (typeof window !== 'undefined' ? window.location.origin : '') +
    '/' + djSlug;
  const monthUrl = baseUrl + '?view=month';
  const twelveUrl = baseUrl + '?view=12mo';

  // Render only the host (no protocol) for compactness.
  const monthShort = monthUrl.replace(/^https?:\/\//, '');
  const twelveShort = twelveUrl.replace(/^https?:\/\//, '');

  const [copied, setCopied] = useState<'month' | '12mo' | null>(null);
  async function copy(view: 'month' | '12mo') {
    const url = view === 'month' ? monthUrl : twelveUrl;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(view);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(view); setTimeout(() => setCopied(null), 1800); }
      finally { document.body.removeChild(ta); }
    }
  }

  return (
    <div className={styles.shareModalBackdrop} onClick={onClose}>
      <div className={styles.shareModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.shareModalHeader}>
          <h2 className={styles.shareModalTitle}>Share Calendar</h2>
          <button
            type="button"
            onClick={onClose}
            className={styles.shareModalClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className={styles.shareCardsGrid}>
          {/* Month View card */}
          <div className={styles.shareCard}>
            <div className={styles.shareCardLabel}>Month View</div>
            <div className={styles.sharePreviewSingle}>
              <div className={styles.sharePreviewSingleHead}>May 2026</div>
              <div className={styles.sharePreviewDays}>
                <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
              </div>
              <div className={styles.sharePreviewGrid}>
                <div className={styles.sharePreviewCellEmpty} /><div className={styles.sharePreviewCellEmpty} /><div className={styles.sharePreviewCellEmpty} /><div className={styles.sharePreviewCellEmpty} /><div className={styles.sharePreviewCellEmpty} />
                <div className={styles.sharePreviewCell}>1</div><div className={styles.sharePreviewCell}>2</div>
                <div className={styles.sharePreviewCell}>3</div><div className={styles.sharePreviewCell}>4</div><div className={styles.sharePreviewCell}>5</div><div className={styles.sharePreviewCell}>6</div><div className={styles.sharePreviewCell}>7</div><div className={styles.sharePreviewCell}>8</div><div className={styles.sharePreviewCell}>9</div>
                <div className={styles.sharePreviewCell}>10</div><div className={styles.sharePreviewCell}>11</div><div className={styles.sharePreviewCell}>12</div><div className={styles.sharePreviewCellUnav}>13</div><div className={styles.sharePreviewCellUnav}>14</div><div className={styles.sharePreviewCellBooked}>15</div><div className={styles.sharePreviewCell}>16</div>
                <div className={styles.sharePreviewCell}>17</div><div className={styles.sharePreviewCell}>18</div><div className={styles.sharePreviewCell}>19</div><div className={styles.sharePreviewCell}>20</div><div className={styles.sharePreviewCell}>21</div><div className={styles.sharePreviewCell}>22</div><div className={styles.sharePreviewCell}>23</div>
                <div className={styles.sharePreviewCell}>24</div><div className={styles.sharePreviewCell}>25</div><div className={styles.sharePreviewCell}>26</div><div className={styles.sharePreviewCell}>27</div><div className={styles.sharePreviewCell}>28</div><div className={styles.sharePreviewCell}>29</div><div className={styles.sharePreviewCell}>30</div>
                <div className={styles.sharePreviewCell}>31</div>
              </div>
            </div>
            <div className={styles.shareLinkRow}>
              <div className={styles.shareLinkUrl}>{monthShort}</div>
              <button type="button" onClick={() => copy('month')} className={styles.shareLinkCopy}>
                {copied === 'month' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* 12-Month View card */}
          <div className={styles.shareCard}>
            <div className={styles.shareCardLabel}>12-Month View</div>
            <div className={styles.sharePreviewTwelve}>
              {['MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC','JAN','FEB','MAR','APR'].map((m, idx) => (
                <div key={m} className={styles.sharePreviewMini}>
                  <div className={styles.sharePreviewMiniLabel}>{m}</div>
                  <div className={styles.sharePreviewMiniGrid}>
                    {Array.from({ length: 28 }, (_, i) => {
                      const seed = (idx * 7 + i) % 13;
                      const cls = seed === 3
                        ? styles.sharePreviewMiniCellBooked
                        : (seed === 7 || seed === 11)
                          ? styles.sharePreviewMiniCellUnav
                          : styles.sharePreviewMiniCell;
                      return <div key={i} className={cls} />;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.shareLinkRow}>
              <div className={styles.shareLinkUrl}>{twelveShort}</div>
              <button type="button" onClick={() => copy('12mo')} className={styles.shareLinkCopy}>
                {copied === '12mo' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────────────
// UnderBannerSocials — horizontal strip of social icons rendered snug
// against the bottom of the banner, centered. For owners, also shows
// "+ add" buttons for missing socials so they can add inline.
// ──────────────────────────────────────────────────────────────────────────
export function UnderBannerSocials({ data, effectiveSlug, isOwnProfile, bookingEnabled, onShareClick, isLoggedIn = false, onMessageClick }: { data: DjProfileData; effectiveSlug: string; isOwnProfile: boolean; bookingEnabled: boolean; onShareClick: () => void; isLoggedIn?: boolean; onMessageClick?: () => void }) {
  // Lifted: only one SocialAddButton can be expanded at a time.
  const [openSocialField, setOpenSocialField] = useState<string | null>(null);
  // Copy-link feedback state — the "Copy link" item in the share menu
  // confirms with a brief "Copied" flip.
  const [copied, setCopied] = useState(false);
  // Share menu: a small popover of share targets (copy, email, Facebook,
  // X, WhatsApp, SMS) anchored to the Share button.
  const [shareOpen, setShareOpen] = useState(false);
  const shareWrapRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!shareOpen) return;
    function onDoc(e: MouseEvent) {
      if (shareWrapRef.current && !shareWrapRef.current.contains(e.target as Node)) setShareOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setShareOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [shareOpen]);
  function profileUrl(): string { return `${window.location.origin}/${effectiveSlug}`; }
  const shareTitle = `${data.name || 'DJ'} on Global DJ Connect`;

  function copyProfileLink() {
    const url = `${window.location.origin}/${effectiveSlug}`;
    const markCopied = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(markCopied, () => legacyCopy(url, markCopied));
    } else {
      legacyCopy(url, markCopied);
    }
  }
  function legacyCopy(text: string, onDone: () => void) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      onDone();
    } catch {
      /* copy failed — nothing more we can do */
    }
  }
  // The Share button opens our in-page share-options menu (copy / email /
  // socials) on every device — one consistent behavior, no native sheet.
  function handleShare() {
    setShareOpen((v) => !v);
  }
  const shareMenu: { key: string; label: string; href?: string; onClick?: () => void }[] = [
    { key: 'copy', label: copied ? 'Copied!' : 'Copy link', onClick: copyProfileLink },
    { key: 'email', label: 'Email' },
    { key: 'facebook', label: 'Facebook' },
    { key: 'x', label: 'X (Twitter)' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'sms', label: 'Text message' },
  ];
  function shareHref(key: string): string {
    const url = profileUrl();
    const eu = encodeURIComponent(url);
    const et = encodeURIComponent(shareTitle);
    switch (key) {
      case 'email': return `mailto:?subject=${et}&body=${et}%0A%0A${eu}`;
      case 'facebook': return `https://www.facebook.com/sharer/sharer.php?u=${eu}`;
      case 'x': return `https://twitter.com/intent/tweet?url=${eu}&text=${et}`;
      case 'whatsapp': return `https://wa.me/?text=${et}%20${eu}`;
      case 'sms': return `sms:?&body=${et}%20${eu}`;
      default: return url;
    }
  }
  // Legacy prop kept for compatibility; the calendar-share modal is no
  // longer opened from this button.
  void onShareClick;

  function n(s: string, prefix: string): string {
    return s.startsWith('http') ? s : prefix + s.replace('@', '');
  }
  type SocialField = 'website' | 'soundcloud' | 'instagram' | 'tiktok' | 'facebook' | 'twitch';
  const links: { key: string; field: SocialField; raw: string; href: string; title: string; placeholder: string; cls: string; addCls: string; icon: React.ReactNode }[] = [];
  const websiteIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
  if (data.website) links.push({ key: 'web', field: 'website', raw: data.website, href: n(data.website, 'https://'), title: 'Website', placeholder: 'https://yoursite.com', cls: styles.underBannerSocialWebsite, addCls: styles.actionBtnWebsite, icon: websiteIcon });
  if (data.soundcloud) links.push({ key: 'sc', field: 'soundcloud', raw: data.soundcloud, href: n(data.soundcloud, 'https://soundcloud.com/'), title: 'SoundCloud', placeholder: 'https://soundcloud.com/yourname', cls: styles.underBannerSocialSoundcloud, addCls: styles.actionBtnSoundcloud, icon: <SoundcloudIcon /> });
  if (data.instagram) links.push({ key: 'ig', field: 'instagram', raw: data.instagram, href: n(data.instagram, 'https://instagram.com/'), title: 'Instagram', placeholder: 'https://instagram.com/yourname', cls: styles.underBannerSocialInstagram, addCls: styles.actionBtnInstagram, icon: <InstagramIcon /> });
  if (data.tiktok) links.push({ key: 'tk', field: 'tiktok', raw: data.tiktok, href: n(data.tiktok, 'https://tiktok.com/@'), title: 'TikTok', placeholder: 'https://tiktok.com/@yourname', cls: styles.underBannerSocialTiktok, addCls: styles.actionBtnTiktok, icon: <TiktokIcon /> });
  if (data.facebook) links.push({ key: 'fb', field: 'facebook', raw: data.facebook, href: n(data.facebook, 'https://facebook.com/'), title: 'Facebook', placeholder: 'https://facebook.com/yourname', cls: styles.underBannerSocialFacebook, addCls: styles.actionBtnFacebook, icon: <FacebookIcon /> });
  if (data.twitch) links.push({ key: 'tw', field: 'twitch', raw: data.twitch, href: n(data.twitch, 'https://twitch.tv/'), title: 'Twitch', placeholder: 'https://twitch.tv/yourname', cls: styles.underBannerSocialTwitch, addCls: styles.actionBtnTwitch, icon: <TwitchIcon /> });

  // The row always renders now — even with no socials — because it hosts
  // the share button at the end.

  return (
    <div className={styles.underBannerSocials}>
      {links.map(l => (
        isOwnProfile ? (
          // Owner: each SET social stays editable — the icon opens an inline
          // editor prefilled with the current value (pencil badge), and
          // clearing it removes the link.
          <SocialAddButton
            key={l.key}
            userId={data.id}
            field={l.field}
            label={l.title}
            placeholder={l.placeholder}
            initialValue={l.raw}
            icon={l.icon}
            colorClass={l.addCls}
            openField={openSocialField}
            setOpenField={setOpenSocialField}
          />
        ) : (
          <a
            key={l.key}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.underBannerSocialBtn} ${l.cls}`}
            title={l.title}
          >
            {l.icon}
          </a>
        )
      ))}
      {/* Owner-only + add buttons for missing platforms — sit alongside
          the existing social links so all social management is in one row. */}
      {isOwnProfile && !data.website && (
        <SocialAddButton
          userId={data.id}
          field="website"
          label="Website"
          placeholder="https://yoursite.com"
          icon={<WebsiteIcon />}
          colorClass={styles.actionBtnWebsite}
          openField={openSocialField}
          setOpenField={setOpenSocialField}
        />
      )}
      {isOwnProfile && !data.soundcloud && (
        <SocialAddButton
          userId={data.id}
          field="soundcloud"
          label="SoundCloud"
          placeholder="https://soundcloud.com/yourname"
          icon={<SoundcloudIcon />}
          colorClass={styles.actionBtnSoundcloud}
          openField={openSocialField}
          setOpenField={setOpenSocialField}
        />
      )}
      {isOwnProfile && !data.instagram && (
        <SocialAddButton
          userId={data.id}
          field="instagram"
          label="Instagram"
          placeholder="https://instagram.com/yourname"
          icon={<InstagramIcon />}
          colorClass={styles.actionBtnInstagram}
          openField={openSocialField}
          setOpenField={setOpenSocialField}
        />
      )}
      {isOwnProfile && !data.tiktok && (
        <SocialAddButton
          userId={data.id}
          field="tiktok"
          label="TikTok"
          placeholder="https://tiktok.com/@yourname"
          icon={<TiktokIcon />}
          colorClass={styles.actionBtnTiktok}
          openField={openSocialField}
          setOpenField={setOpenSocialField}
        />
      )}
      {isOwnProfile && !data.facebook && (
        <SocialAddButton
          userId={data.id}
          field="facebook"
          label="Facebook"
          placeholder="https://facebook.com/yourname"
          icon={<FacebookIcon />}
          colorClass={styles.actionBtnFacebook}
          openField={openSocialField}
          setOpenField={setOpenSocialField}
        />
      )}
      {isOwnProfile && !data.twitch && (
        <SocialAddButton
          userId={data.id}
          field="twitch"
          label="Twitch"
          placeholder="https://twitch.tv/yourname"
          icon={<TwitchIcon />}
          colorClass={styles.actionBtnTwitch}
          openField={openSocialField}
          setOpenField={setOpenSocialField}
        />
      )}
      {/* Owner-only phone control — sits in its OWN cluster (own divider),
          apart from the socials, mirroring where visitors see the Call
          button. Always shown so the DJ can set OR change their number. */}
      {isOwnProfile && (
        <div className={styles.underBannerContact}>
          <SocialAddButton
            userId={data.id}
            field="phone"
            label={data.phone ? 'Change phone' : 'Add phone'}
            placeholder="Your phone number"
            initialValue={data.phone || ''}
            icon={(
              <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
                <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
              </svg>
            )}
            colorClass=""
            openField={openSocialField}
            setOpenField={setOpenSocialField}
          />
        </div>
      )}
      {/* Contact cluster — phone + message. Sits after the socials with its
          own divider, before Share. Hidden for the owner (no self-message).
          Phone links to tel: when signed in; logged-out visitors get a
          disabled "View phone" placeholder (same gate as the old hero
          phone). Message opens the compose modal (gated to verified users
          by onMessageClick). */}
      {!isOwnProfile && (
        <div className={styles.underBannerContact}>
          {data.phone && (
            <a
              href={`tel:${data.phone}`}
              className={`${styles.underBannerSocialBtn} ${styles.underBannerPhone}`}
              title={data.phone}
              aria-label="Call"
            >
              {/* Solid classic handset with ring waves. */}
              <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
                <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
                <path d="M15.5 6.5c1.4.5 2.5 1.6 3 3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                <path d="M15 3.2c2.9.7 5.1 2.9 5.8 5.8" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
              </svg>
            </a>
          )}
          <button
            type="button"
            className={`${styles.underBannerSocialBtn} ${styles.underBannerMail}`}
            title="Message us"
            aria-label="Message us"
            onClick={onMessageClick}
          >
            <MailIcon />
          </button>
        </div>
      )}

      {/* Share button — sits at the end of the socials row, set apart from
          the social icons by a divider gap. Opens a share-options menu
          (copy link, email, Facebook, X, WhatsApp, SMS). On mobile it shows
          a 3-dots icon; on desktop the share icon + "Share" label. */}
      <span ref={shareWrapRef} className={styles.underBannerShareWrap}>
        <button
          type="button"
          className={styles.underBannerShareBtn}
          title="Share this profile"
          aria-label="Share this profile"
          aria-haspopup="menu"
          aria-expanded={shareOpen}
          onClick={handleShare}
        >
          {/* Desktop: paper-plane icon + label. Mobile: the same paper-plane
              icon (slightly larger), no label. Toggled purely by CSS. */}
          <span className={styles.shareDesktop}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            <span>Share</span>
          </span>
          <svg className={styles.shareMobileDots} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>

        {shareOpen && (
          <div className={styles.shareMenu} role="menu">
            {shareMenu.map((item) =>
              item.onClick ? (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className={styles.shareMenuItem}
                  onClick={() => { item.onClick!(); }}
                >
                  {item.label}
                </button>
              ) : (
                <a
                  key={item.key}
                  role="menuitem"
                  className={styles.shareMenuItem}
                  href={shareHref(item.key)}
                  target={item.key === 'email' || item.key === 'sms' ? undefined : '_blank'}
                  rel="noopener noreferrer"
                  onClick={() => setShareOpen(false)}
                >
                  {item.label}
                </a>
              )
            )}
          </div>
        )}
      </span>
    </div>
  );
}
