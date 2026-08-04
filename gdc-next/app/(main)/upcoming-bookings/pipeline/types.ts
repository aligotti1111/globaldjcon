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
  color: string;
  /** The small word under the icon — only for states the icon can't say alone. */
  caption?: string;
  /** A read-only line at the top of the dropdown — the amounts, for Deposit. */
  info?: string;
  /** Why an action you'd expect isn't offered (wraps; kept out of `info`). */
  hint?: string;
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
