'use client';

// HostPipelineStrip — the host's pipeline for the card header. Uses the EXACT
// same measurements as the DJ's PipelineStrip (icon 30px, label 9px, caption
// 9.5px, badge 14px at -3/-3, grey ring for pending / neon ring + check for
// done, amber caption for the "your move" stage). Clickable stages (pay a
// deposit/balance, open the planner) drop a small action menu.

import { useState, type CSSProperties } from 'react';
import { stageLabel } from '../upcoming-bookings/pipeline/types';
import type { HostStep } from '@/lib/hostPipeline';

const NEON = '#00e0a4';
const DONE_CAP = '#3fd6ab';
const TODO_CAP = '#c08a3e';

function stageIcon(icon: string) {
  const p = {
    width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.9,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  if (icon === 'money') return (<svg {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 10v4M18 10v4" /></svg>);
  if (icon === 'music') return (<svg {...p}><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="16" r="2.5" /><path d="M8.5 18V5l12-2v11" /></svg>);
  if (icon === 'receipt') return (<svg {...p}><path d="M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>);
  return (<svg {...p}><path d="M14 3v5h5" /><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M8 13h8M8 17h6" /></svg>);
}

const ORDER = ['contract', 'deposit', 'song_list', 'invoice', 'guestlist'];

// Exact copies of the DJ strip's cell measurements.
const labelStyle: CSSProperties = { fontSize: 9, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: '#f0f0f8', whiteSpace: 'nowrap', textAlign: 'center' };
const capBase: CSSProperties = { fontSize: 9.5, fontWeight: 500, letterSpacing: '.03em', lineHeight: 1, minWidth: 36, textAlign: 'center', whiteSpace: 'nowrap' };

export default function HostPipelineStrip({
  steps,
  djType,
}: {
  steps: HostStep[];
  djType: 'club' | 'mobile';
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (!steps || steps.length === 0) return null;
  const ordered = ORDER.map((k) => steps.find((s) => s.key === k)).filter(Boolean) as HostStep[];
  // "Your move" is the first stage that's neither done nor muted (Skipped /
  // Not Required / Not Sent stages are inert and never light up amber).
  const currentKey = ordered.find((s) => !s.done && !s.muted)?.key ?? null;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 56 }}>
      {ordered.map((st) => {
        const done = st.done;
        const isNow = st.key === currentKey;
        const clickable = !!st.href;
        const open = openKey === st.key;
        // Ring: neon + fill for done, calm grey otherwise (the DJ carries "your
        // move" in the caption colour, not by lighting the ring).
        const ring: CSSProperties = done
          ? { borderColor: NEON, background: 'rgba(34,227,173,.14)', color: NEON }
          : { borderColor: '#3a3a4c', color: isNow ? '#b9b9c6' : '#c2c2ce' };
        const capColor = done ? DONE_CAP : isNow ? TODO_CAP : '#5a5a72';

        const iconRing = (
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, fontSize: 16, borderRadius: '50%', border: '1.5px solid', boxSizing: 'border-box', ...ring }}>
            {stageIcon(st.icon)}
            {done && (
              <span style={{ position: 'absolute', right: -3, bottom: -3, width: 14, height: 14, borderRadius: '50%', background: NEON, border: '2px solid #16161f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#06231b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </span>
            )}
          </span>
        );
        const top = (
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            {iconRing}
            {clickable && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6c6c86" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 1 }}><polyline points="6 9 12 15 18 9" /></svg>
            )}
          </span>
        );
        const inner = (
          <>
            <span style={{ ...labelStyle, marginBottom: 6 }}>{stageLabel(st.key, djType)}</span>
            {top}
            <span style={{ ...capBase, color: capColor, marginTop: 5 }}>{st.caption}</span>
          </>
        );
        return (
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }} key={st.key}>
            {clickable ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpenKey(open ? null : st.key); }}
                title={st.hrefLabel}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', fontFamily: 'inherit' }}
              >
                {inner}
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>{inner}</div>
            )}
            {open && clickable && st.href && (
              <>
                <div onClick={(e) => { e.stopPropagation(); setOpenKey(null); }} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', zIndex: 41, background: '#14141f', border: '1px solid rgba(255,255,255,.16)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.55)', padding: 6, minWidth: 150 }}>
                  <a href={st.href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ display: 'block', padding: '8px 12px', borderRadius: 7, color: '#fff', fontSize: 12.5, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    {st.hrefLabel} →
                  </a>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
