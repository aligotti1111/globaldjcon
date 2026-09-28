// Shared pipeline types, extracted from BookingRow (refactor phase 1) so the
// row's `steps` array and the PipelineStrip / StageMenu components all agree on
// one shape.

export type StepState = 'done' | 'pending' | 'void' | 'todo';

export type PipelineStep = {
  key: string;
  label: string;
  state: StepState;
  icon: 'doc' | 'money' | 'music' | 'receipt';
  overridable: boolean;
  done: boolean;
  /** Done because the DJ hit "Mark Complete" by hand (not signed/paid in-app). */
  manualComplete?: boolean;
  color: string;
  /** The small word under the icon — only for states the icon can't say alone. */
  caption?: string;
  /** A read-only line at the top of the dropdown — the amounts, for Deposit. */
  info?: string;
  /** Why an action you'd expect isn't offered (wraps; kept out of `info`). */
  hint?: string;
  /**
   * Balance step only: an outstanding remainder created by a price INCREASE
   * after the balance was already paid in full. When set (> 0) the strip shows
   * a two-tone "Paid / New Balance" caption and the step reopens to collect it.
   */
  newBalanceDue?: number;
  actions?: { label: string; run: () => void; danger?: boolean }[];
};

// Stage display name shared by the strip tooltip and the menu header
// (song_list = Rider on club, Planner & Playlist on mobile).
export function stageLabel(slotKey: string, djType: 'club' | 'mobile'): string {
  if (slotKey === 'song_list') return djType === 'club' ? 'Rider' : 'Planner & Playlist';
  if (slotKey === 'contract') return 'Contract';
  if (slotKey === 'deposit') return 'Deposit';
  if (slotKey === 'invoice') return 'Balance';
  if (slotKey === 'guestlist') return 'Guest List';
  return '';
}
