'use client';

// ProfileQrCode — premium share tool. Generates a branded QR code that
// points at the DJ's PUBLIC profile (globaldjconnect.com/<slug>) so the DJ
// can drop it on flyers, business cards, IG stories, table tents, etc.
// Scanning it opens their profile where clients can view and book them.
//
// Everything is generated client-side (no server round-trip, no stored
// image): we build the QR module matrix with the `qrcode` package, paint it
// onto a canvas in the Global DJ Connect palette, add a caption (DJ name +
// URL) baked into the image so the downloaded PNG is self-explanatory, then
// export to PNG on demand.
//
// Two styles:
//   - Neon    — neon-teal modules on near-black. On-brand; best on screens.
//   - Classic — black on white. Maximum contrast; safest for print / bad
//               lighting / cheap scanners. Always offer this as the reliable
//               fallback.
//
// No center-logo knockout: the caption lives OUTSIDE the code so scanning is
// never compromised.
//
// Placement: rendered right beside EmbedCodeSection in the Booking tab, which
// only paid DJs reach — so this is inherently a paid/premium perk (and is
// badged as such). Mirrors EmbedCodeSection's slug-gating and card styling.

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import styles from './updateDjProfile.module.css';

type QrStyle = 'neon' | 'classic';

// Hardcoded to production so a downloaded/printed code always resolves to the
// live site regardless of where it was generated (staging, preview, etc.) —
// same reasoning as the embed snippet's baseSrc.
const PROFILE_BASE = 'https://globaldjconnect.com';

const PALETTE: Record<QrStyle, { bg: string; fg: string; sub: string }> = {
  neon: { bg: '#0b0b16', fg: '#00e0a4', sub: '#8a8aa0' },
  classic: { bg: '#ffffff', fg: '#000000', sub: '#555555' },
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Paint the QR matrix + caption onto the canvas at print resolution.
function paint(canvas: HTMLCanvasElement, url: string, djName: string, style: QrStyle) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const modCount = qr.modules.size;
  const bits = qr.modules.data; // row-major, 1 = dark
  const { bg, fg, sub } = PALETTE[style];

  const quiet = 4; // quiet-zone in modules (spec minimum)
  const gridMods = modCount + quiet * 2;
  // Aim for a ~1200px-wide code, snapped to whole modules for crisp edges.
  const scale = Math.max(4, Math.floor(1200 / gridMods));
  const codePx = gridMods * scale;

  const name = (djName || '').trim();
  const captionH = Math.round(scale * (name ? 12 : 7));
  const w = codePx;
  const h = codePx + captionH;

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Background (whole image, code + caption band share it).
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Modules.
  ctx.fillStyle = fg;
  for (let y = 0; y < modCount; y++) {
    for (let x = 0; x < modCount; x++) {
      if (bits[y * modCount + x]) {
        ctx.fillRect((quiet + x) * scale, (quiet + y) * scale, scale, scale);
      }
    }
  }

  // Caption band (baked into the export so the PNG stands alone).
  ctx.textAlign = 'center';
  const cx = w / 2;
  if (name) {
    ctx.fillStyle = fg;
    ctx.font = `700 ${Math.round(scale * 3.4)}px 'DM Sans', system-ui, sans-serif`;
    ctx.fillText(name, cx, codePx + Math.round(scale * 4.6));
    ctx.fillStyle = sub;
    ctx.font = `${Math.round(scale * 2.3)}px 'Space Mono', ui-monospace, monospace`;
    ctx.fillText(`globaldjconnect.com/${slugOf(url)}`, cx, codePx + Math.round(scale * 8.6));
  } else {
    ctx.fillStyle = sub;
    ctx.font = `${Math.round(scale * 2.3)}px 'Space Mono', ui-monospace, monospace`;
    ctx.fillText(`globaldjconnect.com/${slugOf(url)}`, cx, codePx + Math.round(scale * 4.4));
  }
}

function slugOf(url: string): string {
  const i = url.indexOf('/', PROFILE_BASE.length + 0);
  return i >= 0 ? url.slice(i + 1) : url.replace(`${PROFILE_BASE}/`, '');
}

export default function ProfileQrCode({ slug, djName }: { slug: string; djName?: string }) {
  const [style, setStyle] = useState<QrStyle>('neon');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const url = slug ? `${PROFILE_BASE}/${encodeURIComponent(slug)}` : '';

  useEffect(() => {
    if (!slug) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      paint(canvas, url, djName || '', style);
    } catch {
      // If encoding ever fails (e.g. an absurdly long slug), leave the canvas
      // blank rather than crashing the tab.
    }
  }, [slug, url, djName, style]);

  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `globaldjconnect-${slug || 'profile'}-qr.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [slug]);

  const copyLink = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* give up silently */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [url]);

  // No slug yet — same explain-don't-break behavior as the embed section.
  if (!slug) {
    return (
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Profile QR Code</div>
        </div>
        <div className={styles.sectionBody}>
          <p className={styles.bodyHint}>
            Set your URL slug on the General tab first — the QR code needs a
            slug to point at.
          </p>
        </div>
      </div>
    );
  }

  const pill: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace",
    fontSize: '.52rem',
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    fontWeight: 700,
    padding: '.2rem .5rem',
    borderRadius: 999,
    color: 'var(--black)',
    background: 'var(--neon)',
    marginLeft: '.6rem',
    verticalAlign: 'middle',
  };

  const segBtn = (active: boolean): React.CSSProperties => ({
    fontFamily: "'Space Mono', monospace",
    fontSize: '.62rem',
    letterSpacing: '.06em',
    textTransform: 'uppercase',
    padding: '.5rem .9rem',
    borderRadius: 6,
    border: `1px solid ${active ? 'var(--neon)' : 'var(--border)'}`,
    background: active ? 'var(--neon)' : 'transparent',
    color: active ? 'var(--black)' : 'var(--muted)',
    cursor: 'pointer',
    fontWeight: 700,
  });

  const actionBtn: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace",
    fontSize: '.65rem',
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    padding: '.6rem 1.2rem',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 700,
  };

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          Profile QR Code
          <span style={pill}>Premium</span>
        </div>
      </div>
      <div className={styles.sectionBody}>
        <p className={styles.bodyHint}>
          A scannable code that opens your public profile. Print it on flyers,
          business cards, or table tents — or drop it in an Instagram story so
          people can book you in one tap.
        </p>

        {/* Style toggle */}
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1rem' }}>
          <button type="button" style={segBtn(style === 'neon')} onClick={() => setStyle('neon')}>
            Neon
          </button>
          <button type="button" style={segBtn(style === 'classic')} onClick={() => setStyle('classic')}>
            Classic
          </button>
        </div>

        {/* Preview */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '1rem',
            background: 'var(--deep)',
            border: '1px solid var(--border)',
            borderRadius: 10,
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: '100%',
              maxWidth: 240,
              height: 'auto',
              borderRadius: 8,
              imageRendering: 'pixelated',
            }}
          />
        </div>

        {/* URL line */}
        <p
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: '.7rem',
            color: 'var(--muted)',
            textAlign: 'center',
            margin: '.75rem 0 0',
            wordBreak: 'break-all',
          }}
        >
          {`globaldjconnect.com/${slug}`}
        </p>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginTop: '1rem' }}>
          <button
            type="button"
            onClick={download}
            style={{ ...actionBtn, background: 'var(--neon)', color: 'var(--black)' }}
          >
            Download PNG
          </button>
          <button
            type="button"
            onClick={copyLink}
            style={{
              ...actionBtn,
              background: copied ? 'var(--success)' : 'transparent',
              color: copied ? 'var(--black)' : 'var(--white)',
              border: `1px solid ${copied ? 'var(--success)' : 'var(--border)'}`,
            }}
          >
            {copied ? '✓ Link Copied' : 'Copy Profile Link'}
          </button>
        </div>

        <p className={styles.bodyHint} style={{ marginTop: '.9rem' }}>
          Tip: use <strong>Classic</strong> (black on white) for anything
          printed — it scans more reliably in poor lighting.
        </p>
      </div>
    </div>
  );
}
