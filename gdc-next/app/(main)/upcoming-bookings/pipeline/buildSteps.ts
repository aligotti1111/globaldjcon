// buildBookingSteps — the pipeline-steps builder lifted out of BookingRow
// (refactor phase 2). Pure function: given the booking's data, payment rows,
// overrides and the row's action handlers, it returns the ordered pipeline
// steps plus the row's computed value. No hooks, no JSX.

import { NEON, AMBER, MUTED, fmtMoney, capMoney, type ContractAction } from '../shared';
import type { PipelineStep, StepState } from './types';
import type { UpcomingBooking, BookingPayment, BookingPlannerSummary } from '../page';
import type { NamedRider } from '@/lib/rider';

export interface BuildStepsCtx {
  booking: UpcomingBooking;
  taxPct: number;
  archive: boolean;
  payments: BookingPayment[];
  canPro: boolean;
  planner: BookingPlannerSummary | undefined;
  riderEnabled: boolean;
  guestlistEnabled: boolean;
  onAddHost: (() => void) | undefined;
  onEdit: (() => void) | undefined;
  overrides: Record<string, boolean>;
  signedOverride: boolean;
  isCancelled: boolean;
  depositRow: BookingPayment | null;
  cstatus: string | null;
  needsContract: boolean;
  hasHostContact: boolean;
  canRequestDeposit: boolean;
  everHadContract: boolean;
  runContract: (a: ContractAction) => void;
  openRequest: (kind?: 'deposit' | 'balance') => void;
  cancelRequest: (paymentId: string) => void;
  sendReceipt: (kind: 'deposit' | 'balance') => Promise<void> | void;
  // Optional so this module and BookingRow can be committed in either order
  // without a red build (the site deploys only on green).
  downloadReceipt?: (kind: 'deposit' | 'balance') => Promise<void> | void;
  toggleStep: (key: string, next: boolean) => Promise<void> | void;
  setMethodsOpen: (v: boolean) => void;
  plannerBusy: boolean;
  plannerErr: string | null;
  setPlannerErr: (v: string | null) => void;
  setSendOpen: (v: boolean) => void;
  setRiderChooserOpen: (v: boolean) => void;
  savedRiders: NamedRider[];
  riderSent: boolean;
  requestPlanner: () => Promise<void> | void;
  resendRider: () => Promise<void> | void;
  sendNamedRider: (r: NamedRider) => Promise<void> | void;
  bookingTotalWithTax: (b: UpcomingBooking, taxPct: number) => number | null;
}

export function buildBookingSteps(ctx: BuildStepsCtx): { steps: PipelineStep[]; rowValue: number | null } {
  const { booking, taxPct, archive, payments, canPro, planner, riderEnabled, guestlistEnabled, onAddHost, onEdit, overrides, signedOverride, isCancelled, depositRow, cstatus, needsContract, hasHostContact, canRequestDeposit, everHadContract, runContract, openRequest, cancelRequest, sendReceipt, downloadReceipt, toggleStep, setMethodsOpen, plannerBusy, plannerErr, setPlannerErr, setSendOpen, setRiderChooserOpen, savedRiders, riderSent, requestPlanner, resendRider, sendNamedRider, bookingTotalWithTax } = ctx;
  const steps: PipelineStep[] = [];
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
      // Archive is read-only apart from downloading what was signed. Roles that
      // can't send contracts (assistants) get the same read-only treatment.
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
              : !canPro
                // Subscription lapsed → no NEW contracts. Everything above this
                // branch (download, audit log, resend, copy link) still runs, so
                // a contract already sent stays fully obtainable — only creating
                // and sending a fresh one needs an active plan. Renewing restores
                // sending.
                ? [{ label: 'Renew to send contracts', run: () => { window.location.href = '/subscribe'; } }]
                : blockedNoHost
                  ? (onAddHost || onEdit
                      ? [{ label: 'Add host details…', run: (onAddHost || onEdit) as () => void }]
                      : [])
                  : [{ label: 'Review & send contract', run: () => runContract('open') }],
      // Named here rather than left to an absent button. The step is visible
      // precisely so it CAN say this.
      hint: (!canPro && !archive && !trulySigned && !isDone && !awaiting)
        ? 'Renew your subscription to send new contracts. Contracts already sent stay downloadable.'
        : blockedNoHost && !archive
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
  if (depositPays.length > 0 || bookingHasDeposit || overrides.deposit || overrides.deposit_skipped) {
    const settled = (p: BookingPayment) => p.status === 'paid' || p.status === 'waived';
    // .every() is true for an empty array — a deposit that exists on the
    // booking but has never been requested would read as PAID. Require a row
    // before anything can be "done".
    const reallySettled = depositPays.length > 0 && depositPays.every(settled);
    // Skipped: the DJ is going straight to the balance and won't collect a
    // deposit. Only meaningful while nothing was actually paid — a real payment
    // outranks a skip.
    const depositRealPaidNow = depositPays.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);
    // Skipped is DERIVED, not only stored: once a balance has been requested
    // and no deposit money was collected, the deposit is effectively skipped —
    // the DJ billed the whole thing. Deriving it (rather than relying on the
    // stored flag) also covers bookings whose balance predates the flag. The
    // manual "Skip deposit" button still sets the override for the no-balance
    // case. A deposit with real money collected is never auto-skipped.
    const balanceRequested = payments.some((p) => p.kind === 'balance');
    const depositSkipped = !reallySettled && depositRealPaidNow <= 0 && (!!overrides.deposit_skipped || balanceRequested);
    // ...or the DJ marked it done by hand, for money that never went through
    // the app: cash on the night, a bank transfer, a client who paid before
    // any of this existed. The override says "this stage is handled" — it does
    // NOT invent a payment row or an amount, so the ledger stays honest about
    // what it actually saw.
    const allDone = reallySettled || !!overrides.deposit || depositSkipped;
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
    const pLabel = depositSkipped
      ? 'Deposit skipped'
      : allDone
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
      overridable: !reallySettled && !depositSkipped,
      done: allDone,
      // Amber until settled. It was grey on the theory that an unpaid deposit
      // isn't the DJ's problem — but "Request deposit" plainly is their move,
      // and a request sitting unpaid is one they can chase. Grey said "nothing
      // to see here" about the money the booking exists to collect.
      color: depositSkipped ? MUTED : allDone ? NEON : AMBER,
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
      caption: depositSkipped
        ? 'Skipped'
        : allDone
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
      // A deposit MARKED COMPLETE by hand offers only "Mark not complete" — the
      // way to undo it. Requesting/skipping/payment-options don't apply to a
      // stage the DJ has already declared handled; they come back the moment
      // it's un-marked.
      // A deposit MARKED COMPLETE by hand offers only "Mark not complete".
      // A SKIPPED deposit offers only "Undo skip" (and nothing if it was
      // skipped because a balance is already out — there's no undoing then).
      // Otherwise the normal request/skip/payment-options set.
      actions: (archive || !!overrides.deposit)
        ? []
        : depositSkipped
        ? (balanceRequested
            ? []
            : [{ label: 'Undo skip', run: () => toggleStep('deposit_skipped', false) }])
        : [
            // Only until it's been asked for. A second deposit request on the
            // same booking is two rows for one payment, and the ledger would
            // start double-counting what's owed.
            ...(!depositRow && canRequestDeposit && !payments.some((pp) => pp.kind === 'balance')
              ? [{ label: 'Request deposit', run: () => openRequest('deposit') }]
              : []),
            // Skip: go straight to the balance, no deposit collected. Only
            // before anything is requested, and (like Request) manager+ only.
            ...(!depositRow && canRequestDeposit && !payments.some((pp) => pp.kind === 'balance')
              ? [{ label: 'Skip deposit', run: () => toggleStep('deposit_skipped', true) }]
              : []),
            // Naming a problem without offering the fix just moves the dead end
            // one click later. This opens the Add/Edit Manual Booking modal.
            ...(blockedNoHost && (onAddHost || onEdit)
              ? [{ label: 'Add host details…', run: (onAddHost || onEdit) as () => void }]
              : []),
            // The rails the client will be offered — only before a request has
            // gone out (after that the request already carries them).
            ...(depositRow && Number(depositRow.amount_paid || 0) <= 0 && depositRow.status !== 'paid' && depositRow.status !== 'waived' ? [{ label: 'Cancel request', run: () => cancelRequest(depositRow.id) }] : []), ...(!depositRow ? [{ label: 'Payment options', run: () => setMethodsOpen(true) }] : []),
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
      actions: [
        ...savedRiders.map((r) => ({ label: `Send "${r.name}"`, run: () => sendNamedRider(r) })),
        { label: 'Rider portal', run: () => setRiderChooserOpen(true) },
        ...(riderSent ? [{ label: 'Resend rider', run: () => resendRider() }] : []),
      ],
    });
  }

  // ── Guest List (club/bar) ─ the rightmost column, after Balance. ──
  if (booking.booking_type === 'club' && guestlistEnabled && !archive) {
    steps.push({
      key: 'guestlist',
      label: 'Guest List — add names & send to host',
      state: 'todo',
      icon: 'doc',
      overridable: false,
      done: false,
      color: AMBER,
      caption: 'Guests',
      actions: [{ label: 'Open guest list', run: () => { window.location.href = `/guestlist-edit/${booking.id}`; } }],
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
    const overridden = !!overrides.song_list;

    // The fraction and percent answered. total can be 0 if the snapshot has no
    // visible fields — then there's no meaningful percent to show.
    const frac = planner && planner.total > 0
      ? `${planner.answered}/${planner.total}`
      : null;
    const pct = planner && planner.total > 0
      ? Math.round((planner.answered / planner.total) * 100)
      : null;

    // "Done" (green check) means 100% answered, or a DJ manual override. A
    // SUBMITTED-but-partly-filled planner is NOT done: it stays AMBER — percent
    // and the yellow dot in yellow — right up until every question is answered,
    // so the DJ can see there's still info to chase even after the client hit
    // Send. Only at 100% does it flip to the green check.
    const done = pct === 100 || overridden;

    const state: StepState =
      done ? 'done'
      : (pct !== null || !!pstatus) ? 'pending'
      : 'todo';

    // Percent is the caption whenever a planner exists (amber until 100%). An
    // override with no planner behind it reads as 100%. Otherwise Not sent.
    const caption =
      overridden ? '100%'
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
        : (frac && !done ? `${frac} answered (${pct}%)` : undefined),
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
              // Sending the planner stays available on an existing booking even
              // after the subscription lapses (alongside Open, Download and Copy)
              // — only NEW contracts are gated by an active plan.
              ...(blockedNoHost
                ? (onAddHost || onEdit
                    ? [{ label: 'Add host details…', run: (onAddHost || onEdit) as () => void }]
                    : [])
                : [{ label: plannerBusy ? 'Sending…' : 'Send reminder email', run: requestPlanner }]),
            ]
          : blockedNoHost
              ? (onAddHost || onEdit
                  ? [{ label: 'Add host details…', run: (onAddHost || onEdit) as () => void }]
                  : [])
              // Opens the modal — the whole choose-a-planner, preview, customise
              // and send flow.
              : [{ label: 'Select - Send Planner/Playlist', run: () => { setPlannerErr(null); setSendOpen(true); } }],
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
        // Past Bookings: no "Request balance" workflow — just let the DJ send
        // or resend the invoice. If an invoice was NEVER sent (no balanceRow),
        // "Send invoice" stays available even after the balance is marked
        // complete — the DJ may have been paid in cash but still owes the client
        // a receipt. Once an invoice exists, "Resend invoice" only shows while
        // it's still unpaid. Once the balance is settled (marked complete),
        // the DJ can resend or download the paid-in-full receipt.
        actions: archive
          ? [
              ...(!balanceRow
                  ? [{ label: 'Send invoice', run: () => openRequest('balance') }]
                  : (!done ? [{ label: 'Resend invoice', run: () => openRequest('balance') }] : [])),
              ...(done
                  ? [
                      { label: 'Resend receipt', run: () => sendReceipt('balance') },
                      { label: 'Download receipt', run: () => downloadReceipt?.('balance') },
                    ]
                  : []),
            ]
          : [...((balanceRow || done) ? [] : [{ label: 'Request balance', run: () => openRequest('balance') }]), ...(overrides.invoice ? [{ label: 'Send receipt', run: () => sendReceipt('balance') }] : []), ...(balanceRow && Number(balanceRow.amount_paid || 0) <= 0 && !balanceSettled ? [{ label: 'Cancel request', run: () => cancelRequest(balanceRow.id) }] : []), ...(!balanceRow ? [{ label: 'Payment options', run: () => setMethodsOpen(true) }] : [])],
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
  // Past Bookings (archive): the night has happened. Balance is the ONLY stage
  // still markable — the DJ may have been paid outside the app, so they can
  // mark the balance complete. Every other stage is read-only (no "Mark
  // complete"); its download / open / send-invoice actions still stand.
  if (archive) {
    for (const st of steps) { if (st.key !== 'invoice') st.overridable = false; }
  }

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
  return { steps, rowValue };
}
