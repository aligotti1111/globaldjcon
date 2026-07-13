'use client';

// MonthlyStory — club/bar DJ promo generator. Renders the DJ's upcoming
// profile bookings (this week or this month) into a shareable image on a
// <canvas>, and downloads it as a PNG. Native Canvas API only — no external
// dependency, no per-image cost.
//
// Customizable: background theme OR a custom background image, and sliders to
// resize the background image, the logo, and the text.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  story: { w: 1080, h: 1920, label: 'Story 9:16', maxRows: 9, listTop: 440, rowH: 156 },
  square: { w: 1080, h: 1080, label: 'Square 1:1', maxRows: 5, listTop: 345, rowH: 118 },
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
  layoutCount: number; // rows to SIZE for (keeps every page's cards the same size)
  pageIndex: number;
  pageCount: number;
  size: keyof typeof SIZES;
  footerUrl: string;
  showUrl: boolean;
  headlineColor: string;
  accentColor: string;
  textColor: string;
}

// Convert a #rgb / #rrggbb hex to an rgba() string; falls back to neon if invalid.
function hexToRgba(hex: string, a: number): string {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return `rgba(0,224,164,${a})`;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawStory(ctx: CanvasRenderingContext2D, w: number, h: number, d: DrawData) {
  const cfg = SIZES[d.size];
  const pad = 55;
  const story = d.size === 'story';
  const T = (px: number) => Math.round(px * d.textScale); // scale readable text

  // ── Background ─────────────────────────────────────────
  // Base layer: chosen color, else theme gradient, else a neutral dark base under a photo.
  if (d.bgColor) {
    ctx.fillStyle = d.bgColor;
    ctx.fillRect(0, 0, w, h);
  } else if (d.bgImg) {
    ctx.fillStyle = '#0b0b14';
    ctx.fillRect(0, 0, w, h);
  } else {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, d.themeStops[0]);
    bg.addColorStop(0.55, d.themeStops[1]);
    bg.addColorStop(1, d.themeStops[2]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  // Image drawn ON TOP of the base — a transparent PNG lets the color show through.
  if (d.bgImg) {
    const base = Math.max(w / d.bgImg.width, h / d.bgImg.height);
    const s = base * d.bgScale;
    const dw = d.bgImg.width * s;
    const dh = d.bgImg.height * s;
    const ox = (w - dw) / 2 + (d.bgOffsetX * (dw - w)) / 2;
    const oy = (h - dh) / 2 + (d.bgOffsetY * (dh - h)) / 2;
    ctx.drawImage(d.bgImg, ox, oy, dw, dh);
    // Darken for text readability only in pure-photo mode; respect an explicit color choice.
    if (!d.bgColor) {
      ctx.fillStyle = 'rgba(8,8,18,0.55)';
      ctx.fillRect(0, 0, w, h);
    }
  }
  const accent = d.accentColor || NEON;
  const glow = ctx.createRadialGradient(w / 2, h * 0.14, 0, w / 2, h * 0.14, w * 0.85);
  glow.addColorStop(0, hexToRgba(accent, 0.20));
  glow.addColorStop(1, hexToRgba(accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
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
  ctx.shadowColor = hexToRgba(d.headlineColor || accent, 0.7);
  ctx.shadowBlur = story ? 45 : 34;
  ctx.fillStyle = d.headlineColor || accent;
  ctx.font = `800 ${T(story ? 92 : 74)}px Arial, sans-serif`;
  ctx.fillText(d.headline, w / 2, y + (story ? 72 : 60));
  ctx.restore();
  y += story ? 112 : 92;

  // Show the DJ name only when there's no logo (otherwise it's redundant).
  if (d.djName && !d.logoImg) {
    ctx.fillStyle = d.textColor || '#ffffff';
    ctx.font = `600 ${T(story ? 40 : 34)}px Arial, sans-serif`;
    ctx.fillText(d.djName.toUpperCase(), w / 2, y + 24);
    y += 54;
  }

  // ── Gig cards: auto-size (fewer = bigger) + center the group under the header ──
  const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const count = d.rows.length;
  // Size cards for the FULLEST page so every page in a multi-page set matches.
  const sizeCount = Math.max(1, d.layoutCount || count);
  const regionTop = Math.max(cfg.listTop - 130, y + (story ? 36 : 24));
  const regionBottom = h - (story ? 150 : 128);
  const region = Math.max(160, regionBottom - regionTop);
  const cardGap = story ? 30 : 22;
  const maxCardH = story ? 320 : 210;
  const minCardH = story ? 118 : 90;
  const cardH = clampN(region / sizeCount - cardGap, minCardH, maxCardH);
  const groupH = cardH * count + cardGap * Math.max(0, count - 1);
  const groupTop = regionTop + Math.max(0, (region - groupH) * 0.44); // center group, slight upward bias

  const sideM = story ? pad : Math.round(w * 0.095); // narrower cards on the square

  d.rows.forEach((b, i) => {
    const ry = groupTop + i * (cardH + cardGap);
    const cy = ry + cardH / 2;

    roundRect(ctx, sideM, ry, w - 2 * sideM, cardH, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const badgeW = 140;
    const badgeH = Math.min(cardH - 34, 190);
    const bx = sideM + 26;
    const by = cy - badgeH / 2;
    roundRect(ctx, bx, by, badgeW, badgeH, 20);
    ctx.fillStyle = hexToRgba(accent, 0.12);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(accent, 0.6);
    ctx.lineWidth = 2;
    ctx.stroke();

    const dt = b.event_date ? parseDate(b.event_date) : null;
    if (dt) {
      const bcx = bx + badgeW / 2;
      ctx.textAlign = 'center';
      ctx.fillStyle = accent;
      ctx.font = `700 ${Math.round(badgeH * 0.19)}px Arial, sans-serif`;
      ctx.fillText(DOW[dt.getDay()], bcx, cy - badgeH * 0.24);
      ctx.fillStyle = d.textColor || '#ffffff';
      ctx.font = `800 ${Math.round(badgeH * 0.42)}px Arial, sans-serif`;
      ctx.fillText(String(dt.getDate()), bcx, cy + badgeH * 0.13);
      ctx.fillStyle = hexToRgba(d.textColor === '#ffffff' || !d.textColor ? '#ffffff' : d.textColor, 0.75);
      ctx.font = `600 ${Math.round(badgeH * 0.16)}px Arial, sans-serif`;
      ctx.fillText(MONTHS[dt.getMonth()].slice(0, 3).toUpperCase(), bcx, cy + badgeH * 0.40);
    }

    const textRight = w - sideM - 26;
    const mx = bx + badgeW + 28;
    const mw = Math.max(80, textRight - mx - 12);
    const vFont = T(clampN(cardH * 0.26, 26, 60));
    const tFont = T(clampN(cardH * 0.20, 22, 44));
    let aFont = T(clampN(cardH * 0.16, 19, 30));
    ctx.textAlign = 'left';

    const venue = ellipsize(ctx, b.venue_name || 'Venue TBA', mw);
    const times = [fmtTime(b.start_time), fmtTime(b.end_time)].filter(Boolean).join(' – ');
    // shrink the address so the whole thing (incl. ZIP) fits on one line — never truncate
    if (b.venue_address) {
      ctx.font = `400 ${Math.round(aFont)}px Arial, sans-serif`;
      const aw = ctx.measureText(b.venue_address).width;
      if (aw > mw) aFont = Math.max(15, Math.floor(aFont * (mw / aw)));
    }

    // Stack the lines with an EQUAL visual gap between each (bottom-of-line to
    // top-of-next), then center the whole block in the card.
    const cap = (f: number) => f * 0.72;   // glyph height above baseline
    const desc = (f: number) => f * 0.06;  // small descender below baseline
    const lineGap = Math.max(8, Math.round(cardH * 0.05)); // same gap between every line
    const txtCol = d.textColor || '#ffffff';
    const stack: { txt: string; f: number; weight: number; color: string }[] = [
      { txt: venue, f: vFont, weight: 700, color: txtCol },
    ];
    if (times) stack.push({ txt: times, f: tFont, weight: 600, color: accent });
    if (b.venue_address) stack.push({ txt: b.venue_address, f: aFont, weight: 400, color: hexToRgba(txtCol, 0.6) });

    let blockH = lineGap * (stack.length - 1);
    for (const s of stack) blockH += cap(s.f) + desc(s.f);
    let topY = cy - blockH / 2;

    ctx.textAlign = 'left';
    for (const s of stack) {
      ctx.fillStyle = s.color;
      ctx.font = `${s.weight} ${Math.round(s.f)}px Arial, sans-serif`;
      ctx.fillText(s.txt, mx, topY + cap(s.f));
      topY += cap(s.f) + desc(s.f) + lineGap;
    }
  });

  // ── More / empty / footer ──────────────────────────────
  ctx.textAlign = 'center';
  if (count === 0) {
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = '400 36px Arial, sans-serif';
    ctx.fillText('No dates in this range yet.', w / 2, regionTop + 80);
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
  const [headlineColor, setHeadlineColor] = useState('#00e0a4');
  const [accentColor, setAccentColor] = useState('#00e0a4');
  const [textColor, setTextColor] = useState('#ffffff');
  const [monthOffset, setMonthOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [djSlug, setDjSlug] = useState<string>('');
  const [showUrl, setShowUrl] = useState(true);
  const [saveLogo, setSaveLogo] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
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

  // Split into pages of maxRows — dates that don't fit spill onto the next graphic.
  const pages = useMemo(() => {
    const per = SIZES[size].maxRows;
    const out: StoryBooking[][] = [];
    for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
    return out.length ? out : [[]];
  }, [items, size]);
  const layoutCount = useMemo(() => pages.reduce((m, p) => Math.max(m, p.length), 0), [pages]);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage((p) => Math.min(p, pages.length - 1)); }, [pages.length]);
  const rows = pages[Math.min(page, pages.length - 1)] || [];

  useEffect(() => { let a = true; (async () => { const img = logoUrl ? await loadImage(logoUrl) : null; if (a) setLogoImg(img); })(); return () => { a = false; }; }, [logoUrl]);
  useEffect(() => { let a = true; (async () => { const img = bgUrl ? await loadImage(bgUrl) : null; if (a) setBgImg(img); })(); return () => { a = false; }; }, [bgUrl]);

  // Shared draw params so the preview and every downloaded page look identical.
  const renderPage = useCallback((ctx: CanvasRenderingContext2D, pageRows: StoryBooking[], pageIndex: number) => {
    const cfg = SIZES[size];
    drawStory(ctx, cfg.w, cfg.h, {
      headline, djName, logoImg, bgImg, bgColor,
      themeStops: THEMES[theme] || THEMES.Teal,
      bgScale, bgOffsetX, bgOffsetY, logoScale, textScale,
      rows: pageRows, layoutCount, pageIndex, pageCount: pages.length, size,
      footerUrl, showUrl,
      headlineColor, accentColor, textColor,
    });
  }, [size, headline, djName, logoImg, bgImg, bgColor, theme, bgScale, bgOffsetX, bgOffsetY, logoScale, textScale, pages.length, layoutCount, footerUrl, showUrl, headlineColor, accentColor, textColor]);

  // Draw — synchronous, uses cached images. Fast, so sliders/drag glide.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cfg = SIZES[size];
    canvas.width = cfg.w;
    canvas.height = cfg.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderPage(ctx, rows, Math.min(page, pages.length - 1));
  }, [renderPage, rows, page, pages.length, size]);

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
    if (url) { setBgUrl(url); setBgOffsetX(0); setBgOffsetY(0); setHasDragged(false); }
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
    setHasDragged(true);
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    setBgOffsetX((o) => clamp(o + (dx / rect.width) * 2));
    setBgOffsetY((o) => clamp(o + (dy / rect.height) * 2));
  }
  function onDragEnd() {
    dragRef.current = null;
  }

  function exportCanvas(cvs: HTMLCanvasElement, name: string) {
    try {
      cvs.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }, 'image/png');
    } catch { /* canvas may be tainted if an image host blocks CORS */ }
  }

  function renderOffscreen(pageIndex: number): HTMLCanvasElement | null {
    const cfg = SIZES[size];
    const cvs = document.createElement('canvas');
    cvs.width = cfg.w;
    cvs.height = cfg.h;
    const ctx = cvs.getContext('2d');
    if (!ctx) return null;
    renderPage(ctx, pages[pageIndex] || [], pageIndex);
    return cvs;
  }

  function download() {
    const cur = Math.min(page, pages.length - 1);
    const cvs = renderOffscreen(cur);
    if (cvs) exportCanvas(cvs, `gdc-schedule-${range}-${size}${pages.length > 1 ? `-p${cur + 1}` : ''}.png`);
  }

  async function downloadAll() {
    for (let i = 0; i < pages.length; i++) {
      const cvs = renderOffscreen(i);
      if (cvs) exportCanvas(cvs, `gdc-schedule-${range}-${size}-p${i + 1}.png`);
      await new Promise((r) => setTimeout(r, 350)); // stagger so the browser accepts multiple saves
    }
  }

  const btn = (active: boolean): React.CSSProperties => ({
    padding: '.45rem .9rem', borderRadius: 8, cursor: 'pointer', fontSize: '.8rem', fontWeight: 700,
    border: `1px solid ${active ? 'var(--neon,#00e0a4)' : 'rgba(255,255,255,.25)'}`,
    background: active ? 'var(--neon,#00e0a4)' : 'transparent',
    color: active ? '#06231b' : 'var(--white,#fff)',
  });
  const label: React.CSSProperties = { color: 'var(--muted,#8a8aa0)', fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 };
  const swatch = (active: boolean): React.CSSProperties => ({
    width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', position: 'relative', overflow: 'hidden', padding: 0, flexShrink: 0,
    border: active ? '2px solid var(--neon,#00e0a4)' : '2px solid rgba(255,255,255,.18)',
    boxShadow: active ? '0 0 0 3px rgba(0,224,164,.3)' : 'none',
    display: 'block',
  });

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
              <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
                {Object.keys(THEMES).map((t) => {
                  const active = !bgUrl && !bgColor && theme === t;
                  const s = THEMES[t];
                  return (
                    <button key={t} type="button" title={t} style={swatch(active)} onClick={() => { setBgUrl(null); setBgColor(null); setTheme(t); }}>
                      <span style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${s[0]}, ${s[1]} 55%, ${s[2]})` }} />
                    </button>
                  );
                })}

                <span style={{ width: 1, height: 26, background: 'rgba(255,255,255,.14)', margin: '0 2px' }} />

                <label title="Custom color" style={swatch(!!bgColor)}>
                  <span style={{ position: 'absolute', inset: 0, background: bgColor || 'conic-gradient(from 0deg,#ff5f6d,#ffc371,#47e5bc,#4facfe,#b16cea,#ff5f6d)' }} />
                  <input type="color" value={bgColor || '#0b0b16'} onChange={(e) => setBgColor(e.target.value)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} />
                </label>

                <button type="button" title="Upload a full background image" style={swatch(!!bgUrl)} disabled={busy} onClick={() => bgInput.current?.click()}>
                  {bgUrl
                    ? <span style={{ position: 'absolute', inset: 0, backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                    : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted,#9a9ab0)', fontSize: 20 }}>{busy ? '…' : '＋'}</span>}
                </button>

                {(bgUrl || bgColor) && (
                  <button type="button" title="Clear color & image" onClick={() => { setBgUrl(null); setBgColor(null); }} style={{ background: 'transparent', border: 'none', color: 'var(--muted,#9a9ab0)', fontSize: '.74rem', cursor: 'pointer', textDecoration: 'underline', marginLeft: 2 }}>Clear</button>
                )}
              </div>
              <div style={{ color: 'var(--muted,#7a7a90)', fontSize: '.68rem', marginTop: 6 }}>
                {bgUrl
                  ? <>Your image fills the whole background{bgColor ? ' — a transparent PNG shows your color behind it.' : '.'}</>
                  : 'Presets, a custom color, or your own full-bleed background image (＋).'}
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

            <div>
              <div style={label}>Text colors</div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                {([
                  { lbl: 'Month', val: headlineColor, set: setHeadlineColor },
                  { lbl: 'Accent', val: accentColor, set: setAccentColor },
                  { lbl: 'Lines', val: textColor, set: setTextColor },
                ] as const).map((c) => (
                  <label key={c.lbl} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <span style={{ ...swatch(false), width: 30, height: 30 }}>
                      <span style={{ position: 'absolute', inset: 0, background: c.val }} />
                      <input type="color" value={c.val} onChange={(e) => c.set(e.target.value)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} />
                    </span>
                    <span style={{ color: 'var(--white,#fff)', fontSize: '.78rem' }}>{c.lbl}</span>
                  </label>
                ))}
                {(headlineColor !== '#00e0a4' || accentColor !== '#00e0a4' || textColor !== '#ffffff') && (
                  <button type="button" onClick={() => { setHeadlineColor('#00e0a4'); setAccentColor('#00e0a4'); setTextColor('#ffffff'); }} style={{ background: 'transparent', border: 'none', color: 'var(--muted,#9a9ab0)', fontSize: '.74rem', cursor: 'pointer', textDecoration: 'underline' }}>Reset</button>
                )}
              </div>
              <div style={{ color: 'var(--muted,#7a7a90)', fontSize: '.68rem', marginTop: 6 }}>Month = title · Accent = times & date badge · Lines = venue &amp; address.</div>
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
              {bgUrl && !hasDragged && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', padding: '0 22px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '.8rem', fontWeight: 600, textAlign: 'center', lineHeight: 1.45, textShadow: '0 1px 8px rgba(0,0,0,.9)' }}>✥ Drag image to position where you&rsquo;d like it to sit</span>
                </div>
              )}
            </div>

            {pages.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--white,#fff)', fontSize: '.8rem', fontWeight: 700 }}>
                <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page <= 0} style={{ ...btn(false), padding: '.25rem .6rem', opacity: page <= 0 ? 0.4 : 1 }}>‹</button>
                <span>Graphic {Math.min(page, pages.length - 1) + 1} of {pages.length}</span>
                <button type="button" onClick={() => setPage((p) => Math.min(pages.length - 1, p + 1))} disabled={page >= pages.length - 1} style={{ ...btn(false), padding: '.25rem .6rem', opacity: page >= pages.length - 1 ? 0.4 : 1 }}>›</button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: size === 'story' ? 240 : 330 }}>
              <button type="button" onClick={download} style={{ ...btn(true), padding: '.7rem 1.4rem', fontSize: '.9rem', width: '100%' }}>{pages.length > 1 ? `Download this graphic (${Math.min(page, pages.length - 1) + 1})` : 'Download PNG'}</button>
              {pages.length > 1 && (
                <button type="button" onClick={downloadAll} style={{ ...btn(false), padding: '.6rem 1.4rem', fontSize: '.85rem', width: '100%' }}>Download all {pages.length} graphics</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
