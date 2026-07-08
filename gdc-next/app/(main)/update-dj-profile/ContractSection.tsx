'use client';

// ContractSection — the DJ uploads their own contract (PDF or Word) with tags
// in it. On upload we create a DocuSeal template (server route) and store its
// id. Shows the current contract, a re-upload option, and the copy-paste tag
// list so the DJ knows what to put in their document.
//
// One contract per DJ for now. Mounted in booking-settings.

import { useEffect, useRef, useState } from 'react';
import styles from './updateDjProfile.module.css';
import { createClient } from '@/lib/supabase/client';

const DATA_TAGS: { tag: string; label: string }[] = [
  { tag: '{{client_name}}', label: 'Client name' },
  { tag: '{{dj_name}}', label: 'Your (DJ) name' },
  { tag: '{{event_date}}', label: 'Event date' },
  { tag: '{{event_type}}', label: 'Event type' },
  { tag: '{{venue_name}}', label: 'Venue name' },
  { tag: '{{event_address}}', label: 'Event address' },
  { tag: '{{start_time}}', label: 'Start time' },
  { tag: '{{end_time}}', label: 'End time' },
  { tag: '{{package}}', label: 'Package' },
  { tag: '{{price}}', label: 'Agreed price' },
  { tag: '{{deposit}}', label: 'Deposit' },
];

const SIG_DJ = '{{Signature;role=DJ;type=signature}}';
const SIG_CLIENT = '{{Signature;role=Client;type=signature}}';

export default function ContractSection() {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTags, setShowTags] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/contracts/upload-template', { method: 'POST', body: fd });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; templateId?: string; fileName?: string; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || 'Upload failed.');
      setTemplateId(json.templateId || null);
      setFileName(json.fileName || file.name);
      setUploadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    try { navigator.clipboard?.writeText(text); } catch { /* ignore */ }
  }

  const tagRow = (tag: string, label: string) => (
    <div key={tag} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', padding: '.35rem 0' }}>
      <span style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.8rem', minWidth: 120 }}>{label}</span>
      <code style={{ flex: 1, color: 'var(--white,#fff)', fontSize: '.78rem', fontFamily: 'monospace', overflowX: 'auto' }}>{tag}</code>
      <button type="button" onClick={() => copy(tag)} style={{ background: 'transparent', border: '1px solid var(--border,rgba(255,255,255,.25))', color: 'var(--neon,#00e0a4)', borderRadius: 5, padding: '.25rem .6rem', fontSize: '.72rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>Copy</button>
    </div>
  );

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Contract</div>
      </div>
      <div className={`${styles.sectionBody} ${styles.settingsBody}`}>
        <div className={styles.settingHint} style={{ marginBottom: '1rem' }}>
          Upload your own booking contract. <strong>PDF or Word</strong> lets you use the
          tags below to auto-fill event details. A <strong>photo (JPG/PNG)</strong> works
          too, but it&rsquo;s sign-only — no auto-filled details.
        </div>

        {loading ? (
          <div className={styles.settingHint}>Loading…</div>
        ) : templateId ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', padding: '.75rem .9rem', border: '1px solid var(--border,rgba(255,255,255,.15))', borderRadius: 8, marginBottom: '1rem' }}>
            <div>
              <div style={{ color: 'var(--white,#fff)', fontWeight: 600 }}>{fileName || 'Your contract'}</div>
              <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.78rem' }}>
                Uploaded{uploadedAt ? ` ${new Date(uploadedAt).toLocaleDateString()}` : ''} · Ready to use
              </div>
            </div>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} style={{ background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', borderRadius: 6, padding: '.5rem 1rem', cursor: busy ? 'wait' : 'pointer', fontSize: '.8rem' }}>
              {busy ? 'Uploading…' : 'Replace'}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} style={{ width: '100%', background: 'rgba(0,245,196,.05)', border: '2px dashed var(--neon,#00e0a4)', borderRadius: 8, color: 'var(--neon,#00e0a4)', cursor: busy ? 'wait' : 'pointer', padding: '1.5rem', fontFamily: "'Space Mono', monospace", fontSize: '.85rem', letterSpacing: '.04em', marginBottom: '1rem' }}>
            {busy ? 'Uploading…' : '+ Upload your contract (PDF, Word, or photo)'}
          </button>
        )}

        <input ref={inputRef} type="file" accept=".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png" style={{ display: 'none' }} onChange={onFile} />

        {error && <div style={{ color: '#ff6b6b', fontSize: '.82rem', marginBottom: '.75rem' }}>{error}</div>}

        <button type="button" onClick={() => setShowTags((v) => !v)} style={{ background: 'transparent', border: 'none', color: 'var(--neon,#00e0a4)', cursor: 'pointer', fontSize: '.82rem', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          Tags to put in your contract <span style={{ fontSize: '.7rem' }}>{showTags ? '▲' : '▼'}</span>
        </button>

        {showTags && (
          <div style={{ marginTop: '.85rem', borderTop: '1px solid var(--border,rgba(255,255,255,.1))', paddingTop: '.85rem' }}>
            <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.78rem', marginBottom: '.5rem' }}>
              Event details (auto-filled per booking) — use any you want:
            </div>
            {DATA_TAGS.map((t) => tagRow(t.tag, t.label))}
            <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.78rem', margin: '.85rem 0 .5rem' }}>
              Signature blocks (required) — paste exactly where each party signs:
            </div>
            {tagRow(SIG_DJ, 'Your signature')}
            {tagRow(SIG_CLIENT, 'Client signature')}
          </div>
        )}
      </div>
    </div>
  );
}
