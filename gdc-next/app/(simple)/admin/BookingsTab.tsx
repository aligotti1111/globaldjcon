'use client';

// Admin → Bookings. See ALL bookings across every DJ, search by DJ or host
// (name/email), expand one to view its read-only pipeline + details, and edit
// its fields (price/tax excluded). Admin edits apply immediately and NEVER email
// the host — the edit modal is launched with admin mode, which posts
// { admin:true } to /api/bookings/edit.

import { useEffect, useRef, useState, useCallback } from 'react';
import HostPipelineHero from '@/app/(main)/upcoming-events/HostPipelineHero';
import BookingEditModal, { type EditSection } from '@/app/(main)/upcoming-bookings/BookingEditModal';
import { searchAdminBookings, getAdminBookingDetail, type AdminBookingRow, type AdminBookingDetail } from './admin-bookings';

const NEON = '#00e0a4';

function fmtDate(d: string | null): string {
  if (!d) return '—';
  try { return new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return String(d); }
}
function fmtTime(t: string | null): string {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return String(t);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

const card: React.CSSProperties = { background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: 14, marginBottom: 10 };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#0c0c11', border: '1px solid rgba(255,255,255,.18)', borderRadius: 8, padding: '11px 12px', color: '#fff', fontSize: '.95rem' };
const chip: React.CSSProperties = { fontSize: '.62rem', letterSpacing: '.06em', textTransform: 'uppercase', color: '#9a9ab0', background: 'rgba(255,255,255,.06)', borderRadius: 5, padding: '.14rem .4rem' };
const pencilBtn: React.CSSProperties = { background: 'transparent', border: '1px solid rgba(255,255,255,.2)', color: NEON, borderRadius: 7, padding: '5px 10px', fontSize: '.74rem', fontWeight: 700, cursor: 'pointer' };

const SECTIONS: { key: EditSection; label: string }[] = [
  { key: 'EVENT', label: 'Event' },
  { key: 'VENUE', label: 'Venue' },
  { key: 'HOST', label: 'Host' },
  { key: 'PACKAGE', label: 'Package' },
];

export default function BookingsTab() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<AdminBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminBookingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editSection, setEditSection] = useState<EditSection | null>(null);

  const seq = useRef(0);
  const runSearch = useCallback(async (q: string) => {
    const mine = ++seq.current;
    setLoading(true); setErr(null);
    try {
      const res = await searchAdminBookings(q);
      if (mine === seq.current) setRows(res); // drop out-of-order responses
    } catch (e) {
      if (mine === seq.current) setErr(e instanceof Error ? e.message : 'Search failed');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // Debounced search — also runs on mount (query starts '') for the initial list.
  useEffect(() => {
    const t = setTimeout(() => { void runSearch(query); }, 350);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try { setDetail(await getAdminBookingDetail(id)); }
    catch { setDetail(null); }
    finally { setDetailLoading(false); }
  }, []);

  function toggle(id: string) {
    setEditSection(null); // never carry an open edit modal across bookings
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id); setDetail(null); void loadDetail(id);
  }

  const contractState = (s: string | null): 'none' | 'sent' | 'signed' =>
    s === 'signed' ? 'signed' : s === 'sent' || s === 'viewed' ? 'sent' : 'none';

  return (
    <div style={{ maxWidth: 820 }}>
      <h2 style={{ fontSize: '1.1rem', margin: '0 0 4px' }}>All Bookings</h2>
      <p style={{ color: '#9a9ab0', fontSize: '.82rem', margin: '0 0 12px' }}>
        Search by DJ or host — name or email. Editing a field applies immediately and the host is <b>not</b> emailed. Price and tax can’t be changed here.
      </p>

      <input
        style={{ ...input, marginBottom: 14 }}
        placeholder="Search DJ name/email or host name/email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {err && <div style={{ color: '#ff6b6b', fontSize: '.85rem', marginBottom: 10 }}>{err}</div>}
      {loading && <div style={{ color: '#9a9ab0', fontSize: '.85rem' }}>Loading…</div>}
      {!loading && rows.length === 0 && <div style={{ color: '#9a9ab0', fontSize: '.85rem' }}>No bookings found.</div>}

      {rows.map((r) => {
        const open = openId === r.id;
        return (
          <div key={r.id} style={card}>
            <button
              type="button"
              onClick={() => toggle(r.id)}
              style={{ display: 'flex', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', gap: 12, alignItems: 'flex-start', padding: 0 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700 }}>{fmtDate(r.eventDate)}</span>
                  {r.startTime && <span style={{ color: '#c9c9d6', fontSize: '.85rem' }}>{fmtTime(r.startTime)}{r.endTime ? ` – ${fmtTime(r.endTime)}` : ''}</span>}
                  {r.eventType && <span style={chip}>{r.eventType}</span>}
                  {r.bookingType && <span style={chip}>{r.bookingType}</span>}
                  {r.status && <span style={chip}>{r.status}</span>}
                </div>
                <div style={{ fontSize: '.82rem', color: '#c9c9d6' }}>
                  DJ: <b style={{ color: '#fff' }}>{r.djName}</b> · {r.djEmail}
                </div>
                <div style={{ fontSize: '.82rem', color: '#c9c9d6' }}>
                  Host: <b style={{ color: '#fff' }}>{r.hostName}</b> · {r.hostEmail}
                </div>
                {r.venueName && <div style={{ fontSize: '.8rem', color: '#9a9ab0' }}>{r.venueName}</div>}
              </div>
              <span style={{ color: NEON, fontSize: '1.1rem', lineHeight: 1 }}>{open ? '▾' : '▸'}</span>
            </button>

            {open && (
              <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 12 }}>
                {detailLoading && <div style={{ color: '#9a9ab0', fontSize: '.85rem' }}>Loading booking…</div>}
                {!detailLoading && detail && detail.id === r.id && (
                  <>
                    {/* Read-only pipeline */}
                    <div style={{ marginBottom: 14 }}>
                      <HostPipelineHero steps={detail.pipeline} djType={detail.pipelineDjType} />
                    </div>

                    {/* Editable sections */}
                    {SECTIONS.map((s) => (
                      <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                        <div style={{ fontSize: '.84rem', color: '#c9c9d6' }}>
                          <span style={{ fontWeight: 700, color: '#fff' }}>{s.label}</span>
                          <span style={{ color: '#9a9ab0' }}>{' — '}{sectionSummary(s.key, detail)}</span>
                        </div>
                        <button type="button" style={pencilBtn} onClick={() => setEditSection(s.key)}>✎ Edit</button>
                      </div>
                    ))}

                    <div style={{ fontSize: '.72rem', color: '#9a9ab0', marginTop: 10, lineHeight: 1.5 }}>
                      Pricing (rate & tax) is locked and not editable here. Admin edits apply immediately; the host is not emailed.
                    </div>

                    {editSection && (
                      <BookingEditModal
                        section={editSection}
                        djType={detail.pipelineDjType}
                        contractState={contractState(detail.contractStatus)}
                        values={detail.editValues}
                        lockEmail={detail.hasHostAccount}
                        noHostRecipient={false}
                        admin
                        onClose={() => setEditSection(null)}
                        onSaved={() => { setEditSection(null); void loadDetail(r.id); void runSearch(query); }}
                      />
                    )}
                  </>
                )}
                {!detailLoading && (!detail || detail.id !== r.id) && (
                  <div style={{ color: '#ff6b6b', fontSize: '.85rem' }}>Could not load this booking.</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function sectionSummary(key: EditSection, d: AdminBookingDetail): string {
  const v = d.editValues;
  if (key === 'EVENT') return [d.eventType, d.eventDate ? fmtDate(d.eventDate) : null].filter(Boolean).join(' · ') || '—';
  if (key === 'VENUE') return d.venueName || d.venueType || v.venue_address || '—';
  if (key === 'HOST') return [d.hostName, d.hostEmail].filter((x) => x && x !== '—').join(' · ') || '—';
  if (key === 'PACKAGE') return d.packageTitle || '—';
  return '—';
}
