'use client';

// PaypalPay — client half of the PayPal hand-off page. Loads the PayPal JS SDK
// scoped to the DJ's merchant (multiparty) and renders the PayPal + Venmo
// buttons. createOrder/onApprove call our own routes, so the order is a
// server-authored one (payee = DJ) and capture marks the booking_payment paid.
//
// No login — the payment id is an unguessable UUID, same capability-URL model as
// the Venmo/card pay pages.

import { useEffect, useRef, useState } from 'react';

interface Props {
  paymentId: string;
  clientId: string;
  merchantId: string;
  bnCode?: string;
  amount: number;
  currency: string;
  djName: string;
  noun: string;            // "Deposit" | "Balance" | "Payment"
  settled: boolean;
  venueName: string | null;
  eventDate: string | null;
}

// Minimal shape of the global the SDK installs.
interface PayPalButtons {
  Buttons: (opts: unknown) => { render: (sel: string | HTMLElement) => Promise<void> };
}
declare global {
  interface Window { paypal?: PayPalButtons }
}

export default function PaypalPay({
  paymentId, clientId, merchantId, bnCode, amount, currency, djName, noun, settled, venueName, eventDate,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'paid' | 'error'>(settled ? 'paid' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const renderedRef = useRef(false);

  const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'USD').toUpperCase() });

  useEffect(() => {
    if (settled || status === 'paid') return;
    if (renderedRef.current) return;

    function renderButtons() {
      if (!window.paypal || !containerRef.current || renderedRef.current) return;
      renderedRef.current = true;
      window.paypal.Buttons({
        style: { layout: 'vertical', shape: 'rect', label: 'pay' },
        createOrder: async () => {
          const res = await fetch('/api/paypal/create-order', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentId }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json.id) throw new Error(json.error || 'Could not start PayPal.');
          return json.id as string;
        },
        onApprove: async (data: { orderID: string }) => {
          const res = await fetch('/api/paypal/capture-order', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentId, orderId: data.orderID }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json.ok) { setError(json.error || 'Payment could not be completed.'); setStatus('error'); return; }
          setStatus('paid');
        },
        onError: () => { setError('PayPal hit an error. Please try again.'); setStatus('error'); },
      }).render(containerRef.current).catch(() => {
        setError('Could not load the PayPal buttons.'); setStatus('error');
      });
    }

    // Inject the SDK once. merchant-id scopes the buttons to the DJ's account;
    // enable-funding=venmo surfaces the Venmo button when the payer is eligible.
    const existing = document.getElementById('paypal-sdk');
    if (existing) { renderButtons(); return; }
    const s = document.createElement('script');
    s.id = 'paypal-sdk';
    const params = new URLSearchParams({
      'client-id': clientId,
      'merchant-id': merchantId,
      currency: (currency || 'USD').toUpperCase(),
      intent: 'capture',
      components: 'buttons',
      'enable-funding': 'venmo',
    });
    s.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
    if (bnCode) s.setAttribute('data-partner-attribution-id', bnCode);
    s.onload = renderButtons;
    s.onerror = () => { setError('Could not reach PayPal.'); setStatus('error'); };
    document.body.appendChild(s);
  }, [paymentId, clientId, merchantId, bnCode, currency, settled, status]);

  const wrap: React.CSSProperties = {
    maxWidth: 460, margin: '0 auto', padding: '32px 20px 64px',
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', color: '#e8e8f0',
  };
  const card: React.CSSProperties = { background: '#14141c', border: '1px solid #262633', borderRadius: 16, padding: 22 };

  const where = [venueName, eventDate].filter(Boolean).join(' · ');

  return (
    <div style={wrap}>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontFamily: "'Bebas Neue',Impact,sans-serif", fontSize: '1.7rem', letterSpacing: '.04em', color: '#00f5c4' }}>GLOBAL DJ CONNECT</div>
      </div>
      <div style={card}>
        {status === 'paid' ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 10 }}>✅</div>
            <h1 style={{ fontSize: '1.2rem', margin: '0 0 6px', color: '#fff' }}>Payment complete</h1>
            <p style={{ margin: 0, fontSize: '.9rem', color: '#9a9ab0' }}>
              Your {noun.toLowerCase()} to {djName} is done. A confirmation will follow by email.
            </p>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: '.72rem', letterSpacing: '.1em', textTransform: 'uppercase', color: '#8a8aa0', fontWeight: 700 }}>{noun} to {djName}</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', margin: '6px 0 2px' }}>{money.format(amount)}</div>
              {where && <div style={{ fontSize: '.8rem', color: '#8a8aa0' }}>{where}</div>}
            </div>
            <div ref={containerRef} style={{ marginTop: 18, minHeight: 50 }} />
            {status === 'error' && (
              <p style={{ margin: '12px 0 0', fontSize: '.82rem', color: '#ff5f5f', textAlign: 'center' }}>{error}</p>
            )}
            <p style={{ margin: '14px 0 0', fontSize: '.72rem', color: '#7a7a90', textAlign: 'center', lineHeight: 1.5 }}>
              Paid securely through PayPal, straight to {djName}. Global DJ Connect never touches your payment.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
