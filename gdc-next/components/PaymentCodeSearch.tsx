'use client';

// PaymentCodeSearch — dynamic "find a booking" search, shown ONLY on the
// Upcoming Bookings dashboard as a magnifier on the SAME LINE as the sort
// buttons. Clicking it expands into an inline input that filters the REAL
// bookings list LIVE as you type — matching host name, event type, or the
// payment code, all in one box. Matching rows stay; every other row + month
// hides. Clear/close restores the full list.
//
// No custom result card — matches are shown exactly as the page renders them.
// Rows carry data-booking-id (BookingRow refactor), so we hide by id and never
// touch the large UpcomingBookingsClient / BookingRow files.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';

type Item = { id: string };

const DASHBOARD = '/upcoming-bookings';
const PAST = '/past-bookings';
const SEARCH_PATHS = [DASHBOARD, PAST];

// Where to hang the magnifier. Upcoming has a sort row ("By date" + "Recently")
// on the same line; Past Bookings has no sort bar, so we hang it in the page
// header, inline next to the "Past Bookings" title text.
function findAnchor(isPast: boolean): HTMLElement | null {
  if (isPast) {
    // Right next to the "Past Bookings" title text (inline after it).
    const h1 = Array.from(document.querySelectorAll('h1')).find((h) => /past bookings/i.test(h.textContent || ''));
    return h1 || null;
  }
  const byDate = Array.from(document.querySelectorAll('button')).find((b) => /by date/i.test(b.textContent || ''));
  let row: HTMLElement | null = byDate || null;
  for (let i = 0; i < 5 && row; i++) {
    const t = row.textContent || '';
    if (/by date/i.test(t) && /recently/i.test(t)) return row;
    row = row.parentElement;
  }
  return null;
}

const MagnifierBtn = ({ onClick, title }: { onClick: () => void; title: string }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-label={title}
    style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 34, height: 30, flexShrink: 0, background: 'transparent',
      border: '1px solid rgba(255,255,255,.2)', borderRadius: 8,
      color: 'var(--neon,#00e0a4)', cursor: 'pointer', padding: 0,
    }}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  </button>
);

export default function PaymentCodeSearch() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [active, setActive] = useState(false); // a filter is currently applied
  const [iconHost, setIconHost] = useState<HTMLElement | null>(null);
  const pathname = usePathname();
  const iconHostRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hiddenRef = useRef<[HTMLElement, string][]>([]);

  function restoreFilter() {
    hiddenRef.current.forEach(([el, disp]) => { el.style.display = disp || ''; });
    hiddenRef.current = [];
    setActive(false);
  }

  // Hide every real row + month whose booking id isn't in `ids`. Returns how
  // many matching rows are actually visible on the page.
  function applyFilterMany(ids: string[]): number {
    restoreFilter();
    const idSet = new Set(ids);
    const store: [HTMLElement, string][] = [];
    let shown = 0;
    const rows = Array.from(document.querySelectorAll('[class*="rowWrap"]')) as HTMLElement[];
    rows.forEach((r) => {
      const id = r.getAttribute('data-booking-id');
      const keep = !!id && idSet.has(id);
      if (keep) shown += 1;
      else { store.push([r, r.style.display]); r.style.display = 'none'; }
    });
    // Hide a month header only if none of its rows survived.
    const months = Array.from(document.querySelectorAll('[class*="month__"]')) as HTMLElement[];
    months.forEach((m) => {
      const anyKept = Array.from(m.querySelectorAll('[data-booking-id]'))
        .some((el) => idSet.has(el.getAttribute('data-booking-id') || ''));
      if (!anyKept) { store.push([m, m.style.display]); m.style.display = 'none'; }
    });
    hiddenRef.current = store;
    setActive(true);
    return shown;
  }

  // Create + place the magnifier slot on the sort row; tear down on leave.
  useEffect(() => {
    if (!SEARCH_PATHS.includes(pathname)) return;
    let cancelled = false;
    let tries = 0;
    const place = () => {
      if (cancelled) return;
      const anchor = findAnchor(pathname === PAST);
      if (anchor) {
        const icon = document.createElement('span');
        icon.setAttribute('data-gdc', 'paycode-icon');
        icon.style.display = 'inline-flex';
        icon.style.alignItems = 'center';
        icon.style.marginLeft = '10px';
        anchor.appendChild(icon);
        iconHostRef.current = icon;
        setIconHost(icon);
        return;
      }
      tries += 1;
      if (tries < 40) setTimeout(place, 100);
    };
    place();
    return () => {
      cancelled = true;
      restoreFilter();
      if (iconHostRef.current && iconHostRef.current.parentElement) {
        iconHostRef.current.parentElement.removeChild(iconHostRef.current);
      }
      iconHostRef.current = null;
      setIconHost(null);
    };
  }, [pathname]);

  useEffect(() => {
    if (expanded) setTimeout(() => inputRef.current?.focus(), 40);
  }, [expanded]);

  // Live search: debounce the query, fetch matches, filter the rows. Empty
  // query restores the full list.
  useEffect(() => {
    if (!expanded) return;
    const q = code.trim();
    if (!q) { restoreFilter(); setNotice(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/dj/find-by-code?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const j = await r.json();
        if (cancelled) return;
        const list: Item[] = Array.isArray(j.items) ? j.items : [];
        const ids = list.map((it) => it.id);
        const shown = applyFilterMany(ids);
        if (shown === 0) {
          setNotice(list.length ? 'Matches aren’t on this page.' : 'No match.');
        } else {
          setNotice(shown === 1 ? null : `${shown} matches`);
        }
      } catch {
        if (!cancelled) setNotice('Search failed — try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
    // applyFilterMany/restoreFilter are stable enough for this UI helper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, expanded]);

  function clear() {
    restoreFilter();
    setNotice(null);
    setCode('');
  }

  function collapse() {
    clear();
    setExpanded(false);
  }

  if (!SEARCH_PATHS.includes(pathname) || !iconHost) return null;

  const inputStyle: React.CSSProperties = {
    width: 210, minWidth: 0, background: '#16161f', color: '#fff',
    border: '1px solid rgba(255,255,255,.16)', borderRadius: 8, padding: '7px 11px',
    fontSize: '.82rem', outline: 'none', letterSpacing: '.02em',
  };
  const ghostBtn: React.CSSProperties = {
    flexShrink: 0, background: 'transparent', color: 'rgba(255,255,255,.55)',
    border: '1px solid rgba(255,255,255,.16)', borderRadius: 8, padding: '0 11px', height: 30,
    fontSize: '.8rem', cursor: 'pointer',
  };

  const iconUI = expanded ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
      <MagnifierBtn onClick={collapse} title="Close search" />
      <input
        ref={inputRef}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') collapse(); }}
        placeholder="Name, event, or payment code"
        style={inputStyle}
      />
      {(active || notice || code) && (
        <button type="button" onClick={clear} style={ghostBtn}>Clear</button>
      )}
      <span style={{ color: 'rgba(255,255,255,.6)', fontSize: '.76rem', minHeight: 14 }}>
        {loading ? 'Searching…' : (notice || '')}
      </span>
    </span>
  ) : (
    <MagnifierBtn onClick={() => setExpanded(true)} title="Search bookings" />
  );

  return createPortal(iconUI, iconHost);
}
