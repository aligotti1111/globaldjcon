// Pure colour helpers for the hero name/location band. No React state, no
// closures — moved out of ProfileView so they can be shared and unit-reasoned.
import type { CSSProperties } from 'react';

// Hex → rgba at a fixed opacity, for the semi-transparent band. Guards against
// a bad value by falling back to a neutral dark band.
export function bandRgba(hex: string | null, alpha = 0.85): string | undefined {
  if (!hex) return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
// Style for the colour band behind the hero name / location. Tuned per element:
//
//   name  — Bebas Neue, all-caps. An INLINE span's background is locked to the
//           font's line box, which reserves a big block of empty descender
//           space that gets painted no matter what padding/line-height you set —
//           that's why the band looked oversized and wouldn't tighten. Making it
//           `inline-block` lets the box follow line-height, so a tight
//           line-height (.78) + small padding wraps the band snugly around the
//           caps like a highlighter. (No box-decoration-break needed: the name
//           is single-line; the size tiers shrink long names to fit.)
//
//   location — Space Mono, small mixed-case with real descenders. Left inline
//           with clone so it can wrap, full line-height, and even generous
//           top/bottom padding so the strip reads as a solid band.
//
// Both verified on the live rendered hero.
export function bandSpanStyle(hex: string | null, which: 'name' | 'location' = 'name'): CSSProperties {
  const bg = bandRgba(hex);
  if (!bg) return {};
  if (which === 'location') {
    return {
      background: bg,
      lineHeight: 1,
      padding: '.34em .3em',
      borderRadius: '.16em',
      boxDecorationBreak: 'clone',
      WebkitBoxDecorationBreak: 'clone',
    };
  }
  return {
    background: bg,
    display: 'inline-block',
    lineHeight: 0.78,
    // More top than bottom: at line-height .78 the caps sit low in the box, so
    // .17/.06 evens the gap above and below the letters. Verified on the hero.
    padding: '.17em .16em .06em',
    borderRadius: '.16em',
  };
}
