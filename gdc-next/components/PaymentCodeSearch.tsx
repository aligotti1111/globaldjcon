'use client';

// PaymentCodeSearch — "find a booking by its payment code", shown ONLY on the
// Upcoming Bookings dashboard as a magnifier on the SAME LINE as the sort
// buttons. Clicking it expands into an inline input; running a code filters the
// REAL bookings list down to the matching booking (its native row stays, every
// other row + month is hidden). Clear/close restores the full list.
//
// No custom result card — the match is shown exactly as the page renders it.
// We find the row by matching the booking's date + event type against the real
// rows' cells (rows carry no id in the DOM), so we never touch the large
// UpcomingBookingsClient / BookingRow files.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';

type Item = {
  id: string;
  label: string;
  eventDate: string | null;
};

const DASHBOARD = '/upcoming-bookings';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function fmtShort(d: string | null): string {
  if (!d) return '';
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

// The sort row = the smallest element containing both "By date" and "Recently".
function findSortRow(): HTMLElement | null {
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

  // Hide every real row + month except the one matching this booking. Returns
  // true if a matching row was found on the page.
  function applyFilter(item: Item): boolean {
    restoreFilter();
    if (!item.eventDate) return false;
    const day = String(parseInt(item.eventDate.slice(8, 10), 10));
    const mon = MONTHS[parseInt(item.eventDate.slice(5, 7), 10) - 1] || '';
    const label = (item.label || '').toLowerCase();

    const rows = Array.from(document.querySelectorAll('[class*="rowWrap"]')) as HTMLElement[];
    const matched = rows.filter((r) => {
      const dt = (r.querySelector('[class*="rowDate"]')?.textContent || '').toUpperCase().replace(/\s+/g, '');
      const dayNum = (dt.match(/^\d+/) || [])[0];
      const ty = (r.querySelector('[class*="rowEventType"]')?.textContent || '').toLowerCase();
      return dayNum === day && dt.includes(mon) && (!label || ty.includes(label));
    });
    if (matched.length === 0) return false;

    const store: [HTMLElement, string][] = [];
    rows.forEach((r) => { if (!matched.includes(r)) { store.push([r, r.style.display]); r.style.display = 'none'; } });
    const months = Array.from(document.querySelectorAll('[class*="month__"]')) as HTMLElement[];
    months.forEach((m) => { if (!matched.some((r) => m.contains(r))) { store.push([m, m.style.display]); m.style.display = 'none'; } });
    hiddenRef.current = store;
    setActive(true);
    return true;
  }

  // Create + place the magnifier slot on the sort row; tear down on leave.
  useEffect(() => {
    if (pathname !== DASHBOARD) return;
    let cancelled = false;
    let tries = 0;
    const place = () => {
      if (cancelled) return;
      const sortRow = findSortRow();
      if (sortRow) {
        const icon = document.createElement('span');
        icon.setAttribute('data-gdc', 'paycode-icon');
        icon.style.display = 'inline-flex';
        icon.style.alignItems = 'center';
        icon.style.marginLeft = '10px';
        sortRow.appendChild(icon);
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

  async function run() {
    const q = code.trim();
    if (!q) return;
    setLoading(true);
    setNotice(null);
    restoreFilter();
    try {
      const r = await fetch(`/api/dj/find-by-code?code=${encodeURIComponent(q)}`, { cache: 'no-store' });
      const j = await r.json();
      const list: Item[] = Array.isArray(j.items) ? j.items : [];
      if (list.length === 0) { setNotice('No booking found for that code.'); return; }
      const item = list[0];
      const ok = applyFilter(item);
      if (!ok) setNotice(`${item.label} · ${fmtShort(item.eventDate)} isn't in your upcoming list.`);
    } catch {
      setNotice('Search failed — try again.');
    } finally {
      setLoading(false);
    }
  }

  function clear() {
    restoreFilter();
    setNotice(null);
    setCode('');
  }

  function collapse() {
    clear();
    setExpanded(false);
  }

  if (pathname !== DASHBOARD || !iconHost) return null;

  const inputStyle: React.CSSProperties = {
    width: 190, minWidth: 0, background: '#16161f', color: '#fff',
    border: '1px solid rgba(255,255,255,.16)', borderRadius: 8, padding: '7px 11px',
    fontSize: '.82rem', outline: 'none', letterSpacing: '.02em',
  };
  const pillBtn: React.CSSProperties = {
    flexShrink: 0, background: 'var(--neon,#00e0a4)', color: '#04241c', border: 'none',
    borderRadius: 8, padding: '0 14px', height: 30, fontWeight: 700, fontSize: '.8rem', cursor: 'pointer',
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
        onKeyDown={(e) => { if (e.key === 'Enter') run(); else if (e.key === 'Escape') collapse(); }}
        placeholder="GDC-1A2B-D"
        style={inputStyle}
      />
      <button type="button" onClick={run} style={pillBtn}>{loading ? '…' : 'Find'}</button>
      {(active || notice || code) && (
        <button type="button" onClick={clear} style={ghostBtn}>Clear</button>
      )}
      {notice && (
        <span style={{ color: 'rgba(255,255,255,.6)', fontSize: '.76rem' }}>{notice}</span>
      )}
    </span>
  ) : (
    <MagnifierBtn onClick={() => setExpanded(true)} title="Find by payment code" />
  );

  return createPortal(iconUI, iconHost);
}
