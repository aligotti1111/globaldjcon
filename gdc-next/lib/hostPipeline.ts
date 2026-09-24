// lib/hostPipeline.ts — build the host's read-only pipeline steps, showing the
// FULL pipeline for the booking type (like the DJ card): Contract · Deposit ·
// Planner/Rider · Balance (· Guests for club). Stages that don't apply render
// muted ("Not Required" / "Not Sent"), never as a "your move" step. Stages the
// host can act on carry an href (pay a deposit/balance, open the planner).

import type { PipelineStep } from '@/app/(main)/upcoming-bookings/pipeline/types';

const NEON = '#00e0a4';
const AMBER = '#eaa94a';
const MUTED = '#5a5a72';

export type HostStep = PipelineStep & {
  href?: string;
  hrefLabel?: string;
  /** A stage that doesn't apply to this booking — grey, never "your move". */
  muted?: boolean;
};

export interface HostPipelineInput {
  bookingType: 'club' | 'mobile' | null;
  contractStatus?: string | null;
  hasDeposit?: boolean;
  depositPaid?: boolean;
  plannerStatus?: 'sent' | 'partial' | 'submitted' | null;
  riderConfirmed?: boolean;
  guestlistConfirmed?: boolean;
  hasBalance?: boolean;
  balancePaid?: boolean;
  depositHref?: string;
  balanceHref?: string;
  plannerHref?: string;
  /** Download a receipt for an already-settled balance (past bookings). */
  balanceReceiptHref?: string;
  /** Download a receipt for an already-settled deposit. */
  depositReceiptHref?: string;
}

function step(
  key: string,
  label: string,
  icon: PipelineStep['icon'],
  opts: { done?: boolean; muted?: boolean; caption: string; href?: string; hrefLabel?: string },
): HostStep {
  const done = !!opts.done;
  return {
    key,
    label,
    state: done ? 'done' : 'todo',
    icon,
    overridable: false,
    done,
    color: done ? NEON : opts.muted ? MUTED : AMBER,
    caption: opts.caption,
    muted: opts.muted,
    ...(opts.href ? { href: opts.href, hrefLabel: opts.hrefLabel } : {}),
  };
}

export function buildHostPipeline(i: HostPipelineInput): HostStep[] {
  const club = i.bookingType === 'club';
  const out: HostStep[] = [];

  // Contract — always shown.
  if (i.contractStatus == null) {
    out.push(step('contract', 'Contract', 'doc', { muted: true, caption: 'Not Required' }));
  } else if (i.contractStatus === 'signed') {
    out.push(step('contract', 'Contract', 'doc', { done: true, caption: 'Complete' }));
  } else {
    out.push(step('contract', 'Contract', 'doc', {
      caption: i.contractStatus === 'awaiting_client' ? 'Pending' : 'Not Sent',
    }));
  }

  // Deposit — always shown.
  if (!i.hasDeposit) {
    out.push(step('deposit', 'Deposit', 'money', { muted: true, caption: 'Not Required' }));
  } else if (i.depositPaid) {
    out.push(step('deposit', 'Deposit', 'money', {
      done: true, caption: 'Paid',
      href: i.depositReceiptHref, hrefLabel: 'Download receipt',
    }));
  } else if (i.depositHref) {
    // A payable deposit request exists — the host can click through to pay.
    out.push(step('deposit', 'Deposit', 'money', {
      caption: 'Pending',
      href: i.depositHref, hrefLabel: 'Make a payment',
    }));
  } else {
    // Deposit was expected on the booking but the DJ never requested it →
    // the DJ card shows "Skipped", so mirror that (muted, no action).
    out.push(step('deposit', 'Deposit', 'money', { muted: true, caption: 'Skipped' }));
  }

  // Planner (mobile) / Rider (club) — the song_list slot.
  if (club) {
    out.push(i.riderConfirmed
      ? step('song_list', 'Rider', 'music', { done: true, caption: 'Confirmed' })
      : step('song_list', 'Rider', 'music', { muted: true, caption: 'Pending' }));
  } else if (i.plannerStatus == null) {
    out.push(step('song_list', 'Planner & Playlist', 'music', { muted: true, caption: 'Not Sent' }));
  } else if (i.plannerStatus === 'submitted') {
    out.push(step('song_list', 'Planner & Playlist', 'music', {
      done: true, caption: 'Complete', href: i.plannerHref, hrefLabel: 'View planner',
    }));
  } else {
    out.push(step('song_list', 'Planner & Playlist', 'music', {
      caption: 'In progress', href: i.plannerHref, hrefLabel: 'Open planner',
    }));
  }

  // Balance — always shown.
  if (!i.hasBalance) {
    out.push(step('invoice', 'Balance', 'receipt', { muted: true, caption: 'Not Sent' }));
  } else if (i.balancePaid) {
    out.push(step('invoice', 'Balance', 'receipt', {
      done: true, caption: 'Paid',
      href: i.balanceReceiptHref, hrefLabel: 'Download receipt',
    }));
  } else {
    out.push(step('invoice', 'Balance', 'receipt', {
      caption: 'Pending', href: i.balanceHref, hrefLabel: 'Make a payment',
    }));
  }

  // Guest list — club only.
  if (club) {
    out.push(i.guestlistConfirmed
      ? step('guestlist', 'Guest List', 'doc', { done: true, caption: 'Confirmed' })
      : step('guestlist', 'Guest List', 'doc', { muted: true, caption: 'Pending' }));
  }

  return out;
}
