'use client';

// OvertimeSection — day-of overtime for a MOBILE booking, shown in the expanded
// booking details panel (mobile bookings only). Overtime is added last-minute:
// the DJ enters the extra hours and a per-hour rate (defaulting to the contract's
// overtime rate), optionally applies tax (the saved rate, editable or removable),
// and then either:
//   • Send invoice          — bills the overtime ALONE (what's owed right now), or
//   • Mark paid & send receipt — records it paid and emails a COMBINED receipt
//                                (event total + overtime, one grand total).
// Once set, the DJ can resend, download the receipt, or remove the overtime.
//
// It never touches the deposit/balance ledger — overtime lives on its own booking
// columns, so it can't move the event balance. All the money math is mirrored
// server-side; this is just the entry + status UI.

import { useState } from 'react';

const NEON = 'var(--neon,#00e0a4)';

interface OvertimeInitial {
  hours: number | null;
  rate: number | null;
  tax: number | null;
  amount: number | null;
  invoicedAt: string | null;
  paidAt: string | null;
}

interface Props {
  bookingId: string;
  currency: string;
  /** The booking's own tax rate (frozen snapshot) or the DJ's live rate. */
  taxPct: number;
  /** Contract per-hour overtime rate — prefills the rate field. */
  defaultRate: number | null;
  /** Persisted overtime state from the booking row. */
  initial: OvertimeInitial;
  /** Manager+ money permission. Assistants can't send. */
  canManage: boolean;
}

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function OvertimeSection({ bookingId, currency, taxPct, defaultRate, initial, canManage }: Props) {
  const hasSaved = initial.amount != null && Number(initial.amount) > 0;

  // Form state. Seeded from any saved overtime so "Edit" reopens with the same
  // numbers.
  const [editing, setEditing] = useState(!hasSaved);
  const [hours, setHours] = useState(initial.hours != null ? String(initial.hours) : '');
  const [rate, setRate] = useState(
    initial.rate != null ? String(initial.rate) : (defaultRate != null ? String(defaultRate) : ''),
  );
  const [applyTax, setApplyTax] = useState(initial.tax != null ? Number(initial.tax) > 0 : taxPct > 0);
  const [taxEdited, setTaxEdited] = useState(initial.tax != null && Number(initial.tax) > 0);
  const [taxStr, setTaxStr] = useState(initial.tax != null && Number(initial.tax) > 0 ? String(initial.tax) : '');

  const [invoicedAt, setInvoicedAt] = useState<string | null>(initial.invoicedAt);
  const [paidAt, setPaidAt] = useState<string | null>(initial.paidAt);

  const [busy, setBusy] = useState<'' | 'invoice' | 'receipt' | 'download' | 'clear'>('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const h = parseFloat(hours);
  const r = parseFloat(rate);
  const valid = Number.isFinite(h) && h > 0 && Number.isFinite(r) && r > 0;
  const sub = valid ? round2(h * r) : 0;
  const autoTax = round2((sub * taxPct) / 100);
  const taxVal = applyTax ? (taxEdited ? round2(Math.max(0, parseFloat(taxStr) || 0)) : autoTax) : 0;
  const total = round2(sub + taxVal);

  async function post(action: string): Promise<Record<string, unknown> | null> {
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, bookingId, hours: h, rate: r, tax: taxVal }),
    });
    if (!res.ok) {
      const raw = await res.text();
      setErr(raw.slice(0, 180) || 'Something went wrong.');
      return null;
    }
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  async function sendInvoice() {
    if (!valid) { setErr('Enter hours and a rate greater than zero.'); return; }
    setBusy('invoice'); setErr(null); setMsg(null);
    const ok = await post('overtime-invoice');
    if (ok) { setInvoicedAt(new Date().toISOString()); setEditing(false); setMsg('Overtime invoice sent.'); }
    setBusy('');
  }

  async function markPaid() {
    if (!valid) { setErr('Enter hours and a rate greater than zero.'); return; }
    setBusy('receipt'); setErr(null); setMsg(null);
    const ok = await post('overtime-receipt');
    if (ok) {
      const now = new Date().toISOString();
      setPaidAt(now);
      if (!invoicedAt) setInvoicedAt(now);
      setEditing(false);
      setMsg('Marked paid — receipt sent.');
    }
    setBusy('');
  }

  async function downloadReceipt() {
    setBusy('download'); setErr(null); setMsg(null);
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'overtime-download-receipt', bookingId, hours: h, rate: r, tax: taxVal }),
      });
      if (!res.ok) { setErr((await res.text()).slice(0, 180) || 'Could not build the receipt.'); }
      else {
        const blob = await res.blob();
        const cd = res.headers.get('Content-Disposition') || '';
        const m = /filename="?([^"]+)"?/.exec(cd);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = m ? m[1] : `Overtime-Receipt-${bookingId.slice(0, 6)}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    } catch { setErr('Could not build the receipt.'); }
    setBusy('');
  }

  async function remove() {
    setBusy('clear'); setErr(null); setMsg(null);
    const res = await fetch('/api/payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'overtime-clear', bookingId }),
    });
    if (!res.ok) { setErr((await res.text()).slice(0, 180) || 'Could not remove overtime.'); }
    else {
      setInvoicedAt(null); setPaidAt(null);
      setHours(''); setRate(defaultRate != null ? String(defaultRate) : '');
      setTaxEdited(false); setTaxStr(''); setApplyTax(taxPct > 0);
      setEditing(true); setMsg(null);
    }
    setBusy('');
  }

  const anyBusy = busy !== '';
  const statusLabel = paidAt ? 'Paid' : invoicedAt ? 'Invoiced' : null;

  const input: React.CSSProperties = {
    width: '100%', background: '#16161f', color: '#fff', border: '1px solid rgba(255,255,255,.16)',
    borderRadius: 8, padding: '8px 10px', fontSize: '.85rem', outline: 'none',
  };
  const primaryBtn: React.CSSProperties = {
    background: NEON, border: 'none', color: '#06231b', fontWeight: 800, fontSize: '.82rem',
    borderRadius: 8, padding: '.55rem 1rem', cursor: anyBusy ? 'default' : 'pointer', opacity: anyBusy ? 0.6 : 1,
  };
  const ghostBtn: React.CSSProperties = {
    background: 'transparent', border: '1px solid rgba(255,255,255,.22)', color: '#fff', fontWeight: 700,
    fontSize: '.8rem', borderRadius: 8, padding: '.5rem .9rem', cursor: anyBusy ? 'default' : 'pointer', opacity: anyBusy ? 0.6 : 1,
  };

  return (
    <div style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem' }}>
        <div style={{ fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.55)', fontWeight: 700 }}>
          Overtime
        </div>
        {statusLabel && (
          <span style={{ fontSize: '.7rem', fontWeight: 800, color: paidAt ? NEON : '#ffb020', letterSpacing: '.04em' }}>
            {statusLabel}
          </span>
        )}
      </div>

      <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 12, padding: '.9rem 1rem' }}>
        {!canManage ? (
          <div style={{ fontSize: '.8rem', color: 'rgba(255,255,255,.6)' }}>
            {hasSaved
              ? `Overtime: ${money(Number(initial.amount), currency)}${paidAt ? ' · paid' : invoicedAt ? ' · invoiced' : ''}`
              : 'No overtime added.'}
          </div>
        ) : !editing ? (
          // ── Saved summary + actions ──
          <>
            <div style={{ fontSize: '.9rem', color: '#fff', fontWeight: 700, marginBottom: '.15rem' }}>
              {hours || initial.hours} hr{Number(hours || initial.hours) === 1 ? '' : 's'} × {money(r || Number(initial.rate) || 0, currency)}
              {taxVal > 0 || (initial.tax != null && Number(initial.tax) > 0) ? ` + ${money(taxVal || Number(initial.tax) || 0, currency)} tax` : ''}
            </div>
            <div style={{ fontSize: '1.05rem', color: NEON, fontWeight: 800, marginBottom: '.7rem' }}>
              {money(total || Number(initial.amount) || 0, currency)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
              {paidAt ? (
                <>
                  <button type="button" style={ghostBtn} disabled={anyBusy} onClick={markPaid}>{busy === 'receipt' ? 'Sending…' : 'Resend receipt'}</button>
                  <button type="button" style={ghostBtn} disabled={anyBusy} onClick={downloadReceipt}>{busy === 'download' ? 'Preparing…' : 'Download receipt'}</button>
                </>
              ) : (
                <>
                  <button type="button" style={primaryBtn} disabled={anyBusy} onClick={markPaid}>{busy === 'receipt' ? 'Sending…' : 'Mark paid & send receipt'}</button>
                  <button type="button" style={ghostBtn} disabled={anyBusy} onClick={sendInvoice}>{busy === 'invoice' ? 'Sending…' : 'Resend invoice'}</button>
                </>
              )}
              <button type="button" style={ghostBtn} disabled={anyBusy} onClick={() => { setEditing(true); setMsg(null); setErr(null); }}>Edit</button>
              <button type="button" style={{ ...ghostBtn, color: '#ff8a8a', borderColor: 'rgba(255,120,120,.4)' }} disabled={anyBusy} onClick={remove}>{busy === 'clear' ? 'Removing…' : 'Remove'}</button>
            </div>
          </>
        ) : (
          // ── Entry form ──
          <>
            <div style={{ display: 'flex', gap: '.6rem', marginBottom: '.6rem', flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 120px', minWidth: 0 }}>
                <div style={{ fontSize: '.68rem', color: 'rgba(255,255,255,.55)', marginBottom: '.25rem', letterSpacing: '.04em' }}>HOURS</div>
                <input style={input} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="1" />
              </label>
              <label style={{ flex: '1 1 120px', minWidth: 0 }}>
                <div style={{ fontSize: '.68rem', color: 'rgba(255,255,255,.55)', marginBottom: '.25rem', letterSpacing: '.04em' }}>RATE / HR</div>
                <input style={input} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="150" />
              </label>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.82rem', color: '#fff', cursor: 'pointer', marginBottom: applyTax ? '.5rem' : '.7rem' }}>
              <input type="checkbox" checked={applyTax} onChange={(e) => { setApplyTax(e.target.checked); if (!e.target.checked) { setTaxEdited(false); } }} />
              Apply tax{taxPct > 0 ? ` (${taxPct}%)` : ''}
            </label>
            {applyTax && (
              <label style={{ display: 'block', marginBottom: '.7rem' }}>
                <div style={{ fontSize: '.68rem', color: 'rgba(255,255,255,.55)', marginBottom: '.25rem', letterSpacing: '.04em' }}>TAX AMOUNT</div>
                <input
                  style={{ ...input, maxWidth: 160 }}
                  inputMode="decimal"
                  value={taxEdited ? taxStr : (valid ? String(autoTax) : '')}
                  onChange={(e) => { setTaxEdited(true); setTaxStr(e.target.value); }}
                  placeholder="0.00"
                />
              </label>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '0 0 .8rem', paddingTop: '.5rem', borderTop: '1px solid rgba(255,255,255,.08)' }}>
              <span style={{ fontSize: '.8rem', color: 'rgba(255,255,255,.6)' }}>Overtime total</span>
              <span style={{ fontSize: '1.05rem', fontWeight: 800, color: NEON }}>{valid ? money(total, currency) : '—'}</span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
              <button type="button" style={primaryBtn} disabled={anyBusy || !valid} onClick={sendInvoice}>{busy === 'invoice' ? 'Sending…' : 'Send invoice'}</button>
              <button type="button" style={ghostBtn} disabled={anyBusy || !valid} onClick={markPaid}>{busy === 'receipt' ? 'Sending…' : 'Mark paid & send receipt'}</button>
              {hasSaved && (
                <button type="button" style={ghostBtn} disabled={anyBusy} onClick={() => { setEditing(false); setErr(null); }}>Cancel</button>
              )}
            </div>
          </>
        )}

        {err && <div style={{ color: '#ff7676', fontSize: '.76rem', fontWeight: 600, marginTop: '.6rem' }}>{err}</div>}
        {msg && <div style={{ color: NEON, fontSize: '.76rem', fontWeight: 600, marginTop: '.6rem' }}>{msg}</div>}
      </div>
    </div>
  );
}
