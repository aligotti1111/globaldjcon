'use client';

// PaymentCodeSearch — the header's "find a booking by its payment code" search.
// Every deposit/invoice link carries a reference code (GDC-1A2B-D) the client
// includes in their payment note; when a Venmo/Zelle/etc. lands, the DJ pastes
// that code here to see which booking it belongs to and where the money stands.
//
// Sits as a magnifier icon in the header toolbar. Clicking opens a small panel
// (fixed-position, measured off the button — the header clips overflow) with an
// input and inline results. Each result links to the booking on the dashboard.

import { useEffect, useRef, useState } from 'react';
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

// Friendly label for a payment's status. Mirrors the meaning used on the
// booking card: the client can only ever CLAIM ("says sent"); the DJ confirms.
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

export default function PaymentCodeSearch() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 68, right: 16 });
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: Math.round(r.bottom + 10), right: Math.max(8, Math.round(window.innerWidth - r.right)) });
    }
    setOpen((v) => !v);
  }

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40);
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

  // Dashboard-only: the payment-code search belongs on the Upcoming Bookings
  // page (where the DJ manages bookings + payments), not in the global header
  // on every page. Hooks above run unconditionally; this gate is safe here.
  if (pathname !== '/upcoming-bookings') return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        type="button"
        className="inbox-nav-btn"
        title="Find booking by payment code"
        aria-label="Find booking by payment code"
        onClick={toggle}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          style={{
            position: 'fixed', top: pos.top, right: pos.right, width: 340, maxHeight: '70vh', overflowY: 'auto',
            background: '#0d0d14', border: '1px solid rgba(255,255,255,.14)', borderRadius: 12,
            boxShadow: '0 14px 44px rgba(0,0,0,.6)', zIndex: 100000,
          }}
        >
          <div style={{ padding: '12px 15px', borderBottom: '1px solid rgba(255,255,255,.08)', fontWeight: 700, fontSize: '.92rem', color: '#fff' }}>
            Find booking by code
          </div>

          <div style={{ padding: '12px 15px', display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
              placeholder="e.g. GDC-1A2B-D"
              style={{
                flex: 1, minWidth: 0, background: '#16161f', color: '#fff',
                border: '1px solid rgba(255,255,255,.16)', borderRadius: 8, padding: '9px 11px',
                fontSize: '.85rem', outline: 'none', letterSpacing: '.02em',
              }}
            />
            <button
              type="button"
              onClick={run}
              style={{
                flexShrink: 0, background: 'var(--neon,#00e0a4)', color: '#04241c', border: 'none',
                borderRadius: 8, padding: '0 14px', fontWeight: 700, fontSize: '.82rem', cursor: 'pointer',
              }}
            >
              {loading ? '…' : 'Find'}
            </button>
          </div>

          {items != null && (
            <div style={{ padding: '0 15px 14px' }}>
              {items.length === 0 ? (
                <div style={{ color: 'rgba(255,255,255,.5)', fontSize: '.84rem', padding: '6px 0 4px' }}>
                  No booking matches that code.
                </div>
              ) : (
                items.map((it) => (
                  <div
                    key={it.id}
                    style={{
                      border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: '11px 12px', marginBottom: 10,
                    }}
                  >
                    <div style={{ color: '#fff', fontSize: '.9rem', fontWeight: 700 }}>
                      {it.label}{it.price != null ? ` · ${money(it.price, it.currency)}` : ''}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,.65)', fontSize: '.76rem', marginTop: 2 }}>
                      {fmtDate(it.eventDate)}{it.venueName ? ` · ${it.venueName}` : ''}
                    </div>
                    {it.requesterName && (
                      <div style={{ color: 'rgba(255,255,255,.5)', fontSize: '.74rem', marginTop: 1 }}>{it.requesterName}</div>
                    )}

                    {it.payments.length > 0 ? (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {it.payments.map((p, i) => {
                          const paid = p.status === 'paid';
                          const chip = paid ? '#00e0a4' : p.status === 'partial' ? '#f5c451' : p.status === 'pending_confirmation' ? '#f5c451' : 'rgba(255,255,255,.55)';
                          return (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.76rem' }}>
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
                      <div style={{ marginTop: 8, color: 'rgba(255,255,255,.45)', fontSize: '.74rem' }}>
                        No payment requested yet.
                      </div>
                    )}

                    <div style={{ marginTop: 6, color: 'rgba(255,255,255,.4)', fontSize: '.68rem', fontFamily: 'monospace' }}>
                      {it.depositCode} · {it.balanceCode}
                    </div>

                    <button
                      type="button"
                      onClick={() => { setOpen(false); router.push(`/upcoming-bookings?open=${encodeURIComponent(it.id)}`); }}
                      style={{
                        marginTop: 9, width: '100%', textAlign: 'center', padding: '8px',
                        background: 'transparent', border: '1px solid rgba(0,224,164,.4)', borderRadius: 7,
                        color: 'var(--neon,#00e0a4)', fontWeight: 700, fontSize: '.76rem', cursor: 'pointer',
                      }}
                    >
                      Open on dashboard →
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
