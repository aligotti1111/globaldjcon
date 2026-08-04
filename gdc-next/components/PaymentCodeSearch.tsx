'use client';

// PaymentCodeSearch — "find a booking by its payment code" search, shown ONLY
// on the Upcoming Bookings dashboard, as an in-page search bar (not a header
// icon). Every deposit/invoice link carries a reference code (GDC-1A2B-D) the
// client includes with their payment; when a Venmo/Zelle/etc. lands the DJ
// pastes that code here to see which booking it belongs to and where the money
// stands.
//
// It's mounted from the header (so it exists on the dashboard), but it renders
// itself into the PAGE via a portal, dropped in just above the sort row. That
// keeps it on the dashboard body without having to edit the large
// UpcomingBookingsClient — the search hosts its own slot in the DOM.

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

// Find (or create) the in-page slot the search bar renders into: a div dropped
// right before the SORT row. Falls back to just under the page title, then to
// the top of <main>. Polls briefly because the dashboard hydrates the sort row
// after mount.
function findAnchorParentAndBefore(): { parent: HTMLElement; before: Node | null } | null {
  const buttons = Array.from(document.querySelectorAll('button'));
  const byDate = buttons.find((b) => /by date/i.test(b.textContent || ''));
  if (byDate) {
    // Walk up to the smallest block that holds the whole sort row.
    let row: HTMLElement | null = byDate;
    for (let i = 0; i < 4 && row; i++) {
      const t = row.textContent || '';
      if (/by date/i.test(t) && /recently/i.test(t) && row.parentElement) {
        return { parent: row.parentElement, before: row };
      }
      row = row.parentElement;
    }
    if (byDate.parentElement?.parentElement) {
      return { parent: byDate.parentElement.parentElement, before: byDate.parentElement };
    }
  }
  const heading = Array.from(document.querySelectorAll('h1, h2, h3'))
    .find((h) => /upcoming bookings/i.test(h.textContent || ''));
  if (heading?.parentElement) {
    return { parent: heading.parentElement, before: heading.nextSibling };
  }
  const main = document.querySelector('main');
  if (main) return { parent: main, before: main.firstChild };
  return null;
}

export default function PaymentCodeSearch() {
  const [code, setCode] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const hostRef = useRef<HTMLElement | null>(null);
  // Elements (the sort row + month sections) we hide while a result is shown,
  // so the page shows ONLY the matched booking. Restored on clear/unmount.
  const hiddenRef = useRef<HTMLElement[]>([]);

  function restoreList() {
    hiddenRef.current.forEach((s) => { s.style.display = ''; });
    hiddenRef.current = [];
  }

  // Create + place the host slot on the dashboard; tear it down on leave.
  useEffect(() => {
    if (pathname !== DASHBOARD) return;
    let cancelled = false;
    let tries = 0;
    const place = () => {
      if (cancelled) return;
      const spot = findAnchorParentAndBefore();
      if (spot) {
        const el = document.createElement('div');
        el.setAttribute('data-gdc', 'paycode-search');
        spot.parent.insertBefore(el, spot.before);
        hostRef.current = el;
        setHost(el);
        return;
      }
      tries += 1;
      if (tries < 40) setTimeout(place, 100);
    };
    place();
    return () => {
      cancelled = true;
      restoreList();
      const el = hostRef.current;
      if (el && el.parentElement) el.parentElement.removeChild(el);
      hostRef.current = null;
      setHost(null);
    };
  }, [pathname]);

  // When a booking is found, collapse the rest of the dashboard (sort row +
  // month sections) so only the matched booking box shows. Restore otherwise.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    restoreList();
    if (Array.isArray(items) && items.length > 0) {
      const sibs: HTMLElement[] = [];
      let n = el.nextElementSibling as HTMLElement | null;
      while (n) { sibs.push(n); n = n.nextElementSibling as HTMLElement | null; }
      sibs.forEach((s) => { s.style.display = 'none'; });
      hiddenRef.current = sibs;
    }
  }, [items, host]);

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

  if (pathname !== DASHBOARD || !host) return null;

  const bar = (
    <div style={{ margin: '0 0 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ color: 'rgba(255,255,255,.55)', fontSize: '.72rem', letterSpacing: '.14em', textTransform: 'uppercase' }}>
          Find by payment code
        </span>
        <div style={{ display: 'flex', gap: 8, flex: '1 1 260px', maxWidth: 420 }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            placeholder="e.g. GDC-1A2B-D"
            style={{
              flex: 1, minWidth: 0, background: '#16161f', color: '#fff',
              border: '1px solid rgba(255,255,255,.16)', borderRadius: 8, padding: '9px 12px',
              fontSize: '.85rem', outline: 'none', letterSpacing: '.02em',
            }}
          />
          <button
            type="button"
            onClick={run}
            style={{
              flexShrink: 0, background: 'var(--neon,#00e0a4)', color: '#04241c', border: 'none',
              borderRadius: 8, padding: '0 16px', fontWeight: 700, fontSize: '.82rem', cursor: 'pointer',
            }}
          >
            {loading ? '…' : 'Find'}
          </button>
          {items != null && (
            <button
              type="button"
              onClick={() => { setItems(null); setCode(''); }}
              style={{
                flexShrink: 0, background: 'transparent', color: 'rgba(255,255,255,.55)',
                border: '1px solid rgba(255,255,255,.16)', borderRadius: 8, padding: '0 12px',
                fontSize: '.82rem', cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {items != null && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
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
      )}
    </div>
  );

  return createPortal(bar, host);
}
