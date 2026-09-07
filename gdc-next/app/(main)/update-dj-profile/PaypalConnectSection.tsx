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

export default function PaypalConnectSection(
  { onStatus, initialReady = false }: { onStatus?: (ready: boolean) => void; initialReady?: boolean } = {},
) {
  // If the parent already knows the DJ is connected (it checks on page load),
  // seed straight into the "Connected" state and skip the spinner — the click
  // to open the tile then shows the result instantly instead of after a ~2s
  // round-trip to PayPal. We still re-verify silently in the background.
  const [loading, setLoading] = useState(!initialReady);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(initialReady);
  const [ready, setReady] = useState(initialReady);
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

  const refresh = useCallback(async (merchantId?: string, silent = false) => {
    if (!silent) setLoading(true);
    setErr(null);
    const json = await post(merchantId ? { action: 'status', merchantId } : { action: 'status' });
    if (json) {
      setConnected(!!json.connected);
      setReady(!!json.ready);
      setEmail(json.email ?? null);
      onStatus?.(!!json.ready);
    }
    if (!silent) setLoading(false);
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
    // If we're already seeded connected (parent knew on load), re-verify
    // silently so the spinner never shows; otherwise do a normal check.
    void refresh(merchantId, initialReady && !merchantId);
  }, [refresh, initialReady]);

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

  const live = connected && ready;

  return (
    <div
      style={
        live
          ? {
              // Electric "it's live" state: neon border, teal-tinted gradient
              // fill and an outer glow so a connected account reads as a win.
              background: 'linear-gradient(135deg, rgba(0,245,196,.10), rgba(0,245,196,.02))',
              border: '1px solid rgba(0,245,196,.55)',
              borderRadius: 14,
              padding: '16px 18px',
              boxShadow: '0 0 0 1px rgba(0,245,196,.15), 0 0 22px rgba(0,245,196,.22)',
            }
          : { background: 'var(--card,#14141c)', border: '1px solid var(--line,#262633)', borderRadius: 14, padding: '16px 18px' }
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontWeight: 700, color: 'var(--white,#fff)', fontSize: '.9rem' }}>PayPal payments</span>
        {live && (
          <span style={{ fontSize: '.62rem', fontWeight: 800, letterSpacing: '.04em', color: '#04121a', background: '#00f5c4', padding: '3px 9px', borderRadius: 999, boxShadow: '0 0 12px rgba(0,245,196,.6)', textTransform: 'uppercase' }}>● Connected</span>
        )}
      </div>

      {loading ? (
        <p style={{ margin: 0, fontSize: '.82rem', color: 'var(--muted,#9a9ab0)' }}>Checking PayPal status…</p>
      ) : !connected ? (
        <>
          <button type="button" onClick={() => void connect()} disabled={busy} style={btn(true, !busy)}>
            {busy ? 'Opening PayPal…' : 'Connect your PayPal account'}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--white,#e8fff8)', lineHeight: 1.5 }}>
              {email ? <>Paid into <strong style={{ color: '#00f5c4' }}>{email}</strong>. </> : null}
              Clients now see a <strong style={{ color: '#00f5c4' }}>&quot;Pay with PayPal&quot;</strong> button on deposits and invoices.
            </p>
          </div>
          <button type="button" onClick={() => void disconnect()} disabled={busy} style={{ ...btn(false, !busy), marginLeft: 'auto', flexShrink: 0, alignSelf: 'flex-start' }}>Disconnect</button>
        </div>
      )}

      {err && <p style={{ margin: '10px 0 0', fontSize: '.78rem', color: '#ff5f5f' }}>{err}</p>}
    </div>
  );
}
