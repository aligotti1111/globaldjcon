'use client';

// BookingEditModal — the per-section edit flow launched by a section's pencil.
//
//   pencil → acknowledgment (scaled to contract state) → Proceed → edit form →
//   Save → POST /api/bookings/edit.
//
// Notify-only fields apply immediately (host emailed an FYI); approval-required
// fields become pending change requests (host emailed an approve/decline link).
// The parent re-reads the booking so the "Edited" / "Pending change" badges show.

import { useMemo, useState } from 'react';
import { EDIT_FIELDS, type EditFieldDef } from '@/lib/bookingEditFields';
import { MOBILE_EVENT_TYPES, NEON } from './shared';

export type EditSection = 'EVENT' | 'VENUE' | 'HOST' | 'PACKAGE' | 'PRICING';
export type ContractState = 'none' | 'sent' | 'signed';

const LEGAL = 'Editing this booking does not legally cancel or change either party’s existing obligations under the agreement. Any change must be mutually agreed upon by you and the host. Global DJ Connect is not responsible for enforcing this booking or any changes to it.';

const SECTION_TITLE: Record<EditSection, string> = { EVENT: 'Event', VENUE: 'Venue', HOST: 'Host', PACKAGE: 'Package', PRICING: 'Pricing' };

// Time options every 15 minutes — value HH:MM (24h), label 12-hour AM/PM.
const TIME_OPTIONS: { value: string; label: string }[] = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4); const m = (i % 4) * 15;
  const hh = String(h).padStart(2, '0'); const mm = String(m).padStart(2, '0');
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return { value: `${hh}:${mm}`, label: `${h12}:${mm} ${h >= 12 ? 'PM' : 'AM'}` };
});

export default function BookingEditModal({
  section, djType, contractState, values, lockEmail = false, pendingCols, pendingInfo, onClose, onSaved, onCancelled,
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

  // Per-booking pricing terms (PRICING section only): tax %, deposit %, no-tax.
  const isPricing = section === 'PRICING';
  const initTaxPct = values.tax_pct ?? '0';
  const initDepPct = values.deposit_pct ?? '';
  const [removeTax, setRemoveTax] = useState((Number(initTaxPct) || 0) === 0);
  const [taxPct, setTaxPct] = useState(initTaxPct === '0' ? '' : initTaxPct);
  const [depPct, setDepPct] = useState(initDepPct);

  const isPending = (f: EditFieldDef) => f.tier === 'approve' && !!pendingCols?.has(f.col);
  // Locked fields (pending approval) don't count as editable changes.
  const changed = fields.filter((f) => !isPending(f) && (form[f.key] ?? '') !== (values[f.key] ?? ''));
  const hasApprove = changed.some((f) => f.tier === 'approve');

  // Did the pricing terms change from what's stored?
  const newTaxPctNum = removeTax ? 0 : (Number(taxPct) || 0);
  const newDepNum = depPct.trim() === '' ? null : (Number(depPct) || 0);
  const oldDepNum = initDepPct.trim() === '' ? null : (Number(initDepPct) || 0);
  const pricingDirty = isPricing && (newTaxPctNum !== (Number(initTaxPct) || 0) || newDepNum !== oldDepNum);

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
    const n = calc(Number(form.price) || 0, removeTax ? 0 : (Number(taxPct) || 0), depPct.trim() === '' ? 0 : (Number(depPct) || 0));
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
        <Row label="Total (with tax)" oldV={money(o.total)} newV={money(n.total)} strong />
        <Row label={`Deposit${n.dp > 0 ? ` (${n.dp}%)` : ''}`} oldV={o.dp > 0 ? money(o.depAmt) : '—'} newV={n.dp > 0 ? money(n.depAmt) : '—'} />
        <Row label="Balance due" oldV={money(o.balance)} newV={money(n.balance)} />
      </div>
    );
  })();

  async function cancelRequest(f: EditFieldDef) {
    setCancelling(f.key); setErr(null);
    try {
      const res = await fetch('/api/bookings/edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: values.__id, cancelField: f.key }),
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
        const pricing: { taxPct?: number; removeTax?: boolean; depositPct?: number } = {};
        if (newTaxPctNum !== (Number(initTaxPct) || 0)) {
          if (removeTax) pricing.removeTax = true; else pricing.taxPct = newTaxPctNum;
        }
        if (newDepNum !== oldDepNum && newDepNum !== null) pricing.depositPct = newDepNum;
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
                The host will be notified of anything you change here. Some changes (date, time, address, price, package details) need the host&rsquo;s approval before they take effect. Changes approved do NOT legally alter any binding contract. Make sure you&rsquo;re both on the same page.
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
                <label style={label}>{f.label}{f.tier === 'approve' && <span style={{ color: '#f5e642', marginLeft: 6, fontSize: '.62rem', letterSpacing: '.08em' }}>NEEDS APPROVAL</span>}</label>
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
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 11 }}>
                  <input type="checkbox" checked={removeTax} onChange={(e) => setRemoveTax(e.target.checked)} style={{ width: 16, height: 16, accentColor: NEON }} />
                  <span style={{ fontSize: '.86rem', color: '#fff' }}>No tax on this booking</span>
                </label>
                {!removeTax && (
                  <div style={{ marginBottom: 11 }}>
                    <label style={label}>Tax rate (%)</label>
                    <input style={input} type="number" step="0.001" min="0" value={taxPct} placeholder="e.g. 8.875" onChange={(e) => setTaxPct(e.target.value)} />
                  </div>
                )}
                <div>
                  <label style={label}>Deposit (%)</label>
                  <select style={input} value={depPct} onChange={(e) => setDepPct(e.target.value)}>
                    <option value="">No deposit</option>
                    {Array.from({ length: 99 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={String(n)}>{n}%</option>
                    ))}
                  </select>
                </div>
                {priceBreakdown}
              </div>
            )}
            {err && <div style={{ color: '#ff6b6b', fontSize: '.82rem', marginTop: 6 }}>{err}</div>}
            {changed.some((f) => f.tier === 'notify') && (
              <div style={{ fontSize: '.76rem', color: '#fff', marginTop: 8 }}>Host will be notified of the change.</div>
            )}
            {hasApprove && changed.length > 0 && (
              <div style={{ fontSize: '.76rem', color: '#fff', marginTop: 8 }}>When you click Save Changes, the host is emailed to approve the change — changed field shows as &ldquo;Pending Host Approval&rdquo; until approved.</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button style={btnGhost} disabled={busy} onClick={onClose}>Cancel</button>
              <button style={{ ...btnPrimary, opacity: (busy || (changed.length === 0 && !pricingDirty)) ? 0.5 : 1 }} disabled={busy || (changed.length === 0 && !pricingDirty)} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
