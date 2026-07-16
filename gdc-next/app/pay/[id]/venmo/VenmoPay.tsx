'use client';

// VenmoPay — the client half of /pay/[id]/venmo.
//
// One job: get the person into Venmo with the right amount, from whatever
// device they opened the email on.
//
//   phone  → the link works. Go, immediately.
//   laptop → the link is a dead end (Venmo blocks web payments), so render it
//            as a QR instead. Same URL, same preloaded amount and note — the
//            phone that scans it lands exactly where the phone that tapped the
//            email would have.
//
// The redirect is deliberately automatic on mobile and deliberately NOT on
// desktop. On a phone, an extra "Open Venmo" tap is friction for no reason. On
// a laptop, redirecting would take them to a page they can't pay from — the
// exact failure this page exists to prevent.

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

function money(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export default function VenmoPay({
  link, amount, currency, djName, reference, handle, settled, venueName, eventDate,
}: {
  link: string;
  amount: number;
  currency: string;
  djName: string;
  reference: string;
  handle: string;
  settled: boolean;
  venueName: string | null;
  eventDate: string | null;
}) {
  // null = undecided. Rendering either branch before we know would flash the
  // wrong one — and on mobile that flash is a QR nobody can scan with the
  // phone that's displaying it.
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Coarse pointer = touch device. More honest than sniffing user agents,
    // which lie, and it's the actual question: can this thing run the app?
    const touch = typeof window !== 'undefined'
      && (window.matchMedia('(pointer: coarse)').matches || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    setIsMobile(touch);
  }, []);

  useEffect(() => {
    if (isMobile !== true || settled) return;
    // Straight through. A phone that tapped "Pay with Venmo" in an email should
    // land in Venmo, not on a page about Venmo.
    const t = setTimeout(() => { window.location.href = link; }, 600);
    return () => clearTimeout(t);
  }, [isMobile, link, settled]);

  useEffect(() => {
    if (isMobile !== false || settled) return;
    QRCode.toDataURL(link, { width: 260, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [isMobile, link, settled]);

  const wrap: React.CSSProperties = {
    minHeight: '100vh',
    background: 'var(--black,#08080c)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem 1rem',
  };
  const card: React.CSSProperties = {
    background: 'var(--card,#14141f)',
    border: '1px solid var(--border,rgba(255,255,255,.12))',
    borderRadius: 14,
    padding: '1.6rem 1.4rem',
    maxWidth: 420,
    width: '100%',
    textAlign: 'center',
  };

  if (settled) {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ fontSize: 34, marginBottom: '.5rem' }}>✓</div>
          <h1 style={{ margin: '0 0 .4rem', color: 'var(--white,#fff)', fontSize: '1.1rem' }}>
            Nothing left to pay
          </h1>
          <p style={{ margin: 0, color: 'var(--muted,#8a8aa0)', fontSize: '.85rem', lineHeight: 1.6 }}>
            This request has already been settled. If you think that&apos;s wrong,
            contact {djName} directly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--neon,#00e0a4)', marginBottom: '.6rem' }}>
          Global DJ Connect
        </div>

        <div style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--white,#fff)', lineHeight: 1.1 }}>
          {money(amount, currency)}
        </div>
        <p style={{ margin: '.3rem 0 1.2rem', color: 'var(--muted,#8a8aa0)', fontSize: '.82rem', lineHeight: 1.5 }}>
          to {djName}
          {venueName ? ` · ${venueName}` : ''}
          {eventDate ? ` · ${new Date(eventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
        </p>

        {isMobile === null && (
          <p style={{ margin: 0, color: 'var(--muted,#8a8aa0)', fontSize: '.85rem' }}>Loading…</p>
        )}

        {isMobile === true && (
          <>
            <p style={{ margin: '0 0 1rem', color: 'var(--white,#fff)', fontSize: '.9rem', lineHeight: 1.6 }}>
              Opening Venmo…
            </p>
            {/* The auto-redirect can be blocked, and some in-app email browsers
                swallow it silently. Never leave them staring at "Opening…". */}
            <a
              href={link}
              style={{
                display: 'block', background: '#3D95CE', color: '#fff', textDecoration: 'none',
                fontWeight: 700, padding: '.9rem 1rem', borderRadius: 8, fontSize: '.95rem',
              }}
            >
              Open Venmo →
            </a>
          </>
        )}

        {isMobile === false && (
          <>
            <p style={{ margin: '0 0 1rem', color: 'var(--white,#fff)', fontSize: '.88rem', lineHeight: 1.6 }}>
              Venmo can&apos;t take payments from a computer — that&apos;s Venmo&apos;s rule,
              not ours. <strong>Scan this with your phone</strong> and Venmo opens
              with the amount already filled in.
            </p>
            <div style={{ background: '#fff', borderRadius: 10, padding: 12, display: 'inline-block' }}>
              {qr
                ? <img src={qr} alt="Scan to pay with Venmo" width={220} height={220} style={{ display: 'block' }} />
                : <div style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: '.8rem' }}>Loading…</div>}
            </div>
            <p style={{ margin: '1rem 0 .3rem', color: 'var(--muted,#8a8aa0)', fontSize: '.75rem' }}>
              Or send it by hand in the Venmo app:
            </p>
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', justifyContent: 'center' }}>
              <code style={{ fontFamily: "'Space Mono', monospace", fontSize: '.85rem', color: 'var(--white,#fff)', background: 'var(--deep,#0b0b12)', padding: '.4rem .6rem', borderRadius: 6 }}>
                {handle}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(handle);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
                style={{ background: 'transparent', border: '1px solid var(--border,rgba(255,255,255,.14))', borderRadius: 6, color: copied ? 'var(--neon,#00e0a4)' : 'var(--muted,#8a8aa0)', fontSize: '.7rem', padding: '.4rem .6rem', cursor: 'pointer', fontFamily: "'Space Mono', monospace" }}
              >
                {copied ? '✓' : 'Copy'}
              </button>
            </div>
          </>
        )}

        <p style={{ margin: '1.2rem 0 0', color: 'var(--muted,#8a8aa0)', fontSize: '.72rem', lineHeight: 1.6 }}>
          Reference: <strong style={{ color: 'var(--white,#fff)' }}>{reference}</strong>
          <br />
          Please leave it in the payment note so {djName} can match it to your booking.
        </p>
      </div>
    </div>
  );
}
