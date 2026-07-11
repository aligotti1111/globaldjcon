'use client';

// ContractSendModal — full contract flow for one approved booking, all in one
// place. If the DJ has no contract yet, they set one up right here (standard
// editable agreement or the visual builder); then it prepares the contract
// pre-filled with the booking details and embeds the DJ's signing form. The
// client is emailed to sign once the DJ finishes.

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';

const DocusealForm = dynamic(
  () => import('@docuseal/react').then((m) => m.DocusealForm),
  { ssr: false, loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Loading…</div> },
);
const DocusealBuilder = dynamic(
  () => import('@docuseal/react').then((m) => m.DocusealBuilder),
  { ssr: false, loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Loading builder…</div> },
);

const BUILDER_FIELDS = [
  { name: 'client_name', type: 'text', role: 'DJ', title: 'Client name' },
  { name: 'dj_name', type: 'text', role: 'DJ', title: 'DJ name' },
  { name: 'event_date', type: 'text', role: 'DJ', title: 'Event date' },
  { name: 'event_type', type: 'text', role: 'DJ', title: 'Event type' },
  { name: 'venue_name', type: 'text', role: 'DJ', title: 'Venue name' },
  { name: 'event_address', type: 'text', role: 'DJ', title: 'Event address' },
  { name: 'start_time', type: 'text', role: 'DJ', title: 'Start time' },
  { name: 'end_time', type: 'text', role: 'DJ', title: 'End time' },
  { name: 'package', type: 'text', role: 'DJ', title: 'Package' },
  { name: 'price', type: 'text', role: 'DJ', title: 'Agreed price' },
  { name: 'deposit', type: 'text', role: 'DJ', title: 'Deposit' },
  { name: 'DJ Signature', type: 'signature', role: 'DJ', title: 'Your signature' },
  { name: 'Client Signature', type: 'signature', role: 'Client', title: 'Client signature' },
];

const STANDARD_TEXT = `DJ SERVICES AGREEMENT

This agreement confirms the booking of {{dj_name}} ("DJ") by {{client_name}} ("Client") for the event detailed below.

EVENT DETAILS
Event: {{event_type}}
Date: {{event_date}}
Time: {{start_time}} - {{end_time}}
Venue: {{venue_name}}, {{event_address}}
Package: {{package}}

PAYMENT
{{payment_terms}}

CANCELLATION
The deposit, if any, is non-refundable, as it reserves the date exclusively for the Client. Cancellations made within 14 days of the event remain subject to the full balance. Should the DJ be unable to perform due to circumstances beyond their control, the DJ will arrange a suitable replacement or refund payments made, up to the amount paid.

CLIENT RESPONSIBILITIES
The Client will provide access to the venue for setup, along with adequate power and space for the DJ's equipment. The Client is responsible for communicating any venue rules, sound limits, or curfews in advance.

OVERTIME
Performance beyond the scheduled end time may be arranged on the day at the DJ's overtime rate, subject to venue approval.

EQUIPMENT
All equipment provided remains the property of the DJ. The Client is responsible for damage caused by guests to the DJ's equipment.

CIRCUMSTANCES BEYOND CONTROL
Neither party is liable for failure to perform due to events beyond reasonable control, such as illness, severe weather, venue closure, or power failure. In such cases, both parties will work in good faith toward a fair resolution or rescheduled date.

AGREEMENT
This document reflects the full agreement between both parties. Any changes will be made in writing and agreed by both. The DJ's total liability under this agreement is limited to the total fee paid.

SIGNATURES

DJ: {{dj_signature}}   {{dj_name}}

Client: {{client_signature}}   {{client_name}}`;

type Phase = 'loading' | 'need_setup' | 'setup_standard' | 'setup_builder' | 'need_email' | 'signing' | 'signed' | 'error';
interface SaveData { id?: number | string }

export default function ContractSendModal({
  bookingId,
  userId,
  contractId,
  onClose,
  onSent,
}: {
  bookingId: string;
  userId: string;
  contractId?: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [embedSrc, setEmbedSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Setup state
  const [text, setText] = useState(STANDARD_TEXT);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [builderToken, setBuilderToken] = useState<string | null>(null);
  const [clientEmail, setClientEmail] = useState('');
  const logoInput = useRef<HTMLInputElement>(null);

  async function prepare(afterSave = false, emailOverride?: string) {
    setPhase('loading'); setError(null);
    try {
      const res = await fetch('/api/contracts/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, contractId: contractId || undefined, clientEmail: emailOverride || undefined }),
      });
      const raw = await res.text();
      let json: { ok?: boolean; embedSrc?: string; error?: string } = {};
      try { json = JSON.parse(raw); } catch { /* non-JSON response */ }
      if (res.status === 400 && json.error === 'NO_CLIENT_EMAIL') { setPhase('need_email'); return; }
      if (res.status === 400 && /set up your contract/i.test(json.error || '')) {
        if (afterSave) {
          setError('Your contract saved, but this booking couldn\u2019t load it. Try again in a moment.');
          setPhase('error');
        } else {
          setPhase('need_setup');
        }
        return;
      }
      if (!res.ok || !json.ok || !json.embedSrc) {
        throw new Error(json.error || `HTTP ${res.status}: ${raw.slice(0, 300) || '(empty response)'}`);
      }
      setEmbedSrc(json.embedSrc); setPhase('signing');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare the contract.'); setPhase('error');
    }
  }

  useEffect(() => { prepare(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bookingId]);

  async function handleSignComplete() {
    // The DJ has signed. Only NOW do we email the client their copy to sign
    // (the client was created with no email so nothing went out before this).
    try {
      await fetch('/api/contracts/send-client', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      });
    } catch { /* the send-client route also updates status; best-effort */ }
    setPhase('signed');
    onSent();
  }

  // --- Setup: standard ---
  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Logo must be an image.'); return; }
    if (file.size > 4 * 1024 * 1024) { setError('Logo is too large (max 4MB).'); return; }
    setError(null); setLogoBusy(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${userId}/contract_logo_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      setLogoUrl(`${data.publicUrl}?t=${Date.now()}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Logo upload failed.'); }
    finally { setLogoBusy(false); }
  }

  async function saveStandard() {
    if (!text.trim()) { setError('Contract text is empty.'); return; }
    setError(null); setSaving(true);
    try {
      const res = await fetch('/api/contracts/standard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, logoUrl }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; templateId?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not save.');
      // Small delay to let the template write settle, then prepare + sign.
      await new Promise((r) => setTimeout(r, 600));
      await prepare(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setSaving(false); }
  }

  // --- Setup: builder ---
  async function openBuilder() {
    setError(null); setBuilderToken(null); setPhase('setup_builder');
    try {
      const res = await fetch('/api/contracts/builder-token', { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !json.token) throw new Error(json.error || 'Could not open the builder.');
      setBuilderToken(json.token);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the builder.'); }
  }
  async function handleBuilderSave(data: SaveData) {
    const id = data?.id; if (id == null) return;
    try {
      await fetch('/api/contracts/save-template', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: String(id) }),
      });
    } catch { /* exists in DocuSeal regardless */ }
  }

  const shell = (title: string, body: React.ReactNode, footer: React.ReactNode) => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 1000, height: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.75rem 1rem', borderBottom: '1px solid #eee' }}>
          <strong style={{ color: '#111' }}>{title}</strong>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: '#666' }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>{body}</div>
        <div style={{ padding: '.6rem 1rem', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{footer}</div>
      </div>
    </div>
  );

  const closeBtn = <button type="button" onClick={onClose} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: 'pointer' }}>Close</button>;

  if (phase === 'need_setup') {
    return shell('Set up your contract', (
      <div style={{ padding: '1.5rem' }}>
        <div style={{ color: '#555', marginBottom: '1.25rem' }}>
          You don&rsquo;t have a contract yet. Set one up now — use our editable standard
          agreement, or build your own — then it&rsquo;ll fill in this booking&rsquo;s details.
        </div>
        <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => { setError(null); setPhase('setup_standard'); }} style={{ flex: '1 1 220px', background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 8, padding: '.9rem', cursor: 'pointer' }}>Use standard contract</button>
          <button type="button" onClick={openBuilder} style={{ flex: '1 1 220px', background: '#fff', border: '2px solid var(--neon,#00e0a4)', color: '#0a7', fontWeight: 700, borderRadius: 8, padding: '.9rem', cursor: 'pointer' }}>Build your own</button>
        </div>
        {error && <div style={{ color: '#c00', marginTop: '1rem' }}>{error}</div>}
      </div>
    ), <><span /> {closeBtn}</>);
  }

  if (phase === 'setup_standard') {
    return shell('Set up your contract', (
      <div style={{ padding: '1.25rem 1.4rem' }}>
        <div style={{ color: '#555', fontSize: '.82rem', marginBottom: '1rem' }}>
          Edit the wording to fit how you work. Keep the {'{{tags}}'} — they fill in the
          booking details automatically. Have a lawyer review before use.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo" style={{ maxHeight: 48, maxWidth: 120, borderRadius: 4 }} />
          ) : null}
          <button type="button" onClick={() => logoInput.current?.click()} disabled={logoBusy} style={{ background: 'transparent', border: '1px solid #ccc', color: '#0a7', borderRadius: 6, padding: '.5rem .9rem', cursor: logoBusy ? 'wait' : 'pointer', fontSize: '.8rem' }}>
            {logoBusy ? 'Uploading…' : logoUrl ? 'Change logo' : 'Add your logo (optional)'}
          </button>
          {logoUrl && <button type="button" onClick={() => setLogoUrl(null)} style={{ background: 'transparent', border: 'none', color: '#d33', cursor: 'pointer', fontSize: '.8rem' }}>Remove</button>}
          <input ref={logoInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={onLogo} />
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={18} style={{ width: '100%', boxSizing: 'border-box', padding: '.75rem .85rem', borderRadius: 8, border: '1px solid #ccc', background: '#fff', color: '#111', fontFamily: 'ui-monospace, Menlo, monospace', resize: 'vertical', lineHeight: 1.55, fontSize: '.82rem', minHeight: 340 }} />
        {error && <div style={{ color: '#d33', fontSize: '.82rem', marginTop: '.6rem' }}>{error}</div>}
      </div>
    ), (
      <>
        <button type="button" onClick={openBuilder} style={{ background: 'transparent', border: 'none', color: '#0a7', cursor: 'pointer', fontSize: '.82rem', textDecoration: 'underline' }}>Prefer to build your own?</button>
        <button type="button" onClick={saveStandard} disabled={saving} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Saving…' : 'Save & continue'}</button>
      </>
    ));
  }

  if (phase === 'setup_builder') {
    return shell('Set up your contract', (
      error ? <div style={{ padding: '2rem', color: '#c00' }}>{error}</div>
        : builderToken ? <DocusealBuilder token={builderToken} roles={['DJ', 'Client']} fields={BUILDER_FIELDS} withSendButton={false} withTitle={false} onSave={handleBuilderSave} />
        : <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Opening builder…</div>
    ), (
      <>
        <button type="button" onClick={() => { setError(null); setPhase('setup_standard'); }} style={{ background: 'transparent', border: 'none', color: '#0a7', cursor: 'pointer', fontSize: '.82rem', textDecoration: 'underline' }}>Use our standard contract instead</button>
        <button type="button" onClick={() => prepare()} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: 'pointer' }}>Done — continue</button>
      </>
    ));
  }

  if (phase === 'need_email') {
    return shell('Review & sign contract', (
      <div style={{ padding: '1.5rem', maxWidth: 480 }}>
        <div style={{ color: '#555', marginBottom: '1rem' }}>
          We couldn&rsquo;t find a client email for this booking. Enter the email address
          to send the signed contract to:
        </div>
        <input
          type="email"
          value={clientEmail}
          onChange={(e) => setClientEmail(e.target.value)}
          placeholder="client@example.com"
          style={{ width: '100%', boxSizing: 'border-box', padding: '.65rem .8rem', borderRadius: 8, border: '1px solid #ccc', fontSize: '.9rem', color: '#111' }}
        />
        {error && <div style={{ color: '#d33', fontSize: '.82rem', marginTop: '.6rem' }}>{error}</div>}
      </div>
    ), (
      <>
        <span />
        <button
          type="button"
          onClick={() => {
            const em = clientEmail.trim();
            if (!/.+@.+\..+/.test(em)) { setError('Enter a valid email address.'); return; }
            prepare(false, em);
          }}
          style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: 'pointer' }}
        >Continue</button>
      </>
    ));
  }

  // signing / signed / loading / error
  return shell('Review & send contract', (
    error ? <div style={{ padding: '2rem', color: '#c00' }}>{error}</div>
      : phase === 'signed' ? (
        <div style={{ padding: '3rem 2rem', textAlign: 'center', color: '#111' }}>
          <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>✓</div>
          <div style={{ fontWeight: 700, marginBottom: '.4rem' }}>Contract sent.</div>
          <div style={{ color: '#555' }}>You&rsquo;ve signed and we&rsquo;ve emailed the client to sign. You&rsquo;ll be notified when it&rsquo;s complete.</div>
        </div>
      ) : phase === 'signing' && embedSrc ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ padding: '.7rem 1rem', background: '#f3faf7', borderBottom: '1px solid #e5e7eb', color: '#0a7', fontSize: '.8rem', lineHeight: 1.4 }}>
            Review the contract below and add anything you need, then sign and click <strong>Send contract</strong> at the bottom to email it to your client.
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <DocusealForm
              src={embedSrc}
              onComplete={handleSignComplete}
              withTitle={false}
              allowTypedSignature={true}
              rememberSignature={true}
              i18n={{ submit: 'Send contract', complete: 'Send contract' }}
              customCss={`
                .signature-pad, [class*="signature"] canvas { max-height: 160px !important; }
                .modal-box, [class*="modal"] .signature-pad { max-width: 520px !important; }
                canvas { max-height: 160px !important; }
              `}
            />
          </div>
        </div>
      ) : (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Preparing your contract…</div>
      )
  ), closeBtn);
}
