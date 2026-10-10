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
import { defaultContractText, WEDDING_CONTRACT_TEXT } from '@/lib/contractText';

const DocusealBuilder = dynamic(
  () => import('@docuseal/react').then((m) => m.DocusealBuilder),
  { ssr: false, loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Loading builder…</div> },
);

const BUILDER_FIELDS = [
  { name: 'client_name', type: 'text', role: 'DJ', title: 'Client name' },
  { name: 'dj_name', type: 'text', role: 'DJ', title: 'Company / DJ name' },
  { name: 'event_date', type: 'text', role: 'DJ', title: 'Event date' },
  { name: 'agreement_date', type: 'text', role: 'DJ', title: 'Agreement date' },
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
  { name: 'tax', type: 'text', role: 'DJ', title: 'Tax' },
  { name: 'grand_total', type: 'text', role: 'DJ', title: 'Total' },
  { name: 'deposit', type: 'text', role: 'DJ', title: 'Deposit' },
  { name: 'payment_terms', type: 'text', role: 'DJ', title: 'Payment breakdown (deposit & balance)' },
  { name: 'DJ Signature', type: 'signature', role: 'DJ', title: 'Your signature' },
  { name: 'Client Signature', type: 'signature', role: 'Client/Host', title: 'Client signature' },
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

// ── Merge-tag chips for the "Edit Contract Text" view ───────────────────────
// Instead of showing raw {{event_type}} tokens, the standard editor renders each
// tag as a small non-editable chip sitting exactly where the tag is. On save we
// serialize the editor back to text, turning each chip back into its {{tag}} so
// the field builder still auto-places everything in the same spot.
const TAG_LABELS: Record<string, string> = {
  dj_name: 'Company / DJ name', client_name: 'Client name', event_date: 'Event date',
  event_type: 'Event type', venue_name: 'Venue name', event_address: 'Event address',
  start_time: 'Start time', end_time: 'End time', package: 'Package', set_type: 'Set type',
  equipment: 'Equipment', duration: 'Duration', overtime_rate: 'Overtime rate', price: 'Price',
  deposit: 'Deposit', payment_terms: 'Payment breakdown', cocktail_hour: 'Cocktail hour',
  ceremony: 'Ceremony', tax: 'Tax', grand_total: 'Total', agreement_date: 'Agreement date',
  todays_date: 'Today’s date', client_signature: 'Client signature',
};
function escChip(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function chipHtml(tag: string): string {
  const label = TAG_LABELS[tag] || tag.replace(/_/g, ' ');
  return `<span contenteditable="false" data-tag="${escChip(tag)}" style="display:inline-block;background:#e8f7f0;border:1px solid #9fe3c8;color:#0a7a52;border-radius:4px;padding:0 6px;font-size:.78rem;font-weight:700;margin:0 1px;white-space:nowrap;">${escChip(label)}</span>`;
}
// text (with {{tags}}) → HTML with chips. Newlines preserved via pre-wrap.
function textToChipsHtml(t: string): string {
  return escChip(t).replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_m, tag) => chipHtml(String(tag).trim()));
}
// For the rich (HTML) paste editor: turn {{tags}} already in the HTML into chips
// WITHOUT escaping the surrounding markup (it's already HTML, with formatting).
function htmlToChipsHtml(html: string): string {
  return html.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_m, tag) => chipHtml(String(tag).trim()));
}
// Read the paste editor back as HTML with chips turned back into {{tags}},
// preserving the DJ's formatting (bold, lists, etc.).
function serializeChipsPreserveHtml(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-tag]').forEach((el) => {
    const tag = (el as HTMLElement).dataset.tag || '';
    el.replaceWith(document.createTextNode(`{{${tag}}}`));
  });
  return clone.innerHTML;
}
// editor DOM → text, turning chips back into {{tag}} and block/<br> into newlines.
function serializeChips(root: HTMLElement): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) { parts.push(child.textContent || ''); return; }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const el = child as HTMLElement;
      if (el.dataset && el.dataset.tag) { parts.push(`{{${el.dataset.tag}}}`); return; }
      if (el.tagName === 'BR') { parts.push('\n'); return; }
      const isBlock = /^(DIV|P)$/.test(el.tagName);
      if (isBlock && parts.length && !parts[parts.length - 1].endsWith('\n')) parts.push('\n');
      walk(el);
      if (isBlock) parts.push('\n');
    });
  };
  walk(root);
  return parts.join('').replace(/\n{3,}/g, '\n\n');
}

export default function ContractPortal({
  userId, djType, bookingId, eventType, controlledOpen, onUseContract, onRequestClose, inline,
}: {
  userId: string;
  djType?: string | null;
  // Booking mode: when a bookingId + onUseContract are passed, the portal is
  // opened from a booking so the DJ can pick (or create) a contract to send.
  bookingId?: string;
  // The booking's event type (booking mode) — used to gate the wedding contract.
  eventType?: string | null;
  controlledOpen?: boolean;
  onUseContract?: (contractId: string) => void;
  onRequestClose?: () => void;
  // Inline mode: render the library straight on the page (no launcher button,
  // no modal for the grid) with a usage counter. Create/edit still open overlays.
  inline?: boolean;
}) {
  const bookingMode = !!bookingId && !!onUseContract;
  // Wedding contract is only offerable for a wedding booking. Outside booking
  // mode (Booking Settings) it's always available; in booking mode it's locked
  // unless the booking's event is a wedding.
  const weddingLocked = bookingMode && !/wedding/i.test(eventType || '');
  // Per-contract send gating (booking mode only): a wedding contract can only be
  // sent for a wedding booking, and the plain Standard contract only for a
  // non-wedding booking. Custom written/uploaded contracts are always sendable.
  const isWeddingBooking = /wedding/i.test(eventType || '');
  const useLocked = (c: Contract) => {
    if (!bookingMode) return false;
    const isWeddingContract = /wedding/i.test(c.name);
    if (isWeddingContract) return !isWeddingBooking;
    if (c.is_standard) return isWeddingBooking;
    return false;
  };
  const useLockNote = (c: Contract) => {
    if (!bookingMode) return '';
    const isWeddingContract = /wedding/i.test(c.name);
    if (isWeddingContract && !isWeddingBooking) return 'Weddings only';
    if (c.is_standard && !isWeddingContract && isWeddingBooking) return 'Not for weddings — use the wedding contract';
    return '';
  };
  const builderFields = BUILDER_FIELDS
    .filter((f) => !('only' in f) || (f as { only?: string }).only === djType)
    // Club/bar DJs don't use a company — label the field just "DJ Name".
    .map((f) => (f.name === 'dj_name' && djType === 'club') ? { ...f, title: 'DJ Name' } : f);
  const [open, setOpen] = useState(false);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('grid');
  // True while the builder is part of CREATING a new contract (upload / write /
  // standard), false when editing an existing one from the list — drives the
  // primary button label ("Create contract" vs "Save changes").
  const [builderNew, setBuilderNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [builderToken, setBuilderToken] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingStd, setSavingStd] = useState(false);
  const [stdDisclaimer, setStdDisclaimer] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const logoInputFields = useRef<HTMLInputElement>(null);

  // Upload a logo file to storage; returns its public URL (or null on failure).
  async function uploadLogoFile(file: File): Promise<string | null> {
    if (!file.type.startsWith('image/')) { setError('Logo must be an image.'); return null; }
    if (file.size > 4 * 1024 * 1024) { setError('Logo is too large (max 4MB).'); return null; }
    setError(null); setLogoBusy(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${userId}/contract_logo_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      return `${data.publicUrl}?t=${Date.now()}`;
    } catch (err) { setError(err instanceof Error ? err.message : 'Logo upload failed.'); return null; }
    finally { setLogoBusy(false); }
  }

  // Logo upload from the Edit-text page (just stores it; applied on save).
  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const url = await uploadLogoFile(file);
    if (url) setLogoUrl(url);
  }

  // Logo upload from the FIELDS page — uploads AND rebuilds the contract with
  // the logo, right there, without going to the text page.
  async function onLogoFromFields(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const url = await uploadLogoFile(file);
    if (url) { setLogoUrl(url); await saveStandard(url); }
  }
  const [text, setText] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [submittingPaste, setSubmittingPaste] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  // Styled delete-confirm (replaces the browser's native confirm() box).
  const [pendingDelete, setPendingDelete] = useState<Contract | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  // The standard-contract "Edit Contract Text" editor (chips for {{tags}}).
  const stdRef = useRef<HTMLDivElement>(null);

  // Seed the rich-text editor with the contract content when the write/edit
  // screen opens (uncontrolled contenteditable, read back on save).
  useEffect(() => {
    if (view === 'paste' && editorRef.current) {
      editorRef.current.innerHTML = htmlToChipsHtml(pasteText || '');
    }
    if (view === 'standard' && stdRef.current) {
      stdRef.current.innerHTML = textToChipsHtml(text || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, editingId]);

  function exec(cmd: string, value?: string) {
    editorRef.current?.focus();
    try { document.execCommand(cmd, false, value); } catch { /* ignore */ }
  }

  async function load() {
    try {
      // Server route (admin client + acting authorization) — a teammate can't
      // read the owner's contracts directly through RLS.
      const res = await fetch('/api/contracts');
      const j = await res.json().catch(() => ({}));
      setContracts((j?.contracts as Contract[]) || []);
    } catch { /* ignore */ }
    setLoading(false);
  }
  useEffect(() => { if (open || controlledOpen || inline) load(); /* eslint-disable-next-line */ }, [open, controlledOpen, inline, userId]);

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
        openCard({ id: json.contractId, name: json.name || 'Contract', docuseal_template_id: json.templateId || null, is_standard: false }, true);
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
  async function openStandardTemplate(variant?: 'wedding') {
    setError(null);
    const defText = variant === 'wedding' ? WEDDING_CONTRACT_TEXT : defaultContractText(djType);
    const nm = variant === 'wedding' ? 'Global DJ Connect Standard Wedding Contract' : 'Global DJ Connect Standard Contract';
    setName(nm); setText(defText); setStdDisclaimer(false); setEditingId(null); setLogoUrl(null);
    setBuilderNew(true);
    setView('builder'); setBuilderToken(null); setSavingStd(true);
    try {
      const res = await fetch('/api/contracts/standard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: defText, name: nm, contractId: null, logoUrl: null }),
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

  // Edit the WORDING of a standard contract — opens the standard text editor
  // (the fields builder is a separate "Edit data fields" action).
  function openStandardText(c: Contract) {
    setError(null); setBuilderNew(false); setEditingId(c.id); setName(c.name);
    setText(defaultContractText(djType)); setStdDisclaimer(false); setLogoUrl(null);
    setView('standard');
  }

  // Lock the text in: (re)build the contract from the text, then hand off to the
  // drag builder to place fields. Passes contractId when editing (re-lock).
  async function submitPastedText() {
    // Turn chips back into {{tags}} (keeping the DJ's formatting) before building.
    const html = editorRef.current ? serializeChipsPreserveHtml(editorRef.current) : '';
    const plain = (editorRef.current?.textContent ?? '').trim();
    if (!plain) { setError('Contract text is empty.'); return; }
    // Editing an EXISTING contract's text (re-lock) is a save, not a create — the
    // builder's button must say "Save changes", not "Create Contract". editingId
    // is set only when we came in from an existing contract, so it's the tell.
    const wasEdit = !!editingId;
    setError(null); setSubmittingPaste(true);
    try {
      const res = await fetch('/api/contracts/from-text', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: html, name: name || 'My contract', contractId: editingId || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; contractId?: string; templateId?: string; name?: string };
      if (!res.ok || !json.ok || !json.contractId) throw new Error(json.error || 'Could not build the contract.');
      await load();
      openCard({ id: json.contractId, name: json.name || name || 'My contract', docuseal_template_id: json.templateId || null, is_standard: false }, !wasEdit);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not build the contract.'); }
    finally { setSubmittingPaste(false); }
  }

  async function openCard(c: Contract, isNew = false) {
    setBuilderNew(isNew);
    setEditingId(c.id); setName(c.name); setError(null);
    // Standard contracts open straight to the fields builder (which has the
    // "Edit text" button + disclaimer); preload wording so Edit text is ready.
    if (c.is_standard) { setText(defaultContractText(djType)); setStdDisclaimer(false); setLogoUrl(null); }
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

  async function saveStandard(overrideLogo?: string | null) {
    // When the chip editor is open, read the latest wording back from it
    // (chips → {{tags}}). Keep `text` state in sync so later saves (e.g. adding
    // a logo from the fields page) don't lose these edits.
    const latest = (view === 'standard' && stdRef.current) ? serializeChips(stdRef.current) : text;
    if (latest !== text) setText(latest);
    if (!latest.trim()) { setError('Contract text is empty.'); return; }
    const lg = overrideLogo !== undefined ? overrideLogo : logoUrl;
    setError(null); setSavingStd(true);
    try {
      const res = await fetch('/api/contracts/standard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: latest, name: name || 'Standard contract', contractId: editingId, logoUrl: lg }),
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
      await fetch('/api/contracts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, name: newName }) });
    } catch { /* optimistic */ }
  }

  async function deleteContract(c: Contract) {
    // Open the styled confirm modal instead of the browser's native confirm().
    setPendingDelete(c);
  }

  async function confirmDelete() {
    const c = pendingDelete;
    setPendingDelete(null);
    if (!c) return;
    try {
      await fetch(`/api/contracts?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' });
      await load();
    } catch { /* ignore */ }
  }

  // ---------- UI ----------
  // In booking mode the portal is opened by the parent (controlledOpen) — no
  // launcher button. Otherwise it shows its own "Open Contract Portal" button.
  if (!inline && !controlledOpen && !open) {
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
            style={{ width: '50%', boxSizing: 'border-box', padding: '.55rem .75rem', borderRadius: 6, border: '1px solid #ccc', color: '#111', fontSize: '.95rem', fontWeight: 600 }} />
          <div style={{ color: '#777', fontSize: '.75rem', marginTop: 6 }}>Fields fill in automatically from the booking. Drag any field to move it, or add ones you need — your fields (name, date, price, your signature) are under <strong>DJ</strong> in the top-right dropdown; the <strong>client&rsquo;s signature</strong> is under <strong>Client</strong>. {bookingMode ? 'Then Lock it in.' : 'Then save your changes.'}</div>
          {isStdBuilder && (
            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
              <button type="button" onClick={() => setView('standard')} style={{ background: 'transparent', border: '1px solid #ccc', color: '#333', borderRadius: 6, padding: '.45rem 1.1rem', cursor: 'pointer', fontSize: '.8rem', fontWeight: 600 }}>Edit Contract Text</button>
              <button type="button" onClick={() => logoInputFields.current?.click()} disabled={logoBusy} style={{ background: 'transparent', border: '1px solid #ccc', color: '#0a7', borderRadius: 6, padding: '.45rem 1.1rem', cursor: logoBusy ? 'wait' : 'pointer', fontSize: '.8rem', fontWeight: 600 }}>{logoBusy ? 'Adding logo…' : logoUrl ? 'Change logo' : 'Add logo to contract'}</button>
              <input ref={logoInputFields} type="file" accept="image/*" style={{ display: 'none' }} onChange={onLogoFromFields} />
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {error ? <div style={{ padding: '2rem', color: '#c00' }}>{error}</div>
            : builderToken ? <DocusealBuilder token={builderToken} roles={['DJ', 'Client/Host']} fields={builderFields} onlyDefinedFields={true} withSendButton={false} withRecipientsButton={false} withSignYourselfButton={false} withAddPageButton={false} withRevisions={false} withDocumentsList={false} withTitle={false} onSave={handleBuilderSave} />
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
            <button type="button" disabled={isStdBuilder && !stdDisclaimer} title={isStdBuilder && !stdDisclaimer ? 'Accept the disclaimer to finish' : undefined} onClick={async () => { try { if (editingId) await fetch('/api/contracts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingId, name }) }); } catch {} if (bookingMode && onUseContract && editingId) { onUseContract(editingId); } else { setView('grid'); } }} style={{ background: (isStdBuilder && !stdDisclaimer) ? 'rgba(0,224,164,.4)' : 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: (isStdBuilder && !stdDisclaimer) ? 'not-allowed' : 'pointer' }}>{bookingMode ? 'Lock it in & send →' : (builderNew ? 'Create Contract' : 'Save changes')}</button>
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
          <div style={{ color: '#6b7280', fontSize: '.75rem', marginTop: 6 }}>Edit the wording. The green chips mark where the booking details and signatures fill in automatically — leave them in place (you can delete one to remove that field). Next you can review and adjust where the fields sit. Have a lawyer review before use.</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginTop: '.6rem', flexWrap: 'wrap' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logoUrl && <img src={logoUrl} alt="Logo" style={{ maxHeight: 38, maxWidth: 110, borderRadius: 4 }} />}
            <button type="button" onClick={() => logoInput.current?.click()} disabled={logoBusy} style={{ background: 'transparent', border: '1px solid #ccc', color: '#0a7', borderRadius: 6, padding: '.4rem .8rem', cursor: logoBusy ? 'wait' : 'pointer', fontSize: '.78rem', fontWeight: 600 }}>{logoBusy ? 'Uploading…' : logoUrl ? 'Change logo' : 'Add logo to contract (optional)'}</button>
            {logoUrl && <button type="button" onClick={() => setLogoUrl(null)} style={{ background: 'transparent', border: 'none', color: '#d33', cursor: 'pointer', fontSize: '.78rem' }}>Remove</button>}
            <input ref={logoInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={onLogo} />
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '1.5rem', background: '#f3f4f6' }}>
          <div style={{ maxWidth: 720, margin: '0 auto', background: '#fff', boxShadow: '0 1px 5px rgba(0,0,0,.15)', borderRadius: 2 }}>
            <div ref={stdRef} contentEditable suppressContentEditableWarning style={{ width: '100%', boxSizing: 'border-box', outline: 'none', minHeight: 560, padding: '2.5rem', color: '#111', background: 'transparent', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '.9rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }} />
          </div>
          {error && <div style={{ color: '#c00', fontSize: '.82rem', marginTop: '.6rem', textAlign: 'center' }}>{error}</div>}
        </div>
        <div style={{ background: '#fff', borderTop: '1px solid #e5e7eb', padding: '.7rem 1rem', display: 'flex', justifyContent: 'space-between' }}>
          <button type="button" onClick={() => setView(editingId ? 'builder' : 'grid')} style={{ background: 'transparent', border: '1px solid #ccc', color: '#333', borderRadius: 6, padding: '.55rem 1.2rem', cursor: 'pointer' }}>{editingId ? 'Back to fields' : 'Cancel'}</button>
          <button type="button" onClick={() => saveStandard()} disabled={savingStd} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.4rem', cursor: savingStd ? 'wait' : 'pointer' }}>{savingStd ? 'Saving…' : 'Save & review fields →'}</button>
        </div>
      </div>, true, 'Global DJ Connect Standard Contract',
    );
  }

  // grid
  const sectionLabel: React.CSSProperties = { color: 'var(--muted,#8a8aa0)', fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.7rem' };

  // Inline mode renders the DJ's contracts as a compact list with an action on
  // each row, under a monthly-usage header — rather than the modal card grid.
  const contractsList = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      {contracts.map((c) => {
        const cType = c.is_standard
          ? { label: 'Standard', color: '#e8e2d0' }
          : c.body_text != null
            ? { label: 'Written', color: '#f5c451' }
            : { label: 'Uploaded', color: 'var(--neon,#00e0a4)' };
        const edited = c.updated_at ? new Date(c.updated_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
        return (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '.8rem', border: '1px solid var(--border,rgba(255,255,255,.12))', borderRadius: 10, padding: '.7rem .9rem', background: 'var(--bg-elev,rgba(255,255,255,.03))' }}>
            <div style={{ fontSize: 20 }}>📄</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {renaming === c.id ? (
                <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onBlur={() => commitRename(c)} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(c); }} style={{ width: '100%', boxSizing: 'border-box', padding: '.3rem .4rem', borderRadius: 4, border: '1px solid var(--neon,#00e0a4)', background: 'transparent', color: 'var(--white,#fff)', fontWeight: 700 }} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, cursor: 'text' }} onClick={() => { setRenaming(c.id); setRenameVal(c.name); }}>
                  <span style={{ color: 'var(--white,#fff)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{c.name}</span>
                  <span style={{ opacity: .6, fontWeight: 400, flexShrink: 0, color: 'var(--white,#fff)' }}>✎</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', marginTop: 3 }}>
                <span style={{ fontSize: '.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: cType.color }}>{cType.label}</span>
                {edited && <span style={{ fontSize: '.68rem', color: 'var(--muted,#8a8aa0)' }}>Edited {edited}</span>}
              </div>
              {/* Why "Use This Contract" is greyed out for this booking. */}
              {bookingMode && useLockNote(c) && (
                <div style={{ fontSize: '.66rem', color: '#d9a441', marginTop: 3 }}>{useLockNote(c)}</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '.4rem', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {bookingMode ? (
                <>
                  {/* Send this contract for the booking. Gated: a wedding contract
                      only on a wedding booking, the plain Standard only on a
                      non-wedding booking. Fixed widths so the columns line up row
                      to row regardless of the edit label. */}
                  {(() => { const locked = useLocked(c); return (
                    <button type="button" disabled={locked} title={locked ? useLockNote(c) : undefined}
                      onClick={() => { if (!locked) onUseContract?.(c.id); }}
                      style={{ width: 128, flexShrink: 0, textAlign: 'center', whiteSpace: 'nowrap', background: locked ? 'rgba(255,255,255,.08)' : 'var(--neon,#00e0a4)', border: 'none', color: locked ? '#777' : '#06231b', fontWeight: 700, borderRadius: 6, padding: '.42rem .4rem', cursor: locked ? 'not-allowed' : 'pointer', fontSize: '.78rem' }}>Use This Contract</button>
                  ); })()}
                  {/* One contextual editor, mirroring the card layout. Label is
                      always "Edit Wording"; the click still routes to the right
                      editor for the contract type. */}
                  <button type="button" onClick={() => (c.is_standard ? openStandardText(c) : c.body_text != null ? openTextEditor(c) : openCard(c))} style={{ width: 96, flexShrink: 0, textAlign: 'center', whiteSpace: 'nowrap', background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.42rem .4rem', cursor: 'pointer', fontSize: '.78rem' }}>Edit Wording</button>
                </>
              ) : (
                <>
                  {/* Edit text — only for contracts whose wording lives in our system
                      (the standard contracts and written/pasted ones). Uploaded PDFs
                      and images have no editable text, so they only get data fields. */}
                  {(c.is_standard || c.body_text != null) && (
                    <button type="button" onClick={() => (c.is_standard ? openStandardText(c) : openTextEditor(c))} style={{ background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.42rem .8rem', cursor: 'pointer', fontSize: '.78rem' }}>Edit Contract Text</button>
                  )}
                  <button type="button" onClick={() => openCard(c)} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.42rem .9rem', cursor: 'pointer', fontSize: '.78rem' }}>Edit Anchor Tags</button>
                </>
              )}
              <button type="button" onClick={() => deleteContract(c)} style={{ width: bookingMode ? 48 : undefined, flexShrink: 0, textAlign: 'right', background: 'transparent', border: 'none', color: '#ff7676', cursor: 'pointer', fontSize: '.75rem' }}>Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const gridInner = (
    <div style={{ padding: inline ? 0 : '1.25rem', overflow: inline ? 'visible' : 'auto' }}>
      <input ref={fileInput} type="file" accept=".pdf,.docx,image/*" style={{ display: 'none' }} onChange={onFile} />

      {bookingMode && (
        <div style={{ marginBottom: '1.1rem', color: 'var(--neon,#00e0a4)', fontSize: '.82rem', lineHeight: 1.45 }}>
          Pick a contract to send for this booking — or create one below. The booking details fill in automatically before you sign.
        </div>
      )}

      {/* ── Create a new contract ── */}
      {/* Scoped rule so the four create tiles stay on ONE row on desktop and fall
          back to a 2×2 grid on phones (inline styles can't do media queries). */}
      <style>{`.gdc-create-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.6rem}@media (max-width:640px){.gdc-create-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}`}</style>
      <div style={sectionLabel}>Create a contract</div>
      <div className="gdc-create-tiles">
        <div style={{ ...cardBase, minHeight: 96, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', cursor: 'pointer' }} onClick={openPaste}>
          <div style={{ textAlign: 'center', color: 'var(--neon,#00e0a4)' }}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>✍️</div>
            <div style={{ fontSize: '.82rem', marginTop: 6, fontWeight: 700 }}>Write or Paste Contract</div>
          </div>
        </div>
        <div style={{ ...cardBase, minHeight: 96, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', cursor: uploading ? 'wait' : 'pointer' }} onClick={() => !uploading && fileInput.current?.click()}>
          <div style={{ textAlign: 'center', color: 'var(--neon,#00e0a4)' }}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>{uploading ? '…' : '+'}</div>
            <div style={{ fontSize: '.82rem', marginTop: 6, fontWeight: 700 }}>{uploading ? 'Uploading…' : 'Upload Contract'}</div>
            {!uploading && <div style={{ fontSize: '.68rem', marginTop: 3, color: 'var(--muted,#8a8aa0)' }}>PDF, Word, image</div>}
          </div>
        </div>
        <div style={{ ...cardBase, minHeight: 96, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', cursor: 'pointer' }} onClick={() => openStandardTemplate()}>
          <div style={{ textAlign: 'center', color: 'var(--neon,#00e0a4)' }}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>📃</div>
            <div style={{ fontSize: '.82rem', marginTop: 6, fontWeight: 700 }}>Global DJ Connect Standard Contract</div>
          </div>
        </div>
        {djType !== 'club' && (
          <div
            style={{ ...cardBase, minHeight: 96, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', cursor: weddingLocked ? 'not-allowed' : 'pointer', opacity: weddingLocked ? 0.45 : 1 }}
            title={weddingLocked ? 'Only available when the booking is a wedding' : undefined}
            onClick={weddingLocked ? undefined : () => openStandardTemplate('wedding')}
          >
            <div style={{ textAlign: 'center', color: 'var(--neon,#00e0a4)' }}>
              <div style={{ fontSize: 28, lineHeight: 1 }}>💍</div>
              <div style={{ fontSize: '.82rem', marginTop: 6, fontWeight: 700 }}>Global DJ Connect Standard Wedding Contract</div>
              {weddingLocked && <div style={{ fontSize: '.66rem', marginTop: 4, color: '#888', fontWeight: 400 }}>Weddings only</div>}
            </div>
          </div>
        )}
      </div>

      {error && <div style={{ color: '#ff6b6b', fontSize: '.82rem', margin: '.9rem 0 0' }}>{error}</div>}

      {/* ── Your existing contracts ── */}
      <div style={{ marginTop: '1.6rem', paddingTop: '1.3rem', borderTop: '1px solid var(--border,rgba(255,255,255,.12))' }}>
        <div style={sectionLabel}>Your contracts</div>
        {loading ? <div style={{ color: 'var(--muted,#8a8aa0)' }}>Loading…</div>
          : contracts.length === 0 ? <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.85rem' }}>No contracts yet. Create one above.</div>
          : (inline || bookingMode) ? contractsList
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
                      <button type="button" onClick={() => (c.is_standard ? openCard(c) : c.body_text != null ? openTextEditor(c) : openCard(c))} style={{ width: '100%', background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem', cursor: 'pointer', fontSize: '.78rem' }}>{c.is_standard ? 'Edit wording' : c.body_text != null ? 'Edit Contract Text' : 'Edit auto-fill fields'}</button>
                    </>
                  ) : c.is_standard ? (
                    <button type="button" onClick={() => openCard(c)} style={{ width: '100%', background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.5rem', cursor: 'pointer', fontSize: '.8rem' }}>Open / Customize</button>
                  ) : c.body_text != null ? (
                    <>
                      <button type="button" onClick={() => openCard(c)} style={{ width: '100%', background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.5rem', cursor: 'pointer', fontSize: '.8rem' }}>Place fields</button>
                      <button type="button" onClick={() => openTextEditor(c)} style={{ width: '100%', background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem', cursor: 'pointer', fontSize: '.78rem' }}>Edit Contract Text</button>
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
    </div>
  );

  // Styled delete confirmation — shown over whichever view is active.
  const deleteModal = pendingDelete ? (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={(e) => { if (e.target === e.currentTarget) setPendingDelete(null); }}>
      <div style={{ background: 'var(--bg-card,#14141f)', border: '1px solid var(--border,rgba(255,255,255,.14))', borderRadius: 14, width: '100%', maxWidth: 420, padding: '1.4rem', boxShadow: '0 24px 70px rgba(0,0,0,.6)' }}>
        <div style={{ color: 'var(--white,#fff)', fontWeight: 800, fontSize: '1.02rem', marginBottom: '.5rem' }}>Delete this contract?</div>
        <div style={{ color: 'var(--muted,#b4b4c6)', fontSize: '.86rem', lineHeight: 1.5 }}>
          Delete <strong style={{ color: 'var(--white,#fff)' }}>“{pendingDelete.name}”</strong>? Contracts already sent or signed with it stay intact on those bookings.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.6rem', marginTop: '1.3rem' }}>
          <button type="button" onClick={() => setPendingDelete(null)} style={{ background: 'transparent', border: '1px solid var(--border,rgba(255,255,255,.22))', color: 'var(--white,#fff)', fontWeight: 600, borderRadius: 8, padding: '.55rem 1.2rem', cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={confirmDelete} style={{ background: '#e5484d', border: 'none', color: '#fff', fontWeight: 700, borderRadius: 8, padding: '.55rem 1.3rem', cursor: 'pointer' }}>Delete</button>
        </div>
      </div>
    </div>
  ) : null;

  if (inline) return <>{gridInner}{deleteModal}</>;
  return <>{wrap(gridInner, false, bookingMode ? 'Send a contract' : 'Contract Portal')}{deleteModal}</>;
}
