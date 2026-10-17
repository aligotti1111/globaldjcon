'use client';

// PaypalPay — client half of the PayPal hand-off page. Loads the PayPal JS SDK
// scoped to the DJ's merchant (multiparty) and renders the funding buttons.
// createOrder/onApprove call our own routes, so the order is a server-authored
// one (payee = DJ) and capture marks the booking_payment paid.
//
// mode:
//   'all'   → PayPal, Pay Later, and Card (Venmo is EXCLUDED here — it has its
//             own link so the two don't read as duplicates).
//   'venmo' → Venmo ONLY. Venmo is eligible only in the US and generally on a
//             phone with the Venmo app, so if it isn't eligible we show a
//             friendly fallback with a link back to the other options.
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
  mode?: 'all' | 'venmo';
}

// Minimal shape of the globals the SDK installs.
interface PayPalButtonInstance {
  render: (sel: string | HTMLElement) => Promise<void>;
  isEligible?: () => boolean;
}
interface PayPalButtons {
  Buttons: (opts: unknown) => PayPalButtonInstance;
  FUNDING?: Record<string, string>;
}
declare global {
  interface Window { paypal?: PayPalButtons }
}

export default function PaypalPay({
  paymentId, clientId, merchantId, bnCode, amount, currency, djName, noun, settled, venueName, eventDate,
  mode = 'all',
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'paid' | 'pending' | 'error' | 'ineligible'>(settled ? 'paid' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const renderedRef = useRef(false);

  const venmoOnly = mode === 'venmo';
  const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'USD').toUpperCase() });

  useEffect(() => {
    if (settled || status === 'paid') return;
    if (renderedRef.current) return;

    const shared = {
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
      onApprove: async (data: { orderID: string }, actions?: { restart?: () => void }) => {
        const res = await fetch('/api/paypal/capture-order', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId, orderId: data.orderID }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          if (json?.retryable && actions?.restart) {
            setError('That payment method was declined. Please try another.');
            setStatus('idle');
            actions.restart();
            return;
          }
          setError(json.error || 'Payment could not be completed.'); setStatus('error'); return;
        }
        if (json.pending) { setStatus('pending'); return; }
        setStatus('paid');
      },
      onError: () => { setError('PayPal hit an error. Please try again.'); setStatus('error'); },
    };

    function renderButtons() {
      if (!window.paypal || !containerRef.current || renderedRef.current) return;
      renderedRef.current = true;
      try {
        if (venmoOnly) {
          const venmoSource = window.paypal.FUNDING?.VENMO || 'venmo';
          const btn = window.paypal.Buttons({ ...shared, fundingSource: venmoSource });
          // Venmo isn't eligible for this viewer (desktop / non-US) → fallback.
          if (btn.isEligible && !btn.isEligible()) { setStatus('ineligible'); return; }
          btn.render(containerRef.current).catch(() => { setStatus('ineligible'); });
        } else {
          // PayPal + Pay Later + Card (Venmo disabled in the SDK params below).
          window.paypal.Buttons(shared).render(containerRef.current).catch(() => {
            setError('Could not load the PayPal buttons.'); setStatus('error');
          });
        }
      } catch {
        if (venmoOnly) setStatus('ineligible');
        else { setError('Could not load the PayPal buttons.'); setStatus('error'); }
      }
    }

    // Inject the SDK once. merchant-id scopes the buttons to the DJ's account.
    // Venmo-only page enables Venmo; the "all" page disables it so it only shows
    // PayPal / Pay Later / Card.
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
    });
    if (venmoOnly) params.set('enable-funding', 'venmo');
    else params.set('disable-funding', 'venmo');
    s.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
    if (bnCode) s.setAttribute('data-partner-attribution-id', bnCode);
    s.onload = renderButtons;
    s.onerror = () => { setError('Could not reach PayPal.'); setStatus('error'); };
    document.body.appendChild(s);
  }, [paymentId, clientId, merchantId, bnCode, currency, settled, status, venmoOnly]);

  const wrap: React.CSSProperties = {
    maxWidth: 460, margin: '0 auto', padding: '32px 20px 64px',
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', color: '#e8e8f0',
  };
  const card: React.CSSProperties = { background: '#14141c', border: '1px solid #262633', borderRadius: 16, padding: 22 };

  const where = [venueName, eventDate].filter(Boolean).join(' · ');
  const allUrl = `/pay/${paymentId}/paypal`;

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
        ) : status === 'pending' ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 10 }}>⏳</div>
            <h1 style={{ fontSize: '1.2rem', margin: '0 0 6px', color: '#fff' }}>Payment processing</h1>
            <p style={{ margin: 0, fontSize: '.9rem', color: '#9a9ab0' }}>
              PayPal is still clearing this {noun.toLowerCase()} to {djName}. You don&rsquo;t need to pay again — a
              receipt will follow by email once it settles.
            </p>
          </div>
        ) : status === 'ineligible' ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 10 }}>📱</div>
            <h1 style={{ fontSize: '1.15rem', margin: '0 0 6px', color: '#fff' }}>Venmo opens on your phone</h1>
            <p style={{ margin: '0 0 16px', fontSize: '.9rem', color: '#9a9ab0', lineHeight: 1.55 }}>
              Venmo is available on a mobile device with the Venmo app (US only). Open this link on your phone — or
              use another option.
            </p>
            <a href={allUrl} style={{ display: 'inline-block', background: '#0070ba', color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: '.9rem', padding: '11px 20px', borderRadius: 8 }}>
              Pay with PayPal or card →
            </a>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: '.72rem', letterSpacing: '.1em', textTransform: 'uppercase', color: '#8a8aa0', fontWeight: 700 }}>{noun} to {djName}</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', margin: '6px 0 2px' }}>{money.format(amount)}</div>
              {where && <div style={{ fontSize: '.8rem', color: '#8a8aa0' }}>{where}</div>}
            </div>
            <div ref={containerRef} style={{ marginTop: 18, minHeight: 50 }} />
            {/* Show the message whenever one is set — a declined-but-retryable
                capture resets status to 'idle' and re-renders the buttons, so
                gating on status==='error' would hide the "try another" notice.
                (This branch only renders when status is 'idle' or 'error'.) */}
            {error && (
              <p style={{ margin: '12px 0 0', fontSize: '.82rem', color: '#ff5f5f', textAlign: 'center' }}>{error}</p>
            )}
            {venmoOnly && (
              <p style={{ margin: '14px 0 0', fontSize: '.78rem', textAlign: 'center' }}>
                <a href={allUrl} style={{ color: '#8a8aa0' }}>Prefer PayPal or card? →</a>
              </p>
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
