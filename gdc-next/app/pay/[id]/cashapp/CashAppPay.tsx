'use client';

// CashAppPay — the client half of /pay/[id]/cashapp.
//
// Cash App DEPRECATED amount-prefill links: cash.app/$cashtag/400 no longer
// fills in the amount, it just opens the profile. So there is no way to make
// the amount land in the app automatically anymore.
//
// This page does the next best thing: shows the amount BIG with a one-tap copy
// icon right beside it, spells out the steps, and opens Cash App on a
// deliberate tap. Copy the amount, open the app, paste. No false promises.

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

export default function CashAppPay({
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
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<'amount' | 'handle' | null>(null);

  useEffect(() => {
    const touch = typeof window !== 'undefined'
      && (window.matchMedia('(pointer: coarse)').matches || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    setIsMobile(touch);
  }, []);

  useEffect(() => {
    if (isMobile !== false || settled) return;
    QRCode.toDataURL(link, { width: 260, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [isMobile, link, settled]);

  const amountStr = money(amount, currency);
  // Plain number for copying — what gets typed into Cash App. "600" or "41.60".
  const amountPlain = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);

  function copy(which: 'amount' | 'handle', value: string) {
    void navigator.clipboard.writeText(value);
    setCopied(which);
    setTimeout(() => setCopied(null), 1800);
  }

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
  const iconBtn = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 34, height: 34, borderRadius: 8, cursor: 'pointer',
    background: active ? 'rgba(0,224,164,.15)' : 'transparent',
    border: `1px solid ${active ? 'var(--neon,#00e0a4)' : 'var(--border,rgba(255,255,255,.18))'}`,
    color: active ? 'var(--neon,#00e0a4)' : 'var(--muted,#8a8aa0)',
    flexShrink: 0, padding: 0,
  });

  // A plain clipboard glyph, swapped for a check once copied.
  const CopyIcon = ({ done }: { done: boolean }) => (
    done
      ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      )
      : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
      )
  );

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

        {/* Amount, with the copy icon right beside it. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.6rem' }}>
          <span style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--white,#fff)', lineHeight: 1.1 }}>
            {amountStr}
          </span>
          <button
            type="button"
            aria-label="Copy amount"
            title="Copy amount"
            onClick={() => copy('amount', amountPlain)}
            style={iconBtn(copied === 'amount')}
          >
            <CopyIcon done={copied === 'amount'} />
          </button>
        </div>
        <p style={{ margin: '.35rem 0 1.2rem', color: 'var(--muted,#8a8aa0)', fontSize: '.82rem', lineHeight: 1.5 }}>
          to {djName}
          {venueName ? ` · ${venueName}` : ''}
          {eventDate ? ` · ${new Date(eventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
        </p>

        {isMobile === null && (
          <p style={{ margin: 0, color: 'var(--muted,#8a8aa0)', fontSize: '.85rem' }}>Loading…</p>
        )}

        {isMobile !== null && (
          <>
            <p style={{ margin: '0 0 .7rem', color: 'var(--white,#fff)', fontSize: '.84rem', fontWeight: 600 }}>
              Cash App won&apos;t fill in the amount — here&apos;s how to pay:
            </p>
            <ol style={{ margin: '0 0 1.1rem', paddingLeft: '1.2rem', textAlign: 'left', color: 'var(--muted,#b9b9cc)', fontSize: '.85rem', lineHeight: 1.75 }}>
              <li>Tap <strong style={{ color: 'var(--white,#fff)' }}>{isMobile ? 'Open Cash App' : 'scan the code'}</strong> below (opens {handle}).</li>
              <li>Enter <strong style={{ color: 'var(--white,#fff)' }}>{amountStr}</strong> — tap the copy icon above to grab it.</li>
              <li>Put <strong style={{ color: 'var(--white,#fff)' }}>{reference}</strong> in the note.</li>
              <li>Send.</li>
            </ol>

            {isMobile === true ? (
              <a
                href={link}
                style={{
                  display: 'block', background: '#00D632', color: '#04241b', textDecoration: 'none',
                  fontWeight: 800, padding: '.95rem 1rem', borderRadius: 9, fontSize: '.95rem',
                }}
              >
                Open Cash App →
              </a>
            ) : (
              <div style={{ background: '#fff', borderRadius: 10, padding: 12, display: 'inline-block' }}>
                {qr
                  ? <img src={qr} alt={`Scan to open ${handle} in Cash App`} width={200} height={200} style={{ display: 'block' }} />
                  : <div style={{ width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: '.8rem' }}>Loading…</div>}
              </div>
            )}

            {/* Cashtag with its own copy, in case they'd rather search it by hand. */}
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', justifyContent: 'center', marginTop: '1rem' }}>
              <code style={{ fontFamily: "'Space Mono', monospace", fontSize: '.85rem', color: 'var(--white,#fff)', background: 'var(--deep,#0b0b12)', padding: '.4rem .6rem', borderRadius: 6 }}>
                {handle}
              </code>
              <button type="button" aria-label="Copy cashtag" title="Copy cashtag" onClick={() => copy('handle', handle)} style={iconBtn(copied === 'handle')}>
                <CopyIcon done={copied === 'handle'} />
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
