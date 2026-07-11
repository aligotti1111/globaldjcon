'use client';

// ContractPortal — one button ("Open Contract Portal") opens a modal holding
// the DJ's contract library. They add a contract three ways: upload a file, or
// write/paste their own text, or customize the standard contract. Uploaded and
// pasted-text contracts open the embedded DocuSeal field builder so the DJ can
// place the auto-fill fields. The standard contract is always present and can
// be customized but not deleted.

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
  { name: 'todays_date', type: 'datenow', role: 'DJ', title: 'Today’s date (auto)' },
  { name: 'event_type', type: 'text', role: 'DJ', title: 'Event type', only: 'mobile' },
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
  body_text?: string | null;
  updated_at?: string;
}
type View = 'grid' | 'builder' | 'standard' | 'paste';

export default function ContractPortal({
  userId, djType, bookingId, controlledOpen, onUseContract, onRequestClose,
}: {
  userId: string;
  djType?: string | null;
  // Booking mode: when a bookingId + onUseContract are passed, the portal is
  // opened from a booking so the DJ can pick (or create) a contract to send.
  bookingId?: string;
  controlledOpen?: boolean;
  onUseContract?: (contractId: string) => void;
  onRequestClose?: () => void;
}) {
  const bookingMode = !!bookingId && !!onUseContract;
  const builderFields = BUILDER_FIELDS
    .filter((f) => !('only' in f) || (f as { only?: string }).only === djType)
    // Club/bar DJs don't use a company — label the field just "DJ Name".
    .map((f) => (f.name === 'dj_name' && djType === 'club') ? { ...f, title: 'DJ Name' } : f);
  const [open, setOpen] = useState(false);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('grid');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [builderToken, setBuilderToken] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingStd, setSavingStd] = useState(false);
  const [stdDisclaimer, setStdDisclaimer] = useState(false);
  const [text, setText] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [submittingPaste, setSubmittingPaste] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // Seed the rich-text editor with the contract content when the write/edit
  // screen opens (uncontrolled contenteditable, read back on save).
  useEffect(() => {
    if (view === 'paste' && editorRef.current) {
      editorRef.current.innerHTML = pasteText || '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, editingId]);

  function exec(cmd: string, value?: string) {
    editorRef.current?.focus();
    try { document.execCommand(cmd, false, value); } catch { /* ignore */ }
  }

  async function load() {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('contracts')
        .select('id, name, docuseal_template_id, is_standard, body_text, updated_at')
        .eq('dj_id', userId)
        .order('is_standard', { ascending: true })
        .order('updated_at', { ascending: false });
      setContracts((data as Contract[]) || []);
    } catch { /* ignore */ }
    setLoading(false);
  }
  useEffect(() => { if (open || controlledOpen) load(); /* eslint-disable-next-line */ }, [open, controlledOpen, userId]);

  async function uploadFile(file: File) {
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

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (file) uploadFile(file);
  }

  // Open the blank "write your contract" screen (new contract).
  function openPaste() {
    setError(null); setEditingId(null); setName('My contract'); setPasteText(''); setView('paste');
  }

  // Create a fresh Global DJ Connect standard contract and open it straight on
  // the FIELDS builder (fields auto-placed from the tags). The DJ can hit
  // "Edit text" to change wording; the disclaimer is on the fields page.
  async function openStandardTemplate() {
    setError(null);
    const defText = defaultContractText(djType);
    const nm = 'Global DJ Connect standard contract';
    setName(nm); setText(defText); setStdDisclaimer(false); setEditingId(null);
    setView('builder'); setBuilderToken(null); setSavingStd(true);
    try {
      const res = await fetch('/api/contracts/standard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: defText, name: nm, contractId: null }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; contractId?: string };
      if (!res.ok || !json.ok || !json.contractId) throw new Error(json.error || 'Could not create the standard contract.');
      await load();
      setEditingId(json.contractId);
      const tres = await fetch('/api/contracts/builder-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: json.contractId, name: nm }),
      });
      const tjson = (await tres.json().catch(() => ({}))) as { token?: string; error?: string };
      if (tjson.token) setBuilderToken(tjson.token);
      else setError(tjson.error || 'Could not open the field editor.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the standard contract.'); }
    finally { setSavingStd(false); }
  }

  // Reopen an existing text contract's words so the DJ can edit and re-lock.
  function openTextEditor(c: Contract) {
    setError(null); setEditingId(c.id); setName(c.name); setPasteText(c.body_text || ''); setView('paste');
  }

  // Lock the text in: (re)build the contract from the text, then hand off to the
  // drag builder to place fields. Passes contractId when editing (re-lock).
  async function submitPastedText() {
    const html = editorRef.current?.innerHTML ?? '';
    const plain = (editorRef.current?.textContent ?? '').trim();
    if (!plain) { setError('Contract text is empty.'); return; }
    setError(null); setSubmittingPaste(true);
    try {
      const res = await fetch('/api/contracts/from-text', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: html, name: name || 'My contract', contractId: editingId || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; contractId?: string; templateId?: string; name?: string };
      if (!res.ok || !json.ok || !json.contractId) throw new Error(json.error || 'Could not build the contract.');
      await load();
      openCard({ id: json.contractId, name: json.name || name || 'My contract', docuseal_template_id: json.templateId || null, is_standard: false });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not build the contract.'); }
    finally { setSubmittingPaste(false); }
  }

  async function openCard(c: Contract) {
    setEditingId(c.id); setName(c.name); setError(null);
    // Standard contracts open straight to the fields builder (which has the
    // "Edit text" button + disclaimer); preload wording so Edit text is ready.
    if (c.is_standard) { setText(defaultContractText(djType)); setStdDisclaimer(false); }
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
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; contractId?: string; templateId?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not save.');
      await load();
      // Hand off to the drag builder so the DJ can place/reposition the fields
      // (signatures, auto-fill) on the document, DocuSeal-style.
      const cid = json.contractId || editingId;
      if (cid) {
        setEditingId(cid); setView('builder'); setBuilderToken(null);
        try {
          const tres = await fetch('/api/contracts/builder-token', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contractId: cid, name: name || 'Standard contract' }),
          });
          const tjson = (await tres.json().catch(() => ({}))) as { token?: string; error?: string };
          if (tjson.token) setBuilderToken(tjson.token);
          else setError(tjson.error || 'Could not open the field editor.');
        } catch { setError('Could not open the field editor.'); }
      } else {
        setView('grid');
      }
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
  // In booking mode the portal is opened by the parent (controlledOpen) — no
  // launcher button. Otherwise it shows its own "Open Contract Portal" button.
  if (!controlledOpen && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 8, padding: '.75rem 1.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
        Open Contract Portal
      </button>
    );
  }

  const closePortal = () => {
    if (controlledOpen) { onRequestClose?.(); return; }
    setOpen(false); setView('grid'); setError(null);
  };
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

  if (view === 'paste') {
    const toolBtn: React.CSSProperties = { minWidth: 30, height: 28, border: '1px solid #d1d5db', background: '#fff', borderRadius: 5, cursor: 'pointer', color: '#111', fontSize: '.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 .5rem' };
    const sep = <span style={{ width: 1, height: 20, background: '#e5e7eb', margin: '0 .2rem' }} />;
    return wrap(
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#f3f4f6' }}>
        <div style={{ padding: '.85rem 1rem', borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contract name" style={{ width: '100%', boxSizing: 'border-box', padding: '.55rem .75rem', borderRadius: 6, border: '1px solid #ccc', color: '#111', fontWeight: 600, fontSize: '.95rem' }} />
          <div style={{ color: '#6b7280', fontSize: '.75rem', marginTop: 6 }}>Write or paste your contract and format it with the toolbar. Next you&rsquo;ll drag the fields (client name, date, price, signatures) onto it, then lock it in.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem', flexWrap: 'wrap', padding: '.5rem 1rem', borderBottom: '1px solid #e5e7eb', background: '#fafafa' }}>
          <button type="button" title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} style={{ ...toolBtn, fontWeight: 700 }}>B</button>
          <button type="button" title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} style={{ ...toolBtn, fontStyle: 'italic' }}>I</button>
          <button type="button" title="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')} style={{ ...toolBtn, textDecoration: 'underline' }}>U</button>
          {sep}
          <button type="button" title="Heading" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', 'H2')} style={{ ...toolBtn, fontWeight: 700 }}>H</button>
          <button type="button" title="Normal text" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', 'P')} style={toolBtn}>¶</button>
          {sep}
          <button type="button" title="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} style={toolBtn}>•</button>
          <button type="button" title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')} style={toolBtn}>1.</button>
          {sep}
          <button type="button" title="Align left" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('justifyLeft')} style={toolBtn}>⯇</button>
          <button type="button" title="Center" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('justifyCenter')} style={toolBtn}>≡</button>
          {sep}
          <button type="button" title="Clear formatting" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('removeFormat')} style={toolBtn}>⌫</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '1.5rem', background: '#f3f4f6' }}>
          <div style={{ maxWidth: 720, margin: '0 auto', background: '#fff', boxShadow: '0 1px 5px rgba(0,0,0,.15)', borderRadius: 2 }}>
            <div ref={editorRef} contentEditable suppressContentEditableWarning style={{ minHeight: 620, padding: '3rem', outline: 'none', color: '#111', background: 'transparent', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '.9rem', lineHeight: 1.7 }} />
          </div>
          {error && <div style={{ color: '#c00', fontSize: '.82rem', marginTop: '.6rem', textAlign: 'center' }}>{error}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.6rem 1rem', borderTop: '1px solid #e5e7eb', background: '#fff' }}>
          <button type="button" onClick={() => setView('grid')} style={{ background: 'transparent', border: '1px solid #ccc', color: '#333', borderRadius: 6, padding: '.55rem 1.2rem', cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={submitPastedText} disabled={submittingPaste} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: submittingPaste ? 'wait' : 'pointer' }}>{submittingPaste ? 'Opening…' : 'Next: place fields →'}</button>
        </div>
      </div>, true, editingId ? 'Edit your contract' : 'Write your contract',
    );
  }

  if (view === 'builder') {
    const editingC = contracts.find((c) => c.id === editingId);
    const isStdBuilder = !!editingC?.is_standard;
    return wrap(
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <div style={{ padding: '.85rem 1rem', borderBottom: '1px solid #eee', background: '#fff' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contract name"
            style={{ width: '100%', boxSizing: 'border-box', padding: '.55rem .75rem', borderRadius: 6, border: '1px solid #ccc', color: '#111', fontSize: '.95rem', fontWeight: 600 }} />
          <div style={{ color: '#777', fontSize: '.75rem', marginTop: 6 }}>Fields fill in automatically from the booking. Drag any field to move it, or add ones you need — your fields (name, date, price, your signature) are under <strong>DJ</strong> in the top-right dropdown; the <strong>client&rsquo;s signature</strong> is under <strong>Client</strong>. Then Lock it in.</div>
          {isStdBuilder && (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <button type="button" onClick={() => setView('standard')} style={{ background: 'transparent', border: '1px solid #ccc', color: '#333', borderRadius: 6, padding: '.45rem 1.1rem', cursor: 'pointer', fontSize: '.8rem', fontWeight: 600 }}>Edit text</button>
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {error ? <div style={{ padding: '2rem', color: '#c00' }}>{error}</div>
            : builderToken ? <DocusealBuilder token={builderToken} roles={['DJ', 'Client']} fields={builderFields} onlyDefinedFields={true} withSendButton={false} withRecipientsButton={false} withSignYourselfButton={false} withAddPageButton={false} withRevisions={false} withDocumentsList={false} withTitle={false} onSave={handleBuilderSave} />
            : <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Opening builder…</div>}
        </div>
        <div style={{ borderTop: '1px solid #eee', padding: '.6rem 1rem', background: '#fff' }}>
          {isStdBuilder && (
            <label style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', color: '#6b7280', fontSize: '.74rem', lineHeight: 1.4, cursor: 'pointer', marginBottom: '.55rem' }}>
              <input type="checkbox" checked={stdDisclaimer} onChange={(e) => setStdDisclaimer(e.target.checked)} style={{ marginTop: 3, flexShrink: 0 }} />
              <span>I understand Global DJ Connect provides this contract as a template only and takes no responsibility for its content, enforceability, or any dispute arising from its use. I&rsquo;ll have it reviewed by a lawyer before relying on it.</span>
            </label>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" disabled={isStdBuilder && !stdDisclaimer} title={isStdBuilder && !stdDisclaimer ? 'Accept the disclaimer to finish' : undefined} onClick={async () => { const supabase = createClient(); try { if (editingId) await supabase.from('contracts').update({ name } as never).eq('id', editingId).eq('dj_id', userId); } catch {} setView('grid'); }} style={{ background: (isStdBuilder && !stdDisclaimer) ? 'rgba(0,224,164,.4)' : 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: (isStdBuilder && !stdDisclaimer) ? 'not-allowed' : 'pointer' }}>Lock it in</button>
          </div>
        </div>
      </div>, true, 'Add fields',
    );
  }

  if (view === 'standard') {
    return wrap(
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#f3f4f6' }}>
        <div style={{ padding: '.85rem 1rem', borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contract name" style={{ width: '100%', boxSizing: 'border-box', padding: '.55rem .75rem', borderRadius: 6, border: '1px solid #ccc', color: '#111', fontWeight: 600, fontSize: '.95rem' }} />
          <div style={{ color: '#6b7280', fontSize: '.75rem', marginTop: 6 }}>Edit the wording. Keep the {'{{tags}}'} — the signature and detail fields fill in from them automatically. Next you can review and adjust where the fields sit. Have a lawyer review before use.</div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '1.5rem', background: '#f3f4f6' }}>
          <div style={{ maxWidth: 720, margin: '0 auto', background: '#fff', boxShadow: '0 1px 5px rgba(0,0,0,.15)', borderRadius: 2 }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', border: 'none', outline: 'none', resize: 'none', minHeight: 560, padding: '2.5rem', color: '#111', background: 'transparent', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '.9rem', lineHeight: 1.7 }} />
          </div>
          {error && <div style={{ color: '#c00', fontSize: '.82rem', marginTop: '.6rem', textAlign: 'center' }}>{error}</div>}
        </div>
        <div style={{ background: '#fff', borderTop: '1px solid #e5e7eb', padding: '.7rem 1rem', display: 'flex', justifyContent: 'space-between' }}>
          <button type="button" onClick={() => setView(editingId ? 'builder' : 'grid')} style={{ background: 'transparent', border: '1px solid #ccc', color: '#333', borderRadius: 6, padding: '.55rem 1.2rem', cursor: 'pointer' }}>{editingId ? 'Back to fields' : 'Cancel'}</button>
          <button type="button" onClick={saveStandard} disabled={savingStd} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: savingStd ? 'wait' : 'pointer' }}>{savingStd ? 'Saving…' : 'Save & review fields →'}</button>
        </div>
      </div>, true, 'Global DJ Connect standard contract',
    );
  }

  // grid
  const sectionLabel: React.CSSProperties = { color: 'var(--muted,#8a8aa0)', fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.7rem' };
  return wrap(
    <div style={{ padding: '1.25rem', overflow: 'auto' }}>
      <input ref={fileInput} type="file" accept=".pdf,.docx,image/*" style={{ display: 'none' }} onChange={onFile} />

      {bookingMode && (
        <div style={{ marginBottom: '1.1rem', color: 'var(--neon,#00e0a4)', fontSize: '.82rem', lineHeight: 1.45 }}>
          Pick a contract to send for this booking — or create one below. The booking details fill in automatically before you sign.
        </div>
      )}

      {/* ── Create a new contract ── */}
      <div style={sectionLabel}>Create a contract</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '.85rem' }}>
        <div style={{ ...cardBase, minHeight: 96, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', cursor: 'pointer' }} onClick={openPaste}>
          <div style={{ textAlign: 'center', color: 'var(--neon,#00e0a4)' }}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>✍️</div>
            <div style={{ fontSize: '.82rem', marginTop: 6, fontWeight: 700 }}>Write or paste contract text</div>
          </div>
        </div>
        <div style={{ ...cardBase, minHeight: 96, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', cursor: uploading ? 'wait' : 'pointer' }} onClick={() => !uploading && fileInput.current?.click()}>
          <div style={{ textAlign: 'center', color: 'var(--neon,#00e0a4)' }}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>{uploading ? '…' : '+'}</div>
            <div style={{ fontSize: '.82rem', marginTop: 6, fontWeight: 700 }}>{uploading ? 'Uploading…' : 'Upload contract'}</div>
            {!uploading && <div style={{ fontSize: '.68rem', marginTop: 3, color: 'var(--muted,#8a8aa0)' }}>PDF, Word, image</div>}
          </div>
        </div>
        <div style={{ ...cardBase, minHeight: 96, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', cursor: 'pointer' }} onClick={openStandardTemplate}>
          <div style={{ textAlign: 'center', color: 'var(--neon,#00e0a4)' }}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>📃</div>
            <div style={{ fontSize: '.82rem', marginTop: 6, fontWeight: 700 }}>Global DJ Connect standard contract</div>
          </div>
        </div>
      </div>

      {error && <div style={{ color: '#ff6b6b', fontSize: '.82rem', margin: '.9rem 0 0' }}>{error}</div>}

      {/* ── Your existing contracts ── */}
      <div style={{ marginTop: '1.6rem', paddingTop: '1.3rem', borderTop: '1px solid var(--border,rgba(255,255,255,.12))' }}>
        <div style={sectionLabel}>Your contracts</div>
        {loading ? <div style={{ color: 'var(--muted,#8a8aa0)' }}>Loading…</div>
          : contracts.length === 0 ? <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.85rem' }}>No contracts yet. Create one above.</div>
          : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '.85rem' }}>
            {contracts.map((c) => {
              const cType = c.is_standard
                ? { label: 'Standard', color: '#e8e2d0' }
                : c.body_text != null
                  ? { label: 'Written', color: '#f5c451' }
                  : { label: 'Uploaded', color: 'var(--neon,#00e0a4)' };
              return (
              <div key={c.id} style={{ ...cardBase, position: 'relative' }}>
                <div style={{ position: 'absolute', top: 8, right: 10, fontSize: '.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: cType.color }}>{cType.label}</div>
                <div>
                  <div style={{ fontSize: 22 }}>📄</div>
                  {renaming === c.id ? (
                    <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onBlur={() => commitRename(c)} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(c); }} onClick={(e) => e.stopPropagation()} style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '.3rem .4rem', borderRadius: 4, border: '1px solid var(--neon,#00e0a4)', background: 'transparent', color: 'var(--white,#fff)', fontWeight: 700 }} />
                  ) : (
                    <div style={{ color: 'var(--white,#fff)', fontWeight: 700, marginTop: 6, wordBreak: 'break-word', cursor: 'text' }} onClick={() => { setRenaming(c.id); setRenameVal(c.name); }}>{c.name} ✎</div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {bookingMode ? (
                    <>
                      <button type="button" onClick={() => onUseContract?.(c.id)} style={{ width: '100%', background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.5rem', cursor: 'pointer', fontSize: '.8rem' }}>Use this contract</button>
                      <button type="button" onClick={() => (c.is_standard ? openCard(c) : c.body_text != null ? openTextEditor(c) : openCard(c))} style={{ width: '100%', background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem', cursor: 'pointer', fontSize: '.78rem' }}>{c.is_standard ? 'Edit wording' : c.body_text != null ? 'Edit text' : 'Edit auto-fill fields'}</button>
                    </>
                  ) : c.is_standard ? (
                    <button type="button" onClick={() => openCard(c)} style={{ width: '100%', background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.5rem', cursor: 'pointer', fontSize: '.8rem' }}>Open / Customize</button>
                  ) : c.body_text != null ? (
                    <>
                      <button type="button" onClick={() => openCard(c)} style={{ width: '100%', background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.5rem', cursor: 'pointer', fontSize: '.8rem' }}>Place fields</button>
                      <button type="button" onClick={() => openTextEditor(c)} style={{ width: '100%', background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem', cursor: 'pointer', fontSize: '.78rem' }}>Edit text</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => openCard(c)} style={{ width: '100%', background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.5rem', cursor: 'pointer', fontSize: '.8rem' }}>Open / Automate Fields</button>
                  )}
                  <button type="button" onClick={() => deleteContract(c)} style={{ background: 'transparent', border: 'none', color: '#ff7676', cursor: 'pointer', fontSize: '.75rem' }}>Delete</button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>, false, bookingMode ? 'Send a contract' : 'Contract Portal',
  );
}
