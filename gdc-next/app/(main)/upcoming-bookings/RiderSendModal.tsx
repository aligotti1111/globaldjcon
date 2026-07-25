'use client';

// RiderSendModal — the RIDER PORTAL box, opened from the Rider icon on a card.
//
// It's the launch point for a booking's rider. Three things live here:
//   · The DJ's SAVED NAMED RIDERS (from /api/rider/library). Each row: the
//     name + "Use & send" (fires that rider's snapshot straight to this host)
//     + a small "Open" link to review it on the page first.
//   · "Upload a new rider" — opens the file picker immediately; on a chosen
//     PDF it uploads, then navigates to the rider page in upload mode with the
//     just-uploaded file so the DJ PREVIEWS, names, and clicks Confirm & send.
//   · "Create custom rider" — opens the field builder page (no chooser).

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { NamedRider } from '@/lib/rider';

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

export default function RiderSendModal({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [riders, setRiders] = useState<NamedRider[]>([]);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/rider/library');
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; riders?: NamedRider[] };
        if (alive && data.ok && Array.isArray(data.riders)) setRiders(data.riders);
      } catch { /* no saved riders — the build paths still work */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function useAndSend(r: NamedRider) {
    setSendingId(r.id); setMsg(null);
    try {
      const res = await fetch('/api/rider/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, items: r.items, mode: r.mode, pdfUrl: r.pdfUrl, name: r.name }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not send.');
      onClose();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not send — try again.');
      setSendingId(null);
    }
  }

  const openLib = (r: NamedRider) => { window.location.href = `/rider-edit/${bookingId}?mode=${r.mode}&lib=${r.id}`; };
  const goUpload = () => fileRef.current?.click();
  const goCustom = () => { window.location.href = `/rider-edit/${bookingId}?mode=custom`; };

  async function onPickPdf(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setMsg('The rider must be a PDF.'); return; }
    if (file.size > 12 * 1024 * 1024) { setMsg('PDF is too large (max 12MB).'); return; }
    setMsg(null); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('bookingId', bookingId);
      const res = await fetch('/api/rider/upload', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !data.ok || !data.url) throw new Error(data.error || 'Upload failed.');
      // → preview page: name it, then Confirm & send.
      window.location.href = `/rider-edit/${bookingId}?mode=upload&pdf=${encodeURIComponent(data.url)}`;
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Upload failed — try again.');
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 11000, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.2rem' }}
    >
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={onPickPdf} />
      <div style={{ background: 'var(--panel,#14141c)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 14, width: '100%', maxWidth: 500, padding: '1.4rem', maxHeight: '86vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.3rem' }}>
          <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>Rider portal</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: MUTED, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <p style={{ color: MUTED, fontSize: '.85rem', lineHeight: 1.5, margin: '0 0 1.1rem' }}>
          Quick-send one of your saved riders, or build a new one for this booking.
        </p>

        {loading ? (
          <div style={{ color: MUTED, padding: '1rem 0', textAlign: 'center' }}>Loading…</div>
        ) : (
          <>
            {riders.length > 0 && (
              <div style={{ marginBottom: '1.1rem' }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.68rem', letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, marginBottom: '.5rem' }}>
                  Your saved riders
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                  {riders.map((r) => (
                    <div
                      key={r.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '.6rem', border: '1px solid rgba(255,255,255,.14)', borderRadius: 10, padding: '.6rem .8rem', background: 'rgba(255,255,255,.03)' }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '.92rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                        <button
                          type="button"
                          onClick={() => openLib(r)}
                          style={{ background: 'transparent', border: 'none', color: MUTED, textDecoration: 'underline', cursor: 'pointer', fontSize: '.76rem', padding: 0, marginTop: '.15rem' }}
                        >
                          {r.mode === 'upload' ? 'PDF rider · Open' : 'Custom rider · Open'}
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={sendingId !== null || busy}
                        onClick={() => useAndSend(r)}
                        style={{ flexShrink: 0, background: NEON, border: 'none', color: '#06231b', borderRadius: 8, padding: '.5rem .9rem', fontSize: '.82rem', fontWeight: 700, cursor: 'pointer', opacity: sendingId && sendingId !== r.id ? 0.5 : 1 }}
                      >
                        {sendingId === r.id ? 'Sending…' : 'Use & send'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={goUpload}
              style={{ textAlign: 'left', width: '100%', cursor: busy ? 'wait' : 'pointer', borderRadius: 12, padding: '1rem 1.1rem', marginBottom: '.7rem', background: 'rgba(255,255,255,.03)', border: '1.5px solid rgba(255,255,255,.14)' }}
            >
              <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '.3rem', color: '#fff' }}>{busy ? 'Uploading…' : 'Upload a new rider'}</div>
              <div style={{ color: MUTED, fontSize: '.82rem', lineHeight: 1.5 }}>Pick a PDF — you&rsquo;ll preview it, name it, and confirm before it&rsquo;s sent.</div>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={goCustom}
              style={{ textAlign: 'left', width: '100%', cursor: 'pointer', borderRadius: 12, padding: '1rem 1.1rem', background: 'rgba(255,255,255,.03)', border: '1.5px solid rgba(255,255,255,.14)' }}
            >
              <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '.3rem', color: '#fff' }}>Create custom rider</div>
              <div style={{ color: MUTED, fontSize: '.82rem', lineHeight: 1.5 }}>Build your rider from fields. The Technical section is pre-filled from your equipment.</div>
            </button>

            {msg && <div style={{ marginTop: '.8rem', fontSize: '.82rem', color: '#ff8f8f' }}>{msg}</div>}
          </>
        )}
      </div>
    </div>
  );
}
