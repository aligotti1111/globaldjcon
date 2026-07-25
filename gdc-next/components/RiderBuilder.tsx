'use client';

// RiderBuilder — the ENTRY STEP for the DJ rider, shared by the Booking
// Settings default builder and the per-booking editor.
//
// The first thing shown is a choice of TWO labeled cards:
//   · "Upload Rider"        — the DJ uploads a pre-made rider as a PDF.
//   · "Create Custom Rider" — the DJ builds a rider from labeled fields.
// The chosen mode is persisted (rider_mode) by the parent; the DJ can switch
// modes at any time (the other mode's data is kept, so switching back doesn't
// lose it).
//
// Fully controlled: it owns no persistence. The parent passes mode / items /
// pdfUrl and their setters; RiderBuilder only handles the PDF upload call to
// /api/rider/upload (which returns a stored URL, logo-upload style).

import { useRef, useState, type ChangeEvent } from 'react';
import RiderEditor from '@/components/RiderEditor';
import type { RiderItem, RiderMode, RiderSection } from '@/lib/rider';

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

export default function RiderBuilder({
  mode,
  onModeChange,
  items,
  onItemsChange,
  pdfUrl,
  onPdfUrlChange,
  sections,
  /** Passed to the upload API so the file is namespaced (optional). */
  bookingId,
}: {
  mode: RiderMode;
  onModeChange: (m: RiderMode) => void;
  items: RiderItem[];
  onItemsChange: (next: RiderItem[]) => void;
  pdfUrl: string | null;
  onPdfUrlChange: (url: string | null) => void;
  sections?: RiderSection[];
  bookingId?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onPickPdf(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setMsg('The rider must be a PDF.');
      return;
    }
    if (file.size > 12 * 1024 * 1024) { setMsg('PDF is too large (max 12MB).'); return; }
    setMsg(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (bookingId) fd.append('bookingId', bookingId);
      const res = await fetch('/api/rider/upload', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !data.ok || !data.url) throw new Error(data.error || 'Upload failed.');
      onPdfUrlChange(data.url);
      setMsg('✓ Rider PDF uploaded.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Upload failed — try again.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const Card = ({ m, title, desc }: { m: RiderMode; title: string; desc: string }) => {
    const active = mode === m;
    return (
      <button
        type="button"
        onClick={() => onModeChange(m)}
        style={{
          flex: 1,
          minWidth: 200,
          textAlign: 'left',
          cursor: 'pointer',
          borderRadius: 12,
          padding: '1rem 1.1rem',
          background: active ? 'rgba(0,224,164,.08)' : 'rgba(255,255,255,.03)',
          border: active ? `1.5px solid ${NEON}` : '1.5px solid rgba(255,255,255,.14)',
          transition: 'border-color .15s ease, background .15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.35rem' }}>
          <span
            aria-hidden
            style={{
              width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
              border: active ? `5px solid ${NEON}` : '2px solid rgba(255,255,255,.35)',
              background: active ? '#06231b' : 'transparent',
            }}
          />
          <span style={{ fontWeight: 800, fontSize: '1rem', color: active ? NEON : '#fff' }}>{title}</span>
        </div>
        <div style={{ color: MUTED, fontSize: '.82rem', lineHeight: 1.5 }}>{desc}</div>
      </button>
    );
  };

  return (
    <div>
      <div
        style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: '.7rem',
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: MUTED,
          marginBottom: '.5rem',
        }}
      >
        How do you want to build this rider?
      </div>
      <div style={{ display: 'flex', gap: '.8rem', flexWrap: 'wrap', marginBottom: '1.3rem' }}>
        <Card m="upload" title="Upload Rider" desc="Upload your pre-made rider as a PDF. It's sent to the host exactly as-is." />
        <Card m="custom" title="Create Custom Rider" desc="Build your rider from labeled fields. We generate a branded PDF for the host." />
      </div>

      {mode === 'upload' ? (
        <div>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={onPickPdf} />
          {pdfUrl ? (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '.8rem', flexWrap: 'wrap',
                border: '1px solid rgba(255,255,255,.14)', borderRadius: 10, padding: '.9rem 1rem',
                background: 'rgba(255,255,255,.03)',
              }}
            >
              <span style={{ fontSize: '1.4rem' }} aria-hidden>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '.9rem' }}>Rider PDF attached</div>
                <a href={pdfUrl} target="_blank" rel="noreferrer" style={{ color: NEON, fontSize: '.8rem', wordBreak: 'break-all' }}>
                  View uploaded PDF
                </a>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                style={{ background: 'rgba(0,224,164,.08)', border: `1px solid ${NEON}`, color: NEON, borderRadius: 8, padding: '.5rem .9rem', fontSize: '.82rem', fontWeight: 700, cursor: 'pointer' }}
              >
                {busy ? 'Uploading…' : 'Replace'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPdfUrlChange(null)}
                style={{ background: 'transparent', border: 'none', color: MUTED, textDecoration: 'underline', cursor: 'pointer', fontSize: '.8rem' }}
              >
                Remove
              </button>
            </div>
          ) : (
            <div
              style={{
                border: '1px dashed rgba(255,255,255,.28)', borderRadius: 12,
                padding: '1.6rem 1.2rem', textAlign: 'center',
              }}
            >
              <div style={{ color: MUTED, fontSize: '.86rem', lineHeight: 1.55, margin: '0 0 .9rem' }}>
                Upload your rider as a PDF. This exact file is attached to the host&rsquo;s email.
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                style={{ background: NEON, border: 'none', color: '#06231b', borderRadius: 8, padding: '.6rem 1.3rem', fontSize: '.88rem', fontWeight: 700, cursor: 'pointer' }}
              >
                {busy ? 'Uploading…' : 'Choose PDF'}
              </button>
            </div>
          )}
          {msg && <div style={{ marginTop: '.6rem', fontSize: '.8rem', color: MUTED }}>{msg}</div>}
        </div>
      ) : (
        <RiderEditor items={items} onChange={onItemsChange} sections={sections} />
      )}
    </div>
  );
}
