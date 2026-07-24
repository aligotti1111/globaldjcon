'use client';

// /guestlist-edit/[bookingId] — the DJ's guest-list builder (club/bar).
// One field: type or paste names, one per line, "Name +2" for plus-ones. Live
// preview counts heads and Sort A–Z alphabetizes. Deploy sends it to the host.

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import BusinessLogoSection from '../../update-dj-profile/BusinessLogoSection';
import { parseGuests, guestsToText, sortGuests, headCount, normalizeGuests } from '@/lib/guestlist';

interface Meta {
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

export default function GuestlistEditPage() {
  const params = useParams();
  const bookingId = String((params as Record<string, string | string[]>)?.bookingId || '');

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'deploy' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sentUrl, setSentUrl] = useState<string | null>(null);
  const [status, setStatus] = useState('draft');
  const [meta, setMeta] = useState<Meta | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/guestlist/for-booking/${bookingId}`);
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; guests?: unknown; status?: string; error?: string } & Partial<Meta>;
      if (res.status === 401) { window.location.href = '/login?redirect=/upcoming-bookings'; return; }
      if (res.ok && data.ok) {
        setText(guestsToText(normalizeGuests(data.guests)));
        setStatus(data.status || 'draft');
        if (data.event) setMeta({ djName: data.djName || 'Your DJ', logoUrl: data.logoUrl || null, event: data.event });
      } else setErr(data.error || 'Could not load the guest list.');
    } catch { setErr('Could not load the guest list.'); }
    finally { setLoading(false); }
  }, [bookingId]);
  useEffect(() => { if (bookingId) load(); }, [bookingId, load]);

  const entries = parseGuests(text);
  const heads = headCount(entries);

  async function save() {
    setBusy('save'); setErr(null); setNote(null);
    try {
      const res = await fetch(`/api/guestlist/for-booking/${bookingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guests: entries }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save.');
      setNote('Draft saved.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(null); }
  }
  async function deploy() {
    setBusy('deploy'); setErr(null); setNote(null);
    try {
      const res = await fetch('/api/guestlist/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId, guests: entries }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string; warning?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not send.');
      setStatus('sent'); setSentUrl(data.url || null); setNote(data.warning || 'Sent to the host.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send.'); }
    finally { setBusy(null); }
  }
  function sortAZ() { setText(guestsToText(sortGuests(entries))); }

  const muted = 'var(--muted,#8a8aa0)';

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>
      <Link href="/upcoming-bookings" style={{ color: muted, fontSize: '.85rem', textDecoration: 'none' }}>← Back to bookings</Link>
      <h1 style={{ margin: '.6rem 0 .3rem', fontSize: '1.7rem' }}>Guest List</h1>
      <p style={{ color: muted, fontSize: '.9rem', lineHeight: 1.6, margin: '0 0 1.4rem', maxWidth: 640 }}>
        Type or paste the names you need on the door — one per line. Add plus-ones as
        <strong> Name +2</strong>. Use <strong>Sort A–Z</strong> to alphabetize. The preview is what the host receives.
        {status === 'sent' ? ' This list has already been sent; deploying again resends the latest version.' : ''}
      </p>

      {loading ? <div style={{ color: muted, padding: '2rem 0' }}>Loading…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.6rem', alignItems: 'start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.7rem' }}>
              <span style={{ fontWeight: 700 }}>Names</span>
              <button type="button" onClick={sortAZ} disabled={entries.length === 0}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.28)', borderRadius: 8, color: '#fff', padding: '.35rem .7rem', fontSize: '.8rem', fontWeight: 600, cursor: entries.length === 0 ? 'not-allowed' : 'pointer', opacity: entries.length === 0 ? 0.5 : 1 }}>
                Sort A–Z
              </button>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Jane Smith +2\nAlex Johnson\nMaria Garcia +1"}
              rows={14}
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--panel-2, rgba(255,255,255,.04))', border: '1px solid rgba(255,255,255,.14)', borderRadius: 10, color: '#fff', padding: '.7rem .8rem', fontSize: '.92rem', lineHeight: 1.6, resize: 'vertical' }}
            />
          </div>

          <div>
            <div style={{ fontWeight: 700, marginBottom: '.7rem' }}>Preview</div>
            <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '1.4rem' }}>
              {meta?.logoUrl && (
                <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={meta.logoUrl} alt="" style={{ maxHeight: 70, maxWidth: 200, objectFit: 'contain' }} />
                </div>
              )}
              <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.25rem', marginBottom: '.3rem' }}>Guest List</div>
              {meta && (
                <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.6)', fontSize: '.82rem', lineHeight: 1.55, marginBottom: '1rem' }}>
                  {meta.event.eventType && <div style={{ color: 'rgba(255,255,255,.9)', fontWeight: 600 }}>{meta.event.eventType}</div>}
                  {[fmtDate(meta.event.date), [fmtTime(meta.event.start), fmtTime(meta.event.end)].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}
                  {meta.event.venueName && <div>{meta.event.venueName}</div>}
                </div>
              )}
              <div style={{ textAlign: 'center', color: 'var(--neon,#00e0a4)', fontSize: '.8rem', fontWeight: 700, marginBottom: '.9rem' }}>
                {entries.length} names · {heads} total heads
              </div>
              {entries.length === 0 ? <div style={{ color: muted, fontSize: '.85rem', textAlign: 'center' }}>No names yet.</div> : (
                <ol style={{ margin: 0, paddingLeft: '1.4rem', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                  {entries.map((g) => (
                    <li key={g.id} style={{ fontSize: '.92rem', color: 'rgba(255,255,255,.92)' }}>
                      {g.name}{g.plus > 0 && <span style={{ color: muted }}> +{g.plus}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && meta && !meta.logoUrl && (
        <div style={{ marginTop: '1.6rem', padding: '1.1rem', border: '1px dashed rgba(255,255,255,.22)', borderRadius: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: '.25rem' }}>Add your logo</div>
          <p style={{ color: muted, fontSize: '.82rem', lineHeight: 1.55, margin: '0 0 .9rem' }}>No logo yet — add one and it appears at the top of this list (and your contracts, planners, riders).</p>
          <BusinessLogoSection />
        </div>
      )}

      {err && <div style={{ color: '#ff8f8f', fontSize: '.88rem', marginTop: '1rem' }}>{err}</div>}
      {note && !err && <div style={{ color: 'var(--neon,#00e0a4)', fontSize: '.88rem', marginTop: '1rem' }}>{note}</div>}
      {sentUrl && <div style={{ marginTop: '.6rem', fontSize: '.82rem', color: muted, wordBreak: 'break-all' }}>Host link: <a href={sentUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--neon,#00e0a4)' }}>{sentUrl}</a></div>}

      {!loading && (
        <div style={{ display: 'flex', gap: '.7rem', marginTop: '1.6rem' }}>
          <button type="button" onClick={save} disabled={busy !== null}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.28)', borderRadius: 8, color: '#fff', padding: '.65rem 1.2rem', fontWeight: 600, fontSize: '.88rem', cursor: 'pointer' }}>
            {busy === 'save' ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" onClick={deploy} disabled={busy !== null || entries.length === 0}
            style={{ background: 'var(--neon,#00e0a4)', border: 'none', borderRadius: 8, color: '#06231b', padding: '.65rem 1.4rem', fontWeight: 700, fontSize: '.88rem', cursor: entries.length === 0 ? 'not-allowed' : 'pointer', opacity: entries.length === 0 ? 0.55 : 1 }}>
            {busy === 'deploy' ? 'Sending…' : status === 'sent' ? 'Resend to host' : 'Deploy to host'}
          </button>
        </div>
      )}
    </div>
  );
}
