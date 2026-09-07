'use client';

// PaypalConnectSection — the DJ links their own PayPal (Commerce Platform /
// multiparty) so hosts can pay by PayPal straight into the DJ's account. Mirrors
// the Stripe Connect block: money goes direct to the DJ, the platform takes no
// cut and never holds it.
//
// Self-contained: on mount it asks /api/paypal/connect?action=status for the
// current state. When the DJ returns from PayPal's hosted onboarding the URL
// carries ?paypal=connected&merchantIdInPayPal=XXX — we pass that merchant id to
// status so the very first check can resolve + cache it.
//
// States shown:
//   • not connected        → "Connect PayPal" button
//   • connected, verifying  → PayPal has it but payments_receivable /
//                             primary_email_confirmed aren't both true yet
//   • connected + ready     → green confirmation + Disconnect
//
// Drop this anywhere in Booking Settings (it needs no props). It only renders
// meaningfully for the owner, which is who sees Booking Settings.

import { useCallback, useEffect, useState } from 'react';

interface StatusResp {
  connected?: boolean;
  ready?: boolean;
  actionNeeded?: boolean;
  email?: string | null;
  error?: string;
}

export default function PaypalConnectSection({ onStatus }: { onStatus?: (ready: boolean) => void } = {}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const post = useCallback(async (payload: Record<string, unknown>): Promise<StatusResp | null> => {
    try {
      const res = await fetch('/api/paypal/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as StatusResp;
      if (!res.ok) { setErr(json.error || 'PayPal request failed.'); return null; }
      return json;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reach PayPal.');
      return null;
    }
  }, []);

  const refresh = useCallback(async (merchantId?: string) => {
    setLoading(true);
    setErr(null);
    const json = await post(merchantId ? { action: 'status', merchantId } : { action: 'status' });
    if (json) {
      setConnected(!!json.connected);
      setReady(!!json.ready);
      setEmail(json.email ?? null);
      onStatus?.(!!json.ready);
    }
    setLoading(false);
  }, [post, onStatus]);

  // On mount: capture the merchant id PayPal appends on return, then check
  // status (with it on first connect, without it otherwise).
  useEffect(() => {
    let merchantId: string | undefined;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('paypal') === 'connected') {
        merchantId = params.get('merchantIdInPayPal') || undefined;
        // Clean the query so a refresh doesn't re-trigger.
        params.delete('paypal'); params.delete('merchantIdInPayPal');
        params.delete('permissionsGranted'); params.delete('consentStatus');
        params.delete('productIntentId'); params.delete('isEmailConfirmed'); params.delete('accountStatus');
        const qs = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
      }
    } catch { /* no-op */ }
    void refresh(merchantId);
  }, [refresh]);

  async function connect() {
    setBusy(true);
    setErr(null);
    const json = await post({ action: 'start' });
    setBusy(false);
    const url = (json as unknown as { url?: string } | null)?.url;
    if (url) { window.location.href = url; }
  }

  async function disconnect() {
    if (!window.confirm('Stop accepting PayPal? Your PayPal account itself is untouched — this only unlinks it here. You can reconnect any time.')) return;
    setBusy(true);
    setErr(null);
    const json = await post({ action: 'disconnect' });
    setBusy(false);
    if (json) { setConnected(false); setReady(false); setEmail(null); onStatus?.(false); }
  }

  const btn = (primary: boolean, enabled: boolean): React.CSSProperties => ({
    padding: '.7rem 1.1rem',
    borderRadius: 8,
    border: primary ? '1px solid #003087' : '1px solid var(--line,#2a2a38)',
    background: primary ? '#0070ba' : 'transparent',
    color: primary ? '#fff' : 'var(--muted,#9a9ab0)',
    fontWeight: 700,
    fontSize: '.82rem',
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.6,
  });

  return (
    <div style={{ background: 'var(--card,#14141c)', border: '1px solid var(--line,#262633)', borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontWeight: 700, color: 'var(--white,#fff)', fontSize: '.9rem' }}>PayPal payments</span>
        {connected && ready && (
          <span style={{ fontSize: '.62rem', fontWeight: 700, color: '#00f5c4', background: 'rgba(0,245,196,.14)', padding: '3px 8px', borderRadius: 999 }}>Connected</span>
        )}
      </div>

      {loading ? (
        <p style={{ margin: 0, fontSize: '.82rem', color: 'var(--muted,#9a9ab0)' }}>Checking PayPal status…</p>
      ) : !connected ? (
        <>
          <p style={{ margin: '0 0 12px', fontSize: '.82rem', color: 'var(--muted,#9a9ab0)', lineHeight: 1.55 }}>
            Clients pay by PayPal (and Venmo) straight into your own PayPal — deposits and balances mark themselves paid.
            The money is yours; Global DJ Connect never touches it and takes no cut.
          </p>
          <button type="button" onClick={() => void connect()} disabled={busy} style={btn(true, !busy)}>
            {busy ? 'Opening PayPal…' : 'Connect PayPal'}
          </button>
        </>
      ) : !ready ? (
        <>
          <p style={{ margin: '0 0 12px', fontSize: '.82rem', color: '#e6b455', lineHeight: 1.55 }}>
            PayPal has your account but is still verifying it (or your PayPal email isn&apos;t confirmed yet).
            PayPal switches payments on by itself — usually minutes. Nothing else to do here.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => void refresh()} disabled={busy} style={btn(true, !busy)}>
              {busy ? 'Checking…' : 'Recheck status'}
            </button>
            <button type="button" onClick={() => void disconnect()} disabled={busy} style={btn(false, !busy)}>Disconnect</button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 4px', fontSize: '.82rem', color: '#00f5c4' }}>
            ✓ Connected{email ? ` — ${email}` : ''}. Clients see &quot;Pay with PayPal&quot; on deposits and invoices.
          </p>
          <button type="button" onClick={() => void disconnect()} disabled={busy} style={{ ...btn(false, !busy), marginTop: 8 }}>Disconnect</button>
        </>
      )}

      {err && <p style={{ margin: '10px 0 0', fontSize: '.78rem', color: '#ff5f5f' }}>{err}</p>}
    </div>
  );
}
