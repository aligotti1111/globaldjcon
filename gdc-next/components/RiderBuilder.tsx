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

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import RiderEditor from '@/components/RiderEditor';
import RiderView from '@/app/rider/[id]/RiderView';
import { createClient } from '@/lib/supabase/client';
import type { RiderItem, RiderMode } from '@/lib/rider';

/** Best-effort human filename from a stored PDF URL (for the status line). */
function fileNameFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const path = new URL(url, 'https://x').pathname;
    const last = path.split('/').filter(Boolean).pop() || '';
    const name = decodeURIComponent(last);
    return name || 'rider.pdf';
  } catch {
    return 'rider.pdf';
  }
}

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

export default function RiderBuilder({
  mode,
  onModeChange,
  items,
  onItemsChange,
  pdfUrl,
  onPdfUrlChange,
  /** Passed to the upload API so the file is namespaced (optional). */
  bookingId,
  hideChooser,
  /** Optional Rider name field — shown for BOTH modes when a setter is given.
   *  Parents that render their own name input (e.g. the per-booking editor)
   *  simply omit these and nothing extra appears. */
  name,
  onNameChange,
}: {
  mode: RiderMode;
  onModeChange: (m: RiderMode) => void;
  items: RiderItem[];
  onItemsChange: (next: RiderItem[]) => void;
  pdfUrl: string | null;
  onPdfUrlChange: (url: string | null) => void;
  bookingId?: string | null;
  /** When the parent page owns the mode chooser, hide the inline cards. */
  hideChooser?: boolean;
  name?: string;
  onNameChange?: (v: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // The DJ's own brand logo + name, shown as branding at the top and in the
  // host-preview. Fetched here so the parent doesn't have to thread it through.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [djName, setDjName] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('users')
          .select('name, contract_logo_url')
          .eq('id', user.id)
          .maybeSingle();
        if (!alive || !data) return;
        const d = data as { name?: string | null; contract_logo_url?: string | null };
        setLogoUrl(d.contract_logo_url || null);
        setDjName(d.name || '');
      } catch { /* non-fatal — branding just won't show */ }
    })();
    return () => { alive = false; };
  }, []);

  const shownName = pickedName || fileNameFromUrl(pdfUrl);

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
      setPickedName(file.name);
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
      {logoUrl && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '.7rem', marginBottom: '1.3rem',
            paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,.1)',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt="Your logo" style={{ maxHeight: 48, maxWidth: 160, objectFit: 'contain' }} />
          <span style={{ color: MUTED, fontSize: '.76rem' }}>
            Your logo appears at the top of the rider the host sees.
          </span>
        </div>
      )}

      {onNameChange && (
        <div style={{ marginBottom: '1.3rem' }}>
          <div
            style={{
              fontFamily: "'Space Mono', monospace", fontSize: '.7rem',
              letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, marginBottom: '.4rem',
            }}
          >
            Rider name
          </div>
          <input
            type="text"
            value={name || ''}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. House standard, Festival, Small-club minimal"
            maxLength={80}
            style={{
              width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, color: '#fff',
              padding: '.6rem .7rem', fontSize: '.92rem', fontWeight: 700,
            }}
          />
          <div style={{ color: MUTED, fontSize: '.76rem', marginTop: '.35rem' }}>
            Shown to the host and used to label this rider. Applies to both upload and custom modes.
          </div>
        </div>
      )}

      {!hideChooser && (
        <>
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
        </>
      )}

      {mode === 'upload' ? (
        <div>
          {/* The Browse control is always visible: a styled <label> wrapping a
              hidden file input (so there is ALWAYS a clear way to pick/replace
              a PDF), plus a status line showing the current file. */}
          <div
            style={{
              border: '1px dashed rgba(255,255,255,.28)', borderRadius: 12,
              padding: '1.4rem 1.2rem', textAlign: 'center',
            }}
          >
            <div style={{ color: MUTED, fontSize: '.86rem', lineHeight: 1.55, margin: '0 0 .9rem' }}>
              Upload your rider as a PDF. This exact file is attached to the host&rsquo;s email.
            </div>
            <label
              style={{
                display: 'inline-block', background: NEON, color: '#06231b', borderRadius: 8,
                padding: '.6rem 1.3rem', fontSize: '.88rem', fontWeight: 700,
                cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                hidden
                disabled={busy}
                onChange={onPickPdf}
              />
              {busy ? 'Uploading…' : pdfUrl ? 'Browse — replace PDF' : 'Browse for PDF'}
            </label>
            <div style={{ marginTop: '.8rem', fontSize: '.82rem', color: shownName ? '#fff' : MUTED }}>
              {shownName ? (
                <span>
                  <span style={{ color: NEON, fontWeight: 700 }}>Current file:</span> {shownName}
                </span>
              ) : (
                'No file chosen yet.'
              )}
            </div>
            {pdfUrl && (
              <button
                type="button"
                disabled={busy}
                onClick={() => { setPickedName(null); onPdfUrlChange(null); }}
                style={{ marginTop: '.5rem', background: 'transparent', border: 'none', color: MUTED, textDecoration: 'underline', cursor: 'pointer', fontSize: '.8rem' }}
              >
                Remove
              </button>
            )}
          </div>
          {pdfUrl && (
            <iframe
              title="Rider PDF preview"
              src={pdfUrl}
              style={{ width: '100%', height: 620, border: '1px solid rgba(255,255,255,.14)', borderRadius: 10, marginTop: '.9rem', background: '#fff' }}
            />
          )}
          {msg && <div style={{ marginTop: '.6rem', fontSize: '.8rem', color: MUTED }}>{msg}</div>}
        </div>
      ) : (
        <RiderEditor items={items} onChange={onItemsChange} />
      )}

      {/* Preview — opens the rider exactly as the host sees it (logo on top,
          boxes, attachments), from the current unsaved draft. */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.4rem' }}>
        <button
          type="button"
          onClick={() => setShowPreview(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '.45rem',
            background: 'transparent', border: `1.5px solid ${NEON}`, borderRadius: 10,
            color: NEON, padding: '.65rem 1.4rem', fontSize: '.9rem', fontWeight: 800, cursor: 'pointer',
          }}
        >
          👁 Preview rider
        </button>
      </div>

      {showPreview && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShowPreview(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.7)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '2.5rem 1rem',
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: '100%', maxWidth: 760 }}>
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              aria-label="Close preview"
              style={{
                position: 'sticky', top: 0, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.35rem',
                background: '#fff', color: '#0d0d14', border: 'none', borderRadius: 999,
                padding: '.5rem .95rem', fontSize: '.82rem', fontWeight: 800, cursor: 'pointer', zIndex: 2,
              }}
            >
              ✕ Close preview
            </button>
            <div style={{ borderRadius: 16, overflow: 'hidden', marginTop: '.6rem' }}>
              <RiderView
                items={items}
                mode={mode}
                pdfUrl={pdfUrl}
                riderName={name || null}
                djName={djName || 'Your DJ name'}
                logoUrl={logoUrl}
                eventDate={null}
                startTime={null}
                endTime={null}
                eventType={null}
                venueName={null}
                venueAddress={null}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
