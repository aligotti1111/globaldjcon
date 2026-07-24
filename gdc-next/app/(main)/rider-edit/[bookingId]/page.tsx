'use client';

// /rider-edit/[bookingId] — the DJ's rider builder PAGE (club/bar).
//
// A full page, not a modal: the DJ arranges the rider, reorders lines, and sees
// the exact layout the host will get in a live preview beside the editor. The
// technical section is pre-filled from the booking's equipment choice and stays
// fully editable. Save keeps a draft; Deploy sends it to the host.

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import RiderEditor from '@/components/RiderEditor';
import { normalizeRiderItems, groupRider, RIDER_SECTIONS, type RiderItem } from '@/lib/rider';

export default function RiderEditPage() {
  const params = useParams();
  const bookingId = String((params as Record<string, string | string[]>)?.bookingId || '');

  const [items, setItems] = useState<RiderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'deploy' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sentUrl, setSentUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('draft');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rider/for-booking/${bookingId}`);
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; items?: unknown; status?: string; error?: string };
      if (res.status === 401) { window.location.href = '/login?redirect=/upcoming-bookings'; return; }
      if (res.ok && data.ok) { setItems(normalizeRiderItems(data.items)); setStatus(data.status || 'draft'); }
      else setErr(data.error || 'Could not load the rider.');
    } catch { setErr('Could not load the rider.'); }
    finally { setLoading(false); }
  }, [bookingId]);

  useEffect(() => { if (bookingId) load(); }, [bookingId, load]);

  async function save() {
    setBusy('save'); setErr(null); setNote(null);
    try {
      const res = await fetch(`/api/rider/for-booking/${bookingId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId, items }),
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
      <p style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.9rem', lineHeight: 1.6, margin: '0 0 1.4rem', maxWidth: 620 }}>
        Arrange what you need from the venue. The <strong>Technical</strong> section is filled in from
        this booking&rsquo;s equipment choice — edit it freely. Use the arrows to reorder. The preview
        on the right is exactly what the host receives.
        {status === 'sent' ? ' This rider has already been sent; deploying again resends the latest version.' : ''}
      </p>

      {loading ? (
        <div style={{ color: 'var(--muted,#8a8aa0)', padding: '2rem 0' }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.6rem', alignItems: 'start' }}>
          {/* Editor */}
          <div>
            <div style={{ fontWeight: 700, marginBottom: '.8rem' }}>Edit</div>
            <RiderEditor items={items} onChange={setItems} />
          </div>

          {/* Live preview — the host's layout */}
          <div>
            <div style={{ fontWeight: 700, marginBottom: '.8rem' }}>Preview</div>
            <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '1.4rem' }}>
              <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.25rem', marginBottom: '1.1rem' }}>DJ Rider</div>
              {RIDER_SECTIONS.map(({ key, label }) => {
                const rows = g[key];
                if (!rows.length) return null;
                return (
                  <div key={key} style={{ marginBottom: '1.1rem' }}>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.7rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--neon,#00e0a4)', marginBottom: '.5rem' }}>{label}</div>
                    <ul style={{ margin: 0, paddingLeft: '1.15rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                      {rows.map((it) => (
                        <li key={it.id} style={{ fontSize: '.9rem', lineHeight: 1.5, color: it.text.trim() ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.35)' }}>
                          {it.text.trim() || 'Empty line — fill it in or remove it'}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {items.length === 0 && <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.85rem' }}>Nothing added yet.</div>}
            </div>
          </div>
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
          <button type="button" onClick={deploy} disabled={busy !== null || items.length === 0}
            style={{ background: 'var(--neon,#00e0a4)', border: 'none', borderRadius: 8, color: '#06231b', padding: '.65rem 1.4rem', fontWeight: 700, fontSize: '.88rem', cursor: items.length === 0 ? 'not-allowed' : 'pointer', opacity: items.length === 0 ? 0.55 : 1 }}>
            {busy === 'deploy' ? 'Sending…' : status === 'sent' ? 'Resend to host' : 'Deploy to host'}
          </button>
        </div>
      )}
    </div>
  );
}
