'use client';

// /rider-edit/[bookingId] — the DJ's rider builder PAGE (club/bar).
//
// A full page, not a modal. The FIRST thing shown is the two-option entry step
// (Upload Rider / Create Custom Rider) via RiderBuilder. In custom mode the DJ
// arranges labeled fields — the Technical section pre-filled from the booking's
// equipment choice, fully editable — and sees a live preview beside the editor.
// In upload mode the DJ uploads a PDF that is sent to the host as-is. Save
// keeps a draft; Deploy sends it to the host (with the rider PDF attached).

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import RiderBuilder from '@/components/RiderBuilder';
import BusinessLogoSection from '../../update-dj-profile/BusinessLogoSection';
import {
  normalizeRiderItems, normalizeRiderMode, groupRider, RIDER_SECTIONS,
  type RiderItem, type RiderMode,
} from '@/lib/rider';

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

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rider/for-booking/${bookingId}`);
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; items?: unknown; mode?: unknown; pdfUrl?: string | null; status?: string; error?: string };
      if (res.status === 401) { window.location.href = '/login?redirect=/upcoming-bookings'; return; }
      if (res.ok && data.ok) {
        setItems(normalizeRiderItems(data.items)); setStatus(data.status || 'draft');
        setMode(normalizeRiderMode(data.mode)); setPdfUrl(data.pdfUrl || null);
        const m = data as unknown as RiderMeta;
        if (m.event) setMeta({ djName: m.djName, logoUrl: m.logoUrl, event: m.event });
      }
      else setErr(data.error || 'Could not load the rider.');
    } catch { setErr('Could not load the rider.'); }
    finally { setLoading(false); }
  }, [bookingId]);

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

  const g = groupRider(items);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>
      <Link href="/upcoming-bookings" style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.85rem', textDecoration: 'none' }}>
        ← Back to bookings
      </Link>
      <h1 style={{ margin: '.6rem 0 .3rem', fontSize: '1.7rem' }}>DJ Rider</h1>
      <p style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.9rem', lineHeight: 1.6, margin: '0 0 1.4rem', maxWidth: 640 }}>
        Choose how to build this rider: upload a pre-made PDF, or create a custom
        rider from fields. In custom mode the <strong>Technical</strong> section is filled in from
        this booking&rsquo;s equipment choice — edit it freely.
        {status === 'sent' ? ' This rider has already been sent; deploying again resends the latest version.' : ''}
      </p>

      {loading ? (
        <div style={{ color: 'var(--muted,#8a8aa0)', padding: '2rem 0' }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: mode === 'custom' ? 'repeat(auto-fit, minmax(300px, 1fr))' : '1fr', gap: '1.6rem', alignItems: 'start' }}>
          {/* Builder (mode step + editor / upload) */}
          <div>
            <div style={{ fontWeight: 700, marginBottom: '.8rem' }}>Build</div>
            <RiderBuilder
              mode={mode}
              onModeChange={setMode}
              items={items}
              onItemsChange={setItems}
              pdfUrl={pdfUrl}
              onPdfUrlChange={setPdfUrl}
              bookingId={bookingId}
            />
          </div>

          {/* Live preview — custom mode only */}
          {mode === 'custom' && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: '.8rem' }}>Preview</div>
              <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '1.4rem' }}>
                {meta?.logoUrl && (
                  <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={meta.logoUrl} alt="" style={{ maxHeight: 70, maxWidth: 200, objectFit: 'contain' }} />
                  </div>
                )}
                <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.25rem', marginBottom: '.3rem' }}>DJ Rider</div>
                {meta && (
                  <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.6)', fontSize: '.82rem', lineHeight: 1.55, marginBottom: '1.2rem' }}>
                    {meta.event.eventType && <div style={{ color: 'rgba(255,255,255,.9)', fontWeight: 600 }}>{meta.event.eventType}</div>}
                    {[fmtDate(meta.event.date), [fmtTime(meta.event.start), fmtTime(meta.event.end)].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}
                    {meta.event.venueName && <div>{meta.event.venueName}{meta.event.venueAddress ? ` — ${meta.event.venueAddress}` : ''}</div>}
                  </div>
                )}
                {RIDER_SECTIONS.map(({ key, label }) => {
                  const rows = g[key];
                  if (!rows.length) return null;
                  return (
                    <div key={key} style={{ marginBottom: '1.1rem' }}>
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.7rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--neon,#00e0a4)', marginBottom: '.5rem' }}>{label}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                        {rows.map((it) => {
                          const lab = (it.label || '').trim();
                          const val = (it.value || '').trim();
                          const empty = !lab && !val;
                          return (
                            <div key={it.id} style={{ display: 'flex', gap: '.6rem', fontSize: '.88rem', lineHeight: 1.45, alignItems: 'baseline', color: empty ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.9)' }}>
                              {lab && <div style={{ minWidth: 130, maxWidth: 130, color: 'rgba(255,255,255,.55)', fontWeight: 600 }}>{lab}</div>}
                              <div style={{ flex: 1 }}>{empty ? 'Empty field — fill it in or remove it' : (val || '')}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.85rem' }}>Nothing added yet.</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && meta && !meta.logoUrl && (
        <div style={{ marginTop: '1.6rem', padding: '1.1rem', border: '1px dashed rgba(255,255,255,.22)', borderRadius: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: '.25rem' }}>Add your logo</div>
          <p style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.82rem', lineHeight: 1.55, margin: '0 0 .9rem' }}>
            You don&rsquo;t have a logo yet. Add one and it appears at the top of this rider (and on your
            contracts and planners).
          </p>
          <BusinessLogoSection />
        </div>
      )}
      {err && <div style={{ color: '#ff8f8f', fontSize: '.88rem', marginTop: '1rem' }}>{err}</div>}
      {note && !err && <div style={{ color: 'var(--neon,#00e0a4)', fontSize: '.88rem', marginTop: '1rem' }}>{note}</div>}
      {sentUrl && (
        <div style={{ marginTop: '.6rem', fontSize: '.82rem', color: 'var(--muted,#8a8aa0)', wordBreak: 'break-all' }}>
          Host link: <a href={sentUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--neon,#00e0a4)' }}>{sentUrl}</a>
        </div>
      )}

      {!loading && (
        <div style={{ display: 'flex', gap: '.7rem', marginTop: '1.6rem' }}>
          <button type="button" onClick={save} disabled={busy !== null}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.28)', borderRadius: 8, color: '#fff', padding: '.65rem 1.2rem', fontWeight: 600, fontSize: '.88rem', cursor: 'pointer' }}>
            {busy === 'save' ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" onClick={deploy} disabled={busy !== null || !canDeploy}
            style={{ background: 'var(--neon,#00e0a4)', border: 'none', borderRadius: 8, color: '#06231b', padding: '.65rem 1.4rem', fontWeight: 700, fontSize: '.88rem', cursor: !canDeploy ? 'not-allowed' : 'pointer', opacity: !canDeploy ? 0.55 : 1 }}>
            {busy === 'deploy' ? 'Sending…' : status === 'sent' ? 'Resend to host' : 'Deploy to host'}
          </button>
        </div>
      )}
    </div>
  );
}
