'use client';

// BookingRequestsMenu — the header's Booking Requests icon with a
// notification-style dropdown (mirrors NotificationBell). Two tabs:
//   • Respond  — requests that need YOUR response: an incoming 'pending'
//                request, or one you made that was 'counter'ed back to you.
//   • Awaiting — requests you're waiting on the OTHER side for: a request you
//                made that's still 'pending', or one you 'counter'ed.
// Opens on Respond when something needs you; otherwise defaults to Awaiting so
// the panel isn't empty when you're only waiting on replies (the common case
// for a host who's requested DJs and is waiting to hear back).
//
// Behavior parity with the rest of the header:
//   • Badge count comes from the parent (useUnreadBookingCount) via `count`.
//   • Opening the panel clears the badge — it fires 'gdc:mark-bookings-seen'.
//   • Desktop only for the dropdown; on mobile the icon navigates to the page.

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

type Tab = 'respond' | 'awaiting';

export default function BookingRequestsMenu({ count }: { count: number }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [respondItems, setRespondItems] = useState<Item[]>([]);
  const [awaitingItems, setAwaitingItems] = useState<Item[]>([]);
  const [tab, setTab] = useState<Tab>('respond');
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
      const q = (col: 'dj_id' | 'requester_id', status: 'pending' | 'counter') =>
        db.from('bookings')
          .select(cols)
          .eq(col, user.id).eq('status', status).is('deleted_at', null)
          .order('created_at', { ascending: false }).limit(10);
      // Respond: things that owe YOUR reply. Awaiting: things you're waiting on.
      const [djPend, reqCtr, reqPend, djCtr] = await Promise.all([
        q('dj_id', 'pending'),        // respond  — incoming request to you
        q('requester_id', 'counter'), // respond  — a request you made, countered back
        q('requester_id', 'pending'), // awaiting — your request, still with the DJ
        q('dj_id', 'counter'),        // awaiting — you countered, waiting on them
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
      const byAt = (a: Item, b: Item) => Date.parse(b.at || '') - Date.parse(a.at || '');
      // DJs and teammates no longer book DJs — never surface the requester-side
      // (outgoing) items for them. Hosts and venue accounts keep them.
      const role = (user as { role?: string } | null)?.role;
      const djSide = role === 'dj' || role === 'teammate';
      const respond = [
        ...mk(djPend.data as Row[] | null, 'request'),
        ...(djSide ? [] : mk(reqCtr.data as Row[] | null, 'counter')),
      ].sort(byAt);
      const awaiting = [
        ...(djSide ? [] : mk(reqPend.data as Row[] | null, 'request')),
        ...mk(djCtr.data as Row[] | null, 'counter'),
      ].sort(byAt);
      setRespondItems(respond);
      setAwaitingItems(awaiting);
      // Land on Respond when something needs you; otherwise open on Awaiting so
      // the panel shows what you're waiting on instead of "nothing here".
      setTab(respond.length > 0 ? 'respond' : 'awaiting');
    } catch { /* non-fatal */ }
  }

  function openPanel() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: Math.round(r.bottom + 10), right: Math.max(8, Math.round(window.innerWidth - r.right)) });
    }
    load();
    try { window.dispatchEvent(new CustomEvent('gdc:mark-bookings-seen')); } catch { /* ignore */ }
    setOpen(true);
  }

  function onIconClick() {
    if (!isDesktop) {
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

  const activeItems = tab === 'respond' ? respondItems : awaitingItems;
  const shown = activeItems.slice(0, 6);

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

          {/* Respond / Awaiting tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            {(['respond', 'awaiting'] as const).map((t) => {
              const activeTab = tab === t;
              const n = t === 'respond' ? respondItems.length : awaitingItems.length;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  style={{
                    flex: 1, padding: '9px 8px', background: 'transparent', border: 'none',
                    borderBottom: activeTab ? '2px solid var(--neon,#00e0a4)' : '2px solid transparent',
                    color: activeTab ? '#fff' : 'rgba(255,255,255,.55)',
                    fontWeight: 700, fontSize: '.76rem', cursor: 'pointer', letterSpacing: '.02em',
                  }}
                >
                  {t === 'respond' ? 'Response Required' : 'Awaiting'}{n > 0 ? ` (${n})` : ''}
                </button>
              );
            })}
          </div>

          {shown.length === 0 ? (
            <div style={{ padding: '22px 15px', color: 'rgba(255,255,255,.5)', fontSize: '.85rem', textAlign: 'center' }}>
              {tab === 'respond' ? 'Nothing needs your response.' : 'Nothing awaiting a response.'}
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
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', color: '#fff', fontSize: '.86rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {it.label}{it.eventDate ? ` · ${fmtDate(it.eventDate)}` : ''}
                  </span>
                  <span style={{ display: 'block', color: tab === 'awaiting' ? 'rgba(255,255,255,.55)' : '#f5c451', fontSize: '.72rem', marginTop: 1 }}>
                    {tab === 'awaiting'
                      ? (it.kind === 'counter' ? 'Awaiting response from host' : 'Awaiting response from DJ')
                      : 'Pending your response'}
                  </span>
                </span>
                <span style={{ flexShrink: 0, marginLeft: 8, whiteSpace: 'nowrap', textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  {it.price
                    ? <span style={{ color: 'var(--neon,#00e0a4)', fontSize: '.9rem', fontWeight: 700 }}>{it.price}</span>
                    : <span style={{ color: 'rgba(255,255,255,.45)', fontSize: '.7rem', fontStyle: 'italic' }}>Awaiting quote</span>}
                  {/* Explicit affordance so it reads as clickable. */}
                  <span style={{ color: 'var(--neon,#00e0a4)', fontSize: '.66rem', fontWeight: 700, letterSpacing: '.02em' }}>View &rarr;</span>
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
