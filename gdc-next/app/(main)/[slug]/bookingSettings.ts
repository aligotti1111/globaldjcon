// Types and helpers for the booking_settings JSON field on users.
// Vanilla stores this as a JSON-stringified string in users.booking_settings.

// Per-day booking data keyed by YYYY-MM-DD in booking_settings.booking_days
export interface DayData {
  booked?: boolean;
  unavailable?: boolean;
  eventName?: string;
  startTime?: string;     // 24h "HH:MM" format
  endTime?: string;       // 24h "HH:MM" format
  location?: string;      // free text or "Private" to hide event name
  ticketUrl?: string;
  ticketLabel?: string;   // CTA label e.g. "Buy Tickets"
}

export type BookingDays = Record<string, DayData>;

// The full booking_settings object. Many fields are for the booking-form
// flow (rates, equipment) which we don't need for the public calendar yet.
export interface BookingSettings {
  booking_enabled?: boolean;
  booking_days?: BookingDays;
  booking_window_months?: number; // default 12 — how far ahead visitors can navigate
  // Booking-form fields (used by Session 5 work, not by the calendar itself)
  allow_offers?: boolean;
  equip_full?: boolean;
  equip_decks?: boolean;
  equip_none?: boolean;
  global_rate_type?: string;
  rate_with_system?: number | string;
  rate_with_decks?: number | string;
  rate_no_equip?: number | string;
  base_rate?: number | string;
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
