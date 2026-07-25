'use client';

// /rider-edit/[bookingId] — the DJ's rider builder PAGE (club/bar).
//
// The mode (upload vs custom) is ALWAYS chosen before arriving here — from the
// Rider icon's chooser box on the booking card, which sends ?mode=upload or
// ?mode=custom. So this page NEVER shows a chooser: it opens straight into the
// editor for that mode. Event details sit at the top. Save keeps a draft;
// Deploy sends it to the host (rider PDF attached).

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import RiderBuilder from '@/components/RiderBuilder';
import BusinessLogoSection from '../../update-dj-profile/BusinessLogoSection';
import { normalizeRiderItems, normalizeRiderMode, type RiderItem, type RiderMode } from '@/lib/rider';

interface RiderMeta {
  djName: string; logoUrl: string | null;
  event: { date: string | null; start: string | null; end: string | null; venueName: string | null; venueAddress: string | null; eventType: string | null };
}

function fmtDate(d: string | null): string {
  if (!d) return '';
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtTime(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':'); const hn = Number(h);
  if (!Number.isFinite(hn)) return '';
  const ap = hn >= 12 ? 'PM' : 'AM'; const h12 = hn % 12 === 0 ? 12 : hn % 12;
  return `${h12}:${m || '00'} ${ap}`;
}

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

export default function RiderEditPage() {
  const params = useParams();
  const bookingId = String((params as Record<string, string | string[]>)?.bookingId || '');

  const [items, setItems] = useState<RiderItem[]>([]);
  const [mode, setMode] = useState<RiderMode>('custom');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'deploy' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sentUrl, setSentUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('draft');
  const [meta, setMeta] = useState<RiderMeta | null>(null);

  // The mode is decided at the entry point and passed as ?mode=. It wins over
  // whatever mode was saved, so the page opens exactly where the DJ chose.
  const [forcedMode] = useState<RiderMode | null>(() => {
    if (typeof window === 'undefined') return null;
    const qm = new URLSearchParams(window.location.search).get('mode');
    return qm === 'upload' || qm === 'custom' ? qm : null;
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rider/for-booking/${bookingId}`);
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; items?: unknown; mode?: unknown; pdfUrl?: string | null; status?: string; error?: string };
      if (res.status === 401) { window.location.href = '/login?redirect=/upcoming-bookings'; return; }
      if (res.ok && data.ok) {
        setItems(normalizeRiderItems(data.items)); setStatus(data.status || 'draft');
        setMode(forcedMode ?? normalizeRiderMode(data.mode)); setPdfUrl(data.pdfUrl || null);
        const m = data as unknown as RiderMeta;
        if (m.event) setMeta({ djName: m.djName, logoUrl: m.logoUrl, event: m.event });
      }
      else setErr(data.error || 'Could not load the rider.');
    } catch { setErr('Could not load the rider.'); }
    finally { setLoading(false); }
  }, [bookingId, forcedMode]);

  useEffect(() => { if (bookingId) load(); }, [bookingId, load]);

  const canDeploy = mode === 'upload' ? !!pdfUrl : items.length > 0;

  async function save() {
    setBusy('save'); setErr(null); setNote(null);
    try {
      const res = await fetch(`/api/rider/for-booking/${bookingId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, mode, pdfUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save.');
      setNote('Draft saved.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(null); }
  }

  async function deploy() {
    setBusy('deploy'); setErr(null); setNote(null);
    try {
      const res = await fetch('/api/rider/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId, items, mode, pdfUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string; warning?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not send.');
      setStatus('sent'); setSentUrl(data.url || null);
      setNote(data.warning || 'Sent to the host.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send.'); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>
      <Link href="/upcoming-bookings" style={{ color: MUTED, fontSize: '.85rem', textDecoration: 'none' }}>← Back to bookings</Link>
      <h1 style={{ margin: '.6rem 0 1.2rem', fontSize: '1.7rem' }}>
        {mode === 'upload' ? 'Upload Rider' : 'Custom Rider'}
      </h1>

      {loading ? (
        <div style={{ color: MUTED, padding: '2rem 0' }}>Loading…</div>
      ) : (
        <>
          {/* EVENT DETAILS — always at the top of the page */}
          {meta && (
            <div style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '1.2rem 1.3rem', marginBottom: '1.4rem', background: 'rgba(255,255,255,.02)', textAlign: 'center' }}>
              {meta.logoUrl && (
                <div style={{ marginBottom: '.7rem' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={meta.logoUrl} alt="" style={{ maxHeight: 60, maxWidth: 200, objectFit: 'contain' }} />
                </div>
              )}
              {meta.event.eventType && <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{meta.event.eventType}</div>}
              <div style={{ color: 'rgba(255,255,255,.7)', fontSize: '.9rem', lineHeight: 1.6, marginTop: '.2rem' }}>
                {[fmtDate(meta.event.date), [fmtTime(meta.event.start), fmtTime(meta.event.end)].filter(Boolean).join(' – ')].filter(Boolean).join('  ·  ')}
                {meta.event.venueName && <div>{meta.event.venueName}{meta.event.venueAddress ? ` — ${meta.event.venueAddress}` : ''}</div>}
              </div>
            </div>
          )}

          {/* FULL-WIDTH editor for the chosen mode — chooser is hidden. */}
          <RiderBuilder
            hideChooser
            mode={mode}
            onModeChange={setMode}
            items={items}
            onItemsChange={setItems}
            pdfUrl={pdfUrl}
            onPdfUrlChange={setPdfUrl}
            bookingId={bookingId}
          />

          {meta && !meta.logoUrl && mode === 'custom' && (
            <div style={{ marginTop: '1.6rem', padding: '1.1rem', border: '1px dashed rgba(255,255,255,.22)', borderRadius: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: '.25rem' }}>Add your logo</div>
              <p style={{ color: MUTED, fontSize: '.82rem', lineHeight: 1.55, margin: '0 0 .9rem' }}>
                You don&rsquo;t have a logo yet. Add one and it appears at the top of this rider (and on your contracts and planners).
              </p>
              <BusinessLogoSection />
            </div>
          )}

          {err && <div style={{ color: '#ff8f8f', fontSize: '.88rem', marginTop: '1rem' }}>{err}</div>}
          {note && !err && <div style={{ color: NEON, fontSize: '.88rem', marginTop: '1rem' }}>{note}</div>}
          {sentUrl && (
            <div style={{ marginTop: '.6rem', fontSize: '.82rem', color: MUTED, wordBreak: 'break-all' }}>
              Host link: <a href={sentUrl} target="_blank" rel="noreferrer" style={{ color: NEON }}>{sentUrl}</a>
            </div>
          )}

          <div style={{ display: 'flex', gap: '.7rem', marginTop: '1.6rem' }}>
            <button type="button" onClick={save} disabled={busy !== null}
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.28)', borderRadius: 8, color: '#fff', padding: '.65rem 1.2rem', fontWeight: 600, fontSize: '.88rem', cursor: 'pointer' }}>
              {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button type="button" onClick={deploy} disabled={busy !== null || !canDeploy}
              style={{ background: NEON, border: 'none', borderRadius: 8, color: '#06231b', padding: '.65rem 1.4rem', fontWeight: 700, fontSize: '.88rem', cursor: !canDeploy ? 'not-allowed' : 'pointer', opacity: !canDeploy ? 0.55 : 1 }}>
              {busy === 'deploy' ? 'Sending…' : status === 'sent' ? 'Resend to host' : 'Deploy to host'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
