'use client';

import { useEffect, useRef, useState } from 'react';
import styles from '../profile.module.css';
import { createClient } from '@/lib/supabase/client';
import {
  PhoneIcon, WebsiteIcon, SoundcloudIcon, InstagramIcon, TiktokIcon,
  FacebookIcon, TwitchIcon, CalendarIcon, MailIcon,
} from '../icons';
import type { DjProfileData } from '../profileTypes';
import { saveProfile } from '../profileSave';

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
            "tap to edit" affordance rather than a smudge on the icon. The
            className lets the CSS re-anchor it per icon style (e.g. no-circle,
            where the glyph is larger and the badge must tuck closer). */}
        <span className={styles.socialAddBadge} style={{
          position: 'absolute',
          top: -3,
          right: -3,
          width: isEdit ? 17 : 14,
          height: isEdit ? 17 : 14,
          borderRadius: '50%',
          background: isEdit ? 'transparent' : '#fff',
          color: '#08080d',
          fontSize: '0.6rem',
          fontWeight: 800,
          lineHeight: 1,
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
          ) : (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#08080d" strokeWidth="4" strokeLinecap="round" aria-hidden="true" style={{ display: 'block' }}>
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          )}
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
export function UnderBannerSocials({ data, effectiveSlug, isOwnProfile, bookingEnabled, ownerIsPro = false, onShareClick, isLoggedIn = false, onMessageClick }: { data: DjProfileData; effectiveSlug: string; isOwnProfile: boolean; bookingEnabled: boolean; ownerIsPro?: boolean; onShareClick: () => void; isLoggedIn?: boolean; onMessageClick?: () => void }) {
  // Lifted: only one SocialAddButton can be expanded at a time.
  const [openSocialField, setOpenSocialField] = useState<string | null>(null);
  // Icon style: one of four presets, chosen by the owner from a dropdown and
  // applied live (no reload) by swapping modifier classes on the row.
  //   white        → white glyph, white outlined circle (default)
  //   color        → brand-color glyph + outlined circle
  //   white-plain  → white glyph, no circle
  //   color-plain  → brand-color glyph, no circle
  type IconStyle = 'white' | 'color' | 'white-plain' | 'color-plain';
  const ICON_STYLE_KEYS: IconStyle[] = ['white', 'color', 'white-plain', 'color-plain'];
  const initialStyle: IconStyle = ICON_STYLE_KEYS.includes(data.social_icon_style as IconStyle)
    ? (data.social_icon_style as IconStyle)
    : 'white';
  const [iconStyle, setIconStyle] = useState<IconStyle>(initialStyle);
  const [iconMenuOpen, setIconMenuOpen] = useState(false);
  const iconMenuRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!iconMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (iconMenuRef.current && !iconMenuRef.current.contains(e.target as Node)) setIconMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setIconMenuOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [iconMenuOpen]);
  const iconStyleColored = iconStyle === 'color' || iconStyle === 'color-plain';
  const iconStylePlain = iconStyle === 'white-plain' || iconStyle === 'color-plain';
  async function chooseIconStyle(next: IconStyle) {
    const prev = iconStyle;
    setIconStyle(next);          // optimistic
    setIconMenuOpen(false);
    try {
      await saveProfile(data.id, { social_icon_style: next });
    } catch {
      setIconStyle(prev);        // revert on failure
    }
  }
  // Options for the icon-style dropdown, each with a live mini-preview.
  const iconStyleOptions: { key: IconStyle; label: string; colored: boolean; plain: boolean }[] = [
    { key: 'white', label: 'White', colored: false, plain: false },
    { key: 'color', label: 'Color', colored: true, plain: false },
    { key: 'white-plain', label: 'White · no circle', colored: false, plain: true },
    { key: 'color-plain', label: 'Color · no circle', colored: true, plain: true },
  ];
  // The platforms shown in a style preview, with their brand colors — mirrors
  // the real under-banner icon row so a preview shows the whole list at once.
  const previewPlatforms: { icon: React.ReactNode; color: string }[] = [
    { icon: <WebsiteIcon />, color: '#00f5c4' },
    { icon: <SoundcloudIcon />, color: '#ff5500' },
    { icon: <InstagramIcon />, color: '#e1306c' },
    { icon: <TiktokIcon />, color: '#69c9d0' },
    { icon: <FacebookIcon />, color: '#1877f2' },
    { icon: <TwitchIcon />, color: '#9146ff' },
  ];
  // A mini render of the FULL icon row in a given style, used both as the
  // dropdown trigger's swatch and inside each menu option.
  function iconStylePreview(colored: boolean, plain: boolean): React.ReactNode {
    return (
      <span className={styles.iconStylePreviewRow} aria-hidden="true">
        {previewPlatforms.map((p, i) => (
          <span
            key={i}
            className={styles.iconStylePreviewDot}
            style={{
              border: plain ? 'none' : `1px solid ${colored ? p.color : '#fff'}`,
              color: colored ? p.color : '#fff',
            }}
          >
            {p.icon}
          </span>
        ))}
      </span>
    );
  }
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

  // The signed-in viewer's account email, read once so "Email" can route to
  // their webmail's compose page (Gmail / Outlook / Yahoo / AOL) instead of a
  // flaky mailto: — the same approach the booking-card share uses. Anonymous
  // viewers (no email) fall back to mailto:.
  const [acctEmail, setAcctEmail] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data: u } = await supabase.auth.getUser();
        if (alive) setAcctEmail(u.user?.email ?? null);
      } catch { /* not signed in — mailto: fallback */ }
    })();
    return () => { alive = false; };
  }, []);

  // Open the viewer's webmail compose page with the profile link preloaded; if
  // their provider isn't a known webmail (or they're not signed in), fall back
  // to mailto: so the OS mail app opens.
  function shareByEmail() {
    setShareOpen(false);
    const subject = shareTitle;
    const body = `${shareTitle}\n\n${profileUrl()}`;
    const enc = encodeURIComponent;
    const domain = (acctEmail || '').split('@')[1]?.toLowerCase() || '';
    let compose: string | null = null;
    if (/^(gmail\.com|googlemail\.com)$/.test(domain)) compose = `https://mail.google.com/mail/?view=cm&fs=1&tf=1&su=${enc(subject)}&body=${enc(body)}`;
    else if (/^(outlook\.|hotmail\.|live\.|msn\.)/.test(domain) || domain === 'outlook.com') compose = `https://outlook.live.com/mail/0/deeplink/compose?subject=${enc(subject)}&body=${enc(body)}`;
    else if (/^(yahoo\.|ymail\.com|rocketmail\.com)/.test(domain) || domain === 'yahoo.com') compose = `https://compose.mail.yahoo.com/?subject=${enc(subject)}&body=${enc(body)}`;
    else if (domain === 'aol.com') compose = `https://mail.aol.com/?subject=${enc(subject)}&body=${enc(body)}`;
    const a = document.createElement('a');
    if (compose) { a.href = compose; a.target = '_blank'; a.rel = 'noopener'; }
    else { a.href = `mailto:?subject=${enc(subject)}&body=${enc(body)}`; }
    document.body.appendChild(a); a.click(); a.remove();
  }

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
  // Small monochrome icons for each share target, sized to sit inline with
  // the label in the share menu.
  const shareIcons: Record<string, React.ReactNode> = {
    copy: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    ),
    email: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" />
      </svg>
    ),
    facebook: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12Z" />
      </svg>
    ),
    x: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.6l5.24 6.93 6.06-6.93Zm-1.29 19.5h2.04L6.48 3.24H4.29l13.32 17.41Z" />
      </svg>
    ),
    whatsapp: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.16c-.25.69-1.44 1.32-1.98 1.36-.53.05-1.03.24-3.47-.72-2.93-1.16-4.8-4.16-4.95-4.36-.14-.2-1.19-1.58-1.19-3.01 0-1.43.75-2.13 1.02-2.42.27-.29.58-.36.78-.36.19 0 .39 0 .56.01.18.01.42-.07.66.5.25.59.84 2.02.91 2.17.07.14.12.31.02.51-.1.2-.15.31-.29.48-.14.17-.3.38-.43.51-.14.14-.29.29-.13.57.17.29.75 1.23 1.6 1.99 1.11.99 2.04 1.29 2.33 1.44.29.14.46.12.63-.07.17-.2.72-.84.91-1.13.19-.29.39-.24.66-.14.27.1 1.69.8 1.98.94.29.14.48.22.55.34.07.12.07.69-.18 1.38Z" />
      </svg>
    ),
    sms: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
      </svg>
    ),
  };
  const shareMenu: { key: string; label: string; href?: string; onClick?: () => void }[] = [
    { key: 'copy', label: copied ? 'Copied!' : 'Copy link', onClick: copyProfileLink },
    { key: 'email', label: 'Email', onClick: shareByEmail },
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
    <div className={`${styles.underBannerSocials}${iconStyleColored ? ` ${styles.socialsColored}` : ''}${iconStylePlain ? ` ${styles.socialsNoCircle}` : ''}`}>
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
      {/* Owner-only icon-style picker — a caret sitting right after the last
          social icon. Opens a small popover (like Share) of the four style
          presets, each a live preview of the whole icon row. Applies instantly;
          saves in the background. */}
      {isOwnProfile && (
        <span ref={iconMenuRef} className={styles.underBannerIconStyle}>
          <button
            type="button"
            className={`${styles.iconStyleCaret}${iconMenuOpen ? ` ${styles.iconStyleCaretOpen}` : ''}`}
            onClick={() => setIconMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={iconMenuOpen}
            title="Choose how your social icons look"
            aria-label="Choose how your social icons look"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {iconMenuOpen && (
            <div className={styles.iconStyleMenu} role="menu">
              <div className={styles.iconStyleMenuHeader}>Choose style</div>
              {iconStyleOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={iconStyle === opt.key}
                  aria-label={opt.label}
                  className={`${styles.iconStyleMenuItem}${iconStyle === opt.key ? ` ${styles.iconStyleMenuItemActive}` : ''}`}
                  onClick={() => chooseIconStyle(opt.key)}
                >
                  {iconStylePreview(opt.colored, opt.plain)}
                  {iconStyle === opt.key && (
                    <svg className={styles.iconStyleCheck} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </span>
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
          {/* Free plan: the number is saved but hidden from visitors. Tell the
              owner why, and where to unlock it. */}
          {data.phone && !ownerIsPro && (
            <a
              href="/subscribe"
              className={styles.underBannerPhoneLocked}
              title="Upgrade to show your phone number on your profile"
            >
              🔒 Hidden until you subscribe
            </a>
          )}
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
          {/* Phone paywall: a visitor only sees the Call button when the DJ is
              on a paid/comped plan. A free DJ can save a number but it stays
              hidden here until they subscribe. */}
          {data.phone && ownerIsPro && (
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
                  <span className={styles.shareMenuIcon} aria-hidden="true">{shareIcons[item.key]}</span>
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
                  <span className={styles.shareMenuIcon} aria-hidden="true">{shareIcons[item.key]}</span>
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
