// ── Booking progress tracker ── Paired step "capsules" showing where a booking
// stands: Booking requested → Accepted, Contract sent → Signed, Deposit → Paid,
// Balance → Paid, Event day. Each pair is done (green + ✓), current (outlined +
// NEXT tab) or pending (grey), computed live from the booking row and its
// payments, so the host sees updated progress in every email after each step.
// Table-based for email-client safety. Returns '' if the booking can't be read.
//
// Extracted to its own module so every route that emails a host (the booking
// send-email route, the signed-contract completion webhook, …) renders the
// SAME box from ONE source. Duplicating this logic per-route is exactly how the
// email-layout and client-email bugs spread — keep it in one place.

import { createAdminClient } from '@/lib/supabase/admin';
import { canUsePro, type AccessFields } from '@/lib/access';

export async function bookingProgressBox(bookingId: string | undefined | null): Promise<string> {
  if (!bookingId || !/^[0-9a-f-]{36}$/i.test(bookingId)) return '';
  try {
    const admin = createAdminClient();
    const { data: b } = await admin
      .from('bookings')
      .select('dj_id, booking_type, contract_status, requires_contract, event_date, deposit_amount, deposit_pct, status_overrides, total_with_tax, counter_rate, quoted_rate, offer_amount, planner_status, planner_sent_at')
      .eq('id', bookingId)
      .maybeSingle<{
        dj_id: string | null; booking_type: string | null; contract_status: string | null; requires_contract: boolean | null; event_date: string | null;
        deposit_amount: number | null; deposit_pct: number | null;
        status_overrides: Record<string, boolean> | null; total_with_tax: number | null;
        counter_rate: number | null; quoted_rate: number | null; offer_amount: number | null;
        planner_status: string | null; planner_sent_at: string | null;
      }>();
    if (!b) return '';
    // Mobile bookings only — club/bar DJs don't get the progress tracker.
    if (b.booking_type === 'club') return '';

    // Does this DJ use the Planner & Playlist? It's part of the paid pro suite,
    // so only show the step for DJs who actually have it — a free DJ never
    // sends one, and a perpetually-"next" step they can't complete would be
    // noise. Reads the DJ's live access the same way the rest of the app does.
    let usesPlanners = false;
    if (b.dj_id) {
      const { data: dj } = await admin
        .from('users')
        .select('sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source')
        .eq('id', b.dj_id)
        .maybeSingle();
      if (dj) usesPlanners = canUsePro(dj as unknown as AccessFields);
    }
    // booking_payments isn't in this client's generated types — cast for the read.
    const payClient = admin as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => PromiseLike<{ data: unknown }> } };
    };
    const { data: payData } = await payClient.from('booking_payments').select('kind, status, amount_paid').eq('booking_id', bookingId);
    const pays = (payData as { kind: string; status: string; amount_paid: number | null }[] | null) || [];
    const ov = b.status_overrides || {};

    const paidOf = (kind: string) =>
      pays.some((p) => p.kind === kind && (p.status === 'paid' || p.status === 'waived' || Number(p.amount_paid || 0) > 0));
    const requestedOf = (kind: string) => pays.some((p) => p.kind === kind);
    const total = Number(b.total_with_tax ?? b.counter_rate ?? b.quoted_rate ?? b.offer_amount ?? 0);
    const totalPaid = pays.reduce((s, p) => s + Number(p.amount_paid || 0), 0);
    const paidInFull = total > 0 && totalPaid >= total - 0.01;

    type Step = { left: string; right: string; done: boolean; skipped?: boolean };
    const steps: Step[] = [];
    steps.push({ left: 'Booking requested', right: 'Accepted', done: true });

    // Contract step — only when this DJ requires a contract on this booking
    // (frozen per-booking flag), or one already exists. A DJ who doesn't use
    // contracts never sees the step. Same rule for club/bar and mobile.
    const hasContract = b.contract_status != null && b.contract_status !== '';
    // A cancelled/voided contract is no longer "sent" — treat it like nothing's
    // gone out, so the step reads "Contract" (upcoming) rather than claiming a
    // dead one was sent. It still shows if the DJ requires a contract.
    const contractCancelled = b.contract_status === 'cancelled' || b.contract_status === 'voided';
    const contractSent = hasContract && !contractCancelled;
    // Done when the contract was signed in-app OR the DJ marked it complete by
    // hand (signed on paper, handled off-platform) — status_overrides.contract.
    // Without the override the step wrongly stayed "next" even after later steps
    // (deposit, etc.) were already done.
    const contractDone = b.contract_status === 'signed' || !!ov.contract;
    if (b.requires_contract === true || contractSent || !!ov.contract) {
      steps.push({ left: contractSent ? 'Contract sent' : 'Contract', right: 'Signed', done: contractDone });
    }
    // Deposit step — only when a deposit is genuinely part of this booking: a
    // NON-ZERO percentage or amount was set at creation, or money's already
    // been requested. A DJ who doesn't take deposits (null OR 0) never sees it.
    // Skipped hides it — both the explicit "Skip deposit" override AND the
    // derived skip (a balance was billed with no deposit money collected, so
    // the DJ chose to take it in one payment). A settled deposit is never
    // skipped. Mirrors buildSteps' depositSkipped rule.
    const depositSkipped = !!ov.deposit_skipped || (requestedOf('balance') && !paidOf('deposit'));
    // Show the deposit step when it's genuinely part of this booking: money was
    // requested, a non-zero deposit was configured, or the DJ explicitly marked
    // it complete or skipped by hand. (Same rule the on-screen pipeline uses.)
    const depositConfigured = (b.deposit_amount != null && Number(b.deposit_amount) > 0)
      || (b.deposit_pct != null && Number(b.deposit_pct) > 0);
    const showDeposit = requestedOf('deposit') || depositConfigured || !!ov.deposit || !!ov.deposit_skipped;
    if (showDeposit) {
      if (depositSkipped) {
        // Skipped is its own state — LABELLED, not hidden, and never treated as
        // the "next" step. Two ways to skip: the DJ hits Skip deposit, or they
        // request the whole balance so no separate deposit is collected.
        steps.push({ left: 'Deposit', right: 'Skipped', done: false, skipped: true });
      } else {
        // paidOf covers a real payment; ov.deposit covers a deposit the DJ
        // marked complete by hand (cash, a transfer that never touched the app).
        steps.push({ left: 'Deposit', right: 'Paid', done: paidOf('deposit') || !!ov.deposit });
      }
    }

    // Planner & Playlist — the host fills out the run-of-show + song picks.
    // Only for DJs on the pro suite. "Planner sent" once it's gone out;
    // done when the host submits it (planner_status === 'submitted').
    const plannerActive = b.planner_status != null || b.planner_sent_at != null;
    if (usesPlanners || plannerActive) {
      steps.push({ left: plannerActive ? 'Planner sent' : 'Planner', right: 'Submitted', done: b.planner_status === 'submitted' });
    }

    steps.push({ left: 'Balance', right: 'Paid', done: paidOf('balance') || paidInFull });

    const today = new Date().toISOString().slice(0, 10);
    steps.push({ left: 'Event day', right: '', done: !!b.event_date && b.event_date < today });

    // A skipped step is neither done nor "next" — it's settled by being passed
    // over, so it must not become the current step.
    const currentIdx = steps.findIndex((s) => !s.done && !s.skipped);

    const capsules = steps.map((s, i) => {
      const state = s.skipped ? 'skipped' : s.done ? 'done' : i === currentIdx ? 'current' : 'pending';
      const bg = state === 'done' ? '#eafaf4' : state === 'current' ? '#ffffff' : '#fafafa';
      const border = state === 'done' ? '1px solid #cdeae0' : state === 'current' ? '2px solid #0a6f61' : '1px solid #eeeeee';
      const pad = state === 'current' ? '11px 15px' : '12px 16px';
      const leftColor = (state === 'pending' || state === 'skipped') ? '#aaaaaa' : state === 'current' ? '#0a6f61' : '#1a1a2e';
      const leftWeight = (state === 'pending' || state === 'skipped') ? '400' : state === 'current' ? '700' : '600';
      const rightColor = state === 'done' ? '#1a1a2e' : '#999999';
      // A green ✓ chip after the status word on completed steps only.
      const check = state === 'done'
        ? '&nbsp;&nbsp;<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#0a6f61;color:#ffffff;font-size:11px;line-height:18px;text-align:center;vertical-align:middle;">&#10003;</span>'
        : '';
      // "NEXT" is a little tab that sits ABOVE the current step's box, outside
      // it — marking which step is up next. The negative bottom margin nudges it
      // to overlap the box's top edge; if a client ignores negative margins it
      // just sits in the gap above, which still reads fine.
      const nextTab = state === 'current'
        ? '<div style="margin:18px 0 -8px 14px;line-height:1;"><span style="display:inline-block;background:#0a6f61;color:#ffffff;font-size:9px;font-weight:700;letter-spacing:0.06em;padding:3px 8px;border-radius:6px;">NEXT</span></div>'
        : '';
      const wrapOpen = `<div style="background:${bg};border:${border};border-radius:10px;padding:${pad};margin:0 0 8px;">`;
      // Two columns: step name on the LEFT, its status word (+ ✓ on done)
      // right-aligned so "Signed / Paid / Submitted" line up down the right edge.
      const rightCell = s.right ? `<span style="color:${rightColor};">${s.right}</span>${check}` : check;
      // The reliable email trick for left/right on one line in iOS Gmail:
      // make the LEFT cell greedy (width:100%) so it expands and shoves the
      // status cell to the far RIGHT edge. The right cell has no width and
      // just nowraps, so "Signed / Paid / Submitted" all sit against the edge.
      const inner = (s.right || check)
        ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td align="left" width="100%" style="width:100%;font-size:13px;font-weight:${leftWeight};color:${leftColor};padding-right:12px;">${s.left}</td><td align="right" style="font-size:13px;white-space:nowrap;text-align:right;">${rightCell}</td></tr></table>`
        : `<span style="font-size:13px;font-weight:${leftWeight};color:${leftColor};">${s.left}</span>`;
      return `${nextTab}${wrapOpen}${inner}</div>`;
    }).join('');

    return `<div style="background:#fbfbfb;border:1px solid #ececec;border-radius:10px;padding:16px 18px 8px;margin:0 0 24px;"><p style="margin:0 0 12px;color:#888;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Booking Progress</p>${capsules}</div>`;
  } catch {
    return '';
  }
}
