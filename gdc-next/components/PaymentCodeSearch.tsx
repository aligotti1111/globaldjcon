'use client';

// PaymentCodeSearch — "find a booking by its payment code" search, shown ONLY
// on the Upcoming Bookings dashboard. Renders as a magnifier icon sitting on
// the SAME LINE as the sort buttons; clicking it expands into an input inline.
// Running a search shows just the matched booking below the sort row and hides
// the rest of the list; Clear (or collapsing) restores it.
//
// Every deposit/invoice link carries a reference code (GDC-1A2B-D) the client
// includes with their payment; the DJ pastes it here to see which booking it
// belongs to and where the money stands.
//
// Mounted from the header (so it exists on the dashboard) but it renders itself
// into the PAGE via portals — one inline slot in the sort row for the icon/
// input, one slot just below for results — so we never touch the large
// UpcomingBookingsClient.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';

type Payment = {
  kind: string | null;
  amount: number | null;
  amountPaid: number;
  status: string | null;
  currency: string;
};
type Item = {
  id: string;
  label: string;
  venueName: string | null;
  eventDate: string | null;
  requesterName: string | null;
  status: string | null;
  currency: string;
  price: number | null;
  depositCode: string;
  balanceCode: string;
  payments: Payment[];
};

const DASHBOARD = '/upcoming-bookings';

function money(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function fmtDate(d: string | null): string {
  if (!d) return 'Date TBD';
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

const PAY_STATUS: Record<string, string> = {
  requested: 'Requested',
  pending_confirmation: 'Client says sent',
  partial: 'Partly paid',
  paid: 'Paid',
  waived: 'Waived',
};

function kindLabel(kind: string | null): string {
  if (kind === 'deposit') return 'Deposit';
  if (kind === 'balance') return 'Balance';
  return 'Payment';
}

// The sort row = the smallest element containing both "By date" and
// "Recently"; that's where the magnifier lives, and results go right after it.
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
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [iconHost, setIconHost] = useState<HTMLElement | null>(null);
  const [resultHost, setResultHost] = useState<HTMLElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const iconHostRef = useRef<HTMLElement | null>(null);
  const resultHostRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Month sections we hide while a result is shown, so only the match shows.
  const hiddenRef = useRef<HTMLElement[]>([]);

  function restoreList() {
    hiddenRef.current.forEach((s) => { s.style.display = ''; });
    hiddenRef.current = [];
  }

  // Create + place the two slots on the dashboard; tear down on leave.
  useEffect(() => {
    if (pathname !== DASHBOARD) return;
    let cancelled = false;
    let tries = 0;
    const place = () => {
      if (cancelled) return;
      const sortRow = findSortRow();
      const fallback = (document.querySelector('main') as HTMLElement | null);
      const anchorParent = sortRow?.parentElement || fallback;
      if (sortRow && anchorParent) {
        const icon = document.createElement('span');
        icon.setAttribute('data-gdc', 'paycode-icon');
        icon.style.display = 'inline-flex';
        icon.style.alignItems = 'center';
        icon.style.marginLeft = '10px';
        sortRow.appendChild(icon); // same line as the sort buttons

        const res = document.createElement('div');
        res.setAttribute('data-gdc', 'paycode-result');
        anchorParent.insertBefore(res, sortRow.nextSibling); // just below the sort row

        iconHostRef.current = icon;
        resultHostRef.current = res;
        setIconHost(icon);
        setResultHost(res);
        return;
      }
      tries += 1;
      if (tries < 40) setTimeout(place, 100);
    };
    place();
    return () => {
      cancelled = true;
      restoreList();
      [iconHostRef, resultHostRef].forEach((r) => {
        if (r.current && r.current.parentElement) r.current.parentElement.removeChild(r.current);
        r.current = null;
      });
      setIconHost(null);
      setResultHost(null);
    };
  }, [pathname]);

  // Focus the input when it expands.
  useEffect(() => {
    if (expanded) setTimeout(() => inputRef.current?.focus(), 40);
  }, [expanded]);

  // When a booking is found, collapse the rest of the list (month sections)
  // so only the matched booking box shows. Restore otherwise.
  useEffect(() => {
    const res = resultHostRef.current;
    if (!res) return;
    restoreList();
    if (Array.isArray(items) && items.length > 0) {
      const sibs: HTMLElement[] = [];
      let n = res.nextElementSibling as HTMLElement | null;
      while (n) { sibs.push(n); n = n.nextElementSibling as HTMLElement | null; }
      sibs.forEach((s) => { s.style.display = 'none'; });
      hiddenRef.current = sibs;
    }
  }, [items, resultHost]);

  async function run() {
    const q = code.trim();
    if (!q) return;
    setLoading(true);
    setItems(null);
    try {
      const r = await fetch(`/api/dj/find-by-code?code=${encodeURIComponent(q)}`, { cache: 'no-store' });
      const j = await r.json();
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  function collapse() {
    setExpanded(false);
    setItems(null);
    setCode('');
  }

  if (pathname !== DASHBOARD || !iconHost || !resultHost) return null;

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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
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
      {items != null && (
        <button type="button" onClick={() => { setItems(null); setCode(''); }} style={ghostBtn}>Clear</button>
      )}
    </span>
  ) : (
    <MagnifierBtn onClick={() => setExpanded(true)} title="Find by payment code" />
  );

  const resultUI = items == null ? null : (
    <div style={{ margin: '14px 0 22px', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
      {items.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,.5)', fontSize: '.85rem' }}>
          No booking matches that code.
        </div>
      ) : (
        items.map((it) => (
          <div
            key={it.id}
            style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '12px 14px', background: '#0d0d14' }}
          >
            <div style={{ color: '#fff', fontSize: '.95rem', fontWeight: 700 }}>
              {it.label}{it.price != null ? ` · ${money(it.price, it.currency)}` : ''}
            </div>
            <div style={{ color: 'rgba(255,255,255,.65)', fontSize: '.78rem', marginTop: 2 }}>
              {fmtDate(it.eventDate)}{it.venueName ? ` · ${it.venueName}` : ''}
            </div>
            {it.requesterName && (
              <div style={{ color: 'rgba(255,255,255,.5)', fontSize: '.76rem', marginTop: 1 }}>{it.requesterName}</div>
            )}

            {it.payments.length > 0 ? (
              <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {it.payments.map((p, i) => {
                  const chip = p.status === 'paid' ? '#00e0a4'
                    : (p.status === 'partial' || p.status === 'pending_confirmation') ? '#f5c451'
                    : 'rgba(255,255,255,.55)';
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.78rem' }}>
                      <span style={{ color: 'rgba(255,255,255,.8)' }}>
                        {kindLabel(p.kind)}{p.amount != null ? ` · ${money(p.amount, p.currency)}` : ''}
                      </span>
                      <span style={{ color: chip, fontWeight: 600 }}>
                        {PAY_STATUS[p.status || ''] || p.status || '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ marginTop: 9, color: 'rgba(255,255,255,.45)', fontSize: '.76rem' }}>
                No payment requested yet.
              </div>
            )}

            <div style={{ marginTop: 7, color: 'rgba(255,255,255,.4)', fontSize: '.68rem', fontFamily: 'monospace' }}>
              {it.depositCode} · {it.balanceCode}
            </div>

            <button
              type="button"
              onClick={() => router.push(`/upcoming-bookings?open=${encodeURIComponent(it.id)}`)}
              style={{
                marginTop: 10, padding: '8px 14px',
                background: 'transparent', border: '1px solid rgba(0,224,164,.45)', borderRadius: 7,
                color: 'var(--neon,#00e0a4)', fontWeight: 700, fontSize: '.78rem', cursor: 'pointer',
              }}
            >
              Open booking →
            </button>
          </div>
        ))
      )}
    </div>
  );

  return (
    <>
      {createPortal(iconUI, iconHost)}
      {createPortal(resultUI, resultHost)}
    </>
  );
}
