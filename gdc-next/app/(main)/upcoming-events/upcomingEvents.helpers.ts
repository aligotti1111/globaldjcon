import type { UpcomingEvent } from './page';

// Map a host-activity slot (from /api/host/new-activity) to the pipeline stage
// key it belongs to, so the card can tag the right icon. Booking-level events
// (accepted / countered / declined / cancelled) belong to no single stage.
export function slotToStage(slot: string): string | null {
  if (slot.startsWith('contract')) return 'contract';
  if (slot.startsWith('deposit')) return 'deposit';
  if (slot.startsWith('balance')) return 'invoice';
  if (slot === 'planner_sent' || slot === 'planner_reminder' || slot === 'rider_sent') return 'song_list';
  if (slot === 'guestlist_sent') return 'guestlist';
  return null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function groupByMonth(events: UpcomingEvent[]): Array<{ key: string; label: string; items: UpcomingEvent[] }> {
  const map = new Map<string, { label: string; items: UpcomingEvent[] }>();
  for (const ev of events) {
    if (!ev.event_date) continue;
    const [y, m] = ev.event_date.split('-').map((s) => parseInt(s, 10));
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const label = `${MONTH_NAMES[m - 1]} ${y}`;
    if (!map.has(key)) map.set(key, { label, items: [] });
    map.get(key)!.items.push(ev);
  }
  return Array.from(map.entries()).map(([key, { label, items }]) => ({ key, label, items }));
}

export function sortByDateTimeAsc(a: UpcomingEvent, b: UpcomingEvent): number {
  const da = (a.event_date || '') + ' ' + (a.start_time || '');
  const db = (b.event_date || '') + ' ' + (b.start_time || '');
  return da.localeCompare(db);
}

export function parseDateParts(d: string | null): { day: string; dow: string; mo: string } {
  if (!d) return { day: '—', dow: '', mo: '' };
  const [y, m, day] = d.split('-').map((s) => parseInt(s, 10));
  const date = new Date(y, m - 1, day);
  return {
    day: String(day),
    dow: date.toLocaleDateString('en-US', { weekday: 'short' }),
    mo: date.toLocaleDateString('en-US', { month: 'short' }),
  };
}

// Long-form date used in the expanded details panel (e.g. "Wednesday,
// May 27, 2026"). The top-left badge keeps the compact day/dow/mo split.
export function formatLongDate(d: string): string {
  const [y, m, day] = d.split('-').map((s) => parseInt(s, 10));
  const date = new Date(y, m - 1, day);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTimeRange(s: string | null, e: string | null): string {
  const start = s ? formatTime12(s) : '';
  const end = e ? formatTime12(e) : '';
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  return '';
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
