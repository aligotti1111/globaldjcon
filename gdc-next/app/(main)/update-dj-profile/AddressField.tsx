'use client';

import { useRef, useState } from 'react';
import styles from './updateDjProfile.module.css';
// THE booking form's address search — not a reimplementation. It strips
// county-level parts, maps NYC counties to their borough (Richmond County →
// Staten Island), abbreviates the US state, and returns a clean "street, City,
// ST zip" display plus lat/lon. Reusing it verbatim is the whole point: the
// DJ's address behaves identically to the venue address on the booking form.
import { searchAddresses, type AddressSuggestion } from '@/app/(main)/[slug]/mobileBookingForm';
import { parseDisplayAddress } from './generalTab.helpers';

// ── Business-address autocomplete ────────────────────────────────────────
// One line, same as the booking venue field. As the DJ types (3+ chars,
// debounced 350ms) we call the shared searchAddresses; picking a suggestion
// drops the cleaned full address into the box. City/state/zip are read back
// out of that clean string for the contract's structured fields. The country
// chip to the RIGHT scopes the search.

// Name → { 2-letter display code, flag emoji, Nominatim country code }. The
// chip shows "🇺🇸 US"; the cc biases the address lookup.
const COUNTRY_CHIPS: { name: string; code: string; flag: string; cc: string }[] = [
  { name: 'United States', code: 'US', flag: '🇺🇸', cc: 'us' },
  { name: 'United Kingdom', code: 'UK', flag: '🇬🇧', cc: 'gb' },
  { name: 'Canada', code: 'CA', flag: '🇨🇦', cc: 'ca' },
  { name: 'Australia', code: 'AU', flag: '🇦🇺', cc: 'au' },
  { name: 'Germany', code: 'DE', flag: '🇩🇪', cc: 'de' },
  { name: 'France', code: 'FR', flag: '🇫🇷', cc: 'fr' },
  { name: 'Netherlands', code: 'NL', flag: '🇳🇱', cc: 'nl' },
  { name: 'Spain', code: 'ES', flag: '🇪🇸', cc: 'es' },
  { name: 'Italy', code: 'IT', flag: '🇮🇹', cc: 'it' },
  { name: 'Brazil', code: 'BR', flag: '🇧🇷', cc: 'br' },
  { name: 'Mexico', code: 'MX', flag: '🇲🇽', cc: 'mx' },
  { name: 'Japan', code: 'JP', flag: '🇯🇵', cc: 'jp' },
  { name: 'South Africa', code: 'ZA', flag: '🇿🇦', cc: 'za' },
  { name: 'New Zealand', code: 'NZ', flag: '🇳🇿', cc: 'nz' },
  { name: 'Ireland', code: 'IE', flag: '🇮🇪', cc: 'ie' },
  { name: 'Sweden', code: 'SE', flag: '🇸🇪', cc: 'se' },
  { name: 'Norway', code: 'NO', flag: '🇳🇴', cc: 'no' },
  { name: 'Denmark', code: 'DK', flag: '🇩🇰', cc: 'dk' },
  { name: 'Belgium', code: 'BE', flag: '🇧🇪', cc: 'be' },
  { name: 'Switzerland', code: 'CH', flag: '🇨🇭', cc: 'ch' },
  { name: 'Portugal', code: 'PT', flag: '🇵🇹', cc: 'pt' },
  { name: 'Other', code: '🌐', flag: '', cc: '' },
];

export default function AddressField({
  address, country, onChange,
}: {
  address: string;
  country: string;
  onChange: (patch: { address?: string; city?: string; state?: string; zip?: string; country?: string }) => void;
}) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ISO code for the shared searchAddresses (it scopes results by country) —
  // the same value the booking form passes as venueCountry.
  const cc = COUNTRY_CHIPS.find((c) => c.name === country)?.cc || '';

  function handleType(v: string) {
    // Free text is saved even without a pick, so a manual address still works.
    onChange({ address: v });
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 3) { setSuggestions([]); setOpen(false); return; }
    // 3-char minimum + 350ms debounce — identical to the booking venue field.
    timer.current = setTimeout(async () => {
      const results = await searchAddresses(v.trim(), cc);
      setSuggestions(results);
      setOpen(results.length > 0);
    }, 350);
  }

  function pick(s: AddressSuggestion) {
    // s.display is the booking form's cleaned "street, City, ST zip" — county
    // stripped, NYC borough resolved, state abbreviated. Store it whole, and
    // read the parts back out for the contract's structured fields.
    const { city, state, zip } = parseDisplayAddress(s.display);
    onChange({ address: s.display, city, state, zip });
    setOpen(false);
    setSuggestions([]);
  }

  return (
    <div className={styles.formGroup} style={{ position: 'relative' }}>
      <label htmlFor="ud-address">Business Address</label>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'stretch' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            type="text"
            id="ud-address"
            autoComplete="off"
            placeholder="123 Main St, City, State"
            value={address}
            onChange={(e) => handleType(e.target.value)}
            // Delay the hide so a suggestion's onMouseDown fires before blur.
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
            className={styles.input}
            style={{ width: '100%' }}
          />
          {open && suggestions.length > 0 && (
            <div
              style={{
                position: 'absolute', zIndex: 50, left: 0, right: 0, top: '100%',
                margin: '.25rem 0 0',
                background: 'var(--card,#111)', border: '1px solid var(--border,#333)',
                borderRadius: 8, maxHeight: 320, overflowY: 'auto',
                boxShadow: '0 8px 24px rgba(0,0,0,.5)',
              }}
            >
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  // onMouseDown (not onClick) so it fires before the input blur —
                  // the same trick the booking form uses.
                  onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                  style={{
                    padding: '.55rem .75rem', color: 'var(--white,#fff)',
                    fontSize: '.82rem', cursor: 'pointer',
                    borderBottom: '1px solid var(--border,#222)', lineHeight: 1.35,
                  }}
                >
                  {s.display}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Country as a compact flag + code chip to the right of the box. */}
        <select
          aria-label="Country"
          value={country}
          onChange={(e) => onChange({ country: e.target.value })}
          className={styles.select}
          style={{ width: 'auto', flex: '0 0 auto' }}
        >
          {COUNTRY_CHIPS.map((c) => (
            <option key={c.name} value={c.name}>{c.flag} {c.code}</option>
          ))}
        </select>
      </div>
      <p className={styles.fieldHint}>
        Shown on contracts and used to pre-fill your mailing address. Start
        typing and pick from the list.
      </p>
    </div>
  );
}
