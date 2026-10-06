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
  // Pricing is read-only (no edit pencil) — the rate and tax are locked once a
  // booking exists, so this copy never actually shows. Kept to satisfy the type.
  PRICING: 'Pricing is set at booking time and can’t be changed here.',
};

// Time options every 15 minutes — value HH:MM (24h), label 12-hour AM/PM.
const TIME_OPTIONS: { value: string; label: string }[] = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4); const m = (i % 4) * 15;
  const hh = String(h).padStart(2, '0'); const mm = String(m).padStart(2, '0');
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return { value: `${hh}:${mm}`, label: `${h12}:${mm} ${h >= 12 ? 'PM' : 'AM'}` };
});

export default function BookingEditModal({
  section, djType, contractState, values, lockEmail = false, pendingCols, pendingInfo, noHostRecipient = false, onClose, onSaved, onCancelled,
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

  const isPending = (f: EditFieldDef) => f.tier === 'approve' && !!pendingCols?.has(f.col);
  // Locked fields (pending approval) don't count as editable changes.
  const changed = fields.filter((f) => !isPending(f) && (form[f.key] ?? '') !== (values[f.key] ?? ''));
  const hasApprove = changed.some((f) => f.tier === 'approve');

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
    if (changed.length === 0) { onClose(); return; }
    setBusy(true); setErr(null);
    try {
      const changes: Record<string, string> = {};
      changed.forEach((f) => { changes[f.key] = form[f.key] ?? ''; });
      const payload: Record<string, unknown> = { bookingId: values.__id, changes };
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
            {err && <div style={{ color: '#ff6b6b', fontSize: '.82rem', marginTop: 6 }}>{err}</div>}
            {!noHostRecipient && changed.some((f) => f.tier === 'notify') && (
              <div style={{ fontSize: '.76rem', color: '#fff', marginTop: 8 }}>Host will be notified of the change.</div>
            )}
            {!noHostRecipient && hasApprove && changed.length > 0 && (
              <div style={{ fontSize: '.76rem', color: '#fff', marginTop: 8 }}>When you click Submit Change Request, the host is emailed to approve the change — the altered field shows as &ldquo;Pending Host Approval&rdquo; until approved.</div>
            )}
            {(() => {
              // Any dirty change that needs the host's sign-off (an approval-tier
              // field) turns Save into "Submit Change Request". With no host to
              // approve, or notify-only fields, it stays "Save Change".
              const requiresApproval = !noHostRecipient && hasApprove && changed.length > 0;
              const disabled = busy || changed.length === 0;
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
