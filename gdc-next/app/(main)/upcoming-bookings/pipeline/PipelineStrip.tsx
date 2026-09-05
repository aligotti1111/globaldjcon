'use client';

// PipelineStrip — the four/five status cells on a booking row (Contract,
// Deposit, Planner/Rider, Balance, Guest list). Extracted verbatim from
// BookingRow (refactor phase 1). Pure presentation: the row still owns the
// steps array and the menu open/position state, and passes them in; this draws
// the cells and mounts StageMenu for the open one.

import type { CSSProperties, MutableRefObject } from 'react';
import styles from '../upcomingBookings.module.css';
import { MUTED } from '../shared';
import StageMenu from './StageMenu';
import { stageLabel, type PipelineStep } from './types';

// Stage icons — thin monochrome line icons (colour set by the caller via
// `currentColor`), replacing the coloured emoji that made the row read busy.
// One SVG per st.icon value: money → cash, music → note, receipt → receipt,
// anything else (contract) → a document.
function stageIcon(icon: string) {
  const p = {
    width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.9,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  if (icon === 'money') {
    return (<svg {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 10v4M18 10v4" /></svg>);
  }
  if (icon === 'music') {
    return (<svg {...p}><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="16" r="2.5" /><path d="M8.5 18V5l12-2v11" /></svg>);
  }
  if (icon === 'receipt') {
    return (<svg {...p}><path d="M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>);
  }
  return (<svg {...p}><path d="M14 3v5h5" /><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M8 13h8M8 17h6" /></svg>);
}


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
  // Short stage name shown ABOVE each icon (mobile framed cards only; hidden on
  // desktop, which already has column headers). Shorter than stageLabel so it
  // fits a narrow phone column — "Playlist" not "Planner & Playlist".
  const shortLabel = (k: string): string =>
    k === 'song_list' ? (djType === 'club' ? 'Rider' : 'Playlist')
      : k === 'contract' ? 'Contract'
      : k === 'deposit' ? 'Deposit'
      : k === 'invoice' ? 'Balance'
      : k === 'guestlist' ? 'Guests'
      : '';

  return (
    <div className={styles.statusStrip}>
      {slots.map((slotKey) => {
        const st = steps.find((s) => s.key === slotKey);
        const isNew = newSlot != null && slotKey === newSlot;
        if (!st) {
          return (
            <div key={slotKey} className={styles.stCell}>
              <span className={styles.stLabel}>{shortLabel(slotKey)}</span>
              <span className={styles.stDash} aria-hidden="true">—</span>
            </div>
          );
        }
        const open = menuOpenKey === st.key;
        const hasMenu = (st.actions?.length ?? 0) > 0 || st.overridable || !!st.info || !!st.hint;
        const waiting = !st.done && (!!st.caption || st.state === 'pending');
        // Skipped = a muted step that still counts as "done" (e.g. a skipped
        // deposit): resolved, not completed. It reads WHITE — neutral, with no
        // green anywhere on it (no green caption, icon or check).
        const skipped = st.done && st.color === MUTED;
        const positiveDone = st.done && !skipped;
        const capColor = skipped
          ? '#f2f2f7'
          : st.color === MUTED
            ? '#5a5a72'
            : st.done
              ? '#3fd6ab'
              : '#c08a3e';
        // INVARIANT: a done step can never say it's waiting.
        const cap = st.done && st.caption === 'Pending' ? undefined : st.caption;
        // "Not sent" reads red so it stands apart from an amber "Pending".
        const capColorFinal = /^not sent$/i.test(cap || '') ? '#ff6b6b' : capColor;
        // A stage the DJ turned OFF in their pipeline settings: it shows the
        // greyed icon + "Not Required" so it can still be deployed on a one-off,
        // but it must read as muted — NOT as an amber "your move" step. No dot,
        // dim ring, grey icon.
        const notRequired = !st.done && /^not required$/i.test(st.caption || '');
        // Circular-node ring, per state. Purely visual. DONE is the only state
        // the ring itself colours — teal + a check. Everything still to do reads
        // as a calm neutral-grey ring; which one is "your move" is carried by the
        // caption underneath (amber), not by lighting up every node. A page where
        // every incomplete step glowed amber made nothing stand out.
        const ringStyle: CSSProperties = notRequired
          ? { borderColor: '#2f2f3d' }
          : positiveDone
          ? { borderColor: 'var(--neon,#00e0a4)', background: 'rgba(34,227,173,.14)' }
          : (!st.done && waiting)
            ? { borderColor: 'rgba(255,255,255,.16)' }
            : skipped
              ? { borderColor: 'rgba(255,255,255,.28)' }
              : { borderColor: '#3a3a4c' };
        const iconColor = notRequired
          ? '#5a5a72'
          : positiveDone
          ? 'var(--neon,#00e0a4)'
          : (!st.done && waiting)
            ? '#b9b9c6'
            : skipped ? '#f2f2f7' : '#c2c2ce';
        const inner = (
          <>
            <span className={styles.stIcon} style={{ color: iconColor, ...ringStyle }}>
              {stageIcon(st.icon)}
              {positiveDone && (
                <span className={styles.stBadge}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#06231b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
              )}
              {!st.done && waiting && !notRequired && <span className={styles.stDot} />}
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
            {/* Label sits on the cell's top edge (mobile) — a direct child of
                the cell so it can be absolutely positioned on the border line,
                not tucked inside the icon button. Hidden on desktop. */}
            <span className={styles.stLabel} style={{ color: '#f2f2f7' }}>{shortLabel(st.key)}</span>
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
                  <span className={styles.stCap} style={{ color: capColorFinal }}>{cap || ''}</span>
                </button>
              ) : (
                <div className={styles.stBtn} style={{ cursor: 'default' }} title={stageLabel(st.key, djType)}>
                  <span className={styles.stTop}>{inner}</span>
                  <span className={styles.stCap} style={{ color: capColorFinal }}>{cap || ''}</span>
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
