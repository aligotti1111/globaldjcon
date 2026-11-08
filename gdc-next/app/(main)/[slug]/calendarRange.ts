// Shared month/date range helpers for the public calendars (desktop
// PublicCalendar + MobilePublicCalendar). These were previously duplicated
// byte-for-byte in both files.
//
// NOTE on the fallback: the desktop calendar defaults to a 12-month navigable
// window and the mobile calendar to 24. That default is passed in via
// `fallbackMonths` so the extraction preserves each caller's behavior exactly
// (mobile passes 24; desktop uses the default 12).

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Build the YYYY-MM-DD key from a (year, monthIndex, day) trio
export function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

// Latest navigable {year, month} based on today + window
export function calcMaxYM(
  windowMonths: number,
  fallbackMonths = 12,
): { year: number; month: number } {
  const t = new Date();
  const totalMonths = t.getFullYear() * 12 + t.getMonth() + (windowMonths || fallbackMonths);
  return { year: Math.floor(totalMonths / 12), month: totalMonths % 12 };
}

// Earliest navigable {year, month} — the current month (no past nav)
export function calcMinYM(): { year: number; month: number } {
  const t = new Date();
  return { year: t.getFullYear(), month: t.getMonth() };
}

// Is (y, m) within [min, max] inclusive?
export function isInRange(
  y: number,
  m: number,
  windowMonths: number,
  fallbackMonths = 12,
): boolean {
  const min = calcMinYM();
  const max = calcMaxYM(windowMonths, fallbackMonths);
  const v = y * 12 + m;
  return v >= (min.year * 12 + min.month) && v <= (max.year * 12 + max.month);
}
