'use client';

// BookingRequestsMenu — the header's Booking Requests icon, now with a
// notification-style dropdown (mirrors NotificationBell). Clicking it opens a
// small panel listing the most recent requests that need the DJ's response:
//   • incoming requests still 'pending' (a client requested this DJ)
//   • outgoing bookings the DJ 'counter'ed that the client bounced back
// A "View more" link opens the full /booking-requests page.
//
// Behavior parity with the rest of the header:
//   • Badge count comes from the parent (useUnreadBookingCount) via `count`.
//   • Opening the panel clears the badge — it fires 'gdc:mark-bookings-seen',
//     the same event the count hook listens for.
//   • Desktop only for the dropdown; on mobile the icon just navigates to the
//     full page (the panel would be cramped, and mobile has its own patterns).

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { createClient } from '@/lib/supabase/client';

type Item = {
  id: string;
  kind: 'request' | 'counter';
  name: string;
  label: string;
  eventDate: string | null;
  at: string | null;
  price: string | null;
};

// Money formatting for the price line — mirrors the reminder email.
const CUR: Record<string, string> = { USD: '$', CAD: '$', AUD: '$', GBP: '£', EUR: '€' };
function money(amount: number, currency: string | null): string {
  const code = (currency || 'USD').toUpperCase();
  const sym = CUR[code];
  const n = Number(amount).toLocaleString();
  return sym ? `${sym}${n}` : `${code} ${n}`;
}

// Minimal event-type → label map. Falls back to the raw type or the venue type,
// so club/bar requests (which have no event_type) still read sensibly.
const EVENT_LABELS: Record<string, string> = {
  wedding: 'Wedding',
  birthday: 'Birthday',
  corporate: 'Corporate',
  anniversary: 'Anniversary',
  graduation: 'Graduation',
  holiday: 'Holiday Party',
  private: 'Private Party',
  club: 'Club',
  bar: 'Bar',
};

function fmtDate(d: string | null): string {
  if (!d) return '';
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

const MORE_HREF = '/booking-requests';

type Row = {
  id: string;
  requester_name: string | null;
  event_type: string | null;
  venue_type: string | null;
  event_date: string | null;
  created_at: string | null;
  quoted_rate: number | null;
  offer_amount: number | null;
  counter_rate: number | null;
  currency: string | null;
};

export default function BookingRequestsMenu({ count }: { count: number }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [isDesktop, setIsDesktop] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 68, right: 16 });
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const on = () => setIsDesktop(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  function labelFor(r: Row): string {
    const key = (r.event_type || '').toLowerCase();
    if (key && EVENT_LABELS[key]) return EVENT_LABELS[key];
    if (r.event_type) return r.event_type;
    return r.venue_type || 'Booking';
  }

  async function load() {
    if (!user?.id) return;
    const db = createClient();
    try {
      const cols = 'id, requester_name, event_type, venue_type, event_date, created_at, quoted_rate, offer_amount, counter_rate, currency';
      const [pend, ctr] = await Promise.all([
        db.from('bookings')
          .select(cols)
          .eq('dj_id', user.id).eq('status', 'pending').is('deleted_at', null)
          .order('created_at', { ascending: false }).limit(10),
        db.from('bookings')
          .select(cols)
          .eq('requester_id', user.id).eq('status', 'counter').is('deleted_at', null)
          .order('created_at', { ascending: false }).limit(10),
      ]);
      const mk = (rows: Row[] | null, kind: 'request' | 'counter'): Item[] =>
        (rows || []).map((r) => {
          const rate = r.quoted_rate ?? r.offer_amount ?? r.counter_rate ?? null;
          return {
            id: r.id, kind,
            name: r.requester_name || 'A client',
            label: labelFor(r),
            eventDate: r.event_date,
            at: r.created_at,
            price: rate != null ? money(Number(rate), r.currency) : null,
          };
        });
      const all = [
        ...mk(pend.data as Row[] | null, 'request'),
        ...mk(ctr.data as Row[] | null, 'counter'),
      ].sort((a, b) => Date.parse(b.at || '') - Date.parse(a.at || ''));
      setItems(all);
    } catch { /* non-fatal */ }
  }

  function openPanel() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: Math.round(r.bottom + 10), right: Math.max(8, Math.round(window.innerWidth - r.right)) });
    }
    load();
    // Opening the list counts as reviewing it — clear the badge (same event the
    // count hook listens for).
    try { window.dispatchEvent(new CustomEvent('gdc:mark-bookings-seen')); } catch { /* ignore */ }
    setOpen(true);
  }

  function onIconClick() {
    if (!isDesktop) {
      // Mobile: keep the simple navigate behavior, but still clear the badge.
      try { window.dispatchEvent(new CustomEvent('gdc:mark-bookings-seen')); } catch { /* ignore */ }
      router.push(MORE_HREF);
      return;
    }
    if (open) setOpen(false);
    else openPanel();
  }

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

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        type="button"
        className="inbox-nav-btn inbox-nav-btn--book"
        title="Booking Requests"
        aria-label="Booking Requests"
        onClick={onIconClick}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
          <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
        </svg>
        {count > 0 && (
          <span className="inbox-badge" aria-label={`${count} bookings need attention`}>
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'fixed', top: pos.top, right: pos.right, width: 320,
            background: '#0d0d14', border: '1px solid rgba(255,255,255,.14)', borderRadius: 12,
            boxShadow: '0 14px 44px rgba(0,0,0,.6)', zIndex: 100000, overflow: 'hidden',
          }}
        >
          <div style={{ padding: '12px 15px', borderBottom: '1px solid rgba(255,255,255,.08)', fontWeight: 700, fontSize: '.92rem', color: '#fff', letterSpacing: '.01em' }}>
            Booking requests
          </div>

          {shown.length === 0 ? (
            <div style={{ padding: '22px 15px', color: 'rgba(255,255,255,.5)', fontSize: '.85rem', textAlign: 'center' }}>
              No new requests.
            </div>
          ) : (
            shown.map((it) => (
              <button
                key={`${it.id}-${it.kind}`}
                type="button"
                onClick={() => { setOpen(false); router.push(`${MORE_HREF}?open=${encodeURIComponent(it.id)}`); }}
                style={{
                  display: 'flex', gap: 11, alignItems: 'center', width: '100%', textAlign: 'left',
                  padding: '11px 15px', background: 'transparent', border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,.05)', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '1.2rem', lineHeight: 1, flexShrink: 0 }}>
                  {it.kind === 'counter' ? '\u{1F501}' : '\u{1F4E9}'}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', color: '#fff', fontSize: '.86rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {it.label}{it.eventDate ? ` · ${fmtDate(it.eventDate)}` : ''}
                  </span>
                  <span style={{ display: 'block', color: 'var(--neon,#00e0a4)', fontSize: '.72rem', marginTop: 1 }}>
                    {it.kind === 'counter' ? 'Countered — your response needed' : 'New booking request'}
                  </span>
                </span>
                <span style={{ flexShrink: 0, marginLeft: 8, whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {it.price
                    ? <span style={{ color: '#fff', fontSize: '.9rem', fontWeight: 700 }}>{it.price}</span>
                    : <span style={{ color: 'rgba(255,255,255,.45)', fontSize: '.7rem', fontStyle: 'italic' }}>Awaiting quote</span>}
                </span>
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
