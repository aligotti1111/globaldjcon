'use client';

// PaymentOptions — what the HOST sees on their booking card.
//
// "Choose a payment option below" — each tappable rail opens the app with the
// amount and recipient already loaded. This is the same thing the deposit /
// invoice email shows, built from the same link functions in lib/paymentMethods
// so the two can never disagree.
//
// THE DESKTOP PROBLEM (why the QR exists):
// Venmo no longer allows initiating a payment from their website. On a phone
// the link opens the app with $600 filled in; on a laptop it opens a profile
// the host CANNOT pay from. Since invoices arrive by email and plenty of
// people read email on a laptop, a bare "Pay with Venmo" button would be a
// dead end for them. So on desktop we show a QR of the very same link — scan
// it, the phone opens Venmo, amount already loaded.
//
// ZELLE IS NOT EXCLUDED, it just cannot be a link — no link format exists, at
// all. It renders as copyable text. That matters: Zelle is the DJ's only free
// rail (Venmo Business ~1.9% + $0.10, PayPal ~2.99% + $0.49), so dropping it
// would quietly cost them 2-3% of every deposit.
//
// The host can only ever CLAIM they paid. Only the DJ confirming turns it into
// money received — otherwise the pipeline would lie to the DJ.
//
// THE ONE EXCEPTION: CARD. When cardEnabled (the DJ finished Stripe Connect
// onboarding), "Pay with Card" renders FIRST — it's the only rail that works
// identically on desktop and mobile, with no app, no QR, no copy-paste. It's
// a button, not a link: no static URL exists, so we POST to /api/payments
// { action:'checkout' } and redirect to the Stripe-hosted session it returns.
// Cards also AUTO-CONFIRM on return (verify-checkout) — Stripe reporting a
// session paid is a fact, not a claim, so it may reach paid/partial without
// the DJ.

import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  METHOD_TYPES,
  buildPayLink,
  isLinkable,
  isMobileOnly,
  displayHandle,
  copyInstruction,
  usableMethods,
  referenceCode,
  checkMemo,
  type PaymentMethod,
} from '@/lib/paymentMethods';

export interface PaymentOptionsProps {
  bookingId: string;
  /**
   * The booking_payments row id — required for the card rail (the checkout
   * action is per-payment). Manual rails don't need it.
   */
  paymentId?: string;
  /**
   * True when this DJ's Stripe Connect account is READY (charges_enabled
   * cached in users.stripe_connect_ready). Comes from the page load, not
   * from payment_methods — card has no handle.
   */
  cardEnabled?: boolean;
  /** 'deposit' | 'balance' — drives the wording and the reference suffix. */
  kind: string;
  amount: number;
  currency?: string;
  amountPaid?: number;
  status?: string;          // requested | pending_confirmation | partial | paid | waived
  djName: string;
  methods: PaymentMethod[] | null | undefined;
  /** Host taps "I've sent it" — a claim, never a confirmation. */
  onMarkSent?: (methodType: string) => Promise<void> | void;
  /** Host taps "I'll pay at the event" (cash/check only). */
  onPayAtEvent?: () => Promise<void> | void;
  busy?: boolean;
  /**
   * The booking's date and venue — only used for the check memo line, and
   * optional so every existing call site keeps compiling. Without them the memo
   * falls back to the reference code, which works but asks the client to copy a
   * string that means nothing to them.
   */
  eventDate?: string | null;
  venueName?: string | null;
}

function money(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

/** Brand tint per rail — recognisable at a glance, no logo assets needed. */
const BRAND: Record<string, string> = {
  venmo: '#3D95CE',
  cashapp: '#00D632',
  paypal: '#003087',
  zelle: '#6D1ED4',
};

function QrBlock({ link, label }: { link: string; label: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // Classic black-on-white: this gets scanned by a phone camera in a room
    // with unknown lighting. Contrast beats brand.
    QRCode.toCanvas(c, link, { width: 132, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .catch(() => { /* leave blank rather than crash the card */ });
  }, [link]);
  return (
    <div style={{ display: 'flex', gap: '.7rem', alignItems: 'center', marginTop: '.6rem' }}>
      <canvas ref={ref} style={{ borderRadius: 6, background: '#fff', flexShrink: 0 }} />
      <span style={{ fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.45 }}>
        {label}
      </span>
    </div>
  );
}

export default function PaymentOptions({
  bookingId, paymentId, cardEnabled = false, kind, amount, currency = 'USD',
  amountPaid = 0, status = 'requested',
  djName, methods, onMarkSent, onPayAtEvent, busy = false, eventDate, venueName,
}: PaymentOptionsProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  // Venmo's link is mobile-only, so we must know the device. Done after mount
  // to stay SSR-safe.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    setIsDesktop(!mobile);
  }, []);

  const list = useMemo(() => usableMethods(methods), [methods]);
  const canPayByCard = cardEnabled && !!paymentId;
  const reference = referenceCode(bookingId, kind);
  const outstanding = Math.max(0, amount - (amountPaid || 0));
  const isPaid = status === 'paid' || status === 'waived';
  const noun = kind === 'balance' ? 'balance' : 'deposit';

  async function copy(text: string, tag: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* give up quietly */ }
      document.body.removeChild(ta);
    }
    setCopied(tag);
    setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1600);
  }

  // Card: POST for a fresh Stripe Checkout session (amount recomputed
  // server-side — never sent from here) and hand the browser to Stripe.
  // Stripe returns to /booking-requests?paid=<id>&session_id=<cs_...>, where
  // BookingRequestsClient runs verify-checkout and the row settles itself.
  async function payWithCard() {
    if (!paymentId || cardBusy) return;
    setCardBusy(true);
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'checkout', paymentId }),
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error || 'Could not open card checkout.');
      window.location.href = json.url;
      // No busy reset — we're leaving the page.
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'Unknown'));
      setCardBusy(false);
    }
  }

  async function markSent(methodType: string) {
    if (!onMarkSent || sending) return;
    setSending(true);
    try { await onMarkSent(methodType); } finally { setSending(false); }
  }

  const card: React.CSSProperties = {
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: 'var(--deep)',
    padding: '1rem',
    marginTop: '.85rem',
  };
  const cap: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace",
    fontSize: '.58rem',
    letterSpacing: '.1em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
  };

  if (isPaid) {
    return (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span style={{ color: 'var(--success)', fontSize: '1rem' }}>✓</span>
          <span style={{ color: 'var(--white)', fontSize: '.9rem' }}>
            {status === 'waived'
              ? `${djName} waived this ${noun}.`
              : `${noun[0].toUpperCase()}${noun.slice(1)} received — thank you.`}
          </span>
        </div>
      </div>
    );
  }

  // A card-only DJ (Stripe connected, no manual handles) is a legitimate
  // setup — only fall back to "no way to pay" when card is ALSO unavailable.
  if (list.length === 0 && !canPayByCard) {
    return (
      <div style={card}>
        <p style={{ margin: 0, fontSize: '.82rem', color: 'var(--muted)' }}>
          {djName} hasn&apos;t listed a payment method yet. Reach out to arrange
          the {noun} directly.
        </p>
      </div>
    );
  }

  return (
    <div style={card}>
      {/* The ask */}
      <div style={{ marginBottom: '.9rem' }}>
        <span style={cap}>{kind === 'balance' ? 'Balance due' : 'Deposit required'}</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '.5rem', marginTop: '.2rem' }}>
          <span style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--neon)' }}>
            {money(outstanding, currency)}
          </span>
          {amountPaid > 0 && (
            <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>
              of {money(amount, currency)} — {money(amountPaid, currency)} received
            </span>
          )}
        </div>
        <p style={{ margin: '.45rem 0 0', fontSize: '.82rem', color: 'var(--white)', lineHeight: 1.5 }}>
          {status === 'pending_confirmation'
            ? `Thanks — ${djName} will confirm receipt shortly.`
            : `Please choose a payment option below to complete the ${noun} required to reserve your date.`}
        </p>
      </div>

      {/* Reference — without it a DJ with three $600 deposits can't tell which
          incoming payment is which. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '.5rem',
          padding: '.5rem .7rem', borderRadius: 6,
          background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)',
          marginBottom: '.9rem', flexWrap: 'wrap',
        }}
      >
        <span style={cap}>Reference</span>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '.85rem', color: 'var(--white)' }}>
          {reference}
        </span>
        <button
          type="button"
          onClick={() => copy(reference, 'ref')}
          style={{
            marginLeft: 'auto', background: 'transparent', border: 'none',
            color: copied === 'ref' ? 'var(--success)' : 'var(--muted)',
            fontSize: '.7rem', cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          {copied === 'ref' ? '✓ Copied' : 'Copy'}
        </button>
        <span style={{ flexBasis: '100%', fontSize: '.68rem', color: 'var(--muted)' }}>
          Include this in the payment note so {djName} can match it to your booking.
        </span>
      </div>

      {/* Card first — the primary option: the only rail that works the same
          on desktop and mobile, and the only one that confirms itself. */}
      {canPayByCard && (
        <div style={{ marginBottom: '.8rem' }}>
          <button
            type="button"
            onClick={() => { void payWithCard(); }}
            disabled={busy || cardBusy}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '.6rem', padding: '.95rem 1rem', borderRadius: 8, width: '100%',
              background: 'var(--neon)', color: 'var(--black)', border: 'none',
              fontWeight: 800, fontSize: '.95rem',
              cursor: busy || cardBusy ? 'default' : 'pointer',
              opacity: busy || cardBusy ? 0.7 : 1,
            }}
          >
            <span>{cardBusy ? 'Opening secure checkout…' : 'Pay with Card'}</span>
            <span style={{ fontWeight: 600, fontSize: '.85rem' }}>
              {money(outstanding, currency)} →
            </span>
          </button>
          <p style={{ margin: '.3rem 0 0', fontSize: '.7rem', color: 'var(--muted)' }}>
            Debit or credit — secure checkout by Stripe, confirmed instantly.
            No app needed{list.length > 0 ? ', or use an option below' : ''}.
          </p>
        </div>
      )}

      {/* The rails */}
      {list.map((m) => {
        const cfg = METHOD_TYPES[m.type];
        const link = buildPayLink(m, outstanding, reference);
        const linkable = isLinkable(m) && !!link;
        // Venmo on desktop: the link exists but cannot complete a payment.
        const deadOnDesktop = linkable && isMobileOnly(m) && isDesktop;
        const tint = BRAND[m.type] || 'var(--neon)';

        return (
          <div key={m.id} style={{ marginBottom: '.8rem' }}>
            {linkable && !deadOnDesktop ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { void markSent(m.type); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: '.6rem', padding: '.85rem 1rem', borderRadius: 8,
                  background: tint, color: '#fff', textDecoration: 'none',
                  fontWeight: 700, fontSize: '.92rem',
                }}
              >
                <span>Pay with {cfg.label}</span>
                <span style={{ opacity: 0.9, fontWeight: 400, fontSize: '.85rem' }}>
                  {money(outstanding, currency)} →
                </span>
              </a>
            ) : (
              // Copy-only: Zelle always, PayPal-by-email, cash, check, other.
              <div style={{ padding: '.75rem .85rem', borderRadius: 8, border: `1px solid var(--border)`, borderLeft: `3px solid ${tint}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: 'var(--white)', fontSize: '.9rem' }}>{cfg.label}</span>
                  {m.type !== 'check' && (m.type !== 'cash' || !!m.handle) && (
                    <button
                      type="button"
                      onClick={() => copy(m.type === 'cash' ? (m.handle || '') : displayHandle(m).replace(/^[@$]/, ''), m.id)}
                      style={{
                        marginLeft: 'auto', background: 'transparent',
                        border: '1px solid var(--border)', borderRadius: 5,
                        color: copied === m.id ? 'var(--success)' : 'var(--muted)',
                        fontSize: '.68rem', padding: '.28rem .55rem', cursor: 'pointer',
                      }}
                    >
                      {copied === m.id ? '✓ Copied' : 'Copy'}
                    </button>
                  )}
                </div>
                <p style={{ margin: '.35rem 0 0', fontSize: '.72rem', color: 'var(--muted)' }}>
                  {copyInstruction(m)}
                </p>
                {m.type === 'check' ? (
                  <>
                    <p style={{ margin: '.2rem 0 0', fontSize: '.85rem', color: 'var(--white)' }}>{m.handle}</p>
                    {m.contact && (
                      <>
                        <p style={{ margin: '.45rem 0 0', fontSize: '.72rem', color: 'var(--muted)' }}>Mail to:</p>
                        <p style={{ margin: '.1rem 0 0', fontSize: '.82rem', color: 'var(--white)', whiteSpace: 'pre-line' }}>{m.contact}</p>
                      </>
                    )}
                    {/* The memo is what makes an envelope matchable. It arrives
                        days later with nothing on it but an amount, and the
                        client can't mistype their own event date. */}
                    {checkMemo(eventDate, venueName, reference) && (
                      <>
                        <p style={{ margin: '.45rem 0 0', fontSize: '.72rem', color: 'var(--muted)' }}>Write on the memo line:</p>
                        <p style={{ margin: '.1rem 0 0', fontFamily: "'Space Mono', monospace", fontSize: '.8rem', color: 'var(--neon)' }}>
                          {checkMemo(eventDate, venueName, reference)}
                        </p>
                      </>
                    )}
                  </>
                ) : m.type === 'cash' ? (
                  m.handle ? (
                    // tel: — the host reads this on the way to the venue as
                    // often as at a desk. A number they have to retype is a step
                    // that doesn't need to exist.
                    <p style={{ margin: '.2rem 0 0', fontSize: '.85rem', color: 'var(--white)' }}>
                      <a href={`tel:${(m.handle || '').replace(/[^\d+]/g, '')}`} style={{ color: 'var(--neon)', textDecoration: 'none', fontFamily: "'Space Mono', monospace" }}>
                        {m.handle}
                      </a>
                      {m.contact ? <> · ask for <strong style={{ color: 'var(--white)' }}>{m.contact}</strong></> : null}
                    </p>
                  ) : null
                ) : (
                  <p style={{ margin: '.2rem 0 0', fontFamily: "'Space Mono', monospace", fontSize: '.85rem', color: 'var(--white)', wordBreak: 'break-all' }}>
                    {displayHandle(m)}
                  </p>
                )}
                {/* Zelle is irreversible and typed by hand — say so once, plainly. */}
                {m.type === 'zelle' && (
                  <p style={{ margin: '.3rem 0 0', fontSize: '.68rem', color: 'var(--muted)' }}>
                    Double-check before sending — Zelle payments can&apos;t be reversed.
                    Send {money(outstanding, currency)} to {djName}.
                  </p>
                )}
              </div>
            )}

            {/* Desktop Venmo: same link, as a QR to scan. */}
            {deadOnDesktop && link && (
              <div style={{ padding: '.75rem .85rem', borderRadius: 8, border: '1px solid var(--border)', borderLeft: `3px solid ${tint}` }}>
                <span style={{ fontWeight: 700, color: 'var(--white)', fontSize: '.9rem' }}>{cfg.label}</span>
                <QrBlock
                  link={link}
                  label={`Venmo can't take payments from a computer. Scan this with your phone — it opens Venmo with ${money(outstanding, currency)} to ${djName} already filled in.`}
                />
                <button
                  type="button"
                  onClick={() => { void markSent(m.type); }}
                  disabled={busy || sending}
                  style={{
                    marginTop: '.5rem', background: 'transparent',
                    border: '1px solid var(--border)', borderRadius: 5,
                    color: 'var(--muted)', fontSize: '.68rem',
                    padding: '.3rem .6rem', cursor: 'pointer',
                  }}
                >
                  I&apos;ve sent it
                </button>
              </div>
            )}

            {m.note && (
              <p style={{ margin: '.3rem 0 0', fontSize: '.7rem', color: 'var(--muted)' }}>{m.note}</p>
            )}
          </div>
        );
      })}

      {/* A claim, not a confirmation. Deliberately understated so nobody reads
          it as "done". */}
      {status !== 'pending_confirmation' && onMarkSent && (
        <p style={{ margin: '.6rem 0 0', fontSize: '.72rem', color: 'var(--muted)' }}>
          Already sent it?{' '}
          <button
            type="button"
            onClick={() => { void markSent('other'); }}
            disabled={busy || sending}
            style={{
              background: 'transparent', border: 'none', color: 'var(--neon)',
              fontSize: '.72rem', cursor: 'pointer', textDecoration: 'underline', padding: 0,
            }}
          >
            Let {djName} know
          </button>{' '}
          — they&apos;ll confirm once it lands.
        </p>
      )}

      {/* Only offered when the DJ actually accepts in-person payment. */}
      {onPayAtEvent && list.some((m) => m.type === 'cash' || m.type === 'check') && status !== 'pending_confirmation' && (
        <p style={{ margin: '.4rem 0 0', fontSize: '.72rem', color: 'var(--muted)' }}>
          Prefer to settle up on the day?{' '}
          <button
            type="button"
            onClick={() => { void onPayAtEvent(); }}
            disabled={busy || sending}
            style={{
              background: 'transparent', border: 'none', color: 'var(--neon)',
              fontSize: '.72rem', cursor: 'pointer', textDecoration: 'underline', padding: 0,
            }}
          >
            Tell {djName} you&apos;ll pay at the event
          </button>
        </p>
      )}
    </div>
  );
}
