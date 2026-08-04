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
  onClose: () => void;
  onEditMethods: () => void;
  onSubmit: () => void;
}

export default function RequestPaymentModal({
  reqKind, reqAmount, setReqAmount, reqErr, setReqErr, reqBusy, reqMethods, reqCardReady,
  suggestedDeposit, currency, depositPct, onClose, onEditMethods, onSubmit,
}: Props) {
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

        {reqKind === 'deposit' && suggestedDeposit != null && suggestedDeposit > 0 && (
          <p style={{ margin: '0 0 .8rem', color: 'var(--muted,#8a8aa0)', fontSize: '.72rem' }}>
            This booking&apos;s agreed deposit: {fmtMoney(suggestedDeposit, currency)}
            {depositPct != null ? ` (${depositPct}%)` : ''}
          </p>
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
              <button
                type="button"
                onClick={onEditMethods}
                style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(255,255,255,.18)', color: NEON, fontSize: '.68rem', fontFamily: "'Space Mono', monospace", letterSpacing: '.04em', borderRadius: 6, padding: '.3rem .6rem', cursor: 'pointer' }}
              >
                Edit
              </button>
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
