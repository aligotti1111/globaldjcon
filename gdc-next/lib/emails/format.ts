// lib/emails/format.ts
//
// Pure formatting + labelling helpers for transactional emails. No I/O, no
// template HTML of their own — just string/date/enum formatting shared by the
// email layout builders and the per-type message builders.

export function escHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtDate(eventDate: string | null | undefined): string {
  if (!eventDate) return '—';
  // Force noon so timezone shifts can't bump it to a neighbouring day
  return new Date(eventDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

// Format a "HH:MM" 24h time as "h:mm AM/PM". Returns empty string for
// missing values so the caller can decide how to render absence.
export function fmtTime(t: string | null | undefined): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  const hour12 = h % 12 || 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Render a start/end time pair as a single human label.
//   start + end → "8:00 PM – 11:00 PM"
//   start only  → "8:00 PM"
//   neither     → "—"
export function fmtTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  const s = fmtTime(start);
  const e = fmtTime(end);
  if (s && e) return `${s} – ${e}`;
  if (s) return s;
  return '—';
}

// Map mobile event_type slugs to display labels. Falls back to the slug
// itself with the first letter capitalized — handles "other" + custom
// labels gracefully.
export function eventTypeLabel(t: string | null | undefined): string {
  if (!t) return '';
  // Mirror of MOB_EVENT_TYPE_LABELS in mobileBookingForm.ts — the mobile
  // booking form's canonical event-type slugs (note 'weddings' is plural).
  // Kept in sync so emails show the same label the booker picked.
  const map: Record<string, string> = {
    weddings: 'Wedding',
    birthday: 'Birthday Party',
    corporate: 'Corporate Event',
    anniversary: 'Anniversary',
    graduation: 'Graduation',
    sweet16: 'Sweet 16',
    quinceanera: 'Quinceañera',
    mitzvah: 'Bar/Bat Mitzvah',
    reunion: 'Reunion',
    holiday: 'Holiday Party',
    school: 'School Event',
    community: 'Community Event',
    other: 'Other Event',
  };
  if (map[t]) return map[t];
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function statusColor(status: string): string {
  if (status === 'approved') return '#3ddc84';
  if (status === 'denied') return '#ff5f5f';
  return '#ffb347';
}

// Host-facing wording for a booking status. The internal value for a declined
// request is 'denied'; hosts see "declined".
export function statusLabel(status: string): string {
  return status === 'denied' ? 'declined' : status;
}

export function currencySymbol(code: string | null | undefined): string {
  const map: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$',
    JPY: '¥', KRW: '₩', CNY: '¥', INR: '₹', BRL: 'R$', MXN: '$',
  };
  return map[code || 'USD'] || '$';
}

// Friendly labels for raw club booking enums — match constants.ts.
// Used when emails render set_type / venue_type values from bookings rows.
const CLUB_SET_TYPE_LABELS_EMAIL: Record<string, string> = {
  opening: 'Opening Set',
  headliner: 'Headliner',
  closing: 'Closing Set',
  opening_close: 'Opening – Close',
  opening_and_closing: 'Opening & Closing',
};
const CLUB_VENUE_TYPE_LABELS_EMAIL: Record<string, string> = {
  bar: 'Bar',
  club: 'Club',
};
// Title-case a stored value — "bar" → "Bar", "opening - closing" →
// "Opening - Closing". Applied so labels read cleanly in emails
// regardless of how they were stored.
export function titleCaseLabel(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
export function setTypeLabel(s: string | null | undefined): string {
  if (!s) return '';
  return CLUB_SET_TYPE_LABELS_EMAIL[s] || titleCaseLabel(s);
}
export function venueTypeLabel(v: string | null | undefined): string {
  if (!v) return '';
  return CLUB_VENUE_TYPE_LABELS_EMAIL[v] || titleCaseLabel(v);
}
