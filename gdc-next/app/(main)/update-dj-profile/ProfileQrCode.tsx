'use client';

// ProfileQrCode — compact, premium share tool that lives right under the
// profile URL field on the General tab. Generates a scannable QR code that
// opens the DJ's PUBLIC profile (globaldjconnect.com/<slug>) so they can
// print it on flyers, cards, table tents, or drop it in an IG story.
//
// Everything is client-side (no server round-trip, no stored image): we build
// the QR module matrix with the `qrcode` package, paint it onto a canvas in
// the Global DJ Connect palette with a baked-in caption (name + URL), then
// export to PNG on demand.
//
// Two styles:
//   - Neon    — neon-teal on near-black. On-brand; best on screens.
//   - Classic — black on white. Max contrast; safest for print / bad scanners.
//
// The caption sits OUTSIDE the code (no center-logo knockout) so scanning is
// never compromised. The `slug` passed in is the LIVE slug field value, so the
// preview updates as the DJ edits their URL.

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

type QrStyle = 'neon' | 'classic';

const PROFILE_BASE = 'https://globaldjconnect.com';

const PALETTE: Record<QrStyle, { bg: string; fg: string; sub: string }> = {
  neon: { bg: '#0b0b16', fg: '#00e0a4', sub: '#8a8aa0' },
  classic: { bg: '#ffffff', fg: '#000000', sub: '#555555' },
};

// Paint the QR matrix + caption onto the canvas at print resolution.
//   encodeTarget — the path the QR actually ENCODES (the permanent profile ID
//     when available, so a printed code never breaks on a slug change).
//   slug — the human-readable slug shown as the caption for branding.
function paint(canvas: HTMLCanvasElement, encodeTarget: string, slug: string, djName: string, style: QrStyle) {
  const url = `${PROFILE_BASE}/${encodeTarget}`;
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const modCount = qr.modules.size;
  const bits = qr.modules.data; // row-major, 1 = dark
  const { bg, fg, sub } = PALETTE[style];

  const quiet = 4; // quiet-zone in modules (spec minimum)
  const gridMods = modCount + quiet * 2;
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

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = fg;
  for (let y = 0; y < modCount; y++) {
    for (let x = 0; x < modCount; x++) {
      if (bits[y * modCount + x]) {
        ctx.fillRect((quiet + x) * scale, (quiet + y) * scale, scale, scale);
      }
    }
  }

  ctx.textAlign = 'center';
  const cx = w / 2;
  if (name) {
    ctx.fillStyle = fg;
    ctx.font = `700 ${Math.round(scale * 3.4)}px 'DM Sans', system-ui, sans-serif`;
    ctx.fillText(name, cx, codePx + Math.round(scale * 4.6));
    ctx.fillStyle = sub;
    ctx.font = `${Math.round(scale * 2.3)}px 'Space Mono', ui-monospace, monospace`;
    ctx.fillText(`globaldjconnect.com/${slug}`, cx, codePx + Math.round(scale * 8.6));
  } else {
    ctx.fillStyle = sub;
    ctx.font = `${Math.round(scale * 2.3)}px 'Space Mono', ui-monospace, monospace`;
    ctx.fillText(`globaldjconnect.com/${slug}`, cx, codePx + Math.round(scale * 4.4));
  }
}

export default function ProfileQrCode({
  slug,
  djName,
  profileId,
}: {
  slug: string;
  djName?: string;
  /** The DJ's permanent account ID. When provided, the QR ENCODES the ID
   *  link (which never changes) so a printed code keeps resolving to the
   *  profile even after the DJ renames their slug. The pretty slug is still
   *  shown as the caption and used for the shareable "Copy Link" URL. */
  profileId?: string;
}) {
  const [style, setStyle] = useState<QrStyle>('neon');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const clean = (slug || '').trim();
  const pid = (profileId || '').trim();
  // What the QR encodes: permanent ID when we have it, else the slug.
  const encodeTarget = pid || clean;
  // What "Copy Link" shares: the pretty slug URL (falls back to the ID link).
  const url = clean ? `${PROFILE_BASE}/${clean}` : pid ? `${PROFILE_BASE}/${pid}` : '';

  useEffect(() => {
    if (!clean) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      paint(canvas, encodeTarget, clean, djName || '', style);
    } catch {
      /* leave canvas blank rather than crash the tab */
    }
  }, [clean, encodeTarget, djName, style]);

  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `globaldjconnect-${clean || 'profile'}-qr.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [clean]);

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

  const box: React.CSSProperties = {
    marginTop: '.85rem',
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: 'var(--deep)',
    padding: '.85rem',
  };
  const capLabel: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace",
    fontSize: '.58rem',
    letterSpacing: '.1em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
  };
  const pill: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace",
    fontSize: '.48rem',
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    fontWeight: 700,
    padding: '.15rem .4rem',
    borderRadius: 999,
    color: 'var(--black)',
    background: 'var(--neon)',
    marginLeft: '.5rem',
  };
  const seg = (active: boolean): React.CSSProperties => ({
    fontFamily: "'Space Mono', monospace",
    fontSize: '.55rem',
    letterSpacing: '.06em',
    textTransform: 'uppercase',
    padding: '.3rem .55rem',
    borderRadius: 5,
    border: `1px solid ${active ? 'var(--neon)' : 'var(--border)'}`,
    background: active ? 'var(--neon)' : 'transparent',
    color: active ? 'var(--black)' : 'var(--muted)',
    cursor: 'pointer',
    fontWeight: 700,
  });
  const act = (primary: boolean, done = false): React.CSSProperties => ({
    fontFamily: "'Space Mono', monospace",
    fontSize: '.6rem',
    letterSpacing: '.06em',
    textTransform: 'uppercase',
    padding: '.45rem .7rem',
    borderRadius: 5,
    cursor: 'pointer',
    fontWeight: 700,
    border: primary ? 'none' : `1px solid ${done ? 'var(--success)' : 'var(--border)'}`,
    background: done ? 'var(--success)' : primary ? 'var(--neon)' : 'transparent',
    color: done || primary ? 'var(--black)' : 'var(--white)',
  });

  return (
    <div style={box}>
      {/* Header row: label + Premium pill, style toggle on the right */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.7rem' }}>
        <span style={capLabel}>
          Profile QR Code<span style={pill}>Premium</span>
        </span>
        <div style={{ display: 'flex', gap: '.35rem' }}>
          <button type="button" style={seg(style === 'neon')} onClick={() => setStyle('neon')}>Neon</button>
          <button type="button" style={seg(style === 'classic')} onClick={() => setStyle('classic')}>Classic</button>
        </div>
      </div>

      {!clean ? (
        <p style={{ ...capLabel, textTransform: 'none', letterSpacing: 0, fontSize: '.72rem', margin: 0 }}>
          Enter your URL above to generate a scannable QR code for your profile.
        </p>
      ) : (
        <div style={{ display: 'flex', gap: '.9rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <canvas
            ref={canvasRef}
            style={{ width: 108, height: 'auto', borderRadius: 6, imageRendering: 'pixelated', flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 150 }}>
            <p style={{ ...capLabel, textTransform: 'none', letterSpacing: 0, fontSize: '.72rem', margin: '0 0 .6rem', lineHeight: 1.4 }}>
              Scans open your public profile. Print it on flyers or cards to
              drive bookings.
            </p>
            <div style={{ display: 'flex', gap: '.45rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={download} style={act(true)}>Download PNG</button>
              <button type="button" onClick={copyLink} style={act(false, copied)}>
                {copied ? '✓ Copied' : 'Copy Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
