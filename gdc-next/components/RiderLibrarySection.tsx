'use client';

// RiderLibrarySection — the DJ's REUSABLE rider library on the Booking Settings
// "DJ Rider" tab. It lists the DJ's saved named riders (up to 10) and is the
// SAME library the booking-dashboard rider loader sends from: both read/write
// booking_settings.riders (the dashboard via GET /api/rider/library), so
// settings and the dashboard always agree.
//
// PERSISTENCE. This component is CONTROLLED: the parent owns the saved riders
// (they live in booking_settings.riders and ride the page's normal autosave).
// The DJ's in-progress edits, though, are LOCAL draft state here and are never
// pushed up until they press Save — so:
//   · An unnamed / incomplete draft never leaks into stored settings.
//   · Leaving with unsaved changes warns first (in-app confirm + beforeunload).
//   · On return the editor is blank, because the draft was never saved.
//   · Save upserts the named rider into the library (parent persists it); a
//     saved rider shows as a card you can click to Edit or Delete.

import { useEffect, useRef, useState } from 'react';
import RiderBuilder from '@/components/RiderBuilder';
import { useConfirm } from '@/components/ConfirmModal';
import {
  normalizeRiderItems, upsertNamedRider, newRiderId, STARTER_RIDER,
  type NamedRider, type RiderItem, type RiderMode,
} from '@/lib/rider';

const MAX = 10;
const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

interface Props {
  // The DJ's saved riders — owned by the parent (booking_settings.riders).
  riders: NamedRider[];
  // Commit a new riders array to the parent (which persists it via the page's
  // normal booking-settings save). Called ONLY on an explicit Save / Delete.
  onChange: (next: NamedRider[]) => void;
}

export default function RiderLibrarySection({ riders, onChange }: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<null | { id: string | null }>(null);
  // Local draft — never persisted until Save.
  const [mode, setMode] = useState<RiderMode | null>(null);
  const [items, setItems] = useState<RiderItem[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const initialRef = useRef<string>('');

  const snapshot = () => JSON.stringify({ mode, items, pdfUrl, name: name.trim() });
  const dirty = editing != null && snapshot() !== initialRef.current;

  // Warn on a hard navigation / tab close while a draft has unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // Start a brand-new rider with its build mode already chosen (the two options
  // live in the list view now, not behind a "Create rider" button), so the
  // editor opens straight into that mode's body with no chooser.
  function openNew(m: RiderMode) {
    const blank = m === 'custom' ? STARTER_RIDER.map((x) => ({ ...x })) : [];
    setMode(m); setItems(blank); setPdfUrl(null); setName(''); setTestMsg(null);
    setEditing({ id: null });
    initialRef.current = JSON.stringify({ mode: m, items: blank, pdfUrl: null, name: '' });
  }
  function openEdit(r: NamedRider) {
    const its = normalizeRiderItems(r.items);
    setMode(r.mode); setItems(its); setPdfUrl(r.pdfUrl); setName(r.name); setTestMsg(null);
    setEditing({ id: r.id });
    initialRef.current = JSON.stringify({ mode: r.mode, items: its, pdfUrl: r.pdfUrl, name: r.name.trim() });
  }
  async function closeEditor() {
    if (dirty) {
      const ok = await confirm({
        title: 'Discard changes?',
        message: "You haven't saved this rider. If you leave now, your changes won't be saved.",
        confirmLabel: 'Discard',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setEditing(null);
  }

  const hasContent = mode === 'upload'
    ? !!pdfUrl
    : mode === 'custom'
      ? items.some((it) => it.type !== 'box' && (it.value || '').trim() !== '')
      : false;
  const missing: string[] = [];
  if (name.trim() === '') missing.push('a rider name');
  if (!hasContent) missing.push(mode === 'upload' ? 'an uploaded PDF' : mode === 'custom' ? 'at least one filled box' : 'an upload or custom build');
  // Block a brand-new rider at the cap (editing an existing one is always fine).
  const atCap = editing?.id == null && riders.length >= MAX;
  const canSave = missing.length === 0 && !atCap;

  function save() {
    if (!canSave || !mode) return;
    const id = editing?.id ?? newRiderId();
    const rider: NamedRider = { id, name: name.trim(), mode, items, pdfUrl, updatedAt: new Date().toISOString() };
    onChange(upsertNamedRider(riders, rider));
    initialRef.current = snapshot(); // mark clean so closing doesn't warn
    setEditing(null);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 4000);
  }

  async function remove(r: NamedRider) {
    const ok = await confirm({
      title: 'Delete this rider?',
      message: `"${r.name}" will be removed from your rider library.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    onChange(riders.filter((x) => x.id !== r.id));
  }

  async function sendTest() {
    setTestBusy(true); setTestMsg(null);
    try {
      const res = await fetch('/api/rider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, mode: mode ?? 'custom', pdfUrl, name }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; emailedTo?: string; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not send the test.');
      setTestMsg(`✓ Test sent${j.emailedTo ? ` to ${j.emailedTo}` : ''} — check your inbox.`);
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : 'Could not send the test.');
    } finally {
      setTestBusy(false);
    }
  }

  const label: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace", fontSize: '.58rem', letterSpacing: '.06em',
    textTransform: 'uppercase', color: MUTED,
  };
  const btnGhost: React.CSSProperties = {
    background: 'transparent', border: `1px solid ${NEON}`, color: NEON, borderRadius: 7,
    padding: '.4rem 1rem', fontFamily: "'Space Mono', monospace", fontSize: '.62rem',
    fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer',
  };
  const btnDanger: React.CSSProperties = {
    ...btnGhost, border: '1px solid rgba(255,120,120,.6)', color: '#ff8b8b',
  };

  // Guard a mode switch: if an open draft has unsaved changes, warn first.
  async function guardSwitch(): Promise<boolean> {
    if (editing && dirty) {
      return confirm({
        title: 'Discard changes?',
        message: "You haven't saved this rider. If you leave now, your changes won't be saved.",
        confirmLabel: 'Discard',
        variant: 'danger',
      });
    }
    return true;
  }
  // Toggle a NEW-rider build option open/closed in place — nothing else closes.
  // NOTE: the "already open for this mode" test must require an editor to be
  // open (editing != null). `editing?.id == null` alone is also true when
  // NOTHING is open, which made a reopen click close it again.
  async function toggleNew(m: RiderMode) {
    if (editing != null && editing.id == null && mode === m) { if (await guardSwitch()) setEditing(null); return; }
    if (!(await guardSwitch())) return;
    openNew(m);
  }
  async function toggleEdit(r: NamedRider) {
    if (editing?.id === r.id) { if (await guardSwitch()) setEditing(null); return; }
    if (!(await guardSwitch())) return;
    openEdit(r);
  }

  // The inline editor body (builder + test + save/cancel) — rendered in place
  // right under whichever row/option is open, so the list and the other option
  // stay visible. `openMode` tells it which mode it belongs to.
  const editorBlock = (
    <div style={{ marginTop: '.8rem', paddingLeft: '.1rem' }}>
      <RiderBuilder
        mode={mode}
        onModeChange={setMode}
        items={items}
        onItemsChange={setItems}
        pdfUrl={pdfUrl}
        onPdfUrlChange={setPdfUrl}
        name={name}
        onNameChange={setName}
        hideChooser
      />

      {hasContent && name.trim() !== '' && (
        <div style={{ marginTop: '1.2rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,.1)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.5rem', textAlign: 'center' }}>
          <div style={{ color: MUTED, fontSize: '.76rem', maxWidth: 420 }}>
            Send yourself a test to see exactly what the host receives.
          </div>
          <button type="button" disabled={testBusy} onClick={sendTest} style={{ ...btnGhost, padding: '.55rem 1.3rem', fontSize: '.78rem', opacity: testBusy ? 0.6 : 1 }}>
            {testBusy ? 'Sending…' : 'Send test email'}
          </button>
          {testMsg && <div style={{ color: testMsg.startsWith('✓') ? NEON : '#ff8b8b', fontSize: '.76rem' }}>{testMsg}</div>}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.4rem', marginTop: '1rem' }}>
        {!canSave && missing.length > 0 && (
          <div style={{ color: '#ff8b8b', fontSize: '.72rem', textAlign: 'right' }}>
            Add {missing.join(' and ')} before saving the rider.
          </div>
        )}
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button type="button" onClick={closeEditor} style={{ ...btnGhost, border: '1px solid var(--border,rgba(255,255,255,.2))', color: MUTED }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={save}
            style={{
              ...btnGhost,
              background: canSave ? NEON : 'transparent',
              color: canSave ? '#04121a' : MUTED,
              border: `1px solid ${canSave ? NEON : 'var(--border,rgba(255,255,255,.2))'}`,
              cursor: canSave ? 'pointer' : 'not-allowed',
              padding: '.4rem 1.3rem',
            }}
          >
            Save rider
          </button>
        </div>
      </div>
    </div>
  );

  // A build option — its own bordered bubble with a radio dot, one line. When
  // open, the editor expands inside the bubble; the other bubble stays put.
  const BuildOption = ({ title, hint, open, onClick, children }: { title: string; hint: string; open: boolean; onClick: () => void; children?: React.ReactNode }) => (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: open ? `1.5px solid ${NEON}` : '1.5px solid rgba(255,255,255,.14)', background: open ? 'rgba(0,224,164,.06)' : 'transparent' }}>
      <button
        type="button"
        onClick={onClick}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '.7rem', textAlign: 'left',
          background: 'transparent', border: 'none', padding: '.8rem 1rem', cursor: 'pointer', color: '#fff',
        }}
      >
        <span style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: open ? `5px solid ${NEON}` : '2px solid rgba(255,255,255,.35)', background: open ? '#06231b' : 'transparent' }} />
        <span style={{ fontWeight: 800, fontSize: '.95rem', flexShrink: 0, color: open ? NEON : '#fff' }}>{title}</span>
        <span style={{ color: MUTED, fontSize: '.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hint}</span>
      </button>
      {open && children && <div style={{ padding: '.2rem 1.2rem 1.4rem' }}>{children}</div>}
    </div>
  );

  const newUploadOpen = editing?.id == null && editing != null && mode === 'upload';
  const newCustomOpen = editing?.id == null && editing != null && mode === 'custom';

  // ── Library view — everything stays open; the editor expands in place. ──
  return (
    <div style={{ marginTop: '1.1rem' }}>
      {confirmDialog}
      {justSaved && (
        <div style={{ marginBottom: '.7rem', color: NEON, fontSize: '.82rem', fontWeight: 700 }}>✓ Rider saved</div>
      )}

      {/* Saved riders — flat one-line rows, no frame. Editing one expands below it. */}
      {riders.length > 0 && (
        <div style={{ marginBottom: '1.2rem' }}>
          <div style={{ ...label, marginBottom: '.2rem' }}>Your riders ({riders.length}/{MAX})</div>
          {riders.map((r) => (
            <div key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', padding: '.6rem .1rem' }}>
                <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '.5rem' }}>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: '.92rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  <span style={{ color: MUTED, fontSize: '.72rem', whiteSpace: 'nowrap', flexShrink: 0 }}>{r.mode === 'upload' ? 'Uploaded PDF' : 'Custom rider'}</span>
                </div>
                <div style={{ flexShrink: 0, display: 'flex', gap: '.4rem' }}>
                  <button type="button" onClick={() => toggleEdit(r)} style={btnGhost}>{editing?.id === r.id ? 'Close' : 'Edit'}</button>
                  <button type="button" onClick={() => remove(r)} style={btnDanger}>Delete</button>
                </div>
              </div>
              {editing?.id === r.id && editorBlock}
            </div>
          ))}
        </div>
      )}

      {/* Add a rider — once an option is chosen, the OTHER option (and the OR)
          hide until the one being worked on is saved or cancelled. */}
      {riders.length < MAX ? (
        <div>
          {editing == null && <div style={{ ...label, marginBottom: '.5rem' }}>Add a rider</div>}
          {(editing == null || newUploadOpen) && (
            <BuildOption title="Upload Rider" hint="Upload your pre-made rider as a PDF. It's sent to the host exactly as-is." open={newUploadOpen} onClick={() => toggleNew('upload')}>
              {newUploadOpen && editorBlock}
            </BuildOption>
          )}
          {editing == null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '.7rem', padding: '.6rem .1rem' }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.12)' }} />
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '.68rem', letterSpacing: '.1em', color: MUTED }}>OR</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.12)' }} />
            </div>
          )}
          {(editing == null || newCustomOpen) && (
            <BuildOption title="Create Custom Rider" hint="Build your rider from labeled fields. We generate a branded PDF for the host." open={newCustomOpen} onClick={() => toggleNew('custom')}>
              {newCustomOpen && editorBlock}
            </BuildOption>
          )}
        </div>
      ) : (
        <div style={{ color: MUTED, fontSize: '.78rem' }}>You&rsquo;ve reached the {MAX}-rider limit. Delete one to add another.</div>
      )}
    </div>
  );
}
