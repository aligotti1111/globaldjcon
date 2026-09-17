'use client';

// RedeemCodeBox — a single promo/comp code field.
// v1 handles COMP codes (free access, no card). The user types a code; we live-
// validate it (preview) to show what it does, then Redeem applies it and
// reloads so their new access is reflected. Designed so the same box can later
// also accept paid discount codes without changing where it lives.

import { useState } from 'react';
import styles from './subscribe.module.css';

export default function RedeemCodeBox() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function check() {
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
    setError(null);
    const c = code.trim();
    if (!c) { setError('Enter a code.'); return; }
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
      }
    } catch {
      setError('Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div style={{ textAlign: 'center', margin: '0 auto 1.25rem' }}>
        <button type="button" className={styles.switchLink} onClick={() => setOpen(true)}>
          Have a code? Redeem it
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
          {busy ? 'Applying…' : 'Redeem'}
        </button>
      </div>
      {preview && <div className={styles.success} style={{ marginTop: '.6rem' }}>{preview}</div>}
      {error && <div className={styles.error} style={{ marginTop: '.6rem' }}>{error}</div>}
    </div>
  );
}
