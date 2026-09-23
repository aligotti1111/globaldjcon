'use client';

// HostPipelineStrip — the host's read-only pipeline for the card header.
// Rebuilt to match the DJ header cell exactly: LABEL on top, icon in a ring,
// caption below (e.g. "Skipped" / "33%" / "Paid"). View-only, no menus.

import type { CSSProperties } from 'react';
import type { PipelineStep } from '../upcoming-bookings/pipeline/types';
import { stageLabel } from '../upcoming-bookings/pipeline/types';

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
  steps: PipelineStep[];
  djType: 'club' | 'mobile';
}) {
  if (!steps || steps.length === 0) return null;
  const ordered = ORDER.map((k) => steps.find((s) => s.key === k)).filter(Boolean) as PipelineStep[];
  const currentKey = ordered.find((s) => !s.done)?.key ?? null;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 22 }}>
      {ordered.map((st) => {
        const done = st.done;
        const isNow = st.key === currentKey;
        const ring: CSSProperties = done
          ? { borderColor: NEON, background: 'rgba(34,227,173,.14)', color: NEON }
          : { borderColor: '#3a3a4c', color: '#c2c2ce' };
        const capColor = done ? NEON : isNow ? AMBER : '#7d7d92';
        return (
          <div key={st.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, minWidth: 58 }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: '#f2f2f7', whiteSpace: 'nowrap' }}>
              {stageLabel(st.key, djType)}
            </span>
            <span style={{ position: 'relative', width: 30, height: 30, borderRadius: '50%', border: '1.5px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', ...ring }}>
              {stageIcon(st.icon)}
              {done && (
                <span style={{ position: 'absolute', right: -4, bottom: -4, width: 14, height: 14, borderRadius: '50%', background: NEON, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#06231b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
              )}
            </span>
            {st.caption && (
              <span style={{ fontSize: 10.5, fontWeight: 700, color: capColor, whiteSpace: 'nowrap' }}>{st.caption}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
