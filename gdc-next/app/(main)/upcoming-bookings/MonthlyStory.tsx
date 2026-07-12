'use client';

// MonthlyStory — club/bar DJ promo generator. Renders the DJ's upcoming
// profile bookings (this week or this month) into a shareable image on a
// <canvas>, and downloads it as a PNG. Native Canvas API only — no external
// dependency, no per-image cost.
//
// Customizable: background theme OR a custom background image, and sliders to
// resize the background image, the logo, and the text.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Minimal shape we need — UpcomingBooking (a superset) is assignable to this.
type StoryBooking = {
  event_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  venue_name?: string | null;
  venue_address?: string | null;
  flyer_url?: string | null;
};

const SIZES = {
  story: { w: 1080, h: 1920, label: 'Story 9:16', maxRows: 5, listTop: 470, rowH: 262 },
  square: { w: 1080, h: 1080, label: 'Square 1:1', maxRows: 3, listTop: 385, rowH: 190 },
} as const;

const THEMES: Record<string, [string, string, string]> = {
  Teal: ['#141433', '#0b0b16', '#08201c'],
  Purple: ['#2a1240', '#150a24', '#0a0a16'],
  Crimson: ['#2a0d18', '#170a12', '#0a0a10'],
  Ink: ['#111119', '#0b0b12', '#08080d'],
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const NEON = '#00e0a4';

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function fmtTime(t: string | null | undefined): string {
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

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

interface DrawData {
  headline: string;
  djName: string;
  logoImg: HTMLImageElement | null;
  bgImg: HTMLImageElement | null;
  bgColor: string | null;
  themeStops: [string, string, string];
  bgScale: number;
  bgOffsetX: number;
  bgOffsetY: number;
  logoScale: number;
  textScale: number;
  rows: StoryBooking[];
  flyerImgs: (HTMLImageElement | null)[];
  moreCount: number;
  size: keyof typeof SIZES;
  footerUrl: string;
  showUrl: boolean;
}

function drawStory(ctx: CanvasRenderingContext2D, w: number, h: number, d: DrawData) {
  const cfg = SIZES[d.size];
  const pad = 55;
  const story = d.size === 'story';
  const T = (px: number) => Math.round(px * d.textScale); // scale readable text

  // ── Background ─────────────────────────────────────────
  if (d.bgImg) {
    const base = Math.max(w / d.bgImg.width, h / d.bgImg.height);
    const s = base * d.bgScale;
    const dw = d.bgImg.width * s;
    const dh = d.bgImg.height * s;
    const ox = (w - dw) / 2 + (d.bgOffsetX * (dw - w)) / 2;
    const oy = (h - dh) / 2 + (d.bgOffsetY * (dh - h)) / 2;
    ctx.drawImage(d.bgImg, ox, oy, dw, dh);
    ctx.fillStyle = 'rgba(8,8,18,0.62)'; // readability overlay
    ctx.fillRect(0, 0, w, h);
  } else if (d.bgColor) {
    ctx.fillStyle = d.bgColor;
    ctx.fillRect(0, 0, w, h);
  } else {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, d.themeStops[0]);
    bg.addColorStop(0.55, d.themeStops[1]);
    bg.addColorStop(1, d.themeStops[2]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  const glow = ctx.createRadialGradient(w / 2, h * 0.14, 0, w / 2, h * 0.14, w * 0.85);
  glow.addColorStop(0, 'rgba(0,224,164,0.20)');
  glow.addColorStop(1, 'rgba(0,224,164,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = NEON;
  ctx.fillRect(0, 0, w, 12);

  // ── Header ─────────────────────────────────────────────
  ctx.textAlign = 'center';
  let y = 80;
  if (d.logoImg) {
    const lh = (story ? 150 : 110) * d.logoScale;
    const lw = Math.min(w - 2 * pad, d.logoImg.width * (lh / d.logoImg.height));
    ctx.drawImage(d.logoImg, (w - lw) / 2, y, lw, lh);
    y += lh + 30;
  } else {
    y += 20;
  }

  ctx.save();
  ctx.shadowColor = 'rgba(0,224,164,0.7)';
  ctx.shadowBlur = story ? 45 : 34;
  ctx.fillStyle = NEON;
  ctx.font = `800 ${T(story ? 92 : 74)}px Arial, sans-serif`;
  ctx.fillText(d.headline, w / 2, y + (story ? 72 : 60));
  ctx.restore();
  y += story ? 112 : 92;

  if (d.djName) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${T(story ? 40 : 34)}px Arial, sans-serif`;
    ctx.fillText(d.djName.toUpperCase(), w / 2, y + 24);
    y += 54;
  }

  // ── Gig cards ──────────────────────────────────────────
  const listTop = cfg.listTop;
  const rowH = cfg.rowH;
  const gap = 22;
  const cardH = rowH - gap;

  d.rows.forEach((b, i) => {
    const ry = listTop + i * rowH;
    const cy = ry + cardH / 2;

    roundRect(ctx, pad, ry, w - 2 * pad, cardH, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const badgeW = 140;
    const badgeH = cardH - 56;
    const bx = pad + 26;
    const by = cy - badgeH / 2;
    roundRect(ctx, bx, by, badgeW, badgeH, 20);
    ctx.fillStyle = 'rgba(0,224,164,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,224,164,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const dt = b.event_date ? parseDate(b.event_date) : null;
    if (dt) {
      const bcx = bx + badgeW / 2;
      ctx.textAlign = 'center';
      ctx.fillStyle = NEON;
      ctx.font = `700 ${Math.round(badgeH * 0.19)}px Arial, sans-serif`;
      ctx.fillText(DOW[dt.getDay()], bcx, cy - badgeH * 0.24);
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 ${Math.round(badgeH * 0.42)}px Arial, sans-serif`;
      ctx.fillText(String(dt.getDate()), bcx, cy + badgeH * 0.13);
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.font = `600 ${Math.round(badgeH * 0.16)}px Arial, sans-serif`;
      ctx.fillText(MONTHS[dt.getMonth()].slice(0, 3).toUpperCase(), bcx, cy + badgeH * 0.40);
    }

    const thumb = cardH - 68;
    const flyer = d.flyerImgs[i];
    const textRight = w - pad - 26 - (flyer ? thumb + 28 : 0);
    if (flyer) {
      const tx = w - pad - 26 - thumb;
      const ty = cy - thumb / 2;
      const s = Math.max(thumb / flyer.width, thumb / flyer.height);
      const sw = thumb / s;
      const sh = thumb / s;
      ctx.save();
      roundRect(ctx, tx, ty, thumb, thumb, 14);
      ctx.clip();
      ctx.drawImage(flyer, (flyer.width - sw) / 2, (flyer.height - sh) / 2, sw, sh, tx, ty, thumb, thumb);
      ctx.restore();
      roundRect(ctx, tx, ty, thumb, thumb, 14);
      ctx.strokeStyle = 'rgba(0,224,164,.6)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    const mx = bx + badgeW + 28;
    const mw = Math.max(80, textRight - mx - 14);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${T(44)}px Arial, sans-serif`;
    ctx.fillText(ellipsize(ctx, b.venue_name || 'Venue TBA', mw), mx, cy - 24);

    ctx.fillStyle = NEON;
    ctx.font = `600 ${T(32)}px Arial, sans-serif`;
    const times = [fmtTime(b.start_time), fmtTime(b.end_time)].filter(Boolean).join(' – ');
    if (times) ctx.fillText(times, mx, cy + 18);

    if (b.venue_address) {
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.font = `400 ${T(28)}px Arial, sans-serif`;
      ctx.fillText(ellipsize(ctx, b.venue_address, mw), mx, cy + 56);
    }
  });

  // ── More / empty / footer ──────────────────────────────
  ctx.textAlign = 'center';
  if (d.rows.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = '400 36px Arial, sans-serif';
    ctx.fillText('No dates in this range yet.', w / 2, listTop + 80);
  }
  if (d.moreCount > 0) {
    const afterList = listTop + d.rows.length * rowH;
    ctx.fillStyle = NEON;
    ctx.font = '600 34px Arial, sans-serif';
    ctx.fillText(`+ ${d.moreCount} more date${d.moreCount === 1 ? '' : 's'}`, w / 2, Math.min(afterList + 44, h - 130));
  }
  if (d.showUrl && d.footerUrl) {
    ctx.strokeStyle = 'rgba(0,224,164,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, h - 92);
    ctx.lineTo(w - 80, h - 92);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '600 32px Arial, sans-serif';
    ctx.fillText(d.footerUrl, w / 2, h - 48);
  }
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
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState<string | null>(null);
  const [theme, setTheme] = useState<string>('Teal');
  const [bgScale, setBgScale] = useState(1);
  const [bgOffsetX, setBgOffsetX] = useState(0);
  const [bgOffsetY, setBgOffsetY] = useState(0);
  const [logoScale, setLogoScale] = useState(1);
  const [textScale, setTextScale] = useState(1);
  const [monthOffset, setMonthOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [djSlug, setDjSlug] = useState<string>('');
  const [showUrl, setShowUrl] = useState(true);
  const [saveLogo, setSaveLogo] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logoInput = useRef<HTMLInputElement | null>(null);
  const bgInput = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const settingsRef = useRef<Record<string, unknown>>({});

  // Load the DJ's slug (for the footer URL) + any previously-saved story logo.
  useEffect(() => {
    let a = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.from('users').select('slug, booking_settings').eq('id', userId).maybeSingle();
        const row = data as { slug?: string | null; booking_settings?: string | null } | null;
        if (!a) return;
        if (row?.slug) setDjSlug(row.slug);
        const raw = row?.booking_settings;
        const bs = (typeof raw === 'string' ? JSON.parse(raw) : (raw || {})) as Record<string, unknown>;
        settingsRef.current = bs;
        const saved = bs.story_logo_url;
        if (typeof saved === 'string' && saved) { setLogoUrl(saved); setSaveLogo(true); }
      } catch { /* ignore */ }
    })();
    return () => { a = false; };
  }, [userId]);

  const footerUrl = djSlug ? `globaldjconnect.com/${djSlug}` : 'globaldjconnect.com';

  // Persist (or clear) the story logo in booking_settings for reuse next time.
  async function persistLogo(url: string | null) {
    try {
      const supabase = createClient();
      const next = { ...settingsRef.current } as Record<string, unknown>;
      if (url) next.story_logo_url = url; else delete next.story_logo_url;
      settingsRef.current = next;
      await supabase.from('users').update({ booking_settings: JSON.stringify(next) } as never).eq('id', userId);
    } catch { /* ignore */ }
  }

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

  // Cached images — loaded only when their URLs change, so dragging sliders or
  // the background doesn't re-fetch anything (that's what made it laggy).
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);
  const [flyerImgs, setFlyerImgs] = useState<(HTMLImageElement | null)[]>([]);
  const rows = useMemo(() => items.slice(0, SIZES[size].maxRows), [items, size]);
  const flyerKey = rows.map((b) => b.flyer_url || '').join('|');

  useEffect(() => { let a = true; (async () => { const img = logoUrl ? await loadImage(logoUrl) : null; if (a) setLogoImg(img); })(); return () => { a = false; }; }, [logoUrl]);
  useEffect(() => { let a = true; (async () => { const img = bgUrl ? await loadImage(bgUrl) : null; if (a) setBgImg(img); })(); return () => { a = false; }; }, [bgUrl]);
  useEffect(() => {
    let a = true;
    (async () => { const imgs = await Promise.all(rows.map((b) => (b.flyer_url ? loadImage(b.flyer_url) : Promise.resolve(null)))); if (a) setFlyerImgs(imgs); })();
    return () => { a = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyerKey]);

  // Draw — synchronous, uses cached images. Fast, so sliders/drag glide.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cfg = SIZES[size];
    canvas.width = cfg.w;
    canvas.height = cfg.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawStory(ctx, cfg.w, cfg.h, {
      headline, djName, logoImg, bgImg, bgColor,
      themeStops: THEMES[theme] || THEMES.Teal,
      bgScale, bgOffsetX, bgOffsetY, logoScale, textScale,
      rows, flyerImgs,
      moreCount: Math.max(0, items.length - rows.length), size,
      footerUrl, showUrl,
    });
  }, [rows, flyerImgs, items.length, size, logoImg, bgImg, bgColor, theme, bgScale, bgOffsetX, bgOffsetY, logoScale, textScale, headline, djName, footerUrl, showUrl]);

  async function uploadTo(file: File, prefix: string): Promise<string | null> {
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${userId}/${prefix}_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (error) return null;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      return `${data.publicUrl}?t=${Date.now()}`;
    } catch { return null; }
  }

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    setBusy(true);
    const url = await uploadTo(file, 'story_logo');
    if (url) { setLogoUrl(url); if (saveLogo) persistLogo(url); }
    setBusy(false);
  }

  async function onBg(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    setBusy(true);
    const url = await uploadTo(file, 'story_bg');
    if (url) setBgUrl(url);
    setBusy(false);
  }

  // Drag the preview to reposition the background image (only when one is set).
  function onDragStart(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!bgUrl) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onDragMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current || !bgUrl) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    setBgOffsetX((o) => clamp(o + (dx / rect.width) * 2));
    setBgOffsetY((o) => clamp(o + (dy / rect.height) * 2));
  }
  function onDragEnd() {
    dragRef.current = null;
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
    } catch { /* canvas may be tainted if an image host blocks CORS */ }
  }

  const btn = (active: boolean): React.CSSProperties => ({
    padding: '.45rem .9rem', borderRadius: 8, cursor: 'pointer', fontSize: '.8rem', fontWeight: 700,
    border: `1px solid ${active ? 'var(--neon,#00e0a4)' : 'rgba(255,255,255,.25)'}`,
    background: active ? 'var(--neon,#00e0a4)' : 'transparent',
    color: active ? '#06231b' : 'var(--white,#fff)',
  });
  const label: React.CSSProperties = { color: 'var(--muted,#8a8aa0)', fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 };

  function Slider({ text, value, min, max, step, onChange, display }: { text: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display?: (v: number) => string }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: 'var(--muted,#9a9ab0)', fontSize: '.72rem', width: 96, flexShrink: 0 }}>{text}</span>
        <input type="range" className="gdc-range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
        <span style={{ color: 'var(--white,#fff)', fontSize: '.68rem', width: 40, textAlign: 'right', flexShrink: 0 }}>{display ? display(value) : `${Math.round(value * 100)}%`}</span>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{`
        .gdc-range { -webkit-appearance:none; appearance:none; width:120px; flex:none; height:4px; border-radius:99px; background:rgba(255,255,255,.16); outline:none; cursor:pointer; }
        .gdc-range::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:15px; height:15px; border-radius:50%; background:#00e0a4; border:none; cursor:pointer; box-shadow:0 0 0 3px rgba(0,224,164,.2); }
        .gdc-range::-moz-range-thumb { width:15px; height:15px; border-radius:50%; background:#00e0a4; border:none; cursor:pointer; }
      `}</style>
      <div style={{ background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, width: '100%', maxWidth: 900, maxHeight: '92vh', overflow: 'auto', padding: '1.1rem 1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <strong style={{ color: 'var(--white,#fff)', fontSize: '1.05rem' }}>Create Schedule Graphic</strong>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted,#888)', fontSize: 22, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
            <div>
              <div style={label}>Range</div>
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
              <div style={label}>Size</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={btn(size === 'story')} onClick={() => setSize('story')}>{SIZES.story.label}</button>
                <button type="button" style={btn(size === 'square')} onClick={() => setSize('square')}>{SIZES.square.label}</button>
              </div>
            </div>

            <div>
              <div style={label}>Background</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {Object.keys(THEMES).map((t) => (
                  <button key={t} type="button" style={btn(!bgUrl && !bgColor && theme === t)} onClick={() => { setBgUrl(null); setBgColor(null); setTheme(t); }}>{t}</button>
                ))}
                <label style={{ ...btn(!bgUrl && !!bgColor), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  Color
                  <input type="color" value={bgColor || '#0b0b16'} onChange={(e) => { setBgUrl(null); setBgColor(e.target.value); }} style={{ width: 22, height: 22, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }} />
                </label>
                <button type="button" style={btn(!!bgUrl)} disabled={busy} onClick={() => bgInput.current?.click()}>{busy ? '…' : bgUrl ? 'Image ✓' : 'Upload image'}</button>
                {bgUrl && <button type="button" style={{ ...btn(false), color: '#ff8a8a', borderColor: 'rgba(255,120,120,.5)' }} onClick={() => setBgUrl(null)}>Remove</button>}
              </div>
              <input ref={bgInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={onBg} />
            </div>

            <div>
              <div style={label}>Logo</div>
              <button type="button" style={btn(false)} disabled={busy} onClick={() => logoInput.current?.click()}>{busy ? '…' : logoUrl ? 'Change logo' : 'Add logo'}</button>
              {logoUrl && <button type="button" style={{ ...btn(false), marginLeft: 8, color: '#ff8a8a', borderColor: 'rgba(255,120,120,.5)' }} onClick={() => { setLogoUrl(null); if (saveLogo) { setSaveLogo(false); persistLogo(null); } }}>Remove</button>}
              <input ref={logoInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={onLogo} />
              {logoUrl && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: 'var(--muted,#9a9ab0)', fontSize: '.74rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={saveLogo} onChange={(e) => { const on = e.target.checked; setSaveLogo(on); persistLogo(on ? logoUrl : null); }} style={{ accentColor: '#00e0a4' }} />
                  Save this logo for future graphics
                </label>
              )}
            </div>

            <div>
              <div style={label}>Link</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--white,#fff)', fontSize: '.78rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={showUrl} onChange={(e) => setShowUrl(e.target.checked)} style={{ accentColor: '#00e0a4' }} />
                Show {footerUrl}
              </label>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '.7rem', borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: '.8rem' }}>
              {bgUrl && <Slider text="Background size" value={bgScale} min={0.7} max={2.5} step={0.05} onChange={setBgScale} />}
              {logoUrl && <Slider text="Logo size" value={logoScale} min={0.5} max={2} step={0.05} onChange={setLogoScale} />}
              <Slider text="Text size" value={textScale} min={0.85} max={1.25} step={0.02} onChange={setTextScale} />
            </div>
          </div>

          <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative', lineHeight: 0 }}>
              <canvas
                ref={canvasRef}
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerLeave={onDragEnd}
                style={{ width: size === 'story' ? 240 : 330, height: 'auto', borderRadius: 10, boxShadow: '0 4px 24px rgba(0,0,0,.5)', background: '#0b0b14', cursor: bgUrl ? 'grab' : 'default', touchAction: bgUrl ? 'none' : 'auto', display: 'block' }}
              />
              {bgUrl && (
                <div style={{ position: 'absolute', top: 8, left: 8, width: 30, height: 30, borderRadius: '50%', background: 'rgba(0,0,0,.6)', color: '#00e0a4', fontSize: '.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', border: '1px solid rgba(0,224,164,.6)' }}>✥</div>
              )}
            </div>
            <button type="button" onClick={download} style={{ ...btn(true), padding: '.7rem 1.4rem', fontSize: '.9rem', width: '100%', maxWidth: size === 'story' ? 240 : 330 }}>Download PNG</button>
          </div>
        </div>
      </div>
    </div>
  );
}
