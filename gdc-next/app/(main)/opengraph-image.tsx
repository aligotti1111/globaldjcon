// Open Graph preview image for the marketing homepage (and any (main) page
// that doesn't define its own). DJ profiles keep their own opengraph-image
// at (main)/[slug]/opengraph-image.tsx, which overrides this at that segment.
//
// Mirrors the profile OG image: 1200x630, next/og ImageResponse, default
// font (no font files needed). Next wires it into og:image / twitter:image
// automatically.

import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const alt = 'Global DJ Connect — Get booked. Get paid. Keep playing.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: '#000000',
          padding: '0 80px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 26,
            letterSpacing: '0.25em',
            color: '#00f5c4',
            textTransform: 'uppercase',
            marginBottom: 26,
          }}
        >
          Connecting party hosts &amp; venues to premium DJs
        </div>
        <div style={{ display: 'flex', fontSize: 100, fontWeight: 700, letterSpacing: '-0.01em' }}>
          <span style={{ color: '#f0f0f8' }}>GLOBAL DJ&nbsp;</span>
          <span style={{ color: '#00f5c4' }}>CONNECT</span>
        </div>
        <div style={{ fontSize: 34, color: '#c9c9d3', marginTop: 30 }}>
          Get booked. Get paid. Keep playing.
        </div>
      </div>
    ),
    { ...size }
  );
}
