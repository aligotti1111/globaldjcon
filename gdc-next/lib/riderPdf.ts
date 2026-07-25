// lib/riderPdf.ts
//
// Builds the DJ RIDER as a PDF, from the rider's labeled fields — the document
// attached to the host email when the rider is in CUSTOM mode. (In UPLOAD mode
// the DJ's own PDF is attached instead; this generator isn't used.)
//
// WHY pdf-lib: same reasoning as lib/receiptPdf.ts — pure JS, no native
// binaries, no external font files, runs cleanly inside a Netlify serverless
// function. It draws with the 14 standard PDF fonts every reader has built in.
//
// Everything is defensive: any field can be missing (no logo, no venue, an
// empty section) and the document still renders cleanly — the block just
// doesn't appear.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { groupRider, RIDER_SECTIONS, type RiderItem } from './rider';

export interface RiderPdfOptions {
  djName: string;
  /** PNG or JPG bytes for the logo, already fetched. */
  logo?: { bytes: Uint8Array; type: 'png' | 'jpg' } | null;
  eventType?: string | null;
  dateText?: string | null;
  timeText?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  items: RiderItem[];
}

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const MARGIN = 48;
const INK = rgb(0.07, 0.07, 0.09);
const MUTED = rgb(0.45, 0.45, 0.5);
const LINE = rgb(0.85, 0.85, 0.88);
const ACCENT = rgb(0.0, 0.6, 0.45); // the site's teal-ish neon, muted for print

/** Wrap `text` to a pixel width, returning the lines. */
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) <= maxW) {
      cur = trial;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** Strip characters the 14 standard PDF fonts (WinAnsi) can't encode, so a
 *  stray emoji or exotic glyph in a field never throws mid-draw. */
function safe(s: string): string {
  return (s || '').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

export async function buildRiderPdf(opts: RiderPdfOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const rightX = PAGE_W - MARGIN;
  const contentW = rightX - MARGIN;
  let y = PAGE_H - MARGIN;

  const drawL = (text: string, x: number, yy: number, size: number, font = reg, color = INK) =>
    page.drawText(safe(text), { x, y: yy, size, font, color });

  // Add a fresh page and reset the cursor when we run low.
  const ensure = (need: number) => {
    if (y - need < MARGIN + 24) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  // ── Header: logo (centered) + title + DJ + event details ──
  if (opts.logo) {
    try {
      const img = opts.logo.type === 'png'
        ? await pdf.embedPng(opts.logo.bytes)
        : await pdf.embedJpg(opts.logo.bytes);
      const maxH = 60;
      const scale = Math.min(maxH / img.height, 200 / img.width);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (PAGE_W - w) / 2, y: y - h, width: w, height: h });
      y -= h + 14;
    } catch {
      // A bad/oversized image must never sink the document — skip it.
    }
  }

  const title = 'DJ RIDER';
  const tW = bold.widthOfTextAtSize(title, 22);
  drawL(title, (PAGE_W - tW) / 2, y - 20, 22, bold, ACCENT);
  y -= 30;

  if (opts.djName) {
    const nW = reg.widthOfTextAtSize(opts.djName, 12);
    drawL(opts.djName, (PAGE_W - nW) / 2, y - 12, 12, reg, INK);
    y -= 18;
  }

  const evLines: string[] = [];
  if (opts.eventType) evLines.push(opts.eventType);
  const dateTime = [opts.dateText, opts.timeText].filter((s) => s && s.trim()).join('  ·  ');
  if (dateTime) evLines.push(dateTime);
  const venue = [opts.venueName, opts.venueAddress].filter((s) => s && s.trim()).join(' — ');
  if (venue) evLines.push(venue);
  for (const raw of evLines) {
    for (const ln of wrap(raw, reg, 9.5, contentW)) {
      const w = reg.widthOfTextAtSize(ln, 9.5);
      drawL(ln, (PAGE_W - w) / 2, y - 10, 9.5, reg, MUTED);
      y -= 13;
    }
  }
  y -= 10;

  page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 1, color: LINE });
  y -= 26;

  // ── Sections of labeled fields ──
  const g = groupRider(opts.items);
  const labelColW = 150;
  const valX = MARGIN + labelColW;

  for (const { key, label } of RIDER_SECTIONS) {
    const rows = g[key];
    if (!rows.length) continue;

    ensure(28);
    drawL(label.toUpperCase(), MARGIN, y, 9, bold, ACCENT);
    y -= 16;

    for (const it of rows) {
      const lab = (it.label || '').trim();
      const val = (it.value || '').trim();
      // A field with only a value falls back to full-width; with a label it's a
      // two-column label/value row.
      if (lab) {
        const labLines = wrap(lab, bold, 10, labelColW - 10);
        const valLines = val ? wrap(val, reg, 10, rightX - valX) : [''];
        const rowLines = Math.max(labLines.length, valLines.length);
        ensure(rowLines * 14 + 6);
        for (let i = 0; i < rowLines; i++) {
          if (labLines[i]) drawL(labLines[i], MARGIN, y, 10, bold, INK);
          if (valLines[i]) drawL(valLines[i], valX, y, 10, reg, INK);
          y -= 14;
        }
      } else {
        const valLines = wrap(val, reg, 10, contentW - 10);
        ensure(valLines.length * 14 + 6);
        for (const ln of valLines) {
          drawL(`• ${ln}`, MARGIN, y, 10, reg, INK);
          y -= 14;
        }
      }
      y -= 4;
    }
    y -= 10;
  }

  // ── Footer on every page ──
  const pages = pdf.getPages();
  for (const p of pages) {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 16 }, end: { x: rightX, y: MARGIN + 16 }, thickness: 0.5, color: LINE });
    p.drawText(safe(opts.djName ? `${opts.djName} — DJ Rider` : 'DJ Rider'), { x: MARGIN, y: MARGIN, size: 8, font: reg, color: MUTED });
    const via = 'via Global DJ Connect';
    p.drawText(via, { x: rightX - reg.widthOfTextAtSize(via, 8), y: MARGIN, size: 8, font: reg, color: MUTED });
  }

  return pdf.save();
}
