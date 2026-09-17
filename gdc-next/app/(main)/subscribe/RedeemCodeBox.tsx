'use client';

// RedeemCodeBox — a single promo/comp code field.
// v1 handles COMP codes (free access, no card). The user types a code; we live-
// validate it (preview) to show what it does, then Redeem applies it and
// reloads so their new access is reflected. Designed so the same box can later
// also accept paid discount codes without changing where it lives.

import { useRef, useState } from 'react';
import styles from './subscribe.module.css';

// variant 'pill' = the neon pill button (subscribe page). 'link' = a quiet
// underlined text link (homepage pricing) that expands into the same field.
export default function RedeemCodeBox({ variant = 'pill' }: { variant?: 'pill' | 'link' }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Set the instant Redeem is clicked so a late blur→preview response can't
  // overwrite the "Applied" message.
  const redeemingRef = useRef(false);

  async function check() {
    if (redeemingRef.current || done) return;
    setError(null);
    setPreview(null);
    const c = code.trim();
    if (!c) return;
    try {
      const res = await fetch('/api/comp-codes/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: c, preview: true }),
      });
      const data = await res.json();
      if (redeemingRef.current || done) return; // a redeem started/finished meanwhile
      if (data.ok) {
        setPreview(
          data.alreadyRedeemed
            ? `You’ve already redeemed this code.`
            : `✓ ${data.description}`,
        );
      } else {
        setError(data.error || 'That code isn’t valid.');
      }
    } catch {
      setError('Could not check that code.');
    }
  }

  async function redeem() {
    redeemingRef.current = true;
    setError(null);
    const c = code.trim();
    if (!c) { setError('Enter a code.'); redeemingRef.current = false; return; }
    setBusy(true);
    try {
      const res = await fetch('/api/comp-codes/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: c }),
      });
      const data = await res.json();
      if (res.status === 401) { window.location.href = '/login?redirect=/subscribe'; return; }
      if (data.ok) {
        setDone(true);
        setPreview(`✓ Applied — ${data.description}. Refreshing…`);
        setTimeout(() => window.location.reload(), 1400);
      } else {
        setError(data.error || 'Could not redeem that code.');
        redeemingRef.current = false; // let them try again
      }
    } catch {
      setError('Something went wrong.');
      redeemingRef.current = false;
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    if (variant === 'link') {
      return (
        <div style={{ textAlign: 'center', margin: '0 auto 1.5rem' }}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--neon,#00e0a4)', fontSize: '.9rem', fontWeight: 700,
              textDecoration: 'underline', textUnderlineOffset: 3, padding: 0,
            }}
          >
            Apply Promo Code
          </button>
        </div>
      );
    }
    return (
      <div style={{ textAlign: 'center', margin: '0 auto 1.5rem' }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '.5rem',
            background: 'rgba(0,224,164,.08)', border: '1px solid var(--neon,#00e0a4)',
            color: 'var(--neon,#00e0a4)', borderRadius: 999, padding: '.7rem 1.4rem',
            fontSize: '.9rem', fontWeight: 700, letterSpacing: '.02em', cursor: 'pointer',
          }}
        >
          🏷 Apply Promo Code
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto 1.5rem', textAlign: 'center' }}>
      <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'center' }}>
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setPreview(null); setError(null); }}
          onBlur={check}
          placeholder="Enter code"
          disabled={done}
          style={{
            flex: 1, maxWidth: 300, textTransform: 'uppercase',
            background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.16)',
            borderRadius: 10, padding: '.7rem .9rem', color: '#fff', fontSize: '.9rem',
            letterSpacing: '.04em',
          }}
        />
        <button type="button" className={styles.subscribeBtn} style={{ width: 'auto' }} onClick={redeem} disabled={busy || done}>
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>
      {preview && <div className={styles.success} style={{ marginTop: '.6rem' }}>{preview}</div>}
      {error && <div className={styles.error} style={{ marginTop: '.6rem' }}>{error}</div>}
    </div>
  );
}
