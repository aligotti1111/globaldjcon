'use client';

// NotificationBell — the header's "new activity" bell (desktop only). Sits
// between the Booking Requests and Inbox icons. Clicking it opens a small panel
// listing the most recent HOST actions across the DJ's bookings: each row is
// the stage icon that changed, plus the event type and date. A "View more"
// link at the bottom opens the Upcoming Bookings "New activity" view.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Item = { bookingId: string; slot: string; at: string; eventDate: string | null; label: string };

// The stage icon that represents each kind of update — same vocabulary as the
// booking pipeline (contract / deposit / balance / planner-or-rider / guests).
const EMOJI: Record<string, string> = {
  contract: '\u{1F4DD}',   // 📝
  deposit: '\u{1F4B5}',    // 💵
  invoice: '\u{1F9FE}',    // 🧾
  song_list: '\u{1F3B5}',  // 🎵
  guestlist: '\u{1F465}',  // 👥
};
const WHAT: Record<string, string> = {
  contract: 'Contract signed',
  deposit: 'Deposit paid',
  invoice: 'Balance paid',
  song_list: 'Planner submitted',
  guestlist: 'Guest list confirmed',
};

function fmtDate(d: string | null): string {
  if (!d) return '';
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

const MORE_HREF = '/upcoming-bookings?filter=activity';

export default function NotificationBell() {
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
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    try { setLastSeen(localStorage.getItem('gdc_newactivity_seen')); } catch { /* ignore */ }
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
      try { localStorage.setItem('gdc_newactivity_seen', seen); } catch { /* ignore */ }
    }
    setOpen((v) => !v);
  }

  async function load() {
    try {
      const r = await fetch('/api/dj/new-activity', { cache: 'no-store' });
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
                onClick={() => { setOpen(false); router.push(`/upcoming-bookings?open=${encodeURIComponent(it.bookingId)}`); }}
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
                    {WHAT[it.slot] || 'Update'}
                  </span>
                </span>
                <span style={{ fontSize: '1.2rem', lineHeight: 1, flexShrink: 0, marginLeft: 10 }}>{EMOJI[it.slot] || '\u{1F514}'}</span>
              </button>
            ))
          )}

          <button
            type="button"
            onClick={() => { setOpen(false); router.push(MORE_HREF); }}
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
