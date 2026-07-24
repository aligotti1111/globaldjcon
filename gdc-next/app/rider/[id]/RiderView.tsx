'use client';

// RiderView — read-only render of the DJ's rider for the host, with the DJ's
// logo on top and a Print / Save-PDF button.

import { RIDER_SECTIONS, groupRider, type RiderItem } from '@/lib/rider';

function fmtDate(d: string | null): string {
  if (!d) return '';
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

export default function RiderView({
  items, djName, logoUrl, eventDate, venueName, venueAddress,
}: {
  items: RiderItem[];
  djName: string;
  logoUrl: string | null;
  eventDate: string | null;
  venueName: string | null;
  venueAddress: string | null;
}) {
  const g = groupRider(items);
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

        <div style={{ textAlign: 'center', marginBottom: '.4rem', fontWeight: 800, fontSize: '1.6rem' }}>
          DJ Rider
        </div>
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.72)', fontSize: '.95rem', marginBottom: '.3rem' }}>
          {djName}
        </div>
        {(when || venueName) && (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.55)', fontSize: '.85rem', marginBottom: '1.6rem' }}>
            {when}{when && venueName ? ' · ' : ''}{venueName}{venueAddress ? ` — ${venueAddress}` : ''}
          </div>
        )}

        <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '1.5rem' }}>
          {RIDER_SECTIONS.map(({ key, label }) => {
            const rows = g[key];
            if (!rows.length) return null;
            return (
              <div key={key} style={{ marginBottom: '1.3rem' }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--neon,#00e0a4)', marginBottom: '.6rem' }}>
                  {label}
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.15rem', display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
                  {rows.map((it) => (
                    <li key={it.id} style={{ fontSize: '.95rem', lineHeight: 1.5, color: 'rgba(255,255,255,.92)' }}>{it.text}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div style={{ textAlign: 'center', marginTop: '1.4rem' }}>
          <button
            type="button"
            onClick={() => window.print()}
            style={{ background: 'var(--neon,#00e0a4)', color: '#06231b', border: 'none', borderRadius: 8, padding: '.7rem 1.4rem', fontWeight: 700, fontSize: '.9rem', cursor: 'pointer' }}
          >
            Print / Save as PDF
          </button>
        </div>

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,.4)', fontSize: '.72rem', marginTop: '1.2rem' }}>
          Sent via Global DJ Connect
        </p>
      </div>
    </div>
  );
}
