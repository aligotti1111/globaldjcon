// upcoming-bookings/shared.ts
//
// The small, dependency-free constants and formatters that more than one piece
// of the Upcoming Bookings screen needs. Pulled out of UpcomingBookingsClient
// so the page's components can live in their own files without importing each
// other (which would be circular) or duplicating these (which would let them
// drift). Pure values and pure functions only — nothing stateful, no JSX.

import { MOB_EVENT_TYPE_LABELS } from '../[slug]/mobileBookingForm';

// Country flag emojis — matches the homepage country picker so the look
// is consistent across the app. Maps country name → flag emoji; defaults
// to a globe for unknown entries.
export const COUNTRY_FLAGS: Record<string, string> = {
  'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'Canada': '🇨🇦',
  'Australia': '🇦🇺', 'Germany': '🇩🇪', 'France': '🇫🇷', 'Netherlands': '🇳🇱',
  'Spain': '🇪🇸', 'Italy': '🇮🇹', 'Brazil': '🇧🇷', 'Mexico': '🇲🇽',
  'Japan': '🇯🇵', 'South Africa': '🇿🇦', 'New Zealand': '🇳🇿',
  'Ireland': '🇮🇪', 'Sweden': '🇸🇪', 'Norway': '🇳🇴', 'Denmark': '🇩🇰',
  'Belgium': '🇧🇪', 'Switzerland': '🇨🇭', 'Portugal': '🇵🇹', 'Other': '🌍',
};

export const MOBILE_EVENT_TYPES: Array<{ value: string; label: string }> =
  Object.entries(MOB_EVENT_TYPE_LABELS).map(([value, label]) => ({ value, label }));

// (CLUB_VENUE_TYPES / CLUB_SET_TYPES used to live here. Each appeared exactly
// once in the original file — their own definition — so they were dead code
// and were dropped during the split rather than carried forward.)

// Build 48 half-hour time options ("12:00 AM" → "11:30 PM"). Each option's
// value is HH:MM (24h, to store cleanly), label is 12h-with-AM/PM for display.
export const TIME_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      const value = `${hh}:${mm}`;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = ((h % 12) || 12);
      const label = `${h12}:${mm} ${ampm}`;
      out.push({ value, label });
    }
  }
  return out;
})();

export function fmtMoney(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export const NEON = '#00e0a4';   // done
export const AMBER = '#f5a623';  // needs the DJ to do something
export const MUTED = 'rgba(255,255,255,.32)'; // not reached yet

/**
 * Money for the 9.5px caption under an icon — "$300/$600", not "$300.00/$600.00".
 *
 * fmtMoney always renders 2dp, which is right in the dropdown and in the ledger
 * where the exact figure is the point. Here it isn't: two of them plus a slash
 * is "$544.38/$544.38" — 15 characters in a 96px column, at a size where every
 * character costs. Whole amounts drop the ".00"; anything with real cents keeps
 * them, because $81.66 rounded to $82 in a money column is a lie.
 */
export function capMoney(n: number, currency = 'USD'): string {
  const whole = Math.abs(n % 1) < 0.005;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(n);
  } catch {
    return whole ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
  }
}

export function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatLongDate(d: string): string {
  // Accepts YYYY-MM-DD OR an ISO timestamp; handle both.
  const onlyDate = d.length === 10 ? d : d.slice(0, 10);
  const [y, m, day] = onlyDate.split('-').map((s) => parseInt(s, 10));
  if (!y || !m || !day) return d;
  const date = new Date(y, m - 1, day);
  return date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}


// Stacked-pill date parts used by the row date display: a big day number,
// with a short day-of-week and month stacked beside it. Matches the
// public club/bar profile event list aesthetic.
export function getDateParts(d: string | null): { day: string; dow: string; mo: string } {
  if (!d) return { day: '—', dow: '', mo: '' };
  const [y, m, day] = d.split('-').map((s) => parseInt(s, 10));
  const date = new Date(y, m - 1, day);
  return {
    day: String(day),
    dow: date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
    mo: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
  };
}

export function formatTimeRange(s: string | null, e: string | null): string {
  const start = s ? formatTime12(s) : '';
  const end = e ? formatTime12(e) : '';
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  return '—';
}

export function formatTime12(t: string): string {
  const [hStr, mStr] = t.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

// Format an ISO timestamp as a short "Mar 15, 2026" date for the "sent on"
// banner. Used only in the modal's host-invite section.
export function formatSentDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}
