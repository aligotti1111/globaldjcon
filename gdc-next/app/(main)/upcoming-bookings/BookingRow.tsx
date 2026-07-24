'use client';

// BookingRow — lifted out of UpcomingBookingsClient unchanged.
//
// One line in the month list: date, time, event, value, the four pipeline
// columns, the actions menu, and the chevron that expands BookingDetails
// underneath it. The request/payment-options modals live here too, because
// this is the component that already holds userId, payments and the
// onPaymentsChange callback.
//
// ColumnHeaders and PIPE_SLOTS ship alongside it on purpose: the header cells
// and the row cells share one track list, and separating them is how a column
// ends up existing in one and not the other.

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MOB_EVENT_TYPE_LABELS } from '../[slug]/mobileBookingForm';
import styles from './upcomingBookings.module.css';
import type { UpcomingBooking, BookingPayment, BookingPlannerSummary } from './page';
import ContractPortal from '../update-dj-profile/ContractPortal';
import PaymentMethodsSection from '../update-dj-profile/PaymentMethodsSection';
import { VenmoMark, CashAppMark, PaypalMark, ZelleMark, CashMark, CheckMark, CardNetworksMark } from '../update-dj-profile/BrandMarks';
import { usableMethods, type PaymentMethod, type PaymentMethodType } from '@/lib/paymentMethods';
import { currencySymbol } from '@/lib/constants';
import PlannerSendModal from './PlannerSendModal';
import FlyerSlot from './FlyerSlot';
import BookingDetails from './BookingDetails';
import {
  MOBILE_EVENT_TYPES, NEON, AMBER, MUTED,
  fmtMoney, capMoney, getDateParts, formatTimeRange,
  type ContractAction,
} from './shared';

// The small brand glyph for each manual rail — the same marks the settings
// grid and the invoice use, so a DJ sees the exact icons the client will.
const REQ_METHOD_ICON: Partial<Record<PaymentMethodType, (p: { size?: number }) => React.ReactElement>> = {
  venmo: VenmoMark, cashapp: CashAppMark, paypal: PaypalMark, zelle: ZelleMark, cash: CashMark, check: CheckMark,
};

// ───────────────────────────────────────────────────────────────────────
// BookingRow — single-line summary for one booking in the month list.
// ───────────────────────────────────────────────────────────────────────


/**
 * What a booking is worth, tax included — the number the client actually owes.
 *
 * WHY THIS EXISTS RATHER THAN JUST READING total_with_tax:
 * total_with_tax is a FROZEN SNAPSHOT written when the booking was created. If
 * the price changed afterwards — an accepted counter, an edited manual rate —
 * the snapshot still describes the OLD price and is simply wrong.
 *
 * The expanded details panel already knows this and recomputes when the
 * snapshot has gone stale. The row header did not: it read total_with_tax
 * blindly, so a renegotiated booking would show one total on the row and a
 * different one in the panel that opens directly underneath it. Two numbers,
 * same booking, six pixels apart.
 *
 * This is that same logic, extracted, so the two cannot drift.
 *
 * The freeze rule still holds throughout: a stale snapshot is recomputed using
 * the booking's OWN frozen tax_pct, never the DJ's current tax settings.
 * Changing your tax rate today must never re-price a booking you agreed in
 * March. Only legacy rows with no snapshot at all (tax_pct null) fall back to
 * the live settings pct, with the old whole-dollar rounding they were made with.
 *
 * Returns null when there's no agreed price at all (a manual add with no rate).
 * Null renders as empty — zero is a price, "we never said" isn't.
 */
function bookingTotalWithTax(
  booking: UpcomingBooking,
  liveTaxPct: number,
): number | null {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const agreed = booking.counter_rate ?? booking.quoted_rate ?? booking.offer_amount ?? null;
  if (agreed == null) return null;

  const snapTaxPct = booking.tax_pct != null ? Number(booking.tax_pct) : null;
  const snapTaxAmount = booking.tax_amount != null ? Number(booking.tax_amount) : null;
  const snapTotal = booking.total_with_tax != null ? Number(booking.total_with_tax) : null;

  // The pre-tax base the snapshot was computed on. "Fresh" = it still matches
  // the current agreed price, so the stored amounts are the truth.
  const snapBase = (snapTaxAmount != null && snapTotal != null)
    ? round2(snapTotal - snapTaxAmount)
    : null;
  const snapshotFresh =
    snapBase != null && Math.abs(Number(agreed) - snapBase) < 0.005;
  if (snapshotFresh) return snapTotal;

  const effTaxPct = snapTaxPct ?? liveTaxPct;
  if (!(effTaxPct > 0)) return round2(Number(agreed));
  const tax = snapTaxPct != null
    ? round2((Number(agreed) * effTaxPct) / 100)
    : Math.round((Number(agreed) * effTaxPct) / 100);
  return round2(Number(agreed) + tax);
}

/**
 * The status columns, left to right — the order a booking actually moves
 * through, and the reason every row lines up with the one above it.
 *
 * This is the layout contract: the header cells and the row cells both read
 * it, so a column can't exist in one and not the other. Each key must match a
 * step key exactly; a typo here silently blanks that column for every booking
 * on the page, which reads as "no contracts exist" rather than as a bug.
 *
 * WHY 'accepted' IS GONE: it was the first column and it was green on every
 * single row, because a booking can't be on this page without being booked. A
 * column that never varies isn't information — it was spending a quarter of the
 * width to tell you nothing.
 *
 * WHY 'invoice' IS LAST: it's a receipt. It cannot do anything until money has
 * actually landed, so it can only ever react to the deposit column to its left.
 * Its position is the sequence.
 *
 * 'deposit' (not 'payment') and 'song_list' (not 'playlist') because
 * /api/bookings/status-override whitelists ['contract','deposit','song_list']
 * server-side and rejects anything else. The key is what the server already
 * trusts; the column header is what the DJ reads. They don't have to match.
 */
const PIPE_SLOTS = ['contract', 'deposit', 'song_list', 'invoice'] as const;

/**
 * Column headings, in PIPE_SLOTS order. Rendered by ColumnHeaders.
 *
 * "Planner & Playlist" is 18 characters against a 96px track, so it wraps —
 * deliberately, and it breaks at the ampersand's space, which is the break you'd
 * choose anyway. No <br> needed: .colHeads is align-items:end, so the two-line
 * heading bottom-aligns with the single-line ones and the row of headings still
 * sits on one baseline.
 */
const PIPE_HEADS: Record<(typeof PIPE_SLOTS)[number], string> = {
  contract: 'Contract',
  deposit: 'Deposit',
  song_list: 'Planner & Playlist',
  invoice: 'Balance',
};

// Column order per DJ type. Club/bar puts the Rider (song_list slot) BEFORE
// Deposit; mobile keeps Planner & Playlist in its original position.
function pipeSlotsFor(djType: 'club' | 'mobile'): readonly (typeof PIPE_SLOTS)[number][] {
  return djType === 'club'
    ? (['contract', 'song_list', 'deposit', 'invoice'] as const)
    : PIPE_SLOTS;
}

/**
 * The column headers, repeated under every month heading.
 *
 * Repeated, not rendered once at the top: a month of bookings is taller than a
 * viewport, and headers you've scrolled past are headers that aren't doing
 * their job. Costs one row per month.
 *
 * Shares .row's grid via the --row-cols custom property rather than repeating
 * the track list, because two copies of nine widths drift apart the first time
 * anyone touches one of them.
 */
export function ColumnHeaders({ djType }: { djType: 'club' | 'mobile' }) {
  return (
    <div className={styles.colHeads} aria-hidden="true">
      <span>Date</span>
      {djType === 'club' && <span />}
      <span>Time</span>
      <span>Event</span>
      <span className={styles.headRight}>Value</span>
      {pipeSlotsFor(djType).map((k) => <span key={k}>{k === 'song_list' && djType === 'club' ? 'Rider' : PIPE_HEADS[k]}</span>)}
      {/* Two empty cells: the actions track and the chevron track. Unlabelled
          on purpose — "Actions" over a column that's blank on most rows is
          noise — but they MUST be here. The header shares .row's track list,
          so a missing cell doesn't leave a gap at the end, it shifts every
          heading one column left and silently mislabels the whole table. */}
      <span />
      <span />
    </div>
  );
}

export default function BookingRow({
  booking, djType, userId, clubDepositPct, taxPct, requireContract, archive: archiveProp, payments, onPaymentsChange, canPro, planner, onPlannerChange, overlaps, onDelete, onEdit, onAddHost, riderEnabled = false,
}: {
  booking: UpcomingBooking;
  djType: 'club' | 'mobile';
  userId: string;
  clubDepositPct: number;
  taxPct: number;
  requireContract: boolean;
  archive?: boolean;
  payments: BookingPayment[];
  onPaymentsChange: (bookingId: string, rows: BookingPayment[]) => void;
  /** Tier 2. A courtesy so the row doesn't offer what the server will refuse. */
  canPro: boolean;
  /** The booking's planner, or undefined if one was never requested. */
  planner?: BookingPlannerSummary;
  onPlannerChange: (bookingId: string, row: BookingPlannerSummary) => void;
  overlaps?: boolean;
  onDelete?: () => void;
  onEdit?: () => void;
  /**
   * Opens the SAME modal as onEdit, but scrolled to Host Details with the name
   * field focused and the block called out.
   *
   * A separate prop rather than a flag on onEdit because the two are different
   * intents that happen to share a form: the pencil means "change something",
   * this means "the thing blocking me is in there somewhere".
   */
  onAddHost?: () => void;
  /** Club/bar: the DJ has enabled the rider — show its pipeline step. */
  riderEnabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // Set true when the details panel's live DocuSeal check confirms the contract
  // is actually signed (covers rows whose stored status is still 'awaiting').
  const [signedOverride, setSignedOverride] = useState(false);
  // Manual step overrides (booking.status_overrides) — DJ can mark a step done
  // when it was handled outside the app. Optimistic UI + persisted via the API.
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() => {
    const o = (booking as { status_overrides?: unknown }).status_overrides;
    return o && typeof o === 'object' ? { ...(o as Record<string, boolean>) } : {};
  });
  // Which step's mark-complete dropdown is open (by key), or null — plus the
  // viewport position to render it at (fixed, so the card's overflow can't clip it).
  const [menuOpenKey, setMenuOpenKey] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  /**
   * The button the open menu belongs to.
   *
   * The menu is position:fixed — i.e. positioned in VIEWPORT coordinates — from
   * a getBoundingClientRect() taken at the moment of the click. That rect is a
   * photograph, not a subscription: scroll one pixel and the row moves while
   * the menu stays exactly where it was, until it's floating in the middle of
   * somebody else's booking with no visible relationship to the icon it
   * belongs to.
   *
   * Fixed IS the right choice here — the menu has to escape .rowWrap's
   * `overflow: hidden` — but it has to re-anchor. Keeping the element lets the
   * effect below recompute against the live rect. Same pattern HeaderDjMenu
   * already uses, and for the same reason.
   */
  const menuBtnRef = useRef<HTMLElement | null>(null);

  // ── Cancellation request ───────────────────────────────────────────
  // A booked date belongs to two people. Either can ASK to cancel; only the
  // other one can agree to it. Until they do, nothing about this booking
  // changes — which is why this state is separate from booking.status.
  const [cancelState, setCancelState] = useState<{
    status: string | null;
    requestedBy: string | null;
    reason: string | null;
  }>(() => ({
    status: (booking as { cancel_status?: string | null }).cancel_status ?? null,
    requestedBy: (booking as { cancel_requested_by?: string | null }).cancel_requested_by ?? null,
    reason: (booking as { cancel_reason?: string | null }).cancel_reason ?? null,
  }));
  const [cancelFormOpen, setCancelFormOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  const [cancelConfirming, setCancelConfirming] = useState(false);
  // Set after declining, so the DJ is pointed at the phone rather than the app.
  const [declinedJustNow, setDeclinedJustNow] = useState(false);

  /**
   * Cancelled per the server row, OR cancelled by the DJ a moment ago in this
   * session. The second half matters: after accepting, `booking.status` is
   * still 'approved' until the next page load, and a row that keeps offering
   * "Send contract" on a booking you just cancelled is how you send one.
   */
  const isCancelled = booking.status === 'cancelled' || cancelState.status === 'accepted';

  /**
   * A cancelled booking is read-only, and "read-only" already exists in this
   * component: it's what `archive` means. Rather than add a second flag and
   * then chase every button that forgot to check it, a cancelled row simply IS
   * archive here — every `actions: archive ? [] : [...]`, every hint, every
   * override toggle goes quiet for free.
   *
   * There is nothing to do about a night that isn't happening. Sending a
   * contract for it, or chasing a deposit on it, is worse than useless.
   */
  const archive = archiveProp || isCancelled;

  async function postCancel(payload: Record<string, unknown>) {
    setCancelBusy(true);
    setCancelErr(null);
    try {
      const res = await fetch('/api/bookings/cancel-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, ...payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Something went wrong.');
      return json as { cancel_status: string };
    } catch (e) {
      setCancelErr(e instanceof Error ? e.message : 'Something went wrong.');
      return null;
    } finally {
      setCancelBusy(false);
    }
  }

  // Re-anchor the open menu to its button on scroll and resize.
  // Capture phase (the `true`) matters: a scroll inside any ancestor container
  // doesn't bubble, so a listener on window without it never fires and the menu
  // silently detaches again in exactly the case that's hardest to notice.
  useEffect(() => {
    if (!menuOpenKey) return;
    function compute() {
      const el = menuBtnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    }
    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [menuOpenKey]);
  // The pipeline's contract actions live here (BookingRow), but the portal and
  // the send/resend/cancel/download handlers are all owned by BookingDetails,
  // which only exists while the row is expanded.
  //
  // Rather than duplicate any of it up here — two copies of ContractPortal, or
  // a second cancelContract(), is two sources of truth and two places to fix a
  // bug — expand the row and hand Details a ONE-SHOT action. Details runs it
  // and clears the flag immediately, so closing the portal doesn't bounce it
  // straight back open.
  const [contractAction, setContractAction] = useState<ContractAction | null>(null);
  function runContract(a: ContractAction) {
    setExpanded(true);
    setContractAction(a);
  }

  // ── Deposit dropdown ──────────────────────────────────────────────────
  // Both modals live here rather than in PaymentsBlock (two components down)
  // because BookingRow already holds userId, payments and onPaymentsChange —
  // everything needed to post the request and fold the new row into state.
  const [reqOpen, setReqOpen] = useState(false);
  const [reqAmount, setReqAmount] = useState('');
  const [reqBusy, setReqBusy] = useState(false);
  const [reqErr, setReqErr] = useState<string | null>(null);
  const [methodsOpen, setMethodsOpen] = useState(false); const [reqKind, setReqKind] = useState<'deposit' | 'balance'>('deposit');
  // The rails the client will actually be offered — shown as icons in the
  // request box so the DJ sees what they're sending before they send it.
  const [reqMethods, setReqMethods] = useState<PaymentMethod[]>([]);
  const [reqCardReady, setReqCardReady] = useState(false);
  useEffect(() => {
    // Load when the box opens, and RELOAD whenever the payment-methods editor
    // closes on top of it — so hitting Edit, changing rails, and coming back
    // shows the updated icons without reopening the box.
    if (!reqOpen || methodsOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('users')
          .select('payment_methods, stripe_connect_ready')
          .eq('id', userId)
          .maybeSingle();
        if (cancelled) return;
        const row = (data || {}) as { payment_methods?: unknown; stripe_connect_ready?: boolean };
        setReqMethods(Array.isArray(row.payment_methods) ? (row.payment_methods as PaymentMethod[]) : []);
        setReqCardReady(!!row.stripe_connect_ready);
      } catch { /* icons are a courtesy — a failed fetch just shows none */ }
    })();
    return () => { cancelled = true; };
  }, [reqOpen, methodsOpen, userId]);

  // The booking's OWN frozen deposit — never recomputed from today's settings.
  const suggestedDeposit = booking.deposit_amount != null ? Number(booking.deposit_amount) : null;
  const depositRow = payments.find((p) => p.kind === 'deposit') || null;

  function openRequest(kind: 'deposit' | 'balance' = 'deposit') {
    setReqErr(null);
    setReqKind(kind);
    if (kind === 'balance') {
      const total = Number((booking as { total_with_tax?: number | null }).total_with_tax ?? (booking as { quoted_rate?: number | null }).quoted_rate ?? 0);
      // Everything actually confirmed through the app (amount_paid on any row).
      const paid = payments.reduce((s, p) => s + Number(p.amount_paid || 0), 0);
      // A deposit MARKED COMPLETE BY HAND (cash / off-app) records no payment
      // row, so it isn't in `paid` — but it IS money collected. Deduct the
      // deposit amount so the balance we ask for isn't the deposit all over
      // again. Guarded on the deposit having no real payment, so a deposit paid
      // through the app (already in `paid`) is never double-counted.
      const depositRealPaid = payments.filter((p) => p.kind === 'deposit').reduce((s, p) => s + Number(p.amount_paid || 0), 0);
      const depositMarked = !!overrides.deposit && depositRealPaid <= 0 ? Number(booking.deposit_amount || 0) : 0;
      const remaining = Math.max(0, Math.round((total - paid - depositMarked) * 100) / 100);
      setReqAmount(remaining > 0 ? String(remaining) : '');
    } else {
      setReqAmount(suggestedDeposit != null && suggestedDeposit > 0 ? String(suggestedDeposit) : '');
    }
    setReqOpen(true);
  }

  async function cancelRequest(paymentId: string) { if (!confirm('Cancel this payment request?')) return; try { const res = await fetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel-request', paymentId }) }); if (!res.ok) { const t = await res.text(); alert(t.slice(0, 160) || 'Could not cancel the request.'); return; } onPaymentsChange(booking.id, payments.filter((pp) => pp.id !== paymentId)); } catch { alert('Could not cancel the request.'); } } async function sendReceipt(kind: 'deposit' | 'balance') { try { const res = await fetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send-receipt', bookingId: booking.id, kind }) }); const raw = await res.text(); if (!res.ok) { alert(raw.slice(0, 160) || 'Could not send the receipt.'); } else { alert('Receipt sent to the client.'); } } catch { alert('Could not send the receipt.'); } } async function submitRequest() {
    const amount = Number(reqAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setReqErr('Enter an amount greater than zero.');
      return;
    }
    setReqBusy(true);
    setReqErr(null);
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request',
          bookingId: booking.id,
          kind: reqKind,
          amount: Math.round(amount * 100) / 100,
        }),
      });
      // .text() first: a non-JSON body (a platform error page) would otherwise
      // become {} and surface as a shrug. Same lesson as the Stripe 502.
      const raw = await res.text();
      let json: { payment?: BookingPayment; error?: string } = {};
      try { json = JSON.parse(raw); } catch { /* handled below */ }
      if (!res.ok || !json.payment) {
        throw new Error(json.error || `HTTP ${res.status} — ${raw.slice(0, 120) || 'no response'}`);
      }
      onPaymentsChange(booking.id, [...payments, json.payment]);
      setReqOpen(false);
    } catch (e) {
      setReqErr(e instanceof Error ? e.message : 'Could not request the deposit.');
    } finally {
      setReqBusy(false);
    }
  }
  async function toggleStep(key: string, next: boolean) {
    setMenuOpenKey(null);
    setOverrides((prev) => { const n = { ...prev }; if (next) n[key] = true; else delete n[key]; return n; });
    try {
      await fetch('/api/bookings/status-override', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, key, done: next }),
      });
    } catch { /* keep optimistic UI; will reconcile on next load */ }
  }
  // Flyer URL owned here so the row slot and the in-card thumbnail
  // (both rendered for the same booking) stay in sync.
  const [flyerUrl, setFlyerUrl] = useState<string | null>(booking.flyer_url ?? null);
  const { day, dow, mo } = getDateParts(booking.event_date);
  // Header time range. When the booker added a cocktail hour, the row's
  // start reflects the cocktail-hour start (the DJ is engaged from then),
  // running through the event end. Otherwise it's the plain event window.
  // Ceremony music, when present, starts earlier still and takes precedence.
  const headerStart =
    booking.ceremony_needed && booking.ceremony_start_time
      ? booking.ceremony_start_time
      : booking.cocktail_needed && booking.cocktail_start_time
      ? booking.cocktail_start_time
      : booking.start_time;
  const timeRange = formatTimeRange(headerStart, booking.end_time);

  let context = '';
  if (djType === 'club') {
    // Club DJ rows: venue is shown only in the expanded details panel
    // — the row header stays minimal (date + time). No context line.
    context = '';
  } else {
    // Mobile DJ rows: show the event type only (e.g. "Wedding"). Venue
    // is shown in the expanded details panel.
    const ev = booking.event_type || '';
    const label = MOB_EVENT_TYPE_LABELS[ev] || MOBILE_EVENT_TYPES.find((e) => e.value === ev)?.label;
    context = label || (ev || 'Event');
  }

  // Booking readiness pipeline — compact icon steps driven by the DJ's settings.
  // Accepted always shows; Contract shows when the DJ requires it (or a contract
  // already exists). Deposit / Song-list steps slot in here later. Manual
  // add-ins (no counterparty) only ever show Accepted.
  type StepState = 'done' | 'pending' | 'void' | 'todo';
  const cstatus = (booking.contract_status as string | null | undefined) || null;
  // Use the booking's OWN snapshot of the requirement (frozen at creation) so
  // changing the DJ's setting later never re-shapes existing bookings. Falls
  // back to the live setting only for rows created before the snapshot existed.
  const needsContract = (booking as { requires_contract?: boolean | null }).requires_contract ?? requireContract;
  // Belt-and-braces for the disappearing contract stage. /api/contracts/cancel
  // now records 'cancelled' rather than nulling contract_status, so cstatus
  // stays truthy and the gate below passes on its own — but bookings cancelled
  // BEFORE that fix already have null in the column, and this keeps their stage
  // visible for the session rather than silently swallowing "Send contract".
  const [everHadContract, setEverHadContract] = useState(!!cstatus);
  useEffect(() => {
    if (cstatus) setEverHadContract(true);
  }, [cstatus]);
  // Contract-step completeness — the SAME rule the status strip uses:
  // genuinely signed (stored status or the panel's live DocuSeal check) OR
  // manually overridden via status_overrides (DJs often paper contracts
  // off-platform; never trap them behind a step the system can't observe).
  // Gates the Request Deposit action in the details panel below.
  const contractStepComplete = cstatus === 'signed' || signedOverride || !!overrides.contract;
  /**
   * Does this booking have somebody to send things TO?
   *
   * A booking that came through the app has a requester — an account, an email,
   * a name. A MANUAL booking has whatever the DJ typed, which may be nothing:
   * Host Name and Host Email are marked "(optional)" on the add form, and a DJ
   * adding a gig they already agreed over the phone has no reason to fill them.
   *
   * Both fields, not just the email. The email is who it goes to; the name is
   * who the contract is made out to. `prepare` falls back to the part of the
   * address before the @ when there's no name, so a contract with no host name
   * gets addressed to "jordan91" — which is nobody.
   */
  const hasHostContact =
    !!String((booking as { host_email?: string | null }).host_email || '').trim() &&
    !!String((booking as { requester_name?: string | null }).requester_name || '').trim();

  // Defined once, used by BOTH the pipeline's Request-deposit item and the
  // panel's Request Deposit button — they must never disagree about whether
  // asking for money is allowed yet.
  //
  // `is_manual` used to be the first clause on its own, which meant a manual
  // booking could ALWAYS request a deposit — gated on nothing. Including the
  // ones with no host email, where the request had no recipient and went
  // nowhere. The DJ clicked Request deposit, the UI said it was requested, and
  // nothing was ever sent.
  //
  // Manual bookings now need host contact instead of the contract gate (they
  // have no contract requirement to satisfy). The other two clauses are
  // untouched, so a real booking's path through here is exactly what it was.
  const canRequestDeposit = booking.is_manual
    ? hasHostContact
    : (!needsContract || contractStepComplete);
  // `color` is per-step, not derived from state alone: Contract goes YELLOW
  // when it's waiting on someone (an action the DJ can take), while Deposit
  // stays grey until it lands. Same state, different urgency — one shared
  // stepColor() couldn't say that.
  // `actions` are the dropdown's items for that step, in its current state.
  // `actions` are the dropdown's real options, and they change with the state:
  // an unsent contract offers "Review & send", a sent one offers resend/cancel,
  // a signed one offers download. Offering "Review & send" on a signed contract
  // — as it did — invites a DJ to overwrite an agreement both parties signed.
  // ── Planner: request / resend ─────────────────────────────────────────────
  //
  // One call for both. The server decides which it is — a planner that already
  // exists is never rebuilt, only re-emailed, because `fields` is a snapshot
  // and `responses` is keyed to it. Resending is most likely exactly when the
  // client is halfway through, and recomposing would orphan their answers.
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [plannerErr, setPlannerErr] = useState<string | null>(null);
  // Request opens the modal; the modal does the sending. Resend still fires
  // directly — there's nothing to confirm about "send that same link again".
  const [sendOpen, setSendOpen] = useState(false);

  async function requestPlanner() {
    if (plannerBusy) return;
    setPlannerBusy(true);
    setPlannerErr(null);
    try {
      const res = await fetch('/api/planner/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPlannerErr(j?.error || 'Could not send the planner.');
        return;
      }
      // The server returns the row's status. Trust it rather than assuming
      // 'sent': a resend on a half-filled planner is still 'partial', and
      // optimistically writing 'sent' would walk the fraction backwards on
      // screen until the next reload.
      onPlannerChange(booking.id, {
        id: j.id,
        status: (j.status as BookingPlannerSummary['status']) || 'sent',
        answered: planner?.answered ?? 0,
        total: planner?.total ?? 0,
      });
      // Created, but Resend is down or unkeyed. The link works — say so rather
      // than claiming it was emailed.
      if (j.warning) setPlannerErr(j.warning);
    } catch {
      setPlannerErr('Could not send the planner.');
    } finally {
      setPlannerBusy(false);
    }
  }

  const steps: {
    key: string; label: string; state: StepState;
    icon: 'doc' | 'money' | 'music' | 'receipt';
    overridable: boolean; done: boolean; color: string;
    /**
     * The small word under the icon. ONLY for states the icon can't say on its
     * own — a contract that's been sent but not signed is otherwise identical
     * to one that's sitting there unsent, and that difference is the whole
     * question a DJ has when they look at this column.
     *
     * Deliberately absent on 'done' and on 'nothing started': the green check
     * already says done, and a dimmed icon already says untouched. Captioning
     * every state would put a word under all four icons, which is the version
     * that read as a control panel.
     */
    caption?: string;
    /** A read-only line at the top of the dropdown — the amounts, for Deposit. */
    info?: string;
    /**
     * Why an action you'd expect isn't offered.
     *
     * Separate from `info` because it wraps: `info` is a single bold line and
     * the menu is white-space:nowrap, so a sentence in there stretches the
     * dropdown to the width of the sentence.
     *
     * This exists because a menu can silently omit an option — Request deposit
     * vanishes until the contract is signed — and an absent button explains
     * nothing. The DJ sees "Not sent", opens the menu to send it, and finds it
     * isn't there. The gate is right; being invisible is not.
     */
    hint?: string;
    actions?: { label: string; run: () => void; danger?: boolean }[];
  }[] = [];
  /*
    MANUAL BOOKINGS CAN HAVE A CONTRACT — this used to be `!booking.is_manual`,
    full stop, so the step never rendered for one no matter what.

    That wasn't a decision, it was a leftover. The expanded panel has offered
    "Review & Send Contract" on manual bookings this whole time (it gates on
    booking_type, which for a manual booking is the DJ's own type — always
    true). So you could send one; the strip just refused to ever say so. And
    because the exclusion ignored `cstatus` too, a manual booking's Contract
    column stayed a dash after sending, after signing, forever.

    NO hasHostContact GATE HERE, deliberately — I had one and it was wrong for
    the same reason the grayscale icon was wrong. A dash means "this stage does
    not apply to this booking". On a DJ who requires contracts, a contract very
    much applies; it's blocked, which is a different thing. Hiding the icon
    answered a question the DJ wasn't asking ("is there a contract stage?") and
    stayed silent on the one they were ("why can't I send it?").

    The step shows. The recipient gate lives in the caption and the dropdown —
    see `blockedNoHost` below — where it can name the problem and hand over the
    fix instead of just not being there.
  */
  const blockedNoHost = !!booking.is_manual && !hasHostContact;
  if (needsContract || !!cstatus || everHadContract || overrides.contract) {
    const trulySigned = cstatus === 'signed' || signedOverride;
    const isDone = trulySigned || !!overrides.contract;
    const cState: StepState =
      isDone ? 'done'
      : (cstatus === 'cancelled' || cstatus === 'voided') ? 'void'
      : (cstatus === 'awaiting_client' || cstatus === 'awaiting_dj') ? 'pending'
      : 'todo';
    // Contract is the one step the DJ can ACT on, so its label is a verb until
    // it's done. Not a status readout competing with the check — an instruction
    // that disappears once there's nothing left to do:
    //
    //   nothing sent yet / cancelled -> "Send contract"    (yellow, actionable)
    //   sent, waiting on a signature -> "Contract pending" (yellow, in flight)
    //   signed or marked complete    -> "Contract"         (green + check)
    //
    // Cancelled deliberately reads "Send contract" rather than a red dead-end:
    // the next move is to send a new one, which is what the panel below says.
    // 'Pending' means SENT and waiting on the client — awaiting_client only.
    // awaiting_dj is the opposite situation: the contract exists but the DJ
    // hasn't signed it yet, so it has NOT gone out. Lumping the two together
    // put "Contract pending" on bookings where nothing had been sent and the
    // DJ was the one holding it up — telling them to wait for someone else.
    const awaiting = cstatus === 'awaiting_client';
    const cLabel = isDone ? 'Contract' : awaiting ? 'Contract pending' : 'Send contract';
    steps.push({
      key: 'contract',
      label: cLabel,
      state: cState,
      icon: 'doc',
      // Overridable only when it isn't genuinely signed (can't un-sign a real one).
      overridable: !trulySigned,
      done: isDone,
      color: isDone ? NEON : AMBER,
      // ONE vocabulary across all four columns — see PIPE_SLOTS:
      //   not sent -> "Not sent"
      //   sent     -> "Pending"
      //   done     -> no caption; the green check is the word.
      //
      // The captions used to be per-column verbs ("Send", "Request"), which
      // meant each column had its own dialect and you had to learn four. A
      // shared vocabulary means you read the row once and know every column.
      //
      // 'awaiting' is awaiting_client ONLY. awaiting_dj means the contract
      // exists but the DJ hasn't signed it — it has NOT gone out, so it reads
      // "Not sent" and must not claim to be pending on someone else.
      caption: isDone ? undefined : awaiting ? 'Pending' : 'Not sent',
      // The dropdown offers what's actually possible RIGHT NOW:
      //
      //   signed        -> Download contract. Not "Review & send" — that
      //                    invited overwriting an agreement both sides signed.
      //   sent, pending -> Resend (client lost the email) or Cancel (void it
      //                    and start again). Sending a second contract behind
      //                    the first is how a client signs the wrong one.
      //   not sent yet  -> Review & send.
      //
      // Archive is read-only apart from downloading what was signed.
      actions: archive
        ? (trulySigned
            ? [
                { label: '\u2b07 Download contract', run: () => runContract('download') },
                { label: '\u2b07 Download audit log', run: () => runContract('download-audit') },
              ]
            : [])
        : trulySigned
          ? [
              { label: '\u2b07 Download contract', run: () => runContract('download') },
              // The audit log is the proof: who signed, from what IP, when.
              // It's the half of a signed contract that matters if the client
              // ever says "that wasn't me" — and it was buried in the panel.
              { label: '\u2b07 Download audit log', run: () => runContract('download-audit') },
            ]
          // Marked complete by hand: the DJ has said this stage is settled,
          // usually because it happened off-platform. Everything else here
          // contradicts that — cancelling a contract they've called done,
          // or handing out a sign-as-the-client link for an agreement that's
          // already agreed. The only honest option left is "Mark not
          // complete", which the override block below owns.
          : isDone
            ? []
            : awaiting
              ? [
                  { label: 'Resend contract', run: () => runContract('resend') },
                  // The DocuSeal email is the single point of failure in this
                  // whole flow — spam folder, typo'd address, corporate filter
                  // — and the DJ finds out by the contract never coming back.
                  // The link works regardless of whether the email landed.
                  { label: '\u{1F517} Copy link to contract', run: () => runContract('copy-link') },
                  { label: 'Cancel contract', run: () => runContract('cancel'), danger: true },
                ]
              // Nobody to send it to — offer the fix, not the dead end.
              // "Review & send" here walks the DJ through picking a template
              // and signing it, and only then does prepare come back with
              // NO_CLIENT_EMAIL. All that work to be told there's no recipient.
              : blockedNoHost
                ? (onAddHost || onEdit
                    ? [{ label: 'Add host details…', run: (onAddHost || onEdit) as () => void }]
                    : [])
                : [{ label: 'Review & send contract', run: () => runContract('open') }],
      // Named here rather than left to an absent button. The step is visible
      // precisely so it CAN say this.
      hint: blockedNoHost && !archive
        ? 'Add host email and name to send contract.'
        : undefined,
    });
  }
  // Payment step — shown when a deposit is part of THIS booking's pipeline,
  // greyed until it's settled. Two ways in:
  //
  //   1. the booking was created with a deposit (its own frozen snapshot), or
  //   2. money has already been requested on it.
  //
  // A DJ who doesn't take deposits never sees this icon at all — the pipeline
  // only shows the stages that booking actually has. And the gate reads the
  // BOOKING's snapshot, never the live setting: switching deposits on today
  // must not make last month's bookings sprout a step they never had. Same
  // freeze rule as requires_contract and tax_pct.
  //
  // Overridable, like the contract step — for money handled outside the app.
  //
  // The override marks the STAGE done; it never fabricates a payment row or an
  // amount. That distinction matters: the rails cap below a typical deposit
  // (unverified Venmo stops at $299.99/week), so partials are routine, and the
  // ledger below must keep showing what actually arrived — $299.99/$600 — even
  // while the strip says the stage is handled. Confirming an amount still
  // belongs to the details panel; this is only "stop asking me about it".
  /**
   * The Value column — what this booking is worth, tax included.
   *
   * Tax-INCLUSIVE on purpose: Value is what the client owes and what the
   * invoice will say. Bookings with no tax on them show the plain agreed rate,
   * because for those the rate IS the total — that's not an inconsistency in
   * the column, it's an accurate description of two different bookings.
   *
   * This was `booking.total_with_tax ?? counter_rate ?? ...`, which read the
   * frozen snapshot blind. See bookingTotalWithTax: on a renegotiated booking
   * that snapshot is stale, and the row would have quoted a different total
   * from the details panel opening directly beneath it.
   */
  const rowValue: number | null = bookingTotalWithTax(booking, taxPct);

  /*
    A booking that came through the app carries a frozen deposit snapshot
    (deposit_pct / deposit_amount) written at creation from the DJ's settings.
    That snapshot is what makes the Deposit step exist at all.

    A MANUAL booking has neither — the add form doesn't write a single deposit
    field (grep deposit_pct: / deposit_amount: — the insert payload has none).
    So `bookingHasDeposit` was false forever and the Deposit column was a dash
    on every manual booking, with no way to ask for money on a gig you'd typed
    in yourself.

    So: the step exists on every manual booking, host details or not. It was
    gated on hasHostContact and that was the same mistake as hiding the contract
    icon — a dash claims the stage doesn't apply, when really it's blocked. You
    can always ask for money on a gig you typed in yourself; you just need
    somewhere to send the request. That's the caption's job (see the hint and
    the "Add host details…" action below), not the column's.

    There's no snapshot to suggest an amount from — suggestedDeposit is null and
    the request modal opens blank — which is correct: nobody ever agreed a
    deposit percentage on this booking, so the DJ types what they actually want.
  */
  const bookingHasDeposit =
    booking.deposit_pct != null
    || booking.deposit_amount != null
    || !!booking.is_manual;
  // Only the DEPOSIT rows, not every payment on the booking.
  //
  // This step used to read `payments` whole. That was fine while deposit was
  // the only money column — but Invoice is its own column now, and an invoice
  // is a `kind: 'balance'` row sitting in the same array. Left as it was, a
  // sent-but-unpaid invoice would have dragged the DEPOSIT icon back out of
  // green: `payments.every(settled)` would go false because of a row that has
  // nothing to do with the deposit. The two columns have to read their own
  // rows or they lie about each other.
  const depositPays = payments.filter((p) => p.kind === 'deposit');
  if (depositPays.length > 0 || bookingHasDeposit || overrides.deposit) {
    const settled = (p: BookingPayment) => p.status === 'paid' || p.status === 'waived';
    // .every() is true for an empty array — a deposit that exists on the
    // booking but has never been requested would read as PAID. Require a row
    // before anything can be "done".
    const reallySettled = depositPays.length > 0 && depositPays.every(settled);
    // ...or the DJ marked it done by hand, for money that never went through
    // the app: cash on the night, a bank transfer, a client who paid before
    // any of this existed. The override says "this stage is handled" — it does
    // NOT invent a payment row or an amount, so the ledger stays honest about
    // what it actually saw.
    const allDone = reallySettled || !!overrides.deposit;
    // Three states, same shape as Contract: a verb while there's something to
    // do, the stage's name once it's done.
    //
    //   nothing requested -> "Request deposit"   (amber — your move)
    //   requested, unpaid -> "Deposit requested" (amber — it's out there)
    //   settled           -> "Deposit"           (green + check)
    //
    // Note what's NOT here: 'Paid'. It reads as settled-in-full while
    // amount_paid might be $299.99 of $600 — the rails cap below a typical
    // deposit, so partials are routine. The real numbers live in the ledger
    // below, which is the only place with room to be accurate.
    // 'Partially paid' is its own state, not a rounding of 'requested'. The
    // rails force it — unverified Venmo caps at $299.99/week against a typical
    // $600 deposit — so a client sending it in two goes is the normal path, not
    // an edge case. A DJ seeing "Deposit requested" on money that's half in has
    // no idea anything arrived.
    const anyPartial = depositPays.some((p) => Number(p.amount_paid || 0) > 0 && !settled(p));
    const pLabel = allDone
      ? 'Deposit'
      : anyPartial
        ? 'Partially paid'
        : depositRow
          ? 'Deposit requested'
          : 'Request deposit';

    // The numbers, for the dropdown. Deposit rows only — same reason as
    // depositPays above: totalling every payment would have this line report
    // the deposit and the invoice added together as if they were one ask.
    const paidSoFar = depositPays.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);
    const askedFor = depositPays.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const currency = booking.currency || 'USD';
    steps.push({
      // 'deposit', not 'payment': /api/bookings/status-override whitelists
      // ['contract','deposit','song_list'] and rejects anything else, so the
      // step key has to be the one the server already trusts.
      key: 'deposit',
      label: pLabel,
      state: allDone ? 'done' : 'todo',
      icon: 'money',
      // Same rule as the contract step: you can't un-do something real. If the
      // rows genuinely settled, the dropdown is gone — otherwise a DJ could
      // "mark not complete" on money that actually arrived and the strip would
      // contradict the ledger sitting right beneath it.
      overridable: !reallySettled,
      done: allDone,
      // Amber until settled. It was grey on the theory that an unpaid deposit
      // isn't the DJ's problem — but "Request deposit" plainly is their move,
      // and a request sitting unpaid is one they can chase. Grey said "nothing
      // to see here" about the money the booking exists to collect.
      color: allDone ? NEON : AMBER,
      // Same problem the contract had: "asked for and waiting" looks exactly
      // like "never asked" if all you have is an icon. A partial says so
      // outright, because half the money arriving is the normal path here (an
      // unverified Venmo caps at $299.99/week against a typical deposit) and a
      // DJ reading "Requested" on money that's half in has been misled.
      // Deposit is the one column that shows a NUMBER instead of a word, the
      // moment there is a number to show:
      //
      //   nothing requested        -> "Not sent"      amber
      //   requested, nothing in    -> "Pending"       amber
      //   part of it landed        -> "$300/$600"     amber — not total
      //   all of it landed         -> "$600/$600"     neon  — total
      //
      // This replaces "Part paid", which was true but useless: it told a DJ
      // money had arrived without telling them how much, so they had to open
      // the dropdown to learn the one fact they wanted. The fraction says the
      // same thing and answers the question in the same glance. Partials are
      // routine here — an unverified Venmo caps at $299.99/week against a
      // typical deposit — so this is the normal case, not an edge case.
      //
      // The denominator is what was ASKED for, so "$600/$600" still reads as
      // settled-in-full rather than as an amount floating with no context.
      //
      // allDone IS CHECKED FIRST, and that ordering is the whole point.
      //
      // The bug it fixes: this used to branch on `depositRow` first and reach
      // 'Pending' whenever paidSoFar was 0 — but there are two settled states
      // where no money ever arrives:
      //   • WAIVED. `settled` counts 'waived', so the badge goes green while
      //     amount_paid stays 0.
      //   • marked complete by hand, for money that landed outside the app.
      // Both produced a green check AND the word "Pending" in the same cell.
      // The badge was reading the status, the caption was reading the payments,
      // and nothing was checking they agreed.
      //
      // Done means done. Show the fraction if there are real amounts to show,
      // otherwise say nothing and let the check carry it — "$0/$0" on a waived
      // deposit would be a lie about money that was never owed.
      caption: allDone
        ? (paidSoFar > 0
            ? `${capMoney(paidSoFar, currency)}/${capMoney(askedFor, currency)}`
            : undefined)
        : depositRow
          // Show received/asked from the moment it's requested — "$0/$600"
          // before anything lands, "$300/$600" once part is in. The DJ sees the
          // target the whole time, not just after a partial arrives. Guard on
          // askedFor > 0 so a zero-amount row never prints a meaningless
          // "$0/$0" (same reason the waived case above says nothing).
          ? (askedFor > 0
              ? `${capMoney(paidSoFar, currency)}/${capMoney(askedFor, currency)}`
              : 'Pending')
          : 'Not sent',
      // Shown at the top of the dropdown, above the actions. Only once money
      // has actually been asked for — before that there's nothing to report.
      info: depositRow
        ? `${fmtMoney(paidSoFar, currency)} of ${fmtMoney(askedFor, currency)} received`
        : undefined,
      // The gate, said out loud — and there are TWO of them now, so it has to
      // say the right one. Telling a DJ to sign a contract on a manual booking
      // that has no contract is worse than saying nothing.
      //
      //   manual, no host contact -> nobody to send it to
      //   real booking, unsigned  -> no agreement yet
      //
      // Either way the menu used to enforce the rule by simply not rendering
      // the item, which tells the DJ nothing. They see "Not sent", open the menu
      // to send it, and find Payment options and Mark complete — no button, no
      // reason, no next step. An invisible rule reads as a broken app.
      // Same terse voice as the contract hint next to it — two blockers in the
      // same row shouldn't sound like they were written by different people.
      hint: (!depositRow && !canRequestDeposit && !archive)
        ? (blockedNoHost
            ? 'Add host email and name to request deposit.'
            : 'Contract must be signed to request deposit.')
        : undefined,
      actions: archive
        ? []
        : [
            // Only until it's been asked for. A second deposit request on the
            // same booking is two rows for one payment, and the ledger would
            // start double-counting what's owed.
            ...(!depositRow && canRequestDeposit && !payments.some((pp) => pp.kind === 'balance')
              ? [{ label: 'Request deposit', run: () => openRequest('deposit') }]
              : []),
            // The way out of the gate, next to the reason for it.
            //
            // Naming a problem without offering the fix just moves the dead end
            // one click later. This opens the Add/Edit Manual Booking modal —
            // the same thing the row's pencil opens, which already has Host
            // Name, Host Email, and a "Send booking details to host" checkbox
            // wired to the invite email. Nothing new to build and nothing new
            // to learn; it just needs a door from where the DJ actually is.
            //
            // onEdit is only ever passed for manual, non-archive bookings (see
            // where BookingRow is used), so this can't appear anywhere else.
            ...(blockedNoHost && (onAddHost || onEdit)
              ? [{ label: 'Add host details…', run: (onAddHost || onEdit) as () => void }]
              : []),
            // The rails the client will be offered. Reachable from the booking
            // because that's where a DJ realises the client can't pay the way
            // they've set up — not from Booking Settings three pages away.
            ...(depositRow && Number(depositRow.amount_paid || 0) <= 0 && depositRow.status !== 'paid' && depositRow.status !== 'waived' ? [{ label: 'Cancel request', run: () => cancelRequest(depositRow.id) }] : []), { label: 'Payment options', run: () => setMethodsOpen(true) },
          ],
    });
  }

  // ── DJ Rider (club/bar) ─ takes the song_list column for club. Opens the
  //   customize-and-send modal; only when the DJ turned the rider on.
  if (booking.booking_type === 'club' && riderEnabled && !archive) {
    steps.push({
      key: 'song_list',
      label: 'DJ Rider — customize & send to host',
      state: 'todo',
      icon: 'music',
      overridable: false,
      done: false,
      color: AMBER,
      caption: 'Rider',
      actions: [{ label: 'Open rider builder', run: () => { window.location.href = `/rider-edit/${booking.id}`; } }],
    });
  }

  // ── Planner & Playlist ──────────────────────────────────────────────────
  //
  // MOBILE ONLY. A club booking has no first dance, no bridal party and no run
  // of show, so the step isn't pushed at all and the cell renders a dash —
  // which is the honest reading: not "nothing has happened yet", but "this
  // doesn't apply here". Club gets its own system (spec §1).
  //
  // The colour moved MUTED → AMBER the moment this shipped. It was grey
  // *because* there was nothing to do; now there is, and grey would make the
  // one column the DJ can act on look like the one they can't.
  if (booking.booking_type !== 'club') {
    const pstatus = planner?.status || booking.planner_status || null;
    const done = pstatus === 'submitted' || !!overrides.song_list;

    // Same gate as the deposit, same reasoning: a manual booking may have no
    // client attached, and a planner with no recipient goes nowhere. The icon
    // still shows — a planner always applies to a mobile booking, so a dash
    // here would be a lie. The dropdown names the problem and hands over the
    // fix. (Hiding the action and saying nothing was the original bug in BOTH
    // the contract and deposit columns; it's not being repeated here.)
    const state: StepState =
      done ? 'done'
      : (pstatus === 'sent' || pstatus === 'partial') ? 'pending'
      : 'todo';

    // The fraction, and it's the whole reason `partial` is worth a state of its
    // own: "they haven't started" and "they're three questions from done" are
    // different problems for the DJ, and "Pending" says neither. Same idea as
    // the deposit's $300/$600.
    //
    // total can be 0 if the snapshot somehow has no visible fields — show
    // Pending rather than "0/0", which reads like a bug because it is one.
    const frac = planner && planner.total > 0
      ? `${planner.answered}/${planner.total}`
      : null;

    // Percent complete — what shows under the icon. A planner fills in over
    // days, so the DJ's real question is "how far along is this?", and "35%"
    // answers it at a glance where "12/34" makes them do the division. The
    // exact fraction still rides along in the hover tooltip (info) below.
    const pct = planner && planner.total > 0
      ? Math.round((planner.answered / planner.total) * 100)
      : null;

    const caption =
      done ? undefined
      : pct !== null ? `${pct}%`
      : pstatus === 'sent' ? 'Pending'
      : 'Not sent';

    const plannerUrl = planner ? `/planner/${planner.id}` : null;

    steps.push({
      key: 'song_list',
      // Matches the column heading. `label` is the icon's title attribute — the
      // tooltip you get hovering it — so if it says "Playlist" while the header
      // above says "Planner & Playlist", they read as two different things.
      label:
        done ? 'Planner & Playlist'
        : pstatus ? 'Planner & Playlist sent, not finished'
        : 'Planner & Playlist not requested',
      state,
      icon: 'music',
      overridable: true,
      done,
      color: done ? NEON : AMBER,
      caption,
      info: plannerErr
        ? undefined
        : (planner && pstatus === 'partial' && frac ? `${frac} answered (${pct}%)` : undefined),
      // plannerErr wins the hint when there is one — it's the newest thing that
      // happened and the only one the DJ hasn't read yet.
      //
      // The wording changes once a planner exists. "Add host email and name to
      // send planner" is false on a booking where the planner went out last
      // week and the DJ has since cleared the email — it's already sent; what's
      // blocked is sending it AGAIN.
      //
      // Pro is checked BEFORE the host gate: telling a free DJ to go and fill
      // in host details, and then refusing them anyway, wastes their time on
      // the wrong problem.
      hint: plannerErr
        ? plannerErr
        : !canPro
          ? 'Planners are a Pro feature.'
          : blockedNoHost
            ? (planner
                ? 'Add host email and name to resend. The link still works.'
                : 'Add host email and name to send planner.')
            : undefined,
      // Two buttons, one name. It's the Planner & Playlist throughout — "Open"
      // to view/fill it, "Download" to get the PDF. No "run sheet" jargon.
      //
      //   · Open Planner & Playlist  — the live page, once one exists.
      //   · Download Planner & Playlist — ALWAYS here, at every stage. Even
      //     blank/not-sent, the sheet page renders from the template, so the DJ
      //     can download a blank to fill by hand or email. ?download=1 makes it
      //     download on open — one click, no dialog.
      actions: archive
        ? []
        : planner
          ? [
              { label: 'Open Planner & Playlist', run: () => { if (plannerUrl) window.open(plannerUrl, '_blank', 'noopener,noreferrer'); } },
              // Download only exists once a planner has been sent — before that
              // there's no specific planner to render. window.open (no noopener)
              // so the opened tab can download the PDF and close itself.
              { label: 'Download Planner & Playlist', run: () => { window.open(`/sheet/${booking.id}?download=1`, '_blank'); } },
              // Copy survives the host gate — the planner exists and the link is
              // live, and a DJ whose client lost it needs to hand it over by text.
              // Only Resend needs a recipient, so only Resend goes.
              {
                label: 'Copy link',
                run: () => {
                  if (!plannerUrl) return;
                  // The absolute url — the DJ is copying this to text it to a
                  // client, and "/planner/abc" pasted into Messages is not a link.
                  const abs = `${window.location.origin}${plannerUrl}`;
                  navigator.clipboard?.writeText(abs).catch(() => {});
                },
              },
              // A lapsed DJ keeps Open, Download and Copy. The planner is their
              // client's answers on their booking — a subscription buys SENDING
              // one, not seeing the ones already in.
              ...(!canPro
                ? [{ label: 'See Pro plans', run: () => { window.location.href = '/subscribe'; } }]
                : blockedNoHost
                  ? (onAddHost || onEdit
                      ? [{ label: 'Add host details…', run: (onAddHost || onEdit) as () => void }]
                      : [])
                  : [{ label: plannerBusy ? 'Sending…' : 'Send reminder email', run: requestPlanner }]),
            ]
          : !canPro
            ? [{ label: 'See Pro plans', run: () => { window.location.href = '/subscribe'; } }]
            : blockedNoHost
              ? (onAddHost || onEdit
                  ? [{ label: 'Add host details…', run: (onAddHost || onEdit) as () => void }]
                  : [])
              // Opens the modal — the whole choose-a-planner, preview, customise
              // and send flow.
              : [{ label: 'Select and Send Planner & Playlist', run: () => { setPlannerErr(null); setSendOpen(true); } }],
    });
  }

  // ── Invoice ─────────────────────────────────────────────────────────────
  //
  // A RECEIPT, not a demand. It confirms money that has already arrived, which
  // is why it's the last column and why it can't do anything on its own: it
  // reacts to the deposit column to its left.
  //
  // 'balance' is the existing payment kind for it — PaymentsBlock already
  // labels kind:'balance' as "Invoice" and already gates sending one on the
  // deposit being settled (canSendInvoice). This column reads the same rows so
  // the two can't disagree.
  //
  // Five states, and the gate is the interesting one: with no deposit settled
  // there is nothing to write a receipt about, so the cell is a dash rather
  // than a button that would open a menu offering nothing.
  {
    const settledP = (p: BookingPayment) => p.status === 'paid' || p.status === 'waived';
    const balancePays = payments.filter((p) => p.kind === 'balance');
    const depositSettled = !depositRow || settledP(depositRow);
    const balanceRow = balancePays[0] || null;
    const balanceSettled = balancePays.length > 0 && balancePays.every(settledP);
    // Money has landed somewhere — a deposit that settled, or a balance that
    // did. Before that, a receipt has nothing to describe.
    const anyMoneyIn =
      (!!depositRow && settledP(depositRow)) || balanceSettled || !!overrides.invoice;
    const done = balanceSettled || !!overrides.invoice;
    if (!isCancelled || balanceRow || anyMoneyIn) {
      const currency = balanceRow ? (booking.currency || 'USD') : (booking.currency || 'USD');
      steps.push({
        key: 'invoice',
        label: done ? 'Balance' : balanceRow ? 'Balance sent' : 'Send balance',
        state: done ? 'done' : 'todo',
        icon: 'receipt',
        overridable: !balanceSettled,
        done,
        color: done ? NEON : AMBER,
        // Same vocabulary as the rest: Not sent / Pending / check.
        //
        // (This is the column that was briefly bare. That was right when the
        // icon greyed out until done — dim carried the state. Once the icon is
        // always full colour, a receipt with no check and no word looks
        // identical whether it's gone out or not, and invoice becomes the one
        // column you can't read.)
        caption: done ? undefined : balanceRow ? 'Pending' : 'Not sent',
        info: balanceRow
          ? `${fmtMoney(Number(balanceRow.amount_paid || 0), currency)} of ${fmtMoney(Number(balanceRow.amount || 0), currency)} received`
          : depositSettled
            ? undefined
            : undefined,
        actions: archive ? [] : [...((balanceRow || done) ? [] : [{ label: 'Request balance', run: () => openRequest('balance') }]), ...(overrides.invoice ? [{ label: 'Send receipt', run: () => sendReceipt('balance') }] : []), ...(balanceRow && Number(balanceRow.amount_paid || 0) <= 0 && !balanceSettled ? [{ label: 'Cancel request', run: () => cancelRequest(balanceRow.id) }] : []), { label: 'Payment options', run: () => setMethodsOpen(true) }],
      });
    }
  }

  /**
   * Cancelled: strip every way to act on the row, in one place.
   *
   * Making a cancelled booking behave as `archive` emptied `actions`, but
   * `overridable` is decided per-step from the step's OWN state (is it signed,
   * is it settled) and never consulted archive at all — so "Mark complete"
   * survived, and with it the chevron, on a booking that isn't happening.
   *
   * Rather than thread the check through four step builders and hope the fifth
   * one remembers, the whole list is neutered here after it's built. `info` and
   * `hint` deliberately survive: the DJ can still open a cancelled row and read
   * what was paid or what stage it reached. Reading is not acting.
   */
  if (isCancelled) {
    for (const st of steps) {
      // DOWNLOADS SURVIVE. Everything else on a cancelled booking is an action
      // on a night that isn't happening — but a signed contract is a record,
      // not a plan. Both cancellation emails tell the parties that cancelling
      // does NOT void it, so the DJ has to be able to retrieve the thing we
      // just told them still stands. Same for the audit log, which is the
      // proof of who signed and when.
      //
      // My first version cleared actions wholesale and took Download with it,
      // which meant the app said "this contract still applies" and then hid it.
      st.actions = (st.actions ?? []).filter((a) => a.label.includes('Download'));
      st.overridable = false;
    }
  }

  // The type-mismatch info is now shown only in the expanded details
  // panel's callout banner (see BookingDetails below) — keeping the row
  // header clean. The row no longer renders a CLUB/BAR pill.

  // Both edit and delete must stop propagation so they don't also toggle
  // the row's expand/collapse state (the row is itself a <button>).
  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation();
    onEdit && onEdit();
  }
  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    onDelete && onDelete();
  }

  return (
    <div
      className={`${styles.rowWrap} ${expanded ? styles.rowWrapExpanded : ''}`}
      // A cancelled row is LIT, not dimmed. Fading it treats the news as less
      // important than the rows around it, when it's the one thing on this
      // screen the DJ most needs to notice — a night they'd otherwise still be
      // planning for. Red wash + a red edge, at full opacity.
      style={
        isCancelled
          ? {
              background: 'rgba(192,57,43,.10)',
              boxShadow: 'inset 3px 0 0 #ff5f5f',
            }
          : undefined
      }
    >
      {/*
        THE ROW IS A GRID, AND EVERY CHILD MUST OWN A TRACK.
        There are exactly as many direct children here as there are tracks in
        --row-cols. Anything extra doesn't overflow — it gets auto-placed into
        an implicit SECOND row, silently, under the date. That's why the manual
        pill and the edit/delete buttons now live inside the event cell rather
        than floating as siblings the way they did when this was a flex row.

        A click anywhere toggles expand; interactive children stopPropagation so
        they run their own action instead.
      */}
      <div className={styles.row} onClick={() => setExpanded((v) => !v)} style={{ cursor: 'pointer' }}>
        {/* 1 — Date pill. Kept as-is: it's what you look for first. */}
        <div className={styles.rowDate}>
          <div className={styles.dayNum}>{day}</div>
          <div className={styles.dayMeta}>
            <div className={styles.dow}>{dow}</div>
            <div className={styles.mo}>{mo}</div>
          </div>
        </div>
        {/* 2 — Flyer. Club/bar only, which is why --row-cols has a club
            variant with an extra track rather than a 0-width column that would
            still eat a gap. display:contents on the wrapper so FlyerSlot itself
            is the grid item. */}
        {djType === 'club' && (
          <span style={{ display: 'contents' }} onClick={(e) => e.stopPropagation()}>
            <FlyerSlot
              bookingId={booking.id}
              userId={userId}
              flyerUrl={flyerUrl}
              onChange={setFlyerUrl}
              size="row"
              readOnly={archive}
            />
          </span>
        )}
        {/* 3 — Time. Its own track now; it used to be half of a nested grid
            that ate the whole row's spare width. */}
        <button
          type="button"
          className={styles.rowToggle}
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          aria-expanded={expanded}
        >
          {booking.cocktail_needed && (
            <div className={styles.rowCocktailNote}>Includes cocktail hour</div>
          )}
          {booking.ceremony_needed && (
            <div className={styles.rowCocktailNote}>Includes ceremony music</div>
          )}
          <div className={styles.rowTime}>{timeRange}</div>
        </button>
        {/* 4 — Event. minmax(0,1fr): takes what's left and ellipsizes, so a
            long name can never push the status columns out of alignment.
            The manual pill and edit/delete USED to ride along in here, which is
            exactly why "Birthday party" was rendering as "Birthday …" — this is
            the only track that flexes, so they ate it. They have their own
            track now. */}
        <div className={styles.rowContext}>
          {context && <span className={styles.rowEventType}>{context}</span>}
          {overlaps && (
            <span
              className={styles.overlapPill}
              title="This booking's time overlaps another booking on the same day"
            >
              ⚠
            </span>
          )}
        </div>
        {/* 5 — Value. The agreed total, right-aligned on tabular figures.
            Same fallback chain the details panel uses, so the row and the panel
            can't quote different numbers. */}
        <div className={styles.rowValue}>
          {rowValue != null ? fmtMoney(rowValue, booking.currency || 'USD') : ''}
        </div>
        {/*
          6–9 — THE STATUS COLUMNS: contract · deposit · playlist · invoice.

          display:contents on this wrapper — it generates no box, so the four
          cells below become direct grid items of .row and land in tracks 6–9.
          On mobile it becomes a real grid and claims a full-width band. One
          element, two layouts, no duplicated markup. See .statusStrip.

          FIXED SLOTS, NOT steps.map. `steps` is variable-length — contract only
          if one is required, deposit only if one exists, invoice only once
          money has landed. Mapping it laid icons out in whatever order they
          happened to exist, so a booking with no contract put its DEPOSIT icon
          exactly where the row above put its CONTRACT icon: same emoji column,
          different meaning. Nothing lined up down the page.

          Now each stage owns a column whether or not this booking has it. A
          missing one leaves a dash. That's information too — "no deposit
          requested" is a real state, and the gap says it.
        */}
        {/*
          NO stopPropagation ON THIS WRAPPER.

          It had one, and `display: contents` is why that was a bug rather than
          a convenience: contents removes the element's BOX, not the element.
          It's still in the DOM and clicks still bubble through it — so the
          handler swallowed every click landing anywhere in the four status
          columns. Roughly 400px of row: the gaps around the icons, the space
          under the captions, and every dash. All of it dead.

          The things that genuinely must not toggle the row — the icon buttons —
          stop their own clicks now, which is where that belongs. Everything
          else in these columns is inert and should toggle like the rest of the
          row does.
        */}
        <div className={styles.statusStrip}>
          {pipeSlotsFor(djType).map((slotKey) => {
            const st = steps.find((s) => s.key === slotKey);
            // Hold the column open. A dash, not a dimmed icon: dimmed implies a
            // stage that exists and hasn't been done, and there's a real
            // difference between "no contract needed on this booking" and "the
            // contract hasn't gone out".
            if (!st) {
              return (
                <div key={slotKey} className={styles.stCell}>
                  <span className={styles.stDash} aria-hidden="true">—</span>
                </div>
              );
            }
            // `const c = st.color` used to live here, feeding the old text
            // label's colour and the chevron's stroke. Both are gone — the
            // caption uses capColor (below) and the chevron now inherits
            // currentColor — so it sat declared and never read, which fails the
            // build on no-unused-vars. st.color is still the source of truth;
            // it's read directly where it's needed.
            const open = menuOpenKey === st.key;
            // A signed contract ISN'T overridable (you can't un-sign a real
            // one) but it does have Download — so the chevron can't key off
            // `overridable` any more, or that menu would be unreachable.
            // `info` counts: a settled deposit in the archive has no actions
            // and isn't overridable, but it still knows what was paid — and
            // that's exactly what someone opens an old booking to check.
            // `hint` counts. A step whose only content is "here's why you can't
            // do the thing" still needs a chevron and a menu to say it in —
            // otherwise the explanation exists in the code and nowhere a DJ can
            // reach it, which is the same as not existing.
            const hasMenu = (st.actions?.length ?? 0) > 0 || st.overridable || !!st.info || !!st.hint;
            // In flight: it exists and it's out there, but it isn't done. This
            // is the state the dot is for — and the reason the caption exists,
            // because a dot alone can't tell "sent, waiting" from "signed".
            // !st.done leads, same as the caption: the amber "waiting on
            // someone" dot and the green "done" badge are mutually exclusive by
            // construction, not by the states happening not to overlap.
            const waiting = !st.done && (!!st.caption || st.state === 'pending');
            // The caption takes the step's own colour, softened.
            //
            //   done  -> neon   — "$600/$600", the whole ask landed
            //   muted -> grey   — Playlist: real stage, nothing you can do yet.
            //                     An amber "Not sent" there would read exactly
            //                     like the amber "Not sent" on deposit beside it
            //                     and promise an action the app can't perform.
            //   else  -> amber  — your move, or waiting on them
            //
            // st.done drives the neon, NOT st.color: the two agree today, but
            // the caption's job is to say whether the thing is finished, and
            // reading that off a colour is how these two got out of sync in the
            // first place.
            //
            // Both values are dialled back from the icon's NEON/AMBER — at
            // 9.5px the full-strength ones vibrate against the dark row. Same
            // hues, sized for the text they're rendering.
            const capColor = st.done
              ? '#3fd6ab'
              : st.color === MUTED
                ? '#5a5a72'
                : '#c08a3e';
            /*
              INVARIANT: a done step can never say it's waiting.
              A green check next to the word "Pending" is the cell contradicting
              itself, and it shipped — a WAIVED deposit is settled with
              amount_paid still 0, so the badge read the status, the caption read
              the payments, and the two disagreed with nobody checking.
              Each step builds its own caption, so this is the one place that can
              enforce the rule for all four columns at once. Cheap, and it makes
              the next person's mistake here impossible instead of merely
              unlikely.
            */
            const cap = st.done && st.caption === 'Pending' ? undefined : st.caption;
            const inner = (
              <>
                {/*
                  ALWAYS FULL COLOUR. The icon used to be grayscale+28% until
                  the step was DONE, which meant a contract that had been sent
                  and was sitting with the client rendered identically to one
                  nobody had touched — drained and dim — while the caption right
                  under it said "Sent". The icon was contradicting the word.

                  The icon's job is only ever "which stage is this". The badge
                  says done, the caption says the rest. A stage that exists on
                  this booking is a real stage; greying it out was the picture
                  saying it wasn't.
                */}
                <span className={styles.stIcon}>
                  {/* The emoji render in their OWN colours — no ring, no tint.
                      Not reached yet = drained and dimmed, so progress is
                      legible without reading anything.
                      NOTE: emoji render differently on every OS — 🧾 on Windows
                      is not 🧾 on macOS. If these ever matter to the brand, the
                      real fix is a small custom SVG set, not a bigger emoji. */}
                  {st.icon === 'money' ? '\u{1F4B5}'
                    : st.icon === 'music' ? '\u{1F3B5}'
                    : st.icon === 'receipt' ? '\u{1F9FE}'
                    : '\u{1F4DD}'}
                  {/* Done. An SVG stroke rather than a ✓ character: at this size
                      the glyph renders soft, and differently per platform. */}
                  {st.done && (
                    <span className={styles.stBadge}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#06231b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    </span>
                  )}
                  {/* Waiting on someone. Never both — done wins. */}
                  {!st.done && waiting && <span className={styles.stDot} />}
                </span>
                {/* The chevron is the affordance: it's what says this icon
                    opens something, standing still, without hovering. */}
                {hasMenu && (
                  <span className={styles.stChev} aria-hidden="true">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                  </span>
                )}
              </>
            );
            /*
              THE CONNECTORS ARE GONE. They existed to make the icons read as a
              sequence rather than a set — the column headers do that job now,
              and better. They also had a bug that only showed once columns were
              reserved: a connector was drawn for any slot > 0, including ones
              whose left-hand neighbour was empty, so a deposit with no contract
              beside it drew a dash hanging off nothing.

              The caption line is rendered even when EMPTY. It has to be: a cell
              with a caption is 10px taller than one without, and left to
              themselves the icons would sit at different heights across the row
              — which is the exact misalignment this page was rebuilt to fix.
            */
            return (
              <div key={st.key} className={styles.stCell}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  {hasMenu ? (
                    <button
                      type="button"
                      className={`${styles.stBtn} ${open ? styles.stBtnOpen : ''}`}
                      title={st.label}
                      aria-haspopup="menu"
                      aria-expanded={open}
                      onClick={(e) => {
                        // This click opens a menu; it must not ALSO expand the
                        // row underneath. It used to rely on the statusStrip
                        // wrapper for this — that wrapper was swallowing clicks
                        // meant for the row, so the stop lives here now, on the
                        // one element that actually needs it.
                        e.stopPropagation();
                        if (open) { setMenuOpenKey(null); return; }
                        // Hand the button to the re-anchor effect. Without this
                        // the menu is positioned once, from a rect that stops
                        // being true the moment anything scrolls.
                        menuBtnRef.current = e.currentTarget as HTMLElement;
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenuPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
                        setMenuOpenKey(st.key);
                      }}
                    >
                      <span className={styles.stTop}>{inner}</span>
                      <span className={styles.stCap} style={{ color: capColor }}>{cap || ''}</span>
                    </button>
                  ) : (
                    <div className={styles.stBtn} style={{ cursor: 'default' }} title={st.label}>
                      <span className={styles.stTop}>{inner}</span>
                      <span className={styles.stCap} style={{ color: capColor }}>{cap || ''}</span>
                    </div>
                  )}
                  {open && hasMenu && menuPos && (
                    <>
                      {/*
                        BOTH OF THESE MUST STOP THEIR CLICKS.

                        position:fixed moves them on screen; it does NOT move
                        them in the DOM. They're still children of the row, so
                        every click in the menu — and every click on the
                        dismiss backdrop, which is the whole viewport — bubbles
                        into .row's onClick and toggles it.

                        That's how "Review & send contract" broke: runContract
                        does setExpanded(true), then the same click reached the
                        row and flipped it straight back shut. The portal opened
                        and the row closed on top of it, in one tick.

                        These used to be covered by a blanket stopPropagation on
                        the statusStrip wrapper — which also swallowed every
                        click on the row's dead space, so removing it was right.
                        The stop belongs on the floating elements themselves.
                      */}
                      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={(e) => { e.stopPropagation(); setMenuOpenKey(null); }} />
                      <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 9999, background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.5)', padding: 4, minWidth: 170, whiteSpace: 'nowrap' }}>
                        {/* The amounts, when there are any. Two words fit on
                            the strip; "$299.99 of $600.00 received" doesn't —
                            and that's the number a DJ actually wants when they
                            tap a half-paid deposit. */}
                        {st.info && (
                          <>
                            <div style={{ color: 'var(--white,#fff)', fontSize: '.78rem', fontWeight: 700, padding: '.45rem .6rem .35rem' }}>
                              {st.info}
                            </div>
                            <div style={{ height: 1, background: 'rgba(255,255,255,.1)', margin: '0 6px 3px' }} />
                          </>
                        )}
                        {/* Why the button you came here for isn't here.
                            whiteSpace:'normal' and an explicit maxWidth because
                            the menu itself is nowrap — a sentence inherits that
                            and stretches the dropdown to the width of the
                            sentence, which is how you get a 600px menu. */}
                        {/*
                          Red, not muted: this is the one line in the menu that
                          says you CAN'T do the thing you opened it for. In grey
                          it read as a footnote and got skipped, which is how you
                          end up hunting for a button that was never going to be
                          there.

                          NO DIVIDER after it, and the bottom padding is gone.
                          A rule between the problem and its fix filed them as
                          two unrelated things — "here's a message" / "here's a
                          menu" — when they're one sentence: what's wrong, and
                          the way out. Dividers separate; these two belong
                          together.
                        */}
                        {st.hint && (
                          <div style={{ color: '#ff8a8a', fontSize: '.7rem', lineHeight: 1.45, padding: '.5rem .6rem .1rem', whiteSpace: 'normal', maxWidth: 190 }}>
                            {st.hint}
                          </div>
                        )}
                        {/* The real options for this step, right now — built
                            in the steps array so the menu can't offer something
                            the state doesn't allow (e.g. re-sending over a
                            signed contract). */}
                        {(st.actions ?? []).map((a) => (
                          <button
                            key={a.label}
                            type="button"
                            onClick={() => { setMenuOpenKey(null); a.run(); }}
                            style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: a.danger ? '#ff7676' : NEON, fontWeight: 700, fontSize: '.78rem', padding: '.5rem .6rem', borderRadius: 6, cursor: 'pointer' }}
                          >
                            {a.label}
                          </button>
                        ))}
                        {/* "Mark complete" is the escape hatch for work handled
                            outside the app — never offered on something real
                            (a genuine signature, money that actually landed),
                            which is what `overridable` guards. */}
                        {st.overridable && (
                          <>
                            {(st.actions ?? []).length > 0 && (
                              <div style={{ height: 1, background: 'rgba(255,255,255,.1)', margin: '3px 6px' }} />
                            )}
                            <button
                              type="button"
                              onClick={() => toggleStep(st.key, !st.done)}
                              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: st.done ? '#ff9a9a' : NEON, fontWeight: 700, fontSize: '.78rem', padding: '.5rem .6rem', borderRadius: 6, cursor: 'pointer' }}
                            >
                              {st.done ? '\u2715 Mark not complete' : '\u2713 Mark complete'}
                            </button>
                            <div style={{ color: 'var(--muted,#7a7a90)', fontSize: '.66rem', padding: '2px 8px 5px' }}>For steps handled outside the app.</div>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {/* 10 — Actions. Right corner, its own track, so nothing it contains
            can squeeze the event name.
            The pill and the buttons occupy the SAME space: pill at rest,
            buttons on hover. You don't need telling it's a manual booking at
            the moment you've reached over to edit it — and showing all three
            at once cost ~106px and gave the event cell nothing back.
            Empty on non-manual rows, which is what keeps every chevron on the
            same x. */}
        {/* No stopPropagation here either — handleEdit and handleDelete already
            stop their own, so this only ever blocked the empty part of the
            cell (and, on a non-manual booking, the entire 84px of it). */}
        <div className={styles.rowActionsCell}>
          {/* A cancelled date stays on the list — it's still a fact about this
              night — but it says so, loudly, before anything else in the cell. */}
          {isCancelled && (
            <span
              title="This booking was cancelled"
              style={{
                background: '#c0392b',
                border: '1px solid #ff7676',
                color: '#fff',
                fontWeight: 800,
                fontSize: '.58rem',
                letterSpacing: '.06em',
                padding: '.15rem .4rem',
                borderRadius: 4,
                whiteSpace: 'nowrap',
              }}
            >
              CANCELLED
            </span>
          )}
          {booking.is_manual && !isCancelled && (
            <span className={styles.manualPill} title="Added manually by you">MANUAL</span>
          )}
          {/* Edit + delete are handed down by the parent, which only knows about
              the page-level archive — so they need the cancelled check here. */}
          {onEdit && !isCancelled && (
            <span
              onClick={handleEdit}
              className={styles.editBtn}
              role="button"
              aria-label="Edit manual booking"
              title="Edit"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </span>
          )}
          {onDelete && !isCancelled && (
            <span
              onClick={handleDelete}
              className={styles.deleteBtn}
              role="button"
              aria-label="Delete manual booking"
              title="Delete"
            >
              ✕
            </span>
          )}
        </div>
        {/* 11 — Chevron. Last track, last thing on the row. */}
        <button
          type="button"
          className={styles.rowChevronBtn}
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <svg
            className={`${styles.rowChevron} ${expanded ? styles.rowChevronOpen : ''}`}
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
      {/* Request deposit — the amount, before it goes out, in something you can
          read. It replaced a window.prompt(), which showed the number with no
          currency, no context, and no way to see what it was a deposit ON. */}
      {reqOpen && (
        <div
          onClick={() => !reqBusy && setReqOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.14)',
              borderRadius: 12, padding: '1.1rem 1.2rem', maxWidth: 420, width: '100%',
              boxShadow: '0 12px 40px rgba(0,0,0,.6)',
            }}
          >
            <div style={{ fontWeight: 800, color: 'var(--white,#fff)', fontSize: '.95rem', marginBottom: '.7rem' }}>
              {reqKind === 'balance' ? 'Request balance' : 'Request deposit'}
            </div>

            <label style={{ display: 'block', fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted,#8a8aa0)', marginBottom: '.35rem' }}>
              Amount
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.5rem' }}>
              <span style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.95rem' }}>{currencySymbol(booking.currency || 'USD')}</span>
              <input
                autoFocus
                type="number"
                min="0"
                step="0.01"
                value={reqAmount}
                // A focused number input changes its own value when the mouse
                // wheel passes over it. This one becomes the amount a client is
                // asked to pay, and the modal is short enough that a stray
                // scroll lands right on it.
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) => { setReqAmount(e.target.value); setReqErr(null); }}
                style={{
                  flex: 1, background: 'var(--deep,#0b0b12)', border: '1px solid rgba(255,255,255,.14)',
                  borderRadius: 6, color: 'var(--white,#fff)', padding: '.55rem .7rem',
                  fontFamily: "'Space Mono', monospace", fontSize: '.9rem',
                }}
              />
            </div>

            {reqKind === 'deposit' && suggestedDeposit != null && suggestedDeposit > 0 && (
              <p style={{ margin: '0 0 .8rem', color: 'var(--muted,#8a8aa0)', fontSize: '.72rem' }}>
                This booking&apos;s agreed deposit: {fmtMoney(suggestedDeposit, booking.currency || 'USD')}
                {booking.deposit_pct != null ? ` (${booking.deposit_pct}%)` : ''}
              </p>
            )}

            {/* What the client will be offered, under the amount, with a quick
                way to change them (opens the same payment-methods editor). */}
            {(() => {
              const ms = usableMethods(reqMethods);
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap', margin: '0 0 .9rem' }}>
                  {ms.map((m) => {
                    const Ico = REQ_METHOD_ICON[m.type];
                    return Ico ? (
                      <span key={m.id} title={m.type} style={{ display: 'inline-flex', lineHeight: 0 }}><Ico size={18} /></span>
                    ) : null;
                  })}
                  {reqCardReady && (
                    <span title="Card" style={{ display: 'inline-flex', lineHeight: 0 }}><CardNetworksMark size={11} /></span>
                  )}
                  {ms.length === 0 && !reqCardReady && (
                    <span style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.72rem' }}>No payment methods set yet</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setMethodsOpen(true)}
                    style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(255,255,255,.18)', color: NEON, fontSize: '.68rem', fontFamily: "'Space Mono', monospace", letterSpacing: '.04em', borderRadius: 6, padding: '.3rem .6rem', cursor: 'pointer' }}
                  >
                    Edit
                  </button>
                </div>
              );
            })()}

            {reqErr && (
              <p style={{ margin: '0 0 .7rem', color: '#ff6b6b', fontSize: '.75rem', lineHeight: 1.5, wordBreak: 'break-word' }}>{reqErr}</p>
            )}

            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={reqBusy}
                onClick={() => setReqOpen(false)}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.18)', color: 'var(--muted,#8a8aa0)', fontWeight: 700, borderRadius: 6, padding: '.5rem 1rem', cursor: reqBusy ? 'default' : 'pointer', fontSize: '.8rem' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reqBusy}
                onClick={() => void submitRequest()}
                style={{ background: NEON, border: 'none', color: '#06231b', fontWeight: 800, borderRadius: 6, padding: '.5rem 1.1rem', cursor: reqBusy ? 'wait' : 'pointer', fontSize: '.8rem', opacity: reqBusy ? .6 : 1 }}
              >
                {reqBusy ? 'Requesting…' : 'Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment options — the real editor, not a copy of it. Same component
          as Booking Settings, so a rail added here is added everywhere and
          there's one place for this logic to be wrong. */}
      {methodsOpen && (
        <div
          onClick={() => setMethodsOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.65)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '2rem 1rem', overflowY: 'auto',
          }}
        >
          {/* position:relative so the close button can pin to the card's own
              top-right corner. The old "Done" button lived UNDER the card, and
              the card is taller than the viewport — so on most screens Done was
              below the fold and the only apparent way out was the dark
              backdrop, which isn't obviously clickable. An X in the corner is
              where every modal keeps its exit, and it rides the top of the card
              so it's on screen the moment the modal opens. */}
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', maxWidth: 620, width: '100%' }}>
            <button
              type="button"
              onClick={() => setMethodsOpen(false)}
              aria-label="Close"
              style={{
                position: 'absolute', top: 12, right: 12, zIndex: 1,
                width: 32, height: 32, borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,.5)', border: '1px solid rgba(255,255,255,.2)',
                color: 'var(--white,#fff)', cursor: 'pointer', lineHeight: 1,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <PaymentMethodsSection userId={userId} />
          </div>
        </div>
      )}

      {expanded && (
        <BookingDetails
          booking={booking}
          djType={djType}
          userId={userId}
          clubDepositPct={clubDepositPct}
          taxPct={taxPct}
          flyerUrl={flyerUrl}
          onFlyerChange={setFlyerUrl}
          onContractSigned={() => setSignedOverride(true)}
          archive={archive}
          contractAction={contractAction}
          onContractActionHandled={() => setContractAction(null)}
          payments={payments}
          onPaymentsChange={onPaymentsChange}
          canRequestDeposit={canRequestDeposit}
          hasHostContact={hasHostContact}
          onEdit={onAddHost || onEdit}
        />
      )}

      {/* ── Cancellation ────────────────────────────────────────────────
          Only inside an expanded row, never in the archive (a night that
          already happened can't be called off), never on a booking that's
          already cancelled, and never on a manual add-in — there's no second
          party to ask. Deliberately the last thing in the panel and styled
          quietly: it should be findable, not tempting. */}
      {expanded && !archive && !booking.is_manual && booking.status !== 'cancelled' && (
        <div
          style={{
            padding: '.9rem 1.1rem',
            borderTop: '1px solid rgba(255,255,255,.08)',
            background: 'rgba(255,255,255,.015)',
          }}
        >
          {cancelErr && (
            <div style={{ color: '#ff7676', fontSize: '.75rem', fontWeight: 600, marginBottom: '.5rem' }}>
              {cancelErr}
            </div>
          )}

          {/* Someone asked, and it's still open. Who asked decides what the DJ
              sees: their own request is a waiting room, the other side's is a
              decision. */}
          {cancelState.status === 'requested' ? (
            cancelState.requestedBy === 'dj' ? (
              <div style={{ fontSize: '.78rem', color: 'var(--muted,#8a8aa0)', lineHeight: 1.5 }}>
                <strong style={{ color: '#ffb020' }}>Cancellation requested by you.</strong>{' '}
                Waiting on {booking.requester_name || 'the host'} to accept or decline.
                This booking is still on until they answer.
                {cancelState.reason && (
                  <div style={{ marginTop: '.4rem', whiteSpace: 'pre-wrap' }}>
                    Your reason: {cancelState.reason}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '.78rem', color: 'var(--white,#fff)', fontWeight: 700, marginBottom: '.3rem' }}>
                  {booking.requester_name || 'The host'} has asked to cancel this booking.
                </div>
                <div style={{ fontSize: '.75rem', color: 'var(--muted,#8a8aa0)', lineHeight: 1.5, marginBottom: '.6rem' }}>
                  {cancelState.reason ? (
                    <>Reason given: <span style={{ whiteSpace: 'pre-wrap' }}>{cancelState.reason}</span></>
                  ) : (
                    <>
                      No reason was given.
                      {/* Only offer the phone when we actually have one. */}
                      {booking.phone
                        ? <> If you&apos;re unsure why, call them on <a href={`tel:${String(booking.phone).replace(/[^\d+]/g, '')}`} style={{ color: NEON, fontWeight: 700 }}>{booking.phone}</a> before you answer.</>
                        : <> If you&apos;re unsure why, reach out before you answer.</>}
                    </>
                  )}
                </div>
                {!cancelConfirming ? (
                  <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={cancelBusy}
                      onClick={() => setCancelConfirming(true)}
                      style={{ background: 'transparent', border: '1px solid rgba(255,118,118,.5)', color: '#ff7676', fontWeight: 700, fontSize: '.75rem', padding: '.45rem .8rem', borderRadius: 6, cursor: 'pointer' }}
                    >
                      Accept — cancel booking
                    </button>
                    <button
                      type="button"
                      disabled={cancelBusy}
                      onClick={async () => {
                        const r = await postCancel({ action: 'decline' });
                        if (r) {
                          setCancelState((s) => ({ ...s, status: 'declined' }));
                          setDeclinedJustNow(true);
                        }
                      }}
                      style={{ background: 'transparent', border: `1px solid ${NEON}`, color: NEON, fontWeight: 700, fontSize: '.75rem', padding: '.45rem .8rem', borderRadius: 6, cursor: 'pointer' }}
                    >
                      {cancelBusy ? 'Saving…' : 'Decline — keep booking'}
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: '.75rem', color: 'var(--white,#fff)', fontWeight: 700, marginBottom: '.5rem' }}>
                      Are you sure? This cancels the booking.
                    </div>
                    <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        disabled={cancelBusy}
                        onClick={async () => {
                          const r = await postCancel({ action: 'accept' });
                          if (r) setCancelState((s) => ({ ...s, status: 'accepted' }));
                        }}
                        style={{ background: '#c0392b', border: 'none', color: '#fff', fontWeight: 700, fontSize: '.75rem', padding: '.45rem .8rem', borderRadius: 6, cursor: 'pointer' }}
                      >
                        {cancelBusy ? 'Cancelling…' : 'Yes, cancel it'}
                      </button>
                      <button
                        type="button"
                        disabled={cancelBusy}
                        onClick={() => setCancelConfirming(false)}
                        style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.2)', color: 'var(--muted,#8a8aa0)', fontWeight: 700, fontSize: '.75rem', padding: '.45rem .8rem', borderRadius: 6, cursor: 'pointer' }}
                      >
                        Go back
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          ) : cancelState.status === 'accepted' ? (
            <div style={{ fontSize: '.78rem', color: '#ff7676', fontWeight: 700 }}>
              This booking has been cancelled.
            </div>
          ) : declinedJustNow || cancelState.status === 'declined' ? (
            <div style={{ fontSize: '.78rem', color: 'var(--muted,#8a8aa0)', lineHeight: 1.5 }}>
              <strong style={{ color: NEON }}>Cancellation declined — this booking still stands.</strong>
              {booking.phone ? (
                <> The next step is a conversation, not the app. Call {booking.requester_name || 'the host'} on{' '}
                  <a href={`tel:${String(booking.phone).replace(/[^\d+]/g, '')}`} style={{ color: NEON, fontWeight: 700 }}>{booking.phone}</a>.
                </>
              ) : (
                <> The next step is a conversation, not the app — reach out to {booking.requester_name || 'the host'} directly.</>
              )}
            </div>
          ) : !cancelFormOpen ? (
            /* Bottom-right of the panel, in an outlined box rather than a bare
               underlined link — findable, but sitting apart from the actions
               a DJ actually wants to click. */
            <button
              type="button"
              onClick={() => setCancelFormOpen(true)}
              style={{
                display: 'block',
                marginLeft: 'auto',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,.18)',
                borderRadius: 6,
                padding: '.4rem .7rem',
                color: 'var(--muted,#8a8aa0)',
                fontSize: '.72rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Request cancellation
            </button>
          ) : (
            <div>
              <div style={{ fontSize: '.75rem', color: 'var(--muted,#8a8aa0)', lineHeight: 1.5, marginBottom: '.5rem' }}>
                {booking.requester_name || 'The host'} will be emailed and can accept or
                decline. The booking stays on until they answer.
              </div>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason (optional) — telling them why saves a phone call"
                rows={2}
                style={{ width: '100%', background: 'rgba(0,0,0,.25)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 6, color: 'var(--white,#fff)', fontSize: '.78rem', padding: '.5rem .6rem', marginBottom: '.55rem', resize: 'vertical', fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={cancelBusy}
                  onClick={async () => {
                    const r = await postCancel({ action: 'request', reason: cancelReason });
                    if (r) {
                      setCancelState({ status: 'requested', requestedBy: 'dj', reason: cancelReason.trim() || null });
                      setCancelFormOpen(false);
                    }
                  }}
                  style={{ background: 'transparent', border: '1px solid rgba(255,118,118,.5)', color: '#ff7676', fontWeight: 700, fontSize: '.75rem', padding: '.45rem .8rem', borderRadius: 6, cursor: 'pointer' }}
                >
                  {cancelBusy ? 'Sending…' : 'Send cancellation request'}
                </button>
                <button
                  type="button"
                  disabled={cancelBusy}
                  onClick={() => { setCancelFormOpen(false); setCancelReason(''); setCancelErr(null); }}
                  style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.2)', color: 'var(--muted,#8a8aa0)', fontWeight: 700, fontSize: '.75rem', padding: '.45rem .8rem', borderRadius: 6, cursor: 'pointer' }}
                >
                  Never mind
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {sendOpen && (
        <PlannerSendModal
          bookingId={booking.id}
          onClose={() => setSendOpen(false)}
          onSent={(r) => {
            setSendOpen(false);
            onPlannerChange(booking.id, {
              id: r.id,
              status: r.status,
              // A fresh planner is prefilled, so it is NOT 0 answered — but the
              // count lives on the server. 0/0 makes the fraction fall back to
              // "Pending" (see the caption), which is honest until the next
              // load rather than a number invented here.
              answered: 0,
              total: 0,
            });
            // Created but not emailed (dead Resend key). The link works; say so.
            if (r.warning) setPlannerErr(r.warning);
          }}
        />
      )}
    </div>
  );
}


