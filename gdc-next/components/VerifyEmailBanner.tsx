'use client';

// Banner shown across the site whenever a logged-in user hasn't verified
// their email yet. Mirrors the vanilla auth.js behavior of injecting a
// persistent yellow notice at the top of every page until verification.
//
// Includes a "Resend Email" link that calls our /api/signup-send-verification
// endpoint to send a fresh verification token.

import { useState } from 'react';
import { useAuth } from './AuthProvider';

export default function VerifyEmailBanner() {
  const { user, loading } = useAuth();
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendMsg, setResendMsg] = useState('');

  // Hide while loading OR if not logged in OR if already verified.
  // Also hide for the admin user — the platform owner doesn't need to be
  // nagged about verifying their seed account, even if email_verified is
  // somehow false on their public.users row.
  const isAdmin = user?.email?.toLowerCase() === 'admin@globaldjconnect.com';
  // AND hide when there is no email at all. A host who signed up with a phone
  // number has email_verified = false — correctly, since there's nothing to
  // verify — and this banner used to nag them forever about confirming a
  // blank address, with a Resend button that could only ever fail. They're
  // asked for an email at their first booking; until then there is genuinely
  // nothing for them to do here.
  const hasEmail = !!(user?.email && user.email.trim());
  if (loading || !user || !hasEmail || user.email_verified || isAdmin) return null;

  async function handleResend() {
    if (!user) return;
    setResendStatus('sending');
    try {
      const res = await fetch('/api/signup-send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          email: user.email,
          role: user.role,
          slug: user.slug,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to send');
      }
      setResendStatus('sent');
      setResendMsg('✓ Sent — check your inbox');
      setTimeout(() => { setResendStatus('idle'); setResendMsg(''); }, 5000);
    } catch (err) {
      setResendStatus('error');
      setResendMsg('✗ ' + (err instanceof Error ? err.message : 'Failed to send'));
      setTimeout(() => { setResendStatus('idle'); setResendMsg(''); }, 4000);
    }
  }

  return (
    <div
      style={{
        background: 'rgba(255, 179, 71, 0.08)',
        borderBottom: '1px solid rgba(255, 179, 71, 0.3)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        flexWrap: 'wrap',
        fontFamily: "'Space Mono', monospace",
        fontSize: '12px',
        letterSpacing: '0.04em',
        color: '#ffb347',
        position: 'relative',
        zIndex: 50,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
      <span>
        Please confirm your email — check <strong style={{ color: '#ffd9a3' }}>{user.email}</strong> for the verification link.
      </span>
      {resendStatus === 'idle' || resendStatus === 'sending' ? (
        <button
          type="button"
          onClick={handleResend}
          disabled={resendStatus === 'sending'}
          style={{
            background: 'transparent',
            border: '1px solid rgba(255, 179, 71, 0.4)',
            color: '#ffb347',
            padding: '4px 10px',
            borderRadius: '4px',
            fontFamily: 'inherit',
            fontSize: '11px',
            letterSpacing: 'inherit',
            textTransform: 'uppercase',
            cursor: resendStatus === 'sending' ? 'wait' : 'pointer',
            opacity: resendStatus === 'sending' ? 0.6 : 1,
          }}
        >
          {resendStatus === 'sending' ? 'Sending...' : 'Resend Email'}
        </button>
      ) : (
        <span style={{ color: resendStatus === 'sent' ? '#3ddc84' : '#ff5f5f', fontSize: '11px' }}>
          {resendMsg}
        </span>
      )}
    </div>
  );
}
