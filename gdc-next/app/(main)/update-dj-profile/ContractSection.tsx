'use client';

// ContractSection — the DJ sets up their booking contract using the embedded
// DocuSeal builder: upload the document AND place fields (client name, event
// date, price, signatures) visually, all inside the site. No tags to type.
// On save we store the resulting template id.
//
// Predefined draggable fields carry the exact names we pre-fill per booking
// (client_name, event_date, ...) plus DJ + Client signature blocks.

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import styles from './updateDjProfile.module.css';
import { createClient } from '@/lib/supabase/client';

// DocusealBuilder must load client-side only.
const DocusealBuilder = dynamic(
  () => import('@docuseal/react').then((m) => m.DocusealBuilder),
  { ssr: false, loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted,#8a8aa0)' }}>Loading builder…</div> },
);

// Fields the DJ can drag onto their contract. Data fields are pre-filled per
// booking (role DJ, read-only at signing); signatures are collected.
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

interface SaveData { id?: number | string }

export default function ContractSection() {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [tokenErr, setTokenErr] = useState<string | null>(null);
  const savedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (mounted) setLoading(false); return; }
      const { data } = await supabase
        .from('users')
        .select('docuseal_template_id, contract_file_name, contract_uploaded_at')
        .eq('id', user.id)
        .maybeSingle();
      if (!mounted) return;
      const row = data as { docuseal_template_id?: string | null; contract_file_name?: string | null; contract_uploaded_at?: string | null } | null;
      setTemplateId(row?.docuseal_template_id || null);
      setFileName(row?.contract_file_name || null);
      setUploadedAt(row?.contract_uploaded_at || null);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  async function openBuilder() {
    setTokenErr(null);
    setToken(null);
    setOpen(true);
    try {
      const res = await fetch('/api/contracts/builder-token', { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !json.token) throw new Error(json.error || 'Could not open the builder.');
      setToken(json.token);
    } catch (e) {
      setTokenErr(e instanceof Error ? e.message : 'Could not open the builder.');
    }
  }

  async function handleSave(data: SaveData) {
    const id = data?.id;
    if (id == null) return;
    savedRef.current = true;
    try {
      await fetch('/api/contracts/save-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: String(id) }),
      });
      setTemplateId(String(id));
      setUploadedAt(new Date().toISOString());
      if (!fileName) setFileName('Your contract');
    } catch {
      // Best-effort; the template exists in DocuSeal regardless.
    }
  }

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Contract</div>
      </div>
      <div className={`${styles.sectionBody} ${styles.settingsBody}`}>
        <div className={styles.settingHint} style={{ marginBottom: '1rem' }}>
          Upload your booking contract and drag the fields where you want them —
          client name, event date, price, and signature lines. When a booking is
          approved, we fill in the details so you can review and send it.
        </div>

        {loading ? (
          <div className={styles.settingHint}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', padding: '.75rem .9rem', border: '1px solid var(--border,rgba(255,255,255,.15))', borderRadius: 8, marginBottom: '1rem' }}>
            <div>
              <div style={{ color: 'var(--white,#fff)', fontWeight: 600 }}>
                {templateId ? (fileName || 'Your contract') : 'No contract set up yet'}
              </div>
              <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.78rem' }}>
                {templateId
                  ? `Ready to use${uploadedAt ? ` · Updated ${new Date(uploadedAt).toLocaleDateString()}` : ''}`
                  : 'Upload and set up your contract to enable booking contracts.'}
              </div>
            </div>
            <button type="button" onClick={openBuilder} style={{ background: templateId ? 'transparent' : 'var(--neon,#00e0a4)', border: '1px solid var(--neon,#00e0a4)', color: templateId ? 'var(--neon,#00e0a4)' : '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.1rem', cursor: 'pointer', fontSize: '.8rem' }}>
              {templateId ? 'Edit contract' : 'Set up contract'}
            </button>
          </div>
        )}

        {open && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
            onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          >
            <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 1000, height: '90vh', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.75rem 1rem', borderBottom: '1px solid #eee' }}>
                <strong style={{ color: '#111' }}>Set up your contract</strong>
                <button type="button" onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: '#666' }}>✕</button>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {tokenErr ? (
                  <div style={{ padding: '2rem', color: '#c00' }}>{tokenErr}</div>
                ) : token ? (
                  <DocusealBuilder
                    token={token}
                    roles={['DJ', 'Client']}
                    fields={BUILDER_FIELDS}
                    withSendButton={false}
                    withTitle={false}
                    onSave={handleSave}
                  />
                ) : (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Opening builder…</div>
                )}
              </div>
              <div style={{ padding: '.6rem 1rem', borderTop: '1px solid #eee', textAlign: 'right' }}>
                <button type="button" onClick={() => setOpen(false)} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.5rem 1.2rem', cursor: 'pointer' }}>Done</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
