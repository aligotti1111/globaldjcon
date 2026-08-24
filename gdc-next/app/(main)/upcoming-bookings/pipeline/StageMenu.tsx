'use client';

// StageMenu — the dropdown that opens off a pipeline cell (Contract / Deposit /
// Planner / Balance / Guest list). Extracted verbatim from BookingRow's inline
// menu (refactor phase 1) as a presentational component: it renders the
// fixed-position menu + its dismiss backdrop and calls back for every action.
//
// Positioning is still driven by the row (it measures the button and passes
// `pos`); this component only draws. Both the menu and the backdrop
// stopPropagation because, being position:fixed, they're still DOM children of
// the row and their clicks would otherwise bubble into the row's expand toggle.

import { stageLabel } from './types';
import { NEON } from '../shared';

// Only the fields the menu reads — BookingRow's richer step object is
// structurally assignable to this.
export type StageMenuStep = {
  key: string;
  done: boolean;
  overridable: boolean;
  /** Done via the DJ's manual "Mark Complete" toggle, not signed/paid in-app. */
  manualComplete?: boolean;
  info?: string;
  hint?: string;
  actions?: { label: string; run: () => void; danger?: boolean }[];
};

const NO_ACCESS = 'Your account level doesn’t have access to this. Ask an owner or manager.';
const titleCase = (str: string): string => str.replace(/\b[a-z]/g, (c) => c.toUpperCase());

// Stage display name — mirrors BookingRow.iconName (song_list is the Rider on
// club, the Planner on mobile).

interface Props {
  st: StageMenuStep;
  pos: { top: number; left: number };
  djType: 'club' | 'mobile';
  /** Precomputed "Viewed …" line for this stage's client email, or empty. */
  openedLabelText: string | null | undefined;
  /** Whether a given menu action is locked for this acting role. */
  actionLocked: (label: string) => boolean;
  /** Whether the Mark Complete override is locked for this acting role. */
  overrideLocked: boolean;
  onClose: () => void;
  /** Close the menu, then run the chosen action. */
  onRunAction: (run: () => void) => void;
  /** Toggle the manual "mark complete" override. */
  onToggleOverride: () => void;
}

export default function StageMenu({
  st, pos, djType, openedLabelText, actionLocked, overrideLocked,
  onClose, onRunAction, onToggleOverride,
}: Props) {
  // Deposit/balance are confirmed by hand for every rail except card (Stripe
  // self-confirms), so "handled outside the app" reads wrong there — it's the
  // normal way you mark a Venmo/Cash App/Zelle/cash payment received.
  const payStage = st.key === 'deposit' || st.key === 'balance';
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.5)', padding: 4, minWidth: 170, maxWidth: 210, whiteSpace: 'nowrap' }}>
        <div style={{ color: 'var(--white,#fff)', fontSize: '.8rem', fontWeight: 800, letterSpacing: '.02em', padding: '.5rem .7rem .4rem' }}>
          {stageLabel(st.key, djType)}
        </div>
        <div style={{ height: 1, background: 'rgba(255,255,255,.1)', margin: '0 6px 4px' }} />
        {st.manualComplete && (
          <div style={{ color: 'var(--neon,#00e0a4)', fontSize: '.72rem', fontWeight: 700, padding: '.35rem .7rem .4rem', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'normal', maxWidth: 190 }}>
            <span style={{ fontSize: '.82rem' }}>&#10003;</span> Manually marked complete
          </div>
        )}
        {st.info && (
          <>
            <div style={{ color: 'var(--white,#fff)', fontSize: '.75rem', fontWeight: 600, lineHeight: 1.4, whiteSpace: 'normal', maxWidth: 190, padding: '.45rem .6rem .35rem' }}>
              {st.info}
            </div>
            <div style={{ height: 1, background: 'rgba(255,255,255,.1)', margin: '0 6px 3px' }} />
          </>
        )}
        {openedLabelText && (
          <div style={{ color: 'var(--neon,#00e0a4)', fontSize: '.68rem', fontWeight: 600, padding: '.1rem .6rem .35rem', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: '.8rem' }}>&#128065;</span>{openedLabelText}
          </div>
        )}
        {st.hint && (
          <div style={{ color: '#ff8a8a', fontSize: '.7rem', lineHeight: 1.45, padding: '.5rem .6rem .1rem', whiteSpace: 'normal', maxWidth: 190 }}>
            {st.hint}
          </div>
        )}
        {(st.actions ?? []).map((a) => {
          const locked = actionLocked(a.label);
          return (
            <button
              key={a.label}
              type="button"
              disabled={locked}
              title={locked ? NO_ACCESS : undefined}
              onClick={() => { if (locked) return; onRunAction(a.run); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: locked ? 'var(--muted,#7a7a90)' : (a.danger ? '#ff7676' : NEON), fontWeight: 700, fontSize: '.78rem', padding: '.5rem .6rem', borderRadius: 6, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.55 : 1 }}
            >
              {titleCase(a.label)}{locked ? '  \u{1F512}' : ''}
            </button>
          );
        })}
        {st.overridable && (
          <>
            {(st.actions ?? []).length > 0 && (
              <div style={{ height: 1, background: 'rgba(255,255,255,.1)', margin: '3px 6px' }} />
            )}
            <button
              type="button"
              disabled={overrideLocked}
              title={overrideLocked ? NO_ACCESS : undefined}
              onClick={() => { if (overrideLocked) return; onToggleOverride(); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: overrideLocked ? 'var(--muted,#7a7a90)' : (st.done ? '#ff9a9a' : NEON), fontWeight: 700, fontSize: '.78rem', padding: '.5rem .6rem', borderRadius: 6, cursor: overrideLocked ? 'not-allowed' : 'pointer', opacity: overrideLocked ? 0.55 : 1 }}
            >
              {st.done ? '✕ Mark Not Complete' : '✓ Mark Complete'}{overrideLocked ? '  \u{1F512}' : ''}
            </button>
            <div style={{ color: 'var(--muted,#7a7a90)', fontSize: '.66rem', padding: '2px 8px 5px', whiteSpace: 'normal', maxWidth: 190, lineHeight: 1.4 }}>{payStage ? 'Marks it paid — use once you’ve been paid by Venmo, Cash App, Zelle, cash or check. (Card confirms itself.)' : 'For steps handled outside the app.'}</div>
          </>
        )}
      </div>
    </>
  );
}
