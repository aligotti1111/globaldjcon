'use client';

// EmbedCodeSection — generate a copy-pasteable iframe snippet for the DJ
// to paste on third-party sites (their own website, a venue partner site,
// etc.). Live preview shows what visitors will see.
//
// Settings:
//   - theme: dark | light
//   - height: starting iframe height in pixels (auto-resized via postMessage)
//
// The snippet itself contains a small <script> that listens for the
// gdc-embed-height postMessage and resizes the iframe automatically, so
// the embed handles its own height across month nav.
//
// Used by both BookingTab (mobile DJs) and ClubBookingTab (club DJs).

import { useState } from 'react';
import styles from './updateDjProfile.module.css';

export default function EmbedCodeSection({ slug }: { slug: string }) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [height, setHeight] = useState<number>(520);
  const [copied, setCopied] = useState(false);

  // The base URL the iframe points to. Hardcoded to the production domain
  // so the snippet is portable — when a venue pastes this on their site,
  // it should always load from globaldjconnect.com regardless of where
  // the DJ generated the snippet from.
  const baseSrc = `https://globaldjconnect.com/embed-calendar?slug=${encodeURIComponent(slug)}&theme=${theme}&months=1`;

  // Live preview src — rendered inside an iframe in this tab.
  // Uses a relative URL so this works on staging without a domain switch.
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

  // No slug yet (user hasn't set one) — explain rather than render a
  // broken snippet.
  if (!slug) {
    return (
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Embed Your Calendar</div>
        </div>
        <div className={styles.sectionBody}>
          <p className={styles.bodyHint}>
            Set your URL slug on the General tab first — the embed code
            needs a slug to point at.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Embed Your Calendar</div>
      </div>
      <div className={styles.sectionBody}>
        <p className={styles.bodyHint}>
          Paste this snippet on any website to display your live calendar.
          When visitors click an open date, they&apos;ll be sent to your
          Global DJ Connect profile to book.
        </p>

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
                color: 'var(--muted)',
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
                background: 'var(--deep)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--white)',
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
                color: 'var(--muted)',
                marginBottom: '.35rem',
              }}
            >
              Starting Height (px)
            </label>
            <input
              type="number"
              min={300}
              max={1200}
              step={20}
              value={height}
              onChange={(e) => setHeight(parseInt(e.target.value, 10) || 520)}
              style={{
                width: '100%',
                background: 'var(--deep)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--white)',
                padding: '.55rem .75rem',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '.88rem',
              }}
            />
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
            color: 'var(--muted)',
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
            background: 'var(--deep)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--white)',
            padding: '.75rem',
            fontFamily: "'Space Mono', monospace",
            fontSize: '.7rem',
            lineHeight: 1.55,
            resize: 'vertical',
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
            background: copied ? 'var(--success)' : 'var(--neon)',
            color: 'var(--black)',
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
              color: 'var(--muted)',
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
              border: '1px solid var(--border)',
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
