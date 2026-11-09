// lib/bookingPrefill.ts — the hand-off between the profile Booking Assistant and
// the real booking request form (Phase 2).
//
// The bot collects a client's event details conversationally, then extracts them
// into a BookingPrefill and stashes it here. The booking form reads it on mount
// and fills in what it can, so the client lands on a pre-filled request to
// review and submit — the DJ still approves it.
//
// Storage: localStorage keyed by the DJ's slug, so it SURVIVES the page reload
// that happens when a walled visitor creates an account (the "carry it through
// signup" requirement). It's per-browser and short-lived (TTL below); anything
// durable or cross-device would need a server-side draft, which we can add later.

export interface BookingPrefill {
  slug: string;                 // the DJ profile this draft belongs to
  eventType?: string;           // human label, e.g. "Wedding"
  eventTypeKey?: string;        // matched dropdown key, e.g. "weddings" (form field)
  date?: string;                // YYYY-MM-DD if the bot got a clear date
  startTime?: string;           // 24-hour "HH:MM" (matches the time dropdown values)
  endTime?: string;
  venueName?: string;
  venueAddress?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  notes?: string;               // anything else the client mentioned
  ts: number;                   // saved-at epoch ms (for TTL)
}

const KEY_PREFIX = 'gdc_booking_prefill_';
const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function key(slug: string): string {
  return KEY_PREFIX + (slug || '').toLowerCase();
}

export function saveBookingPrefill(p: BookingPrefill): void {
  if (typeof window === 'undefined' || !p?.slug) return;
  try {
    window.localStorage.setItem(key(p.slug), JSON.stringify({ ...p, ts: Date.now() }));
  } catch { /* storage full / disabled — non-fatal */ }
}

// Read (and do NOT clear) the prefill for a slug, if present and fresh.
export function readBookingPrefill(slug: string): BookingPrefill | null {
  if (typeof window === 'undefined' || !slug) return null;
  try {
    const raw = window.localStorage.getItem(key(slug));
    if (!raw) return null;
    const p = JSON.parse(raw) as BookingPrefill;
    if (!p || typeof p.ts !== 'number' || Date.now() - p.ts > TTL_MS) {
      window.localStorage.removeItem(key(slug));
      return null;
    }
    return p;
  } catch { return null; }
}

export function clearBookingPrefill(slug: string): void {
  if (typeof window === 'undefined' || !slug) return;
  try { window.localStorage.removeItem(key(slug)); } catch { /* ignore */ }
}

// A compact, human-readable summary of everything the bot collected — folded
// into the form's notes/message field so the DJ sees the full picture even for
// fields the form can't structurally prefill (event type select, date/time).
export function prefillSummary(p: BookingPrefill): string {
  // Date, time, and event type now populate the real form fields, so they're
  // NOT repeated here. Only carry the free-text extras into the message, plus
  // the event label when we couldn't map it to a dropdown key (so the DJ/host
  // still sees what kind of event it is).
  const bits: string[] = [];
  if (p.eventType && !p.eventTypeKey) bits.push(`Event: ${p.eventType}`);
  if (p.notes) bits.push(p.notes);
  const summary = bits.join('\n');
  return summary ? `From the booking assistant:\n${summary}` : '';
}
