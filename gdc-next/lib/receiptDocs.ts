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
import { isFullName, normalizeName } from './fullName';

const round2 = (n: number) => Number((Number.isFinite(n) ? n : 0).toFixed(2));

// Currency formatter for inline labels (e.g. the per-hour overtime rate). The
// money COLUMN is formatted by the PDF itself; this is only for label text.
function fmtCur(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `$${Number(n).toLocaleString()}`;
  }
}

// Brand colours for the accepted-method badges — the same palette the payment
// emails use, so paper and email match.
const METHOD_META: Record<string, { label: string; hex: string; inPerson?: boolean }> = {
  venmo: { label: 'Venmo', hex: '#3D95CE' },
  cashapp: { label: 'Cash App', hex: '#00D632' },
  paypal: { label: 'PayPal', hex: '#003087' },
  zelle: { label: 'Zelle', hex: '#6D1ED4' },
  cash: { label: 'Cash', hex: '#4B5563', inPerson: true },
  check: { label: 'Check', hex: '#4B5563', inPerson: true },
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
export async function fetchLogo(url?: string | null): Promise<{ bytes: Uint8Array; type: 'png' | 'jpg' } | null> {
  if (!url) return null;
  try {
    // Never let a slow/hung logo host stall the whole document — cap the fetch.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
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
  package_details: string | null;
  set_type: string | null;
  equipment: string | null;
  quoted_rate: number | null;
  tax_pct: number | null;
  tax_amount: number | null;
  total_with_tax: number | null;
  deposit_amount: number | null;
  status_overrides: Record<string, boolean> | null;
  requester_name: string | null;
  requester_id: string | null;
  host_email: string | null;
  // Receipt-only per-kind override snapshots (see db/receipt_overrides.sql).
  // Printed VERBATIM; never recalculated; never read by booking/pipeline math.
  receipt_overrides: Record<string, ReceiptOverride> | null;
}

// A frozen snapshot of what the DJ typed into the Edit Receipt modal for one
// payment kind. Every field is optional — a missing field falls back to the
// value the receipt would otherwise derive.
export interface ReceiptOverride {
  received?: number | null;
  receivedLabel?: string | null;
  total?: number | null;
  paidToDate?: number | null;
  headlineLabel?: string | null;
  /** null here means "show the label with no amount" (e.g. Paid in Full). */
  headlineAmount?: number | null;
  eventType?: string | null;
  packageTitle?: string | null;
  includes?: string | null;
  eventDate?: string | null;
  eventTime?: string | null;
  venue?: string | null;
  /** Extra EVENT lines (e.g. wedding ceremony / cocktail hour), newline-joined.
   *  '' means show none; absent falls back to the derived lines. */
  eventExtra?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
}

interface DjDocRow {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  contract_logo_url: string | null;
  // Receipt-tab override for the address printed on invoices/receipts ONLY.
  // null  -> fall back to the account address (default, backward-compatible)
  // ''    -> the DJ chose to show NO address on receipts
  // 'text'-> use this exact line
  receipt_address: string | null;
  // Receipt accent colour (hex). null -> house teal default.
  receipt_color: string | null;
  // Receipt phone override. null -> account phone; '' -> none; text -> use it.
  receipt_phone: string | null;
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
  /**
   * Overtime charge, added on the day. When present the document is about
   * overtime, not the event balance:
   *   • invoice  → bills the overtime ONLY (hours × rate, plus optional tax).
   *   • receipt  → shows the event total AND the overtime, TOTALED into one
   *                grand total marked paid in full.
   * `tax` is the tax amount already computed (0 when none); `amount` is the
   * overtime total including that tax.
   */
  overtime?: { hours: number; rate: number; tax: number; amount: number };
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
      .select('dj_type, event_type, event_date, venue_name, currency, start_time, end_time, cocktail_needed, cocktail_start_time, cocktail_same_room, ceremony_needed, ceremony_start_time, ceremony_same_room, package_title, package_details, set_type, equipment, quoted_rate, tax_pct, tax_amount, total_with_tax, deposit_amount, status_overrides, requester_name, requester_id, host_email, receipt_overrides')
      .eq('id', args.bookingId)
      .maybeSingle();
    const b = bData as BookingDocRow | null;
    if (!b) return null;

    const { data: dData } = await admin
      .from('users')
      .select('name, address, city, state, zip, phone, contract_logo_url, receipt_address, receipt_color, receipt_phone, payment_methods, stripe_connect_ready')
      .eq('id', args.djId)
      .maybeSingle();
    const dj = dData as DjDocRow | null;
    if (!dj) return null;

    // BILL TO must be the host's FULL name. The booking's requester_name is the
    // name captured on the form and is normally full — but older/manual rows can
    // hold just a first name (or nothing). When it isn't a full name, fall back
    // to the host account's name, which the full-name gate enforces at signup.
    const bookingName = normalizeName(b.requester_name);
    let billToName = bookingName;
    if (!isFullName(bookingName) && b.requester_id) {
      const { data: hData } = await admin
        .from('users')
        .select('name')
        .eq('id', b.requester_id)
        .maybeSingle();
      const hostName = normalizeName((hData as { name: string | null } | null)?.name);
      // Prefer whichever is an actual full name; otherwise keep whatever we have.
      if (isFullName(hostName) || (!bookingName && hostName)) billToName = hostName;
    }

    const currency = args.currency || b.currency || 'USD';
    const isReceipt = args.docKind === 'receipt';
    const isClub = b.dj_type === 'club';

    // Receipt-only override snapshot for THIS kind. Applies only to a normal
    // (non-overtime) receipt — an overtime receipt is a different document and
    // isn't editable here. Every field is printed verbatim with no recalculation;
    // a missing field falls through to the derived value. Small helpers keep the
    // "override wins, else default" choice readable and treat '' as "cleared".
    const ov: ReceiptOverride | null =
      (isReceipt && !args.overtime && b.receipt_overrides && b.receipt_overrides[args.paymentKind]) || null;
    const ovStr = (v: string | null | undefined, fallback: string | null): string | null =>
      (v !== undefined && v !== null) ? (String(v).trim() || null) : fallback;
    const ovNum = (v: number | null | undefined, fallback: number): number =>
      (v !== undefined && v !== null && Number.isFinite(Number(v))) ? Number(v) : fallback;

    // Business address line. The Receipt-tab override (receipt_address) wins:
    //   non-null  -> use it exactly ('' means the DJ chose to show NO address)
    //   null      -> fall back to the account address (the autocomplete stores
    //                the full "street, City, ST zip" in `address`; compose from
    //                the parts for older rows that only have the pieces).
    let accountAddr = (dj.address && dj.address.trim())
      || [dj.city, [dj.state, dj.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      || '';
    // ZIP is required at signup and stored reliably in `zip`, but an older/typed
    // address line may not include it. Append the ZIP so the default account
    // address always shows it, without needing a custom receipt address saved.
    if (dj.zip && String(dj.zip).trim() && accountAddr && !accountAddr.includes(String(dj.zip).trim())) {
      accountAddr = `${accountAddr} ${String(dj.zip).trim()}`;
    }
    // Stack any address (first comma part = street, the rest = city/ST/ZIP) so it
    // renders on multiple lines. Values that already contain newlines (new saves)
    // are left alone so we never re-split a legit "city, ST zip" on its comma.
    const stack = (s: string): string => {
      if (!s || s.includes('\n')) return s;
      const p = s.split(',').map((x) => x.trim()).filter(Boolean);
      return p.length > 1 ? [p[0], p.slice(1).join(', ')].join('\n') : s;
    };
    accountAddr = stack(accountAddr);
    // Custom receipt override wins; a legacy one-line override gets stacked too.
    const addressLine = stack(dj.receipt_address != null ? dj.receipt_address.trim() : accountAddr);
    // Phone printed on the receipt: the override wins ('' -> none), else account phone.
    const phoneLine = dj.receipt_phone != null ? (dj.receipt_phone.trim() || null) : dj.phone;

    const logo = await fetchLogo(dj.contract_logo_url);

    // Package info can carry rich-text HTML — flatten to plain lines for the PDF.
    const stripHtml = (raw: string): string =>
      raw
        .replace(/<\/(p|div|br|li|h[1-6])>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        // Keep each package-detail item on its own line (the PDF honours the
        // newlines and stacks them), rather than joining them into one sentence.
        .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
        .trim();

    // ── Details block (differs by DJ type) ──
    // DETAILS is the PACKAGE only: its name and what it includes (or, for a club
    // DJ, set type + equipment). Event-schedule facts — the reception time and,
    // for weddings, the ceremony + cocktail-hour times — live in the EVENT block
    // across from BILL TO, so they read as "when/where", not "what you bought".
    const details: { label: string; value?: string | null }[] = [];
    const setTime = (b.start_time || b.end_time)
      ? `${fmtTime(b.start_time)}${b.end_time ? ` – ${fmtTime(b.end_time)}` : ''}`
      : '';
    if (isClub) {
      if (b.set_type) details.push({ label: 'Set type', value: b.set_type });
      if (b.equipment) details.push({ label: 'Equipment', value: EQUIPMENT_LABEL[b.equipment] || b.equipment });
    } else {
      // Event Type sits ABOVE the package on the paper. A receipt override, when
      // present, replaces each value verbatim.
      const etLabel = ovStr(ov?.eventType, eventLabel(b.event_type) || null);
      if (etLabel) details.push({ label: 'Event Type', value: etLabel });
      const pkgTitle = ovStr(ov?.packageTitle, b.package_title);
      if (pkgTitle) details.push({ label: 'Package Name', value: pkgTitle });
      const includes = ovStr(ov?.includes, (b.package_details && b.package_details.trim()) ? stripHtml(b.package_details) : null);
      if (includes) details.push({ label: 'Package Includes', value: includes });
    }

    // Wedding ceremony + cocktail-hour times → EVENT block (under the venue).
    const eventExtra: string[] = [];
    const isWedding = (b.event_type || '').includes('wedding');
    // For a wedding the main start/end IS the reception — label it so it reads
    // clearly next to the ceremony + cocktail-hour lines below it. Other events
    // keep the plain time.
    const weddingTimeText = (!isClub && isWedding && setTime) ? `Reception ${setTime}` : '';
    if (!isClub && isWedding && b.ceremony_needed && b.ceremony_start_time) {
      eventExtra.push(`Ceremony ${fmtTime(b.ceremony_start_time)} · ${b.ceremony_same_room ? 'same room as reception' : 'separate room'}`);
    }
    if (!isClub && isWedding && b.cocktail_needed && b.cocktail_start_time) {
      eventExtra.push(`Cocktail hour ${fmtTime(b.cocktail_start_time)} · ${b.cocktail_same_room ? 'same room as reception' : 'separate room'}`);
    }

    // ── Money lines + headline ──
    const services = round2(Number(b.quoted_rate ?? 0));
    const tax = round2(Number(b.tax_amount ?? 0));
    const taxPct = Number(b.tax_pct ?? 0);
    const total = round2(Number(b.total_with_tax ?? services + tax));
    const paidToDate = round2(Number(args.paidToDate ?? 0));
    const lines: DocMoneyLine[] = [];
    let headline: { label: string; amount: number; hideAmount?: boolean };
    let acceptedMethods: { label: string; hex?: string | null }[] | undefined;
    let methodsNote: string | undefined;

    // Accepted-method badges, built from what the DJ actually has. Shared by the
    // deposit/balance invoice and the overtime invoice.
    const buildMethods = (): { badges: { label: string; hex: string; key: string }[]; hasOnline: boolean; hasInPerson: boolean } => {
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
      return { badges, hasOnline, hasInPerson };
    };

    const ot = args.overtime;
    if (ot) {
      // ── Overtime document ──
      // Invoice bills the overtime alone (it's what's owed right now). Receipt
      // shows the event total AND the overtime, totaled into one grand total.
      const otSub = round2(Number(ot.hours) * Number(ot.rate));
      const otTax = round2(Number(ot.tax || 0));
      const otAmount = round2(Number(ot.amount ?? otSub + otTax));
      const hrs = Number(ot.hours);
      const hrLabel = `${hrs} hr${hrs === 1 ? '' : 's'}`;
      const otLine = `Overtime — ${hrLabel} × ${fmtCur(Number(ot.rate), currency)}`;
      if (isReceipt) {
        lines.push({ label: 'Event Total', amount: total });
        lines.push({ label: otLine, amount: otSub });
        if (otTax > 0) lines.push({ label: 'Overtime tax', amount: otTax });
        lines.push({ label: 'Total', amount: round2(total + otAmount), emphasis: 'bold', ruleAbove: true });
        headline = { label: 'Paid in Full', amount: 0, hideAmount: true };
      } else {
        lines.push({ label: otLine, amount: otSub });
        if (otTax > 0) lines.push({ label: 'Sales Tax', amount: otTax });
        lines.push({ label: 'Overtime total', amount: otAmount, emphasis: 'bold' });
        headline = { label: 'Overtime Due', amount: otAmount };
        const { badges, hasOnline, hasInPerson } = buildMethods();
        if (badges.length) {
          acceptedMethods = badges;
          const parts: string[] = [];
          if (hasInPerson) parts.push('Cash or check can be paid on the night.');
          if (hasOnline) parts.push('Or pay by any method shown above — include the reference on this invoice in the note.');
          methodsNote = parts.join(' ');
        }
      }
    } else if (isReceipt) {
      // Each printed value starts from the derived default, then an Edit-Receipt
      // override replaces it VERBATIM — nothing is recomputed from an edited
      // field (editing the total does NOT shift the deposit % or the balance).
      const received = round2(ovNum(ov?.received, Number(args.receivedNow ?? 0)));
      const totalShown = round2(ovNum(ov?.total, total));
      const paidShown = round2(ovNum(ov?.paidToDate, paidToDate));
      // Deposit receipts show the deposit as a % of the event total; balance and
      // other receipts get their own plain label. Payment method is intentionally
      // not printed on this line. The % is computed from the DERIVED figures so a
      // later amount edit doesn't move it — the DJ edits the label text to change it.
      const depPct = total > 0 ? Math.round((round2(Number(args.receivedNow ?? 0)) / total) * 100) : 0;
      const defaultReceivedLabel = args.paymentKind === 'deposit'
        ? `Deposit Received (${depPct}%)`
        : args.paymentKind === 'balance'
          ? 'Balance Received'
          : 'Payment Received';
      const receivedLabel = ovStr(ov?.receivedLabel, defaultReceivedLabel) || defaultReceivedLabel;
      // Helper: apply a headline override (label + optional amount) over a default.
      const applyHeadline = (def: { label: string; amount: number; hideAmount: boolean }) => {
        if (ov && (ov.headlineLabel !== undefined || ov.headlineAmount !== undefined)) {
          const hl = ovStr(ov.headlineLabel, def.label) || def.label;
          const hasAmt = ov.headlineAmount !== undefined && ov.headlineAmount !== null && Number.isFinite(Number(ov.headlineAmount));
          // A number shows it; explicit null shows the label with no figure;
          // absent keeps the default amount.
          const amt = hasAmt ? round2(Number(ov.headlineAmount)) : def.amount;
          return { label: hl, amount: amt, hideAmount: ov.headlineAmount === null ? true : def.hideAmount };
        }
        return def;
      };

      if (args.paymentKind === 'deposit') {
        // Deposit receipt — matches the sample: event total, the deposit received
        // in bold, a rule, then the remaining balance; the headline box is the
        // deposit itself (DEPOSIT RECEIVED $X).
        const remainingDep = round2(Math.max(0, totalShown - paidShown));
        lines.push({ label: 'Event Total (incl. tax)', amount: totalShown });
        lines.push({ label: receivedLabel, amount: received, emphasis: 'bold' });
        lines.push({ label: 'Remaining balance', amount: remainingDep, emphasis: 'muted', ruleAbove: true });
        headline = applyHeadline({ label: 'Deposit Received', amount: received, hideAmount: false });
      } else {
        // Balance / other receipt — ALWAYS the full breakdown: event price + tax
        // making up the total, then (a deposit received earlier, if any) and the
        // amount received now. The "Deposit received" line only appears when a
        // deposit was actually taken (paid-to-date minus what just arrived).
        const deposit = round2(Math.max(0, paidShown - received));
        // Split the total into the pre-tax event price and the tax. Prefer the
        // itemized stored figures; if tax wasn't stored as its own amount but a
        // tax RATE is on file, reconstruct both from the total so the receipt
        // still shows tax as its own line. (Totals quoted tax-inclusive but
        // never itemized would otherwise hide the tax entirely.)
        let baseShown = services > 0 ? round2(services) : 0;
        let taxShown = tax > 0 ? round2(tax) : 0;
        if (taxShown <= 0.005 && taxPct > 0.0001) {
          baseShown = round2(totalShown / (1 + taxPct / 100));
          taxShown = round2(totalShown - baseShown);
        } else if (baseShown <= 0.005 && taxShown > 0.005) {
          baseShown = round2(totalShown - taxShown);
        }
        // Show the three-line breakdown only when a real tax figure exists and
        // base + tax reconcile to the total; otherwise a single total line.
        const showTax = taxShown > 0.005 && baseShown > 0.005
          && Math.abs(round2(baseShown + taxShown) - totalShown) < 0.02;
        if (showTax) {
          lines.push({ label: 'Event Total', amount: baseShown, emphasis: 'muted' });
          lines.push({ label: 'Tax', amount: taxShown, emphasis: 'muted' });
          lines.push({ label: 'Total Cost', amount: totalShown, emphasis: 'bold' });
        } else {
          lines.push({ label: 'Event Total', amount: totalShown, emphasis: 'bold' });
        }
        // A deposit paid earlier should show as its own line, with this payment
        // then being only the remaining balance. Normally deposit = what was
        // collected before now (paid-to-date minus this payment). When the
        // deposit was marked complete BY HAND (no ledger row), "received" can
        // arrive as the full total and hide the split — so fall back to the
        // booking's own deposit amount, but ONLY while the deposit is still
        // marked collected. If the DJ later un-marks the deposit, no deposit
        // line should appear even though a deposit_amount is still on file.
        // Skipped entirely when the DJ edited the received figure (verbatim).
        let depositShown = deposit;
        let balanceShown = received;
        if (ov?.received === undefined && depositShown <= 0.005) {
          const bookingDeposit = round2(Number(b.deposit_amount ?? 0));
          const depositMarked = !!(b.status_overrides && b.status_overrides.deposit);
          if (bookingDeposit > 0.005 && depositMarked) {
            depositShown = Math.min(bookingDeposit, round2(Math.max(0, totalShown)));
            balanceShown = round2(Math.max(0, totalShown - depositShown));
          }
        }
        if (depositShown > 0.005) {
          lines.push({ label: 'Deposit received', amount: depositShown, emphasis: 'muted', ruleAbove: true });
          lines.push({ label: receivedLabel, amount: balanceShown, emphasis: 'bold' });
        } else {
          lines.push({ label: receivedLabel, amount: received, emphasis: 'bold', ruleAbove: true });
        }
        const remaining = round2(Math.max(0, totalShown - paidShown));
        const defHeadline = remaining <= 0.005
          ? { label: 'Paid in Full', amount: totalShown, hideAmount: false }
          : { label: 'Balance Remaining', amount: remaining, hideAmount: false };
        headline = applyHeadline(defHeadline);
      }
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
      lines.push({ label: 'Event Total', amount: total, emphasis: 'bold' });
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

      const { badges, hasOnline, hasInPerson } = buildMethods();
      if (badges.length) {
        acceptedMethods = badges;
        const parts: string[] = [];
        if (hasOnline) parts.push('Online methods: use the payment buttons in the email this invoice came with.');
        if (hasInPerson) {
          // A balance can change hands on the night; a deposit is what reserves
          // the date, so it has to be settled ahead of time in person — pointed
          // at the DJ's actual office address + phone when account settings has
          // them, so the client knows exactly where to go.
          if (args.paymentKind === 'deposit') {
            const office = [addressLine, phoneLine].filter((s) => s && String(s).trim()).join(' · ');
            parts.push(office
              ? `Cash or check: in person only. A deposit requires an arranged meeting — office: ${office}.`
              : 'Cash or check: in person only. A deposit requires an arranged meeting.');
          } else {
            parts.push('Cash or check: the balance can be paid in cash or by check the day of the event.');
          }
        }
        methodsNote = parts.join(' ');
      }
    }

    // ── Title / document number / filename — all follow the pipeline stage so
    // the paper reads the same word as the column and email (DEPOSIT / BALANCE
    // / RECEIPT), never a generic "INVOICE". ──
    const isDeposit = !isReceipt && args.paymentKind === 'deposit';
    // An overtime INVOICE reads OVERTIME; an overtime RECEIPT is still a RECEIPT
    // (it's the whole event, paid in full, with the overtime folded in).
    const stage = isReceipt ? 'receipt' : (args.overtime ? 'overtime' : (isDeposit ? 'deposit' : 'balance'));
    const STAGE_META = {
      deposit: { title: 'DEPOSIT', prefix: 'DEP', file: 'Deposit' },
      balance: { title: 'BALANCE', prefix: 'BAL', file: 'Balance' },
      receipt: { title: 'RECEIPT', prefix: 'RCPT', file: 'Receipt' },
      overtime: { title: 'OVERTIME', prefix: 'OT', file: 'Overtime' },
    }[stage];

    // ── Document reference + date ──
    // Use the EXACT same reference the booking card shows (GDC-XXXX-X), so the
    // DJ and host quote one identical code across the card, invoice and receipt.
    const hex = (args.bookingId || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const docNumber = hex.length < 5 ? `GDC-${hex}` : `GDC-${hex.slice(0, 4)}-${hex.slice(4, 5)}`;
    const dateText = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const pdfBytes = await buildDocumentPdf({
      kind: args.docKind,
      title: STAGE_META.title,
      docNumber,
      dateText,
      currency,
      accentHex: dj.receipt_color,
      business: {
        name: dj.name,
        address: addressLine || null,
        phone: phoneLine,
        logo,
      },
      client: {
        name: ovStr(ov?.clientName, billToName || b.requester_name),
        email: ovStr(ov?.clientEmail, args.clientEmail || b.host_email),
      },
      event: {
        title: ovStr(ov?.eventType, eventLabel(b.event_type)),
        dateText: ovStr(ov?.eventDate, friendlyDate(b.event_date)),
        timeText: ovStr(ov?.eventTime, weddingTimeText || setTime || null),
        venue: ovStr(ov?.venue, b.venue_name),
        // Extra lines (ceremony / cocktail). An override replaces them verbatim,
        // split back into lines; '' hides them; absent keeps the derived lines.
        extra: (ov && ov.eventExtra !== undefined && ov.eventExtra !== null)
          ? String(ov.eventExtra).split('\n').map((s) => s.trim()).filter(Boolean)
          : eventExtra,
      },
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
