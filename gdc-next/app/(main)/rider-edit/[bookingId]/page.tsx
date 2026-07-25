'use client';

// /rider-edit/[bookingId] — the DJ's rider builder PAGE (club/bar).
//
// The mode (upload vs custom) is ALWAYS chosen before arriving here — from the
// Rider portal box on the booking card, which sends ?mode=upload or
// ?mode=custom. So this page NEVER shows a chooser: it opens straight into the
// editor for that mode. Event details sit at the top, then a REQUIRED rider
// NAME (so the rider is saveable + reusable), then the editor.
//
//   · upload — a PREVIEW-and-confirm screen: the uploaded PDF is shown inline,
//              named, and sent with "Confirm & send" (Replace PDF stays open).
//   · custom — the labeled-field builder, named, then "Save to my riders"
//              (files it in the library) and "Deploy to host".
//
// Query hand-offs (read once on mount from window.location.search, never
// useSearchParams — that would force a Suspense boundary and break the build):
//   · ?mode=      — the entry mode (wins over the saved mode).
//   · ?pdf=<url>  — a just-uploaded PDF from the box's "Upload a new rider".
//   · ?lib=<id>   — open a saved NAMED rider from the library to review/send.

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import RiderBuilder from '@/components/RiderBuilder';
import RiderView from '@/app/rider/[id]/RiderView';
import BusinessLogoSection from '../../update-dj-profile/BusinessLogoSection';
import { normalizeRiderItems, normalizeRiderMode, type RiderItem, type RiderMode, type NamedRider } from '@/lib/rider';

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
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'deploy' | 'lib' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sentUrl, setSentUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('draft');
  const [meta, setMeta] = useState<RiderMeta | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Query hand-offs are read ONCE from window.location.search (mount effect) —
  // never useSearchParams, which would need a Suspense boundary at build.
  const [forcedMode] = useState<RiderMode | null>(() => {
    if (typeof window === 'undefined') return null;
    const qm = new URLSearchParams(window.location.search).get('mode');
    return qm === 'upload' || qm === 'custom' ? qm : null;
  });
  const [forcedPdf] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('pdf') || null;
  });
  const [libId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('lib') || null;
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rider/for-booking/${bookingId}`);
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; items?: unknown; mode?: unknown; pdfUrl?: string | null; name?: string; status?: string; error?: string };
      if (res.status === 401) { window.location.href = '/login?redirect=/upcoming-bookings'; return; }
      if (res.ok && data.ok) {
        setStatus(data.status || 'draft');
        const m = data as unknown as RiderMeta;
        if (m.event) setMeta({ djName: m.djName, logoUrl: m.logoUrl, event: m.event });

        let nextItems = normalizeRiderItems(data.items);
        let nextMode: RiderMode = forcedMode ?? normalizeRiderMode(data.mode);
        let nextPdf: string | null = data.pdfUrl || null;
        let nextName = typeof data.name === 'string' ? data.name : '';

        // Opening a saved NAMED rider from the library: it wins over the
        // booking's own draft (the DJ chose to review that one).
        if (libId) {
          try {
            const lr = await fetch('/api/rider/library');
            const ld = (await lr.json().catch(() => ({}))) as { ok?: boolean; riders?: NamedRider[] };
            const found = (ld.riders || []).find((r) => r.id === libId);
            if (found) {
              nextItems = normalizeRiderItems(found.items);
              nextMode = found.mode;
              nextPdf = found.pdfUrl || null;
              nextName = found.name;
            }
          } catch { /* fall back to the booking's own rider */ }
        }

        // A just-uploaded PDF from the box always lands in upload preview.
        if (forcedPdf) { nextMode = 'upload'; nextPdf = forcedPdf; }

        setItems(nextItems);
        setMode(nextMode);
        setPdfUrl(nextPdf);
        setName(nextName);
      } else {
        setErr(data.error || 'Could not load the rider.');
      }
    } catch { setErr('Could not load the rider.'); }
    finally { setLoading(false); }
  }, [bookingId, forcedMode, forcedPdf, libId]);

  useEffect(() => { if (bookingId) load(); }, [bookingId, load]);

  const hasContent = mode === 'upload' ? !!pdfUrl : items.length > 0;
  const canDeploy = hasContent && !!name.trim();

  async function saveDraft() {
    setBusy('save'); setErr(null); setNote(null);
    try {
      const res = await fetch(`/api/rider/for-booking/${bookingId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, mode, pdfUrl, name }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save.');
      setNote('Draft saved.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(null); }
  }

  async function saveToLibrary() {
    if (!name.trim()) { setErr('Name your rider before saving it.'); return; }
    setBusy('lib'); setErr(null); setNote(null);
    try {
      const res = await fetch('/api/rider/library', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mode, items, pdfUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save.');
      setNote(`Saved "${name.trim()}" to your riders.`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(null); }
  }

  async function deploy() {
    if (!name.trim()) { setErr('Name your rider before sending it.'); return; }
    setBusy('deploy'); setErr(null); setNote(null);
    try {
      const res = await fetch('/api/rider/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId, items, mode, pdfUrl, name }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string; warning?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not send.');
      setStatus('sent'); setSentUrl(data.url || null);
      setNote(data.warning || 'Sent to the host — and saved to your riders.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send.'); }
    finally { setBusy(null); }
  }

  const deployLabel = mode === 'upload'
    ? (busy === 'deploy' ? 'Sending…' : status === 'sent' ? 'Resend to host' : 'Confirm & send')
    : (busy === 'deploy' ? 'Sending…' : status === 'sent' ? 'Resend to host' : 'Deploy to host');

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

          {/* RIDER NAME — required, applies to both modes; makes it reusable. */}
          <div style={{ marginBottom: '1.4rem' }}>
            <label
              style={{
                display: 'block', fontFamily: "'Space Mono', monospace", fontSize: '.7rem',
                letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, marginBottom: '.4rem',
              }}
            >
              Rider name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. House standard, Festival, Small-club minimal"
              maxLength={80}
              style={{
                width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.04)',
                border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, color: '#fff',
                padding: '.6rem .7rem', fontSize: '.95rem', fontWeight: 700,
              }}
            />
            <div style={{ color: MUTED, fontSize: '.76rem', marginTop: '.35rem' }}>
              Saved to your riders so you can quick-send it to any booking next time.
            </div>
          </div>

          {mode === 'upload' && (
            <div style={{ color: MUTED, fontSize: '.85rem', lineHeight: 1.55, margin: '0 0 .9rem' }}>
              Review your uploaded rider below. Name it, then <strong style={{ color: NEON }}>Confirm &amp; send</strong> — this exact PDF is emailed to the host. Use <strong>Replace</strong> to swap the file.
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

          {/* SHOW PREVIEW — exactly how the host/recipient sees this rider. */}
          <div style={{ marginTop: '1.8rem', borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: '1.2rem' }}>
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              style={{ background: 'transparent', border: 'none', color: NEON, fontWeight: 700, fontSize: '.9rem', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}
            >
              {showPreview ? '▾ Hide preview' : '▸ Show preview'}
              <span style={{ color: MUTED, fontWeight: 400, fontSize: '.8rem' }}>— how the host sees it</span>
            </button>
            {showPreview && (
              <div style={{ marginTop: '1rem', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, overflow: 'hidden' }}>
                <RiderView
                  items={items}
                  mode={mode}
                  pdfUrl={pdfUrl}
                  djName={meta?.djName || ''}
                  logoUrl={meta?.logoUrl || null}
                  eventDate={meta?.event.date || null}
                  startTime={meta?.event.start || null}
                  endTime={meta?.event.end || null}
                  eventType={meta?.event.eventType || null}
                  venueName={meta?.event.venueName || null}
                  venueAddress={meta?.event.venueAddress || null}
                />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '.7rem', marginTop: '1.6rem', flexWrap: 'wrap' }}>
            <button type="button" onClick={saveDraft} disabled={busy !== null}
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.28)', borderRadius: 8, color: '#fff', padding: '.65rem 1.2rem', fontWeight: 600, fontSize: '.88rem', cursor: 'pointer' }}>
              {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            {mode === 'custom' && (
              <button type="button" onClick={saveToLibrary} disabled={busy !== null || !hasContent}
                style={{ background: 'rgba(0,224,164,.08)', border: `1px solid ${NEON}`, borderRadius: 8, color: NEON, padding: '.65rem 1.2rem', fontWeight: 700, fontSize: '.88rem', cursor: !hasContent ? 'not-allowed' : 'pointer', opacity: !hasContent ? 0.55 : 1 }}>
                {busy === 'lib' ? 'Saving…' : 'Save to my riders'}
              </button>
            )}
            <button type="button" onClick={deploy} disabled={busy !== null || !canDeploy}
              style={{ background: NEON, border: 'none', borderRadius: 8, color: '#06231b', padding: '.65rem 1.4rem', fontWeight: 700, fontSize: '.88rem', cursor: !canDeploy ? 'not-allowed' : 'pointer', opacity: !canDeploy ? 0.55 : 1 }}>
              {deployLabel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
