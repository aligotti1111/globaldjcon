'use client';

// ZipLookup — ZIP code input that auto-fills city/state via Nominatim.
// Used by both DJ and Venue signup forms.
//
// Behavior matches vanilla sgn-zip.js:
//   - 600ms debounce after the user stops typing
//   - Calls Nominatim with the country code from the dropdown to narrow results
//   - Special-cases NYC boroughs (Brooklyn / Queens / etc.) which Nominatim
//     reports as just "New York"
//   - Status line below the input shows "Looking up..." / "City, State, Country"

import { useEffect, useState } from 'react';
import { COUNTRIES } from './helpers';
import { pickLocality } from '@/app/(main)/[slug]/mobileBookingForm';

interface ZipLookupProps {
  zip: string;
  country: string;
  onZipChange: (newZip: string) => void;
  // Called whenever the resolved city/state changes. Either or both may
  // be empty strings if the lookup didn't find a match (or if ZIP is too
  // short to look up yet).
  onLocationResolved: (city: string, state: string) => void;
  required?: boolean;
  inputId?: string;
}

export function ZipLookup({
  zip,
  country,
  onZipChange,
  onLocationResolved,
  required = false,
  inputId = 'zip-input',
}: ZipLookupProps) {
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!zip || zip.trim().length < 4) {
      setStatus(null);
      onLocationResolved('', '');
      return;
    }
    const timer = setTimeout(async () => {
      setStatus({ msg: 'Looking up...', ok: true });
      try {
        const countryEntry = COUNTRIES.find(c => c.name === country);
        const countryCode = countryEntry?.code || '';
        const url = countryCode
          ? `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&countrycodes=${countryCode}&format=json&limit=1&addressdetails=1`
          : `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&format=json&limit=1&addressdetails=1`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        const data = await res.json();
        if (data && data[0]) {
          const addr = data[0].address || {};
          const displayName = data[0].display_name || '';
          // Use the SAME locality resolver as the DJ-request/booking page so
          // the result is county-free and NYC boroughs are handled correctly
          // (e.g. ZIP 10307 → "Staten Island", never "Richmond County").
          const { city: foundCity, state: foundState } = pickLocality(addr, displayName);
          onLocationResolved(foundCity, foundState);
          const summary = [foundCity, foundState, country].filter(Boolean).join(', ');
          setStatus({ msg: summary, ok: true });
        } else {
          onLocationResolved('', '');
          setStatus({ msg: 'ZIP not found', ok: false });
        }
      } catch {
        setStatus(null);
      }
    }, 600);
    return () => clearTimeout(timer);
    // We deliberately exclude onLocationResolved from deps — it's a callback
    // that may be re-created each render. Including it would re-run the lookup
    // on every keystroke instead of waiting for the debounced timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zip, country]);

  return (
    <>
      <input
        id={inputId}
        type="text"
        placeholder="e.g. 10001"
        value={zip}
        onChange={(e) => onZipChange(e.target.value)}
        required={required}
      />
      {status && (
        <div
          style={{
            marginTop: '0.45rem',
            fontSize: '0.78rem',
            fontFamily: "'Space Mono', monospace",
            letterSpacing: '0.04em',
            color: status.ok ? '#3ddc84' : 'var(--muted)',
            minHeight: '1.1rem',
          }}
        >
          {status.msg}
        </div>
      )}
    </>
  );
}
