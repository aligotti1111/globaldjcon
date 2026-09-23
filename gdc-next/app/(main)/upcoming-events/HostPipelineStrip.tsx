'use client';

// HostPipelineStrip — the host's pipeline for the card header. Centered, and
// each stage is a cell (LABEL on top, icon in a ring, caption below). Stages
// the host can act on (pay a deposit/balance, open the planner) are clickable
// and drop down a small action menu; the rest are view-only.

import { useState, type CSSProperties } from 'react';
import { stageLabel } from '../upcoming-bookings/pipeline/types';
import type { HostStep } from '@/lib/hostPipeline';

const NEON = '#00e3ad';
const AMBER = '#eaa94a';

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
  const currentKey = ordered.find((s) => !s.done)?.key ?? null;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 34 }}>
      {ordered.map((st) => {
        const done = st.done;
        const isNow = st.key === currentKey;
        const clickable = !!st.href;
        const ring: CSSProperties = done
          ? { borderColor: NEON, background: 'rgba(34,227,173,.14)', color: NEON }
          : { borderColor: clickable ? AMBER : '#3a3a4c', color: clickable ? AMBER : '#c2c2ce' };
        const capColor = done ? NEON : isNow ? AMBER : '#7d7d92';
        const open = openKey === st.key;
        return (
          <div key={st.key} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, minWidth: 62 }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: '#f2f2f7', whiteSpace: 'nowrap' }}>
              {stageLabel(st.key, djType)}
            </span>
            {clickable ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpenKey(open ? null : st.key); }}
                title={st.hrefLabel}
                style={{ position: 'relative', width: 30, height: 30, borderRadius: '50%', border: '1.5px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, ...ring }}
              >
                {stageIcon(st.icon)}
                {done && (
                  <span style={{ position: 'absolute', right: -4, bottom: -4, width: 14, height: 14, borderRadius: '50%', background: NEON, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#06231b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                )}
              </button>
            ) : (
              <span style={{ position: 'relative', width: 30, height: 30, borderRadius: '50%', border: '1.5px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', ...ring }}>
                {stageIcon(st.icon)}
                {done && (
                  <span style={{ position: 'absolute', right: -4, bottom: -4, width: 14, height: 14, borderRadius: '50%', background: NEON, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#06231b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                )}
              </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700, color: capColor, whiteSpace: 'nowrap' }}>
              {st.caption}
              {clickable && (
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              )}
            </span>
            {open && clickable && st.href && (
              <>
                {/* click-away backdrop */}
                <div onClick={(e) => { e.stopPropagation(); setOpenKey(null); }} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', zIndex: 41, background: '#14141f', border: '1px solid rgba(255,255,255,.16)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.55)', padding: 6, minWidth: 150 }}>
                  <a
                    href={st.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: 'block', padding: '8px 12px', borderRadius: 7, color: '#fff', fontSize: 12.5, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
                  >
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
