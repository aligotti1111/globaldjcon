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

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
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
  mode: RiderMode | null;
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
  const [logoBusy, setLogoBusy] = useState(false);
  const logoFileRef = useRef<HTMLInputElement | null>(null);
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
      // Default the rider name to the PDF's filename (minus extension) when the
      // DJ hasn't named it yet — they can still edit it to whatever they want.
      if (onNameChange && !name?.trim()) {
        const base = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
        if (base) onNameChange(base.slice(0, 80));
      }
      setMsg('✓ Rider PDF uploaded.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Upload failed — try again.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // Upload / replace the DJ's business logo right here on the rider page —
  // same storage bucket + /api/dj/logo flow as account settings, so the change
  // shows everywhere the logo appears.
  async function onPickLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMsg('Logo must be an image.'); return; }
    if (file.size > 4 * 1024 * 1024) { setMsg('Logo is too large (max 4MB).'); return; }
    setMsg(null);
    setLogoBusy(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${user.id}/contract_logo_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = `${data.publicUrl}?t=${Date.now()}`;
      const res = await fetch('/api/dj/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'set', url }),
      });
      if (!res.ok) throw new Error('save failed');
      setLogoUrl(url);
      setMsg('✓ Logo saved.');
    } catch {
      setMsg('Logo upload failed — try again.');
    } finally {
      setLogoBusy(false);
      if (logoFileRef.current) logoFileRef.current.value = '';
    }
  }

  // The Rider name field — now lives INSIDE whichever build box is selected.
  const nameField = onNameChange ? (
    <div style={{ marginBottom: '1.1rem' }}>
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
        Shown to the host and used to label this rider.
      </div>
    </div>
  ) : null;

  // The PDF-upload body (used inside the Upload Rider box).
  const uploadBody = (
    <div>
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
          <input ref={fileRef} type="file" accept="application/pdf" hidden disabled={busy} onChange={onPickPdf} />
          {busy ? 'Uploading…' : pdfUrl ? 'Browse — replace PDF' : 'Browse for PDF'}
        </label>
        <div style={{ marginTop: '.8rem', fontSize: '.82rem', color: shownName ? '#fff' : MUTED }}>
          {shownName ? (
            <span><span style={{ color: NEON, fontWeight: 700 }}>Current file:</span> {shownName}</span>
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
  );

  // The custom-builder body (used inside the Create Custom Rider box).
  const customBody = (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '.8rem', marginBottom: '1.1rem',
          padding: '.9rem 1rem', borderRadius: 12,
          background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.12)',
        }}
      >
        <input ref={logoFileRef} type="file" accept="image/*" hidden onChange={onPickLogo} />
        <div
          style={{
            position: 'relative', width: 96, height: 52, flexShrink: 0, borderRadius: 8, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.04)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {logoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt="Your logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              <button
                type="button" disabled={logoBusy} onClick={() => logoFileRef.current?.click()}
                title="Replace logo" aria-label="Replace logo"
                style={{
                  position: 'absolute', top: 3, right: 3, width: 22, height: 22, borderRadius: 6,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                  background: 'rgba(0,0,0,.6)', border: '1px solid rgba(255,255,255,.25)', color: '#fff', cursor: 'pointer',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            </>
          ) : (
            <button
              type="button" disabled={logoBusy} onClick={() => logoFileRef.current?.click()}
              title="Upload logo" aria-label="Upload logo"
              style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 2,
                background: 'transparent', border: 'none', color: MUTED, cursor: 'pointer', fontSize: '.6rem',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {logoBusy ? '…' : 'Logo'}
            </button>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {djName || 'Your DJ name'}
          </div>
          <div style={{ color: MUTED, fontSize: '.74rem', marginTop: 2 }}>
            Your logo and name appear at the top of the rider the host sees.{' '}
            {logoUrl ? 'Tap the pencil to change it.' : 'Upload a logo to show it here.'}
          </div>
        </div>
      </div>
      <RiderEditor items={items} onChange={onItemsChange} />
    </div>
  );

  return (
    <div>
      {hideChooser ? (
        // The parent owns the chooser: render the name field + the active
        // mode's body directly, no boxes.
        <>
          {nameField}
          {mode === 'upload' ? uploadBody : mode === 'custom' ? customBody : null}
        </>
      ) : (
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.7rem' }}>
            <OptionBox active={mode === 'upload'} onSelect={() => onModeChange('upload')} title="Upload Rider" desc="Upload your pre-made rider as a PDF. It's sent to the host exactly as-is.">
              {nameField}
              {uploadBody}
            </OptionBox>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.7rem' }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.12)' }} />
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '.72rem', letterSpacing: '.1em', color: MUTED }}>OR</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.12)' }} />
            </div>
            <OptionBox active={mode === 'custom'} onSelect={() => onModeChange('custom')} title="Create Custom Rider" desc="Build your rider from labeled fields. We generate a branded PDF for the host.">
              {nameField}
              {customBody}
            </OptionBox>
          </div>
        </>
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
                mode={mode ?? 'upload'}
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

// One selectable build option: a clickable header, and — when active — its own
// body (rider name + that mode's controls) nested inside. Defined at MODULE
// scope (not inside RiderBuilder) so it isn't a brand-new component type on every
// render; nesting it inside would remount its children and steal focus from any
// input the DJ is typing in.
function OptionBox({ active, onSelect, title, desc, children }: {
  active: boolean; onSelect: () => void; title: string; desc: string; children: ReactNode;
}) {
  return (
    <div
      style={{
        borderRadius: 12, overflow: 'hidden',
        background: 'rgba(255,255,255,.03)',
        border: active ? `1.5px solid ${NEON}` : '1.5px solid rgba(255,255,255,.14)',
        transition: 'border-color .15s ease, background .15s ease',
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', background: 'transparent', border: 'none', padding: '1rem 1.1rem' }}
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
      {active && <div style={{ padding: '0 1.1rem 1.2rem' }}>{children}</div>}
    </div>
  );
}
