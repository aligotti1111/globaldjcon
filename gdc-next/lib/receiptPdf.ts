// lib/receiptPdf.ts
//
// Builds the two documents a DJ hands a client around money:
//   - INVOICE  — "here's what you owe": total, less anything already paid,
//                equals the balance due.
//   - RECEIPT  — "here's what you paid": the payment that just landed, the
//                running total paid, and whatever balance is left.
//
// One generator, one layout, a `kind` flag — so the two can never drift apart
// visually. Both carry the DJ's OWN business header (logo, name, address,
// phone), because this is the DJ's document, not the platform's.
//
// WHY pdf-lib AND NOT A REACT PDF RENDERER
// This runs inside a Netlify serverless function. pdf-lib is pure JS with no
// native binaries and no external font files to bundle — it draws with the 14
// standard PDF fonts that every reader has built in. The declarative renderers
// (@react-pdf, puppeteer/chromium) drag in fonts or a headless browser that
// routinely break serverless builds. A receipt is a few rows of text and lines;
// pdf-lib draws that reliably and ships small.
//
// Everything is defensive: any field can be missing (a DJ with no logo, no
// address, a booking with no venue) and the document still renders cleanly —
// the row just doesn't appear.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export type DocKind = 'invoice' | 'receipt';

export interface DocMoneyLine {
  label: string;
  amount: number;
  /** Render bold (totals) or muted (sub-notes). Default normal. */
  emphasis?: 'bold' | 'muted';
  /** Draw a divider + extra gap ABOVE this row, to break the totals off from
   *  the "due now" ask beneath them. */
  ruleAbove?: boolean;
}

export interface ReceiptDocOptions {
  kind: DocKind;
  /** Overrides the big top-right title (defaults to INVOICE / RECEIPT from
   *  kind). Set to the pipeline stage — "DEPOSIT" / "BALANCE" — so the paper
   *  reads the same word as the column and email it rides with. */
  title?: string | null;
  /** Human document number, e.g. "INV-1042" or "RCPT-1042". */
  docNumber: string;
  /** ISO or already-formatted date string shown top-right. */
  dateText: string;
  currency: string;

  // ── DJ business header (all optional) ──
  business: {
    name?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    /** PNG or JPG bytes for the logo, already fetched. */
    logo?: { bytes: Uint8Array; type: 'png' | 'jpg' } | null;
  };

  // ── Who it's for ──
  client: {
    name?: string | null;
    email?: string | null;
  };

  // ── What it's for ──
  event: {
    title?: string | null;   // e.g. "Wedding Reception"
    dateText?: string | null; // friendly event date
    venue?: string | null;
  };

  /**
   * Booking specifics, as label/value rows. What goes here differs by DJ type
   * and the caller decides — this generator just prints what it's given:
   *   Mobile DJ: package, event type, event/reception time, and (weddings)
   *              cocktail-hour + ceremony times.
   *   Club DJ:   set time and equipment.
   * Any row with a blank value is dropped, so a non-wedding booking simply
   * won't show ceremony/cocktail lines.
   */
  details?: { label: string; value?: string | null }[] | null;

  // ── Money ──
  // The itemised rows shown in the middle table. The caller decides what to
  // put here — for a receipt it's usually the payment + running totals; for an
  // invoice it's the charge, tax, deposit, and balance.
  lines: DocMoneyLine[];
  /** The single number the reader cares about, boxed at the bottom. */
  headline: { label: string; amount: number };
  /**
   * Payment methods the DJ accepts, drawn as brand-coloured badges — logos,
   * not handles. Shown only when money is due (invoices).
   *
   * WHY BADGES AND NOT HANDLES: a PDF is a static record; it can't carry a
   * live "Pay with Card" link, and a bare Venmo @handle on paper is a dead end
   * next to a card option that needs one. So the paper only advertises WHAT is
   * accepted; the working buttons — the Venmo/Zelle links AND the card
   * checkout — live in the EMAIL this document is attached to. We print a line
   * telling the client to use those.
   *
   * `hex` is the brand colour ("#3D95CE" for Venmo, etc.); label is the name.
   */
  acceptedMethods?: { label: string; hex?: string | null; key?: string | null }[] | null;
  /**
   * The caption printed under the method badges. The caller writes it because
   * only it knows the mix: online rails (Venmo/Zelle/Card) are paid via the
   * buttons in the email, but CASH and CHECK are handed over in person on the
   * night — so the line has to say both when both apply. Defaults to the
   * online-only wording if omitted.
   */
  methodsNote?: string | null;
  /** Optional note under everything (thanks, terms, reference). */
  note?: string | null;
}

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const MARGIN = 48;
const INK = rgb(0.07, 0.07, 0.09);
const MUTED = rgb(0.45, 0.45, 0.5);
const LINE = rgb(0.85, 0.85, 0.88);
const ACCENT = rgb(0.0, 0.6, 0.45); // matches the site's teal-ish neon, muted for print

/** "#3D95CE" → pdf-lib rgb. Falls back to the accent teal on anything odd. */
function hexToRgb(hex?: string | null) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return ACCENT;
  const int = parseInt(m[1], 16);
  return rgb(((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255);
}

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
  }
}

// The real payment logos — official single-path marks (source: simple-icons,
// the same data the site's BrandMarks.tsx uses). Drawn as VECTORS via
// drawSvgPath, so there's no image asset to ship, fetch, or have blocked; and
// no recolouring — each mark keeps its own brand hex, used nominatively ("you
// can pay with this"). All authored on a 24×24 viewBox.
// A few brands read better as their APP-ICON tile (a coloured rounded square
// with a white glyph) than as a thin wordmark shrunk to chip height — Venmo's
// lowercase logotype in particular turns to mush at 13px. These render as a
// solid tile + white letter, matching how the icon looks on a phone.
interface BrandTile { bg: string; letter: string }
const BRAND_TILES: Record<string, BrandTile> = {
  venmo: { bg: '#3396FF', letter: 'V' },
};

interface BrandMark { path: string; hex: string }
const BRAND_MARKS: Record<string, BrandMark> = {
  venmo: { hex: '#008CFF', path: "M21.772 13.119C21.505 13.119 21.391 12.868 21.392 12.464 21.392 11.931 21.513 10.889 22.104 10.889 22.371 10.889 22.461 11.132 22.461 11.487 22.461 12.02 22.331 13.119 21.772 13.119ZM22.274 9.742C20.597 9.742 19.869 11.027 19.869 12.4 19.869 13.442 20.29 14.274 21.562 14.274 23.279 14.274 24 12.868 24 11.511 24 10.486 23.538 9.742 22.274 9.742ZM18.441 9.742C17.883 9.742 17.477 9.912 17.048 10.219 16.894 9.944 16.586 9.742 16.116 9.742 15.574 9.742 15.169 9.961 14.869 10.179L14.829 9.815H13.54L12.852 14.169H14.358L14.837 11.116C14.966 11.051 15.16 10.962 15.355 10.962 15.5 10.962 15.622 11.011 15.622 11.229 15.622 11.285 15.606 11.374 15.598 11.447L15.169 14.169H16.667L17.145 11.116C17.283 11.043 17.469 10.962 17.655 10.962 17.801 10.962 17.923 11.011 17.923 11.229 17.923 11.285 17.906 11.374 17.898 11.447L17.469 14.169H18.968L19.429 11.261C19.454 11.108 19.478 10.873 19.478 10.712 19.478 10.13 19.211 9.742 18.441 9.742ZM11.57 9.742C10.995 9.742 10.59 9.961 10.283 10.163L10.266 9.815H8.962L8.273 14.169H9.78L10.258 11.116C10.388 11.051 10.582 10.962 10.776 10.962 10.923 10.962 11.044 11.011 11.044 11.204 11.044 11.285 11.02 11.431 11.012 11.503L10.59 14.169H12.089L12.551 11.261C12.575 11.108 12.6 10.873 12.6 10.712 12.6 10.13 12.332 9.742 11.57 9.742ZM5.939 11.576C5.98 11.091 6.352 10.752 6.636 10.752 6.798 10.752 6.935 10.849 6.935 11.043 6.935 11.447 6.222 11.576 5.939 11.576ZM6.782 9.742C5.178 9.742 4.4 11.132 4.4 12.44 4.4 13.45 4.878 14.257 6.214 14.257 6.741 14.257 7.284 14.144 7.632 13.975L7.818 12.715C7.324 12.965 6.944 13.062 6.547 13.062 6.182 13.062 5.907 12.868 5.907 12.375 6.733 12.367 8.159 12.028 8.159 10.922 8.159 10.235 7.665 9.742 6.782 9.742ZM2.543 10.009C2.632 10.195 2.689 10.421 2.689 10.752 2.689 11.358 2.26 12.246 1.912 12.812L1.539 9.823 0 9.969 0.705 14.169H2.462C3.232 13.159 4.18 11.721 4.18 10.615 4.18 10.268 4.107 9.993 3.945 9.726L2.543 10.009Z" },
  cashapp: { hex: '#00C244', path: "M23.59 3.475C23.074 2.057 21.958 0.941 20.54 0.425 19.23 0.005 18.04 0.005 15.62 0.005H8.36C5.96 0.005 4.75 0.005 3.46 0.405 2.04 0.923 0.923 2.043 0.41 3.465 0 4.765 0 5.965 0 8.365V15.635C0 18.045 0 19.235 0.4 20.535 0.916 21.953 2.032 23.069 3.45 23.585 4.75 23.995 5.95 23.995 8.35 23.995H15.63C18.04 23.995 19.24 23.995 20.53 23.595 21.954 23.08 23.075 21.959 23.59 20.535 24 19.235 24 18.035 24 15.635V8.385C24 5.975 24 4.775 23.59 3.475ZM17.42 8.105L16.49 9.035C16.302 9.21 16.013 9.214 15.82 9.045 14.919 8.284 13.779 7.866 12.6 7.865 11.63 7.865 10.66 8.185 10.66 9.075 10.66 9.975 11.7 10.275 12.9 10.725 15 11.425 16.74 12.305 16.74 14.365 16.74 16.605 15 18.145 12.16 18.315L11.9 19.515C11.853 19.742 11.652 19.905 11.42 19.905H9.63L9.54 19.895C9.273 19.835 9.104 19.572 9.16 19.305L9.44 18.035C8.362 17.765 7.371 17.224 6.56 16.465V16.455C6.47 16.365 6.419 16.243 6.419 16.115 6.419 15.987 6.47 15.865 6.56 15.775L7.56 14.805C7.748 14.628 8.042 14.628 8.23 14.805 9.14 15.665 10.36 16.145 11.62 16.125 12.92 16.125 13.79 15.575 13.79 14.705 13.79 13.835 12.91 13.605 11.25 12.985 9.49 12.355 7.82 11.465 7.82 9.385 7.82 6.965 9.83 5.785 12.21 5.675L12.46 4.445C12.508 4.219 12.71 4.06 12.94 4.065H14.72L14.82 4.075C15.08 4.135 15.25 4.385 15.19 4.645L14.92 6.015C15.82 6.315 16.67 6.785 17.4 7.405L17.42 7.425C17.61 7.625 17.61 7.925 17.42 8.105Z" },
  paypal: { hex: '#002991', path: "M15.607 4.653H8.941L6.645 19.251H1.82L4.862 0H12.857C16.611 0 19.232 2.294 19.33 5.513 18.682 5.035 17.225 4.653 15.608 4.653M22.178 10.199C22.178 13.609 19.168 17.052 15.22 17.052H12.727L11.595 24H6.74L8.585 12.462H12.177C16.385 12.462 19.523 8.828 19.33 5.513 21.086 6.414 22.187 8.225 22.178 10.199M9.653 5.546H16.061C16.968 5.546 18.003 5.768 18.424 6.087 18.229 8.828 15.769 11.57 11.983 11.57H8.714Z" },
  zelle: { hex: '#6D1ED4', path: "M13.559 24H10.718C10.59 24 10.467 23.949 10.376 23.859 10.286 23.768 10.235 23.645 10.235 23.517V20.752H5.638C5.27 20.751 4.973 20.454 4.972 20.086V17.852C4.972 17.703 5.022 17.558 5.114 17.44L13.253 7.058H6.003C5.635 7.058 5.336 6.759 5.336 6.391V3.914C5.336 3.547 5.635 3.248 6.002 3.248H10.232V0.483C10.232 0.217 10.449 0 10.715 0H13.556C13.822 0 14.039 0.217 14.039 0.483V3.248H18.362C18.729 3.248 19.028 3.547 19.028 3.914V6.051C19.028 6.2 18.978 6.344 18.887 6.461L10.697 16.942H18.362C18.729 16.942 19.028 17.241 19.028 17.608V20.085C19.028 20.453 18.73 20.751 18.362 20.752H14.042V23.517C14.042 23.645 13.991 23.768 13.901 23.859 13.81 23.949 13.687 24 13.559 24Z" },
};
// Card = the four networks Stripe accepts, each in its own hex on a white chip
// — "Visa/Mastercard/Amex/Discover" says "everything my clients carry" better
// than the word "Card".
const CARD_NETWORK_MARKS: BrandMark[] = [
  { hex: '#1A1F71', path: "M9.112 8.262L5.97 15.758H3.92L2.374 9.775C2.28 9.407 2.199 9.272 1.913 9.117 1.447 8.864 0.677 8.627 0 8.479L0.046 8.262H3.346C3.792 8.262 4.171 8.586 4.24 9.026L5.057 13.364 7.075 8.262ZM17.145 13.311C17.153 11.332 14.409 11.223 14.428 10.339 14.434 10.07 14.69 9.784 15.25 9.711 15.906 9.649 16.567 9.765 17.163 10.047L17.503 8.457C16.923 8.239 16.309 8.126 15.689 8.124 13.772 8.124 12.423 9.144 12.411 10.603 12.399 11.682 13.374 12.283 14.109 12.643 14.865 13.01 15.119 13.246 15.115 13.574 15.11 14.078 14.513 14.299 13.955 14.308 12.98 14.323 12.415 14.045 11.963 13.835L11.612 15.477C12.065 15.685 12.901 15.867 13.768 15.875 15.805 15.875 17.138 14.869 17.145 13.311M22.206 15.758H24L22.435 8.262H20.779C20.417 8.259 20.09 8.477 19.953 8.812L17.044 15.758H19.08L19.485 14.638H21.973ZM20.043 13.102L21.063 10.287 21.651 13.102ZM11.883 8.262L10.28 15.758H8.34L9.945 8.262Z" },
  { hex: '#EB001B', path: "M11.343 18.031C11.401 18.08 11.463 18.129 11.524 18.177 10.347 18.96 8.934 19.415 7.417 19.415 3.32 19.416 0 16.096 0 12 0 7.905 3.32 4.584 7.416 4.584 8.934 4.584 10.347 5.04 11.521 5.822 11.461 5.873 11.401 5.92 11.356 5.972 9.6 7.489 8.595 9.688 8.595 12 8.595 14.311 9.596 16.51 11.343 18.031ZM16.584 4.584C15.064 4.584 13.653 5.04 12.479 5.822 12.539 5.873 12.599 5.92 12.644 5.972 14.4 7.489 15.405 9.688 15.405 12 15.405 14.31 14.404 16.507 12.657 18.031 12.599 18.08 12.537 18.129 12.476 18.177 13.653 18.96 15.064 19.415 16.583 19.415 20.68 19.416 24 16.096 24 12 24 7.906 20.68 4.584 16.584 4.584ZM12 6.174C11.904 6.249 11.811 6.324 11.72 6.405 10.156 7.764 9.169 9.765 9.169 12 9.169 14.236 10.156 16.236 11.72 17.595 11.81 17.675 11.905 17.753 12 17.827 12.096 17.753 12.189 17.675 12.28 17.595 13.843 16.236 14.831 14.236 14.831 12 14.831 9.765 13.844 7.764 12.28 6.405 12.19 6.325 12.096 6.249 12 6.174Z" },
  { hex: '#2E77BC', path: "M16.015 14.378C16.015 14.058 15.88 13.882 15.671 13.756 15.461 13.636 15.207 13.621 14.861 13.621H13.318V16.441H13.993V15.414H14.713C14.953 15.414 15.103 15.438 15.191 15.539 15.311 15.669 15.295 15.919 15.295 16.089V16.439H15.955V15.884C15.953 15.634 15.938 15.508 15.847 15.368 15.787 15.288 15.667 15.188 15.517 15.134L15.537 15.126C15.717 15.054 16.017 14.829 16.017 14.379ZM15.145 14.785L15.117 14.783C15.027 14.836 14.922 14.841 14.787 14.841H13.977V14.211H14.801C14.921 14.211 15.041 14.211 15.131 14.261 15.229 14.309 15.287 14.408 15.281 14.516 15.281 14.636 15.236 14.731 15.147 14.786ZM20.297 15.837H19V16.437H20.304C20.98 16.437 21.354 16.159 21.354 15.553 21.354 15.273 21.288 15.105 21.167 14.971 21.014 14.838 20.775 14.778 20.437 14.764L20.061 14.749C19.957 14.749 19.881 14.749 19.806 14.719 19.716 14.689 19.656 14.614 19.656 14.509 19.656 14.419 19.673 14.343 19.746 14.299 19.829 14.253 19.923 14.233 20.018 14.239H21.248V13.637H19.898C19.194 13.637 18.94 14.074 18.94 14.477 18.94 15.377 19.716 15.332 20.347 15.347 20.451 15.347 20.527 15.362 20.572 15.407 20.618 15.437 20.654 15.513 20.654 15.587 20.654 15.664 20.619 15.737 20.574 15.767 20.514 15.82 20.424 15.837 20.297 15.837ZM0 0V10.096L0.81 8.22H2.56L2.785 8.684V8.22H4.828L5.278 9.24 5.715 8.227H12.217C12.512 8.227 12.777 8.284 12.973 8.463V8.233H14.76V8.463C15.067 8.293 15.446 8.233 15.88 8.233H18.486L18.726 8.699V8.233H20.644L20.898 8.698V8.232H22.756V12.18H20.87L20.51 11.58V12.165H18.157L17.901 11.535H17.318L17.048 12.149H15.835C15.355 12.149 14.995 12.045 14.755 11.909V12.149H11.865V11.265C11.865 11.145 11.835 11.145 11.76 11.13H11.655V12.166H6.067V11.686L5.857 12.166H4.69L4.488 11.686V12.151H2.235L1.979 11.527H1.4L1.144 12.151H0V24H23.786V16.892C23.516 17.027 23.173 17.072 22.813 17.072H21.09V16.817C20.88 16.982 20.52 17.072 20.176 17.072H14.71V16.172C14.71 16.052 14.692 16.052 14.59 16.052H14.515V17.074H12.715V16.008C12.417 16.144 12.072 16.158 11.787 16.144H11.573V17.059H9.393L8.853 16.442 8.283 17.042H4.742V13.112H8.352L8.87 13.714 9.424 13.114H11.836C12.116 13.114 12.576 13.144 12.778 13.339V13.099H14.955C15.157 13.099 15.599 13.144 15.858 13.324V13.084H19.123V13.324C19.286 13.16 19.631 13.084 19.926 13.084H21.816V13.324C22.01 13.174 22.28 13.084 22.656 13.084H23.832V0H0ZM23.828 13.082H23.893V13.637H23.828ZM23.865 15.03V15.025C23.835 15 23.819 14.977 23.79 14.955 23.64 14.802 23.4 14.74 23.026 14.73L22.666 14.718C22.546 14.718 22.472 14.711 22.396 14.688 22.306 14.658 22.246 14.583 22.246 14.478 22.246 14.388 22.276 14.318 22.336 14.274 22.412 14.229 22.486 14.224 22.606 14.224H23.829V13.636H22.546C21.856 13.636 21.586 14.073 21.586 14.476 21.586 15.376 22.366 15.331 22.996 15.346 23.1 15.346 23.176 15.361 23.22 15.406 23.266 15.436 23.296 15.512 23.296 15.586 23.296 15.656 23.262 15.724 23.206 15.766 23.161 15.822 23.07 15.836 22.936 15.836H21.648V16.441H22.935C23.355 16.441 23.669 16.323 23.835 16.081H23.865C23.955 15.947 24 15.781 24 15.558 24 15.318 23.955 15.168 23.865 15.032ZM18.597 14.208V13.625H16.362V16.458H18.597V15.873H17.027V15.303H18.56V14.719H17.028V14.209M13.51 8.787H14.195V11.6H13.511ZM13.126 9.543L13.119 9.549C13.119 9.235 12.989 9.049 12.779 8.925 12.562 8.8 12.309 8.79 11.969 8.79H10.43V11.61H11.104V10.576H11.824C12.064 10.576 12.214 10.606 12.311 10.696 12.433 10.832 12.418 11.074 12.418 11.244V11.598H13.095V11.045C13.095 10.795 13.079 10.67 12.985 10.529 12.895 10.422 12.783 10.339 12.655 10.292 12.827 10.222 13.127 9.992 13.127 9.542ZM12.271 9.939H12.256C12.166 9.993 12.061 9.995 11.926 9.995H11.1V9.372H11.925C12.045 9.372 12.165 9.376 12.255 9.422 12.345 9.462 12.405 9.55 12.405 9.672S12.358 9.892 12.271 9.938ZM15.92 9.373H16.552V8.773H15.908C15.444 8.773 15.104 8.878 14.888 9.103 14.602 9.403 14.526 9.793 14.526 10.213 14.526 10.725 14.649 11.046 14.886 11.287 15.118 11.525 15.531 11.597 15.856 11.597H16.636L16.891 10.97H18.281L18.543 11.597H19.903V9.487L21.175 11.597H22.125L22.127 11.599V8.786H21.443V10.749L20.263 8.789H19.243V11.4L18.11 8.744H17.106L16.163 10.964H15.863C15.686 10.964 15.501 10.934 15.395 10.83 15.27 10.68 15.209 10.47 15.209 10.168 15.209 9.883 15.289 9.658 15.403 9.538 15.536 9.403 15.675 9.373 15.919 9.373ZM17.588 9.265L18.052 10.383V10.385H17.122L17.588 9.265ZM2.38 10.97L2.634 11.598H4V9.393L4.972 11.598H5.556L6.529 9.396 6.544 11.598H7.234V8.788H6.118L5.311 10.692 4.435 8.787H3.343V11.45L2.205 8.787H1.208L0.01 11.597H0.73L0.99 10.971H2.38ZM1.692 9.265L2.152 10.383 2.149 10.385H1.234L1.691 9.265ZM11.856 13.62H9.714L8.864 14.543 8.039 13.621H5.346V16.441H8L8.855 15.509 9.679 16.439H10.981V15.499H11.819C12.419 15.499 12.989 15.335 12.989 14.554L12.983 14.551C12.983 13.771 12.385 13.621 11.855 13.621ZM7.67 15.853L7.656 15.851H6.02V15.294H7.49V14.72H6.02V14.21H7.7L8.433 15.03 7.669 15.854ZM10.312 16.183L9.282 15.036 10.312 13.928V16.181ZM11.865 14.925H10.98V14.208H11.865C12.105 14.208 12.285 14.306 12.285 14.552 12.285 14.795 12.135 14.924 11.865 14.924ZM9.967 9.373V8.787H7.73V11.6H9.967V11.02H8.4V10.456H9.927V9.88H8.4V9.373" },
  { hex: '#FF6000', path: "M14.58 12C14.58 13.117 13.675 14.023 12.558 14.023 11.441 14.023 10.535 13.118 10.534 12.001 10.533 10.884 11.438 9.978 12.555 9.977H12.557C13.675 9.977 14.58 10.883 14.58 12ZM9.38 9.999C8.256 9.999 7.355 10.883 7.355 11.989 7.355 13.107 8.233 13.973 9.362 13.973 9.681 13.973 9.955 13.91 10.292 13.752V12.879C9.996 13.176 9.733 13.295 9.397 13.295 8.65 13.295 8.12 12.753 8.12 11.983 8.12 11.253 8.667 10.677 9.363 10.677 9.717 10.677 9.985 10.803 10.293 11.105V10.232C10.013 10.079 9.699 9.999 9.38 9.999ZM6.028 11.544C5.583 11.379 5.452 11.271 5.452 11.065 5.452 10.826 5.685 10.643 6.005 10.643 6.227 10.643 6.41 10.734 6.603 10.951L6.991 10.443C6.684 10.169 6.286 10.019 5.874 10.021 5.201 10.021 4.688 10.488 4.688 11.11 4.688 11.634 4.927 11.902 5.624 12.153 5.915 12.256 6.062 12.324 6.137 12.37 6.275 12.453 6.36 12.603 6.359 12.764 6.359 13.072 6.114 13.3 5.783 13.3 5.429 13.3 5.144 13.123 4.974 12.793L4.495 13.254C4.837 13.756 5.247 13.978 5.812 13.978 6.583 13.978 7.123 13.465 7.123 12.729 7.121 12.126 6.871 11.853 6.028 11.544ZM3.472 13.887H4.214V10.084H3.472V13.887ZM16.174 12.639L15.16 10.085H14.35L15.964 13.985H16.363L18.006 10.085H17.202L16.174 12.639ZM18.34 13.887H20.444V13.243H19.082V12.216H20.394V11.572H19.082V10.728H20.444V10.084H18.34V13.887ZM20.872 10.084V13.887H21.613V12.359H21.71L22.737 13.887H23.648L22.451 12.285C23.009 12.172 23.317 11.79 23.317 11.207 23.317 10.495 22.826 10.084 21.971 10.084ZM21.613 10.644H21.841C22.303 10.644 22.554 10.837 22.554 11.207 22.554 11.589 22.303 11.795 21.83 11.795H21.613ZM12.555 9.977C11.438 9.978 10.533 10.884 10.534 12.001 10.535 13.118 11.441 14.023 12.558 14.023 13.675 14.023 14.58 13.117 14.58 12 14.581 11.463 14.368 10.948 13.988 10.568 13.608 10.188 13.092 9.976 12.555 9.977Z" },
];

/** Wrap `text` to a pixel width, returning the lines. Prevents overflow on a
 *  long venue name or address without measuring guesswork. */
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

export async function buildDocumentPdf(opts: ReceiptDocOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const boldOblique = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);

  const rightX = PAGE_W - MARGIN;
  let y = PAGE_H - MARGIN;

  const drawL = (text: string, x: number, yy: number, size: number, font = reg, color = INK) =>
    page.drawText(text, { x, y: yy, size, font, color });
  const drawR = (text: string, xRight: number, yy: number, size: number, font = reg, color = INK) =>
    page.drawText(text, { x: xRight - font.widthOfTextAtSize(text, size), y: yy, size, font, color });

  // ── Header: logo (left) + business block, document title (right) ──
  const isReceipt = opts.kind === 'receipt';
  // The big word top-right. Defaults from kind, but the caller can override so
  // the paper matches the pipeline stage it came from (DEPOSIT / BALANCE),
  // instead of a generic "INVOICE" that would clash with the column names.
  const title = (opts.title && opts.title.trim()) || (isReceipt ? 'RECEIPT' : 'INVOICE');

  let headerBottom = y;

  // Logo, if we were handed bytes.
  let textLeftX = MARGIN;
  if (opts.business.logo) {
    try {
      const img = opts.business.logo.type === 'png'
        ? await pdf.embedPng(opts.business.logo.bytes)
        : await pdf.embedJpg(opts.business.logo.bytes);
      const maxLogoH = 46;
      const scale = Math.min(maxLogoH / img.height, 120 / img.width);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: MARGIN, y: y - h + 6, width: w, height: h });
      textLeftX = MARGIN + w + 14;
    } catch {
      // A bad/oversized image must never sink the whole document — skip it.
      textLeftX = MARGIN;
    }
  }

  // Business text lines beside/under the logo.
  let by = y;
  if (opts.business.name) {
    drawL(opts.business.name, textLeftX, by - 12, 15, bold);
    by -= 20;
  }
  const bizSmall: string[] = [];
  if (opts.business.address) bizSmall.push(opts.business.address);
  const contactBits = [opts.business.phone, opts.business.email].filter(Boolean) as string[];
  if (contactBits.length) bizSmall.push(contactBits.join('  ·  '));
  for (const raw of bizSmall) {
    for (const ln of wrap(raw, reg, 9.5, 280)) {
      drawL(ln, textLeftX, by - 10, 9.5, reg, MUTED);
      by -= 13;
    }
  }
  headerBottom = Math.min(headerBottom - 46, by);

  // Document title + number + date, right-aligned.
  drawR(title, rightX, y - 20, 26, bold, ACCENT);
  drawR(opts.docNumber, rightX, y - 38, 11, reg, MUTED);
  drawR(opts.dateText, rightX, y - 53, 11, reg, MUTED);

  y = headerBottom - 12;

  // Divider.
  page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 1, color: LINE });
  y -= 24;

  // ── Bill-to + event, two columns ──
  const colGap = 24;
  const colW = (rightX - MARGIN - colGap) / 2;
  const leftColX = MARGIN;
  const rightColX = MARGIN + colW + colGap;
  const topY = y;

  drawL(isReceipt ? 'RECEIVED FROM' : 'BILL TO', leftColX, y, 8.5, bold, MUTED);
  let ly = y - 15;
  if (opts.client.name) { drawL(opts.client.name, leftColX, ly, 11.5, bold); ly -= 15; }
  if (opts.client.email) { drawL(opts.client.email, leftColX, ly, 10, reg, MUTED); ly -= 14; }

  drawL('EVENT', rightColX, topY, 8.5, bold, MUTED);
  let ry = topY - 15;
  const evLines: string[] = [];
  if (opts.event.title) evLines.push(opts.event.title);
  if (opts.event.dateText) evLines.push(opts.event.dateText);
  if (opts.event.venue) evLines.push(opts.event.venue);
  for (const raw of evLines) {
    for (const ln of wrap(raw, reg, 10.5, colW)) {
      drawL(ln, rightColX, ry, 10.5, reg);
      ry -= 14;
    }
  }

  y = Math.min(ly, ry) - 16;

  // ── Booking details (package / times / equipment) ──
  const details = (opts.details || []).filter((d) => d && d.label && d.value);
  if (details.length) {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 1, color: LINE });
    y -= 18;
    drawL('DETAILS', MARGIN, y, 8.5, bold, MUTED);
    y -= 15;
    const labelColW = 130;
    const valX = MARGIN + labelColW;
    for (const d of details) {
      drawL(d.label, MARGIN, y, 10, reg, MUTED);
      const valLines = wrap(String(d.value), reg, 10, rightX - valX);
      drawL(valLines[0], valX, y, 10, reg, INK);
      y -= 14;
      for (let i = 1; i < valLines.length; i++) {
        drawL(valLines[i], valX, y, 10, reg, INK);
        y -= 14;
      }
    }
    y -= 6;
  }

  // ── Money table ──
  page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 1, color: LINE });
  y -= 20;

  for (const row of opts.lines) {
    if (row.ruleAbove) {
      y -= 6;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 1, color: LINE });
      y -= 14;
    }
    const font = row.emphasis === 'bold' ? bold : reg;
    const color = row.emphasis === 'muted' ? MUTED : INK;
    drawL(row.label, MARGIN, y, row.emphasis === 'bold' ? 11.5 : 10.5, font, color);
    drawR(money(row.amount, opts.currency), rightX, y, row.emphasis === 'bold' ? 11.5 : 10.5, font, color);
    y -= row.emphasis === 'bold' ? 20 : 17;
  }

  y -= 4;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 1, color: LINE });
  y -= 24;

  // ── Headline box (balance due / amount paid) ──
  const boxH = 40;
  page.drawRectangle({
    x: MARGIN, y: y - boxH + 12, width: rightX - MARGIN, height: boxH,
    color: rgb(0.96, 0.98, 0.97), borderColor: ACCENT, borderWidth: 1,
  });
  drawL(opts.headline.label.toUpperCase(), MARGIN + 14, y - 8, 11, bold, INK);
  drawR(money(opts.headline.amount, opts.currency), rightX - 14, y - 12, 18, bold, ACCENT);
  y -= boxH + 18;

  // ── Payment methods accepted — brand badges (invoices only) ──
  const methods = (opts.acceptedMethods || []).filter((m) => m && m.label);
  if (methods.length) {
    drawL('PAYMENT METHODS ACCEPTED', MARGIN, y, 8.5, bold, MUTED);
    y -= 18;

    // White chips carrying the REAL brand logo + name — the way accepted
    // methods appear at any checkout. White (not the brand colour) because
    // these marks are authored in their own hex: on a coloured tile Visa's navy
    // and Amex's blue would vanish, and recolouring them white breaks the brand
    // guidelines. A white chip keeps every mark true and legible.
    const badgeH = 22;
    const padX = 8;
    const gap = 8;
    const labelSize = 9;
    const logoSize = 13;
    const logoGap = 5;
    let bx = MARGIN;
    for (const m of methods) {
      const label = m.label;
      const key = (m.key || '').toLowerCase();
      const isCard = key === 'card';
      const tile = isCard ? undefined : BRAND_TILES[key];
      const mark = tile ? undefined : BRAND_MARKS[key];
      const labelW = bold.widthOfTextAtSize(label, labelSize);
      const logoW = isCard
        ? CARD_NETWORK_MARKS.length * (logoSize + 3)
        : (tile || mark) ? logoSize + logoGap : 0;
      const w = padX * 2 + logoW + labelW;
      // Wrap to a new row rather than run off the right edge.
      if (bx + w > rightX && bx > MARGIN) {
        bx = MARGIN;
        y -= badgeH + gap;
      }
      const chipBottom = y - badgeH + 5;
      const chipMid = chipBottom + badgeH / 2;
      page.drawRectangle({
        x: bx, y: chipBottom, width: w, height: badgeH,
        color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 0.75,
      });
      // drawSvgPath places the path's (0,0) at (x,y) and draws DOWNWARD (SVG
      // y-convention), so the top of a `logoSize`-tall glyph sits at
      // chipMid + logoSize/2 to end up vertically centred.
      let cx = bx + padX;
      const logoTopY = chipMid + logoSize / 2;
      if (isCard) {
        for (const nm of CARD_NETWORK_MARKS) {
          page.drawSvgPath(nm.path, { x: cx, y: logoTopY, scale: logoSize / 24, color: hexToRgb(nm.hex) });
          cx += logoSize + 3;
        }
      } else if (tile) {
        // App-icon tile: solid rounded square + white glyph.
        const ty = chipMid - logoSize / 2;
        page.drawRectangle({
          x: cx, y: ty, width: logoSize, height: logoSize,
          color: hexToRgb(tile.bg), borderColor: hexToRgb(tile.bg), borderWidth: 0,
        });
        const ls = logoSize * 0.82;
        const lw = boldOblique.widthOfTextAtSize(tile.letter, ls);
        page.drawText(tile.letter, {
          x: cx + (logoSize - lw) / 2 - ls * 0.04,
          y: ty + (logoSize - ls) / 2 + ls * 0.16,
          size: ls, font: boldOblique, color: rgb(1, 1, 1),
        });
        cx += logoSize + logoGap;
      } else if (mark) {
        page.drawSvgPath(mark.path, { x: cx, y: logoTopY, scale: logoSize / 24, color: hexToRgb(mark.hex) });
        cx += logoSize + logoGap;
      }
      page.drawText(label, {
        x: cx, y: chipMid - labelSize / 2 + 1,
        size: labelSize, font: bold, color: INK,
      });
      bx += w + gap;
    }
    y -= badgeH + 6;

    // The one thing that makes the static badges actionable: online rails are
    // paid via the email's live buttons; cash/check in person. The caller
    // supplies the exact wording for the method mix.
    const cap = opts.methodsNote
      || 'To pay, use the payment buttons in the email this invoice was sent with.';
    for (const ln of wrap(cap, reg, 9.5, rightX - MARGIN)) {
      drawL(ln, MARGIN, y, 9.5, reg, MUTED);
      y -= 13;
    }
    y -= 6;
  }

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
  const footLeft = opts.business.name ? `${opts.business.name} · ${opts.docNumber}` : opts.docNumber;
  drawL(footLeft, MARGIN, footY, 8, reg, MUTED);
  drawR('via Global DJ Connect', rightX, footY, 8, reg, MUTED);

  return pdf.save();
}
