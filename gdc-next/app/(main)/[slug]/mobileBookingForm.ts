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
  cocktailAddon: number;     // wedding cocktail-hour charge added to price (0 if none)
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
  depositPct: number,
  wantsCocktail: boolean = false,
  cocktailStart: string = ''
): PriceResult {
  if (pkg.reqAll) {
    return { isQuote: true, price: null, overtimeHours: 0, depositAmount: null, cocktailAddon: 0 };
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

  // Wedding cocktail-hour add-on: when the booker opts into cocktail-hour
  // music and the DJ does NOT bundle it (cocktailIncluded === false), charge
  // the package's per-hour cocktail rate × the cocktail duration. The cocktail
  // hour runs from cocktailStart up to the reception start (startTime), so the
  // duration is that gap (rounded up to whole hours, min 1). Only applies when
  // there's a real package price.
  let cocktailAddon = 0;
  if (
    wantsCocktail &&
    price != null &&
    pkg.cocktailIncluded === false &&
    pkg.cocktailPrice != null &&
    pkg.cocktailPrice !== ''
  ) {
    const rate = Number(pkg.cocktailPrice);
    if (rate > 0) {
      // Duration in hours from cocktail start to reception start.
      let cocktailHours = 1;
      if (cocktailStart && startTime) {
        const [csh, csm] = cocktailStart.split(':').map(Number);
        const [rsh, rsm] = startTime.split(':').map(Number);
        let mins = (rsh * 60 + rsm) - (csh * 60 + csm);
        if (mins <= 0) mins += 1440; // guard against overnight wrap
        cocktailHours = Math.max(1, Math.ceil(mins / 60));
      }
      cocktailAddon = rate * cocktailHours;
      price += cocktailAddon;
    }
  }

  let depositAmount: number | null = null;
  if (price != null && depositPct > 0) {
    depositAmount = Number((price * depositPct / 100).toFixed(2));
  }

  return { isQuote, price, overtimeHours, depositAmount, cocktailAddon };
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

// USPS two-letter abbreviations for US states / territories. Nominatim
// returns the full state name ("New York") — we abbreviate it ("NY") so
// suggestions read like a normal mailing address.
const US_STATE_ABBR: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'district of columbia': 'DC', 'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI',
  'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX',
  'utah': 'UT', 'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA',
  'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
  'puerto rico': 'PR',
};

// Nominatim "address" object — only the fields we use. addressdetails=1
// must be set on the request for this to be populated.
export interface NominatimAddress {
  house_number?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  borough?: string;
  city_district?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country?: string;
}

// Pick the correct { city, state } from a Nominatim address object — the
// single source of truth for locality resolution shared by the booking
// address autocomplete AND the signup ZIP lookup.
//
// Rules (per Anthony's preference — NO county anywhere):
//   - NYC's five boroughs come through as `borough`/`suburb`/`city_district`
//     while `city` says "New York" / "City of New York". For those we want
//     the borough name (Staten Island, Brooklyn, …), not the legal city.
//   - A borough name detected in display_name wins (handles ZIP lookups
//     where the structured object only carries the county).
//   - County/parish is NEVER used as the city. If the only locality we can
//     find looks like a county ("Richmond County"), we return an empty city
//     rather than show the county — EXCEPT the five NYC counties, which map
//     1:1 to a borough (Richmond → Staten Island, etc.). A postal-code
//     lookup of an NYC ZIP often returns only the county, so this recovers
//     the borough instead of leaving the city blank.
//   - `state` is the full state name as returned by Nominatim (callers that
//     want a 2-letter abbreviation apply US_STATE_ABBR themselves).
//
// The five NYC counties map 1:1 onto boroughs. Used as a last resort when a
// postal-code lookup returns the county but no borough/city field.
const NYC_COUNTY_BOROUGH: Record<string, string> = {
  'richmond county': 'Staten Island',
  'kings county': 'Brooklyn',
  'queens county': 'Queens',
  'bronx county': 'The Bronx',
  'new york county': 'Manhattan',
};

export function pickLocality(
  addr: NominatimAddress | undefined | null,
  displayName?: string,
): { city: string; state: string } {
  if (!addr) return { city: '', state: '' };
  const nycBoroughs = ['Staten Island', 'Brooklyn', 'Queens', 'The Bronx', 'Manhattan'];
  const boroughFromDisplay = displayName
    ? nycBoroughs.find((b) => displayName.includes(b))
    : undefined;
  const legalCity = (addr.city || '').trim();
  const isNycLegalCity = /^(city of )?new york$/i.test(legalCity);
  const boroughField = (addr.borough || addr.suburb || addr.city_district || '').trim();

  let city: string;
  if (boroughFromDisplay) {
    city = boroughFromDisplay;
  } else if (isNycLegalCity && boroughField) {
    city = boroughField;
  } else {
    city = (
      legalCity || addr.town || addr.village || addr.suburb ||
      addr.borough || addr.city_district || addr.municipality || addr.hamlet || ''
    ).trim();
  }
  // Capture a county-like value from EITHER the structured county field OR
  // the locality we just picked (Nominatim sometimes returns "Richmond
  // County" in the city/city_district field rather than `county`).
  const countyCandidate =
    (/\b(county|parish)\b/i.test(city) ? city : '') || (addr.county || '');
  // Never let a county/parish slip through as the city.
  if (/\b(county|parish)\b/i.test(city)) city = '';

  // Last resort: an NYC-county result (common from ZIP lookups, wherever the
  // county name landed) maps to its borough so the city isn't left blank
  // (e.g. 10307 → Staten Island).
  if (!city && countyCandidate) {
    const borough = NYC_COUNTY_BOROUGH[countyCandidate.trim().toLowerCase()];
    if (borough) city = borough;
  }

  return { city, state: (addr.state || '').trim() };
}

// Build a clean "Street, City, ST ZIP" line from Nominatim's structured
// address object. County and country are dropped; the US state is
// abbreviated. For NYC-style results the borough/locality is preferred
// over the legal city so e.g. "Staten Island" shows, not "New York".
function formatStructuredAddress(addr: NominatimAddress): string | null {
  if (!addr) return null;
  const street = [addr.house_number, addr.road].filter(Boolean).join(' ').trim();
  const { city, state: stateRaw } = pickLocality(addr);
  const state = US_STATE_ABBR[stateRaw.toLowerCase()] || stateRaw;
  const zip = (addr.postcode || '').trim();
  const stateZip = [state, zip].filter(Boolean).join(' ').trim();
  const segs = [street, city, stateZip].filter(Boolean);
  return segs.length ? segs.join(', ') : null;
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
    return results.map((r: { display_name?: string; lat?: string; lon?: string; address?: NominatimAddress }) => {
      // Prefer the structured address object — abbreviates state, drops
      // county + country, picks the right locality. Fall back to a
      // string parse of display_name so a suggestion never goes blank.
      let display = formatStructuredAddress(r.address || {});
      if (!display) {
        const parts = (r.display_name || '').split(',').map((p) => p.trim());
        // Drop county-level segments and a trailing country segment.
        const filtered = parts.filter((p, i) => {
          if (/county/i.test(p)) return false;
          if (/planning region/i.test(p)) return false;
          if (i === parts.length - 1 && /united states|usa/i.test(p)) return false;
          return true;
        });
        display = filtered.join(', ').trim();
      }
      return {
        display,
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
