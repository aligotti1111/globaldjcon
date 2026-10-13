'use client';

// EditReceiptModal — Phase 2. The DJ edits exactly what the RECEIPT shows for a
// PAID deposit or balance: amounts, the lines' labels, the event details and the
// client name/email. Everything is printed VERBATIM on the receipt (no
// recalculation — editing the total does NOT move the deposit % or the balance),
// stored as a per-kind snapshot on the booking (receipt_overrides), and the
// booking record itself is never touched. Saving re-sends the receipt to the host.
//
// Fields prefill from the last saved edit if there is one, otherwise from the
// receipt's current derived values — so the DJ is correcting a filled-in form,
// not starting from blank.

import { useState } from 'react';
import type { UpcomingBooking, BookingPayment } from './page';
import { currencySymbol } from '@/lib/constants';
import { NEON } from './shared';

interface Props {
  kind: 'deposit' | 'balance';
  booking: UpcomingBooking;
  payments: BookingPayment[];
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Light client-side formatting for the prefilled defaults. These only seed the
// inputs; whatever the DJ leaves or types is what prints.
function prettyType(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}
function fmtTime(t: string | null | undefined): string {
  if (!t) return '';
  if (/[ap]m/i.test(t)) return String(t).trim();
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(t);
  let hr = parseInt(m[1], 10);
  const ap = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  return `${hr}:${m[2]} ${ap}`;
}
function friendlyDate(d: string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(`${d}T12:00:00`);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export default function EditReceiptModal({ kind, booking, payments, currency, onClose, onSaved }: Props) {
  // ── Derived defaults (mirror the receipt builder's own derivation) ──
  const agreed = Number(
    booking.total_with_tax ?? booking.counter_rate ?? booking.quoted_rate ?? booking.offer_amount ?? 0,
  );
  const paidSoFar = payments.reduce((s, p) => s + Number(p.amount_paid || 0), 0);
  const defReceived = kind === 'deposit'
    ? (booking.deposit_amount != null ? Number(booking.deposit_amount) : round2(agreed))
    : round2(Math.max(0, agreed - paidSoFar));
  const defPaidToDate = kind === 'deposit'
    ? round2(paidSoFar > 0 ? paidSoFar : defReceived)
    : round2(agreed);
  const defTotal = round2(agreed);
  const depPct = defTotal > 0 ? Math.round((defReceived / defTotal) * 100) : 0;
  const defReceivedLabel = kind === 'deposit' ? `Deposit Received (${depPct}%)` : 'Balance Received';
  const remaining = round2(Math.max(0, defTotal - defPaidToDate));
  const paidInFull = remaining <= 0.005;
  const defHeadlineLabel = paidInFull ? 'Paid in Full' : 'Balance Remaining';
  const defHeadlineAmount = paidInFull ? '' : String(remaining);

  // ── Prefill from a saved edit when present, else the derived defaults ──
  const saved = (booking.receipt_overrides && booking.receipt_overrides[kind]) || {};
  const sv = (k: string, fallback: string): string => {
    const v = (saved as Record<string, unknown>)[k];
    if (v === undefined) return fallback;
    if (v === null) return '';
    return String(v);
  };

  const [received, setReceived] = useState(sv('received', String(defReceived)));
  const [receivedLabel, setReceivedLabel] = useState(sv('receivedLabel', defReceivedLabel));
  const [total, setTotal] = useState(sv('total', String(defTotal)));
  const [paidToDate, setPaidToDate] = useState(sv('paidToDate', String(defPaidToDate)));
  const [headlineLabel, setHeadlineLabel] = useState(sv('headlineLabel', defHeadlineLabel));
  const [headlineAmount, setHeadlineAmount] = useState(sv('headlineAmount', defHeadlineAmount));
  const [eventType, setEventType] = useState(sv('eventType', prettyType(booking.event_type)));
  const [packageTitle, setPackageTitle] = useState(sv('packageTitle', booking.package_title || ''));
  const [includes, setIncludes] = useState(sv('includes', ''));
  const [eventDate, setEventDate] = useState(sv('eventDate', friendlyDate(booking.event_date)));
  const [eventTime, setEventTime] = useState(sv('eventTime',
    [fmtTime(booking.start_time), fmtTime(booking.end_time)].filter(Boolean).join(' – ')));
  const [venue, setVenue] = useState(sv('venue', booking.venue_name || ''));
  const [clientName, setClientName] = useState(sv('clientName', booking.requester_name || ''));
  const [clientEmail, setClientEmail] = useState(sv('clientEmail', booking.host_email || ''));

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    // Numbers go as numbers; blanks on the amount lines fall back to the derived
    // value server-side (undefined), EXCEPT the headline amount, where blank is a
    // deliberate "show the label with no figure" (null). `includes` blank is omit.
    const numOrUndef = (s: string): number | undefined => {
      const t = s.trim();
      if (t === '') return undefined;
      const n = Number(t);
      return Number.isFinite(n) ? round2(n) : undefined;
    };
    const overrides: Record<string, unknown> = {
      received: numOrUndef(received),
      receivedLabel: receivedLabel,
      total: numOrUndef(total),
      paidToDate: numOrUndef(paidToDate),
      headlineLabel: headlineLabel,
      headlineAmount: headlineAmount.trim() === '' ? null : numOrUndef(headlineAmount),
      eventType, packageTitle,
      includes: includes.trim() === '' ? undefined : includes,
      eventDate, eventTime, venue, clientName, clientEmail,
    };
    try {
      const res = await fetch('/api/payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit-receipt', bookingId: booking.id, kind, overrides }),
      });
      const raw = await res.text();
      if (!res.ok) { setErr(raw.slice(0, 180) || 'Could not save the receipt.'); setBusy(false); return; }
      onSaved();
      onClose();
    } catch {
      setErr('Could not save the receipt.');
      setBusy(false);
    }
  }

  const sym = currencySymbol(currency);
  const labelCss: React.CSSProperties = {
    display: 'block', fontFamily: "'Space Mono', monospace", fontSize: '.58rem',
    letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted,#8a8aa0)', margin: '0 0 .3rem',
  };
  const inputCss: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: 'var(--deep,#0b0b12)',
    border: '1px solid rgba(255,255,255,.14)', borderRadius: 6, color: 'var(--white,#fff)',
    padding: '.5rem .6rem', fontSize: '.85rem',
  };
  const sectionCss: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace", fontSize: '.62rem', letterSpacing: '.1em',
    textTransform: 'uppercase', color: NEON, margin: '1rem 0 .55rem',
  };
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ marginBottom: '.6rem' }}>
      <label style={labelCss}>{label}</label>
      {children}
    </div>
  );
  const money = (v: string, set: (s: string) => void) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
      <span style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.9rem' }}>{sym}</span>
      <input type="number" min="0" step="0.01" value={v} onWheel={(e) => e.currentTarget.blur()}
        onChange={(e) => { set(e.target.value); setErr(null); }} style={inputCss} />
    </div>
  );
  const text = (v: string, set: (s: string) => void) => (
    <input value={v} onChange={(e) => { set(e.target.value); setErr(null); }} style={inputCss} />
  );

  return (
    <div
      onClick={() => !busy && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '1.2rem', overflowY: 'auto' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 12, padding: '1.1rem 1.2rem', maxWidth: 460, width: '100%', boxShadow: '0 12px 40px rgba(0,0,0,.6)', margin: 'auto' }}
      >
        <div style={{ fontWeight: 800, color: 'var(--white,#fff)', fontSize: '.95rem', marginBottom: '.2rem' }}>
          Edit {kind === 'deposit' ? 'deposit' : 'balance'} receipt
        </div>
        <p style={{ margin: '0 0 .4rem', color: 'var(--muted,#8a8aa0)', fontSize: '.72rem', lineHeight: 1.5 }}>
          Changes here only affect this receipt — the booking is never altered. Values print exactly as typed; nothing recalculates. Saving re-sends the receipt to the client.
        </p>

        <div style={sectionCss}>Amounts</div>
        <Field label="Received line label">{text(receivedLabel, setReceivedLabel)}</Field>
        <Field label="Amount received">{money(received, setReceived)}</Field>
        <Field label="Event total">{money(total, setTotal)}</Field>
        <Field label="Paid to date">{money(paidToDate, setPaidToDate)}</Field>
        <Field label="Headline label">{text(headlineLabel, setHeadlineLabel)}</Field>
        <Field label="Headline amount (blank = no figure)">{money(headlineAmount, setHeadlineAmount)}</Field>

        <div style={sectionCss}>Event details</div>
        <Field label="Event type">{text(eventType, setEventType)}</Field>
        <Field label="Package">{text(packageTitle, setPackageTitle)}</Field>
        <Field label="Includes (blank = keep package's listed inclusions)">
          <textarea value={includes} onChange={(e) => { setIncludes(e.target.value); setErr(null); }} rows={2} style={{ ...inputCss, resize: 'vertical' }} />
        </Field>
        <Field label="Event date">{text(eventDate, setEventDate)}</Field>
        <Field label="Event time">{text(eventTime, setEventTime)}</Field>
        <Field label="Venue">{text(venue, setVenue)}</Field>

        <div style={sectionCss}>Client (Received From)</div>
        <Field label="Client name">{text(clientName, setClientName)}</Field>
        <Field label="Client email (the receipt is sent here)">{text(clientEmail, setClientEmail)}</Field>

        {err && <p style={{ margin: '.3rem 0 .6rem', color: '#ff6b6b', fontSize: '.75rem', lineHeight: 1.5, wordBreak: 'break-word' }}>{err}</p>}

        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end', marginTop: '.7rem' }}>
          <button type="button" disabled={busy} onClick={onClose}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.18)', color: 'var(--muted,#8a8aa0)', fontWeight: 700, borderRadius: 6, padding: '.5rem 1rem', cursor: busy ? 'default' : 'pointer', fontSize: '.8rem' }}>
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={() => void save()}
            style={{ background: NEON, border: 'none', color: '#06231b', fontWeight: 800, borderRadius: 6, padding: '.5rem 1.1rem', cursor: busy ? 'wait' : 'pointer', fontSize: '.8rem', opacity: busy ? .6 : 1 }}>
            {busy ? 'Saving…' : 'Save & re-send'}
          </button>
        </div>
      </div>
    </div>
  );
}
