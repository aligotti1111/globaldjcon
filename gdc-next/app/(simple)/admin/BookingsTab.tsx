'use client';

// Admin → Bookings. See ALL bookings across every DJ, search by DJ or host
// (name/email), expand one to view its pipeline + details, and edit its fields
// (price/tax excluded). Admin edits apply immediately and NEVER email the host —
// the edit modal is launched with admin mode, which posts { admin:true } to
// /api/bookings/edit.
//
// THE PIPELINE IS THE DJ'S OWN. This renders the exact same "Booking progress"
// bar the DJ sees on their Upcoming Bookings card — PipelineHero fed by
// buildBookingSteps — not the lighter host-facing one. buildBookingSteps carries
// action handlers (send contract, request deposit, …) that can't cross a
// server→client boundary, so the server action hands back raw booking data and
// the steps are built HERE, with no-op handlers, and rendered read-only
// (every action locked, no override toggles).

import { useEffect, useRef, useState, useCallback } from 'react';
import PipelineHero from '@/app/(main)/upcoming-bookings/pipeline/PipelineHero';
import { buildBookingSteps } from '@/app/(main)/upcoming-bookings/pipeline/buildSteps';
import type { UpcomingBooking, BookingPayment } from '@/app/(main)/upcoming-bookings/page';
import BookingEditModal, { type EditSection } from '@/app/(main)/upcoming-bookings/BookingEditModal';
import { searchAdminBookings, getAdminBookingDetail, updateWeddingExtras, type AdminBookingRow, type AdminBookingDetail, type WeddingExtrasInput } from './admin-bookings';

const NEON = '#00e0a4';

// ── Pipeline column order (copied from BookingRow — the server-side whitelist
//    keys, not the headings). Club puts the Rider before Deposit; mobile keeps
//    Planner & Playlist in place and has no guest-list column.
const pipeSlotsFor = (djType: 'club' | 'mobile'): readonly string[] =>
  djType === 'club'
    ? ['contract', 'song_list', 'deposit', 'invoice', 'guestlist']
    : ['contract', 'deposit', 'song_list', 'invoice'];

// Tax-inclusive booking value — the same computation BookingRow passes into the
// builder, copied verbatim so the admin pipeline's Value can't drift from the
// DJ's. Reads the booking's OWN frozen tax snapshot, never live settings.
function bookingTotalWithTax(booking: UpcomingBooking, liveTaxPct: number): number | null {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const agreed = booking.counter_rate ?? booking.quoted_rate ?? booking.offer_amount ?? null;
  if (agreed == null) return null;
  const snapTaxPct = booking.tax_pct != null ? Number(booking.tax_pct) : null;
  const snapTaxAmount = booking.tax_amount != null ? Number(booking.tax_amount) : null;
  const snapTotal = booking.total_with_tax != null ? Number(booking.total_with_tax) : null;
  const snapBase = (snapTaxAmount != null && snapTotal != null) ? round2(snapTotal - snapTaxAmount) : null;
  const snapshotFresh = snapBase != null && Math.abs(Number(agreed) - snapBase) < 0.005;
  if (snapshotFresh) return snapTotal;
  const effTaxPct = snapTaxPct ?? liveTaxPct;
  if (!(effTaxPct > 0)) return round2(Number(agreed));
  const tax = snapTaxPct != null ? round2((Number(agreed) * effTaxPct) / 100) : Math.round((Number(agreed) * effTaxPct) / 100);
  return round2(Number(agreed) + tax);
}

const noop = () => {};

function fmtMoney(n: number | null | undefined, currency: string): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(Number(n)); }
  catch { return `${currency || 'USD'} ${Number(n).toFixed(2)}`; }
}

// Read-only price / tax / deposit summary for the admin detail. All values come
// from the booking's own frozen snapshot — never editable here.
function PricingReadout({ detail }: { detail: AdminBookingDetail }) {
  const b = detail.rawBooking as unknown as UpcomingBooking;
  const currency = b.currency || 'USD';
  const taxPct = b.tax_pct != null ? Number(b.tax_pct) : (detail.flags.taxPct || 0);
  const totalSnap = b.total_with_tax != null ? Number(b.total_with_tax) : null;
  // Rate: the agreed price. If no rate column was stored (e.g. seeded/demo rows
  // that carry only total + tax), derive it from the total snapshot minus tax.
  const agreed = b.counter_rate ?? b.quoted_rate ?? b.offer_amount ?? null;
  const taxAmt = b.tax_amount != null ? Number(b.tax_amount)
    : (agreed != null && taxPct > 0 ? Math.round(Number(agreed) * taxPct) / 100 : null);
  const rate = agreed ?? (totalSnap != null ? Math.round((totalSnap - (taxAmt ?? 0)) * 100) / 100 : null);
  // Total: computed from the agreed rate, else the stored snapshot.
  const total = bookingTotalWithTax(b, detail.flags.taxPct) ?? totalSnap;
  const depAmt = b.deposit_amount != null ? Number(b.deposit_amount)
    : (b.deposit_pct != null && rate != null ? Math.round((rate * Number(b.deposit_pct)) ) / 100 : null);
  const depLabel = b.deposit_amount != null
    ? fmtMoney(Number(b.deposit_amount), currency)
    : b.deposit_pct != null
      ? `${Number(b.deposit_pct)}%${rate != null ? ` · ${fmtMoney(depAmt, currency)}` : ''}`
      : '—';

  const line: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '.84rem' };
  const lbl: React.CSSProperties = { color: '#9a9ab0' };
  const val: React.CSSProperties = { color: '#fff', fontWeight: 600 };
  return (
    <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
      <div style={{ fontSize: '.68rem', letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a9ab0', marginBottom: 4 }}>Pricing (locked)</div>
      <div style={line}><span style={lbl}>Rate</span><span style={val}>{fmtMoney(rate, currency)}</span></div>
      <div style={line}><span style={lbl}>Tax{taxPct > 0 ? ` (${taxPct}%)` : ''}</span><span style={val}>{taxPct > 0 ? fmtMoney(taxAmt, currency) : '—'}</span></div>
      <div style={{ ...line, borderTop: '1px solid rgba(255,255,255,.08)' }}><span style={lbl}>Total</span><span style={val}>{fmtMoney(total, currency)}</span></div>
      <div style={line}><span style={lbl}>Deposit</span><span style={val}>{depLabel}</span></div>
    </div>
  );
}

// Admin-only ceremony & cocktail editor for weddings. Saves the ceremony/
// cocktail fields; does NOT change the locked total. Host is not emailed.
function WeddingExtrasEditor({ detail, onSaved }: { detail: AdminBookingDetail; onSaved: () => void }) {
  const b = detail.rawBooking as Record<string, unknown>;
  const bool = (k: string) => b[k] === true;
  const str = (k: string) => (b[k] == null ? '' : String(b[k]));
  const num = (k: string) => (b[k] == null ? '' : String(b[k]));

  const [cerNeeded, setCerNeeded] = useState(bool('ceremony_needed'));
  const [cerTime, setCerTime] = useState(str('ceremony_start_time').slice(0, 5));
  const [cerRoom, setCerRoom] = useState(bool('ceremony_same_room'));
  const [cerPrice, setCerPrice] = useState(num('ceremony_price'));
  const [cerIncl, setCerIncl] = useState(bool('ceremony_included'));
  const [cokNeeded, setCokNeeded] = useState(bool('cocktail_needed'));
  const [cokTime, setCokTime] = useState(str('cocktail_start_time').slice(0, 5));
  const [cokRoom, setCokRoom] = useState(bool('cocktail_same_room'));
  const [cokPrice, setCokPrice] = useState(num('cocktail_price'));
  const [cokIncl, setCokIncl] = useState(bool('cocktail_included'));

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true); setMsg(null);
    const payload: WeddingExtrasInput = {
      ceremony_needed: cerNeeded,
      ceremony_start_time: cerNeeded ? (cerTime || null) : null,
      ceremony_same_room: cerRoom,
      ceremony_price: cerNeeded && cerPrice !== '' ? Number(cerPrice) : null,
      ceremony_included: cerIncl,
      cocktail_needed: cokNeeded,
      cocktail_start_time: cokNeeded ? (cokTime || null) : null,
      cocktail_same_room: cokRoom,
      cocktail_price: cokNeeded && cokPrice !== '' ? Number(cokPrice) : null,
      cocktail_included: cokIncl,
    };
    try {
      const res = await updateWeddingExtras(detail.id, payload);
      if (!res.ok) { setMsg(res.error || 'Could not save.'); return; }
      setMsg('Saved.');
      onSaved();
    } catch { setMsg('Could not save.'); }
    finally { setBusy(false); }
  }

  const fieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 };
  const smallLabel: React.CSSProperties = { fontSize: '.72rem', color: '#9a9ab0' };
  const checkRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, fontSize: '.84rem', color: '#fff', marginBottom: 8, cursor: 'pointer' };
  const sm: React.CSSProperties = { ...input, padding: '8px 10px', fontSize: '.86rem' };
  const half: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };

  const block = (
    title: string,
    needed: boolean, setNeeded: (v: boolean) => void,
    time: string, setTime: (v: string) => void,
    room: boolean, setRoom: (v: boolean) => void,
    price: string, setPrice: (v: string) => void,
    incl: boolean, setIncl: (v: boolean) => void,
  ) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 700, fontSize: '.86rem', marginBottom: 6 }}>{title}</div>
      <label style={checkRow}><input type="checkbox" checked={needed} onChange={(e) => setNeeded(e.target.checked)} /> Needed</label>
      {needed && (
        <>
          <div style={half}>
            <div style={fieldWrap}>
              <span style={smallLabel}>Start time</span>
              <input type="time" style={sm} value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div style={fieldWrap}>
              <span style={smallLabel}>Price (add-on)</span>
              <input type="number" min="0" step="0.01" style={sm} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <label style={checkRow}><input type="checkbox" checked={room} onChange={(e) => setRoom(e.target.checked)} /> Same room as reception</label>
          <label style={checkRow}><input type="checkbox" checked={incl} onChange={(e) => setIncl(e.target.checked)} /> Included in package</label>
        </>
      )}
    </div>
  );

  return (
    <div style={{ background: 'rgba(245,230,66,.04)', border: '1px solid rgba(245,230,66,.25)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ fontSize: '.68rem', letterSpacing: '.08em', textTransform: 'uppercase', color: '#f5e642', marginBottom: 8 }}>Ceremony &amp; Cocktail Hour (wedding)</div>
      {block('Ceremony', cerNeeded, setCerNeeded, cerTime, setCerTime, cerRoom, setCerRoom, cerPrice, setCerPrice, cerIncl, setCerIncl)}
      {block('Cocktail Hour', cokNeeded, setCokNeeded, cokTime, setCokTime, cokRoom, setCokRoom, cokPrice, setCokPrice, cokIncl, setCokIncl)}
      <div style={{ fontSize: '.7rem', color: '#9a9ab0', margin: '2px 0 8px' }}>Prices are stored for reference — the booking total stays locked. Host is not emailed.</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" style={{ ...pencilBtn, background: '#00e0a4', color: '#06231b', border: 'none', opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save ceremony & cocktail'}
        </button>
        {msg && <span style={{ fontSize: '.78rem', color: msg === 'Saved.' ? '#00e0a4' : '#ff6b6b' }}>{msg}</span>}
      </div>
    </div>
  );
}

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

// Build the DJ's real pipeline steps from the raw server data. No-op handlers:
// the admin view is read-only, so nothing here ever fires (actions are also
// locked at the PipelineHero level).
function buildAdminSteps(detail: AdminBookingDetail) {
  const b = detail.rawBooking as unknown as UpcomingBooking & { __riderSent?: boolean; status_overrides?: Record<string, boolean> | null };
  const { canPro, riderEnabled, guestlistEnabled, needsContract, taxPct } = detail.flags;
  const payments = detail.payments as BookingPayment[];

  const isCancelled = b.status === 'cancelled' || (b as { cancel_status?: string | null }).cancel_status === 'accepted';
  // Past the event date → read-only archive, same as the DJ's Past Bookings.
  const todayStr = new Date().toISOString().slice(0, 10);
  const archive = isCancelled || (!!b.event_date && String(b.event_date).slice(0, 10) < todayStr);

  const overrides = (b.status_overrides as Record<string, boolean> | null) || {};
  const depositRow = payments.find((p) => p.kind === 'deposit') || null;
  const cstatus = (b.contract_status as string | null | undefined) || null;
  const everHadContract = !!cstatus;
  const contractStepComplete = cstatus === 'signed' || !!overrides.contract;
  const hasHostContact =
    !!String((b as { host_email?: string | null }).host_email || '').trim() &&
    !!String((b as { requester_name?: string | null }).requester_name || '').trim();
  const canRequestDeposit = b.is_manual ? hasHostContact : (!needsContract || contractStepComplete);

  const { steps } = buildBookingSteps({
    booking: b,
    taxPct,
    archive,
    payments,
    canPro,
    planner: detail.planner || undefined,
    riderEnabled,
    guestlistEnabled,
    onAddHost: undefined,
    onEdit: undefined,
    overrides,
    signedOverride: false,
    isCancelled,
    depositRow,
    cstatus,
    needsContract,
    hasHostContact,
    canRequestDeposit,
    everHadContract,
    runContract: noop,
    openRequest: noop,
    cancelRequest: noop,
    markBalancePaid: noop,
    sendReceipt: noop,
    downloadReceipt: noop,
    toggleStep: noop,
    setMethodsOpen: noop,
    plannerBusy: false,
    plannerErr: null,
    setPlannerErr: noop,
    setSendOpen: noop,
    setRiderChooserOpen: noop,
    savedRiders: [],
    riderSent: !!b.__riderSent,
    requestPlanner: noop,
    resendRider: noop,
    sendNamedRider: noop,
    bookingTotalWithTax,
  });
  return steps;
}

export default function BookingsTab() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<AdminBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminBookingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editSection, setEditSection] = useState<EditSection | null>(null);

  // Sort/filter: DJ type first, then a secondary filter that depends on it —
  // event type for mobile, club/bar for club accounts. Applied client-side to
  // the already-fetched list (capped at 150), so no extra round-trips.
  const [djTypeFilter, setDjTypeFilter] = useState<'all' | 'mobile' | 'club'>('all');
  const [subFilter, setSubFilter] = useState<string>('all');
  // When — upcoming (event date today or later) vs past.
  const [whenFilter, setWhenFilter] = useState<'all' | 'upcoming' | 'past'>('all');

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

  // Signed-contract download — admins can grab any booking's signed PDF. Hits
  // the same /api/contracts/signed-doc route the DJ uses (now admin-allowed),
  // then opens the returned document URL.
  const [contractBusy, setContractBusy] = useState(false);
  const [contractErr, setContractErr] = useState<string | null>(null);
  async function downloadContract(bookingId: string) {
    setContractBusy(true); setContractErr(null);
    try {
      const res = await fetch('/api/contracts/signed-doc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.contract) { setContractErr(data.error || 'Could not get the signed contract.'); return; }
      window.open(data.contract as string, '_blank', 'noopener,noreferrer');
    } catch {
      setContractErr('Could not get the signed contract.');
    } finally { setContractBusy(false); }
  }

  function toggle(id: string) {
    setEditSection(null); // never carry an open edit modal across bookings
    setContractErr(null);
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id); setDetail(null); void loadDetail(id);
  }

  const contractState = (s: string | null): 'none' | 'sent' | 'signed' =>
    s === 'signed' ? 'signed' : s === 'sent' || s === 'viewed' ? 'sent' : 'none';

  // Secondary-filter options, derived from the rows that match the chosen DJ
  // type. Mobile → distinct event types present; Club → the venue types present
  // (bar/club/other). Empty when "all" DJ types is selected (no sub-filter then).
  const subOptions: { value: string; label: string }[] = (() => {
    if (djTypeFilter === 'mobile') {
      const types = Array.from(new Set(rows.filter((r) => r.bookingType === 'mobile' && r.eventType).map((r) => r.eventType as string))).sort();
      return types.map((t) => ({ value: t, label: t }));
    }
    if (djTypeFilter === 'club') {
      // Only three buckets: Club, Bar, and a single "Other" that absorbs every
      // custom venue type (festival, private, …). The distinct raw values are
      // normalized before dedupe so "Other - festival" / "Other - private" don't
      // each become their own option.
      const norm = (v: string) => { const l = v.toLowerCase(); return l === 'club' ? 'club' : l === 'bar' ? 'bar' : 'other'; };
      const cats = Array.from(new Set(rows.filter((r) => r.bookingType === 'club' && r.venueType).map((r) => norm(r.venueType as string))));
      const order = ['club', 'bar', 'other'];
      return cats.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));
    }
    return [];
  })();

  // When the results are all for ONE DJ account (a DJ search), the DJ-type sort
  // is meaningless — a DJ account is a single type — so it's hidden and ignored.
  const distinctDjEmails = new Set(rows.map((r) => r.djEmail).filter((e) => e && e !== '—'));
  const singleDj = rows.length > 0 && distinctDjEmails.size === 1;

  const todayStr = new Date().toISOString().slice(0, 10);
  const shown = rows.filter((r) => {
    if (whenFilter !== 'all') {
      const d = (r.eventDate || '').slice(0, 10);
      if (whenFilter === 'upcoming' && !(d && d >= todayStr)) return false;
      if (whenFilter === 'past' && !(d && d < todayStr)) return false;
    }
    // Skip DJ-type / sub filtering entirely for a single-DJ result set.
    if (singleDj) return true;
    if (djTypeFilter !== 'all' && r.bookingType !== djTypeFilter) return false;
    if (djTypeFilter === 'mobile' && subFilter !== 'all' && r.eventType !== subFilter) return false;
    if (djTypeFilter === 'club' && subFilter !== 'all') {
      const vt = (r.venueType || '').toLowerCase();
      const cat = vt === 'club' ? 'club' : vt === 'bar' ? 'bar' : 'other';
      if (cat !== subFilter) return false;
    }
    return true;
  });

  const selectStyle: React.CSSProperties = { ...input, width: 'auto', minWidth: 150, padding: '9px 12px', cursor: 'pointer' };

  return (
    <div style={{ maxWidth: 820 }}>
      <h2 style={{ fontSize: '1.1rem', margin: '0 0 4px' }}>All Bookings</h2>
      <p style={{ color: '#9a9ab0', fontSize: '.82rem', margin: '0 0 12px' }}>
        Search by DJ or host — name or email. Editing a field applies immediately and the host is <b>not</b> emailed. Price and tax can’t be changed here.
      </p>

      <input
        style={{ ...input, marginBottom: 10 }}
        placeholder="Search DJ name/email or host name/email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* Sort/filter — DJ type, then a type-specific secondary filter. */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <label style={{ fontSize: '.72rem', letterSpacing: '.06em', textTransform: 'uppercase', color: '#9a9ab0' }}>Sort</label>
        <select style={selectStyle} value={whenFilter} onChange={(e) => setWhenFilter(e.target.value as 'all' | 'upcoming' | 'past')}>
          <option value="all">All dates</option>
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
        </select>
        {!singleDj && (
          <select
            style={selectStyle}
            value={djTypeFilter}
            onChange={(e) => { setDjTypeFilter(e.target.value as 'all' | 'mobile' | 'club'); setSubFilter('all'); }}
          >
            <option value="all">All DJ types</option>
            <option value="mobile">Mobile</option>
            <option value="club">Club / Bar</option>
          </select>
        )}

        {!singleDj && djTypeFilter === 'mobile' && (
          <select style={selectStyle} value={subFilter} onChange={(e) => setSubFilter(e.target.value)}>
            <option value="all">All event types</option>
            {subOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        {djTypeFilter === 'club' && (
          <select style={selectStyle} value={subFilter} onChange={(e) => setSubFilter(e.target.value)}>
            <option value="all">Club &amp; Bar</option>
            {subOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>

      {err && <div style={{ color: '#ff6b6b', fontSize: '.85rem', marginBottom: 10 }}>{err}</div>}
      {loading && <div style={{ color: '#9a9ab0', fontSize: '.85rem' }}>Loading…</div>}
      {!loading && shown.length === 0 && <div style={{ color: '#9a9ab0', fontSize: '.85rem' }}>No bookings found.</div>}

      {shown.map((r) => {
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {r.isManual && (
                  <span style={{ fontSize: '.6rem', letterSpacing: '.07em', textTransform: 'uppercase', fontWeight: 800, color: '#f5e642', border: '1px solid rgba(245,230,66,.5)', borderRadius: 5, padding: '.14rem .4rem' }}>
                    Manual
                  </span>
                )}
                <span style={{ color: NEON, fontSize: '1.1rem', lineHeight: 1 }}>{open ? '▾' : '▸'}</span>
              </div>
            </button>

            {open && (
              <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 12 }}>
                {detailLoading && <div style={{ color: '#9a9ab0', fontSize: '.85rem' }}>Loading booking…</div>}
                {!detailLoading && detail && detail.id === r.id && (
                  <>
                    {/* The DJ's real pipeline, read-only (all actions locked). */}
                    <div style={{ marginBottom: 14 }}>
                      <PipelineHero
                        steps={buildAdminSteps(detail)}
                        slots={pipeSlotsFor(detail.djType)}
                        djType={detail.djType}
                        openedLabel={() => null}
                        actionLocked={() => true}
                        overrideLockedFor={() => true}
                        onToggleOverride={noop}
                      />
                    </div>

                    {/* Signed contract — admin download. */}
                    {detail.contractStatus === 'signed' && (
                      <div style={{ marginBottom: 12 }}>
                        <button
                          type="button"
                          style={{ ...pencilBtn, opacity: contractBusy ? 0.6 : 1 }}
                          disabled={contractBusy}
                          onClick={() => downloadContract(r.id)}
                        >
                          {contractBusy ? 'Preparing…' : '⬇ Download signed contract'}
                        </button>
                        {contractErr && <div style={{ color: '#ff6b6b', fontSize: '.78rem', marginTop: 6 }}>{contractErr}</div>}
                      </div>
                    )}

                    {/* Price / tax / deposit — read-only. */}
                    <PricingReadout detail={detail} />

                    {/* Ceremony & cocktail — admin editor, weddings only. */}
                    {detail.djType === 'mobile' && /wedding/i.test(detail.eventType || '') && (
                      <WeddingExtrasEditor detail={detail} onSaved={() => { void loadDetail(r.id); void runSearch(query); }} />
                    )}

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
                      Price, tax and deposit are shown for reference only and can’t be changed here. Admin edits apply immediately; the host is not emailed.
                    </div>

                    {editSection && (
                      <BookingEditModal
                        section={editSection}
                        djType={detail.djType}
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
