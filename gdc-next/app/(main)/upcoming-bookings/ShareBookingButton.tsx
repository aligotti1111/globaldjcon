'use client';

// Copies the booking's public read-only card link (/card/<share_token>) to the
// clipboard. The link needs no login and the token is unguessable; anyone with
// it sees the card read-only. Used on the DJ booking card.

import { useState } from 'react';

export default function ShareBookingButton({ shareToken }: { shareToken?: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!shareToken) return null;

  async function copy() {
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/card/${shareToken}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for older browsers / insecure contexts.
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy a view-only link to this booking card"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '.4rem',
        background: 'transparent', border: '1px solid rgba(255,255,255,.18)',
        color: copied ? '#00e0a4' : 'var(--muted,#8a8aa0)', fontWeight: 700,
        fontSize: '.72rem', borderRadius: 7, padding: '.4rem .7rem', cursor: 'pointer',
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
      {copied ? 'Link copied' : 'Share card'}
    </button>
  );
}
