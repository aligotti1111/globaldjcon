'use client';

// Banner shown briefly after a successful email verification.
// Triggered by ?emailverified=1 in the URL — the /api/verify-email route
// redirects users here with that query param after flipping their
// email_verified flag to true.
//
// Behavior:
//   - Reads ?emailverified=1 from the URL on mount
//   - If present, shows a green confirmation banner
//   - User can dismiss with the × button
//   - Auto-dismisses after 8 seconds so it doesn't linger forever
//   - Strips the query param from the URL so a refresh doesn't re-show it
//
// Mounted in (main)/layout.tsx alongside <VerifyEmailBanner /> so it
// appears on every destination page (DJ → /update-dj-profile,
// venue → /account-settings, host → /).

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function BannerInner() {
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (searchParams.get('emailverified') !== '1') return;

    setVisible(true);

    // Strip the query param so a page refresh doesn't re-trigger the banner.
    if (typeof window !== 'undefined' && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.delete('emailverified');
      window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    }

    // Auto-dismiss after 8 seconds.
    const timer = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(timer);
  }, [searchParams]);

  if (!visible) return null;

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
        onClick={() => setVisible(false)}
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

export default function EmailVerifiedBanner() {
  // Suspense wrapper required for useSearchParams() in client components
  // under Next.js 15 App Router.
  return (
    <Suspense fallback={null}>
      <BannerInner />
    </Suspense>
  );
}
