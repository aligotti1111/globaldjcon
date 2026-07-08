'use client';

// ContractSendModal — opens for an approved booking, prepares the contract
// (server pre-fills the booking details), and embeds the DJ's DocuSeal signing
// form. The DJ reviews the filled contract and signs; on completion the client
// is emailed to sign automatically (DocuSeal preserved order).

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';

const DocusealForm = dynamic(
  () => import('@docuseal/react').then((m) => m.DocusealForm),
  { ssr: false, loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Loading…</div> },
);

export default function ContractSendModal({
  bookingId,
  userId,
  onClose,
  onSent,
}: {
  bookingId: string;
  userId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [embedSrc, setEmbedSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/contracts/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; embedSrc?: string; error?: string };
        if (!res.ok || !json.ok || !json.embedSrc) throw new Error(json.error || 'Could not prepare the contract.');
        if (mounted) setEmbedSrc(json.embedSrc);
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Could not prepare the contract.');
      }
    })();
    return () => { mounted = false; };
  }, [bookingId]);

  async function handleComplete() {
    setSigned(true);
    try {
      const supabase = createClient();
      await supabase
        .from('bookings')
        .update({ contract_status: 'awaiting_client' } as unknown as never)
        .eq('id', bookingId)
        .eq('dj_id', userId);
    } catch { /* best-effort */ }
    onSent();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 1000, height: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.75rem 1rem', borderBottom: '1px solid #eee' }}>
          <strong style={{ color: '#111' }}>Review &amp; sign contract</strong>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: '#666' }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {error ? (
            <div style={{ padding: '2rem', color: '#c00' }}>{error}</div>
          ) : signed ? (
            <div style={{ padding: '3rem 2rem', textAlign: 'center', color: '#111' }}>
              <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>✓</div>
              <div style={{ fontWeight: 700, marginBottom: '.4rem' }}>You&rsquo;ve signed.</div>
              <div style={{ color: '#555' }}>We&rsquo;ve emailed the client to sign. You&rsquo;ll be notified when it&rsquo;s complete.</div>
            </div>
          ) : embedSrc ? (
            <DocusealForm src={embedSrc} onComplete={handleComplete} withTitle={false} />
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Preparing your contract…</div>
          )}
        </div>
        <div style={{ padding: '.6rem 1rem', borderTop: '1px solid #eee', textAlign: 'right' }}>
          <button type="button" onClick={onClose} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: 'pointer' }}>
            {signed ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
