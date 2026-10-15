'use client';

// NotificationBell — the header's "new activity" bell (desktop only). Sits
// between the Booking Requests and Inbox icons. Clicking it opens a small panel
// listing the most recent HOST actions across the DJ's bookings: each row is
// the stage icon that changed, plus the event type and date. A "View more"
// link at the bottom opens the Upcoming Bookings "New activity" view.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Item = { bookingId: string; slot: string; at: string; eventDate: string | null; label: string; method?: string | null; href?: string | null };

// The stage icon that represents each kind of update — same vocabulary as the
// booking pipeline (contract / deposit / balance / planner-or-rider / guests).
// Line-icon chips instead of emoji — a tinted rounded square with a stroked
// glyph, colour-coded by what the update means: green = done / accepted,
// amber = awaiting you / in-flight, red = declined / cancelled. Each slot maps
// to one { shape, tone }; the shapes are drawn in slotGlyph() below.
type Tone = 'green' | 'amber' | 'red';
const TONE_COLOR: Record<Tone, string> = { green: '#00e0a4', amber: '#eaa94a', red: '#ff6b6b' };

type Shape = 'check' | 'x' | 'message' | 'docPen' | 'doc' | 'dollar' | 'receipt' | 'music' | 'clock' | 'users' | 'clipboard' | 'ban' | 'download' | 'eye';

const SLOT_STYLE: Record<string, { shape: Shape; tone: Tone }> = {
  // DJ-side slots (host actions on the DJ's bookings).
  contract: { shape: 'doc', tone: 'green' },
  contract_declined: { shape: 'x', tone: 'red' },
  deposit: { shape: 'dollar', tone: 'green' },
  invoice: { shape: 'receipt', tone: 'green' },
  deposit_pending: { shape: 'dollar', tone: 'amber' },
  invoice_pending: { shape: 'receipt', tone: 'amber' },
  song_list: { shape: 'music', tone: 'green' },
  guestlist: { shape: 'users', tone: 'green' },
  change: { shape: 'check', tone: 'green' },
  cancel_requested: { shape: 'ban', tone: 'red' },
  // Host-side slots (DJ actions on the host's bookings).
  accepted: { shape: 'check', tone: 'green' },
  countered: { shape: 'message', tone: 'amber' },
  denied: { shape: 'x', tone: 'red' },
  contract_sign: { shape: 'docPen', tone: 'amber' },
  deposit_request: { shape: 'dollar', tone: 'amber' },
  balance_request: { shape: 'receipt', tone: 'amber' },
  planner_sent: { shape: 'music', tone: 'amber' },
  planner_reminder: { shape: 'clock', tone: 'amber' },
  guestlist_sent: { shape: 'users', tone: 'amber' },
  rider_sent: { shape: 'clipboard', tone: 'amber' },
  cancelled: { shape: 'ban', tone: 'red' },
  contract_ready: { shape: 'eye', tone: 'green' },
  deposit_receipt: { shape: 'download', tone: 'green' },
  balance_receipt: { shape: 'download', tone: 'green' },
};

function slotGlyph(shape: Shape) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (shape) {
    case 'check': return (<><circle cx="12" cy="12" r="9" {...p} /><polyline points="8.5 12.5 11 15 15.5 9.5" {...p} /></>);
    case 'x': return (<><circle cx="12" cy="12" r="9" {...p} /><line x1="15" y1="9" x2="9" y2="15" {...p} /><line x1="9" y1="9" x2="15" y2="15" {...p} /></>);
    case 'ban': return (<><circle cx="12" cy="12" r="9" {...p} /><line x1="5.6" y1="5.6" x2="18.4" y2="18.4" {...p} /></>);
    case 'message': return (<path d="M21 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" {...p} />);
    case 'doc': return (<><path d="M14 3v5h5" {...p} /><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" {...p} /><path d="M8 13h8M8 17h6" {...p} /></>);
    case 'docPen': return (<><path d="M14 3v5h5" {...p} /><path d="M20 10V8l-6-5H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" {...p} /><path d="M18.4 13.6a1.5 1.5 0 0 1 2 2L16 20l-3 1 1-3z" {...p} /></>);
    case 'dollar': return (<><line x1="12" y1="2.5" x2="12" y2="21.5" {...p} /><path d="M16.5 6H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H7" {...p} /></>);
    case 'receipt': return (<><path d="M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1z" {...p} /><path d="M8 8h8M8 12h8M8 16h5" {...p} /></>);
    case 'music': return (<><path d="M9 18V5l12-2v11" {...p} /><circle cx="6" cy="18" r="2.6" {...p} /><circle cx="18" cy="16" r="2.6" {...p} /></>);
    case 'clock': return (<><circle cx="12" cy="12" r="9" {...p} /><path d="M12 7.5V12l3 2" {...p} /></>);
    case 'users': return (<><circle cx="9" cy="8" r="3.2" {...p} /><path d="M3.5 20c0-3.3 2.6-5 5.5-5s5.5 1.7 5.5 5" {...p} /><path d="M16 5.2a3 3 0 0 1 0 5.8M17.5 15c2 .5 3.5 2 3.5 5" {...p} /></>);
    case 'clipboard': return (<><rect x="6" y="4" width="12" height="17" rx="2" {...p} /><path d="M9 4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4" {...p} /><path d="M9 10h6M9 14h6M9 18h4" {...p} /></>);
    case 'download': return (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" {...p} /><polyline points="7 10 12 15 17 10" {...p} /><line x1="12" y1="15" x2="12" y2="3" {...p} /></>);
    case 'eye': return (<><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" {...p} /><circle cx="12" cy="12" r="3" {...p} /></>);
  }
}

function SlotChip({ slot }: { slot: string }) {
  const s = SLOT_STYLE[slot] || { shape: 'check' as Shape, tone: 'green' as Tone };
  const color = TONE_COLOR[s.tone];
  return (
    <span style={{ flexShrink: 0, marginLeft: 10, display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <span
        aria-hidden="true"
        style={{
          width: 34, height: 34, borderRadius: 10,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: `${color}1f`, border: `1px solid ${color}3d`, color,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24">{slotGlyph(s.shape)}</svg>
      </span>
      <span style={{ fontSize: '.6rem', fontWeight: 700, letterSpacing: '.04em', color: 'var(--neon,#00e0a4)' }}>View</span>
    </span>
  );
}
const WHAT: Record<string, string> = {
  // DJ-side.
  contract: 'Contract signed',
  contract_declined: 'Contract declined',
  deposit: 'Deposit paid',
  invoice: 'Balance paid',
  deposit_pending: 'Deposit pending',
  invoice_pending: 'Balance pending',
  song_list: 'Planner submitted',
  guestlist: 'Guest list confirmed',
  change: 'Change approved',
  cancel_requested: 'Cancellation requested',
  // Host-side.
  accepted: 'Booking accepted',
  countered: 'Counter offer sent',
  denied: 'Booking declined',
  contract_sign: 'Contract ready to sign',
  deposit_request: 'Deposit requested',
  balance_request: 'Balance requested',
  planner_sent: 'Planner & Playlist sent',
  planner_reminder: 'Planner reminder',
  guestlist_sent: 'Guest list sent',
  rider_sent: 'Rider sent',
  cancelled: 'Booking cancelled',
  contract_ready: 'Contract ready to view',
  deposit_receipt: 'Deposit receipt ready to download',
  balance_receipt: 'Balance receipt ready to download',
};

// For a pending cash/check hand-off, append the method so the DJ sees what to
// expect: "Balance pending — check".
function whatLabel(it: Item): string {
  const base = WHAT[it.slot] || 'Update';
  if ((it.slot === 'invoice_pending' || it.slot === 'deposit_pending') && it.method) {
    return `${base} — ${it.method === 'cash' ? 'cash' : 'check'}`;
  }
  return base;
}

function fmtDate(d: string | null): string {
  if (!d) return '';
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

// "just now" / "25 min ago" / "3 hours ago" / "1 day ago" … from the ISO
// timestamp of when the host action happened.
function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w} week${w === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  const y = Math.floor(d / 365);
  return `${y} year${y === 1 ? '' : 's'} ago`;
}

interface NotificationBellProps {
  /** Activity endpoint. DJ default; hosts pass '/api/host/new-activity'. */
  endpoint?: string;
  /** "View more" destination. */
  moreHref?: string;
  /** localStorage key for the last-seen timestamp (separate per audience so a
   *  DJ-and-host hybrid account doesn't share a badge). */
  seenKey?: string;
  /** Base path an item opens; the booking id is appended as ?open=<id>. */
  openHrefBase?: string;
}

export default function NotificationBell({
  endpoint = '/api/dj/new-activity',
  moreHref = '/upcoming-bookings?filter=activity',
  seenKey = 'gdc_newactivity_seen',
  openHrefBase = '/upcoming-bookings',
}: NotificationBellProps = {}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  // Fixed viewport position for the panel. The <header> has overflow:hidden,
  // which would CLIP an absolutely-positioned dropdown hanging below it — so the
  // panel is position:fixed (viewport-relative, unclipped) and anchored to the
  // bell's on-screen box, measured when it opens.
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 68, right: 16 });
  // The moment the DJ last opened (reviewed) the bell. Persisted, so the badge
  // stays cleared across reloads and only comes back when NEWER activity lands.
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  // Re-render every minute so the "x min ago" labels stay fresh while open.
  const [, setTick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    try { setLastSeen(localStorage.getItem(seenKey)); } catch { /* ignore */ }
  }, []);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: Math.round(r.bottom + 10), right: Math.max(8, Math.round(window.innerWidth - r.right)) });
      load();
      // Opening the panel IS reviewing it — clear the count. Everything up to
      // now counts as seen; a later host action bumps the badge again.
      const seen = new Date().toISOString();
      setLastSeen(seen);
      try { localStorage.setItem(seenKey, seen); } catch { /* ignore */ }
    }
    setOpen((v) => !v);
  }

  async function load() {
    try {
      const r = await fetch(endpoint, { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch { /* non-fatal — the bell just shows what it last had */ }
  }

  // Load on mount and poll, so the badge stays current without opening it.
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  // Tick every minute so relative timestamps update live while the panel is open.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const shown = items.slice(0, 6);
  // Badge count = items newer than the last time the bell was opened. After a
  // review it's 0; a fresh host action makes it reappear.
  const seenT = lastSeen ? Date.parse(lastSeen) : Number.NEGATIVE_INFINITY;
  const unseen = items.reduce((n, i) => (Date.parse(i.at) > seenT ? n + 1 : n), 0);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        type="button"
        className="inbox-nav-btn"
        title="New activity"
        aria-label="New activity"
        onClick={toggle}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unseen > 0 && (
          <span className="inbox-badge" aria-label={`${unseen} new activity`}>
            {unseen > 9 ? '9+' : unseen}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'fixed', top: pos.top, right: pos.right, width: 'min(320px, calc(100vw - 16px))',
            background: '#0d0d14', border: '1px solid rgba(255,255,255,.14)', borderRadius: 12,
            boxShadow: '0 14px 44px rgba(0,0,0,.6)', zIndex: 100000, overflow: 'hidden',
          }}
        >
          <div style={{ padding: '12px 15px', borderBottom: '1px solid rgba(255,255,255,.08)', fontWeight: 700, fontSize: '.92rem', color: '#fff', letterSpacing: '.01em' }}>
            New activity
          </div>

          {shown.length === 0 ? (
            <div style={{ padding: '22px 15px', color: 'rgba(255,255,255,.5)', fontSize: '.85rem', textAlign: 'center' }}>
              No new updates.
            </div>
          ) : (
            shown.map((it) => (
              <button
                key={`${it.bookingId}-${it.at}`}
                type="button"
                onClick={() => {
                  setOpen(false);
                  // An item with its own href (e.g. a contract → the signing
                  // page) goes there directly; the API URL does a server redirect,
                  // so use a full navigation. Otherwise open the booking's card.
                  if (it.href) window.location.href = it.href;
                  else router.push(`${openHrefBase}?open=${encodeURIComponent(it.bookingId)}`);
                }}
                style={{
                  display: 'flex', gap: 11, alignItems: 'center', width: '100%', textAlign: 'left',
                  padding: '11px 15px', background: 'transparent', border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,.05)', cursor: 'pointer',
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', color: '#fff', fontSize: '.86rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {it.label}{it.eventDate ? ` · ${fmtDate(it.eventDate)}` : ''}
                  </span>
                  <span style={{ display: 'block', color: 'var(--neon,#00e0a4)', fontSize: '.72rem', marginTop: 1 }}>
                    {whatLabel(it)}
                  </span>
                  {timeAgo(it.at) && (
                    <span style={{ display: 'block', color: 'rgba(255,255,255,.45)', fontSize: '.68rem', marginTop: 2 }}>
                      {timeAgo(it.at)}
                    </span>
                  )}
                </span>
                <SlotChip slot={it.slot} />
              </button>
            ))
          )}

          <button
            type="button"
            onClick={() => { setOpen(false); router.push(moreHref); }}
            style={{
              display: 'block', width: '100%', textAlign: 'center', padding: '12px',
              background: 'transparent', border: 'none', borderTop: '1px solid rgba(255,255,255,.08)',
              color: 'var(--neon,#00e0a4)', fontWeight: 700, fontSize: '.8rem', cursor: 'pointer', letterSpacing: '.02em',
            }}
          >
            View more &rarr;
          </button>
        </div>
      )}
    </div>
  );
}
