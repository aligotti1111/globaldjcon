// bookingExpiry — the response window on an incoming booking request.
//
// A pending request auto-declines when the DJ hasn't answered by its deadline.
// The deadline is the EARLIER of two moments:
//
//   1. 10 days after the request came in, OR
//   2. midnight entering the event day (00:00 on the event date),
//
// both measured in the DJ's own timezone (a per-DJ account setting, default
// US Eastern). Rule 2 is what makes a request for a date only a few days out —
// or one already in the past — expire on time instead of sitting open.
//
// This module is the single source of truth for that math, used by:
//   • the auto-decline cron (server), to decide what to decline, and
//   • the booking-request cards (client), to show "Expires in N days".

export const DEFAULT_TZ = 'America/New_York';
export const MAX_RESPONSE_DAYS = 10;
const DAY_MS = 86_400_000;

// The timezones offered in the account-settings picker (and the allowlist the
// save route validates against — never trust an arbitrary tz string from the
// client). Labelled in plain language; the value is the IANA zone id.
export const TIMEZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Mountain – no DST (Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  { value: 'America/Toronto', label: 'Eastern – Canada (Toronto)' },
  { value: 'America/Vancouver', label: 'Pacific – Canada (Vancouver)' },
  { value: 'Europe/London', label: 'UK (London)' },
  { value: 'Europe/Paris', label: 'Central Europe (Paris)' },
  { value: 'Australia/Sydney', label: 'Australia (Sydney)' },
];

const VALID_TZ = new Set(TIMEZONE_OPTIONS.map((o) => o.value));
export function isValidTimezone(tz: string): boolean {
  return VALID_TZ.has(tz);
}

// The UTC epoch (ms) of local midnight (00:00) on `dateStr` in `tz`.
// Works without a timezone library: take a UTC guess at that wall-clock time,
// read what wall-clock it actually maps to in `tz`, and correct by the offset.
function zonedMidnightEpoch(dateStr: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return null;
  const [, y, mo, d] = m;
  const utcGuess = Date.UTC(Number(y), Number(mo) - 1, Number(d), 0, 0, 0);
  const offset = tzOffsetMs(new Date(utcGuess), tz);
  return utcGuess - offset;
}

// offset = (wall-clock time in tz) − (UTC time), in ms, at the given instant.
function tzOffsetMs(at: Date, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
    const asUTC = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour), Number(p.minute), Number(p.second),
    );
    return asUTC - at.getTime();
  } catch {
    return 0; // unknown tz → treat as UTC
  }
}

// The response deadline (UTC epoch ms), or null if there's nothing to compute
// against (no created_at). Missing event date → only the 10-day rule applies.
export function responseDeadlineMs(
  createdAtIso: string | null | undefined,
  eventDate: string | null | undefined,
  tz: string | null | undefined,
): number | null {
  if (!createdAtIso) return null;
  const created = Date.parse(createdAtIso);
  if (Number.isNaN(created)) return null;
  const zone = tz || DEFAULT_TZ;
  const tenDay = created + MAX_RESPONSE_DAYS * DAY_MS;
  const eventMidnight = eventDate ? zonedMidnightEpoch(eventDate, zone) : null;
  return eventMidnight != null ? Math.min(tenDay, eventMidnight) : tenDay;
}

export interface ExpiryInfo {
  deadlineMs: number | null;
  msLeft: number;
  daysLeft: number;   // whole days remaining, rounded up (0 = expires today)
  expired: boolean;
  label: string;      // e.g. "Expires in 4 days", "Expires today", "Offer expired"
}

// Everything the UI needs to show a countdown for one request.
export function expiryInfo(
  createdAtIso: string | null | undefined,
  eventDate: string | null | undefined,
  tz: string | null | undefined,
  now: number = Date.now(),
): ExpiryInfo {
  const deadlineMs = responseDeadlineMs(createdAtIso, eventDate, tz);
  if (deadlineMs == null) {
    return { deadlineMs: null, msLeft: Infinity, daysLeft: Infinity, expired: false, label: '' };
  }
  const msLeft = deadlineMs - now;
  const expired = msLeft <= 0;
  const daysLeft = expired ? 0 : Math.ceil(msLeft / DAY_MS);
  let label: string;
  if (expired) label = 'Offer expired';
  else if (msLeft <= DAY_MS) label = 'Expires today';
  else label = `Expires in ${daysLeft} days`;
  return { deadlineMs, msLeft, daysLeft, expired, label };
}
