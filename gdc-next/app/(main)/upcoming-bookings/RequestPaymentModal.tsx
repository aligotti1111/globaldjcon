'use client';

// RequestPaymentModal — the "Request deposit / Request balance" dialog, lifted
// verbatim out of BookingRow (refactor phase 1). Pure presentation: the row
// still owns the request state (amount, kind, busy, error, methods) and the
// submit handler, and passes them in.

import type { ReactElement } from 'react';
import { usableMethods, type PaymentMethod, type PaymentMethodType } from '@/lib/paymentMethods';
import { currencySymbol } from '@/lib/constants';
import { VenmoMark, CashAppMark, PaypalMark, ZelleMark, CashMark, CheckMark, CardNetworksMark } from '../update-dj-profile/BrandMarks';
import { NEON, fmtMoney } from './shared';

const REQ_METHOD_ICON: Partial<Record<PaymentMethodType, (p: { size?: number }) => ReactElement>> = {
  venmo: VenmoMark, cashapp: CashAppMark, paypal: PaypalMark, zelle: ZelleMark, cash: CashMark, check: CheckMark,
};

// One line of the "how the receipt reads" breakdown.
function Row({ label, value, bold, currencyMuted }: { label: string; value: string; bold?: boolean; currencyMuted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.8rem', padding: '.12rem 0' }}>
      <span style={{ fontSize: '.72rem', color: bold ? 'var(--white,#fff)' : 'var(--muted,#8a8aa0)', fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '.78rem', color: bold ? 'var(--white,#fff)' : (currencyMuted ? 'var(--muted,#8a8aa0)' : 'var(--white,#fff)'), fontWeight: bold ? 700 : 400 }}>{value}</span>
    </div>
  );
}

interface Props {
  reqKind: 'deposit' | 'balance';
  reqAmount: string;
  setReqAmount: (v: string) => void;
  reqErr: string | null;
  setReqErr: (v: string | null) => void;
  reqBusy: boolean;
  reqMethods: PaymentMethod[];
  reqCardReady: boolean;
  suggestedDeposit: number | null;
  currency: string;
  depositPct: number | null;
  // What the receipt will actually show for this stage, derived from the
  // booking's agreed figures. When the DJ edits the Amount to something else,
  // we warn them the difference won't appear on the receipt and show the
  // expected breakdown so they can see how the number should look.
  expectedAmount: number | null;
  expectedTotal: number;
  expectedCollected: number;
  onClose: () => void;
  // Owner-only. When absent, the "Edit" link to change saved payment options
  // is hidden — teammates may request money but not change where it lands.
  onEditMethods?: () => void;
  onSubmit: () => void;
}

export default function RequestPaymentModal({
  reqKind, reqAmount, setReqAmount, reqErr, setReqErr, reqBusy, reqMethods, reqCardReady,
  suggestedDeposit, currency, depositPct, expectedAmount, expectedTotal, expectedCollected,
  onClose, onEditMethods, onSubmit,
}: Props) {
  // Does the Amount the DJ typed match what the receipt will actually show?
  // The receipt is built from the booking's agreed figures (total, tax,
  // deposit) — not from whatever number is requested here — so any override
  // only changes what the client is ASKED to pay, never the receipt. Flag the
  // gap so the DJ knows to edit the receipt by hand if they mean to keep it.
  const entered = Number(reqAmount);
  const hasExpected = expectedAmount != null && expectedAmount > 0;
  const mismatch = hasExpected && Number.isFinite(entered) && entered > 0
    && Math.abs(entered - (expectedAmount as number)) > 0.01;
  const diff = mismatch ? Math.round((entered - (expectedAmount as number)) * 100) / 100 : 0;
  const kindNoun = reqKind === 'balance' ? 'balance' : 'deposit';

  return (
    <div
      onClick={() => !reqBusy && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.14)',
          borderRadius: 12, padding: '1.1rem 1.2rem', maxWidth: 420, width: '100%',
          boxShadow: '0 12px 40px rgba(0,0,0,.6)',
        }}
      >
        <div style={{ fontWeight: 800, color: 'var(--white,#fff)', fontSize: '.95rem', marginBottom: '.7rem' }}>
          {reqKind === 'balance' ? 'Request balance' : 'Request deposit'}
        </div>

        <label style={{ display: 'block', fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted,#8a8aa0)', marginBottom: '.35rem' }}>
          Amount
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.5rem' }}>
          <span style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.95rem' }}>{currencySymbol(currency)}</span>
          <input
            autoFocus
            type="number"
            min="0"
            step="0.01"
            value={reqAmount}
            onWheel={(e) => e.currentTarget.blur()}
            onChange={(e) => { setReqAmount(e.target.value); setReqErr(null); }}
            style={{
              flex: 1, background: 'var(--deep,#0b0b12)', border: '1px solid rgba(255,255,255,.14)',
              borderRadius: 6, color: 'var(--white,#fff)', padding: '.55rem .7rem',
              fontFamily: "'Space Mono', monospace", fontSize: '.9rem',
            }}
          />
        </div>

        {reqKind === 'deposit' && suggestedDeposit != null && suggestedDeposit > 0 && !mismatch && (
          <p style={{ margin: '0 0 .8rem', color: 'var(--muted,#8a8aa0)', fontSize: '.72rem' }}>
            This booking&apos;s agreed deposit: {fmtMoney(suggestedDeposit, currency)}
            {depositPct != null ? ` (${depositPct}%)` : ''}
          </p>
        )}

        {/* Receipt mismatch warning + breakdown. The receipt is generated from
            the booking's agreed figures, so a custom Amount here is only what
            the client is ASKED to pay — it won't change the receipt. */}
        {mismatch && (
          <div style={{ margin: '0 0 .9rem', border: '1px solid rgba(240,180,60,.5)', background: 'rgba(240,180,60,.08)', borderRadius: 8, padding: '.6rem .7rem' }}>
            <p style={{ margin: '0 0 .5rem', color: '#f0b43c', fontSize: '.72rem', lineHeight: 1.55, fontWeight: 700 }}>
              This doesn&apos;t match the agreed {kindNoun}. You&apos;re requesting {fmtMoney(entered, currency)}
              {' '}({diff > 0 ? '+' : '−'}{fmtMoney(Math.abs(diff), currency)}).
            </p>
            <p style={{ margin: '0 0 .6rem', color: 'var(--muted,#8a8aa0)', fontSize: '.68rem', lineHeight: 1.55 }}>
              The receipt is built from this booking&apos;s figures, so it will still show the amount below — not what you request here. To reflect the difference, edit the receipt by hand after the payment is marked paid.
            </p>
            <div style={{ borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: '.5rem' }}>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.58rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted,#8a8aa0)', marginBottom: '.35rem' }}>
                How the receipt reads
              </div>
              {reqKind === 'balance' ? (
                <>
                  <Row label="Total cost" value={fmtMoney(expectedTotal, currency)} currencyMuted />
                  <Row label="Collected so far" value={`− ${fmtMoney(expectedCollected, currency)}`} currencyMuted />
                  <Row label="Balance due" value={fmtMoney(expectedAmount as number, currency)} bold />
                </>
              ) : (
                <>
                  <Row label="Total cost" value={fmtMoney(expectedTotal, currency)} currencyMuted />
                  <Row label={`Deposit${depositPct != null ? ` (${depositPct}%)` : ''}`} value={fmtMoney(expectedAmount as number, currency)} bold />
                </>
              )}
            </div>
          </div>
        )}

        {(() => {
          const ms = usableMethods(reqMethods);
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap', margin: '0 0 .9rem' }}>
              {ms.map((m) => {
                const Ico = REQ_METHOD_ICON[m.type];
                return Ico ? (
                  <span key={m.id} title={m.type} style={{ display: 'inline-flex', lineHeight: 0 }}><Ico size={18} /></span>
                ) : null;
              })}
              {reqCardReady && (
                <span title="Card" style={{ display: 'inline-flex', lineHeight: 0 }}><CardNetworksMark size={11} /></span>
              )}
              {ms.length === 0 && !reqCardReady && (
                <span style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.72rem' }}>No payment methods set yet</span>
              )}
              {onEditMethods && (
                <button
                  type="button"
                  onClick={onEditMethods}
                  style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(255,255,255,.18)', color: NEON, fontSize: '.68rem', fontFamily: "'Space Mono', monospace", letterSpacing: '.04em', borderRadius: 6, padding: '.3rem .6rem', cursor: 'pointer' }}
                >
                  Edit
                </button>
              )}
            </div>
          );
        })()}

        {reqErr && (
          <p style={{ margin: '0 0 .7rem', color: '#ff6b6b', fontSize: '.75rem', lineHeight: 1.5, wordBreak: 'break-word' }}>{reqErr}</p>
        )}

        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            disabled={reqBusy}
            onClick={onClose}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.18)', color: 'var(--muted,#8a8aa0)', fontWeight: 700, borderRadius: 6, padding: '.5rem 1rem', cursor: reqBusy ? 'default' : 'pointer', fontSize: '.8rem' }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={reqBusy}
            onClick={onSubmit}
            style={{ background: NEON, border: 'none', color: '#06231b', fontWeight: 800, borderRadius: 6, padding: '.5rem 1.1rem', cursor: reqBusy ? 'wait' : 'pointer', fontSize: '.8rem', opacity: reqBusy ? .6 : 1 }}
          >
            {reqBusy ? 'Requesting…' : 'Request'}
          </button>
        </div>
      </div>
    </div>
  );
}
