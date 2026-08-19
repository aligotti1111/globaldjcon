'use client';

// PipelineHero — the "Booking progress" bar shown at the top of an expanded
// booking card: the connected-node pipeline (Contract → Deposit → Planner/Rider
// → Balance/Guests) with a Step N of M header, from the mockup. It reads the
// SAME step data the row's PipelineStrip uses and opens the SAME StageMenu for
// actions; it's purely a second, larger presentation of the pipeline. No logic
// of its own beyond local menu open/position state.

import { useRef, useState } from 'react';
import styles from '../upcomingBookings.module.css';
import { MUTED } from '../shared';
import StageMenu from './StageMenu';
import { stageLabel, type PipelineStep } from './types';

interface Props {
  steps: PipelineStep[];
  slots: readonly string[];
  djType: 'club' | 'mobile';
  openedLabel: (key: string) => string | null;
  actionLocked: (label: string) => boolean;
  overrideLockedFor: (key: string) => boolean;
  onToggleOverride: (key: string, done: boolean) => void;
}

export default function PipelineHero({
  steps, slots, djType, openedLabel, actionLocked, overrideLockedFor, onToggleOverride,
}: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLElement | null>(null);

  // Short stage name under each node.
  const name = (k: string): string =>
    k === 'song_list' ? (djType === 'club' ? 'Rider' : 'Planner')
      : k === 'contract' ? 'Contract'
      : k === 'deposit' ? 'Deposit'
      : k === 'invoice' ? (djType === 'club' ? 'Balance' : 'Invoice')
      : k === 'guestlist' ? 'Guests'
      : '';

  // Only the stages that actually exist on this booking form the bar.
  const present = slots.map((k) => steps.find((s) => s.key === k)).filter(Boolean) as PipelineStep[];
  const total = present.length;
  const doneCount = present.filter((s) => s.done).length;
  const stepNum = Math.min(doneCount + 1, total);
  // The first not-done stage is "your move" (amber). Everything before it is done.
  const currentKey = present.find((s) => !s.done)?.key ?? null;

  return (
    <div className={styles.heroWrap}>
      <div className={styles.heroHead}>
        <span className={styles.heroTitle}><span className={styles.heroBar} />Booking progress</span>
        <span className={styles.heroStep}>Step {stepNum} of {total}</span>
      </div>
      <div className={styles.heroPipe}>
        {present.map((st, i) => {
          const skipped = st.done && st.color === MUTED;
          const done = st.done && !skipped;
          const isNow = st.key === currentKey;
          const hasMenu = (st.actions?.length ?? 0) > 0 || st.overridable || !!st.info || !!st.hint;
          const open = openKey === st.key;
          const cap = st.done && st.caption === 'Pending' ? undefined : st.caption;
          const capColor = done ? 'var(--neon,#22e3ad)' : isNow ? 'var(--amber,#eaa94a)' : '#7d7d92';
          const nodeCls = `${styles.heroNode}${done ? ' ' + styles.heroNodeDone : ''}${isNow ? ' ' + styles.heroNodeNow : ''}`;
          return (
            <div key={st.key} className={styles.heroStepCell}>
              <div className={styles.heroConn}>
                <span className={nodeCls}>
                  {done && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="#06231b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                </span>
                {i < total - 1 && <span className={`${styles.heroLine}${done ? ' ' + styles.heroLineDone : ''}`} />}
              </div>
              {hasMenu ? (
                <button
                  type="button"
                  className={styles.heroName}
                  style={{ color: isNow ? 'var(--amber,#eaa94a)' : undefined }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (open) { setOpenKey(null); return; }
                    btnRef.current = e.currentTarget as HTMLElement;
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const MENU_W = 210;
                    const left = Math.min(Math.max(8, r.left), window.innerWidth - MENU_W - 8);
                    setPos({ top: r.bottom + 6, left });
                    setOpenKey(st.key);
                  }}
                >
                  {name(st.key)}
                  <svg className={styles.heroCaret} width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
              ) : (
                <span className={styles.heroName}>{name(st.key)}</span>
              )}
              <span className={styles.heroCap} style={{ color: capColor }}>{cap || ''}</span>
              {open && hasMenu && pos && (
                <StageMenu
                  st={st}
                  pos={pos}
                  djType={djType}
                  openedLabelText={openedLabel(st.key)}
                  actionLocked={actionLocked}
                  overrideLocked={overrideLockedFor(st.key)}
                  onClose={() => setOpenKey(null)}
                  onRunAction={(run) => { setOpenKey(null); run(); }}
                  onToggleOverride={() => onToggleOverride(st.key, !st.done)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
