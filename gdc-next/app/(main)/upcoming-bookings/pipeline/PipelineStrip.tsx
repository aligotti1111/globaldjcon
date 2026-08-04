'use client';

// PipelineStrip — the four/five status cells on a booking row (Contract,
// Deposit, Planner/Rider, Balance, Guest list). Extracted verbatim from
// BookingRow (refactor phase 1). Pure presentation: the row still owns the
// steps array and the menu open/position state, and passes them in; this draws
// the cells and mounts StageMenu for the open one.

import type { MutableRefObject } from 'react';
import styles from '../upcomingBookings.module.css';
import { MUTED } from '../shared';
import StageMenu from './StageMenu';
import { stageLabel, type PipelineStep } from './types';


interface Props {
  steps: PipelineStep[];
  slots: readonly string[];
  djType: 'club' | 'mobile';
  newSlot: string | null | undefined;
  menuOpenKey: string | null;
  setMenuOpenKey: (k: string | null) => void;
  menuPos: { top: number; left: number } | null;
  setMenuPos: (p: { top: number; left: number }) => void;
  menuBtnRef: MutableRefObject<HTMLElement | null>;
  openedLabel: (key: string) => string | null;
  actionLocked: (label: string) => boolean;
  overrideLockedFor: (key: string) => boolean;
  onToggleOverride: (key: string, done: boolean) => void;
}

export default function PipelineStrip({
  steps, slots, djType, newSlot,
  menuOpenKey, setMenuOpenKey, menuPos, setMenuPos, menuBtnRef,
  openedLabel, actionLocked, overrideLockedFor, onToggleOverride,
}: Props) {
  return (
    <div className={styles.statusStrip}>
      {slots.map((slotKey) => {
        const st = steps.find((s) => s.key === slotKey);
        const isNew = newSlot != null && slotKey === newSlot;
        if (!st) {
          return (
            <div key={slotKey} className={styles.stCell}>
              <span className={styles.stDash} aria-hidden="true">—</span>
            </div>
          );
        }
        const open = menuOpenKey === st.key;
        const hasMenu = (st.actions?.length ?? 0) > 0 || st.overridable || !!st.info || !!st.hint;
        const waiting = !st.done && (!!st.caption || st.state === 'pending');
        const capColor = st.done
          ? '#3fd6ab'
          : st.color === MUTED
            ? '#5a5a72'
            : '#c08a3e';
        // INVARIANT: a done step can never say it's waiting.
        const cap = st.done && st.caption === 'Pending' ? undefined : st.caption;
        const inner = (
          <>
            <span className={styles.stIcon}>
              {st.icon === 'money' ? '\u{1F4B5}'
                : st.icon === 'music' ? '\u{1F3B5}'
                : st.icon === 'receipt' ? '\u{1F9FE}'
                : '\u{1F4DD}'}
              {st.done && (
                <span className={styles.stBadge}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#06231b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
              )}
              {!st.done && waiting && <span className={styles.stDot} />}
            </span>
            {hasMenu && (
              <span className={styles.stChev} aria-hidden="true">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </span>
            )}
          </>
        );
        return (
          <div key={st.key} className={styles.stCell}>
            <div className={isNew ? styles.stIconBox : undefined} style={{ position: 'relative', flexShrink: 0 }}>
              {isNew && <span className={styles.stNewTag} aria-hidden="true">NEW</span>}
              {hasMenu ? (
                <button
                  type="button"
                  className={`${styles.stBtn} ${open ? styles.stBtnOpen : ''}`}
                  title={stageLabel(st.key, djType)}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (open) { setMenuOpenKey(null); return; }
                    menuBtnRef.current = e.currentTarget as HTMLElement;
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    {
                      const MENU_W = 210;
                      const left = Math.min(Math.max(8, r.left), window.innerWidth - MENU_W - 8);
                      setMenuPos({ top: r.bottom + 6, left });
                    }
                    setMenuOpenKey(st.key);
                  }}
                >
                  <span className={styles.stTop}>{inner}</span>
                  <span className={styles.stCap} style={{ color: capColor }}>{cap || ''}</span>
                </button>
              ) : (
                <div className={styles.stBtn} style={{ cursor: 'default' }} title={stageLabel(st.key, djType)}>
                  <span className={styles.stTop}>{inner}</span>
                  <span className={styles.stCap} style={{ color: capColor }}>{cap || ''}</span>
                </div>
              )}
              {open && hasMenu && menuPos && (
                <StageMenu
                  st={st}
                  pos={menuPos}
                  djType={djType}
                  openedLabelText={openedLabel(st.key)}
                  actionLocked={actionLocked}
                  overrideLocked={overrideLockedFor(st.key)}
                  onClose={() => setMenuOpenKey(null)}
                  onRunAction={(run) => { setMenuOpenKey(null); run(); }}
                  onToggleOverride={() => onToggleOverride(st.key, !st.done)}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
