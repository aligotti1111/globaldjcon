'use client';

// RiderView — read-only render of the DJ's rider for the host, with the DJ's
// logo on top. Two shapes, keyed by mode:
//   · upload — the DJ's own PDF, shown inline with a download button.
//   · custom — the labeled fields (label + value), grouped by section, plus a
//              Print / Save-PDF button.

import { RIDER_SECTIONS, groupRider, type RiderItem, type RiderMode } from '@/lib/rider';

function fmtDate(d: string | null): string {
  if (!d) return '';
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function fmtTime(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':'); const hn = Number(h);
  if (!Number.isFinite(hn)) return '';
  const ap = hn >= 12 ? 'PM' : 'AM'; const h12 = hn % 12 === 0 ? 12 : hn % 12;
  return `${h12}:${m || '00'} ${ap}`;
}

export default function RiderView({
  items, mode, pdfUrl, riderName, djName, logoUrl, eventDate, startTime, endTime, eventType, venueName, venueAddress,
}: {
  items: RiderItem[];
  mode: RiderMode;
  pdfUrl: string | null;
  riderName: string | null;
  djName: string;
  logoUrl: string | null;
  eventDate: string | null;
  startTime: string | null;
  endTime: string | null;
  eventType: string | null;
  venueName: string | null;
  venueAddress: string | null;
}) {
  const g = groupRider(items);
  const when = fmtDate(eventDate);
  const isUpload = mode === 'upload' && !!pdfUrl;

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
        {riderName && (
          <div style={{ textAlign: 'center', color: 'var(--neon,#00e0a4)', fontSize: '.82rem', fontWeight: 600, marginBottom: '.3rem' }}>
            {riderName}
          </div>
        )}
        {(eventType || when || venueName) && (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.55)', fontSize: '.85rem', marginBottom: '1.6rem', lineHeight: 1.6 }}>
            {eventType && <div style={{ color: 'rgba(255,255,255,.85)', fontWeight: 600 }}>{eventType}</div>}
            {[when, [fmtTime(startTime), fmtTime(endTime)].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}
            {venueName && <div>{venueName}{venueAddress ? ` — ${venueAddress}` : ''}</div>}
          </div>
        )}

        {isUpload ? (
          <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '1rem' }}>
            <object data={pdfUrl!} type="application/pdf" width="100%" height="720" style={{ borderRadius: 10, border: 'none' }}>
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'rgba(255,255,255,.75)' }}>
                Your browser can&rsquo;t display the PDF inline.
              </div>
            </object>
            <div style={{ textAlign: 'center', marginTop: '1.2rem' }}>
              <a
                href={pdfUrl!}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-block', background: 'var(--neon,#00e0a4)', color: '#06231b', borderRadius: 8, padding: '.7rem 1.4rem', fontWeight: 700, fontSize: '.9rem', textDecoration: 'none' }}
              >
                Open / Download PDF
              </a>
            </div>
          </div>
        ) : (
          <>
            <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '1.5rem' }}>
              {RIDER_SECTIONS.map(({ key, label }) => {
                const rows = g[key];
                if (!rows.length) return null;
                return (
                  <div key={key} style={{ marginBottom: '1.3rem' }}>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--neon,#00e0a4)', marginBottom: '.6rem' }}>
                      {label}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                      {rows.map((it) => {
                        const lab = (it.label || '').trim();
                        const val = (it.value || '').trim();
                        return (
                          <div key={it.id} style={{ display: 'flex', gap: '.7rem', fontSize: '.95rem', lineHeight: 1.5, alignItems: 'baseline' }}>
                            {lab && <div style={{ minWidth: 150, maxWidth: 150, color: 'rgba(255,255,255,.55)', fontWeight: 600 }}>{lab}</div>}
                            <div style={{ flex: 1, color: 'rgba(255,255,255,.92)' }}>{val || (lab ? '' : '—')}</div>
                          </div>
                        );
                      })}
                    </div>
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
          </>
        )}

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,.4)', fontSize: '.72rem', marginTop: '1.2rem' }}>
          Sent via Global DJ Connect
        </p>
      </div>
    </div>
  );
}
