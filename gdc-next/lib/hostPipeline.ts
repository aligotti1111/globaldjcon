// lib/hostPipeline.ts — build the READ-ONLY pipeline steps for a HOST's booking.
//
// Returns the SAME PipelineStep shape the DJ side uses, so the host card can
// render the DJ's real <PipelineHero> and look identical — just with no
// actions/overrides (which makes every node non-clickable, i.e. view-only).
//
// Rule (same as the DJ side): only include a stage this booking actually has.
// No deposit on the booking → no Deposit node, etc.

import type { PipelineStep } from '@/app/(main)/upcoming-bookings/pipeline/types';

const NEON = '#00e3ad';
const AMBER = '#eaa94a';

// A host pipeline step is a normal PipelineStep plus an optional link the host
// can click (pay deposit/balance, open planner). Plain strings only — this
// crosses the server→client boundary, so no functions.
export type HostStep = PipelineStep & { href?: string; hrefLabel?: string };

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
  // Optional host actions.
  depositHref?: string;
  balanceHref?: string;
  plannerHref?: string;
}

// Read-only step: no actions/overrides → renders as a view-only node. An
// optional href makes just that one node clickable for the host.
function ro(
  key: string,
  label: string,
  done: boolean,
  icon: PipelineStep['icon'],
  caption: string,
  href?: string,
  hrefLabel?: string,
): HostStep {
  return {
    key,
    label,
    state: done ? 'done' : 'todo',
    icon,
    overridable: false,
    done,
    color: done ? NEON : AMBER,
    caption,
    ...(href ? { href, hrefLabel } : {}),
  };
}

export function buildHostPipeline(i: HostPipelineInput): HostStep[] {
  const out: HostStep[] = [];
  const club = i.bookingType === 'club';

  if (i.contractStatus != null) {
    const signed = i.contractStatus === 'signed';
    out.push(ro('contract', 'Contract', signed, 'doc',
      signed ? 'Complete' : i.contractStatus === 'awaiting_client' ? 'Pending' : 'Not Sent'));
  }
  if (i.hasDeposit) {
    out.push(ro('deposit', 'Deposit', !!i.depositPaid, 'money',
      i.depositPaid ? 'Paid' : 'Pending',
      i.depositPaid ? undefined : i.depositHref, 'Make a payment'));
  }
  if (!club && i.plannerStatus != null) {
    const done = i.plannerStatus === 'submitted';
    out.push(ro('song_list', 'Planner & Playlist', done, 'music',
      done ? 'Complete' : 'In progress',
      i.plannerHref, done ? 'View planner' : 'Open planner'));
  }
  if (club && i.riderConfirmed) {
    out.push(ro('song_list', 'Rider', true, 'music', 'Confirmed'));
  }
  if (i.hasBalance) {
    out.push(ro('invoice', 'Balance', !!i.balancePaid, 'receipt',
      i.balancePaid ? 'Paid' : 'Pending',
      i.balancePaid ? undefined : i.balanceHref, 'Make a payment'));
  }
  if (club && i.guestlistConfirmed) {
    out.push(ro('guestlist', 'Guest List', true, 'doc', 'Confirmed'));
  }

  return out;
}
