// Booking-requests helpers — pure functions used by the card components.
// Faithful ports of vanilla br-core.js + br-load-render.js helpers.

export const MOB_EVENT_LABELS: Record<string, string> = {
  weddings: 'Wedding',
  bar_bat_mitzvahs: 'Bar/Bat Mitzvah',
  birthdays: 'Birthday Party',
  corporate: 'Corporate Event',
  graduations: 'Graduation',
  prom_homecoming: 'Prom/Homecoming',
  anniversaries: 'Anniversary',
  baby_showers: 'Baby Shower',
  bridal_showers: 'Bridal Shower',
  engagement: 'Engagement Party',
  holiday: 'Holiday Party',
  other: 'Other',
};

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
// is missing. Adds "+ N cocktail" when wedding has a cocktail hour.
export function calcDurationLabel(b: {
  start_time: string | null;
  end_time: string | null;
  event_type: string | null;
  cocktail_needed: boolean | null;
  cocktail_start_time: string | null;
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

// One-shot Nominatim postal-code lookup → {lat, lon} | null. Used to find
// the DJ's home base if we can't derive coords from a zip-only column.
// Cached at module level so we don't hammer Nominatim on every render.
const zipCoordsCache = new Map<string, { lat: number; lon: number } | null>();
export async function lookupZipCoords(
  zip: string
): Promise<{ lat: number; lon: number } | null> {
  if (!zip) return null;
  if (zipCoordsCache.has(zip)) return zipCoordsCache.get(zip)!;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(zip)}&limit=1`
    );
    const data = await res.json();
    if (data && data[0]) {
      const result = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      zipCoordsCache.set(zip, result);
      return result;
    }
  } catch {
    // network/parse fail
  }
  zipCoordsCache.set(zip, null);
  return null;
}
