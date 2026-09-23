// lib/hostPipeline.ts — a READ-ONLY view of a booking's progress for the HOST,
// mirroring the DJ-side pipeline but computed only from host-visible signals.
//
// Rule (per the DJ side): only show the stages this booking actually has. If
// the DJ takes no deposit on this booking, there's no Deposit node; if there's
// no contract, no Contract node; and so on. The host can't act on any of it —
// it's purely "where is my booking in the process".

export type HostStageKey = 'contract' | 'deposit' | 'planner' | 'rider' | 'balance' | 'guests';

export interface HostStage {
  key: HostStageKey;
  label: string;
  done: boolean;
}

export interface HostPipelineInput {
  bookingType: 'club' | 'mobile' | null;
  // A contract stage exists when the DJ required one (contract_status is set the
  // moment a contract is created/sent). done when signed.
  contractStatus?: string | null;
  // Deposit stage exists only when this booking carries a deposit (snapshot on
  // the booking, or a deposit payment row). done when a deposit payment settled.
  hasDeposit?: boolean;
  depositPaid?: boolean;
  // Planner (mobile only). Exists once it's been sent (planner_status set).
  // done when the host has submitted it.
  plannerStatus?: 'sent' | 'partial' | 'submitted' | null;
  // Rider + Guest list (club only). We surface these once the host has
  // confirmed them (the only host-visible signal), so they read as done.
  riderConfirmed?: boolean;
  guestlistConfirmed?: boolean;
  // Balance / invoice stage exists once one has been sent. done when settled.
  hasBalance?: boolean;
  balancePaid?: boolean;
}

// Build the ordered list of stages that apply to this booking. Empty array →
// nothing to show yet (the host card simply omits the pipeline).
export function buildHostPipeline(i: HostPipelineInput): HostStage[] {
  const out: HostStage[] = [];
  const club = i.bookingType === 'club';

  if (i.contractStatus != null) {
    out.push({ key: 'contract', label: 'Contract', done: i.contractStatus === 'signed' });
  }
  if (i.hasDeposit) {
    out.push({ key: 'deposit', label: 'Deposit', done: !!i.depositPaid });
  }
  if (!club && i.plannerStatus != null) {
    out.push({ key: 'planner', label: 'Planner', done: i.plannerStatus === 'submitted' });
  }
  if (club && i.riderConfirmed) {
    out.push({ key: 'rider', label: 'Rider', done: true });
  }
  if (i.hasBalance) {
    out.push({ key: 'balance', label: 'Balance', done: !!i.balancePaid });
  }
  if (club && i.guestlistConfirmed) {
    out.push({ key: 'guests', label: 'Guests', done: true });
  }

  return out;
}
