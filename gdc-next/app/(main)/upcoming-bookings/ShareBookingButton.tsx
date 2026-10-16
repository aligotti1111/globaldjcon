'use client';

// Copies the booking's public read-only card link (/card/<share_token>) to the
// clipboard. The link needs no login and the token is unguessable; anyone with
// it sees the card read-only. Uses the same paper-plane "Share" icon as the
// profile pages. Sits on the top-right of the booking card (shows even when
// the card is collapsed).

import { useState } from 'react';

export default function ShareBookingButton({ shareToken }: { shareToken?: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!shareToken) return null;

  async function copy(e: React.MouseEvent) {
    // The whole row is a click-to-expand button — don't toggle it when sharing.
    e.stopPropagation();
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/card/${shareToken}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <span
      onClick={copy}
      role="button"
      tabIndex={0}
      aria-label="Share booking card"
      title={copied ? 'Link copied' : 'Share a view-only link to this booking card'}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 7,
        border: '1px solid rgba(255,255,255,.18)',
        color: copied ? '#00e0a4' : 'var(--muted,#8a8aa0)',
        cursor: 'pointer', flexShrink: 0,
      }}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      )}
    </span>
  );
}
