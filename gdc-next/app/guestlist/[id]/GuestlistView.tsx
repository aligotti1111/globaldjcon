'use client';
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

export default function GuestlistView({ guests, djName, logoUrl, eventDate, startTime, endTime, eventType, venueName, venueAddress }: {
  guests: GuestEntry[]; djName: string; logoUrl: string | null;
  eventDate: string | null; startTime: string | null; endTime: string | null; eventType: string | null;
  venueName: string | null; venueAddress: string | null;
}) {
  const sorted = sortGuests(guests);
  const when = fmtDate(eventDate);
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
        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,.4)', fontSize: '.72rem', marginTop: '1.2rem' }}>Sent via Global DJ Connect</p>
      </div>
    </div>
  );
}
