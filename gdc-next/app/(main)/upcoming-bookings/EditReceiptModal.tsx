'use client';

// EditReceiptModal — Phase 2, WYSIWYG. The DJ edits a PAID deposit/balance
// receipt ON the receipt itself: a realistic render of the paper (their logo,
// business header, brand colour — pulled from Receipt settings) with every
// client-facing value sitting as an inline input right where it prints. What you
// see is what the host gets.
//
// Everything is printed VERBATIM — no recalculation (editing the total does NOT
// move the deposit % or the balance). The edit is stored as a per-kind snapshot
// on the booking (receipt_overrides); the booking record is never touched.
// Saving re-sends the receipt to the host. Fields prefill from the last saved
// edit if there is one, else from the receipt's current derived values.

import { useEffect, useRef, useState } from 'react';
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
const DEFAULT_ACCENT = '#00e0a4';
const INK = '#1a1a2e';
const MUTED = '#777';

// ── Inline editors ──────────────────────────────────────────────────────────
// These MUST live at module scope. Defining them inside the component makes React
// treat them as a brand-new component type on every render, which remounts the
// <input> each keystroke and drops focus after one character.
const fieldBase: React.CSSProperties = {
  font: 'inherit', color: 'inherit', background: 'transparent', border: 'none',
  borderBottom: '1px dashed rgba(0,0,0,.22)', padding: '0 0 1px', margin: 0, outline: 'none',
  // Belt-and-suspenders: no number spinners, ever, even if a browser ignores the
  // text input type. Amount fields use type="text" + inputMode="decimal".
  WebkitAppearance: 'none', MozAppearance: 'textfield', appearance: 'none',
};
function focusOn(accent: string) {
  return (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderBottomColor = accent;
    e.currentTarget.style.borderBottomStyle = 'solid';
  };
}
function blurOff(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderBottomColor = 'rgba(0,0,0,.22)';
  e.currentTarget.style.borderBottomStyle = 'dashed';
}

function InlineText({ value, set, accent, onEdit, style, placeholder }: {
  value: string; set: (s: string) => void; accent: string; onEdit: () => void;
  style?: React.CSSProperties; placeholder?: string;
}) {
  return (
    <input value={value} placeholder={placeholder}
      onChange={(e) => { set(e.target.value); onEdit(); }}
      onFocus={focusOn(accent)} onBlur={blurOff}
      style={{ ...fieldBase, width: '100%', ...style }} />
  );
}

// Auto-growing multi-line field — for Package / Includes, which can run long.
function InlineArea({ value, set, accent, onEdit, style, placeholder }: {
  value: string; set: (s: string) => void; accent: string; onEdit: () => void;
  style?: React.CSSProperties; placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const el = ref.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
  };
  useEffect(() => { resize(); }, [value]);
  return (
    <textarea ref={ref} value={value} placeholder={placeholder} rows={1}
      onChange={(e) => { set(e.target.value); onEdit(); }}
      onFocus={focusOn(accent)} onBlur={blurOff}
      style={{ ...fieldBase, width: '100%', resize: 'none', overflow: 'hidden', lineHeight: 1.4, ...style }} />
  );
}

function InlineMoney({ value, set, accent, onEdit, sym, bold, color, optional }: {
  value: string; set: (s: string) => void; accent: string; onEdit: () => void;
  sym: string; bold?: boolean; color?: string;
  // optional: the amount may be left blank (the headline on a "Paid in Full").
  // When blank we hide the currency symbol and show a faint hint, so an empty
  // amount reads as deliberate rather than broken.
  optional?: boolean;
}) {
  const empty = value.trim() === '';
  const hideSym = optional && empty;
  // text + inputMode=decimal instead of type=number: no spinner arrows, but the
  // numeric keypad still comes up on mobile. Non-numeric input is parsed out on save.
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 1, fontWeight: bold ? 800 : 'inherit', color }}>
      {!hideSym && <span>{sym}</span>}
      <input type="text" inputMode="decimal" value={value} placeholder={optional ? 'add amount' : ''}
        onChange={(e) => { set(e.target.value.replace(/[^0-9.]/g, '')); onEdit(); }}
        onFocus={focusOn(accent)} onBlur={blurOff}
        style={{ ...fieldBase, width: optional ? 110 : 90, textAlign: 'right', fontWeight: bold ? 800 : 'inherit', color: hideSym ? '#b9b9c6' : 'inherit', fontStyle: hideSym ? 'italic' : 'normal' }} />
    </span>
  );
}

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
// Flatten the booking's rich-text package details into newline-separated plain
// text, so the editor can prefill "Package Includes" with what's on the booking
// card (one item per line) — mirroring how the receipt flattens it.
function stripToLines(raw: string | null | undefined): string {
  return String(raw || '')
    .replace(/<\/(p|div|br|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
    .trim();
}
function friendlyDate(d: string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(`${d}T12:00:00`);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function stackAddr(s: string): string[] {
  if (!s) return [];
  if (s.includes('\n')) return s.split('\n').map((x) => x.trim()).filter(Boolean);
  const p = s.split(',').map((x) => x.trim()).filter(Boolean);
  return p.length > 1 ? [p[0], p.slice(1).join(', ')] : [s];
}

interface SettingsShape {
  receiptAddress: string | null; accountAddress: string;
  receiptColor: string | null; receiptPhone: string | null; accountPhone: string;
  businessName: string; logoUrl: string | null;
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
  // Pre-fill the headline amount with the real figure (the amount paid when it's
  // paid in full, otherwise the remaining balance). The DJ sees the number by
  // default and only has to touch it to change it — clearing it falls back to a
  // label-only headline (e.g. "Paid in Full" with no figure).
  const defHeadlineAmount = paidInFull ? String(defTotal) : String(remaining);

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
  const [includes, setIncludes] = useState(sv('includes', stripToLines(booking.package_details)));
  const [eventDate, setEventDate] = useState(sv('eventDate', friendlyDate(booking.event_date)));
  const [eventTime, setEventTime] = useState(sv('eventTime',
    [fmtTime(booking.start_time), fmtTime(booking.end_time)].filter(Boolean).join(' – ')));
  const [venue, setVenue] = useState(sv('venue', booking.venue_name || ''));
  const [clientName, setClientName] = useState(sv('clientName', booking.requester_name || ''));
  const [clientEmail, setClientEmail] = useState(sv('clientEmail', booking.host_email || ''));

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsShape | null>(null);
  const clearErr = () => setErr(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/dj/receipt-settings');
        const j = (await r.json().catch(() => ({}))) as Partial<SettingsShape>;
        if (alive) setSettings({
          receiptAddress: j.receiptAddress ?? null,
          accountAddress: j.accountAddress ?? '',
          receiptColor: j.receiptColor ?? null,
          receiptPhone: j.receiptPhone ?? null,
          accountPhone: j.accountPhone ?? '',
          businessName: j.businessName ?? '',
          logoUrl: j.logoUrl ?? null,
        });
      } catch { if (alive) setSettings({ receiptAddress: null, accountAddress: '', receiptColor: null, receiptPhone: null, accountPhone: '', businessName: '', logoUrl: null }); }
    })();
    return () => { alive = false; };
  }, []);

  async function save() {
    setBusy(true);
    setErr(null);
    const numOrUndef = (s: string): number | undefined => {
      const t = s.trim();
      if (t === '') return undefined;
      const n = Number(t);
      return Number.isFinite(n) ? round2(n) : undefined;
    };
    const overrides: Record<string, unknown> = {
      received: numOrUndef(received),
      receivedLabel,
      total: numOrUndef(total),
      paidToDate: numOrUndef(paidToDate),
      headlineLabel,
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
  const accent = (settings?.receiptColor && /^#[0-9a-fA-F]{6}$/.test(settings.receiptColor)) ? settings.receiptColor : DEFAULT_ACCENT;
  const addrLines = settings ? stackAddr(settings.receiptAddress != null ? settings.receiptAddress : settings.accountAddress) : [];
  const headerPhone = settings ? (settings.receiptPhone != null ? settings.receiptPhone : settings.accountPhone) : '';
  const hex = (booking.id || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const docNumber = hex.length < 5 ? `GDC-${hex}` : `GDC-${hex.slice(0, 4)}-${hex.slice(4, 5)}`;
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const secLabel: React.CSSProperties = { fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#999', margin: '0 0 4px' };
  const rowCss: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '4px 0', fontSize: 12.5 };
  const hr = <hr style={{ border: 'none', borderTop: '1px solid #e5e5e5', margin: '14px 0' }} />;

  return (
    <div onClick={() => !busy && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '1.2rem', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 580, width: '100%', margin: 'auto' }}>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: '.95rem', marginBottom: '.2rem' }}>
          Edit {kind === 'deposit' ? 'deposit' : 'balance'} receipt
        </div>
        <p style={{ margin: '0 0 .6rem', color: 'rgba(255,255,255,.7)', fontSize: '.72rem', lineHeight: 1.5 }}>
          Edit any value right on the receipt — it prints exactly as typed, nothing recalculates, and the booking is never changed. Saving re-sends this to the client.
        </p>

        <div style={{ background: '#fff', borderRadius: 10, padding: '24px 26px', color: INK, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, minWidth: 0 }}>
              {settings?.logoUrl
                /* eslint-disable-next-line @next/next/no-img-element */
                ? <img src={settings.logoUrl} alt="logo" style={{ maxWidth: 110, maxHeight: 44, objectFit: 'contain', display: 'block', flexShrink: 0 }} />
                : null}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{settings?.businessName || 'Your Business'}</div>
                {addrLines.map((ln, i) => (
                  <div key={i} style={{ color: MUTED, fontSize: 11, marginTop: i === 0 ? 3 : 1 }}>{ln}</div>
                ))}
                {headerPhone ? <div style={{ color: MUTED, fontSize: 11, marginTop: 2 }}>{headerPhone}</div> : null}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: accent, letterSpacing: '.02em' }}>RECEIPT</div>
              <div style={{ color: MUTED, fontSize: 11, marginTop: 4 }}>{today}</div>
              <div style={{ color: MUTED, fontSize: 11 }}>Reference: {docNumber}</div>
            </div>
          </div>

          {hr}

          {/* RECEIVED FROM · EVENT */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={secLabel}>Received From</div>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}><InlineText value={clientName} set={setClientName} accent={accent} onEdit={clearErr} placeholder="Client name" style={{ fontWeight: 700 }} /></div>
              <div style={{ color: MUTED, fontSize: 12, marginTop: 2 }}><InlineText value={clientEmail} set={setClientEmail} accent={accent} onEdit={clearErr} placeholder="client@email" style={{ color: MUTED }} /></div>
            </div>
            <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
              <div style={secLabel}>Event</div>
              <div style={{ fontSize: 12.5 }}><InlineText value={eventType} set={setEventType} accent={accent} onEdit={clearErr} placeholder="Event type" style={{ textAlign: 'right' }} /></div>
              <div style={{ color: MUTED, fontSize: 12, marginTop: 2 }}><InlineText value={eventDate} set={setEventDate} accent={accent} onEdit={clearErr} placeholder="Event date" style={{ textAlign: 'right', color: MUTED }} /></div>
              <div style={{ color: MUTED, fontSize: 12 }}><InlineText value={venue} set={setVenue} accent={accent} onEdit={clearErr} placeholder="Venue" style={{ textAlign: 'right', color: MUTED }} /></div>
              <div style={{ color: MUTED, fontSize: 12 }}><InlineText value={eventTime} set={setEventTime} accent={accent} onEdit={clearErr} placeholder="Event time" style={{ textAlign: 'right', color: MUTED }} /></div>
            </div>
          </div>

          {hr}

          {/* DETAILS — Package & Includes are multi-line and grow with the text. */}
          <div style={secLabel}>Details</div>
          <div style={{ ...rowCss, color: MUTED, alignItems: 'center' }}><span>Event Type</span><span style={{ color: INK, width: '55%' }}><InlineText value={eventType} set={setEventType} accent={accent} onEdit={clearErr} style={{ textAlign: 'right' }} /></span></div>
          <div style={{ ...rowCss, color: MUTED }}><span style={{ paddingTop: 1 }}>Package Name</span><span style={{ color: INK, width: '60%' }}><InlineArea value={packageTitle} set={setPackageTitle} accent={accent} onEdit={clearErr} style={{ textAlign: 'right' }} placeholder="Package name" /></span></div>
          <div style={{ ...rowCss, color: MUTED }}><span style={{ paddingTop: 1 }}>Package Includes</span><span style={{ color: INK, width: '60%' }}><InlineArea value={includes} set={setIncludes} accent={accent} onEdit={clearErr} style={{ textAlign: 'right' }} placeholder="(optional)" /></span></div>

          {hr}

          {/* Money lines. The "Received" line hides when it's redundant — equal to
              BOTH the event total and paid-to-date — matching the receipt, which
              drops it in that case. It reappears the moment any of them differ. */}
          {(() => {
            const n = (s: string) => { const v = Number(s); return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN; };
            const redundant = Math.abs(n(received) - n(total)) < 0.005 && Math.abs(n(received) - n(paidToDate)) < 0.005;
            return redundant ? null : (
              <div style={{ ...rowCss, alignItems: 'center' }}><span style={{ flex: 1 }}><InlineText value={receivedLabel} set={setReceivedLabel} accent={accent} onEdit={clearErr} placeholder="Received label" /></span><InlineMoney value={received} set={setReceived} accent={accent} onEdit={clearErr} sym={sym} /></div>
            );
          })()}
          <div style={{ ...rowCss, color: MUTED, alignItems: 'center' }}><span>Event total</span><InlineMoney value={total} set={setTotal} accent={accent} onEdit={clearErr} sym={sym} /></div>
          <div style={{ ...rowCss, color: MUTED, alignItems: 'center' }}><span>Paid to date</span><InlineMoney value={paidToDate} set={setPaidToDate} accent={accent} onEdit={clearErr} sym={sym} /></div>

          {/* Headline box */}
          <div style={{ marginTop: 14, background: '#f4fbf8', border: `1px solid ${accent}`, borderRadius: 8, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontWeight: 800 }}>
            <span style={{ color: INK, flex: 1, textTransform: 'uppercase', fontSize: 13 }}>
              <InlineText value={headlineLabel} set={setHeadlineLabel} accent={accent} onEdit={clearErr} style={{ fontWeight: 800, textTransform: 'uppercase' }} />
            </span>
            <span style={{ fontSize: 18 }}>
              <InlineMoney value={headlineAmount} set={setHeadlineAmount} accent={accent} onEdit={clearErr} sym={sym} bold color={accent} optional />
            </span>
          </div>
          <div style={{ color: MUTED, fontSize: 10.5, marginTop: 6, textAlign: 'right' }}>Headline amount blank = label only (e.g. “Paid in Full”).</div>
        </div>

        {err && <p style={{ margin: '.5rem 0 0', color: '#ff8a8a', fontSize: '.78rem', lineHeight: 1.5, wordBreak: 'break-word' }}>{err}</p>}

        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end', marginTop: '.7rem' }}>
          <button type="button" disabled={busy} onClick={onClose}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.25)', color: 'rgba(255,255,255,.8)', fontWeight: 700, borderRadius: 6, padding: '.5rem 1rem', cursor: busy ? 'default' : 'pointer', fontSize: '.8rem' }}>
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
