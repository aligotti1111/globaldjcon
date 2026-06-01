// Types and helpers for the booking_settings JSON field on users.
// Vanilla stores this as a JSON-stringified string in users.booking_settings.

// Per-day booking data keyed by YYYY-MM-DD in booking_settings.booking_days
// (used by club DJs for the public calendar view)
export interface DayData {
  booked?: boolean;
  unavailable?: boolean;
  eventName?: string;
  startTime?: string;     // 24h "HH:MM" format
  endTime?: string;       // 24h "HH:MM" format
  location?: string;      // free text or "Private" to hide event name
  ticketUrl?: string;
  ticketLabel?: string;   // CTA label e.g. "Buy Tickets"
  // ── Per-day rate overrides (club DJs only) ──────────────────────
  // When present, these win over the universal booking_settings rate
  // fields. Only set when the day's status is 'available' (no booked /
  // unavailable flag) — the owner editor doesn't expose them otherwise.
  // Each set behaves like the universal rates: switching rateType keeps
  // the dormant set intact for when it's switched back.
  rateType?: 'flat' | 'hourly' | 'offers';
  rate_with_system?: number | string;        // flat
  rate_with_decks?: number | string;
  rate_no_equip?: number | string;
  rate_hourly_with_system?: number | string; // hourly
  rate_hourly_with_decks?: number | string;
  rate_hourly_no_equip?: number | string;
  // Per-day booking-capacity override (club DJs). When set (1–3), it
  // wins over booking_settings.club_bookings_per_day for this date —
  // letting a DJ accept more bookings on a specific day. The calendar
  // cell fills diagonally in proportion to bookings / capacity.
  day_capacity?: number;
}

export type BookingDays = Record<string, DayData>;

// MOBILE-DJ per-day data. Different shape from club: tracks remaining
// `bookings_available` capacity (mobile DJs can have multiple bookings per
// day until that drops to zero, at which point the day is "Full").
// Stored under booking_settings.mob_booking_days.
export interface MobileDayData {
  booked?: boolean;
  unavailable?: boolean;
  eventName?: string;
  startTime?: string;
  endTime?: string;
  location?: string;        // 'Private' hides eventName publicly
  bookings_available?: number; // remaining capacity for this date
}

export type MobileBookingDays = Record<string, MobileDayData>;

// The full booking_settings object. The same JSON column holds both
// club-DJ and mobile-DJ booking config — different prefixes for each.
// Many fields are used by booking-form flows (Session B), not the calendar.
export interface BookingSettings {
  // ── Club DJ fields ───────────────────────────────────────────
  booking_enabled?: boolean;
  booking_days?: BookingDays;
  booking_window_months?: number; // default 12 — how far ahead visitors can navigate

  // Equipment selection — exactly ONE of these three should be true at a time.
  // Vanilla saves them as separate booleans rather than a single enum, so we
  // mirror that for round-trip safety with existing rows.
  equip_full?: boolean;          // "I provide Sound System & Decks/Controller"
  equip_full_detail?: string;    // free text describing the system
  equip_decks?: boolean;         // "I provide Decks/Controller only"
  equip_decks_detail?: string;   // free text describing the decks
  equip_none?: boolean;          // "I require all equipment from venue"

  // Rate config — global default for every available date unless overridden
  // per-day in booking_days[key].rate*. Vanilla supports 3 rate types and
  // per-equipment pricing within flat/hourly modes.
  global_rate_type?: 'flat' | 'hourly' | 'offers' | string;
  allow_offers?: boolean;        // mirror of global_rate_type === 'offers'
  rate_currency?: string;        // ISO 4217 code (USD/EUR/GBP/...)
  base_rate?: number | string;
  // Flat-rate fields — used when global_rate_type === 'flat'.
  // These are the original fields (legacy code may still write/read them
  // ignoring rate type, so the public booking form does a fallback when
  // the hourly fields are missing).
  rate_with_system?: number | string;  // when DJ provides full system
  rate_with_decks?: number | string;   // when DJ provides only decks
  rate_no_equip?: number | string;     // when venue provides everything
  // Hourly-rate fields — used when global_rate_type === 'hourly'.
  // Stored independently so switching rate types doesn't overwrite the
  // other set of values; both can sit dormant and come back when the DJ
  // switches back. New accounts default to empty / 0.
  rate_hourly_with_system?: number | string;
  rate_hourly_with_decks?: number | string;
  rate_hourly_no_equip?: number | string;

  // ── Mobile DJ fields (mob_* prefix) ──────────────────────────
  // Same boolean booking_enabled controls both — vanilla checks this
  // alongside dj_type to decide which calendar to render.
  mob_booking_days?: MobileBookingDays;
  mob_booking_window?: number;      // default 24 — mobile DJs typically book further out
  mob_bookings_per_day?: number;    // default 1 — capacity per date
  mob_packages?: Record<string, MobilePackage[]>;  // 'general' | 'wedding' | 'mitzvah'
  mob_deposit_pct?: number;

  // Club DJ daily capacity — how many bookings the DJ will accept on a
  // single date (1–3, default 1). A specific date can override this via
  // the per-day calendar editor (DayData.day_capacity).
  club_bookings_per_day?: number;
}

// Mobile DJ package — used by the booking form (Session B) but declared
// here so the type lives with the rest of booking_settings.
export interface MobilePackage {
  title?: string;
  details?: string;          // HTML-formatted package details
  photo?: string;            // main sample photo URL (slot 1, shown on card)
  photos?: string[];         // additional sample photos (slots 2-4), shown as
                             // thumbnails in the booking-form lightbox
  price4?: number | string;  // 4hr rate
  price5?: number | string;  // 5hr rate
  price6?: number | string;  // 6hr rate
  overtime?: number | string; // per-hour overtime rate
  reqAll?: boolean;          // "Price on request" — no auto-quote
  // Wedding cocktail-hour add-on. When cocktailIncluded is false, the
  // cocktailPrice is charged on top of the package price if the booker opts
  // into cocktail-hour music. When true/undefined, cocktail hour is bundled.
  cocktailIncluded?: boolean;
  cocktailPrice?: number | string;
  // General/Mitzvah only: when true, DJ does not offer a separate cocktail-hour
  // price, and the booking form hides the "Add Cocktail Hour" option.
  cocktailNotOffered?: boolean;
  // Hours the DJ needs to set up before the event start time (per package).
  setupHours?: string | number;
}

// Vanilla stores booking_settings as a JSON string. This helper parses it
// safely — returns null on missing data or invalid JSON.
export function parseBookingSettings(raw: string | null | undefined): BookingSettings | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as BookingSettings;
  } catch {
    // Bad JSON — vanilla silently swallows errors here too
  }
  return null;
}

// Format "13:30" → "1:30 PM" — matches vanilla formatTime12.
export function formatTime12(t: string | null | undefined): string {
  if (!t) return '';
  const [h, mi] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(mi)) return '';
  const p = h < 12 ? 'AM' : 'PM';
  const h12 = (h % 12) || 12;
  return `${h12}:${String(mi).padStart(2, '0')} ${p}`;
}

// Strip "X County" + trailing country names from location strings —
// vanilla does this to show cleaner location labels.
// E.g. "Brooklyn, Kings County, New York, United States" → "Brooklyn, New York"
export function cleanLocation(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/,\s*[^,]+ County/i, '')
    .replace(
      /,\s*(United States|USA|UK|United Kingdom|Canada|Australia|Germany|France|Spain|Italy|Netherlands|Sweden|Norway|Denmark|New Zealand|Singapore|South Africa|UAE|India|Japan|Mexico|Brazil|Switzerland|Ireland)\s*$/i,
      ''
    )
    .trim();
}

// Window label: "12 Months" / "1 Year" / "3 Years" — matches vanilla pubCalWindowLabel.
export function windowLabel(months: number): string {
  if (months < 12) {
    return `${months} Month${months > 1 ? 's' : ''}`;
  }
  const years = months / 12;
  return `${years} Year${years > 1 ? 's' : ''}`;
}
