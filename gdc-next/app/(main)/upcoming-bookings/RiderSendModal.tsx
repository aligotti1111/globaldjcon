'use client';

// RiderSendModal — the CHOOSER BOX that opens from the Rider icon on the card.
//
// It only makes the choice; the actual editing happens on /rider-edit. Three
// options:
//   · Use my saved rider  — only when a rider was already built/uploaded for
//                           this booking; opens it as-is to review & send.
//   · Upload Rider        — upload a pre-made PDF (sent to the host as-is).
//   · Create Custom Rider — build from fields (Technical pre-filled from gear).
// Each option navigates to /rider-edit/[bookingId]?mode=… ; the page opens
// straight into that mode with NO chooser (the choice is made here).

import { useEffect, useState } from 'react';
import { normalizeRiderMode, type RiderMode } from '@/lib/rider';

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

export default function RiderSendModal({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [savedMode, setSavedMode] = useState<RiderMode | null>(null);
  const [savedLabel, setSavedLabel] = useState('');
  const [status, setStatus] = useState('draft');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/rider/for-booking/${bookingId}`);
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; items?: unknown; mode?: unknown; pdfUrl?: string | null; status?: string };
        if (!alive) return;
        if (res.ok && data.ok) {
          const m = normalizeRiderMode(data.mode);
          const items = Array.isArray(data.items) ? data.items : [];
          const hasContent = m === 'upload' ? !!data.pdfUrl : items.length > 0;
          setStatus(data.status || 'draft');
          // Offer "use saved" only when a real rider exists for this booking.
          if (hasContent) {
            setSavedMode(m);
            setSavedLabel(m === 'upload' ? 'uploaded rider PDF' : 'custom rider');
          }
        }
      } catch { /* ignore — chooser still offers the two build paths */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [bookingId]);

  const go = (mode: RiderMode) => { window.location.href = `/rider-edit/${bookingId}?mode=${mode}`; };

  const Opt = ({ title, desc, onClick, highlight }: { title: string; desc: string; onClick: () => void; highlight?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left', width: '100%', cursor: 'pointer', borderRadius: 12,
        padding: '1rem 1.1rem', marginBottom: '.7rem',
        background: highlight ? 'rgba(0,224,164,.06)' : 'rgba(255,255,255,.03)',
        border: highlight ? `1.5px solid ${NEON}` : '1.5px solid rgba(255,255,255,.14)',
      }}
    >
      <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '.3rem', color: highlight ? NEON : '#fff' }}>{title}</div>
      <div style={{ color: MUTED, fontSize: '.82rem', lineHeight: 1.5 }}>{desc}</div>
    </button>
  );

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 11000, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.2rem' }}
    >
      <div style={{ background: 'var(--panel,#14141c)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 14, width: '100%', maxWidth: 480, padding: '1.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.3rem' }}>
          <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>DJ Rider</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: MUTED, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <p style={{ color: MUTED, fontSize: '.85rem', lineHeight: 1.5, margin: '0 0 1.1rem' }}>
          Choose how to set up this booking&rsquo;s rider, then send it to the host.
        </p>

        {loading ? (
          <div style={{ color: MUTED, padding: '1rem 0', textAlign: 'center' }}>Loading…</div>
        ) : (
          <>
            {savedMode && (
              <Opt
                highlight
                title={`Use my saved ${savedLabel}`}
                desc={status === 'sent' ? 'Open the rider you already sent — review and resend it.' : 'Open the rider you already saved for this booking — review and send.'}
                onClick={() => go(savedMode)}
              />
            )}
            <Opt
              title="Upload Rider"
              desc="Upload your pre-made rider as a PDF. It's sent to the host exactly as-is."
              onClick={() => go('upload')}
            />
            <Opt
              title="Create Custom Rider"
              desc="Build your rider from fields. The Technical section is pre-filled from your equipment, and we generate a branded PDF."
              onClick={() => go('custom')}
            />
          </>
        )}
      </div>
    </div>
  );
}
