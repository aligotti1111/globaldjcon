'use client';

// ContractPortal — the DJ's contract library. Shows their saved contracts as a
// grid of cards (name + date) plus a "+" card to add a new one. Adding a
// contract: name it, then either start from the editable standard text or build
// your own (upload + drag fields). Cards can be edited, renamed, or deleted.
//
// Reused in Booking Settings and (via the same component) the Review & Send
// flow. When `onPick` is provided, clicking a card selects it (picker mode).

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
  { name: 'dj_name', type: 'text', role: 'DJ', title: 'DJ name' },
  { name: 'event_date', type: 'text', role: 'DJ', title: 'Event date' },
  { name: 'event_type', type: 'text', role: 'DJ', title: 'Event type' },
  { name: 'venue_name', type: 'text', role: 'DJ', title: 'Venue name' },
  { name: 'event_address', type: 'text', role: 'DJ', title: 'Event address' },
  { name: 'start_time', type: 'text', role: 'DJ', title: 'Start time' },
  { name: 'end_time', type: 'text', role: 'DJ', title: 'End time' },
  { name: 'package', type: 'text', role: 'DJ', title: 'Package' },
  { name: 'package_details', type: 'text', role: 'DJ', title: 'Package details' },
  { name: 'set_type', type: 'text', role: 'DJ', title: 'Set type' },
  { name: 'equipment', type: 'text', role: 'DJ', title: 'Equipment' },
  { name: 'price', type: 'text', role: 'DJ', title: 'Price' },
  { name: 'deposit', type: 'text', role: 'DJ', title: 'Deposit' },
  { name: 'DJ Signature', type: 'signature', role: 'DJ', title: 'Your signature' },
  { name: 'Client Signature', type: 'signature', role: 'Client', title: 'Client signature' },
];

interface Contract {
  id: string;
  name: string;
  docuseal_template_id: string | null;
  logo_url: string | null;
  is_standard: boolean;
  updated_at?: string;
}
interface SaveData { id?: number | string }
type View = 'grid' | 'choose' | 'standard' | 'builder';

export default function ContractPortal({
  userId, djType, onPick,
}: {
  userId: string;
  djType?: string | null;
  onPick?: (contractId: string) => void;
}) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('grid');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [builderToken, setBuilderToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('contracts')
        .select('id, name, docuseal_template_id, logo_url, is_standard, updated_at')
        .eq('dj_id', userId)
        .order('updated_at', { ascending: false });
      setContracts((data as Contract[]) || []);
    } catch { /* ignore */ }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [userId]);

  function openNew() {
    setEditingId(null); setName(''); setLogoUrl(null); setError(null);
    openBuilder(null, '');
  }
  function openCard(c: Contract) {
    if (onPick) { onPick(c.id); return; }
    // Manage mode: reopen for editing. Standard → text editor; else → builder.
    setEditingId(c.id); setName(c.name); setLogoUrl(c.logo_url); setError(null);
    if (c.is_standard) { setText(defaultContractText(djType)); setView('standard'); }
    else { openBuilder(c.id, c.name); }
  }

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Logo must be an image.'); return; }
    if (file.size > 4 * 1024 * 1024) { setError('Logo too large (max 4MB).'); return; }
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
    if (!name.trim()) { setError('Give your contract a name.'); return; }
    if (!text.trim()) { setError('Contract text is empty.'); return; }
    setError(null); setSaving(true);
    try {
      const res = await fetch('/api/contracts/standard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, logoUrl, name, contractId: editingId }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not save.');
      await load(); setView('grid');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setSaving(false); }
  }

  async function openBuilder(contractId: string | null, cname: string) {
    setError(null); setBuilderToken(null); setEditingId(contractId); setName(cname); setView('builder');
    try {
      const res = await fetch('/api/contracts/builder-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId, name: cname }),
      });
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
        body: JSON.stringify({ templateId: String(id), name: name || 'Your contract', contractId: editingId }),
      });
      await load();
    } catch { /* template exists in DocuSeal regardless */ }
  }

  async function deleteContract(c: Contract) {
    if (!confirm(`Delete "${c.name}"?`)) return;
    try {
      const supabase = createClient();
      await supabase.from('contracts').delete().eq('id', c.id).eq('dj_id', userId);
      await load();
    } catch { /* ignore */ }
  }

  // ---------- Renders ----------
  const cardBase: React.CSSProperties = {
    border: '1px solid var(--border,rgba(255,255,255,.15))', borderRadius: 10,
    padding: '1rem', minHeight: 120, display: 'flex', flexDirection: 'column',
    justifyContent: 'space-between', cursor: 'pointer', background: 'var(--bg-elev,rgba(255,255,255,.03))',
  };

  if (view === 'grid') {
    return (
      <div>
        {loading ? (
          <div style={{ color: 'var(--muted,#8a8aa0)' }}>Loading…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '.85rem' }}>
            {contracts.map((c) => (
              <div key={c.id} style={cardBase} onClick={() => openCard(c)}>
                <div>
                  <div style={{ fontSize: 22 }}>📄</div>
                  <div style={{ color: 'var(--white,#fff)', fontWeight: 700, marginTop: 6, wordBreak: 'break-word' }}>{c.name}</div>
                  <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.72rem', marginTop: 2 }}>
                    {c.is_standard ? 'Standard' : 'Custom'}{c.updated_at ? ` · ${new Date(c.updated_at).toLocaleDateString()}` : ''}
                  </div>
                </div>
                {!onPick && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); deleteContract(c); }} style={{ alignSelf: 'flex-end', background: 'transparent', border: 'none', color: '#ff7676', cursor: 'pointer', fontSize: '.75rem' }}>Delete</button>
                )}
              </div>
            ))}
            {/* + card */}
            <div style={{ ...cardBase, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' }} onClick={openNew}>
              <div style={{ textAlign: 'center', color: 'var(--neon,#00e0a4)' }}>
                <div style={{ fontSize: 30, lineHeight: 1 }}>+</div>
                <div style={{ fontSize: '.8rem', marginTop: 6 }}>New contract</div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Overlay modal for create/edit steps
  const overlay = (title: string, bodyNode: React.ReactNode, footerNode: React.ReactNode, white = false) => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={(e) => { if (e.target === e.currentTarget) setView('grid'); }}>
      <div style={{ background: white ? '#fff' : 'var(--bg-card,#14141f)', border: white ? 'none' : '1px solid var(--border,rgba(255,255,255,.12))', borderRadius: 12, width: '100%', maxWidth: white ? 1000 : 760, height: white ? '90vh' : undefined, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.75rem 1rem', borderBottom: white ? '1px solid #eee' : '1px solid var(--border,rgba(255,255,255,.12))' }}>
          <strong style={{ color: white ? '#111' : 'var(--white,#fff)' }}>{title}</strong>
          <button type="button" onClick={() => setView('grid')} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: white ? '#666' : 'var(--muted,#888)' }}>✕</button>
        </div>
        <div style={{ flex: white ? 1 : undefined, overflow: 'auto' }}>{bodyNode}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.6rem 1rem', borderTop: white ? '1px solid #eee' : '1px solid var(--border,rgba(255,255,255,.12))' }}>{footerNode}</div>
      </div>
    </div>
  );

  const nameInput = (dark: boolean) => (
    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contract name (e.g. Wedding Contract)"
      style={{ width: '100%', boxSizing: 'border-box', padding: '.6rem .75rem', borderRadius: 6, border: dark ? '1px solid var(--border,rgba(255,255,255,.25))' : '1px solid #ccc', background: dark ? 'transparent' : '#fff', color: dark ? 'var(--white,#fff)' : '#111', fontFamily: 'DM Sans, sans-serif' }} />
  );

  if (view === 'choose') {
    return overlay('New contract', (
      <div style={{ padding: '1.5rem' }}>
        <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.85rem', marginBottom: '.5rem' }}>Name your contract</div>
        {nameInput(true)}
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginTop: '1.25rem' }}>
          <button type="button" onClick={() => { if (!name.trim()) { setError('Give it a name first.'); return; } setError(null); setText(defaultContractText(djType)); setView('standard'); }} style={{ flex: '1 1 200px', background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 8, padding: '.85rem', cursor: 'pointer' }}>Use standard contract</button>
          <button type="button" onClick={() => { if (!name.trim()) { setError('Give it a name first.'); return; } openBuilder(null, name); }} style={{ flex: '1 1 200px', background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 8, padding: '.85rem', cursor: 'pointer' }}>Upload &amp; build your own</button>
        </div>
        {error && <div style={{ color: '#ff6b6b', fontSize: '.82rem', marginTop: '.8rem' }}>{error}</div>}
      </div>
    ), <><span />{null}</>);
  }

  if (view === 'standard') {
    return overlay(editingId ? 'Edit contract' : 'Standard contract', (
      <div style={{ padding: '1.25rem 1.4rem' }}>
        <div style={{ marginBottom: '1rem' }}>{nameInput(true)}</div>
        <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.8rem', marginBottom: '1rem' }}>
          Edit the wording to fit how you work. Keep the {'{{tags}}'} — they fill in the booking details automatically. Have a lawyer review before use.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo" style={{ maxHeight: 48, maxWidth: 120, borderRadius: 4 }} />
          ) : null}
          <button type="button" onClick={() => logoInput.current?.click()} disabled={logoBusy} style={{ background: 'transparent', border: '1px solid var(--border,rgba(255,255,255,.25))', color: 'var(--neon,#00e0a4)', borderRadius: 6, padding: '.5rem .9rem', cursor: logoBusy ? 'wait' : 'pointer', fontSize: '.8rem' }}>
            {logoBusy ? 'Uploading…' : logoUrl ? 'Change logo' : 'Add your logo (optional)'}
          </button>
          {logoUrl && <button type="button" onClick={() => setLogoUrl(null)} style={{ background: 'transparent', border: 'none', color: '#ff7676', cursor: 'pointer', fontSize: '.8rem' }}>Remove</button>}
          <input ref={logoInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={onLogo} />
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} style={{ width: '100%', boxSizing: 'border-box', padding: '.75rem .85rem', borderRadius: 8, border: '1px solid var(--border,rgba(255,255,255,.2))', background: 'transparent', color: 'var(--white,#fff)', resize: 'vertical', lineHeight: 1.5, fontSize: '.85rem', minHeight: 300 }} />
        {error && <div style={{ color: '#ff6b6b', fontSize: '.82rem', marginTop: '.6rem' }}>{error}</div>}
      </div>
    ), (
      <>
        <button type="button" onClick={() => setView('grid')} style={{ background: 'transparent', border: '1px solid var(--border,rgba(255,255,255,.25))', color: 'var(--white,#fff)', borderRadius: 6, padding: '.55rem 1.2rem', cursor: 'pointer' }}>Cancel</button>
        <button type="button" onClick={saveStandard} disabled={saving} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Saving…' : 'Save contract'}</button>
      </>
    ));
  }

  // builder
  return overlay(editingId ? 'Edit contract' : 'New contract', (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '.85rem 1rem', borderBottom: '1px solid #eee', background: '#fff' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this contract (e.g. Wedding Contract)"
          style={{ width: '100%', boxSizing: 'border-box', padding: '.55rem .75rem', borderRadius: 6, border: '1px solid #ccc', color: '#111', fontSize: '.95rem', fontWeight: 600 }} />
        <div style={{ color: '#777', fontSize: '.75rem', marginTop: 6 }}>Upload your contract, then drag the auto-fill fields (client name, date, price, signatures…) onto it. Name it, then Save.</div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {error ? <div style={{ padding: '2rem', color: '#c00' }}>{error}</div>
          : builderToken ? <DocusealBuilder token={builderToken} roles={['DJ', 'Client']} fields={BUILDER_FIELDS} withSendButton={false} withTitle={false} onSave={handleBuilderSave} />
          : <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Opening builder…</div>}
      </div>
    </div>
  ), (
    <>
      <span style={{ color: '#555', fontSize: '.8rem' }}>{name || 'Unnamed contract'}</span>
      <button type="button" onClick={() => setView('grid')} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.2rem', cursor: 'pointer' }}>Done</button>
    </>
  ), true);
}
