'use client';

// MonthlyStory — club/bar DJ promo generator. Renders the DJ's upcoming
// profile bookings (this week or this month) into a shareable image on a
// <canvas>, with an optional logo, and downloads it as a PNG. Uses only the
// native Canvas API — no external dependency, no per-image cost.
//
// v1: fixed template + logo + range (7-day / month) + size (story / square).
// A full drag-and-edit editor is a later phase.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Minimal shape we need — UpcomingBooking (a superset) is assignable to this.
// Fields are optional so a wider booking type (string | null | undefined) fits.
type StoryBooking = {
  event_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  venue_name?: string | null;
  venue_address?: string | null;
  flyer_url?: string | null;
};

const SIZES = {
  story: { w: 1080, h: 1920, label: 'Story 9:16', maxRows: 7, listTop: 540, rowH: 178 },
  square: { w: 1080, h: 1080, label: 'Square 1:1', maxRows: 4, listTop: 430, rowH: 150 },
} as const;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function fmtTime(t: string | null): string {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ap}`;
}

function parseDate(d: string): Date {
  return new Date(`${d}T00:00:00`);
}

// Truncate text to a max pixel width for the given ctx font.
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

interface DrawData {
  headline: string;
  djName: string;
  logoImg: HTMLImageElement | null;
  rows: StoryBooking[];
  flyerImgs: (HTMLImageElement | null)[];
  moreCount: number;
  size: keyof typeof SIZES;
}

function drawStory(ctx: CanvasRenderingContext2D, w: number, h: number, d: DrawData) {
  const cfg = SIZES[d.size];
  const NEON = '#00e0a4';
  const pad = 70;

  // Background + top accent
  ctx.fillStyle = '#0b0b14';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = NEON;
  ctx.fillRect(0, 0, w, 10);

  // ── Header ─────────────────────────────────────────────
  let y = 80;
  if (d.logoImg) {
    const lh = d.size === 'story' ? 170 : 120;
    const lw = Math.min(w - 2 * pad, d.logoImg.width * (lh / d.logoImg.height));
    ctx.drawImage(d.logoImg, (w - lw) / 2, y, lw, lh);
    y += lh + 28;
  } else {
    y += 24;
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = NEON;
  ctx.font = `800 ${d.size === 'story' ? 88 : 72}px Arial, sans-serif`;
  ctx.fillText(d.headline, w / 2, y + 60);
  y += d.size === 'story' ? 108 : 92;

  if (d.djName) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 40px Arial, sans-serif';
    ctx.fillText(d.djName.toUpperCase(), w / 2, y + 28);
    y += 60;
  }

  // ── List ───────────────────────────────────────────────
  const listTop = cfg.listTop;
  const rowH = cfg.rowH;
  ctx.textAlign = 'left';

  d.rows.forEach((b, i) => {
    const ry = listTop + i * rowH;
    // Row divider
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad, ry);
    ctx.lineTo(w - pad, ry);
    ctx.stroke();

    const cy = ry + rowH / 2;
    // Date block (left)
    const dt = b.event_date ? parseDate(b.event_date) : null;
    if (dt) {
      ctx.textAlign = 'center';
      ctx.fillStyle = NEON;
      ctx.font = '700 30px Arial, sans-serif';
      ctx.fillText(DOW[dt.getDay()], pad + 55, cy - 34);
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 66px Arial, sans-serif';
      ctx.fillText(String(dt.getDate()), pad + 55, cy + 24);
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.font = '600 26px Arial, sans-serif';
      ctx.fillText(MONTHS[dt.getMonth()].slice(0, 3).toUpperCase(), pad + 55, cy + 58);
    }

    // Flyer thumbnail (right)
    const thumb = d.size === 'story' ? 130 : 108;
    const flyer = d.flyerImgs[i];
    const textRight = w - pad - (flyer ? thumb + 30 : 0);
    if (flyer) {
      const tx = w - pad - thumb;
      const ty = cy - thumb / 2;
      // cover-fit crop
      const s = Math.max(thumb / flyer.width, thumb / flyer.height);
      const sw = thumb / s;
      const sh = thumb / s;
      ctx.save();
      ctx.beginPath();
      ctx.rect(tx, ty, thumb, thumb);
      ctx.clip();
      ctx.drawImage(flyer, (flyer.width - sw) / 2, (flyer.height - sh) / 2, sw, sh, tx, ty, thumb, thumb);
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,224,164,.6)';
      ctx.lineWidth = 3;
      ctx.strokeRect(tx, ty, thumb, thumb);
    }

    // Venue / time / address (middle)
    const mx = pad + 160;
    const mw = textRight - mx - 20;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 44px Arial, sans-serif';
    ctx.fillText(ellipsize(ctx, b.venue_name || 'Venue TBA', mw), mx, cy - 24);

    ctx.fillStyle = NEON;
    ctx.font = '600 32px Arial, sans-serif';
    const times = [fmtTime(b.start_time), fmtTime(b.end_time)].filter(Boolean).join(' – ');
    if (times) ctx.fillText(times, mx, cy + 18);

    if (b.venue_address) {
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.font = '400 28px Arial, sans-serif';
      ctx.fillText(ellipsize(ctx, b.venue_address, mw), mx, cy + 56);
    }
  });

  // bottom divider under last row
  const lastY = listTop + d.rows.length * rowH;
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, lastY);
  ctx.lineTo(w - pad, lastY);
  ctx.stroke();

  // ── Footer ─────────────────────────────────────────────
  ctx.textAlign = 'center';
  if (d.moreCount > 0) {
    ctx.fillStyle = NEON;
    ctx.font = '600 32px Arial, sans-serif';
    ctx.fillText(`+ ${d.moreCount} more date${d.moreCount === 1 ? '' : 's'}`, w / 2, h - 110);
  }
  if (d.rows.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = '400 36px Arial, sans-serif';
    ctx.fillText('No dates in this range yet.', w / 2, listTop + 80);
  }
  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.font = '400 30px Arial, sans-serif';
  ctx.fillText('globaldjconnect.com', w / 2, h - 55);
}

export default function MonthlyStory({
  bookings, djName, userId, onClose,
}: {
  bookings: StoryBooking[];
  djName: string;
  userId: string;
  onClose: () => void;
}) {
  const [range, setRange] = useState<'7day' | 'month'>('month');
  const [size, setSize] = useState<keyof typeof SIZES>('story');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logoInput = useRef<HTMLInputElement | null>(null);

  const now = useMemo(() => new Date(), []);

  const items = useMemo(() => {
    const valid = bookings.filter((b) => b.event_date);
    const sortKey = (b: StoryBooking) => `${b.event_date}${b.start_time || ''}`;
    if (range === '7day') {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 7);
      return valid
        .filter((b) => { const d = parseDate(b.event_date as string); return d >= start && d < end; })
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    }
    const m = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    return valid
      .filter((b) => { const d = parseDate(b.event_date as string); return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth(); })
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }, [bookings, range, monthOffset, now]);

  const headline = useMemo(() => {
    if (range === '7day') return 'THIS WEEK';
    const m = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    return `${MONTHS[m.getMonth()].toUpperCase()} ${m.getFullYear()}`;
  }, [range, monthOffset, now]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const cfg = SIZES[size];
      canvas.width = cfg.w;
      canvas.height = cfg.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const logoImg = logoUrl ? await loadImage(logoUrl) : null;
      const rows = items.slice(0, cfg.maxRows);
      const flyerImgs = await Promise.all(rows.map((b) => (b.flyer_url ? loadImage(b.flyer_url) : Promise.resolve(null))));
      if (cancelled) return;
      drawStory(ctx, cfg.w, cfg.h, {
        headline, djName, logoImg, rows, flyerImgs,
        moreCount: Math.max(0, items.length - rows.length), size,
      });
    })();
    return () => { cancelled = true; };
  }, [items, size, logoUrl, headline, djName]);

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${userId}/story_logo_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (!error) {
        const { data } = supabase.storage.from('avatars').getPublicUrl(path);
        setLogoUrl(`${data.publicUrl}?t=${Date.now()}`);
      }
    } catch { /* ignore */ }
    finally { setBusy(false); }
  }

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gdc-schedule-${range}-${size}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }, 'image/png');
    } catch { /* canvas may be tainted if a flyer host blocks CORS */ }
  }

  const btn = (active: boolean): React.CSSProperties => ({
    padding: '.5rem 1rem', borderRadius: 8, cursor: 'pointer', fontSize: '.82rem', fontWeight: 700,
    border: `1px solid ${active ? 'var(--neon,#00e0a4)' : 'rgba(255,255,255,.25)'}`,
    background: active ? 'var(--neon,#00e0a4)' : 'transparent',
    color: active ? '#06231b' : 'var(--white,#fff)',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, width: '100%', maxWidth: 860, maxHeight: '92vh', overflow: 'auto', padding: '1.1rem 1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <strong style={{ color: 'var(--white,#fff)', fontSize: '1.05rem' }}>Create Schedule Graphic</strong>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted,#888)', fontSize: 22, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          {/* Controls */}
          <div style={{ flex: '1 1 240px', minWidth: 220, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Range</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={btn(range === '7day')} onClick={() => setRange('7day')}>Next 7 days</button>
                <button type="button" style={btn(range === 'month')} onClick={() => setRange('month')}>This month</button>
              </div>
              {range === 'month' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <button type="button" style={btn(false)} onClick={() => setMonthOffset((n) => n - 1)}>←</button>
                  <span style={{ color: 'var(--white,#fff)', fontSize: '.85rem', fontWeight: 600 }}>{headline}</span>
                  <button type="button" style={btn(false)} onClick={() => setMonthOffset((n) => n + 1)}>→</button>
                </div>
              )}
            </div>

            <div>
              <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Size</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={btn(size === 'story')} onClick={() => setSize('story')}>{SIZES.story.label}</button>
                <button type="button" style={btn(size === 'square')} onClick={() => setSize('square')}>{SIZES.square.label}</button>
              </div>
            </div>

            <div>
              <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Logo</div>
              <button type="button" style={btn(false)} disabled={busy} onClick={() => logoInput.current?.click()}>{busy ? 'Uploading…' : logoUrl ? 'Change logo' : 'Add logo'}</button>
              {logoUrl && <button type="button" style={{ ...btn(false), marginLeft: 8, borderColor: 'rgba(255,120,120,.5)', color: '#ff8a8a' }} onClick={() => setLogoUrl(null)}>Remove</button>}
              <input ref={logoInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={onLogo} />
            </div>

            <button type="button" onClick={download} style={{ ...btn(true), padding: '.7rem 1rem', fontSize: '.9rem' }}>Download PNG</button>
            <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.72rem', lineHeight: 1.5 }}>
              Shows the gigs on your public profile for the selected range. Busy months show the first {SIZES[size].maxRows} and a “+ more” note (full editing coming later).
            </div>
          </div>

          {/* Preview */}
          <div style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
            <canvas
              ref={canvasRef}
              style={{ width: size === 'story' ? 220 : 300, height: 'auto', borderRadius: 10, boxShadow: '0 4px 24px rgba(0,0,0,.5)', background: '#0b0b14' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
