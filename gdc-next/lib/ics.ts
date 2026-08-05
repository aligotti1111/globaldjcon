// lib/ics.ts
//
// iCalendar (.ics) helpers for the DJ calendar-sync feature. Two consumers:
//   • /api/calendar/[token]  — a whole VCALENDAR feed of a DJ's bookings that a
//     phone / desktop calendar subscribes to once and re-pulls forever.
//   • the booking-approved email — a single-event .ics attachment + a Google
//     Calendar "Add to Calendar" link.
//
// TIME MODEL — deliberately FLOATING (local wall-clock, no timezone). Bookings
// store event_date as "YYYY-MM-DD" and start_time/end_time as 24h "HH:MM" with
// NO timezone anywhere (the app already treats them as naive local time — see
// fmtDate forcing noon to dodge UTC day-shift). A floating DTSTART like
// 20260826T210000 (no trailing Z, no TZID) is shown by Apple/Google as that
// exact wall-clock time in the viewer's calendar — which is what a "9 PM gig"
// should read as. DTSTAMP is the only UTC value (it's a bookkeeping timestamp,
// not an event time).

// ── Text escaping / line folding (RFC 5545 §3.1, §3.3.11) ──────────────────
export function icsEscape(text: string): string {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Fold lines longer than 75 octets: a CRLF followed by a single space. Kept at
// 73 so multi-byte characters near the boundary can't split a codepoint badly.
function fold(line: string): string {
  if (line.length <= 73) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 73));
  rest = rest.slice(73);
  while (rest.length > 72) {
    chunks.push(' ' + rest.slice(0, 72));
    rest = rest.slice(72);
  }
  if (rest.length) chunks.push(' ' + rest);
  return chunks.join('\r\n');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-08-26" + "21:00" → "20260826T210000" (floating, no Z). */
export function icsDateTime(date: string, time: string): string {
  const d = (date || '').replace(/-/g, '');
  const [h, m] = (time || '00:00').split(':');
  return `${d}T${pad(Number(h) || 0)}${pad(Number(m) || 0)}00`;
}

/** Add `days` to a "YYYY-MM-DD" using UTC math so no timezone shift creeps in. */
function addDays(date: string, days: number): string {
  const dt = new Date(`${date}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * End DATE-TIME, rolling to the next calendar day when the event runs past
 * midnight (a 9 PM–1 AM gig ends the following morning). Returns null when
 * there's no end time.
 */
export function icsEndDateTime(date: string, startTime: string, endTime: string | null | undefined): string | null {
  if (!endTime) return null;
  const toMin = (t: string) => {
    const [h, m] = t.split(':');
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  };
  const endDate = toMin(endTime) <= toMin(startTime || '00:00') ? addDays(date, 1) : date;
  return icsDateTime(endDate, endTime);
}

/** UTC bookkeeping stamp: "YYYYMMDDTHHMMSSZ". */
export function icsStampNow(): string {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export interface CalEvent {
  uid: string;
  /** Floating start, e.g. "20260826T210000". */
  start: string;
  /** Floating end, or null for a point-in-time event. */
  end?: string | null;
  summary: string;
  location?: string | null;
  description?: string | null;
  /** true → the booking was cancelled; the event is emitted as STATUS:CANCELLED
   *  so a subscribed calendar removes / crosses it out on the next pull. */
  cancelled?: boolean;
  /** Bumped when a booking changes so subscribers pick up edits. */
  sequence?: number;
}

function veventLines(ev: CalEvent): string[] {
  const lines: string[] = [
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${icsStampNow()}`,
    `SEQUENCE:${ev.sequence ?? 0}`,
    `DTSTART:${ev.start}`,
  ];
  if (ev.end) lines.push(`DTEND:${ev.end}`);
  lines.push(`SUMMARY:${icsEscape(ev.summary)}`);
  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
  lines.push(`STATUS:${ev.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  if (ev.cancelled) lines.push('METHOD:CANCEL');
  lines.push('END:VEVENT');
  return lines;
}

/** One VEVENT block (CRLF-joined, folded). For the single-event email .ics. */
export function buildVevent(ev: CalEvent): string {
  return veventLines(ev).map(fold).join('\r\n');
}

/**
 * A full VCALENDAR feed. X-WR-CALNAME names it in the calendar app; the TTL /
 * REFRESH-INTERVAL are hints (Apple/Google ultimately choose their own pull
 * cadence, but it costs nothing to ask for hourly).
 */
export function buildCalendar(calName: string, events: CalEvent[]): string {
  const head = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Global DJ Connect//Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calName)}`,
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  const body = events.flatMap(veventLines);
  return [...head, ...body, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}

/**
 * A single-event .ics wrapped as its own VCALENDAR — what an email attachment
 * needs (Apple Mail / Outlook / Gmail all offer "Add to Calendar" for one).
 */
export function buildSingleEventCalendar(ev: CalEvent): string {
  return buildCalendar('Global DJ Connect', [ev]);
}

/**
 * A Google Calendar "add event" template URL. Uses the same floating format
 * (no Z), which Google reads in the user's own calendar timezone — matching the
 * .ics behavior. Covers the "one tap adds it to Google" case that a plain .ics
 * attachment is clumsier at inside Gmail.
 */
export function googleCalendarLink(opts: {
  summary: string;
  date: string;
  startTime: string;
  endTime?: string | null;
  location?: string | null;
  details?: string | null;
}): string {
  const start = icsDateTime(opts.date, opts.startTime);
  // Google requires an end; fall back to +2h when the booking has no end time.
  let end = icsEndDateTime(opts.date, opts.startTime, opts.endTime);
  if (!end) {
    const [h, m] = (opts.startTime || '00:00').split(':');
    const rolled = ((Number(h) || 0) + 2) % 24;
    const nextDay = (Number(h) || 0) + 2 >= 24;
    end = icsDateTime(nextDay ? addDays(opts.date, 1) : opts.date, `${pad(rolled)}:${m || '00'}`);
  }
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.summary,
    dates: `${start}/${end}`,
  });
  if (opts.location) p.set('location', opts.location);
  if (opts.details) p.set('details', opts.details);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
