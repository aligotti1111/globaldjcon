'use client';

// ContractPortal — one button ("Open Contract Portal") opens a modal holding
// the DJ's contract library. They upload a contract (it sits as a card, named
// from the filename), rename inline, and click a card to place the auto-fill
// fields via the embedded DocuSeal builder. The standard contract is always
// present and can be customized but not deleted.

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import { defaultContractText } from '@/lib/contractText';

const DocusealBuilder = dynamic(
  () => import('@docuseal/react').then((m) => m.DocusealBuilder),
  { ssr: false, loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Loading builder…</div> },
);

const BUILDER_FIELDS = [
  { name: 'client_name', type: 'text', role: 'DJ', title: 'Client name' },
  { name: 'dj_name', type: 'text', role: 'DJ', title: 'Company / DJ name' },
  { name: 'event_date', type: 'text', role: 'DJ', title: 'Event date' },
  { name: 'event_type', type: 'text', role: 'DJ', title: 'Event type' },
  { name: 'venue_name', type: 'text', role: 'DJ', title: 'Venue name' },
  { name: 'event_address', type: 'text', role: 'DJ', title: 'Event address' },
  { name: 'start_time', type: 'text', role: 'DJ', title: 'Start time' },
  { name: 'end_time', type: 'text', role: 'DJ', title: 'End time' },
  { name: 'package', type: 'text', role: 'DJ', title: 'Package (name + details)', only: 'mobile' },
  { name: 'set_type', type: 'text', role: 'DJ', title: 'Set type', only: 'club' },
  { name: 'equipment', type: 'text', role: 'DJ', title: 'Equipment', only: 'club' },
  { name: 'duration', type: 'text', role: 'DJ', title: 'Duration (hours)' },
  { name: 'overtime_rate', type: 'text', role: 'DJ', title: 'Overtime rate', only: 'mobile' },
  { name: 'price', type: 'text', role: 'DJ', title: 'Price' },
  { name: 'deposit', type: 'text', role: 'DJ', title: 'Deposit' },
  { name: 'DJ Signature', type: 'signature', role: 'DJ', title: 'Your signature' },
  { name: 'Client Signature', type: 'signature', role: 'Client', title: 'Client signature' },
];

interface Contract {
  id: string;
  name: string;
  docuseal_template_id: string | null;
  is_standard: boolean;
  updated_at?: string;
}
type View = 'grid' | 'builder' | 'standard';

export default function ContractPortal({
  userId, djType,
}: { userId: string; djType?: string | null }) {
  const builderFields = BUILDER_FIELDS.filter((f) => !('only' in f) || (f as { only?: string }).only === djType);
  const [open, setOpen] = useState(false);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('grid');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [builderToken, setBuilderToken] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingStd, setSavingStd] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('contracts')
        .select('id, name, docuseal_template_id, is_standard, updated_at')
        .eq('dj_id', userId)
        .order('is_standard', { ascending: true })
        .order('updated_at', { ascending: false });
      setContracts((data as Contract[]) || []);
    } catch { /* ignore */ }
    setLoading(false);
  }
  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, userId]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setError(null); setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/contracts/upload-template', { method: 'POST', body: fd });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; contractId?: string; templateId?: string; name?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || 'Upload failed.');
      await load();
      // Take them straight into the new contract to place the fields.
      if (json.contractId) {
        openCard({ id: json.contractId, name: json.name || 'Contract', docuseal_template_id: json.templateId || null, is_standard: false });
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
    finally { setUploading(false); }
  }

  async function openCard(c: Contract) {
    setEditingId(c.id); setName(c.name); setError(null);
    if (c.is_standard) { setText(defaultContractText(djType)); setView('standard'); return; }
    setView('builder'); setBuilderToken(null);
    try {
      const res = await fetch('/api/contracts/builder-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: c.id, name: c.name }),
      });
      const json = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !json.token) throw new Error(json.error || 'Could not open the builder.');
      setBuilderToken(json.token);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not open the builder.'); }
  }
  async function handleBuilderSave(data: { id?: number | string }) {
    const id = data?.id; if (id == null) return;
    try {
      await fetch('/api/contracts/save-template', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: String(id), name, contractId: editingId }),
      });
      await load();
    } catch { /* template exists regardless */ }
  }

  async function saveStandard() {
    if (!text.trim()) { setError('Contract text is empty.'); return; }
    setError(null); setSavingStd(true);
    try {
      const res = await fetch('/api/contracts/standard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, name: name || 'Standard contract', contractId: editingId }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not save.');
      await load(); setView('grid');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setSavingStd(false); }
  }

  async function commitRename(c: Contract) {
    const newName = renameVal.trim();
    setRenaming(null);
    if (!newName || newName === c.name) return;
    setContracts((cs) => cs.map((x) => x.id === c.id ? { ...x, name: newName } : x));
    try {
      const supabase = createClient();
      await supabase.from('contracts').update({ name: newName } as never).eq('id', c.id).eq('dj_id', userId);
    } catch { /* optimistic */ }
  }

  async function deleteContract(c: Contract) {
    if (!confirm(`Delete "${c.name}"? Contracts already sent or signed with it stay intact on those bookings.`)) return;
    try {
      const supabase = createClient();
      await supabase.from('contracts').delete().eq('id', c.id).eq('dj_id', userId);
      await load();
    } catch { /* ignore */ }
  }

  // ---------- UI ----------
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 8, padding: '.75rem 1.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
        Open Contract Portal
      </button>
    );
  }

  const closePortal = () => { setOpen(false); setView('grid'); setError(null); };
  const cardBase: React.CSSProperties = {
    border: '1px solid var(--border,rgba(255,255,255,.15))', borderRadius: 10, padding: '1rem',
    minHeight: 120, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    background: 'var(--bg-elev,rgba(255,255,255,.03))',
  };

  const wrap = (inner: React.ReactNode, white = false, title = 'Contract Portal') => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={(e) => { if (e.target === e.currentTarget) { view === 'grid' ? closePortal() : setView('grid'); } }}>
      <div style={{ background: white ? '#fff' : 'var(--bg-card,#14141f)', border: white ? 'none' : '1px solid var(--border,rgba(255,255,255,.12))', borderRadius: 12, width: '100%', maxWidth: white ? 1000 : 780, height: white ? '90vh' : undefined, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.75rem 1rem', borderBottom: white ? '1px solid #eee' : '1px solid var(--border,rgba(255,255,255,.12))' }}>
          <strong style={{ color: white ? '#111' : 'var(--white,#fff)' }}>{title}</strong>
          <button type="button" onClick={() => view === 'grid' ? closePortal() : setView('grid')} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: white ? '#666' : 'var(--muted,#888)' }}>✕</button>
        </div>
        {inner}
      </div>
    </div>
  );

  if (view === 'builder') {
    return wrap(
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <div style={{ padding: '.85rem 1rem', borderBottom: '1px solid #eee', background: '#fff' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contract name"
            style={{ width: '100%', boxSizing: 'border-box', padding: '.55rem .75rem', borderRadius: 6, border: '1px solid #ccc', color: '#111', fontSize: '.95rem', fontWeight: 600 }} />
          <div style={{ color: '#777', fontSize: '.75rem', marginTop: 6 }}>Drag the auto-fill fields (client name, date, price, signatures…) onto your contract, then Done.</div>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {error ? <div style={{ padding: '2rem', color: '#c00' }}>{error}</div>
            : builderToken ? <DocusealBuilder token={builderToken} roles={['DJ', 'Client']} fields={builderFields} fieldTypes={['text', 'signature', 'date', 'initials', 'checkbox', 'number']} withSendButton={false} withRecipientsButton={false} withTitle={false} onSave={handleBuilderSave} />
            : <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Opening builder…</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '.6rem 1rem', borderTop: '1px solid #eee' }}>
          <button type="button" onClick={async () => { const supabase = createClient(); try { if (editingId) await supabase.from('contracts').update({ name } as never).eq('id', editingId).eq('dj_id', userId); } catch {} setView('grid'); }} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: 'pointer' }}>Done</button>
        </div>
      </div>, true, 'Add fields',
    );
  }

  if (view === 'standard') {
    return wrap(
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <div style={{ padding: '1.1rem 1.4rem', overflow: 'auto' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contract name" style={{ width: '100%', boxSizing: 'border-box', padding: '.55rem .75rem', borderRadius: 6, border: '1px solid var(--border,rgba(255,255,255,.25))', background: 'transparent', color: 'var(--white,#fff)', marginBottom: '1rem', fontWeight: 600 }} />
          <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.8rem', marginBottom: '1rem' }}>Customize the wording. Keep the {'{{tags}}'} — they auto-fill booking details. Have a lawyer review before use.</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} style={{ width: '100%', boxSizing: 'border-box', padding: '.75rem .85rem', borderRadius: 8, border: '1px solid var(--border,rgba(255,255,255,.2))', background: 'transparent', color: 'var(--white,#fff)', resize: 'vertical', lineHeight: 1.5, fontSize: '.85rem', minHeight: 300 }} />
          {error && <div style={{ color: '#ff6b6b', fontSize: '.82rem', marginTop: '.6rem' }}>{error}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.6rem 1rem', borderTop: '1px solid var(--border,rgba(255,255,255,.12))' }}>
          <button type="button" onClick={() => setView('grid')} style={{ background: 'transparent', border: '1px solid var(--border,rgba(255,255,255,.25))', color: 'var(--white,#fff)', borderRadius: 6, padding: '.55rem 1.2rem', cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={saveStandard} disabled={savingStd} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: savingStd ? 'wait' : 'pointer' }}>{savingStd ? 'Saving…' : 'Save contract'}</button>
        </div>
      </div>, false, 'Customize contract',
    );
  }

  // grid
  return wrap(
    <div style={{ padding: '1.25rem', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.85rem' }}>Your contracts. Upload one to add it, click a card to place fields, or customize the standard.</div>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 8, padding: '.6rem 1.1rem', cursor: uploading ? 'wait' : 'pointer', fontSize: '.85rem' }}>{uploading ? 'Uploading…' : '+ Upload contract'}</button>
        <input ref={fileInput} type="file" accept=".pdf,.docx,image/*" style={{ display: 'none' }} onChange={onFile} />
      </div>
      {error && <div style={{ color: '#ff6b6b', fontSize: '.82rem', marginBottom: '.8rem' }}>{error}</div>}
      {loading ? <div style={{ color: 'var(--muted,#8a8aa0)' }}>Loading…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '.85rem' }}>
          {contracts.map((c) => (
            <div key={c.id} style={cardBase}>
              <div>
                <div style={{ fontSize: 22 }}>📄</div>
                {renaming === c.id ? (
                  <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onBlur={() => commitRename(c)} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(c); }} onClick={(e) => e.stopPropagation()} style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '.3rem .4rem', borderRadius: 4, border: '1px solid var(--neon,#00e0a4)', background: 'transparent', color: 'var(--white,#fff)', fontWeight: 700 }} />
                ) : (
                  <div style={{ color: 'var(--white,#fff)', fontWeight: 700, marginTop: 6, wordBreak: 'break-word', cursor: 'text' }} onClick={() => { setRenaming(c.id); setRenameVal(c.name); }}>{c.name} ✎</div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                <button type="button" onClick={() => openCard(c)} style={{ width: '100%', background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.5rem', cursor: 'pointer', fontSize: '.8rem' }}>
                  {c.is_standard ? 'Open / Customize' : 'Open / Automate Fields'}
                </button>
                {!c.is_standard && (
                  <button type="button" onClick={() => deleteContract(c)} style={{ background: 'transparent', border: 'none', color: '#ff7676', cursor: 'pointer', fontSize: '.75rem' }}>Delete</button>
                )}
              </div>
            </div>
          ))}
          <div style={{ ...cardBase, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', cursor: uploading ? 'wait' : 'pointer' }} onClick={() => !uploading && fileInput.current?.click()}>
            <div style={{ textAlign: 'center', color: 'var(--neon,#00e0a4)' }}>
              <div style={{ fontSize: 30, lineHeight: 1 }}>+</div>
              <div style={{ fontSize: '.8rem', marginTop: 6 }}>Upload contract</div>
            </div>
          </div>
        </div>
      )}
    </div>,
  );
}
