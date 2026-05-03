'use client';

// Banner shown right after a successful email verification.
//
// Trigger: AuthProvider exposes a `justVerified` flag that's true when the
// user's email_verified_at timestamp is within the last 60 seconds AND the
// banner hasn't already been acknowledged for this verification event.
//
// This is more robust than reading a URL query param, which can get
// stripped during the auto-login redirect chain (Supabase magic-link →
// auth callback → final destination). The timestamp on the user record
// survives any number of redirects.
//
// Behavior:
//   - Reads `justVerified` from useAuth()
//   - When true, shows a green confirmation banner
//   - User can dismiss with the × button (calls acknowledgeVerification)
//   - Auto-dismisses after 8 seconds (also calls acknowledgeVerification)
//   - Once acknowledged, won't re-show on refresh/navigation
//
// Mounted in (main)/layout.tsx so it appears on every destination page
// (DJ → /update-dj-profile, venue → /account-settings, host → /).

import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';

export default function EmailVerifiedBanner() {
  const { justVerified, acknowledgeVerification } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  // Auto-dismiss after 8 seconds when the banner becomes visible.
  useEffect(() => {
    if (!justVerified || dismissed) return;
    const timer = setTimeout(() => {
      setDismissed(true);
      acknowledgeVerification();
    }, 8000);
    return () => clearTimeout(timer);
  }, [justVerified, dismissed, acknowledgeVerification]);

  function handleDismiss() {
    setDismissed(true);
    acknowledgeVerification();
  }

  if (!justVerified || dismissed) return null;

  return (
    <div
      style={{
        background: 'rgba(0, 245, 196, 0.08)',
        borderBottom: '1px solid rgba(0, 245, 196, 0.3)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        flexWrap: 'wrap',
        fontFamily: "'Space Mono', monospace",
        fontSize: '12px',
        letterSpacing: '0.04em',
        color: '#00f5c4',
        position: 'relative',
        zIndex: 50,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span>
        <strong style={{ color: '#a0ffe6' }}>Email confirmed</strong> — all features are now enabled.
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#00f5c4',
          cursor: 'pointer',
          fontSize: '16px',
          lineHeight: 1,
          padding: '0 4px',
          marginLeft: '4px',
          opacity: 0.7,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; }}
      >
        ×
      </button>
    </div>
  );
}
