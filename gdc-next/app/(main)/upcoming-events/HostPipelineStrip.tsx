'use client';

// HostPipelineStrip — the host's pipeline for the card header. Uses the EXACT
// same measurements as the DJ's PipelineStrip (icon 30px, label 9px, caption
// 9.5px, badge 14px at -3/-3, grey ring for pending / neon ring + check for
// done, amber caption for the "your move" stage). Clickable stages (pay a
// deposit/balance, open the planner) drop a small action menu.

import { useState, useEffect, useRef, type CSSProperties } from 'react';
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

// Exact copies of the DJ strip's cell measurements. Labels wrap so each stage
// can sit in a fixed-width column (keeps stages aligned row-to-row).
const labelStyle: CSSProperties = { fontSize: 9, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: '#f0f0f8', whiteSpace: 'nowrap', lineHeight: 1.15, textAlign: 'center' };
const capBase: CSSProperties = { fontSize: 9.5, fontWeight: 500, letterSpacing: '.03em', lineHeight: 1, minWidth: 36, textAlign: 'center', whiteSpace: 'nowrap' };

export default function HostPipelineStrip({
  steps,
  djType,
  spread = false,
}: {
  steps: HostStep[];
  djType: 'club' | 'mobile';
  /** Full-width, evenly-distributed icons (mobile band). Default is a
      centered cluster with fixed gaps (desktop header). */
  spread?: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Which stage's receipt is downloading right now — drives a transient spinner
  // ring on that icon (same cue as the DJ dashboard). Purely cosmetic; clears
  // the moment the download resolves.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Pull the receipt as a blob (so we can show the spinner while it builds),
  // then trigger the file download. Falls back to opening the link on any error.
  async function downloadVia(href: string, key: string) {
    setOpenKey(null);
    setBusyKey(key);
    try {
      const res = await fetch(href);
      if (!res.ok) { window.open(href, '_blank', 'noopener'); return; }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename="?([^"]+)"?/.exec(cd);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = m ? m[1] : 'Receipt.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { window.open(href, '_blank', 'noopener'); }
    finally { setBusyKey(null); }
  }

  // Close the open action menu on any click outside the strip (and on Escape).
  useEffect(() => {
    if (!openKey) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpenKey(null);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpenKey(null); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openKey]);

  if (!steps || steps.length === 0) return null;
  const ordered = ORDER.map((k) => steps.find((s) => s.key === k)).filter(Boolean) as HostStep[];
  // "Your move" is the first stage that's neither done nor muted (Skipped /
  // Not Required / Not Sent stages are inert and never light up amber).
  const currentKey = ordered.find((s) => !s.done && !s.muted)?.key ?? null;

  return (
    <div ref={wrapRef} style={spread
      ? { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' }
      : { display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 10 }}>
      <style>{'@keyframes gdcHostSpin{to{transform:rotate(360deg)}}'}</style>
      {ordered.map((st) => {
        const done = st.done;
        const isNow = st.key === currentKey;
        const clickable = !!st.href;
        const open = openKey === st.key;
        const busy = busyKey === st.key;
        // Ring: neon + fill for done, calm grey otherwise (the DJ carries "your
        // move" in the caption colour, not by lighting the ring).
        const ring: CSSProperties = done
          ? { borderColor: NEON, background: 'rgba(34,227,173,.14)', color: NEON }
          : { borderColor: '#3a3a4c', color: isNow ? '#b9b9c6' : '#c2c2ce' };
        // Any clickable "your move" stage reads amber (like the contract's "Sign
        // Here"), not just the single current step — so a payable deposit/balance
        // or an open planner invites the click instead of looking inert-grey.
        const capColor = done ? DONE_CAP : (isNow || clickable) ? TODO_CAP : '#5a5a72';

        const iconRing = (
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, fontSize: 16, borderRadius: '50%', border: '2px solid', boxSizing: 'border-box', ...ring, ...(busy ? { borderColor: 'transparent' } : null) }}>
            {stageIcon(st.icon)}
            {/* While downloading, the circle's own border goes transparent and a
                spinning arc of the same geometry becomes the circle. */}
            {busy && (
              <span aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, width: 30, height: 30, borderRadius: '50%', border: '2px solid transparent', borderTopColor: NEON, borderRightColor: NEON, boxSizing: 'border-box', animation: 'gdcHostSpin .7s linear infinite' }} />
            )}
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
        // In spread (mobile) mode labels wrap and cells share the width evenly
        // so the strip never overflows the card, however long a label is.
        const labelSpread: CSSProperties = spread
          ? { whiteSpace: 'normal', lineHeight: 1.1, wordBreak: 'break-word' }
          : {};
        const capSpread: CSSProperties = spread ? { whiteSpace: 'normal', minWidth: 0 } : {};
        const inner = (
          <>
            <span style={{ ...labelStyle, ...labelSpread, marginBottom: 2 }}>{stageLabel(st.key, djType)}</span>
            {top}
            <span style={{ ...capBase, ...capSpread, color: capColor, marginTop: 5 }}>{st.caption}</span>
          </>
        );
        return (
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', ...(spread ? { flex: '1 1 0', minWidth: 0 } : { width: 108 }) }} key={st.key}>
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
                  {[
                    { href: st.href, label: st.hrefLabel },
                    ...(st.href2 ? [{ href: st.href2, label: st.hrefLabel2 }] : []),
                  ].map((a, i) => (
                    <a key={i} href={a.href} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => {
                        e.stopPropagation();
                        // A receipt download goes through fetch() so the icon
                        // shows a spinner while the PDF builds; other links (pay,
                        // open planner) navigate normally.
                        if (a.label?.startsWith('Download') && a.href) {
                          e.preventDefault();
                          void downloadVia(a.href, st.key);
                        }
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,.08)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 12px', borderRadius: 7, background: 'transparent', transition: 'background .12s ease', color: '#fff', fontSize: 12.5, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                      <span>{a.label}</span>
                      {a.label?.startsWith('Download') ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                      ) : null}
                    </a>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
