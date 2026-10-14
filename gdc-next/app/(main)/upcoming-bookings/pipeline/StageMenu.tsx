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

import type { ReactElement } from 'react';
import { NEON } from '../shared';

// Inline icon set for the menu rows. All stroke currentColor so each icon
// inherits its row's text color (neon / danger red / muted) for free.
const ico = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { flexShrink: 0 } };
const IconEdit = () => (<svg {...ico}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>);
const IconSend = () => (<svg {...ico}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>);
const IconDownload = () => (<svg {...ico}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>);
const IconGear = () => (<svg {...ico}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>);
const IconDoc = () => (<svg {...ico}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>);
const IconMusic = () => (<svg {...ico}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>);
const IconDollar = () => (<svg {...ico}><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>);
const IconCheck = () => (<svg {...ico}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>);
const IconX = () => (<svg {...ico}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>);
const IconDot = () => (<svg {...ico}><circle cx="12" cy="12" r="4" /></svg>);

// Pick an icon from the action's label text.
function iconForLabel(label: string): ReactElement {
  const l = label.toLowerCase();
  if (l.includes('edit')) return <IconEdit />;
  if (l.includes('download')) return <IconDownload />;
  if (l.includes('option')) return <IconGear />;
  if (l.includes('contract')) return <IconDoc />;
  if (l.includes('planner') || l.includes('playlist') || l.includes('rider') || l.includes('song')) return <IconMusic />;
  if (l.includes('request') || l.includes('deposit') || l.includes('balance')) return <IconDollar />;
  if (l.includes('send') || l.includes('invoice') || l.includes('receipt')) return <IconSend />;
  return <IconDot />;
}

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
  actions?: { label: string; run: () => void; danger?: boolean; disabled?: boolean; title?: string }[];
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
  st, pos, openedLabelText, actionLocked, overrideLocked,
  onClose, onRunAction, onToggleOverride,
}: Props) {
  // Deposit/balance are confirmed by hand for every rail except card (Stripe
  // self-confirms), so "handled outside the app" reads wrong there — it's the
  // normal way you mark a Venmo/Cash App/Zelle/cash payment received.
  // 'invoice' is the balance/final-invoice stage's key; 'deposit' is the deposit.
  const payStage = st.key === 'deposit' || st.key === 'balance' || st.key === 'invoice';
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.5)', padding: 4, minWidth: 170, maxWidth: 210, whiteSpace: 'nowrap' }}>
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
          // A per-action `disabled` shows the action but greys it out (e.g.
          // "Request balance" while a deposit is still pending) — distinct from
          // the role-based `actionLocked`, which shows a permissions lock.
          const roleLocked = actionLocked(a.label);
          const locked = roleLocked || !!a.disabled;
          return (
            <button
              key={a.label}
              type="button"
              disabled={locked}
              title={a.title || (roleLocked ? NO_ACCESS : undefined)}
              onClick={() => { if (locked) return; onRunAction(a.run); }}
              onMouseEnter={(e) => { if (!locked) e.currentTarget.style.background = 'rgba(255,255,255,.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: locked ? 'var(--muted,#7a7a90)' : (a.danger ? '#ff7676' : NEON), fontWeight: 700, fontSize: '.78rem', padding: '.5rem .6rem', borderRadius: 6, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.55 : 1, transition: 'background .12s' }}
            >
              {iconForLabel(a.label)}
              <span>{titleCase(a.label)}{roleLocked ? '  \u{1F512}' : ''}</span>
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
              onMouseEnter={(e) => { if (!overrideLocked) e.currentTarget.style.background = 'rgba(255,255,255,.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: overrideLocked ? 'var(--muted,#7a7a90)' : (st.done ? '#ff9a9a' : NEON), fontWeight: 700, fontSize: '.78rem', padding: '.5rem .6rem', borderRadius: 6, cursor: overrideLocked ? 'not-allowed' : 'pointer', opacity: overrideLocked ? 0.55 : 1, transition: 'background .12s' }}
            >
              {st.done ? <IconX /> : <IconCheck />}
              <span>{st.done ? (payStage ? 'Mark Not Paid' : 'Mark Not Complete') : (payStage ? 'Mark Paid' : 'Mark Complete')}{overrideLocked ? '  \u{1F512}' : ''}</span>
            </button>
            {!payStage && (
              <div style={{ color: 'var(--muted,#7a7a90)', fontSize: '.66rem', padding: '2px 8px 5px', whiteSpace: 'normal', maxWidth: 190, lineHeight: 1.4 }}>For steps handled outside the app.</div>
            )}
          </>
        )}
      </div>
    </>
  );
}
