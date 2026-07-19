'use client';

// The only interactive thing on the sheet — and a server component can't hand
// a click to anything, so this island exists to own it.
//
// ONE-CLICK DOWNLOAD. The primary action builds a PDF of the whole page right
// in the browser and downloads it — no print dialog, no "save as PDF" detour.
// It does that by pulling html2pdf.js from a CDN the first time it's needed (so
// there's no npm dependency to install), forcing the sheet into its paper
// (black-on-white) styling for the capture, then rendering it to a PDF.
//
// A "Print" link stays as a fallback: some browsers / CSP setups block the CDN
// script, and printing is the belt-and-braces path that always works. If the
// download throws for any reason, we fall back to print automatically.
//
// It prints ITSELF away — see .noPrint / .export .noPrint in the stylesheet. A
// button baked into a downloaded document makes it look like a screenshot of an
// app rather than a document.

import { useEffect, useRef, useState } from 'react';
import styles from './sheet.module.css';

const HTML2PDF_SRC =
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

// Load html2pdf.js once, on demand. Resolves immediately if it's already there.
function ensureHtml2pdf(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { html2pdf?: unknown };
    if (w.html2pdf) return resolve();
    const s = document.createElement('script');
    s.src = HTML2PDF_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the PDF library'));
    document.head.appendChild(s);
  });
}

function safeFilename(): string {
  // document.title is "Run sheet — Global DJ Connect"; strip to something a
  // file system is happy with.
  const base = (document.title || 'run-sheet')
    .replace(/[^\w-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${base || 'run-sheet'}.pdf`;
}

export default function PrintButton() {
  const [busy, setBusy] = useState(false);
  // "Download Planner & Playlist" opens this page with ?download=1 — so the PDF
  // downloads on open, no second click. Guarded so it only fires once even under
  // React's dev double-mount.
  const autoFired = useRef(false);
  // The button wrapper, so we can hide it FROM the capture only (not via a CSS
  // rule that also hides it on the page). On the client's download page the
  // page is already paper-white and stays that way — the buttons just blink out
  // for the snapshot, then come back. No dark flash.
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (autoFired.current) return;
    const wantsDownload = new URLSearchParams(window.location.search).get('download') === '1';
    if (!wantsDownload) return;
    autoFired.current = true;
    // A tick after paint, so the sheet is fully laid out before we capture.
    // This page was opened just to produce the file — once the PDF actually
    // saved, close the throwaway tab and return the user to where they were. We
    // do NOT close if it fell back to the print dialog (that needs the tab).
    const t = setTimeout(() => {
      void download().then((saved) => {
        if (saved) setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 900);
      });
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function download(): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    // Capture the PAGE element itself — it's the node that carries the .export
    // class, so the light styling AND the "hide the buttons" rule both apply to
    // the captured root. (Capturing the inner .sheet failed: the .export class
    // was on its ancestor, so html2canvas rendered it dark with buttons showing
    // and clipped, because the sheet is centred.)
    const page = document.getElementById('runSheet');
    // If the page is already paper-white (the client's download page), leave it
    // that way — only add/remove .export when we had to force it (the DJ's dark
    // sheet). That's what removes the dark flash: light pages stay light.
    const alreadyPaper = !!page?.classList.contains(styles.export);
    try {
      await ensureHtml2pdf();
      if (!page) throw new Error('Nothing to export');

      // Hide the buttons from the snapshot only (not from the page).
      if (wrapRef.current) wrapRef.current.style.visibility = 'hidden';
      // Force the paper (light) styling for the capture, only if it isn't already.
      if (!alreadyPaper) page.classList.add(styles.export);
      // Capture from the very top — html2canvas offsets by the scroll position,
      // so a DJ who scrolled down before clicking would otherwise get a blank or
      // clipped page.
      window.scrollTo(0, 0);
      // Web fonts (Bebas, Inter) must be ready or the text renders wrong/blank.
      const docFonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
      if (docFonts?.ready) { try { await docFonts.ready; } catch { /* ignore */ } }
      // Let the class actually paint before we snapshot.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const w = window as unknown as { html2pdf: () => any };
      await w
        .html2pdf()
        .set({
          margin: [10, 10, 12, 10],
          filename: safeFilename(),
          // PNG, not JPEG — crisp text, no compression fuzz on a dense sheet.
          image: { type: 'png' },
          html2canvas: {
            scale: 2,
            backgroundColor: '#ffffff',
            useCORS: true,
            scrollX: 0,
            scrollY: 0,
            windowWidth: document.documentElement.scrollWidth,
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          // Respect break-inside:avoid so a do-not-play box or a question+answer
          // never splits across two pages.
          pagebreak: { mode: ['css', 'legacy'] },
        })
        .from(page)
        .save();
      return true;
    } catch {
      // CDN blocked, offline, or anything else — the print dialog always works,
      // and its "Save as PDF" is the same result in two clicks instead of one.
      window.print();
      return false;
    } finally {
      if (!alreadyPaper) page?.classList.remove(styles.export);
      if (wrapRef.current) wrapRef.current.style.visibility = '';
      setBusy(false);
    }
  }

  return (
    <div ref={wrapRef} className={`${styles.dlWrap} ${styles.noPrint}`}>
      <button type="button" className={styles.print} onClick={download} disabled={busy}>
        {busy ? 'Preparing…' : 'Download PDF'}
      </button>
      <button type="button" className={styles.printAlt} onClick={() => window.print()}>
        Print
      </button>
    </div>
  );
}
