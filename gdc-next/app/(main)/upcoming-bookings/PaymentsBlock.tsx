'use client';

// PaymentsBlock — lifted out of UpcomingBookingsClient unchanged.
//
// Rendered only by BookingDetails, but pulled into its own file so the
// details panel stays readable. Self-contained: it talks to /api/payments
// over fetch and styles itself inline.

import { useState } from 'react';
import type { BookingPayment } from './page';

// ───────────────────────────────────────────────────────────────────────
// PaymentsBlock — the DJ's ledger view of one booking's booking_payments
// rows, plus the Request Deposit action. (Send Invoice used to live here too —
// it's gone; Invoice is a column on the row now.)
//
// Rules (mirroring /api/payments):
//   • Display is always "received / total due" — never the bare word
//     "partial". The rails force partials (unverified Venmo caps at
//     $299.99/week, Cash App $250 — below a typical deposit), so the
//     fraction is the honest state.
//   • Confirm records an AMOUNT (what actually arrived), not a boolean.
//     amount_paid accumulates server-side; status flips to paid only when
//     it covers the ask.
//   • client_intent = 'pay_at_event' renders distinctly — "cash on the
//     night" means something totally different to a DJ than an ignored
//     invoice, though they look identical in the DB otherwise.
//   • Purely informational — nothing here blocks any other step.
//   • Archive mode still DISPLAYS rows but hides every action.
// ───────────────────────────────────────────────────────────────────────

export default function PaymentsBlock({
  bookingId, currency, payments, onChange, archive, canRequestDeposit,
  suggestedDeposit, agreedTotal,
}: {
  bookingId: string;
  currency: string;
  payments: BookingPayment[];
  onChange: (rows: BookingPayment[]) => void;
  archive?: boolean;
  canRequestDeposit: boolean;
  /** What the booking already says the deposit is — a SUGGESTION, not a rule.
   *  Null when the DJ had no deposit policy when this booking was made, or on
   *  manual bookings. */
  suggestedDeposit?: number | null;
  /** Agreed total (tax-inclusive snapshot first). Used to suggest the invoice. */
  agreedTotal?: number | null;
}) {
  // Which action is in flight: 'request-deposit' | 'request-balance' | a paymentId.
  const [busy, setBusy] = useState<string | null>(null);

  function money(n: number): string {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(n);
    } catch {
      return `$${Number(n).toFixed(2)}`;
    }
  }

  async function post(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch('/api/payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        alert(typeof json.error === 'string' ? json.error : 'Something went wrong. Try again in a moment.');
        return null;
      }
      return json;
    } catch {
      alert('Something went wrong. Try again in a moment.');
      return null;
    }
  }

  // Request Deposit. (requestPayment still takes 'balance' — the kind is alive
  // in the data and in the Invoice column; only the panel's button is gone.)
  //
  // The DJ names the amount, prefilled with what the booking suggests. That is
  // NOT the same as trusting a client-supplied price: a booker setting their own
  // price is a forgery; a DJ setting their own invoice is just their price. It's
  // their money and their call.
  //
  // It also has to work when nothing is suggested at all — a booking made before
  // the DJ had a deposit policy, or a manual booking, has no stored
  // deposit_amount. Deriving server-side ONLY meant those bookings hit
  // "No amount to request on this booking" with no way forward.
  async function requestPayment(kind: 'deposit' | 'balance') {
    const paidSoFar = payments.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);
    const suggestion = kind === 'deposit'
      ? (suggestedDeposit != null && suggestedDeposit > 0 ? suggestedDeposit : null)
      : (agreedTotal != null ? Math.round((Number(agreedTotal) - paidSoFar) * 100) / 100 : null);

    const raw = window.prompt(
      kind === 'deposit'
        ? 'How much deposit do you want to request?'
        : 'Invoice amount? (Adjust for overtime or extras if needed.)',
      suggestion != null && suggestion > 0 ? String(suggestion) : '',
    );
    if (raw == null) return; // cancelled
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Enter an amount greater than zero.');
      return;
    }

    setBusy(`request-${kind}`);
    try {
      const json = await post({ action: 'request', bookingId, kind, amount: Math.round(amount * 100) / 100 });
      if (json && json.payment) onChange([...payments, json.payment as BookingPayment]);
    } finally { setBusy(null); }
  }

  // Confirm takes an AMOUNT — prefilled with what's outstanding, editable
  // because a capped rail means the client may only have sent part of it.
  async function confirmReceived(p: BookingPayment) {
    const outstanding = Math.max(0, Math.round((Number(p.amount) - Number(p.amount_paid || 0)) * 100) / 100);
    const raw = window.prompt(
      'How much actually arrived? (Clients often have to split — unverified Venmo caps at $299.99/week.)',
      outstanding > 0 ? String(outstanding) : '',
    );
    if (raw == null) return;
    const received = Number(raw);
    if (!Number.isFinite(received) || received <= 0) {
      alert('Enter the amount you actually received.');
      return;
    }
    setBusy(p.id);
    try {
      const json = await post({ action: 'confirm', paymentId: p.id, amountReceived: received });
      if (json) {
        onChange(payments.map((row) => (row.id === p.id
          ? {
              ...row,
              amount_paid: typeof json.amount_paid === 'number' ? json.amount_paid : Number(row.amount_paid || 0) + received,
              status: typeof json.status === 'string' ? json.status : row.status,
            }
          : row)));
      }
    } finally { setBusy(null); }
  }

  async function waive(p: BookingPayment) {
    if (!confirm(`Waive this ${p.kind === 'balance' ? 'invoice' : 'deposit'}? The client won\u2019t owe it through the app anymore.`)) return;
    setBusy(p.id);
    try {
      const json = await post({ action: 'waive', paymentId: p.id });
      if (json) onChange(payments.map((row) => (row.id === p.id ? { ...row, status: 'waived' } : row)));
    } finally { setBusy(null); }
  }

  const depositRow = payments.find((p) => p.kind === 'deposit');
  // balanceRow and canSendInvoice lived here to drive the Send Invoice button.
  // With the button gone they were declared and never read, which fails the
  // build on no-unused-vars — removing a control means removing what fed it.
  //
  // Both still exist where they're still needed: BookingRow computes its own
  // balancePays/balanceRow and the deposit-settled gate for the Invoice column.
  // kindLabel below still renders 'balance' rows as "Invoice" in the ledger, so
  // an invoice raised before this change still displays correctly.

  const kindLabel = (p: BookingPayment) =>
    p.kind === 'balance' ? 'Invoice' : p.kind === 'deposit' ? 'Deposit' : (p.label || 'Payment');

  const statusChip = (p: BookingPayment): { text: string; color: string } => {
    switch (p.status) {
      case 'paid': return { text: 'Paid', color: '#00e0a4' };
      case 'waived': return { text: 'Waived', color: 'var(--muted,#8a8aa0)' };
      case 'partial': return { text: 'Partially paid', color: '#f0b23e' };
      case 'pending_confirmation':
        return { text: p.method ? `Client says sent via ${p.method}` : 'Client says sent', color: '#f0b23e' };
      default: return { text: 'Requested', color: 'var(--muted,#8a8aa0)' };
    }
  };

  const neonBtn = (disabled: boolean): React.CSSProperties => ({
    background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)',
    fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', fontSize: '.8rem',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
  });
  const redBtn = (disabled: boolean): React.CSSProperties => ({
    background: 'transparent', border: '1px solid #ff7676', color: '#ff7676',
    fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', fontSize: '.8rem',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
  });

  return (
    <div style={{ marginTop: 8 }}>
      {payments.length === 0 && (
        <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.82rem' }}>
          {archive ? 'No payments were recorded for this booking.' : 'No payments requested yet.'}
        </div>
      )}
      {payments.map((p) => {
        const chip = statusChip(p);
        const settled = p.status === 'paid' || p.status === 'waived';
        const rowBusy = busy === p.id;
        return (
          <div key={p.id} style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: '.6rem .75rem', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: '#fff', fontSize: '.85rem' }}>{kindLabel(p)}</span>
              {/* Received over total — always the fraction, never just "partial". */}
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '.85rem', color: '#fff' }}>
                {money(Number(p.amount_paid || 0))} / {money(Number(p.amount))}{settled ? '' : ' due'}
              </span>
              <span style={{ color: chip.color, fontWeight: 700, fontSize: '.72rem', letterSpacing: '.03em' }}>{chip.text}</span>
              {p.client_intent === 'pay_at_event' && !settled && (
                <span style={{ border: '1px solid #f0b23e', color: '#f0b23e', borderRadius: 999, padding: '.1rem .5rem', fontSize: '.68rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  Cash at event
                </span>
              )}
            </div>
            {p.client_intent === 'pay_at_event' && !settled && (
              <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.72rem', marginTop: 4 }}>
                The client plans to hand you this in person — expect an envelope, then confirm what you receive.
              </div>
            )}
            {!archive && !settled && (
              <div style={{ display: 'flex', gap: '.5rem', marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => confirmReceived(p)} disabled={rowBusy} style={neonBtn(rowBusy)}>
                  {rowBusy ? 'Saving…' : 'Confirm received'}
                </button>
                <button type="button" onClick={() => waive(p)} disabled={rowBusy} style={redBtn(rowBusy)}>
                  Waive
                </button>
              </div>
            )}
          </div>
        );
      })}
      {!archive && (
        <div style={{ marginTop: payments.length > 0 ? 4 : 10 }}>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            {!depositRow && (
              <button
                type="button"
                onClick={() => requestPayment('deposit')}
                disabled={!canRequestDeposit || busy === 'request-deposit'}
                title={canRequestDeposit ? 'Email the client a deposit request with your payment options' : 'Complete the contract step first'}
                style={neonBtn(!canRequestDeposit || busy === 'request-deposit')}
              >
                {busy === 'request-deposit' ? 'Requesting…' : 'Request Deposit'}
              </button>
            )}
            {/* Send Invoice removed from the panel — Invoice is a column on the
                row now, and two places to send the same thing is how the row
                and the panel end up disagreeing about whether it went. The
                'balance' payment kind, requestPayment('balance') and the
                canSendInvoice gate are all still here and still used by the
                Invoice column's state; only this button is gone. */}
          </div>
          {!depositRow && !canRequestDeposit && (
            <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.72rem', marginTop: 6 }}>
              Request Deposit unlocks once the contract step is complete — signed, or marked complete in the
              status strip if you handled the contract outside the app.
            </div>
          )}
          {/* The "Send Invoice unlocks once the deposit is paid or waived" note
              went with the button. A hint explaining a control that isn't on
              screen is worse than no hint — it describes something the DJ can't
              find and will go looking for. */}
        </div>
      )}
    </div>
  );
}
