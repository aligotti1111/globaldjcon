'use client';

import { useState } from 'react';

function money(n: number, currency = 'USD'): string {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }
  catch { return `$${n.toFixed(2)}`; }
}

export default function CheckSent({
  paymentId, amount, currency, kind, alreadySettled, eventDate, venueName, atEvent = false,
}: {
  paymentId: string; amount: number; currency: string; kind: string;
  alreadySettled: boolean; eventDate: string | null; venueName: string | null; atEvent?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>(alreadySettled ? 'done' : 'idle');
  const kindLabel = kind === 'balance' ? 'balance' : kind === 'deposit' ? 'deposit' : 'payment';

  async function notify() {
    setState('sending');
    try {
      const res = await fetch('/api/pay/check-sent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, mode: atEvent ? 'at-event' : 'sent' }),
      });
      setState(res.ok ? 'done' : 'error');
    } catch { setState('error'); }
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#0b0b0f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif" };
  const card: React.CSSProperties = { maxWidth: 440, width: '100%', background: '#15151c', border: '1px solid #26263200', borderRadius: 16, padding: 28, textAlign: 'center', boxShadow: '0 8px 40px rgba(0,0,0,.5)' };

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontFamily: 'Impact,Arial,sans-serif', fontSize: 22, letterSpacing: '.06em', color: '#00f5c4', fontWeight: 700, marginBottom: 20 }}>GLOBAL DJ CONNECT</div>

        {state === 'done' ? (
          <>
            <div style={{ fontSize: 44, marginBottom: 10 }}>✓</div>
            <h1 style={{ fontSize: 20, margin: '0 0 10px' }}>Your DJ has been notified</h1>
            <p style={{ color: '#b7b7c6', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              {atEvent
                ? <>We let your DJ know you'll pay <strong style={{ color: '#fff' }}>{money(amount, currency)}</strong> at the event{eventDate ? ` on ${eventDate}` : ''}. They'll collect it on the day. Thanks!</>
                : <>We let your DJ know a check for <strong style={{ color: '#fff' }}>{money(amount, currency)}</strong> is on the way{venueName ? ` for ${venueName}` : ''}. They'll confirm it once it arrives. Thanks!</>}
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{atEvent ? 'Paying at the event?' : 'Mailing a check?'}</h1>
            <p style={{ color: '#b7b7c6', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>
              {atEvent
                ? <>Let your DJ know you'll pay your {kindLabel} of <strong style={{ color: '#fff' }}>{money(amount, currency)}</strong> in person at the event{eventDate ? ` on ${eventDate}` : ''}, so they know to expect it on the day.</>
                : <>Let your DJ know your {kindLabel} of <strong style={{ color: '#fff' }}>{money(amount, currency)}</strong> is on the way{eventDate ? ` for the ${eventDate} event` : ''}, so they know to watch for the envelope.</>}
            </p>
            <button
              type="button"
              onClick={notify}
              disabled={state === 'sending'}
              style={{ width: '100%', background: '#00e0a4', color: '#06231b', border: 'none', borderRadius: 10, padding: '14px 20px', fontWeight: 700, fontSize: 15, cursor: state === 'sending' ? 'default' : 'pointer', opacity: state === 'sending' ? 0.7 : 1 }}
            >
              {state === 'sending' ? 'Notifying…' : atEvent ? "Let my DJ know I'll pay at the event" : "Let my DJ know it's on the way"}
            </button>
            {state === 'error' && (
              <p style={{ color: '#ff8a8a', fontSize: 13, margin: '12px 0 0' }}>Something went wrong — please try again.</p>
            )}
            <p style={{ color: '#6f6f80', fontSize: 12, lineHeight: 1.6, margin: '16px 0 0' }}>
              This just gives them a heads-up. Your payment is only marked received once your DJ confirms it{atEvent ? ' at the event' : ''}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
