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

import { useState } from 'react';
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

  async function download() {
    if (busy) return;
    setBusy(true);
    const page = document.getElementById('runSheet');
    const target = (page?.querySelector('[data-sheet]') as HTMLElement | null) || page;
    try {
      await ensureHtml2pdf();
      if (!target) throw new Error('Nothing to export');

      // Force the paper (light) styling for the capture — html2canvas reads the
      // live screen styles, which are dark, so without this the PDF is a page of
      // grey mush.
      page?.classList.add(styles.export);
      // Let the class actually paint before we snapshot.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const w = window as unknown as { html2pdf: () => any };
      await w
        .html2pdf()
        .set({
          margin: [10, 10, 12, 10],
          filename: safeFilename(),
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2,
            backgroundColor: '#ffffff',
            useCORS: true,
            windowWidth: target.scrollWidth,
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          // Respect break-inside:avoid so a do-not-play box or a question+answer
          // never splits across two pages.
          pagebreak: { mode: ['css', 'legacy'] },
        })
        .from(target)
        .save();
    } catch {
      // CDN blocked, offline, or anything else — the print dialog always works,
      // and its "Save as PDF" is the same result in two clicks instead of one.
      window.print();
    } finally {
      page?.classList.remove(styles.export);
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.dlWrap} ${styles.noPrint}`}>
      <button type="button" className={styles.print} onClick={download} disabled={busy}>
        {busy ? 'Preparing…' : 'Download PDF'}
      </button>
      <button type="button" className={styles.printAlt} onClick={() => window.print()}>
        Print
      </button>
    </div>
  );
}
