// Utilities for the Mobile DJ booking form.
// Faithful port of helpers from vanilla djp-mob-public.js.
//
// US-only phone formatting in this session — international formats deferred.
// Address autocomplete (Nominatim) and distance check (Haversine) also deferred.

import type { MobilePackage } from './bookingSettings';

// Mobile-DJ event-type labels — vanilla djp-mob-public.js line 66.
// Note: these differ from the EVENT_TYPE_LABELS in constants.ts (which are
// for the profile hero). Mobile DJ form uses these short labels in the
// dropdown, e.g. "Wedding" not "Weddings".
export const MOB_EVENT_TYPE_LABELS: Record<string, string> = {
  weddings: 'Wedding',
  birthday: 'Birthday Party',
  corporate: 'Corporate Event',
  anniversary: 'Anniversary',
  graduation: 'Graduation',
  sweet16: 'Sweet 16 / Quinceañera',
  mitzvah: 'Bar/Bat Mitzvah',
  reunion: 'Reunion',
  holiday: 'Holiday Party',
  school: 'School Event',
  community: 'Community Event',
  other: 'Other',
};

// Time options every 30 min, 24 hours — vanilla djp-mob-public.js line 73.
// Returns objects with `val` (24h "HH:MM") and `label` (12h "H:MM AM/PM").
export interface TimeOption {
  val: string;    // "HH:MM" 24-hour
  label: string;  // "H:MM AM/PM"
}

export const MOB_TIME_OPTIONS: TimeOption[] = (() => {
  const opts: TimeOption[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      const label =
        `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
      opts.push({ val: `${hh}:${mm}`, label });
    }
  }
  return opts;
})();

// US phone formatter — vanilla MPF_PHONE_FORMATS.US.
// "1234567890" → "(123) 456-7890"
// International formats are deferred — most users are US.
export function formatUSPhone(raw: string): string {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 0) return '';
  if (d.length <= 3) return '(' + d;
  if (d.length <= 6) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
  return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6, 10);
}

// Map an event type to its package category — vanilla mobPubGetCategory.
// Mobile DJs organize packages into 'wedding', 'mitzvah', and 'general'.
export function getPackageCategory(eventType: string): 'wedding' | 'mitzvah' | 'general' {
  if (eventType === 'weddings') return 'wedding';
  if (eventType === 'mitzvah') return 'mitzvah';
  return 'general';
}

// Result of price calculation — used both for the live UI and the submit payload
export interface PriceResult {
  isQuote: boolean;          // true when no fixed price applies (request quote)
  price: number | null;      // total price in dollars, or null if quote
  overtimeHours: number;     // overtime hours included in the price (0 if none)
  depositAmount: number | null; // computed when price + depositPct
}

// Compute total price for a package given event duration.
// Faithful port of vanilla mobPubCalcPrice + the duplicated logic in
// mobPubSubmit. Combined into a single function here.
//
//  - If pkg has reqAll, always quote (no auto price)
//  - Otherwise, look up the price tier (price4/5/6) by ceiling of hours
//  - Above 6hrs, use the highest tier + overtime per hour
//  - If no tier matches and no overtime defined, fall through to quote
export function calcPrice(
  pkg: MobilePackage,
  startTime: string,
  endTime: string,
  depositPct: number
): PriceResult {
  if (pkg.reqAll) {
    return { isQuote: true, price: null, overtimeHours: 0, depositAmount: null };
  }

  let totalHours = 0;
  if (startTime && endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 1440; // overnight event
    totalHours = mins / 60;
  }

  let price: number | null = null;
  let overtimeHours = 0;
  let isQuote = false;

  if (totalHours > 0) {
    const hrs = Math.ceil(totalHours);
    const p4 = pkg.price4 != null && pkg.price4 !== '' ? Number(pkg.price4) : null;
    const p5 = pkg.price5 != null && pkg.price5 !== '' ? Number(pkg.price5) : null;
    const p6 = pkg.price6 != null && pkg.price6 !== '' ? Number(pkg.price6) : null;
    const ot = pkg.overtime != null && pkg.overtime !== '' ? Number(pkg.overtime) : null;

    if (hrs <= 4) {
      if (p4 != null) price = p4;
      else isQuote = true;
    } else if (hrs <= 5) {
      if (p5 != null) price = p5;
      else if (p4 != null && ot != null) {
        price = p4 + (hrs - 4) * ot;
        overtimeHours = hrs - 4;
      } else isQuote = true;
    } else if (hrs <= 6) {
      if (p6 != null) price = p6;
      else if (p5 != null && ot != null) {
        price = p5 + (hrs - 5) * ot;
        overtimeHours = hrs - 5;
      } else if (p4 != null && ot != null) {
        price = p4 + (hrs - 4) * ot;
        overtimeHours = hrs - 4;
      } else isQuote = true;
    } else {
      // > 6hrs — use highest tier + overtime
      const basePrice = p6 ?? p5 ?? p4;
      const baseHrs = p6 != null ? 6 : p5 != null ? 5 : 4;
      if (basePrice != null && ot != null) {
        price = basePrice + (hrs - baseHrs) * ot;
        overtimeHours = hrs - baseHrs;
      } else isQuote = true;
    }
  } else {
    // No times yet — show base price if available, else quote
    const p4 = pkg.price4 != null && pkg.price4 !== '' ? Number(pkg.price4) : null;
    const p5 = pkg.price5 != null && pkg.price5 !== '' ? Number(pkg.price5) : null;
    const p6 = pkg.price6 != null && pkg.price6 !== '' ? Number(pkg.price6) : null;
    if (p4 != null || p5 != null || p6 != null) {
      price = (p4 ?? p5 ?? p6) as number;
    } else {
      isQuote = true;
    }
  }

  let depositAmount: number | null = null;
  if (price != null && depositPct > 0) {
    depositAmount = Number((price * depositPct / 100).toFixed(2));
  }

  return { isQuote, price, overtimeHours, depositAmount };
}

// Format a date string (YYYY-MM-DD) into "Friday, April 24, 2026".
// Used by the form header. Adds T12:00:00 to avoid TZ shift.
export function formatLongDate(dateKey: string): string {
  return new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Address autocomplete + distance check (added in follow-up session)
// ─────────────────────────────────────────────────────────────────────────

// Haversine distance in miles. Vanilla djp-mob-public.js line 18.
export function haversineMiles(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// One-shot Nominatim postal-code lookup → {lat, lon} | null. Used to find
// the DJ's home base for the distance check.
export async function lookupZipCoords(
  zip: string
): Promise<{ lat: number; lon: number } | null> {
  if (!zip) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(zip)}&limit=1`
    );
    const data = await res.json();
    if (data && data[0]) {
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
  } catch {
    // Network or parse fail — silently skip the warning. Submission will
    // proceed without the distance check, matching vanilla behavior.
  }
  return null;
}

// Free-text address search → up to 5 suggestions. Each suggestion includes
// a cleaned display name (county-level admin parts stripped per Anthony's
// preference) and lat/lon for the distance check.
export interface AddressSuggestion {
  display: string;
  lat: number | null;
  lon: number | null;
}

export async function searchAddresses(
  query: string,
  // Optional ISO 3166-1 alpha-2 country code (e.g. "US", "GB"). When
  // present, restricts Nominatim results to that country only. Vanilla
  // ib_searchAddresses uses the same `countrycodes=` param when the
  // booker has picked a country on the booking form.
  country?: string | null,
): Promise<AddressSuggestion[]> {
  if (query.length < 3) return [];
  try {
    const cc = (country || '').trim().toLowerCase();
    const ccParam = cc ? `&countrycodes=${encodeURIComponent(cc)}` : '';
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1${ccParam}`
    );
    const results = await res.json();
    if (!Array.isArray(results)) return [];
    return results.map((r: {
      display_name?: string;
      lat?: string;
      lon?: string;
      address?: Record<string, string>;
    }) => {
      // Original behaviour: full display_name minus county-level parts.
      // This is the guaranteed-safe fallback if structured formatting
      // can't produce a usable line.
      const rawClean = (r.display_name || '')
        .split(',')
        .filter((p) => !/county/i.test(p))
        .join(',')
        .trim();

      // Preferred: build a clean line from Nominatim's structured address
      // (addressdetails=1) — "<house no> <road>, <city>, <ST> <zip>" with
      // the country dropped and the state abbreviated (e.g. US-NY → NY).
      let display = rawClean;
      try {
        const a = r.address || {};
        const stateCode = (a['ISO3166-2-lvl4'] || '').split('-')[1] || '';
        const street = [a.house_number, a.road].filter(Boolean).join(' ').trim();
        const city = a.city || a.town || a.village || a.hamlet || a.suburb || '';
        const stateAbbr = stateCode || a.state || '';
        const cityState = [
          city,
          [stateAbbr, a.postcode].filter(Boolean).join(' ').trim(),
        ]
          .filter(Boolean)
          .join(', ');
        const built = [street, cityState].filter(Boolean).join(', ').trim();
        // Only use the built line when it actually has content; otherwise
        // keep the safe full-address fallback so suggestions never go blank.
        if (built) display = built;
      } catch {
        // Keep rawClean fallback.
      }

      return {
        display: display || rawClean,
        lat: r.lat ? parseFloat(r.lat) : null,
        lon: r.lon ? parseFloat(r.lon) : null,
      };
    });
  } catch {
    return [];
  }
}

// Decide if a DJ has a finite (non-worldwide) travel limit we can compare against.
export function hasFiniteTravelLimit(travelDistance: string | null): boolean {
  if (!travelDistance) return false;
  const v = String(travelDistance).trim().toLowerCase();
  if (v === '' || v === 'worldwide') return false;
  return !isNaN(Number(v));
}
