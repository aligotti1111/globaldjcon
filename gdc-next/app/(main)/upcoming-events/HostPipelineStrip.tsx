'use client';

// HostPipelineStrip — the host's read-only pipeline shown INLINE in the card
// header, exactly like the DJ card's status strip. Renders the DJ's real
// <PipelineStrip> with no actions/menu state, so the icon cells are view-only.

import { useRef } from 'react';
import PipelineStrip from '../upcoming-bookings/pipeline/PipelineStrip';
import type { PipelineStep } from '../upcoming-bookings/pipeline/types';

const SLOTS = ['contract', 'deposit', 'song_list', 'invoice', 'guestlist'] as const;
const noop = () => {};

export default function HostPipelineStrip({
  steps,
  djType,
}: {
  steps: PipelineStep[];
  djType: 'club' | 'mobile';
}) {
  const btnRef = useRef<HTMLElement | null>(null);
  if (!steps || steps.length === 0) return null;
  return (
    <PipelineStrip
      steps={steps}
      slots={SLOTS}
      djType={djType}
      newSlot={null}
      menuOpenKey={null}
      setMenuOpenKey={noop}
      menuPos={null}
      setMenuPos={noop}
      menuBtnRef={btnRef}
      openedLabel={() => null}
      actionLocked={() => false}
      overrideLockedFor={() => false}
      onToggleOverride={noop}
    />
  );
}
