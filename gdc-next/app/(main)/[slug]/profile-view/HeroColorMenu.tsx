'use client';

import { useEffect, useRef, useState } from 'react';

// Owner-only "⋯" menu shown next to the hero name and the location. One button
// opens a small popover where the text colour and the semi-transparent colour
// band are set separately (band can also be removed). One instance per element.
export function HeroColorMenu({ which, textColor, onText, band, onBand }: {
  which: 'name' | 'location';
  textColor: string;
  onText: (hex: string) => void;
  band: string | null;
  onBand: (hex: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const noun = which === 'name' ? 'Name' : 'Location';
  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '7px 4px' };
  const labelStyle: React.CSSProperties = { fontFamily: "'Space Mono', monospace", fontSize: 11, color: '#fff', textTransform: 'uppercase', letterSpacing: '.05em' };
  const swatchInput: React.CSSProperties = { width: 30, height: 22, padding: 0, border: '1px solid rgba(255,255,255,.4)', borderRadius: 5, background: 'transparent', cursor: 'pointer' };
  // Live preview band behind the "Color band" label: the chosen band colour at
  // ~50% opacity, or a subtle neutral tint when no band is set yet.
  const bandLabelBg = (() => {
    const m = band ? /^#?([0-9a-fA-F]{6})$/.exec(band) : null;
    if (!m) return 'rgba(255,255,255,.14)';
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, .5)`;
  })();

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', marginLeft: 10, transform: 'translateY(-2px)', verticalAlign: 'middle', flexShrink: 0, zIndex: open ? 3000 : undefined }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Style the ${noun.toLowerCase()}`}
        aria-label={`Style the ${noun.toLowerCase()}`}
        aria-expanded={open}
        style={{ height: 26, width: 16, padding: 0, borderRadius: 5, background: 'rgba(0,0,0,.55)', border: '1px solid var(--neon)', color: 'var(--neon)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: 0 }}
      >
        <svg width="4" height="14" viewBox="0 0 4 14" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
          <circle cx="2" cy="2" r="1.7" />
          <circle cx="2" cy="7" r="1.7" />
          <circle cx="2" cy="12" r="1.7" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          style={{ position: 'absolute', top: 30, right: 0, zIndex: 3000, minWidth: 214, background: '#14141f', border: '1px solid rgba(255,255,255,.16)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.55)', padding: '6px 10px 8px', textAlign: 'left' }}
        >
          <div style={{ ...labelStyle, fontSize: 9.5, color: 'var(--neon)', padding: '4px 4px 2px' }}>{noun} style</div>
          <div style={rowStyle}>
            <span style={labelStyle}>Text color</span>
            <input type="color" value={textColor} onChange={(e) => onText(e.target.value)} style={swatchInput} aria-label={`${noun} text color`} />
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,.1)' }} />
          <div style={rowStyle}>
            <span style={{ ...labelStyle, background: bandLabelBg, padding: '.12em .4em', borderRadius: 4 }}>Color band</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {band && (
                <button type="button" onClick={() => onBand(null)} style={{ background: 'none', border: 'none', color: 'var(--muted,#8a8aa0)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', cursor: 'pointer' }}>
                  Remove
                </button>
              )}
              <input
                type="color"
                value={band || textColor}
                onChange={(e) => onBand(e.target.value)}
                style={swatchInput}
                title={band ? 'Change band color' : 'Add a color band'}
                aria-label={`${noun} color band`}
              />
            </span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted,#8a8aa0)', lineHeight: 1.4, padding: '2px 4px 0' }}>
            The band is a semi-transparent strip behind the {noun.toLowerCase()}.
          </div>
        </div>
      )}
    </span>
  );
}
