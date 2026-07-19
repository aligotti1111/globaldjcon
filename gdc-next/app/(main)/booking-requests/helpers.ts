// Booking-requests helpers — pure functions used by the card components.
// Faithful ports of vanilla br-core.js + br-load-render.js helpers.

// Re-export MOB_EVENT_LABELS from the centralized constants module so
// existing imports of `MOB_EVENT_LABELS` from this file keep working.
// Going forward, new code should import directly from '@/lib/constants'.
export { MOB_EVENT_LABELS } from '@/lib/constants';

// "2026-04-28" → "Tue, Apr 28, 2026"
export function formatShortDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

// "2026-04-28" → "Tuesday, April 28, 2026"
export function formatLongDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

// "19:30" → "7:30 PM"
export function formatTime(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const p = h < 12 ? 'AM' : 'PM';
  return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + p;
}

// Convert "HH:MM" → minutes since midnight. null → null.
export function timeToMins(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Vanilla bookingsOverlap — checks if two bookings' time ranges overlap on
// the same day. Used for warning the DJ when multiple pending requests for
// the same date conflict. End time at-or-before start = wraps past midnight.
export function bookingsOverlap(
  a: { start_time: string | null; end_time: string | null },
  b: { start_time: string | null; end_time: string | null }
): boolean {
  if (!a.start_time || !b.start_time) return true;
  const aStart = timeToMins(a.start_time)!;
  const aEnd = a.end_time ? timeToMins(a.end_time) : null;
  const bStart = timeToMins(b.start_time)!;
  const bEnd = b.end_time ? timeToMins(b.end_time) : null;
  const aEndAdj = aEnd !== null ? (aEnd <= aStart ? aEnd + 1440 : aEnd) : aStart + 1440;
  const bEndAdj = bEnd !== null ? (bEnd <= bStart ? bEnd + 1440 : bEnd) : bStart + 1440;
  return aStart < bEndAdj && bStart < aEndAdj;
}

// Compute event duration label e.g. "4 hrs 30m". Returns "" if either time
// is missing. Adds "+ N cocktail" when a wedding has a cocktail hour, and
// "+ N ceremony" when it has ceremony music (independent add-ons).
export function calcDurationLabel(b: {
  start_time: string | null;
  end_time: string | null;
  event_type: string | null;
  cocktail_needed: boolean | null;
  cocktail_start_time: string | null;
  // Optional — mirrors the cocktail pair. Optional so callers that don't
  // carry ceremony fields keep type-checking.
  ceremony_needed?: boolean | null;
  ceremony_start_time?: string | null;
}): string {
  if (!b.start_time || !b.end_time) return '';
  const [sh, sm] = b.start_time.split(':').map(Number);
  const [eh, em] = b.end_time.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 1440;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  let label = hrs > 0
    ? `${hrs} hr${hrs > 1 ? 's' : ''}${rem > 0 ? ' ' + rem + 'm' : ''}`
    : `${rem}m`;
  if (b.event_type === 'weddings' && b.cocktail_needed && b.cocktail_start_time) {
    const [ch, cm] = b.cocktail_start_time.split(':').map(Number);
    let cockMins = sh * 60 + sm - (ch * 60 + cm);
    if (cockMins <= 0) cockMins += 1440;
    const cHrs = Math.floor(cockMins / 60);
    const cRem = cockMins % 60;
    const cockLabel = cHrs > 0
      ? `${cHrs} hr${cHrs > 1 ? 's' : ''}${cRem > 0 ? ' ' + cRem + 'm' : ''}`
      : `${cRem}m`;
    label += ` + ${cockLabel} cocktail`;
  }
  // Ceremony is flagged but NOT counted in hours — just "+ ceremony".
  if (b.event_type === 'weddings' && b.ceremony_needed && b.ceremony_start_time) {
    label += ' + ceremony';
  }
  return label;
}

// Haversine distance in miles. Same formula as the booker form's helper —
// kept as a separate copy here so booking-requests is self-contained.
export function haversineMiles(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Same finite-limit check the booker form uses. Kept local to avoid a
// cross-folder import — both files are intentionally self-contained.
export function hasFiniteTravelLimit(travelDistance: string | null): boolean {
  if (!travelDistance) return false;
  const v = String(travelDistance).trim().toLowerCase();
  if (v === '' || v === 'worldwide') return false;
  return !isNaN(Number(v));
}

// Strip "X County, " from address strings — matches vanilla
// `b.venue_address.replace(/,\s*[^,]+ County/i,'')`.
export function cleanAddress(addr: string | null): string {
  if (!addr) return '';
  return addr.replace(/,\s*[^,]+ County/i, '');
}

// One-shot Nominatim lookup for the DJ's home base → {lat, lon} | null.
//
// IMPORTANT: a bare `postalcode=` query is unreliable — Nominatim does
// not resolve postal codes to a single precise point and can return a
// location far from the real one (a ZIP like "10307" was resolving
// ~1290 miles off). Instead we run a free-text `q=` search built from
// the DJ's city + state + ZIP, which pins the location accurately.
//
// Pass whatever location parts are available; ZIP alone still works as a
// fallback but is the least precise. countryCode defaults to 'us'.
// Cached at module level (keyed on the full query) so we don't hammer
// Nominatim on every render.
const zipCoordsCache = new Map<string, { lat: number; lon: number } | null>();
export async function lookupZipCoords(
  location: { zip?: string | null; city?: string | null; state?: string | null },
  countryCode: string = 'us',
): Promise<{ lat: number; lon: number } | null> {
  const zip = (location.zip || '').trim();
  const stateRaw = (location.state || '').trim();
  let city = (location.city || '').trim();
  // A county/parish name in the `city` field (e.g. "Richmond County")
  // geocodes to the county centroid, not the actual town — throwing the
  // distance off. Drop any city value that's really a county so the
  // query falls back to state + ZIP, which resolves accurately. Note:
  // "borough" is intentionally NOT stripped — NYC's boroughs (Staten
  // Island, Brooklyn, etc.) are valid, specific localities.
  if (/\b(county|parish)\b/i.test(city)) {
    city = '';
  }
  const state = stateRaw;
  const queryParts = [city, state, zip].filter(Boolean);
  if (queryParts.length === 0) return null;
  const q = queryParts.join(', ');
  const cc = (countryCode || 'us').trim().toLowerCase();
  const cacheKey = `${cc}|${q}`;
  if (zipCoordsCache.has(cacheKey)) return zipCoordsCache.get(cacheKey)!;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=${encodeURIComponent(cc)}&limit=1`
    );
    const data = await res.json();
    if (data && data[0]) {
      const result = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      zipCoordsCache.set(cacheKey, result);
      return result;
    }
  } catch {
    // network/parse fail
  }
  zipCoordsCache.set(cacheKey, null);
  return null;
}

// Driving distance in miles between the DJ's home base and a venue.
// Calls the /api/distance server route (which holds the Google Maps key
// server-side and queries the Distance Matrix API). Returns road-network
// driving miles — the meaningful measure for a DJ's travel range.
//
// `dj` is the DJ's stored location parts; `venueLat`/`venueLon` are the
// coords captured on the booking row. Returns null on any failure so the
// caller can fall back (e.g. to haversineMiles) or simply hide the
// distance — a failed lookup must never break the card.
export async function drivingMiles(
  dj: { zip?: string | null; city?: string | null; state?: string | null },
  venueLat: number,
  venueLon: number,
): Promise<number | null> {
  const zip = (dj.zip || '').trim();
  const stateRaw = (dj.state || '').trim();
  let city = (dj.city || '').trim();
  // Same county/parish guard as lookupZipCoords — a county name geocodes
  // to the wrong place; drop it so the origin falls back to state + ZIP.
  if (/\b(county|parish)\b/i.test(city)) city = '';
  const origin = [city, stateRaw, zip].filter(Boolean).join(', ');
  if (!origin) return null;
  if (!Number.isFinite(venueLat) || !Number.isFinite(venueLon)) return null;
  try {
    const res = await fetch('/api/distance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, destLat: venueLat, destLon: venueLon }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.miles === 'number' ? data.miles : null;
  } catch {
    return null;
  }
}
