'use client';

// BookingEditModal — the per-section edit flow launched by a section's pencil.
//
//   pencil → acknowledgment (scaled to contract state) → Proceed → edit form →
//   Save → POST /api/bookings/edit.
//
// Notify-only fields apply immediately (host emailed an FYI); approval-required
// fields become pending change requests (host emailed an approve/decline link).
// The parent re-reads the booking so the "Edited" / "Pending change" badges show.

import { useMemo, useRef, useState } from 'react';
import { EDIT_FIELDS, type EditFieldDef } from '@/lib/bookingEditFields';
import { MOBILE_EVENT_TYPES, NEON } from './shared';
import { searchAddresses } from '../[slug]/mobileBookingForm';

export type EditSection = 'EVENT' | 'VENUE' | 'HOST' | 'PACKAGE' | 'PRICING';
export type ContractState = 'none' | 'sent' | 'signed';

const LEGAL = 'Editing this booking does not legally cancel or change either party’s pre-existing contractual agreement. Any change must be mutually agreed upon by you and the host. Global DJ Connect is not responsible for enforcing this booking or any changes to it.';

const SECTION_TITLE: Record<EditSection, string> = { EVENT: 'Event', VENUE: 'Venue', HOST: 'Host', PACKAGE: 'Package', PRICING: 'Pricing' };

// Ack copy tailored to the section being edited — only names what actually
// needs the host's approval in that section, so a price edit says "price",
// a package edit says "package", etc. HOST details are notify-only (no
// approval), so its copy drops the approval sentence.
const SECTION_ACK: Record<EditSection, string> = {
  EVENT: 'The host will be notified of anything you change here. Changes to the date or time need the host’s approval before they take effect. Changes approved do NOT legally alter any binding contract. Make sure you’re both on the same page.',
  VENUE: 'The host will be notified of anything you change here. A change to the venue address needs the host’s approval before it takes effect. Changes approved do NOT legally alter any binding contract. Make sure you’re both on the same page.',
  HOST: 'The host will be notified of anything you change here. Changes approved do NOT legally alter any binding contract. Make sure you’re both on the same page.',
  PACKAGE: 'The host will be notified of anything you change here. A change to the package needs the host’s approval before it takes effect. Changes approved do NOT legally alter any binding contract. Make sure you’re both on the same page.',
  PRICING: 'The host will be notified of anything you change here. A change to the price or tax needs the host’s approval before it takes effect. Changes approved do NOT legally alter any binding contract. Make sure you’re both on the same page.',
};

// Time options every 15 minutes — value HH:MM (24h), label 12-hour AM/PM.
const TIME_OPTIONS: { value: string; label: string }[] = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4); const m = (i % 4) * 15;
  const hh = String(h).padStart(2, '0'); const mm = String(m).padStart(2, '0');
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return { value: `${hh}:${mm}`, label: `${h12}:${mm} ${h >= 12 ? 'PM' : 'AM'}` };
});

export default function BookingEditModal({
  section, djType, contractState, values, lockEmail = false, pendingCols, pendingInfo, noHostRecipient = false, collected = 0, depositPaidAmount = 0, depositSkipped = false, depositLocked = false, pendingPayment = false, onClose, onSaved, onCancelled,
}: {
  section: EditSection;
  djType: 'club' | 'mobile';
  contractState: ContractState;
  /** Current stored value per field key (strings; date=YYYY-MM-DD, time=HH:MM). */
  values: Record<string, string>;
  /** Account-based booking: the host's email is their login, so it can't be
   *  edited here — hide it from the Host form. */
  lockEmail?: boolean;
  /** DB columns that already have a pending approval request. Those fields are
   *  locked here — the DJ must cancel the pending request before re-requesting. */
  pendingCols?: Set<string>;
  /** Per-column detail of the pending change (old → new), to show what's awaiting
   *  the host on a locked field. Keyed by DB column. */
  pendingInfo?: Record<string, { old: string; neu: string }>;
  /** Manual booking with no host recipient: nothing to approve or notify, so
   *  every change applies immediately and no approval/notify copy shows. */
  noHostRecipient?: boolean;
  /** Total money already received on this booking (deposit + balance payments). */
  collected?: number;
  /** Money already paid toward the deposit specifically — drives "ALREADY PAID". */
  depositPaidAmount?: number;
  /** The deposit was skipped or waived — don't factor a deposit into the breakdown. */
  depositSkipped?: boolean;
  /** A deposit was already received or skipped — the deposit % can't change. */
  depositLocked?: boolean;
  /** A deposit or balance request is out (sent, unpaid) — the DJ must cancel it
   *  before changing the price so the amounts stay in sync. */
  pendingPayment?: boolean;
  onClose: () => void;
  onSaved: (result: { applied: string[]; pending: { field: string; label: string }[]; field_edits: Record<string, string> }) => void;
  /** Called after a pending request is cancelled so the parent re-reads badges. */
  onCancelled?: () => void;
}) {
  // Which fields belong to this section, minus ones that don't apply to this DJ
  // type (club uses venue_type, mobile uses venue_name/room_details).
  const fields = useMemo(() => EDIT_FIELDS.filter((f) => {
    if (f.section !== section) return false;
    if (f.key === 'venue_name' || f.key === 'room_details') return djType !== 'club';
    if (f.key === 'venue_type') return djType === 'club';
    if (f.key === 'event_type') return djType !== 'club';
    if (f.key === 'host_email' && lockEmail) return false; // account email is read-only
    return true;
  }), [section, djType, lockEmail]);

  const [step, setStep] = useState<'ack' | 'form'>('ack');
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? ''])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  // Venue-address autocomplete (same Nominatim search as the booking form).
  const [addrSug, setAddrSug] = useState<{ display: string }[]>([]);
  const [showAddr, setShowAddr] = useState(false);
  const addrTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-booking pricing terms (PRICING section only): tax %, deposit %, no-tax.
  const isPricing = section === 'PRICING';
  const initTaxPct = values.tax_pct ?? '0';
  // Deposit is NOT editable here — it stays as configured in Booking Settings.
  // We only read the stored value to show it in the breakdown.
  const initDepPct = values.deposit_pct ?? '';
  const depPct = initDepPct;
  // "Apply tax" mirrors the manual-booking flow: checked = tax applies (rate
  // field shows), unchecked = no tax (no field). Starts checked when the booking
  // already carries a tax rate.
  const [applyTax, setApplyTax] = useState((Number(initTaxPct) || 0) > 0);
  const [taxPct, setTaxPct] = useState(initTaxPct === '0' ? '' : initTaxPct);

  const isPending = (f: EditFieldDef) => f.tier === 'approve' && !!pendingCols?.has(f.col);
  // Locked fields (pending approval) don't count as editable changes.
  const changed = fields.filter((f) => !isPending(f) && (form[f.key] ?? '') !== (values[f.key] ?? ''));
  const hasApprove = changed.some((f) => f.tier === 'approve');

  // Tax edit or skipping the deposit makes the pricing terms dirty.
  const newTaxPctNum = applyTax ? (Number(taxPct) || 0) : 0;
  const taxDirty = isPricing && newTaxPctNum !== (Number(initTaxPct) || 0);
  const pricingDirty = isPricing && taxDirty;

  // Live price breakdown: the agreed rate, tax and deposit as they stand, and the
  // new figures as the DJ edits price / tax % / deposit %. A line that changed
  // shows the old value struck through next to the new one.
  const priceBreakdown = (() => {
    if (!isPricing) return null;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const cur = values.__currency || 'USD';
    const money = (n: number) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n); } catch { return `$${n.toFixed(2)}`; } };
    const calc = (base: number, tp: number, dp: number) => {
      const taxAmt = r2((base * tp) / 100);
      const total = r2(base + taxAmt);
      const depAmt = r2((total * dp) / 100);
      return { base, tp, taxAmt, total, dp, depAmt, balance: r2(total - depAmt) };
    };
    const base0 = Number(values.price) || 0;
    const tp0 = Number(values.tax_pct) || 0;
    const dp0 = (values.deposit_pct || '').trim() === '' ? 0 : (Number(values.deposit_pct) || 0);
    const o = calc(base0, tp0, dp0);
    const n = calc(Number(form.price) || 0, applyTax ? (Number(taxPct) || 0) : 0, depPct.trim() === '' ? 0 : (Number(depPct) || 0));
    const Row = ({ label: lbl, oldV, newV, strong }: { label: string; oldV: string; newV: string; strong?: boolean }) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderTop: strong ? '1px solid rgba(255,255,255,.16)' : '1px solid rgba(255,255,255,.06)' }}>
        <span style={{ fontSize: strong ? '.86rem' : '.8rem', color: strong ? '#fff' : '#c9c9d6', fontWeight: strong ? 700 : 400 }}>{lbl}</span>
        <span style={{ fontSize: strong ? '.92rem' : '.85rem', fontWeight: strong ? 800 : 600 }}>
          {oldV !== newV && <span style={{ color: '#8a8aa0', textDecoration: 'line-through', marginRight: 6, fontWeight: 400 }}>{oldV}</span>}
          <span style={{ color: oldV !== newV ? NEON : '#fff' }}>{newV}</span>
        </span>
      </div>
    );
    return (
      <div style={{ marginTop: 14, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: '4px 12px 10px' }}>
        <div style={{ fontSize: '.62rem', letterSpacing: '.1em', color: '#8a8aa0', textTransform: 'uppercase', padding: '8px 0 2px' }}>Price breakdown</div>
        <Row label="Agreed rate" oldV={money(o.base)} newV={money(n.base)} />
        <Row label={`Tax${n.tp > 0 ? ` (${n.tp}%)` : ''}`} oldV={o.tp > 0 ? money(o.taxAmt) : 'No tax'} newV={n.tp > 0 ? money(n.taxAmt) : 'No tax'} />
        <Row label={n.tp > 0 ? 'Total (with tax)' : 'Total'} oldV={money(o.total)} newV={money(n.total)} strong />
        {(collected > 0 || depositLocked || depositSkipped) ? (
          // Money already changed hands (or the deposit was skipped): subtract what's
          // been received from the new total. Negative remainder → refund owed.
          // A skipped/waived deposit is never shown as a line — it doesn't factor in.
          <>
            {depositPaidAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <span style={{ fontSize: '.8rem', color: '#c9c9d6' }}>Deposit{o.dp > 0 ? ` (${o.dp}%)` : ''}<span style={{ color: NEON, fontSize: '.62rem', fontWeight: 700, letterSpacing: '.06em', marginLeft: 6 }}>PAID</span></span>
                <span style={{ fontSize: '.85rem', fontWeight: 700, color: '#fff' }}>{money(depositPaidAmount)}</span>
              </div>
            )}
            {collected > depositPaidAmount && (
              <Row label="Received (paid)" oldV={money(r2(collected - depositPaidAmount))} newV={money(r2(collected - depositPaidAmount))} />
            )}
            {r2(n.total - collected) >= 0
              ? <Row label="Balance due" oldV={money(Math.max(0, r2(o.total - collected)))} newV={money(r2(n.total - collected))} strong />
              : <Row label="Refund owed" oldV={o.total - collected < 0 ? money(r2(collected - o.total)) : money(0)} newV={money(r2(collected - n.total))} strong />}
          </>
        ) : (
          <>
            <Row label={`Deposit${n.dp > 0 ? ` (${n.dp}%)` : ''}`} oldV={o.dp > 0 ? money(o.depAmt) : '—'} newV={n.dp > 0 ? money(n.depAmt) : '—'} />
            <Row label="Balance due" oldV={money(o.balance)} newV={money(n.balance)} />
          </>
        )}
      </div>
    );
  })();

  async function cancelRequest(f: EditFieldDef) { await cancelByKey(f.key); }
  async function cancelByKey(key: string) {
    setCancelling(key); setErr(null);
    try {
      const res = await fetch('/api/bookings/edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: values.__id, cancelField: key }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not cancel.');
      onCancelled?.();
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not cancel.'); }
    finally { setCancelling(null); }
  }

  async function save() {
    if (changed.length === 0 && !pricingDirty) { onClose(); return; }
    setBusy(true); setErr(null);
    try {
      const changes: Record<string, string> = {};
      changed.forEach((f) => { changes[f.key] = form[f.key] ?? ''; });
      const payload: Record<string, unknown> = { bookingId: values.__id, changes };
      if (pricingDirty) {
        // Tax is editable; deposit can only be skipped (waived), not re-set.
        const pricing: { taxPct?: number; removeTax?: boolean } = {};
        if (applyTax) pricing.taxPct = newTaxPctNum; else pricing.removeTax = true;
        payload.pricing = pricing;
      }
      const res = await fetch('/api/bookings/edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; applied?: string[]; pending?: { field: string; label: string }[]; field_edits?: Record<string, string> };
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not save.');
      onSaved({ applied: json.applied || [], pending: json.pending || [], field_edits: json.field_edits || {} });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  }

  const scrim: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
  const box: React.CSSProperties = { width: '100%', maxWidth: 480, maxHeight: '92vh', overflow: 'auto', background: '#12121a', border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, padding: 22, boxShadow: '0 24px 70px rgba(0,0,0,.6)' };
  const label: React.CSSProperties = { display: 'block', fontSize: '.72rem', color: '#8a8aa0', margin: '0 0 4px' };
  const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#0c0c11', border: '1px solid rgba(255,255,255,.14)', borderRadius: 7, padding: '9px 10px', color: '#fff', fontSize: '.9rem', fontFamily: 'inherit' };
  const btnGhost: React.CSSProperties = { background: 'transparent', border: '1px solid rgba(255,255,255,.2)', color: '#8a8aa0', borderRadius: 9, padding: '10px 16px', fontWeight: 700, fontSize: '.86rem', cursor: 'pointer' };
  const btnPrimary: React.CSSProperties = { background: NEON, border: 'none', color: '#04150f', borderRadius: 9, padding: '10px 18px', fontWeight: 800, fontSize: '.86rem', cursor: 'pointer' };

  return (
    <div style={scrim} onClick={() => { if (!busy) onClose(); }}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        {step === 'ack' ? (
          contractState === 'none' ? (
            <>
              <h3 style={{ margin: '0 0 10px', fontSize: '1rem' }}>Edit {SECTION_TITLE[section].toLowerCase()} details</h3>
              <p style={{ color: '#c9c9d6', fontSize: '.9rem', lineHeight: 1.55, margin: '0 0 4px' }}>
                {noHostRecipient
                  ? 'This booking has no host contact on file, so changes apply right away.'
                  : SECTION_ACK[section]}
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button style={btnGhost} onClick={onClose}>Cancel</button>
                <button style={btnPrimary} onClick={() => setStep('form')}>Proceed</button>
              </div>
            </>
          ) : (
            <>
              <h3 style={{ margin: '0 0 10px', fontSize: '1rem' }}>Before you make this change</h3>
              <p style={{ color: '#d6d6e0', fontSize: '.9rem', lineHeight: 1.55, margin: '0 0 4px' }}>{LEGAL}</p>
              <p style={{ color: '#d6d6e0', fontSize: '.9rem', lineHeight: 1.55, margin: '8px 0 4px' }}>New contract available to be sent if agreed.</p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button style={btnGhost} onClick={onClose}>Cancel</button>
                <button style={btnPrimary} onClick={() => setStep('form')}>I understand — Proceed</button>
              </div>
            </>
          )
        ) : (
          <>
            <h3 style={{ margin: '0 0 14px', fontSize: '1rem' }}>Edit {SECTION_TITLE[section].toLowerCase()} details</h3>
            {fields.map((f: EditFieldDef) => (
              <div key={f.key} style={{ marginBottom: 11 }}>
                <label style={label}>{f.label}{f.tier === 'approve' && !noHostRecipient && <span style={{ color: '#f5e642', marginLeft: 6, fontSize: '.62rem', letterSpacing: '.08em' }}>NEEDS APPROVAL</span>}</label>
                {isPending(f) ? (
                  <div style={{ background: 'rgba(245,230,66,.08)', border: '1px solid rgba(245,230,66,.3)', borderRadius: 7, padding: '9px 10px' }}>
                    <div style={{ color: '#f5e642', fontSize: '.74rem', fontWeight: 700, letterSpacing: '.04em' }}>PENDING HOST APPROVAL</div>
                    {pendingInfo?.[f.col] && (
                      <div style={{ fontSize: '.86rem', margin: '5px 0 2px' }}>
                        <span style={{ color: '#8a8aa0', textDecoration: 'line-through' }}>{pendingInfo[f.col].old}</span>
                        {' '}<span style={{ color: '#f5e642' }}>→</span>{' '}
                        <span style={{ color: '#fff', fontWeight: 700 }}>{pendingInfo[f.col].neu}</span>
                      </div>
                    )}
                    <div style={{ color: '#c9c9d6', fontSize: '.78rem', margin: '3px 0 8px', lineHeight: 1.45 }}>This change is awaiting the host. Cancel it to request a different change.</div>
                    <button
                      type="button"
                      style={{ ...btnGhost, padding: '6px 12px', fontSize: '.78rem', borderColor: 'rgba(255,107,107,.5)', color: '#ff8a8a' }}
                      disabled={cancelling === f.key}
                      onClick={() => cancelRequest(f)}
                    >{cancelling === f.key ? 'Cancelling…' : 'Cancel requested change'}</button>
                  </div>
                ) : f.key === 'event_type' ? (
                  // Event type is fixed for a booking — show it, but don't let it change.
                  <>
                    <div style={{ ...input, opacity: 0.6, cursor: 'not-allowed', display: 'flex', alignItems: 'center' }}>
                      {MOBILE_EVENT_TYPES.find((o) => o.value === (values[f.key] ?? ''))?.label || values[f.key] || '—'}
                    </div>
                    <div style={{ fontSize: '.72rem', color: '#8a8aa0', marginTop: 4 }}>Event type can&rsquo;t be changed.</div>
                  </>
                ) : f.key === 'price' && pendingPayment ? (
                  // A deposit/balance request is out — lock the price until it's cancelled.
                  <>
                    <div style={{ ...input, opacity: 0.6, cursor: 'not-allowed', display: 'flex', alignItems: 'center' }}>{form[f.key] || '—'}</div>
                    <div style={{ fontSize: '.72rem', color: '#f5e642', marginTop: 4, lineHeight: 1.45 }}>A deposit or balance request is still pending. Cancel it on the booking before changing the price.</div>
                  </>
                ) : f.key === 'venue_address' ? (
                  <div style={{ position: 'relative' }}>
                    <input
                      style={input}
                      type="text"
                      autoComplete="off"
                      value={form[f.key] ?? ''}
                      placeholder="123 Main St, City, State"
                      onChange={(e) => {
                        const val = e.target.value;
                        setForm((p) => ({ ...p, [f.key]: val }));
                        if (addrTimer.current) clearTimeout(addrTimer.current);
                        if (val.trim().length < 3) { setAddrSug([]); setShowAddr(false); return; }
                        addrTimer.current = setTimeout(async () => {
                          const results = await searchAddresses(val.trim());
                          setAddrSug(results); setShowAddr(results.length > 0);
                        }, 350);
                      }}
                      onBlur={() => setTimeout(() => setShowAddr(false), 150)}
                      onFocus={() => { if (addrSug.length > 0) setShowAddr(true); }}
                    />
                    {showAddr && addrSug.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 2, background: '#14141f', border: '1px solid rgba(255,255,255,.16)', borderRadius: 8, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,.6)', maxHeight: 220, overflowY: 'auto' }}>
                        {addrSug.map((s, i) => (
                          <div
                            key={i}
                            onMouseDown={(e) => { e.preventDefault(); setForm((p) => ({ ...p, [f.key]: s.display })); setShowAddr(false); }}
                            style={{ padding: '9px 11px', fontSize: '.82rem', color: '#c9c9d6', cursor: 'pointer', borderTop: i ? '1px solid rgba(255,255,255,.07)' : 'none' }}
                          >{s.display}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : f.key === 'package_details' ? (
                  <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={form[f.key] ?? ''} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} />
                ) : f.kind === 'time' ? (
                  <select style={input} value={form[f.key] ?? ''} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}>
                    <option value="">Select a time</option>
                    {/* Keep the stored value selectable even if it's off the 15-min grid. */}
                    {form[f.key] && !TIME_OPTIONS.some((o) => o.value === form[f.key]) && (
                      <option value={form[f.key]}>{form[f.key]}</option>
                    )}
                    {TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input
                    style={input}
                    type={f.kind === 'date' ? 'date' : f.kind === 'number' ? 'number' : 'text'}
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
            {isPricing && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.1)' }}>
                <div style={{ fontSize: '.66rem', letterSpacing: '.1em', color: '#8a8aa0', textTransform: 'uppercase', margin: '0 0 10px' }}>Tax &amp; deposit · this booking only</div>
                {pendingCols?.has('tax_pct') ? (
                  // A tax change is awaiting the host — lock the tax controls and
                  // offer to cancel the pending request.
                  <div style={{ background: 'rgba(245,230,66,.08)', border: '1px solid rgba(245,230,66,.3)', borderRadius: 7, padding: '9px 10px', marginBottom: 11 }}>
                    <div style={{ color: '#f5e642', fontSize: '.74rem', fontWeight: 700, letterSpacing: '.04em' }}>TAX — PENDING HOST APPROVAL</div>
                    {pendingInfo?.['tax_pct'] && (
                      <div style={{ fontSize: '.86rem', margin: '5px 0 2px' }}>
                        <span style={{ color: '#8a8aa0', textDecoration: 'line-through' }}>{pendingInfo['tax_pct'].old}</span>
                        {' '}<span style={{ color: '#f5e642' }}>→</span>{' '}
                        <span style={{ color: '#fff', fontWeight: 700 }}>{pendingInfo['tax_pct'].neu}</span>
                      </div>
                    )}
                    <div style={{ color: '#c9c9d6', fontSize: '.78rem', margin: '3px 0 8px', lineHeight: 1.45 }}>This tax change is awaiting the host. Cancel it to request a different tax.</div>
                    <button
                      type="button"
                      style={{ ...btnGhost, padding: '6px 12px', fontSize: '.78rem', borderColor: 'rgba(255,107,107,.5)', color: '#ff8a8a' }}
                      disabled={cancelling === 'tax_pct'}
                      onClick={() => cancelByKey('tax_pct')}
                    >{cancelling === 'tax_pct' ? 'Cancelling…' : 'Cancel requested change'}</button>
                  </div>
                ) : (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 11 }}>
                      <input type="checkbox" checked={applyTax} onChange={(e) => setApplyTax(e.target.checked)} style={{ width: 16, height: 16, accentColor: NEON }} />
                      <span style={{ fontSize: '.86rem', color: '#fff' }}>Apply tax to this booking{!noHostRecipient && <span style={{ color: '#f5e642', marginLeft: 6, fontSize: '.62rem', letterSpacing: '.08em' }}>NEEDS APPROVAL</span>}</span>
                    </label>
                    {applyTax && (
                      <div style={{ marginBottom: 11 }}>
                        <label style={label}>Tax rate (%){!noHostRecipient && <span style={{ color: '#f5e642', marginLeft: 6, fontSize: '.62rem', letterSpacing: '.08em' }}>NEEDS APPROVAL</span>}</label>
                        <input style={input} type="number" step="0.001" min="0" value={taxPct} placeholder="e.g. 8.875" onChange={(e) => setTaxPct(e.target.value)} />
                      </div>
                    )}
                  </>
                )}
                {priceBreakdown}
              </div>
            )}
            {err && <div style={{ color: '#ff6b6b', fontSize: '.82rem', marginTop: 6 }}>{err}</div>}
            {!noHostRecipient && changed.some((f) => f.tier === 'notify') && (
              <div style={{ fontSize: '.76rem', color: '#fff', marginTop: 8 }}>Host will be notified of the change.</div>
            )}
            {!noHostRecipient && ((hasApprove && changed.length > 0) || taxDirty) && (
              <div style={{ fontSize: '.76rem', color: '#fff', marginTop: 8 }}>When you click Submit Change Request, the host is emailed to approve the change — the altered field shows as &ldquo;Pending Host Approval&rdquo; until approved.</div>
            )}
            {(() => {
              // Any dirty change that needs the host's sign-off (an approval-tier
              // field, or a tax edit) turns Save into "Submit Change Request".
              // With no host to approve, or notify-only fields, it stays "Save Change".
              const requiresApproval = !noHostRecipient && ((hasApprove && changed.length > 0) || taxDirty);
              const disabled = busy || (changed.length === 0 && !pricingDirty);
              return (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                  <button style={btnGhost} disabled={busy} onClick={onClose}>Cancel</button>
                  <button style={{ ...btnPrimary, opacity: disabled ? 0.5 : 1 }} disabled={disabled} onClick={save}>{busy ? (requiresApproval ? 'Submitting…' : 'Saving…') : (requiresApproval ? 'Submit Change Request' : 'Save Change')}</button>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
