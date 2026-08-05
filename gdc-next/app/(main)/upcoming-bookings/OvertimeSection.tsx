'use client';

// OvertimeSection — day-of overtime for a MOBILE booking. Shown in the expanded
// booking details panel as a single "Add overtime to event" button; clicking it
// opens a popup to enter the hours + rate and act on them. Overtime is added
// last-minute: the DJ enters the extra hours and a per-hour rate (defaulting to
// the contract's overtime rate), optionally applies tax (the saved rate,
// editable or removable), then either:
//   • Send invoice          — bills the overtime ALONE (what's owed right now), or
//   • Mark paid & send receipt — records it paid and emails a COMBINED receipt
//                                (event total + overtime, one grand total).
// Once set, the DJ can resend, download the receipt, or remove the overtime.
//
// It never touches the deposit/balance ledger — overtime lives on its own booking
// columns, so it can't move the event balance. All the money math is mirrored
// server-side; this is just the entry + status UI.

import { useState } from 'react';
import { createPortal } from 'react-dom';

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
  const [savedHours, setSavedHours] = useState<number | null>(initial.hours);
  const [savedRate, setSavedRate] = useState<number | null>(initial.rate);
  const [savedTax, setSavedTax] = useState<number | null>(initial.tax);
  const [savedAmount, setSavedAmount] = useState<number | null>(initial.amount);
  const hasSaved = savedAmount != null && Number(savedAmount) > 0;

  const [open, setOpen] = useState(false);

  // Form state — seeded from any saved overtime so the popup reopens with the
  // same numbers.
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

  function rememberSaved() {
    setSavedHours(h); setSavedRate(r); setSavedTax(taxVal); setSavedAmount(total);
  }

  async function post(action: string): Promise<boolean> {
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, bookingId, hours: h, rate: r, tax: taxVal }),
    });
    if (!res.ok) { setErr((await res.text()).slice(0, 180) || 'Something went wrong.'); return false; }
    return true;
  }

  async function sendInvoice() {
    if (!valid) { setErr('Enter hours and a rate greater than zero.'); return; }
    setBusy('invoice'); setErr(null); setMsg(null);
    if (await post('overtime-invoice')) { setInvoicedAt(new Date().toISOString()); rememberSaved(); setMsg('Overtime invoice sent.'); }
    setBusy('');
  }

  async function markPaid() {
    if (!valid) { setErr('Enter hours and a rate greater than zero.'); return; }
    setBusy('receipt'); setErr(null); setMsg(null);
    if (await post('overtime-receipt')) {
      const now = new Date().toISOString();
      setPaidAt(now);
      if (!invoicedAt) setInvoicedAt(now);
      rememberSaved();
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
      setSavedHours(null); setSavedRate(null); setSavedTax(null); setSavedAmount(null);
      setHours(''); setRate(defaultRate != null ? String(defaultRate) : '');
      setTaxEdited(false); setTaxStr(''); setApplyTax(taxPct > 0);
      setMsg(null); setOpen(false);
    }
    setBusy('');
  }

  const anyBusy = busy !== '';
  const statusLabel = paidAt ? 'Paid' : invoicedAt ? 'Invoiced' : null;

  const input: React.CSSProperties = {
    width: '100%', background: '#16161f', color: '#fff', border: '1px solid rgba(255,255,255,.16)',
    borderRadius: 8, padding: '9px 11px', fontSize: '.88rem', outline: 'none',
  };
  const primaryBtn: React.CSSProperties = {
    background: NEON, border: 'none', color: '#06231b', fontWeight: 800, fontSize: '.85rem',
    borderRadius: 8, padding: '.6rem 1.1rem', cursor: anyBusy ? 'default' : 'pointer', opacity: anyBusy ? 0.6 : 1,
  };
  const ghostBtn: React.CSSProperties = {
    background: 'transparent', border: '1px solid rgba(255,255,255,.22)', color: '#fff', fontWeight: 700,
    fontSize: '.82rem', borderRadius: 8, padding: '.55rem 1rem', cursor: anyBusy ? 'default' : 'pointer', opacity: anyBusy ? 0.6 : 1,
  };

  // ── Trigger — a compact inline link, shown right next to the Overtime Rate
  // in the details grid. Opens the entry popup. ──
  const trigger = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={() => { if (canManage) { setErr(null); setMsg(null); setOpen(true); } }}
        disabled={!canManage}
        style={{
          background: 'none', border: 'none', padding: 0, color: NEON, fontWeight: 700,
          fontSize: '.8rem', textDecoration: 'underline', textUnderlineOffset: 2,
          cursor: canManage ? 'pointer' : 'default', opacity: canManage ? 1 : 0.5,
        }}
      >
        {hasSaved ? 'Manage invoice / receipt' : 'Send invoice / receipt'}
      </button>
      {hasSaved && (
        <span style={{ fontSize: '.78rem', color: 'rgba(255,255,255,.65)' }}>
          {money(Number(savedAmount), currency)}
          {statusLabel && <span style={{ color: paidAt ? NEON : '#ffb020', fontWeight: 700 }}> · {statusLabel}</span>}
        </span>
      )}
    </span>
  );

  if (!open) return trigger;

  // ── Popup ──
  const modal = (
    <div
      onClick={() => { if (!anyBusy) setOpen(false); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10002, background: 'rgba(0,0,0,.65)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '2.5rem 1rem', overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', width: '100%', maxWidth: 440,
          background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.14)',
          borderRadius: 14, padding: '1.3rem 1.4rem', boxShadow: '0 16px 50px rgba(0,0,0,.6)',
        }}
      >
        <button
          type="button" onClick={() => setOpen(false)} aria-label="Close"
          style={{
            position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: '50%',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.18)', color: '#fff', cursor: 'pointer',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.7rem' }}>
          <div style={{ fontWeight: 800, color: '#fff', fontSize: '1.05rem' }}>Overtime</div>
          {statusLabel && (
            <span style={{ fontSize: '.7rem', fontWeight: 800, color: paidAt ? NEON : '#ffb020', letterSpacing: '.04em', textTransform: 'uppercase' }}>{statusLabel}</span>
          )}
        </div>

        <p style={{ fontSize: '.76rem', color: 'rgba(255,255,255,.6)', lineHeight: 1.5, margin: '0 0 1rem' }}>
          The overtime invoice acts independently from the event balance. After it&rsquo;s paid — or you mark it paid — a receipt showing the total cost of the event is sent to the host.
        </p>

        <div style={{ display: 'flex', gap: '.6rem', marginBottom: '.7rem', flexWrap: 'wrap' }}>
          <label style={{ flex: '1 1 120px', minWidth: 0 }}>
            <div style={{ fontSize: '.68rem', color: 'rgba(255,255,255,.55)', marginBottom: '.3rem', letterSpacing: '.04em' }}>HOURS</div>
            <input style={input} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="1" />
          </label>
          <label style={{ flex: '1 1 120px', minWidth: 0 }}>
            <div style={{ fontSize: '.68rem', color: 'rgba(255,255,255,.55)', marginBottom: '.3rem', letterSpacing: '.04em' }}>RATE / HR</div>
            <input style={input} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="150" />
          </label>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.85rem', color: '#fff', cursor: 'pointer', marginBottom: applyTax ? '.55rem' : '.8rem' }}>
          <input
            type="checkbox"
            checked={applyTax}
            onChange={(e) => {
              setApplyTax(e.target.checked);
              // Turning tax back ON always re-applies the booked-rate auto amount
              // (drops any stale typed/saved override). Turning it off clears the
              // override too, so re-checking is always a clean auto calculation.
              setTaxEdited(false);
              setTaxStr('');
            }}
          />
          Apply tax{taxPct > 0 ? ` (${taxPct}%)` : ''}
        </label>
        {applyTax && (
          <label style={{ display: 'block', marginBottom: '.8rem' }}>
            <div style={{ fontSize: '.68rem', color: 'rgba(255,255,255,.55)', marginBottom: '.3rem', letterSpacing: '.04em' }}>TAX AMOUNT</div>
            <input
              style={{ ...input, maxWidth: 170 }}
              inputMode="decimal"
              value={taxEdited ? taxStr : (valid ? String(autoTax) : '')}
              // Clearing the field reverts to the auto (booked-rate) amount rather
              // than sticking at an empty override.
              onChange={(e) => { const v = e.target.value; if (v.trim() === '') { setTaxEdited(false); setTaxStr(''); } else { setTaxEdited(true); setTaxStr(v); } }}
              placeholder="0.00"
            />
          </label>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '0 0 1rem', paddingTop: '.6rem', borderTop: '1px solid rgba(255,255,255,.08)' }}>
          <span style={{ fontSize: '.82rem', color: 'rgba(255,255,255,.6)' }}>Overtime total</span>
          <span style={{ fontSize: '1.15rem', fontWeight: 800, color: NEON }}>{valid ? money(total, currency) : '—'}</span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
          {paidAt ? (
            <>
              <button type="button" style={primaryBtn} disabled={anyBusy} onClick={markPaid}>{busy === 'receipt' ? 'Sending…' : 'Resend receipt'}</button>
              <button type="button" style={ghostBtn} disabled={anyBusy} onClick={downloadReceipt}>{busy === 'download' ? 'Preparing…' : 'Download receipt'}</button>
            </>
          ) : (
            <>
              <button type="button" style={{ ...primaryBtn, opacity: (anyBusy || !valid) ? 0.4 : 1, cursor: (anyBusy || !valid) ? 'not-allowed' : 'pointer' }} disabled={anyBusy || !valid} onClick={sendInvoice}>{busy === 'invoice' ? 'Sending…' : 'Send invoice'}</button>
              <button type="button" style={{ ...ghostBtn, opacity: (anyBusy || !valid) ? 0.4 : 1, cursor: (anyBusy || !valid) ? 'not-allowed' : 'pointer' }} disabled={anyBusy || !valid} onClick={markPaid}>{busy === 'receipt' ? 'Sending…' : 'Mark paid & send receipt'}</button>
            </>
          )}
        </div>

        {hasSaved && (
          <button
            type="button"
            onClick={remove}
            disabled={anyBusy}
            style={{
              display: 'inline-block', marginTop: '.8rem', background: 'none', border: 'none', padding: 0,
              color: '#ff8a8a', fontSize: '.8rem', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2,
              cursor: anyBusy ? 'default' : 'pointer', opacity: anyBusy ? 0.6 : 1,
            }}
          >
            {busy === 'clear' ? 'Cancelling…' : 'Cancel invoice'}
          </button>
        )}

        {err && <div style={{ color: '#ff7676', fontSize: '.78rem', fontWeight: 600, marginTop: '.7rem' }}>{err}</div>}
        {msg && <div style={{ color: NEON, fontSize: '.78rem', fontWeight: 600, marginTop: '.7rem' }}>{msg}</div>}
      </div>
    </div>
  );

  return (
    <>
      {trigger}
      {typeof document !== 'undefined' ? createPortal(modal, document.body) : null}
    </>
  );
}
