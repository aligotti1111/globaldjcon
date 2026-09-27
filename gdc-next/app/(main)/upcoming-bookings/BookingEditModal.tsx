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

export default function BookingEditModal({
  section, djType, contractState, values, lockEmail = false, onClose, onSaved,
}: {
  section: EditSection;
  djType: 'club' | 'mobile';
  contractState: ContractState;
  /** Current stored value per field key (strings; date=YYYY-MM-DD, time=HH:MM). */
  values: Record<string, string>;
  /** Account-based booking: the host's email is their login, so it can't be
   *  edited here — hide it from the Host form. */
  lockEmail?: boolean;
  onClose: () => void;
  onSaved: (result: { applied: string[]; pending: { field: string; label: string }[]; field_edits: Record<string, string> }) => void;
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

  const changed = fields.filter((f) => (form[f.key] ?? '') !== (values[f.key] ?? ''));
  const hasApprove = changed.some((f) => f.tier === 'approve');

  async function save() {
    if (changed.length === 0) { onClose(); return; }
    setBusy(true); setErr(null);
    try {
      const changes: Record<string, string> = {};
      changed.forEach((f) => { changes[f.key] = form[f.key] ?? ''; });
      const res = await fetch('/api/bookings/edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: values.__id, changes }),
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
                The host will be notified of anything you change here. Some changes (date, time, address, price, package details) need the host&rsquo;s approval before they take effect. Make sure you&rsquo;re both on the same page.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button style={btnGhost} onClick={onClose}>Cancel</button>
                <button style={btnPrimary} onClick={() => setStep('form')}>Proceed</button>
              </div>
            </>
          ) : (
            <>
              <h3 style={{ margin: '0 0 10px', fontSize: '1rem' }}>Before you make this change</h3>
              <p style={{ color: '#d6d6e0', fontSize: '.9rem', lineHeight: 1.55, margin: '0 0 4px', borderLeft: '3px solid #f5e642', paddingLeft: 12 }}>{LEGAL}</p>
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
                {f.key === 'event_type' ? (
                  <select style={input} value={form[f.key] ?? ''} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}>
                    {MOBILE_EVENT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.key === 'package_details' ? (
                  <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={form[f.key] ?? ''} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} />
                ) : (
                  <input
                    style={input}
                    type={f.kind === 'date' ? 'date' : f.kind === 'time' ? 'time' : f.kind === 'number' ? 'number' : 'text'}
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
            {err && <div style={{ color: '#ff6b6b', fontSize: '.82rem', marginTop: 6 }}>{err}</div>}
            {hasApprove && changed.length > 0 && (
              <div style={{ fontSize: '.76rem', color: '#f5e642', marginTop: 8 }}>When you click Save changes, the host is emailed to approve the date/time/address/price/package-details change — it shows as &ldquo;Pending host approval&rdquo; until they approve. Any other fields apply now.</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button style={btnGhost} disabled={busy} onClick={onClose}>Cancel</button>
              <button style={{ ...btnPrimary, opacity: (busy || changed.length === 0) ? 0.5 : 1 }} disabled={busy || changed.length === 0} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
