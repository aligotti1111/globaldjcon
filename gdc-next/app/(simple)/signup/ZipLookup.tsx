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
  // Placeholder example matches the selected country's postal-code format
  // (e.g. "10001" for US, "SW1A 1AA" for UK). Falls back to the US example.
  const zipExample = COUNTRIES.find((c) => c.name === country)?.zipExample || '10001';

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
          // NYC boroughs come back from Nominatim as "New York" — substitute
          // the borough name from the display string when we can find it.
          const nycBoroughs = ['Staten Island', 'Brooklyn', 'Queens', 'The Bronx', 'Manhattan'];
          const boroughMatch = nycBoroughs.find(b => displayName.includes(b));
          const foundCity = boroughMatch
            || addr.city_district
            || (addr.suburb && addr.city && addr.suburb !== addr.city ? addr.suburb : null)
            || addr.town
            || addr.city
            || addr.municipality
            || addr.village
            || addr.hamlet
            || '';
          const foundState = addr.state || '';
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
        placeholder={zipExample ? `e.g. ${zipExample}` : 'e.g. 10001'}
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
