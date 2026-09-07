'use client';

// PayHub — the client half of /pay/[id].
//
// Renders every option the DJ accepts as a tappable list a client can act on
// from a phone. Three shapes:
//   • href option   → a real link (card/PayPal/Venmo/Cash App page, or a
//                     PayPal.me link). Renders as a button.
//   • copy option   → a rail with no link (Zelle, a bare PayPal email, check
//                     payable-to). Shows the value with a one-tap copy.
//   • info option   → cash / other. Instructions only.
//
// The page decides which shape each option is; this component only draws them.
// No writes: opening or copying is never payment. The DJ confirms what arrives.

import { useState } from 'react';

export interface HubOption {
  type: string;
  label: string;
  sub?: string;                 // small line under the label (a handle, a blurb)
  href?: string;                // tappable → renders as a button
  external?: boolean;           // href leaves the site (e.g. paypal.me)
  linkLabel?: string;           // button text for href options
  copy?: string;                // value to copy (no link exists for this rail)
  instruction?: string;         // one-line "how to" above a copy value
  lines?: string[];             // extra info lines (cash / check / other)
  secondary?: { href: string; label: string }; // small link under the option
  accent: string;               // brand color for the dot
}

function money(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

const CopyIcon = ({ done }: { done: boolean }) => (
  done
    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
);

export default function PayHub({
  amount, currency, djName, kind, reference, settled, venueName, eventDate, options,
}: {
  amount: number;
  currency: string;
  djName: string;
  kind: string;
  reference: string;
  settled: boolean;
  venueName: string | null;
  eventDate: string | null;
  options: HubOption[];
}) {
  const [copied, setCopied] = useState<number | null>(null);

  function copy(i: number, value: string) {
    void navigator.clipboard.writeText(value);
    setCopied(i);
    setTimeout(() => setCopied((c) => (c === i ? null : c)), 1800);
  }

  const wrap: React.CSSProperties = {
    minHeight: '100vh',
    background: 'var(--black,#08080c)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '2rem 1rem',
  };
  const card: React.CSSProperties = {
    background: 'var(--card,#14141f)',
    border: '1px solid var(--border,rgba(255,255,255,.12))',
    borderRadius: 14,
    padding: '1.6rem 1.4rem',
    maxWidth: 440,
    width: '100%',
  };

  const kindLabel = kind === 'balance' ? 'Balance' : kind === 'deposit' ? 'Deposit' : 'Payment';

  if (settled) {
    return (
      <div style={{ ...wrap, alignItems: 'center' }}>
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: '.5rem' }}>✓</div>
          <h1 style={{ margin: '0 0 .4rem', color: 'var(--white,#fff)', fontSize: '1.1rem' }}>Nothing left to pay</h1>
          <p style={{ margin: 0, color: 'var(--muted,#8a8aa0)', fontSize: '.85rem', lineHeight: 1.6 }}>
            This request has already been settled. If you think that&apos;s wrong, contact {djName} directly.
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

        <div style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--white,#fff)', lineHeight: 1.1 }}>
          {money(amount, currency)}
        </div>
        <p style={{ margin: '.35rem 0 1.3rem', color: 'var(--muted,#8a8aa0)', fontSize: '.82rem', lineHeight: 1.5 }}>
          {kindLabel} to {djName}
          {venueName ? ` · ${venueName}` : ''}
          {eventDate ? ` · ${new Date(eventDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
        </p>

        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.62rem', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted,#8a8aa0)', marginBottom: '.7rem' }}>
          Choose how to pay
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '.7rem' }}>
          {options.map((o, i) => (
            <div
              key={`${o.type}-${i}`}
              style={{
                border: '1px solid var(--border,rgba(255,255,255,.12))',
                borderRadius: 11,
                padding: '.85rem .9rem',
                background: 'var(--deep,#0b0b12)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: o.accent, flexShrink: 0, boxShadow: `0 0 8px ${o.accent}` }} />
                <span style={{ fontWeight: 700, color: 'var(--white,#fff)', fontSize: '.92rem' }}>{o.label}</span>
                {o.sub && (
                  <span style={{ marginLeft: 'auto', color: 'var(--muted,#8a8aa0)', fontSize: '.78rem', fontFamily: "'Space Mono', monospace", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '55%' }}>{o.sub}</span>
                )}
              </div>

              {o.instruction && (
                <p style={{ margin: '.6rem 0 .3rem', color: 'var(--muted,#b9b9cc)', fontSize: '.78rem', lineHeight: 1.5 }}>{o.instruction}</p>
              )}

              {o.copy && (
                <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', marginTop: '.35rem' }}>
                  <code style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: '.82rem', color: 'var(--white,#fff)', background: 'var(--black,#08080c)', padding: '.5rem .6rem', borderRadius: 6, wordBreak: 'break-all', border: '1px solid var(--border,rgba(255,255,255,.1))' }}>
                    {o.copy}
                  </code>
                  <button
                    type="button"
                    aria-label={`Copy ${o.label}`}
                    onClick={() => copy(i, o.copy!)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 36, height: 36, borderRadius: 8, cursor: 'pointer', flexShrink: 0, padding: 0,
                      background: copied === i ? 'rgba(0,224,164,.15)' : 'transparent',
                      border: `1px solid ${copied === i ? 'var(--neon,#00e0a4)' : 'var(--border,rgba(255,255,255,.18))'}`,
                      color: copied === i ? 'var(--neon,#00e0a4)' : 'var(--muted,#8a8aa0)',
                    }}
                  >
                    <CopyIcon done={copied === i} />
                  </button>
                </div>
              )}

              {o.lines && o.lines.length > 0 && (
                <div style={{ marginTop: '.5rem', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                  {o.lines.map((ln, k) => (
                    <p key={k} style={{ margin: 0, color: 'var(--muted,#b9b9cc)', fontSize: '.8rem', lineHeight: 1.5 }}>{ln}</p>
                  ))}
                </div>
              )}

              {o.href && (
                <a
                  href={o.href}
                  {...(o.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  style={{
                    display: 'block', textAlign: 'center', marginTop: '.7rem',
                    background: o.accent, color: '#fff', textDecoration: 'none',
                    fontWeight: 800, padding: '.75rem 1rem', borderRadius: 9, fontSize: '.9rem',
                  }}
                >
                  {o.linkLabel || 'Pay'} →
                </a>
              )}

              {o.secondary && (
                <p style={{ margin: '.6rem 0 0', fontSize: '.75rem' }}>
                  <a href={o.secondary.href} style={{ color: o.accent, fontWeight: 700, textDecoration: 'underline' }}>{o.secondary.label}</a>
                </p>
              )}
            </div>
          ))}
        </div>

        <p style={{ margin: '1.3rem 0 0', color: 'var(--muted,#8a8aa0)', fontSize: '.72rem', lineHeight: 1.6, textAlign: 'center' }}>
          Reference: <strong style={{ color: 'var(--white,#fff)' }}>{reference}</strong>
          <br />
          Leave it in the payment note so {djName} can match it to your booking.
        </p>
      </div>
    </div>
  );
}
