'use client';

// HostPipelineHero — the host's read-only "Booking progress" bar. It renders
// the DJ's REAL <PipelineHero> so it looks identical, but the steps carry no
// actions/overrides, so every node is view-only (no dropdowns, no clicks).

import PipelineHero from '../upcoming-bookings/pipeline/PipelineHero';
import type { PipelineStep } from '../upcoming-bookings/pipeline/types';

// Full slot order; PipelineHero shows only the ones present in `steps`.
const SLOTS = ['contract', 'deposit', 'song_list', 'invoice', 'guestlist'] as const;
const noop = () => {};

export default function HostPipelineHero({
  steps,
  djType,
}: {
  steps: PipelineStep[];
  djType: 'club' | 'mobile';
}) {
  if (!steps || steps.length === 0) return null;
  return (
    <PipelineHero
      steps={steps}
      slots={SLOTS}
      djType={djType}
      openedLabel={() => null}
      actionLocked={() => false}
      overrideLockedFor={() => false}
      onToggleOverride={noop}
    />
  );
}
