'use client';

// RiderEditor — the CUSTOM-mode rider builder, built from draggable BOXES.
//
// A rider is a set of boxes. The three defaults are Technical, Visuals and
// Beverages; the DJ can add more (custom-named) boxes below them. Each box:
//   · has a heading (the section name, or an editable name for custom boxes),
//   · holds { label, value } field rows the DJ types into (a value-only row is
//     just a line of text),
//   · can be REORDERED by native HTML5 drag-and-drop (or the ↑/↓ buttons), and
//   · can be DISABLED via a toggle — a disabled box is dimmed and excluded from
//     the generated host rider / PDF, but its content is preserved.
//
// Purely controlled: it owns no persistence. It reads the flat items array,
// materializes it into ordered boxes (ensuring the defaults exist), and writes
// the flattened result back through onChange on every edit.

import { useState, type ChangeEvent, type DragEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  ensureDefaultBoxes, flattenBoxes, groupRiderBoxes, newRiderId,
  sectionAllowsAttachment, RIDER_ATTACHMENT_MAX_BYTES,
  type RiderBox, type RiderItem,
} from '@/lib/rider';

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';
const BORDER = '1px solid var(--border, rgba(255,255,255,.14))';

export default function RiderEditor({
  items,
  onChange,
}: {
  items: RiderItem[];
  onChange: (next: RiderItem[]) => void;
}) {
  // Materialize the flat array into ordered boxes, guaranteeing the three
  // default boxes are always present (even when empty).
  const boxes = ensureDefaultBoxes(groupRiderBoxes(items));

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  // Per-box attachment upload state, keyed by box id.
  const [attachBusy, setAttachBusy] = useState<Record<string, boolean>>({});
  const [attachMsg, setAttachMsg] = useState<Record<string, string | null>>({});

  function commit(next: RiderBox[]) {
    onChange(flattenBoxes(next));
  }
  function patchBox(id: string, p: Partial<RiderBox>) {
    commit(boxes.map((b) => (b.id === id ? { ...b, ...p } : b)));
  }
  function setBoxItems(id: string, next: RiderItem[]) {
    patchBox(id, { items: next });
  }
  // Each box is a single free-text area. Its text is stored as ONE field row
  // (label empty, value = the text) so newlines/paragraphs are preserved and
  // never collapsed. Legacy boxes that still hold multiple label/value rows are
  // shown as joined lines and fold down to a single text field on first edit.
  function boxText(box: RiderBox): string {
    if (box.items.length === 1 && !box.items[0].label) return box.items[0].value;
    return box.items
      .map((it) => {
        const l = (it.label || '').trim();
        const v = (it.value || '').trim();
        return l && v ? `${l}: ${v}` : (l || v);
      })
      .filter(Boolean)
      .join('\n');
  }
  function setBoxText(box: RiderBox, text: string) {
    const id = box.items[0]?.id || newRiderId();
    setBoxItems(box.id, text.length ? [{ id, section: box.section, label: '', value: text }] : []);
  }
  function addBox() {
    commit([
      ...boxes,
      { id: newRiderId(), section: 'custom', title: 'New section', disabled: false, items: [] },
    ]);
  }
  function removeBox(id: string) {
    commit(boxes.filter((b) => b.id !== id));
  }
  function moveBox(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= boxes.length || to >= boxes.length) return;
    const next = boxes.slice();
    const [b] = next.splice(from, 1);
    next.splice(to, 0, b);
    commit(next);
  }

  // ── One attachment (image or PDF, ≤5MB) on the Technical / Visuals boxes ──
  async function onPickAttachment(box: RiderBox, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isImg = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isImg && !isPdf) { setAttachMsg((m) => ({ ...m, [box.id]: 'Attachment must be an image or PDF.' })); return; }
    if (file.size > RIDER_ATTACHMENT_MAX_BYTES) { setAttachMsg((m) => ({ ...m, [box.id]: 'File is too large (max 5MB).' })); return; }
    setAttachMsg((m) => ({ ...m, [box.id]: null }));
    setAttachBusy((s) => ({ ...s, [box.id]: true }));
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('not signed in');
      const ext = (file.name.split('.').pop() || (isPdf ? 'pdf' : 'bin')).toLowerCase();
      const path = `${user.id}/rider_attachment_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type || (isPdf ? 'application/pdf' : undefined) });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = `${data.publicUrl}?t=${Date.now()}`;
      patchBox(box.id, { attachmentUrl: url, attachmentName: file.name });
    } catch {
      setAttachMsg((m) => ({ ...m, [box.id]: 'Upload failed — try again.' }));
    } finally {
      setAttachBusy((s) => ({ ...s, [box.id]: false }));
    }
  }
  function removeAttachment(box: RiderBox) {
    setAttachMsg((m) => ({ ...m, [box.id]: null }));
    patchBox(box.id, { attachmentUrl: undefined, attachmentName: undefined });
  }

  // ── Native HTML5 drag-and-drop for box reordering ──
  function onDragStart(e: DragEvent<HTMLDivElement>, index: number) {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(index)); } catch { /* some browsers */ }
  }
  function onDragOver(e: DragEvent<HTMLDivElement>, index: number) {
    if (dragIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (index !== overIndex) setOverIndex(index);
  }
  function onDrop(e: DragEvent<HTMLDivElement>, index: number) {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) moveBox(dragIndex, index);
    setDragIndex(null);
    setOverIndex(null);
  }
  function onDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
  }

  const input: React.CSSProperties = {
    minWidth: 0,
    background: 'var(--deep, #000)',
    border: BORDER,
    borderRadius: 8,
    color: 'var(--white,#fff)',
    padding: '.55rem .7rem',
    fontSize: '.9rem',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {boxes.map((box, bi) => {
        const isCustom = box.section === 'custom';
        const isDragging = dragIndex === bi;
        const isOver = overIndex === bi && dragIndex !== null && dragIndex !== bi;
        return (
          <div
            key={box.id}
            draggable
            onDragStart={(e) => onDragStart(e, bi)}
            onDragOver={(e) => onDragOver(e, bi)}
            onDrop={(e) => onDrop(e, bi)}
            onDragEnd={onDragEnd}
            style={{
              border: isOver ? `1.5px solid ${NEON}` : BORDER,
              borderRadius: 12,
              padding: '1rem 1.1rem',
              background: '#000',
              opacity: isDragging ? 0.5 : box.disabled ? 0.55 : 1,
              boxShadow: isOver ? `0 0 0 3px rgba(0,224,164,.15)` : 'none',
              transition: 'opacity .12s ease, border-color .12s ease, box-shadow .12s ease',
            }}
          >
            {/* Box header: drag handle · heading/name · reorder · disable */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.85rem' }}>
              <span
                aria-hidden
                title="Drag to reorder"
                style={{ cursor: 'grab', color: MUTED, fontSize: '1.1rem', lineHeight: 1, userSelect: 'none', flexShrink: 0 }}
              >
                ⠿
              </span>

              {/* Every box title is editable — including the defaults
                  (Technical, Visuals, Beverages, Booth). Renaming persists;
                  leaving a default name unchanged just keeps the default. */}
              <input
                type="text"
                value={box.title}
                onChange={(e) => patchBox(box.id, { title: e.target.value })}
                placeholder="Section name"
                maxLength={40}
                aria-label="Box name"
                style={{
                  ...input, flex: '1 1 auto', fontWeight: 800,
                  fontFamily: "'Space Mono', monospace", letterSpacing: '.04em',
                  color: box.disabled ? MUTED : NEON, textTransform: 'uppercase',
                  fontSize: '1.05rem', padding: '.65rem .8rem',
                }}
              />

              <div style={{ display: 'flex', gap: '.25rem', flexShrink: 0 }}>
                <button type="button" onClick={() => moveBox(bi, bi - 1)} disabled={bi === 0} aria-label="Move box up" title="Move box up" style={ctl(MUTED, bi === 0)}>↑</button>
                <button type="button" onClick={() => moveBox(bi, bi + 1)} disabled={bi === boxes.length - 1} aria-label="Move box down" title="Move box down" style={ctl(MUTED, bi === boxes.length - 1)}>↓</button>
                {isCustom && (
                  <button type="button" onClick={() => removeBox(box.id)} aria-label="Remove box" title="Remove box" style={ctl('#ff6b6b', false)}>✕</button>
                )}
              </div>

              {/* Disable toggle */}
              <button
                type="button"
                role="switch"
                aria-checked={!box.disabled}
                aria-label={box.disabled ? 'Enable box' : 'Disable box'}
                title={box.disabled ? 'Box is off — click to include it' : 'Box is on — click to exclude it'}
                onClick={() => patchBox(box.id, { disabled: !box.disabled })}
                style={{
                  position: 'relative', width: 42, height: 24, borderRadius: 999,
                  border: 'none', cursor: 'pointer', flexShrink: 0, padding: 0,
                  background: box.disabled ? 'rgba(255,255,255,.18)' : NEON,
                  transition: 'background .15s ease',
                }}
              >
                <span style={{
                  position: 'absolute', top: 3, left: box.disabled ? 3 : 21,
                  width: 18, height: 18, borderRadius: '50%', background: '#fff',
                  transition: 'left .15s ease', boxShadow: '0 1px 3px rgba(0,0,0,.4)',
                }} />
              </button>
            </div>

            {box.disabled && (
              <div style={{ color: MUTED, fontSize: '.76rem', fontStyle: 'italic', marginBottom: '.7rem' }}>
                This box is off — it won&rsquo;t appear on the rider sent to the host. Its content is kept.
              </div>
            )}

            <textarea
              value={boxText(box)}
              onChange={(e) => setBoxText(box, e.target.value)}
              placeholder={`Type your ${box.title.toLowerCase()} requirements…`}
              rows={4}
              style={{
                ...input,
                width: '100%',
                resize: 'vertical',
                lineHeight: 1.5,
                minHeight: 90,
                fontFamily: 'inherit',
              }}
            />

            {/* Attachment — Technical + Visuals boxes only. One image or PDF,
                ≤5MB, that travels with the rider (attached to the host email
                and linked on the host page every time it's sent). */}
            {sectionAllowsAttachment(box.section) && (
              <div style={{ marginTop: '.85rem', paddingTop: '.75rem', borderTop: BORDER }}>
                {box.attachmentUrl ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
                    <span aria-hidden style={{ color: NEON, fontSize: '1rem', flexShrink: 0 }}>📎</span>
                    <a
                      href={box.attachmentUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#fff', fontSize: '.84rem', wordBreak: 'break-all', textDecoration: 'underline' }}
                    >
                      {box.attachmentName || 'Attachment'}
                    </a>
                    <button
                      type="button"
                      onClick={() => removeAttachment(box)}
                      aria-label="Remove attachment"
                      style={{ background: 'transparent', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '.8rem', textDecoration: 'underline', padding: 0 }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <label
                      title="Attach a file (image or PDF)"
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '.3rem',
                        background: NEON, border: `1px solid ${NEON}`, borderRadius: 8,
                        color: '#04120d', padding: '.35rem .55rem', fontSize: '.75rem', fontWeight: 800,
                        cursor: attachBusy[box.id] ? 'default' : 'pointer', opacity: attachBusy[box.id] ? 0.6 : 1,
                        boxSizing: 'border-box', whiteSpace: 'nowrap',
                      }}
                    >
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        hidden
                        disabled={!!attachBusy[box.id]}
                        onChange={(e) => onPickAttachment(box, e)}
                      />
                      {attachBusy[box.id] ? '…' : '📎 Attach'}
                    </label>
                  </div>
                )}
                <div style={{ color: MUTED, fontSize: '.72rem', marginTop: '.4rem' }}>
                  One file, max 5MB. Sent with the rider every time. For larger
                  files, add a link through a hosted provider (Google Drive,
                  Dropbox, etc.) as a field above instead.
                </div>
                {attachMsg[box.id] && (
                  <div style={{ color: '#ff9a9a', fontSize: '.76rem', marginTop: '.35rem' }}>{attachMsg[box.id]}</div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={addBox}
        style={{
          alignSelf: 'flex-start', background: 'rgba(0,224,164,.08)', border: `1px dashed ${NEON}`,
          borderRadius: 10, color: NEON, padding: '.6rem 1.1rem', fontSize: '.85rem', fontWeight: 700, cursor: 'pointer',
        }}
      >
        + Add box
      </button>
    </div>
  );
}

function ctl(color: string, disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    border: BORDER,
    borderRadius: 6,
    color,
    width: 30,
    height: 34,
    flexShrink: 0,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.35 : 1,
    fontSize: '.8rem',
    lineHeight: 1,
  };
}
