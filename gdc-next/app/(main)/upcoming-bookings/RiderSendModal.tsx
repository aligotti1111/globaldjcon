'use client';

// RiderSendModal — the DJ customizes this booking's rider on the card and
// deploys it to the host. The FIRST thing shown is the two-option entry step
// (Upload Rider / Create Custom Rider) via RiderBuilder. Loads the booking's
// rider (seeded from the DJ's default if none exists yet), then Save (keep as
// draft) or Deploy (send to host + email with the rider PDF attached).

import { useEffect, useState } from 'react';
import RiderBuilder from '@/components/RiderBuilder';
import { normalizeRiderItems, normalizeRiderMode, type RiderItem, type RiderMode } from '@/lib/rider';

export default function RiderSendModal({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const [items, setItems] = useState<RiderItem[]>([]);
  const [mode, setMode] = useState<RiderMode>('custom');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'deploy' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sentUrl, setSentUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('draft');
  const [savedNote, setSavedNote] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/rider/for-booking/${bookingId}`);
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; items?: unknown; mode?: unknown; pdfUrl?: string | null; status?: string; error?: string };
        if (!alive) return;
        if (res.ok && data.ok) {
          setItems(normalizeRiderItems(data.items));
          setMode(normalizeRiderMode(data.mode));
          setPdfUrl(data.pdfUrl || null);
          setStatus(data.status || 'draft');
        }
        else setErr(data.error || 'Could not load the rider.');
      } catch { if (alive) setErr('Could not load the rider.'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [bookingId]);

  const canDeploy = mode === 'upload' ? !!pdfUrl : items.length > 0;

  async function save() {
    setBusy('save'); setErr(null); setSavedNote(false);
    try {
      const res = await fetch(`/api/rider/for-booking/${bookingId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, mode, pdfUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save the rider.');
      setSavedNote(true);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save the rider.'); }
    finally { setBusy(null); }
  }

  async function deploy() {
    setBusy('deploy'); setErr(null); setSavedNote(false);
    try {
      const res = await fetch('/api/rider/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId, items, mode, pdfUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string; warning?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not send the rider.');
      setSentUrl(data.url || null); setStatus('sent');
      if (data.warning) setErr(data.warning);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send the rider.'); }
    finally { setBusy(null); }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 11000, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.2rem' }}
    >
      <div style={{ background: 'var(--panel,#14141c)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 14, width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto', padding: '1.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.3rem' }}>
          <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>DJ Rider</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'var(--muted,#888)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <p style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.85rem', lineHeight: 1.5, margin: '0 0 1rem' }}>
          Upload a pre-made rider PDF, or create a custom rider from fields, then send it to the host.
          {status === 'sent' ? ' This rider has already been sent — deploying again resends the latest version.' : ''}
        </p>

        {loading ? (
          <div style={{ color: 'var(--muted,#8a8aa0)', padding: '1.5rem 0', textAlign: 'center' }}>Loading…</div>
        ) : (
          <RiderBuilder
            mode={mode}
            onModeChange={setMode}
            items={items}
            onItemsChange={setItems}
            pdfUrl={pdfUrl}
            onPdfUrlChange={setPdfUrl}
            bookingId={bookingId}
          />
        )}

        {err && <div style={{ color: '#ff8f8f', fontSize: '.85rem', marginTop: '.9rem' }}>{err}</div>}
        {savedNote && !err && <div style={{ color: 'var(--neon,#00e0a4)', fontSize: '.85rem', marginTop: '.9rem' }}>Saved.</div>}
        {sentUrl && (
          <div style={{ marginTop: '.9rem', fontSize: '.82rem', color: 'var(--muted,#8a8aa0)', wordBreak: 'break-all' }}>
            Sent to the host. Link: <a href={sentUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--neon,#00e0a4)' }}>{sentUrl}</a>
          </div>
        )}

        {!loading && (
          <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end', marginTop: '1.2rem' }}>
            <button type="button" onClick={save} disabled={busy !== null}
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.28)', borderRadius: 8, color: '#fff', padding: '.6rem 1rem', fontWeight: 600, fontSize: '.85rem', cursor: 'pointer' }}>
              {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button type="button" onClick={deploy} disabled={busy !== null || !canDeploy}
              style={{ background: 'var(--neon,#00e0a4)', border: 'none', borderRadius: 8, color: '#06231b', padding: '.6rem 1.1rem', fontWeight: 700, fontSize: '.85rem', cursor: !canDeploy ? 'not-allowed' : 'pointer', opacity: !canDeploy ? 0.55 : 1 }}>
              {busy === 'deploy' ? 'Sending…' : status === 'sent' ? 'Resend to host' : 'Deploy to host'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
