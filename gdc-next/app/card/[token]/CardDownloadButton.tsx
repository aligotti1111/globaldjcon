'use client';

// Download the shareable card as a PNG. Captures the card DOM node with
// html2canvas (loaded from CDN on demand) so the downloaded image looks exactly
// like the on-screen card. No server round-trip; works on the public page.

import { useEffect, useRef, useState } from 'react';

// html2canvas attaches itself to window when the CDN script loads.
declare global {
  interface Window { html2canvas?: (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>; }
}

function loadHtml2Canvas(): Promise<NonNullable<Window['html2canvas']>> {
  if (typeof window !== 'undefined' && window.html2canvas) return Promise.resolve(window.html2canvas);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => (window.html2canvas ? resolve(window.html2canvas) : reject(new Error('html2canvas missing')));
    s.onerror = () => reject(new Error('Could not load the download tool.'));
    document.body.appendChild(s);
  });
}

export default function CardDownloadButton({ targetId, fileName, autoOnly = false }: { targetId: string; fileName: string; autoOnly?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function download() {
    setErr(null); setBusy(true);
    try {
      const el = document.getElementById(targetId);
      if (!el) throw new Error('Nothing to download.');
      const html2canvas = await loadHtml2Canvas();
      // useCORS so the DJ's logo (served with CORS headers from storage) doesn't
      // taint the canvas; scale 2 for a crisp image; match the card background.
      const canvas = await html2canvas(el, { backgroundColor: '#0b0b12', scale: 2, useCORS: true });
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url; a.download = fileName.endsWith('.png') ? fileName : `${fileName}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setBusy(false);
    }
  }

  // When the share sheet's "Download" button opens this card with ?download=1,
  // fire the download automatically once html2canvas can run. Guarded so it
  // only ever runs once.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('download') !== '1') return;
    autoRan.current = true;
    const t = setTimeout(() => { download(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On the public card the button is hidden (sharing/downloading is handled by
  // the DJ's share sheet) — the component stays mounted only so ?download=1 can
  // fire the capture above. Still surface an error if that auto-run fails.
  if (autoOnly) {
    return err ? (
      <div style={{ textAlign: 'center', color: '#ff6b6b', fontSize: '.72rem', marginTop: '.6rem' }}>{err}</div>
    ) : null;
  }

  return (
    <div style={{ textAlign: 'center', marginTop: '1rem' }}>
      <button
        type="button"
        onClick={download}
        disabled={busy}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '.45rem',
          background: 'transparent', border: '1px solid rgba(0,224,164,.5)', color: '#00e0a4',
          fontWeight: 700, fontSize: '.8rem', borderRadius: 8, padding: '.55rem 1.1rem',
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {busy ? 'Preparing…' : 'Download Card'}
      </button>
      {err && <div style={{ color: '#ff6b6b', fontSize: '.72rem', marginTop: '.4rem' }}>{err}</div>}
    </div>
  );
}
