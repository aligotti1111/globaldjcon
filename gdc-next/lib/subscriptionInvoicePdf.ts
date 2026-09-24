// lib/subscriptionInvoicePdf.ts
//
// The invoice a DJ downloads for their Global DJ Connect SUBSCRIPTION. This is
// the PLATFORM billing the DJ — so unlike the booking receipt/invoice (which
// carries the DJ's own business header), this one carries the GLOBAL DJ CONNECT
// brand at the top. That's the "logo" the DJ sees on it.
//
// We render our own PDF rather than serving Stripe's hosted invoice PDF so the
// brand header is guaranteed present (Stripe's PDF only shows a logo if one is
// uploaded in the Stripe dashboard's branding settings, which is account-level
// config we can't set from code). pdf-lib is used for the same reason the
// booking docs use it: pure JS, no native binaries, reliable on serverless.
//
// There is no image logo asset in the repo — the brand is a wordmark ("Global
// DJ Connect"), so the header draws it as styled text with the site's neon
// accent, matching how the brand reads everywhere else on the platform.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface SubInvoiceLine {
  /** e.g. "Pro plan — monthly" or "Oct 1 – Nov 1, 2026". */
  label: string;
  amount: number;
}

export interface SubInvoiceOptions {
  /** Human invoice number from Stripe (e.g. "A1B2C3-0001"). */
  number: string;
  /** ISO or already-formatted date shown top-right. */
  dateText: string;
  currency: string;
  /** Who the subscription is billed to — the DJ. */
  billedTo: {
    name?: string | null;
    email?: string | null;
  };
  /** The itemised charges (usually one subscription line). */
  lines: SubInvoiceLine[];
  /** The total, boxed at the bottom, with a status label ("Paid" / "Amount due"). */
  total: { label: string; amount: number };
  /** Optional footer note (period, reference). */
  note?: string | null;
}

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const MARGIN = 48;
const INK = rgb(0.07, 0.07, 0.09);
const MUTED = rgb(0.45, 0.45, 0.5);
const LINE = rgb(0.85, 0.85, 0.88);
// The brand neon, muted a touch for print (matches receiptPdf's accent).
const ACCENT = rgb(0.0, 0.6, 0.45);

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
  }
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) <= maxW) cur = trial;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

export async function buildSubscriptionInvoicePdf(opts: SubInvoiceOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const rightX = PAGE_W - MARGIN;
  let y = PAGE_H - MARGIN;

  const drawL = (t: string, x: number, yy: number, size: number, font = reg, color = INK) =>
    page.drawText(t, { x, y: yy, size, font, color });
  const drawR = (t: string, xRight: number, yy: number, size: number, font = reg, color = INK) =>
    page.drawText(t, { x: xRight - font.widthOfTextAtSize(t, size), y: yy, size, font, color });

  // ── Brand header: GLOBAL DJ CONNECT wordmark (left) + INVOICE title (right) ──
  // A small neon square as a mark, then the wordmark in two weights — the same
  // "Global DJ Connect" lockup used across the site, so the paper reads as ours.
  const markSize = 22;
  page.drawRectangle({ x: MARGIN, y: y - markSize + 2, width: markSize, height: markSize, color: ACCENT });
  // A stylised "G" glyph inside the mark.
  drawL('G', MARGIN + 5.5, y - markSize + 6, 15, bold, rgb(1, 1, 1));
  const wordX = MARGIN + markSize + 10;
  drawL('GLOBAL DJ', wordX, y - 8, 15, bold, INK);
  drawL('CONNECT', wordX, y - 22, 15, bold, ACCENT);
  drawL('globaldjconnect.com', wordX, y - 36, 9, reg, MUTED);

  // Document title + number + date, right-aligned.
  drawR('INVOICE', rightX, y - 8, 26, bold, ACCENT);
  drawR(`Invoice ${opts.number}`, rightX, y - 28, 10.5, reg, MUTED);
  drawR(opts.dateText, rightX, y - 43, 10.5, reg, MUTED);

  y -= 58;

  // Divider.
  page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 1, color: LINE });
  y -= 24;

  // ── Billed to ──
  drawL('BILLED TO', MARGIN, y, 8.5, bold, MUTED);
  let ly = y - 15;
  if (opts.billedTo.name) { drawL(opts.billedTo.name, MARGIN, ly, 11.5, bold); ly -= 15; }
  if (opts.billedTo.email) { drawL(opts.billedTo.email, MARGIN, ly, 10, reg, MUTED); ly -= 14; }

  // From (the platform), right column.
  const rightColX = MARGIN + (rightX - MARGIN) / 2 + 20;
  drawL('FROM', rightColX, y, 8.5, bold, MUTED);
  drawL('Global DJ Connect', rightColX, y - 15, 11, bold);
  drawL('globaldjconnect.com', rightColX, y - 29, 10, reg, MUTED);

  y = Math.min(ly, y - 29) - 20;

  // ── Charge table ──
  page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 1, color: LINE });
  y -= 18;
  drawL('DESCRIPTION', MARGIN, y, 8.5, bold, MUTED);
  drawR('AMOUNT', rightX, y, 8.5, bold, MUTED);
  y -= 18;

  for (const row of opts.lines) {
    const lines = wrap(row.label, reg, 10.5, rightX - MARGIN - 110);
    drawL(lines[0], MARGIN, y, 10.5, reg, INK);
    drawR(money(row.amount, opts.currency), rightX, y, 10.5, reg, INK);
    y -= 15;
    for (let i = 1; i < lines.length; i++) { drawL(lines[i], MARGIN, y, 10.5, reg, MUTED); y -= 14; }
  }

  y -= 4;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 1, color: LINE });
  y -= 24;

  // ── Total box ──
  const boxH = 40;
  page.drawRectangle({
    x: MARGIN, y: y - boxH + 12, width: rightX - MARGIN, height: boxH,
    color: rgb(0.96, 0.98, 0.97), borderColor: ACCENT, borderWidth: 1,
  });
  drawL(opts.total.label.toUpperCase(), MARGIN + 14, y - 8, 11, bold, INK);
  drawR(money(opts.total.amount, opts.currency), rightX - 14, y - 12, 18, bold, ACCENT);
  y -= boxH + 18;

  // ── Note ──
  if (opts.note) {
    for (const ln of wrap(opts.note, reg, 9.5, rightX - MARGIN)) {
      drawL(ln, MARGIN, y, 9.5, reg, MUTED);
      y -= 13;
    }
  }

  // ── Footer, pinned to the bottom ──
  const footY = MARGIN;
  page.drawLine({ start: { x: MARGIN, y: footY + 16 }, end: { x: rightX, y: footY + 16 }, thickness: 0.5, color: LINE });
  drawL(`Global DJ Connect · Invoice ${opts.number}`, MARGIN, footY, 8, reg, MUTED);
  drawR('Thank you for subscribing', rightX, footY, 8, reg, MUTED);

  return pdf.save();
}
