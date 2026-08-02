'use client';
import { useState } from 'react';
import { sortGuests, headCount, type GuestEntry } from '@/lib/guestlist';

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

export default function GuestlistView({ guestlistId, confirmedAt, guests, djName, logoUrl, eventDate, startTime, endTime, eventType, venueName, venueAddress }: {
  guestlistId: string; confirmedAt: string | null;
  guests: GuestEntry[]; djName: string; logoUrl: string | null;
  eventDate: string | null; startTime: string | null; endTime: string | null; eventType: string | null;
  venueName: string | null; venueAddress: string | null;
}) {
  const sorted = sortGuests(guests);
  const when = fmtDate(eventDate);

  // Host confirmation — the host reviews the DJ's list and confirms it's right.
  // Stamps booking_guestlists.confirmed_at, read by the DJ's "New activity" sort.
  const [confirmed, setConfirmed] = useState<boolean>(!!confirmedAt);
  const [saving, setSaving] = useState(false);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  async function confirmGuestlist() {
    if (saving || confirmed) return;
    setSaving(true);
    setConfirmErr(null);
    try {
      const res = await fetch('/api/guestlist/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestlistId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || 'Could not confirm.');
      }
      setConfirmed(true);
    } catch (e) {
      setConfirmErr(e instanceof Error ? e.message : 'Could not confirm.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div style={{ minHeight: '100vh', background: '#0d0d14', color: '#fff', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {logoUrl && (
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt={`${djName} logo`} style={{ maxHeight: 90, maxWidth: 260, objectFit: 'contain' }} />
          </div>
        )}
        <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.6rem', marginBottom: '.3rem' }}>Guest List</div>
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.72)', fontSize: '.95rem', marginBottom: '.3rem' }}>{djName}</div>
        {(eventType || when || venueName) && (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.55)', fontSize: '.85rem', marginBottom: '.4rem', lineHeight: 1.6 }}>
            {eventType && <div style={{ color: 'rgba(255,255,255,.85)', fontWeight: 600 }}>{eventType}</div>}
            {[when, [fmtTime(startTime), fmtTime(endTime)].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}
            {venueName && <div>{venueName}{venueAddress ? ` — ${venueAddress}` : ''}</div>}
          </div>
        )}
        <div style={{ textAlign: 'center', color: 'var(--neon,#00e0a4)', fontWeight: 700, fontSize: '.9rem', marginBottom: '1.4rem' }}>
          {sorted.length} names · {headCount(sorted)} total heads
        </div>
        <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '1.4rem' }}>
          {sorted.length === 0 ? <div style={{ color: 'rgba(255,255,255,.5)' }}>No names.</div> : (
            <ol style={{ margin: 0, paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
              {sorted.map((g) => (
                <li key={g.id} style={{ fontSize: '.98rem', lineHeight: 1.5, color: 'rgba(255,255,255,.92)' }}>
                  {g.name}{g.plus > 0 && <span style={{ color: 'rgba(255,255,255,.55)' }}> +{g.plus}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
        <div style={{ textAlign: 'center', marginTop: '1.4rem' }}>
          <button type="button" onClick={() => window.print()}
            style={{ background: 'var(--neon,#00e0a4)', color: '#06231b', border: 'none', borderRadius: 8, padding: '.7rem 1.4rem', fontWeight: 700, fontSize: '.9rem', cursor: 'pointer' }}>
            Print / Save as PDF
          </button>
        </div>
        {/* Host confirmation — one tap to tell the DJ the list is right. */}
        <div style={{ textAlign: 'center', marginTop: '1.6rem' }}>
          {confirmed ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', color: 'var(--neon,#00e0a4)', fontWeight: 700, fontSize: '.95rem' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Guest list confirmed — thanks!
            </div>
          ) : (
            <>
              <button type="button" onClick={confirmGuestlist} disabled={saving}
                style={{ background: 'var(--neon,#00e0a4)', color: '#06231b', border: 'none', borderRadius: 8, padding: '.85rem 1.8rem', fontWeight: 800, fontSize: '.95rem', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Confirming…' : 'Confirm Guest List'}
              </button>
              <div style={{ color: 'rgba(255,255,255,.45)', fontSize: '.75rem', marginTop: '.55rem' }}>
                Confirm the names are right and {djName} will be set for the door.
              </div>
              {confirmErr && <div style={{ color: '#ff9a9a', fontSize: '.78rem', marginTop: '.5rem' }}>{confirmErr}</div>}
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,.4)', fontSize: '.72rem', marginTop: '1.2rem' }}>Sent via Global DJ Connect</p>
      </div>
    </div>
  );
}
