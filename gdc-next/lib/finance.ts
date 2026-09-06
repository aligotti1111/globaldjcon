// lib/finance.ts — the Finance report's money math, kept pure and framework-free
// so it can be unit-tested and reused on both the server (page.tsx) and the
// client (FinanceClient).
//
// THE ONE DISTINCTION THAT MATTERS
//   • Received  — money actually collected and confirmed, across EVERY rail
//                 (card, Venmo, Cash App, PayPal, Zelle, cash, check) plus paid
//                 overtime. This is the honest "earned" number.
//   • Outstanding — invoiced (or "client says they sent it") but not yet
//                 confirmed by the DJ. Money in flight.
//   • Expected  — the remaining agreed amount on ACCEPTED bookings that hasn't
//                 been invoiced yet. Accepted = status 'approved' OR accepted_at
//                 set, which is exactly what an accepted COUNTER-offer becomes,
//                 so counters are included.
//
// TAX
//   Sales tax is a pass-through liability, not income. Each booking freezes a
//   tax snapshot (tax_amount / total_with_tax) at creation. For any collected
//   amount we split it proportionally: taxShare = collected × (tax_amount /
//   total_with_tax). NET (your real earnings) = collected − taxShare. This holds
//   even for partial payments (half paid → half the tax counted as collected).

export interface FinanceBookingInput {
  id: string;
  event_date: string | null;
  status: string | null;
  accepted_at: string | null;
  event_type: string | null;
  venue_name: string | null;
  booking_type: string | null;
  tax_amount: number | null;
  total_with_tax: number | null;
  counter_rate: number | null;
  quoted_rate: number | null;
  offer_amount: number | null;
  currency: string | null;
  overtime_amount: number | null;
  overtime_tax: number | null;
  overtime_paid_at: string | null;
}

export interface FinancePaymentInput {
  id: string;
  booking_id: string;
  kind: string;                 // 'deposit' | 'balance' | 'other'
  amount: number;               // asked for
  amount_paid: number;          // confirmed arrived
  status: string;               // requested | pending_confirmation | partial | paid | waived
  method: string | null;
  currency: string | null;
  confirmed_at: string | null;
  requested_at: string | null;
  marked_sent_at: string | null;
  due_date: string | null;
}

// One confirmed inflow — the atom every chart and total is built from.
export interface ReceivedEvent {
  bookingId: string;
  date: string;                 // YYYY-MM-DD — when the money was confirmed
  gross: number;                // collected (incl. tax)
  net: number;                  // gross − tax portion (your earnings)
  tax: number;                  // tax portion of this inflow
  method: string;               // normalized key (see METHOD_LABELS)
  eventType: string;            // human label, 'Other' when unknown
  venue: string | null;
  kind: string;                 // deposit | balance | other | overtime
  currency: string;
}

export interface Totals {
  gross: number;
  net: number;
  tax: number;
  count: number;
}

const round2 = (n: number) => Number((n || 0).toFixed(2));

export const METHOD_LABELS: Record<string, string> = {
  card: 'Card',
  venmo: 'Venmo',
  cashapp: 'Cash App',
  paypal: 'PayPal',
  zelle: 'Zelle',
  cash: 'Cash',
  check: 'Check',
  overtime: 'Overtime',
  other: 'Other',
};

// A stable colour per method so the pie/legend agree across renders.
export const METHOD_COLORS: Record<string, string> = {
  card: '#635BFF',
  venmo: '#3D95CE',
  cashapp: '#00D632',
  paypal: '#003087',
  zelle: '#6D1ED4',
  cash: '#2E7D32',
  check: '#455A64',
  overtime: '#C08A3E',
  other: '#8A8AA0',
};

export function normalizeMethod(m: string | null | undefined): string {
  const k = (m || '').toLowerCase().trim();
  return k in METHOD_LABELS && k !== 'other' ? k : (k === '' ? 'other' : (METHOD_LABELS[k] ? k : 'other'));
}

// "weddings", "corporate_event" → "Weddings", "Corporate Event".
export function prettyEventType(s: string | null | undefined): string {
  const raw = (s || '').trim();
  if (!raw) return 'Other';
  return raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Resolve a booking's display event type. event_type is the real field, but
// club/bar bookings (and some older/manual rows) leave it blank while the
// category actually lives on booking_type — fall back to that before giving up
// as 'Other', so the "By event type" chart isn't just one lump of "Other".
export function resolveEventType(
  b: { event_type: string | null; booking_type?: string | null } | null | undefined,
): string {
  const primary = prettyEventType(b?.event_type);
  if (primary !== 'Other') return primary;
  const bt = (b?.booking_type || '').trim();
  return bt ? prettyEventType(bt) : 'Other';
}

// The full set of host-facing payment rails, in display order. Used so the
// "By payment method" chart can list every method — even ones this DJ has never
// been paid through — with the unused ones greyed out. 'overtime' and 'other'
// are excluded here (they're not rails a host picks) but still surface if money
// actually came through them.
export const PAYMENT_METHOD_ORDER = ['card', 'venmo', 'cashapp', 'paypal', 'zelle', 'cash', 'check'];

// The agreed grand total for a booking, in priority order. total_with_tax is the
// authoritative figure once quoting settled; the rates are fallbacks for older or
// manual rows that never got a tax snapshot.
export function agreedTotal(b: FinanceBookingInput): number {
  return round2(
    Number(b.total_with_tax ?? b.counter_rate ?? b.quoted_rate ?? b.offer_amount ?? 0),
  );
}

// Fraction of a booking's total that is sales tax (0 when no snapshot exists).
export function taxRatio(b: FinanceBookingInput): number {
  const total = Number(b.total_with_tax ?? 0);
  const tax = Number(b.tax_amount ?? 0);
  if (!(total > 0) || !(tax > 0)) return 0;
  return Math.min(1, tax / total);
}

// Accepted = a live, agreed booking. status 'approved' covers direct accepts AND
// accepted counter-offers (both set status='approved' + accepted_at); accepted_at
// alone catches any path that stamped the time without flipping status. A
// cancelled booking is never accepted, even if accepted_at was stamped before it
// was called off.
export function isAccepted(b: FinanceBookingInput): boolean {
  if (b.status === 'cancelled') return false;
  return b.status === 'approved' || !!b.accepted_at;
}

const isCollected = (p: FinancePaymentInput) =>
  (p.status === 'paid' || p.status === 'partial') && Number(p.amount_paid) > 0;

const isOutstanding = (p: FinancePaymentInput) =>
  (p.status === 'requested' || p.status === 'pending_confirmation') &&
  Number(p.amount) - Number(p.amount_paid || 0) > 0;

/**
 * Every confirmed inflow, one row each — the manual/card ledger PLUS paid
 * overtime (which lives on the booking, not the ledger). This is the series the
 * whole report is aggregated from.
 */
export function buildReceivedEvents(
  bookings: FinanceBookingInput[],
  payments: FinancePaymentInput[],
): ReceivedEvent[] {
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const events: ReceivedEvent[] = [];

  for (const p of payments) {
    if (!isCollected(p)) continue;
    const b = byId.get(p.booking_id);
    const ratio = b ? taxRatio(b) : 0;
    const gross = round2(Number(p.amount_paid));
    const tax = round2(gross * ratio);
    events.push({
      bookingId: p.booking_id,
      date: (p.confirmed_at || p.marked_sent_at || b?.event_date || '').slice(0, 10),
      gross,
      net: round2(gross - tax),
      tax,
      method: normalizeMethod(p.method),
      eventType: resolveEventType(b),
      venue: b?.venue_name ?? null,
      kind: p.kind || 'other',
      currency: (p.currency || b?.currency || 'USD').toUpperCase(),
    });
  }

  // Paid overtime — billed on the night, tracked on the booking's own columns,
  // never in the ledger. Its own tax field, so split directly.
  for (const b of bookings) {
    if (!b.overtime_paid_at || !(Number(b.overtime_amount) > 0)) continue;
    const gross = round2(Number(b.overtime_amount));
    const tax = round2(Number(b.overtime_tax ?? 0));
    events.push({
      bookingId: b.id,
      date: (b.overtime_paid_at || b.event_date || '').slice(0, 10),
      gross,
      net: round2(gross - tax),
      tax,
      method: 'overtime',
      eventType: resolveEventType(b),
      venue: b.venue_name ?? null,
      kind: 'overtime',
      currency: (b.currency || 'USD').toUpperCase(),
    });
  }

  return events.filter((e) => e.date).sort((a, z) => a.date.localeCompare(z.date));
}

/** Collected total per booking id — used to net out expected/outstanding. */
function collectedByBooking(payments: FinancePaymentInput[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of payments) {
    if (!isCollected(p)) continue;
    m.set(p.booking_id, round2((m.get(p.booking_id) || 0) + Number(p.amount_paid)));
  }
  return m;
}

/** Outstanding (invoiced, not confirmed), split gross/net/tax. */
export function computeOutstanding(
  bookings: FinanceBookingInput[],
  payments: FinancePaymentInput[],
): Totals {
  const byId = new Map(bookings.map((b) => [b.id, b]));
  let gross = 0, tax = 0, count = 0;
  for (const p of payments) {
    if (!isOutstanding(p)) continue;
    const owed = round2(Number(p.amount) - Number(p.amount_paid || 0));
    const ratio = byId.has(p.booking_id) ? taxRatio(byId.get(p.booking_id)!) : 0;
    gross = round2(gross + owed);
    tax = round2(tax + owed * ratio);
    count += 1;
  }
  return { gross, net: round2(gross - tax), tax, count };
}

/**
 * Expected — the remaining agreed amount on ACCEPTED bookings that hasn't been
 * collected OR invoiced yet. Netted against both so it never double-counts money
 * already in "received" or "outstanding".
 */
export function computeExpected(
  bookings: FinanceBookingInput[],
  payments: FinancePaymentInput[],
): Totals {
  const collected = collectedByBooking(payments);
  // Outstanding per booking (invoiced-unpaid), to subtract from the remainder.
  const outstandingByBooking = new Map<string, number>();
  for (const p of payments) {
    if (!isOutstanding(p)) continue;
    const owed = round2(Number(p.amount) - Number(p.amount_paid || 0));
    outstandingByBooking.set(p.booking_id, round2((outstandingByBooking.get(p.booking_id) || 0) + owed));
  }

  let gross = 0, tax = 0, count = 0;
  for (const b of bookings) {
    if (!isAccepted(b)) continue;
    const agreed = agreedTotal(b);
    if (!(agreed > 0)) continue;
    const got = collected.get(b.id) || 0;
    const owed = outstandingByBooking.get(b.id) || 0;
    const remainder = round2(agreed - got - owed);
    if (!(remainder > 0)) continue;
    gross = round2(gross + remainder);
    tax = round2(tax + remainder * taxRatio(b));
    count += 1;
  }
  return { gross, net: round2(gross - tax), tax, count };
}

// One booking's still-unpaid money, dated to the EVENT (not to today) — so it
// plots in the month the gig happens, which is when it'll actually be paid.
export interface ExpectedItem {
  bookingId: string;
  date: string;   // YYYY-MM-DD — the event date
  gross: number;
  net: number;
}

/**
 * Expected earnings: the remaining agreed amount on accepted, UPCOMING bookings
 * (deposit + balance not yet collected), each dated to its event. Upcoming only
 * (event on/after today) — a past gig's uncollected balance was almost always
 * handled off-app and would just inflate the number, the exact problem that made
 * the old lump-sum "Expected" useless.
 */
export function buildExpectedItems(
  bookings: FinanceBookingInput[],
  payments: FinancePaymentInput[],
  todayISO: string,
): ExpectedItem[] {
  const collected = collectedByBooking(payments);
  const out: ExpectedItem[] = [];
  for (const b of bookings) {
    if (!isAccepted(b)) continue;
    const date = (b.event_date || '').slice(0, 10);
    if (!date || date < todayISO) continue;
    const agreed = agreedTotal(b);
    if (!(agreed > 0)) continue;
    const remainder = round2(agreed - (collected.get(b.id) || 0));
    if (!(remainder > 0)) continue;
    const ratio = taxRatio(b);
    out.push({ bookingId: b.id, date, gross: remainder, net: round2(remainder * (1 - ratio)) });
  }
  return out;
}

// ── Aggregations over a ReceivedEvent[] (client filters by range first) ──────

export function inRange(events: ReceivedEvent[], startISO: string, endISO: string): ReceivedEvent[] {
  return events.filter((e) => e.date >= startISO && e.date <= endISO);
}

export function summarize(events: ReceivedEvent[]): Totals {
  let gross = 0, net = 0, tax = 0;
  for (const e of events) { gross += e.gross; net += e.net; tax += e.tax; }
  return { gross: round2(gross), net: round2(net), tax: round2(tax), count: events.length };
}

export interface MonthBucket { month: string; gross: number; net: number; }

// Sorted ascending by YYYY-MM. Fills nothing — the client pads missing months.
export function groupByMonth(events: ReceivedEvent[]): MonthBucket[] {
  const m = new Map<string, { gross: number; net: number }>();
  for (const e of events) {
    const key = e.date.slice(0, 7);
    const cur = m.get(key) || { gross: 0, net: 0 };
    cur.gross += e.gross; cur.net += e.net;
    m.set(key, cur);
  }
  return [...m.entries()]
    .sort((a, z) => a[0].localeCompare(z[0]))
    .map(([month, v]) => ({ month, gross: round2(v.gross), net: round2(v.net) }));
}

export interface Slice { key: string; label: string; gross: number; net: number; }

export function groupByField(events: ReceivedEvent[], field: 'method' | 'eventType'): Slice[] {
  const m = new Map<string, { gross: number; net: number }>();
  for (const e of events) {
    const key = e[field];
    const cur = m.get(key) || { gross: 0, net: 0 };
    cur.gross += e.gross; cur.net += e.net;
    m.set(key, cur);
  }
  return [...m.entries()]
    .map(([key, v]) => ({
      key,
      label: field === 'method' ? (METHOD_LABELS[key] || key) : key,
      gross: round2(v.gross),
      net: round2(v.net),
    }))
    .sort((a, z) => z.gross - a.gross);
}
