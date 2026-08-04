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
import { ConfirmDialog, PaymentMethodsModal } from './RowModals';
import RequestPaymentModal from './RequestPaymentModal';
import type { PaymentMethod } from '@/lib/paymentMethods';
import PlannerSendModal from './PlannerSendModal';
import RiderSendModal from './RiderSendModal';
import { useSendActions } from './hooks/useSendActions';
import FlyerSlot from './FlyerSlot';
import BookingDetails from './BookingDetails';
import {
  MOBILE_EVENT_TYPES, NEON,
  fmtMoney, getDateParts, formatTimeRange,
  type ContractAction,
} from './shared';
import PipelineStrip from './pipeline/PipelineStrip';
import { buildBookingSteps } from './pipeline/buildSteps';

// Capitalize the first letter of each word for menu labels, WITHOUT lowercasing
// the rest — so acronyms like "DJ" survive. "Request balance" -> "Request Balance".

// The small brand glyph for each manual rail — the same marks the settings
// grid and the invoice use, so a DJ sees the exact icons the client will.
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
const PIPE_SLOTS = ['contract', 'deposit', 'song_list', 'invoice', 'guestlist'] as const;

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
  guestlist: 'Guest List',
};


// Column order per DJ type. Club/bar puts the Rider (song_list slot) BEFORE
// Deposit; mobile keeps Planner & Playlist in its original position.
function pipeSlotsFor(djType: 'club' | 'mobile'): readonly (typeof PIPE_SLOTS)[number][] {
  return djType === 'club'
    ? (['contract', 'song_list', 'deposit', 'invoice', 'guestlist'] as const)
    : (['contract', 'deposit', 'song_list', 'invoice'] as const);
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

import { canSendContracts, canRequestDeposit as roleCanRequestDeposit, type ActingRole } from '@/lib/acting';

export default function BookingRow({
  booking, djType, userId, actingRole = 'owner', clubDepositPct, taxPct, requireContract, archive: archiveProp, payments, onPaymentsChange, canPro, planner, onPlannerChange, overlaps, onDelete, onEdit, onAddHost, riderEnabled = false, guestlistEnabled = false, showNewActivity = false, defaultOpen = false,
}: {
  booking: UpcomingBooking;
  /** Only the "New activity" sort highlights the changed stage; By Date and
   *  Recently Booked show the row plainly. */
  showNewActivity?: boolean;
  /** Deep link (?open=<bookingId>) — expand this row and scroll to it on load.
   *  Used by the header notification bell when an item is clicked. */
  defaultOpen?: boolean;
  djType: 'club' | 'mobile';
  userId: string;
  actingRole?: ActingRole;
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
  /** Club/bar: the DJ has enabled the guest list. */
  guestlistEnabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // Deep link from the notification bell: open this booking's card and scroll
  // it into view when defaultOpen turns true (set once the ?open= param is read).
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!defaultOpen) return;
    setExpanded(true);
    const t = setTimeout(() => {
      wrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return () => clearTimeout(t);
  }, [defaultOpen]);
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
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
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
      {
          const MENU_W = 210;
          const left = Math.min(Math.max(8, r.left), window.innerWidth - MENU_W - 8);
          setMenuPos({ top: r.bottom + 6, left });
        }
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
  const roleCanContract = canSendContracts(actingRole);
  const roleCanMoney = roleCanRequestDeposit(actingRole); // cancel request + payment options
  // Role-locking for the step dropdowns: show every option an admin would see,
  // but grey out (disable) the ones this role can't use, with a hover tooltip.
  const MONEY_LOCK_LABELS = new Set(['Request deposit', 'Request balance', 'Cancel request', 'Payment options']);
  const CONTRACT_LOCK_LABELS = new Set(['Resend contract', 'Cancel contract', 'Add host details\u2026', 'Review & send contract', '\u2b07 Download contract', '\u2b07 Download audit log']);
  function actionLocked(label: string): boolean {
    if (MONEY_LOCK_LABELS.has(label)) return !roleCanMoney;
    if (CONTRACT_LOCK_LABELS.has(label) || label.includes('Copy link')) return !roleCanContract;
    return false;
  }
  function overrideLockedFor(key: string): boolean {
    if (key === 'contract') return !roleCanContract;
    if (key === 'deposit' || key === 'invoice') return !roleCanMoney;
    return false;
  }
  function runContract(a: ContractAction) {
    if (!roleCanContract) return;
    setExpanded(true);
    setContractAction(a);
  }

  // ── Deposit dropdown ──────────────────────────────────────────────────
  // Both modals live here rather than in PaymentsBlock (two components down)
  // because BookingRow already holds userId, payments and onPaymentsChange —
  // everything needed to post the request and fold the new row into state.
  const [reqOpen, setReqOpen] = useState(false);
  // Themed confirm dialog (replaces window.confirm so it matches the site).
  const [confirmModal, setConfirmModal] = useState<{ title: string; body: string; okLabel: string; cancelLabel?: string; danger?: boolean; onOk: () => void } | null>(null);
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
  // OVERPAYMENT FLAG. The classic case: the DJ skipped an unpaid deposit and
  // billed the whole balance, the host paid that balance, THEN saw the older
  // deposit email and paid that too. Money collected now exceeds the event
  // total. We can't stop it (the deposit link is live in an email already
  // sent), but we surface it so the DJ refunds or credits the difference.
  const bookingTotalForFlag = Number(
    (booking as { total_with_tax?: number | null }).total_with_tax
    ?? (booking as { counter_rate?: number | null }).counter_rate
    ?? (booking as { quoted_rate?: number | null }).quoted_rate
    ?? 0,
  );
  const totalCollected = payments.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);
  const overpaid = bookingTotalForFlag > 0 && totalCollected > bookingTotalForFlag + 0.01;
  const overpaidBy = overpaid ? Math.round((totalCollected - bookingTotalForFlag) * 100) / 100 : 0;

  // Email OPEN hints (soft signal — see the Resend webhook). Maps a pipeline
  // step's key to the stage its client email was tagged with, then shows when
  // that email was likely opened. song_list is the rider on club, planner on
  // mobile.
  const emailOpens = ((booking as { email_opens?: Record<string, string> | null }).email_opens) || {};
  // New-activity highlight. The server stamps last_activity_slot with the
  // pipeline cell of the booking's most recent HOST action (contract signed,
  // host paid, planner submitted, rider / guest list confirmed). That cell gets
  // a neon glow so the DJ sees WHAT changed, not just that something did.
  const newSlot = showNewActivity
    ? (((booking as { last_activity_slot?: string | null }).last_activity_slot) || null)
    : null;
  const stageForKey = (key: string): string | null => {
    // Only stages whose client email links to one of OUR pages, where we can
    // record a real page view with no email pixel. song_list is rider on club,
    // planner on mobile. (Contract will join via DocuSeal-viewed later.)
    if (key === 'contract') return 'contract';
    if (key === 'guestlist') return 'guestlist';
    if (key === 'song_list') return booking.booking_type === 'club' ? 'rider' : 'planner';
    return null;
  };
  const openedLabel = (key: string): string | null => {
    const stage = stageForKey(key);
    const iso = stage ? emailOpens[stage] : null;
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return `Viewed ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  };


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
      // The DJ requesting a balance is billing the WHOLE remaining amount —
      // when a deposit went unpaid, they're overriding it, not netting it out.
      // So the balance is the full total minus what actually came in. The only
      // deduction is a deposit collected OFF-APP (marked complete, no payment
      // row) — that money is real, it just isn't in `paid`.
      const depositMarked = !!overrides.deposit && depositRealPaid <= 0 ? Number(booking.deposit_amount || 0) : 0;
      const remaining = Math.max(0, Math.round((total - paid - depositMarked) * 100) / 100);
      setReqAmount(remaining > 0 ? String(remaining) : '');
    } else {
      setReqAmount(suggestedDeposit != null && suggestedDeposit > 0 ? String(suggestedDeposit) : '');
    }
    setReqOpen(true);
  }

  function cancelRequest(paymentId: string) {
    setConfirmModal({
      title: 'Cancel this payment request?',
      body: 'This removes the request from the booking. You can request it again later.',
      okLabel: 'Cancel request',
      cancelLabel: 'Keep it',
      danger: true,
      onOk: async () => {
        try {
          const res = await fetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel-request', paymentId }) });
          if (!res.ok) { const t = await res.text(); alert(t.slice(0, 160) || 'Could not cancel the request.'); return; }
          onPaymentsChange(booking.id, payments.filter((pp) => pp.id !== paymentId));
        } catch { alert('Could not cancel the request.'); }
      },
    });
  } async function sendReceipt(kind: 'deposit' | 'balance') { try { const res = await fetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send-receipt', bookingId: booking.id, kind }) }); const raw = await res.text(); if (!res.ok) { alert(raw.slice(0, 160) || 'Could not send the receipt.'); } else { alert('Receipt sent to the client.'); } } catch { alert('Could not send the receipt.'); } } async function submitRequest() {
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
      // Requesting the balance auto-skips the deposit stage (the server also
      // persists this). Only when no deposit was actually collected.
      if (reqKind === 'balance' && !overrides.deposit_skipped) {
        // Billing the whole balance means the deposit is being skipped — even
        // if a deposit request went out unpaid (the DJ is overriding it). Only
        // when NOTHING was actually collected: a paid or part-paid deposit
        // stays, since the balance already nets out real payments.
        const depPaid = payments.filter((p) => p.kind === 'deposit').reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);
        const depSettled = payments.some((p) => p.kind === 'deposit' && (p.status === 'paid' || p.status === 'waived'));
        if (depPaid <= 0 && !depSettled) {
          setOverrides((prev) => ({ ...prev, deposit_skipped: true }));
        }
      }
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
  // "Mark complete" on a MONEY step has downstream impact, so confirm it and
  // spell out what happens next — a deposit gets deducted from the balance you
  // later bill; a balance send the client their final receipt. `done` is the
  // new state (true = marking complete). Only the deposit/balance steps carry
  // a warning; contract/playlist just toggle.
  function confirmAndToggleStep(key: string, done: boolean) {
    const proceed = () => {
      toggleStep(key, done);
      // Marking the balance complete sends the final receipt automatically.
      if (done && key === 'invoice') { sendReceipt('balance'); }
    };
    if (done && key === 'deposit') {
      setConfirmModal({
        title: 'Mark deposit as paid?',
        body: 'Marking this deposit paid outside the app will deduct it from the balance owed when you request the balance.',
        okLabel: 'Mark deposit paid',
        onOk: proceed,
      });
      return;
    }
    if (done && key === 'invoice') {
      setConfirmModal({
        title: 'Mark balance as paid?',
        body: 'Marking the balance paid outside the app will send the client their final receipt.',
        okLabel: 'Mark balance paid',
        onOk: proceed,
      });
      return;
    }
    proceed();
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
  const {
    plannerBusy, plannerErr, setPlannerErr,
    sendOpen, setSendOpen,
    riderChooserOpen, setRiderChooserOpen,
    savedRiders, riderSent,
    requestPlanner, resendRider, sendNamedRider,
  } = useSendActions({ booking, riderEnabled, archive, planner, onPlannerChange });

  const { steps, rowValue } = buildBookingSteps({ booking, taxPct, archive, payments, canPro, planner, riderEnabled, guestlistEnabled, onAddHost, onEdit, overrides, signedOverride, isCancelled, depositRow, cstatus, needsContract, hasHostContact, canRequestDeposit, everHadContract, runContract, openRequest, cancelRequest, sendReceipt, toggleStep, setMethodsOpen, plannerBusy, plannerErr, setPlannerErr, setSendOpen, setRiderChooserOpen, savedRiders, riderSent, requestPlanner, resendRider, sendNamedRider, bookingTotalWithTax });

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
      ref={wrapRef} data-booking-id={booking.id}
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
          {overpaid && (
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                border: '1px solid #ff6b6b', color: '#ff6b6b', borderRadius: 999,
                padding: '.08rem .5rem', fontSize: '.66rem', fontWeight: 800,
                letterSpacing: '.03em', whiteSpace: 'nowrap',
              }}
              title={`Overpaid by ${fmtMoney(overpaidBy, booking.currency || 'USD')} — collected ${fmtMoney(totalCollected, booking.currency || 'USD')} of a ${fmtMoney(bookingTotalForFlag, booking.currency || 'USD')} total. A deposit was likely paid after the full balance. Refund or credit the client.`}
            >
              ⚠ Overpaid {fmtMoney(overpaidBy, booking.currency || 'USD')}
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
        <PipelineStrip
          steps={steps}
          slots={pipeSlotsFor(djType)}
          djType={djType}
          newSlot={newSlot}
          menuOpenKey={menuOpenKey}
          setMenuOpenKey={setMenuOpenKey}
          menuPos={menuPos}
          setMenuPos={setMenuPos}
          menuBtnRef={menuBtnRef}
          openedLabel={openedLabel}
          actionLocked={actionLocked}
          overrideLockedFor={overrideLockedFor}
          onToggleOverride={confirmAndToggleStep}
        />
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
      {confirmModal && (
        <ConfirmDialog confirm={confirmModal} onClose={() => setConfirmModal(null)} />
      )}
      {reqOpen && (
        <RequestPaymentModal
          reqKind={reqKind}
          reqAmount={reqAmount}
          setReqAmount={setReqAmount}
          reqErr={reqErr}
          setReqErr={setReqErr}
          reqBusy={reqBusy}
          reqMethods={reqMethods}
          reqCardReady={reqCardReady}
          suggestedDeposit={suggestedDeposit}
          currency={booking.currency || 'USD'}
          depositPct={booking.deposit_pct ?? null}
          onClose={() => setReqOpen(false)}
          onEditMethods={() => setMethodsOpen(true)}
          onSubmit={() => void submitRequest()}
        />
      )}

      {/* Payment options — the real editor, not a copy of it. Same component
          as Booking Settings, so a rail added here is added everywhere and
          there's one place for this logic to be wrong. */}
      {methodsOpen && (
        <PaymentMethodsModal userId={userId} onClose={() => setMethodsOpen(false)} />
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
          canRequestDeposit={canRequestDeposit && roleCanMoney}
          canManageMoney={roleCanMoney}
          canManageContract={roleCanContract}
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
      {riderChooserOpen && (
        <RiderSendModal bookingId={booking.id} onClose={() => setRiderChooserOpen(false)} />
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


