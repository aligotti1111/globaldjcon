// lib/receiptDocs.ts
//
// Turns a booking + a payment into a ready-to-attach PDF — an INVOICE ("amount
// due") or a RECEIPT ("payment received"). The payments route calls this at
// the two moments it already emails the client, and drops the returned
// attachment onto the Resend send.
//
// It does its OWN fetching (booking, DJ business fields, logo bytes) from the
// ids it's given, so the route stays almost untouched: pass a few values you
// already have, get back { filename, content } or null. Any failure returns
// null — a missing logo or a flaky fetch must never block the email that
// carries the actual pay buttons.

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildDocumentPdf, type DocMoneyLine } from './receiptPdf';

const round2 = (n: number) => Number((Number.isFinite(n) ? n : 0).toFixed(2));

// Brand colours for the accepted-method badges — the same palette the payment
// emails use, so paper and email match.
const METHOD_META: Record<string, { label: string; hex: string; inPerson?: boolean }> = {
  venmo: { label: 'Venmo', hex: '#3D95CE' },
  cashapp: { label: 'Cash App', hex: '#00D632' },
  paypal: { label: 'PayPal', hex: '#003087' },
  zelle: { label: 'Zelle', hex: '#6D1ED4' },
  cash: { label: 'Cash / Check', hex: '#4B5563', inPerson: true },
};

function prettyMethod(type?: string | null): string {
  if (!type) return '';
  if (type === 'card') return 'Card';
  return METHOD_META[type]?.label || (type.charAt(0).toUpperCase() + type.slice(1));
}

const EQUIPMENT_LABEL: Record<string, string> = {
  sound_system: 'Full sound system provided',
  decks_only: 'Decks only (venue provides sound)',
  venue_provides: 'Venue provides all equipment',
};

const EVENT_LABEL: Record<string, string> = {
  weddings: 'Wedding', wedding: 'Wedding', corporate: 'Corporate Event',
  birthday: 'Birthday Party', anniversary: 'Anniversary', graduation: 'Graduation',
  holiday_party: 'Holiday Party', reunion: 'Reunion', school_event: 'School Event',
  community_event: 'Community Event', sweet_16: 'Sweet 16', quinceanera: 'Quinceañera',
  bar_bat_mitzvah: 'Bar/Bat Mitzvah', other: 'Event',
};
function eventLabel(t?: string | null): string {
  if (!t) return 'Event';
  return EVENT_LABEL[t] || t.split(/[_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** "18:30" → "6:30 PM". Passes through anything that already looks formatted. */
function fmtTime(raw?: string | null): string {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/am|pm/i.test(s)) return s.toUpperCase().replace(/\s+/g, ' ');
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return s;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${min} ${ap}`;
}

function friendlyDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Fetch a logo URL into pdf-lib-embeddable bytes. Only PNG/JPG survive — any
 *  other format (or a failed fetch) returns null and the document renders
 *  logo-less. */
async function fetchLogo(url?: string | null): Promise<{ bytes: Uint8Array; type: 'png' | 'jpg' } | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const lower = url.toLowerCase();
    const type: 'png' | 'jpg' | null =
      ct.includes('png') || lower.includes('.png') ? 'png'
      : ct.includes('jpeg') || ct.includes('jpg') || /\.jpe?g(\?|$)/.test(lower) ? 'jpg'
      : null;
    if (!type) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 3_000_000) return null; // sane cap
    return { bytes, type };
  } catch {
    return null;
  }
}

interface BookingDocRow {
  dj_type: 'club' | 'mobile' | null;
  event_type: string | null;
  event_date: string | null;
  venue_name: string | null;
  currency: string | null;
  start_time: string | null;
  end_time: string | null;
  cocktail_needed: boolean | null;
  cocktail_start_time: string | null;
  cocktail_same_room: boolean | null;
  ceremony_needed: boolean | null;
  ceremony_start_time: string | null;
  ceremony_same_room: boolean | null;
  package_title: string | null;
  set_type: string | null;
  equipment: string | null;
  quoted_rate: number | null;
  tax_amount: number | null;
  total_with_tax: number | null;
  requester_name: string | null;
  host_email: string | null;
}

interface DjDocRow {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  contract_logo_url: string | null;
  payment_methods: unknown;
  stripe_connect_ready: boolean | null;
}

export interface BuildDocArgs {
  docKind: 'invoice' | 'receipt';
  bookingId: string;
  djId: string;
  currency: string;
  paymentKind: 'deposit' | 'balance' | 'other';
  /** invoice: the amount being requested. */
  amountDue?: number;
  /** receipt: the amount that just came in, and the method it came by. */
  receivedNow?: number;
  method?: string | null;
  /** Total paid across the whole booking (including this payment). */
  paidToDate?: number;
  /** Client email, so the receipt/invoice can address them if we have it. */
  clientEmail?: string | null;
}

/**
 * Returns a Resend attachment ({ filename, content: base64 }) or null. Never
 * throws — the caller spreads `attachments: att ? [att] : undefined`.
 */
export async function buildBookingDocAttachment(
  admin: SupabaseClient,
  args: BuildDocArgs,
): Promise<{ filename: string; content: string } | null> {
  try {
    const { data: bData } = await admin
      .from('bookings')
      .select('dj_type, event_type, event_date, venue_name, currency, start_time, end_time, cocktail_needed, cocktail_start_time, cocktail_same_room, ceremony_needed, ceremony_start_time, ceremony_same_room, package_title, set_type, equipment, quoted_rate, tax_amount, total_with_tax, requester_name, host_email')
      .eq('id', args.bookingId)
      .maybeSingle();
    const b = bData as BookingDocRow | null;
    if (!b) return null;

    const { data: dData } = await admin
      .from('users')
      .select('name, address, city, state, zip, phone, contract_logo_url, payment_methods, stripe_connect_ready')
      .eq('id', args.djId)
      .maybeSingle();
    const dj = dData as DjDocRow | null;
    if (!dj) return null;

    const currency = args.currency || b.currency || 'USD';
    const isReceipt = args.docKind === 'receipt';
    const isClub = b.dj_type === 'club';

    // Business address line: the autocomplete stores the full "street, City,
    // ST zip" in `address`. Fall back to composing from the parts for older
    // rows that only have the pieces.
    const addressLine = (dj.address && dj.address.trim())
      || [dj.city, [dj.state, dj.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      || '';

    const logo = await fetchLogo(dj.contract_logo_url);

    // ── Details block (differs by DJ type) ──
    const details: { label: string; value?: string | null }[] = [];
    const setTime = (b.start_time || b.end_time)
      ? `${fmtTime(b.start_time)}${b.end_time ? ` – ${fmtTime(b.end_time)}` : ''}`
      : '';
    if (isClub) {
      if (setTime) details.push({ label: 'Set time', value: setTime });
      if (b.set_type) details.push({ label: 'Set type', value: b.set_type });
      if (b.equipment) details.push({ label: 'Equipment', value: EQUIPMENT_LABEL[b.equipment] || b.equipment });
    } else {
      if (b.package_title) details.push({ label: 'Package', value: b.package_title });
      details.push({ label: 'Event type', value: eventLabel(b.event_type) });
      const isWedding = (b.event_type || '').includes('wedding');
      if (isWedding && b.ceremony_needed && b.ceremony_start_time) {
        details.push({ label: 'Ceremony', value: `${fmtTime(b.ceremony_start_time)} · ${b.ceremony_same_room ? 'same room as reception' : 'separate room'}` });
      }
      if (isWedding && b.cocktail_needed && b.cocktail_start_time) {
        details.push({ label: 'Cocktail hour', value: `${fmtTime(b.cocktail_start_time)} · ${b.cocktail_same_room ? 'same room as reception' : 'separate room'}` });
      }
      if (setTime) details.push({ label: isWedding ? 'Reception' : 'Event time', value: setTime });
    }

    // ── Money lines + headline ──
    const services = round2(Number(b.quoted_rate ?? 0));
    const tax = round2(Number(b.tax_amount ?? 0));
    const total = round2(Number(b.total_with_tax ?? services + tax));
    const paidToDate = round2(Number(args.paidToDate ?? 0));
    const lines: DocMoneyLine[] = [];
    let headline: { label: string; amount: number };
    let acceptedMethods: { label: string; hex?: string | null }[] | undefined;
    let methodsNote: string | undefined;

    if (isReceipt) {
      const received = round2(Number(args.receivedNow ?? 0));
      const methodLbl = prettyMethod(args.method);
      lines.push({ label: `Payment received${methodLbl ? ` (${methodLbl})` : ''}`, amount: received });
      lines.push({ label: 'Event total', amount: total, emphasis: 'muted' });
      lines.push({ label: 'Paid to date', amount: paidToDate, emphasis: 'muted' });
      const remaining = round2(Math.max(0, total - paidToDate));
      headline = remaining <= 0.005
        ? { label: 'Paid in Full', amount: 0 }
        : { label: 'Balance Remaining', amount: remaining };
    } else {
      // Invoice — tell the WHOLE story so the client never has to do the math:
      // the full event total, anything already paid, what's due right now, and
      // (for a deposit) what will still be owed afterward. A deposit invoice
      // that shows "$2,000 total" but "$500 due" and says nothing about the
      // other $1,500 just breeds a confused reply-email.
      const services2 = services > 0 ? services : total; // if no split, show total
      const dueNow = round2(Number(args.amountDue ?? Math.max(0, total - paidToDate)));
      lines.push({ label: b.package_title || 'DJ Services', amount: services2 });
      if (tax > 0) lines.push({ label: 'Sales Tax', amount: tax });
      lines.push({ label: 'Event total', amount: total, emphasis: 'bold' });
      // No repeated "due now" row — the headline box below IS that number, so
      // printing it in the table too shows the same figure twice. The table
      // only carries how we get there: what's already paid, or what's still to
      // come after the deposit. A rule sits above the first of those to break
      // it off from the totals.
      if (paidToDate > 0) {
        lines.push({ label: 'Already paid', amount: -paidToDate, emphasis: 'muted', ruleAbove: true });
      }
      if (args.paymentKind === 'deposit') {
        const remainingAfter = round2(Math.max(0, total - paidToDate - dueNow));
        if (remainingAfter > 0.005) {
          lines.push({ label: 'Remaining balance (billed before the event)', amount: remainingAfter, emphasis: 'muted', ruleAbove: paidToDate <= 0 });
        }
      }
      headline = {
        label: args.paymentKind === 'deposit' ? 'Deposit Due Now' : 'Balance Due',
        amount: dueNow,
      };

      // Accepted methods, as brand badges, built from what the DJ actually has.
      const raw = Array.isArray(dj.payment_methods) ? dj.payment_methods : [];
      const seen = new Set<string>();
      const badges: { label: string; hex: string; key: string }[] = [];
      let hasOnline = false;
      let hasInPerson = false;
      for (const m of raw as { type?: string }[]) {
        const meta = m?.type ? METHOD_META[m.type] : undefined;
        if (!meta || seen.has(m.type as string)) continue;
        seen.add(m.type as string);
        // `key` lets the PDF look up the real brand logo (venmo/cashapp/…);
        // cash/check have no brand mark and fall through to a text-only chip.
        badges.push({ label: meta.label, hex: meta.hex, key: m.type as string });
        if (meta.inPerson) hasInPerson = true; else hasOnline = true;
      }
      if (dj.stripe_connect_ready) { badges.push({ label: 'Card', hex: '#0A6F61', key: 'card' }); hasOnline = true; }
      if (badges.length) {
        acceptedMethods = badges;
        const parts: string[] = [];
        if (hasOnline) parts.push('Online methods: use the payment buttons in the email this invoice came with.');
        if (hasInPerson) parts.push('Cash or check: paid in person.');
        methodsNote = parts.join(' ');
      }
    }

    // ── Title / document number / filename — all follow the pipeline stage so
    // the paper reads the same word as the column and email (DEPOSIT / BALANCE
    // / RECEIPT), never a generic "INVOICE". ──
    const isDeposit = !isReceipt && args.paymentKind === 'deposit';
    const stage = isReceipt ? 'receipt' : isDeposit ? 'deposit' : 'balance';
    const STAGE_META = {
      deposit: { title: 'DEPOSIT', prefix: 'DEP', file: 'Deposit' },
      balance: { title: 'BALANCE', prefix: 'BAL', file: 'Balance' },
      receipt: { title: 'RECEIPT', prefix: 'RCPT', file: 'Receipt' },
    }[stage];

    // ── Document number + date ──
    const short = args.bookingId.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();
    const docNumber = `${STAGE_META.prefix}-${short}`;
    const dateText = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const pdfBytes = await buildDocumentPdf({
      kind: args.docKind,
      title: STAGE_META.title,
      docNumber,
      dateText,
      currency,
      business: {
        name: dj.name,
        address: addressLine || null,
        phone: dj.phone,
        logo,
      },
      client: { name: b.requester_name, email: args.clientEmail || b.host_email },
      event: { title: eventLabel(b.event_type), dateText: friendlyDate(b.event_date), venue: b.venue_name },
      details,
      lines,
      headline,
      acceptedMethods,
      methodsNote,
      note: isReceipt
        ? `Thank you. ${docNumber} · ${dateText}.`
        : `Please include ${docNumber} in the payment note.`,
    });

    const filename = `${isReceipt ? 'Receipt' : 'Invoice'}-${docNumber}.pdf`;
    const content = Buffer.from(pdfBytes).toString('base64');
    return { filename, content };
  } catch {
    // Never let a document failure sink the email it rides on.
    return null;
  }
}
