'use client';

// ContractSection — the DJ sets up their booking contract two ways:
//   1. "Use standard contract" — an editable, pre-written agreement they can
//      tweak, with an optional logo. Easiest path.
//   2. "Set up your own" — the embedded DocuSeal builder (upload + drag fields).
// The builder also offers a "switch to standard contract" escape hatch.

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import styles from './updateDjProfile.module.css';
import { createClient } from '@/lib/supabase/client';

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

// Editable standard contract (mirrors lib/docuseal STANDARD_CONTRACT_TEXT).
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

interface SaveData { id?: number | string }
type Mode = 'none' | 'builder' | 'standard';

export default function ContractSection({ userId }: { userId: string }) {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('none');

  // Builder state
  const [token, setToken] = useState<string | null>(null);
  const [tokenErr, setTokenErr] = useState<string | null>(null);

  // Standard-contract editor state
  const [text, setText] = useState(STANDARD_TEXT);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stdErr, setStdErr] = useState<string | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('users')
        .select('docuseal_template_id, contract_file_name, contract_uploaded_at, contract_logo_url')
        .eq('id', userId)
        .maybeSingle();
      if (!mounted) return;
      const row = data as { docuseal_template_id?: string | null; contract_file_name?: string | null; contract_uploaded_at?: string | null; contract_logo_url?: string | null } | null;
      setTemplateId(row?.docuseal_template_id || null);
      setFileName(row?.contract_file_name || null);
      setUploadedAt(row?.contract_uploaded_at || null);
      setLogoUrl(row?.contract_logo_url || null);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [userId]);

  // ---- Builder ----
  async function openBuilder() {
    setTokenErr(null); setToken(null); setMode('builder');
    try {
      const res = await fetch('/api/contracts/builder-token', { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !json.token) throw new Error(json.error || 'Could not open the builder.');
      setToken(json.token);
    } catch (e) {
      setTokenErr(e instanceof Error ? e.message : 'Could not open the builder.');
    }
  }
  async function handleBuilderSave(data: SaveData) {
    const id = data?.id;
    if (id == null) return;
    try {
      await fetch('/api/contracts/save-template', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: String(id) }),
      });
      setTemplateId(String(id)); setUploadedAt(new Date().toISOString());
      if (!fileName) setFileName('Your contract');
    } catch { /* template exists in DocuSeal regardless */ }
  }

  // ---- Standard editor ----
  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setStdErr('Logo must be an image.'); return; }
    if (file.size > 4 * 1024 * 1024) { setStdErr('Logo is too large (max 4MB).'); return; }
    setStdErr(null); setLogoBusy(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${userId}/contract_logo_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      setLogoUrl(`${data.publicUrl}?t=${Date.now()}`);
    } catch (err) {
      setStdErr(err instanceof Error ? err.message : 'Logo upload failed.');
    } finally { setLogoBusy(false); }
  }

  async function saveStandard() {
    if (!text.trim()) { setStdErr('Contract text is empty.'); return; }
    setStdErr(null); setSaving(true);
    try {
      const res = await fetch('/api/contracts/standard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, logoUrl }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; templateId?: string; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not save.');
      setTemplateId(json.templateId || null);
      setFileName('Standard contract');
      setUploadedAt(new Date().toISOString());
      setMode('none');
    } catch (e) {
      setStdErr(e instanceof Error ? e.message : 'Could not save.');
    } finally { setSaving(false); }
  }


  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Contract</div>
      </div>
      <div className={`${styles.sectionBody} ${styles.settingsBody}`}>
        <div className={styles.settingHint} style={{ marginBottom: '1rem' }}>
          Set up the contract clients sign when they book you. Start from our
          editable standard agreement, or build/upload your own. When a booking is
          approved, the details fill in for you to review and send.
        </div>

        {loading ? (
          <div className={styles.settingHint}>Loading…</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', padding: '.75rem .9rem', border: '1px solid var(--border,rgba(255,255,255,.15))', borderRadius: 8, marginBottom: '1rem' }}>
              <div>
                <div style={{ color: 'var(--white,#fff)', fontWeight: 600 }}>
                  {templateId ? (fileName || 'Your contract') : 'No contract set up yet'}
                </div>
                <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.78rem' }}>
                  {templateId
                    ? `Ready to use${uploadedAt ? ` · Updated ${new Date(uploadedAt).toLocaleDateString()}` : ''}`
                    : 'Choose an option below to get started.'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => { setStdErr(null); setMode('standard'); }} style={{ flex: '1 1 200px', background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 8, padding: '.85rem 1rem', cursor: 'pointer', fontSize: '.85rem' }}>
                {templateId ? 'Edit standard contract' : 'Use standard contract'}
              </button>
              <button type="button" onClick={openBuilder} style={{ flex: '1 1 200px', background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 8, padding: '.85rem 1rem', cursor: 'pointer', fontSize: '.85rem' }}>
                Set up your own
              </button>
            </div>
          </>
        )}

        {/* ---------- Shared modal shell (identical box for both modes) ---------- */}
        {mode !== 'none' && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={(e) => { if (e.target === e.currentTarget) setMode('none'); }}>
            <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 1000, height: '90vh', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
              {/* Header — same for both */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.75rem 1rem', borderBottom: '1px solid #eee' }}>
                <strong style={{ color: '#111' }}>Set up your contract</strong>
                <button type="button" onClick={() => setMode('none')} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: '#666' }}>✕</button>
              </div>

              {/* Body */}
              <div style={{ flex: 1, overflow: 'auto' }}>
                {mode === 'standard' ? (
                  <div style={{ padding: '1.25rem 1.4rem' }}>
                    <div style={{ color: '#555', fontSize: '.82rem', marginBottom: '1rem' }}>
                      Edit the wording to fit how you work. Keep the {'{{tags}}'} — they
                      fill in each booking&rsquo;s details automatically. Have a lawyer review before use.
                    </div>

                    {/* Logo */}
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

                    {stdErr && <div style={{ color: '#d33', fontSize: '.82rem', marginTop: '.6rem' }}>{stdErr}</div>}
                  </div>
                ) : tokenErr ? (
                  <div style={{ padding: '2rem', color: '#c00' }}>{tokenErr}</div>
                ) : token ? (
                  <DocusealBuilder token={token} roles={['DJ', 'Client']} fields={BUILDER_FIELDS} withSendButton={false} withTitle={false} onSave={handleBuilderSave} />
                ) : (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Opening builder…</div>
                )}
              </div>

              {/* Footer — same frame, buttons swap by mode */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.6rem 1rem', borderTop: '1px solid #eee' }}>
                {mode === 'standard' ? (
                  <button type="button" onClick={openBuilder} style={{ background: 'transparent', border: 'none', color: '#0a7', cursor: 'pointer', fontSize: '.82rem', textDecoration: 'underline' }}>
                    Prefer to build your own instead?
                  </button>
                ) : (
                  <button type="button" onClick={() => { setMode('standard'); setStdErr(null); }} style={{ background: 'transparent', border: 'none', color: '#0a7', cursor: 'pointer', fontSize: '.82rem', textDecoration: 'underline' }}>
                    Having trouble? Use our standard contract instead
                  </button>
                )}
                {mode === 'standard' ? (
                  <button type="button" onClick={saveStandard} disabled={saving} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Saving…' : 'Save contract'}</button>
                ) : (
                  <button type="button" onClick={() => setMode('none')} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: 'pointer' }}>Done</button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
