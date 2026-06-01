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
  FacebookIcon, TwitchIcon, CalendarIcon,
} from './icons';
import type { DjProfileData } from './profileTypes';
import { thumbUrl, validateImageFile } from './profilePhotoUtils';

export function BannerTypeEventsDropdown({ events }: { events: string[] }) {
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
      Mobile / Event DJ{hasEvents && ' ▾'}
      {mounted && open && hasEvents && pos && createPortal(
        <div
          className={styles.bannerTypeDropdown}
          data-banner-type-dropdown
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
        >
          {events.map(ev => (
            <div key={ev} className={styles.bannerTypeDropdownItem}>
              {EVENT_TYPE_LABELS[ev] || ev}
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
}: {
  userId: string;
  field: 'website' | 'soundcloud' | 'instagram' | 'tiktok' | 'facebook' | 'twitch';
  label: string;
  placeholder: string;
  icon: React.ReactNode;
  colorClass: string;
  // Lifted state — only one SocialAddButton can be expanded at a time.
  // Each button reads openField to know if IT is the open one, and
  // calls setOpenField(field) on click / setOpenField(null) on close.
  openField: string | null;
  setOpenField: (field: string | null) => void;
}) {
  const expanded = openField === field;
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the parent closes us (because another button got opened), reset
  // local input state so we don't show stale text on next open.
  useEffect(() => {
    if (!expanded) {
      setValue('');
      setError(null);
    }
  }, [expanded]);

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Enter something first.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: dbError } = await supabase
        .from('users')
        .update({ [field]: trimmed } as unknown as never)
        .eq('id', userId);
      if (dbError) throw dbError;
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
        title={`Add ${label}`}
        aria-label={`Add ${label}`}
        className={`${styles.actionBtn} ${colorClass} ${styles.actionBtnEmpty}`}
      >
        {icon}
        {/* Tiny "+" badge in the corner so the affordance reads as add. */}
        <span style={{
          position: 'absolute',
          top: -4,
          right: -4,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: 'var(--neon)',
          color: '#000',
          fontSize: '0.7rem',
          fontWeight: 700,
          lineHeight: '16px',
          textAlign: 'center',
          pointerEvents: 'none',
        }}>+</span>
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

  function startEdit() {
    setDraft(bio);
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
      const supabase = createClient();
      const trimmed = draft.trim();
      const { error: dbError } = await supabase
        .from('users')
        .update({ bio: trimmed || null } as unknown as never)
        .eq('id', userId);
      if (dbError) throw dbError;
      setBio(trimmed);
      setEditing(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tell people about yourself, your sound, your style…"
          disabled={saving}
          rows={6}
          style={{
            width: '100%',
            padding: '.75rem',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid var(--neon)',
            borderRadius: 6,
            color: 'var(--white, #fff)',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: '.95rem',
            lineHeight: 1.6,
            resize: 'vertical',
            boxSizing: 'border-box',
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
          <p style={{
            margin: 0,
            color: 'var(--white, #fff)',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: '.95rem',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}>
            {bio}
          </p>
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
      const supabase = createClient();
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
      const { error: dbError } = await supabase
        .from('users')
        .update(payload as unknown as never)
        .eq('id', userId);
      if (dbError) throw dbError;
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
  slot,
  initialTitle,
  initialDesc,
}: {
  userId: string;
  slot: 1 | 2 | 3;
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
      const supabase = createClient();
      const { error: dbError } = await supabase
        .from('users')
        .update({
          [`video_title_${slot}`]: titleDraft.trim() || null,
          [`video_desc_${slot}`]: descDraft.trim() || null,
        } as unknown as never)
        .eq('id', userId);
      if (dbError) throw dbError;
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
  slots,
  onClose,
}: {
  userId: string;
  slots: { slot: 1 | 2 | 3 | 4; url: string | null }[];
  onClose: () => void;
}) {
  // Local mirror of slot URLs so the modal updates immediately on
  // upload/remove without waiting for the close-and-reload roundtrip.
  const [slotUrls, setSlotUrls] = useState<Record<number, string | null>>(() => {
    const m: Record<number, string | null> = {};
    for (const s of slots) m[s.slot] = s.url;
    return m;
  });

  const filledCount = Object.values(slotUrls).filter((u) => !!u).length;

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
          maxWidth: 560,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '.4rem',
        }}>
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '1.4rem',
            color: 'var(--white, #fff)',
            letterSpacing: '.04em',
          }}>
            Manage Photos
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
        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: '.7rem',
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: 'var(--muted, #888)',
          marginBottom: '1rem',
        }}>
          {filledCount} of 4 slots filled
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '.75rem',
        }}>
          {([1, 2, 3, 4] as const).map((slot) => (
            <PhotoManagerSlot
              key={slot}
              slot={slot}
              userId={userId}
              url={slotUrls[slot] || null}
              onChange={(newUrl) => {
                setSlotUrls((prev) => ({ ...prev, [slot]: newUrl }));
              }}
            />
          ))}
        </div>
        {/* Footer — Done button to close + reload. Each slot already
            persists to DB on upload/remove, so this is purely a way to
            dismiss the modal and refresh the underlying tab. */}
        <div style={{
          marginTop: '1.25rem',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '.6rem 1.4rem',
              background: 'var(--neon)',
              border: 'none',
              borderRadius: 6,
              color: '#000',
              fontFamily: "'Space Mono', monospace",
              fontSize: '.75rem',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// PhotoManagerSlot — a single 2x2 grid cell. Empty: dashed neon border
// with a centered + that opens the file picker. Filled: shows the image
// with a remove ✕ and a "Change Photo" overlay on hover. Uploads to
// Supabase Storage via the same path convention the existing PhotosTab
// uses (avatars bucket, `${userId}/gallery_${slot}.{ext}`).
export function PhotoManagerSlot({
  slot,
  userId,
  url,
  onChange,
}: {
  slot: 1 | 2 | 3 | 4;
  userId: string;
  url: string | null;
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovering, setHovering] = useState(false);

  function pick() {
    if (busy) return;
    inputRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    // Run client-side validation BEFORE the upload kicks off so a
    // bad file gets rejected instantly with no Supabase roundtrip.
    const valErr = await validateImageFile(file);
    if (valErr) {
      setError(valErr);
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${userId}/gallery_${slot}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
      const { error: dbErr } = await supabase
        .from('users')
        .update({ [`gallery_img_${slot}`]: publicUrl } as unknown as never)
        .eq('id', userId);
      if (dbErr) throw dbErr;
      onChange(publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: dbErr } = await supabase
        .from('users')
        .update({ [`gallery_img_${slot}`]: null } as unknown as never)
        .eq('id', userId);
      if (dbErr) throw dbErr;
      onChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        onClick={pick}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{
          position: 'relative',
          aspectRatio: '1 / 1',
          background: url ? '#000' : 'rgba(0, 245, 196, .05)',
          border: url ? '1px solid var(--border, rgba(255,255,255,0.15))' : '2px dashed var(--neon)',
          borderRadius: 8,
          cursor: busy ? 'wait' : 'pointer',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: busy ? 0.6 : 1,
          transition: 'opacity .15s',
        }}
      >
        {url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbUrl(url, 400)}
              alt={`Gallery slot ${slot}`}
              width={400}
              height={400}
              loading="eager"
              decoding="async"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
            {hovering && !busy && (
              <div style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--neon)',
                fontFamily: "'Space Mono', monospace",
                fontSize: '.7rem',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
              }}>
                Change Photo
              </div>
            )}
            <button
              type="button"
              onClick={remove}
              title="Remove this photo"
              aria-label="Remove this photo"
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: 'rgba(0, 0, 0, .8)',
                border: '1px solid rgba(255, 95, 95, .7)',
                color: '#ff5f5f',
                fontSize: '.8rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '.4rem',
          }}>
            <div style={{
              color: 'var(--neon)',
              fontSize: '2.5rem',
              lineHeight: 1,
              fontWeight: 300,
            }}>
              {busy ? '…' : '+'}
            </div>
            <div style={{
              color: 'var(--muted, #888)',
              fontFamily: "'Space Mono', monospace",
              fontSize: '.6rem',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
            }}>
              Photo {slot}
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onFile}
        />
      </div>
      {error && (
        <div style={{
          marginTop: '.3rem',
          color: '#ff5f5f',
          fontSize: '.7rem',
          fontFamily: 'DM Sans, sans-serif',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// thumbUrl — rewrite a Supabase Storage public URL to use the image
// transform endpoint so we get a small thumbnail instead of the full
// multi-MB original. Used by the photo manager modal so opening doesn't
// stall while 4 full-resolution photos download.
//
// Pattern: /storage/v1/object/public/<bucket>/<path> →
//          /storage/v1/render/image/public/<bucket>/<path>?width=N&resize=cover&quality=70
//
// Falls back to the original URL if the input doesn't match the
// Supabase public-object pattern (e.g. external URLs from older data).
// Preserves any cache-busting `?t=` query so updated images still
// invalidate the browser cache.
// ─────────────────────────────────────────────────────────────────────────
function thumbUrl(originalUrl: string, size: number): string {
  try {
    const u = new URL(originalUrl);
    if (!u.pathname.includes('/storage/v1/object/public/')) {
      return originalUrl;
    }
    const transformedPath = u.pathname.replace(
      '/storage/v1/object/public/',
      '/storage/v1/render/image/public/'
    );
    // Preserve cache-busting timestamp if present
    const t = u.searchParams.get('t');
    const params = new URLSearchParams();
    params.set('width', String(size));
    params.set('height', String(size));
    params.set('resize', 'cover');
    params.set('quality', '70');
    if (t) params.set('t', t);
    return `${u.origin}${transformedPath}?${params.toString()}`;
  } catch {
    return originalUrl;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// validateImageFile — defence-in-depth checks before any upload to
// Supabase Storage. Returns null if the file is OK, or an error string
// to show the user.
//
// Layered checks:
//   1. MIME whitelist — user's File.type must be a real raster image
//      type. Excludes image/svg+xml on purpose because SVGs can carry
//      executable JavaScript via embedded <script> tags.
//   2. Extension match — defends against MIME spoofing where a file
//      has type 'image/png' but a .exe extension or vice-versa.
//   3. Size limit — 10MB cap so people can't accidentally (or
//      maliciously) upload huge files that hammer storage and
//      bandwidth. Modern phone photos are ~3-5MB so this is generous.
//   4. Magic-byte check — reads the first few bytes of the file and
//      compares to known image signatures. Catches the classic trick
//      of renaming `virus.exe` to `pic.jpg` because the bytes won't
//      match. async because FileReader is async.
//
// All checks run client-side and are best-effort; a determined attacker
// can bypass them. Server-side bucket restrictions in Supabase are the
// real gate — these just give faster feedback and a cleaner UX.
// ─────────────────────────────────────────────────────────────────────────
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
const ALLOWED_IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

async function validateImageFile(file: File): Promise<string | null> {
  // 1. MIME whitelist — explicitly reject SVG even if the OS reports
  //    it as image/svg+xml because SVGs are XML and can contain scripts.
  if (file.type === 'image/svg+xml') {
    return 'SVG files are not supported.';
  }
  if (!ALLOWED_IMAGE_MIME.includes(file.type)) {
    return 'Only JPG, PNG, WebP, GIF, and HEIC images are allowed.';
  }

  // 2. Extension match — defends against .exe renamed to .jpg etc.
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_IMAGE_EXT.includes(ext)) {
    return 'File extension does not look like a valid image.';
  }

  // 3. Size cap — prevents abuse of storage bandwidth.
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `File is too large (${mb} MB). Max is 10 MB.`;
  }
  if (file.size === 0) {
    return 'File appears to be empty.';
  }

  // 4. Magic-byte check — read first 16 bytes and confirm they match
  //    one of our allowed image signatures. Bypassing this requires
  //    crafting a polyglot file which is beyond casual users.
  const bytes = await readFirstBytes(file, 16);
  if (!isImageMagicBytes(bytes)) {
    return 'File does not appear to be a valid image.';
  }
  return null;
}

function readFirstBytes(file: File, n: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      resolve(new Uint8Array(buf));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file.slice(0, n));
  });
}

function isImageMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return true;
  // GIF87a / GIF89a: 47 49 46 38 (37|39) 61
  if (
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) return true;
  // WebP: starts with RIFF (52 49 46 46) and at byte 8 has WEBP (57 45 42 50)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return true;
  // HEIC/HEIF: 'ftyp' box at offset 4 — bytes 4-7 are 66 74 79 70
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  ) return true;
  return false;
}


// ─────────────────────────────────────────────────────────────────────────
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
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDesktopRef = useRef<{ startY: number; startPos: number } | null>(null);
  const dragMobileRef = useRef<{ startY: number; startPos: number } | null>(null);

  useEffect(() => {
    return () => {
      if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl);
    };
  }, [pendingObjectUrl]);

  async function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
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
        const path = `${userId}/banner.${ext}`;
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
      const { error: dbErr } = await supabase
        .from('users')
        .update(patch as unknown as never)
        .eq('id', userId);
      if (dbErr) throw dbErr;
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
      const supabase = createClient();
      const { error: dbErr } = await supabase
        .from('users')
        .update({
          banner_url: null,
          banner_position: null,
          banner_position_mobile: null,
        } as unknown as never)
        .eq('id', userId);
      if (dbErr) throw dbErr;
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
          <div className={styles.bannerPreviewsRow}>
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
                    Click to upload
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
                    Click to upload
                  </div>
                )}
                {previewUrl && (
                  <div className={styles.bannerModalDragHint}>Drag to reposition</div>
                )}
              </div>
            </div>
          </div>

          <div className={styles.bannerModalHint}>
            Upload a wide image (recommended <strong>1600 × 400px</strong>, max 5 MB).
            Drag each preview vertically to set the crop for desktop and mobile
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
  };
  isMobileDJ: boolean;
  onClose: () => void;
}) {
  const [vis, setVis] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: keyof typeof initial) {
    setVis(v => ({ ...v, [key]: !v[key] }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: dbErr } = await supabase
        .from('users')
        .update({ tab_visibility: vis } as unknown as never)
        .eq('id', userId);
      if (dbErr) throw dbErr;
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      setBusy(false);
    }
  }

  const rows: Array<{
    key: keyof typeof initial;
    label: string;
    hint?: string;
  }> = [
    { key: 'about', label: 'About' },
    { key: 'mixes', label: 'Mixes' },
    { key: 'images', label: 'Photos' },
    { key: 'video', label: 'Video' },
    // Testimonials are only relevant for mobile DJs.
    ...(isMobileDJ
      ? [{
          key: 'testimonials' as const,
          label: 'Testimonials',
          hint: 'Off by default for new mobile DJs',
        }]
      : []),
  ];

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
            Choose which tabs are visible to visitors. The <strong>Booking</strong> tab
            is controlled separately by your booking settings.
          </div>

          <div className={styles.tabsList}>
            {rows.map(row => (
              <label key={row.key} className={styles.tabsRow}>
                <div className={styles.tabsRowText}>
                  <div className={styles.tabsRowLabel}>{row.label}</div>
                  {row.hint && (
                    <div className={styles.tabsRowHint}>{row.hint}</div>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={vis[row.key]}
                  onChange={() => toggle(row.key)}
                  className={styles.tabsCheckbox}
                />
              </label>
            ))}
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
      const supabase = createClient();
      const { error: dbErr } = await supabase
        .from('users')
        .update({ testimonials: JSON.stringify(next) } as unknown as never)
        .eq('id', userId);
      if (dbErr) throw dbErr;
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
export function UnderBannerSocials({ data, effectiveSlug, isOwnProfile, bookingEnabled, onShareClick }: { data: DjProfileData; effectiveSlug: string; isOwnProfile: boolean; bookingEnabled: boolean; onShareClick: () => void }) {
  // Lifted: only one SocialAddButton can be expanded at a time.
  const [openSocialField, setOpenSocialField] = useState<string | null>(null);
  // Copy-link feedback state — used only when booking is NOT active, in
  // which case the Share button copies the profile link instead of
  // opening the share-calendar modal (there's no calendar to share).
  const [copied, setCopied] = useState(false);

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
  // When booking is active the Share button opens the share-calendar
  // modal; otherwise it just copies the general profile link.
  const handleShare = bookingEnabled ? onShareClick : copyProfileLink;

  function n(s: string, prefix: string): string {
    return s.startsWith('http') ? s : prefix + s.replace('@', '');
  }
  const links: { key: string; href: string; title: string; cls: string; icon: React.ReactNode }[] = [];
  if (data.website) links.push({ key: 'web', href: n(data.website, 'https://'), title: 'Website', cls: styles.underBannerSocialWebsite, icon: <WebsiteIcon /> });
  if (data.soundcloud) links.push({ key: 'sc', href: n(data.soundcloud, 'https://soundcloud.com/'), title: 'SoundCloud', cls: styles.underBannerSocialSoundcloud, icon: <SoundcloudIcon /> });
  if (data.instagram) links.push({ key: 'ig', href: n(data.instagram, 'https://instagram.com/'), title: 'Instagram', cls: styles.underBannerSocialInstagram, icon: <InstagramIcon /> });
  if (data.tiktok) links.push({ key: 'tk', href: n(data.tiktok, 'https://tiktok.com/@'), title: 'TikTok', cls: styles.underBannerSocialTiktok, icon: <TiktokIcon /> });
  if (data.facebook) links.push({ key: 'fb', href: n(data.facebook, 'https://facebook.com/'), title: 'Facebook', cls: styles.underBannerSocialFacebook, icon: <FacebookIcon /> });
  if (data.twitch) links.push({ key: 'tw', href: n(data.twitch, 'https://twitch.tv/'), title: 'Twitch', cls: styles.underBannerSocialTwitch, icon: <TwitchIcon /> });

  // The row always renders now — even with no socials — because it hosts
  // the share button at the end.

  return (
    <div className={styles.underBannerSocials}>
      {links.map(l => (
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
      {/* Share button — sits at the end of the socials row, set apart
          from the social icons by a divider gap. When booking is active
          it opens the share-calendar modal; when booking is off there's
          no calendar to share, so it just copies the profile link (with
          a brief "Copied" confirmation). */}
      <button
        type="button"
        className={styles.underBannerShareBtn}
        title={
          bookingEnabled ? 'Share calendar'
            : copied ? 'Link copied!' : 'Copy profile link'
        }
        aria-label={
          bookingEnabled ? 'Share calendar'
            : copied ? 'Profile link copied' : 'Copy profile link'
        }
        onClick={handleShare}
      >
        {!bookingEnabled && copied ? (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>Copied</span>
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            <span>Share</span>
          </>
        )}
      </button>
    </div>
  );
}
