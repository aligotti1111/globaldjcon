'use client';

// DjSearchBar — the "find a DJ" search row for marketing pages that aren't the
// landing page (About, FAQ). It mirrors the homepage searchbar exactly: the
// dark rounded field with a magnifier, a country flag picker, and a location
// pin. Submitting sends the visitor to the DJ directory (/djs?q=<term>); the
// pin uses the browser's geolocation to search nearby (/djs?lat=&lng=).
//
// The landing page defines this row via scoped `.gdc-landing .searchbar` CSS;
// these pages aren't inside `.gdc-landing`, so the styles are inlined here to
// match those rules one-to-one.

import { useState } from 'react';

const COUNTRIES: { cc: string; flag: string; name: string }[] = [
  { cc: 'us', flag: '🇺🇸', name: 'United States' },
  { cc: 'gb', flag: '🇬🇧', name: 'United Kingdom' },
  { cc: 'ca', flag: '🇨🇦', name: 'Canada' },
  { cc: 'au', flag: '🇦🇺', name: 'Australia' },
  { cc: 'de', flag: '🇩🇪', name: 'Germany' },
  { cc: 'fr', flag: '🇫🇷', name: 'France' },
  { cc: 'nl', flag: '🇳🇱', name: 'Netherlands' },
  { cc: 'es', flag: '🇪🇸', name: 'Spain' },
  { cc: 'it', flag: '🇮🇹', name: 'Italy' },
  { cc: 'br', flag: '🇧🇷', name: 'Brazil' },
  { cc: 'mx', flag: '🇲🇽', name: 'Mexico' },
  { cc: 'jp', flag: '🇯🇵', name: 'Japan' },
  { cc: 'za', flag: '🇿🇦', name: 'South Africa' },
  { cc: 'nz', flag: '🇳🇿', name: 'New Zealand' },
  { cc: 'ie', flag: '🇮🇪', name: 'Ireland' },
  { cc: 'se', flag: '🇸🇪', name: 'Sweden' },
  { cc: 'no', flag: '🇳🇴', name: 'Norway' },
  { cc: 'dk', flag: '🇩🇰', name: 'Denmark' },
  { cc: 'be', flag: '🇧🇪', name: 'Belgium' },
  { cc: 'ch', flag: '🇨🇭', name: 'Switzerland' },
  { cc: 'pt', flag: '🇵🇹', name: 'Portugal' },
];

export default function DjSearchBar() {
  const [flag, setFlag] = useState('🇺🇸');
  const [focused, setFocused] = useState(false);

  function useMyLocation(e: React.MouseEvent<HTMLButtonElement>) {
    const btn = e.currentTarget;
    if (!navigator.geolocation) { alert('Your browser does not support location.'); return; }
    btn.style.opacity = '.5';
    navigator.geolocation.getCurrentPosition(
      (p) => { window.location.href = `/djs?lat=${p.coords.latitude}&lng=${p.coords.longitude}`; },
      (err) => {
        btn.style.opacity = '1';
        if (err && err.code === 1) {
          alert('Location is blocked for this site. Enable it in your browser: click the lock icon in the address bar → Site settings → Location → Allow, then tap the pin again.');
        } else {
          window.location.href = '/djs?near=1';
        }
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div style={{ borderBottom: '1px solid var(--line, rgba(255,255,255,.1))', background: '#000' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '16px clamp(1.2rem, 5vw, 4rem)',
          position: 'relative',
        }}
      >
        <form
          action="/djs"
          method="get"
          role="search"
          style={{
            width: 300,
            maxWidth: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '.6rem',
            padding: '.5rem .9rem',
            background: '#0c0c11',
            border: `1px solid ${focused ? 'var(--neon, #00e0a4)' : 'rgba(255,255,255,.14)'}`,
            borderRadius: 12,
            boxShadow: focused ? '0 0 0 4px rgba(0,245,196,.1)' : 'none',
            transition: 'border-color .2s, box-shadow .2s',
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--faint, #6a6a80)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 18, height: 18, flexShrink: 0 }}
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            name="q"
            placeholder="Search by zip or DJ name…"
            aria-label="Search by zip or DJ name"
            style={{
              flex: 1,
              minWidth: 0,
              background: 'none',
              border: 'none',
              outline: 'none',
              color: 'var(--ink, #fff)',
              fontSize: '.95rem',
            }}
          />
          <label style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer', position: 'relative' }} aria-label="Country">
            <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>{flag}</span>
            <svg viewBox="0 0 12 8" aria-hidden style={{ width: 10, height: 7, color: 'var(--faint, #6a6a80)', flexShrink: 0 }}>
              <path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            <select
              name="cc"
              defaultValue="us"
              onChange={(e) => {
                const c = COUNTRIES.find((x) => x.cc === e.target.value);
                if (c) setFlag(c.flag);
              }}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 0, appearance: 'none', WebkitAppearance: 'none' }}
            >
              {COUNTRIES.map((c) => (
                <option key={c.cc} value={c.cc} style={{ background: '#0c0c11', color: '#fff' }}>
                  {c.flag} {c.name}
                </option>
              ))}
            </select>
          </label>
        </form>
        <button
          type="button"
          aria-label="Use my location"
          title="Use my location"
          onClick={useMyLocation}
          style={{
            flexShrink: 0,
            width: 38,
            height: 38,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 20,
            lineHeight: 1,
            padding: 0,
          }}
        >
          📍
        </button>
      </div>
    </div>
  );
}
