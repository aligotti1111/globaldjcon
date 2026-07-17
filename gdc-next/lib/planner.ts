// Playlist & Planner — shared types and the template resolver.
//
// One home for the shape, because three places need it and none of them can be
// the owner: the public form at /planner/[id], the API that saves what the
// client types, and (later) PlannerPortal where a DJ customises the questions.
// Three copies of a field union is how you end up rendering a control the
// server rejects.
//
// See PLANNER-SYSTEM-SPEC.md.

import type { UpcomingBooking } from '@/app/(main)/upcoming-bookings/page';

// ─────────────────────────────────────────────────────────────────────────
// FIELDS
// ─────────────────────────────────────────────────────────────────────────

export type PlannerFieldType =
  | 'text'        // one line
  | 'longtext'    // notes
  | 'time'        // "19:30" — the 30-min options already exist: MOB_TIME_OPTIONS
  | 'song'        // Track — one track. e.g. first dance.
  | 'songlist'    // Track[] — must plays
  | 'textlist'    // string[] — DO NOT PLAY. Deliberately not a track picker.
  | 'people'      // Person[] — bridal party, honorees. ORDER IS THE DATA.
  | 'timeline'    // TimelineRow[] — the run of show. ORDER IS THE DATA.
  | 'yesno'
  | 'select'
  | 'link';       // a url they paste — e.g. their Spotify playlist

/**
 * PrefillKey — something we already know from the booking.
 *
 * The client should never retype what they typed on the booking form. Prefilled
 * fields render FILLED AND EDITABLE, never locked: if the venue changed since
 * they booked, the planner is where the DJ finds out, and locking it means they
 * don't.
 */
export type PrefillKey =
  | 'event_date'
  | 'start_time'
  | 'end_time'
  | 'venue_name'
  | 'venue_address'
  | 'host_name'
  | 'guest_count'
  | 'cocktail_start'
  | 'package_title'
  | 'dj_name';

export interface PlannerField {
  /**
   * STABLE FOREVER.
   *
   * `responses` is keyed by this, and `booking_planners.fields` is a snapshot.
   * Renaming an id orphans every answer ever given to it — the answer survives
   * in the jsonb, keyed to a question that no longer exists, and nothing will
   * ever surface it again. Add new ids; never renumber, never reuse.
   */
  id: string;
  type: PlannerFieldType;
  label: string;
  help?: string;
  required?: boolean;
  options?: string[];      // select only
  prefill?: PrefillKey;
  /** DJ turned it off. NOT deleted — see the spec, §6b. */
  hidden?: boolean;
  /** DJ-added rather than stock. */
  is_custom?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// VALUES
// ─────────────────────────────────────────────────────────────────────────

/**
 * A song, however they gave it to us.
 *
 * `source` is the whole design. A client whose first dance is a demo their
 * cousin recorded, or who's on a train with no signal, or who simply can't be
 * bothered searching, must still be able to answer. The Spotify picker is a
 * convenience; it is never a gate. Same principle as the payment rails — the
 * app assists the transaction, it doesn't own it.
 */
export interface Track {
  /** Never empty. For a bare link with no oEmbed, the url itself. */
  title: string;
  artist?: string;
  source: 'spotify' | 'manual' | 'link';
  spotify_id?: string;
  /** spotify → the track url (ALSO the link-back their terms require).
   *  link → whatever they pasted. */
  url?: string;
  /** Spotify CDN or a YouTube/SoundCloud oEmbed thumb. Never rehosted. */
  album_art?: string;
}

export interface Person {
  name: string;
  role?: string;
  /** Why this field type exists. Getting a name wrong over a mic is the one
   *  thing a DJ can't take back. */
  pronunciation?: string;
}

export interface TimelineRow {
  time?: string;   // "19:30"
  label?: string;
}

/**
 * One answer.
 *
 * `{ na: true }` is an ANSWER, not an absence. Blank means "hasn't got to it";
 * na means "doesn't apply to my event". A DJ at 8pm wondering whether to call
 * the father to the floor needs to tell those apart, and an empty field can't.
 */
export type PlannerResponse =
  | { value: unknown }
  | { na: true };

export type PlannerResponses = Record<string, PlannerResponse>;

export const isNa = (r: PlannerResponse | undefined): boolean =>
  !!r && 'na' in r && r.na === true;

export const responseValue = (r: PlannerResponse | undefined): unknown =>
  r && 'value' in r ? r.value : undefined;

// ─────────────────────────────────────────────────────────────────────────
// ROWS
// ─────────────────────────────────────────────────────────────────────────

export interface PlannerTemplate {
  id: string;
  dj_id: string | null;
  name: string;
  event_type: string | null;
  is_standard: boolean;
  fields: PlannerField[];
}

export type BookingPlannerStatus = 'sent' | 'partial' | 'submitted';

export interface BookingPlanner {
  id: string;
  booking_id: string;
  dj_id: string;
  planner_id: string | null;
  fields: PlannerField[];
  responses: PlannerResponses;
  status: BookingPlannerStatus;
  sent_at: string;
  submitted_at: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// RESOLUTION
// ─────────────────────────────────────────────────────────────────────────

/** Reserved. A custom field must never collide with these in `responses`. */
export const NOTES_FIELD_ID = 'notes';
export const DO_NOT_PLAY_FIELD_ID = 'do_not_play';

/**
 * Which template applies to this booking, in order:
 *
 *   1. the DJ's row for this event_type      ← their custom one
 *   2. the DJ's row with event_type = null   ← their custom base
 *   3. the stock row for this event_type
 *   4. the stock base
 *
 * First hit wins. A DJ who has never opened the portal still sends a good
 * planner on day one; a DJ who customised sends theirs, forever, without
 * choosing. That's why the unique index on (dj_id, event_type) exists — with
 * it, "which planner?" has exactly one answer and Request never asks.
 */
export function pickTemplate(
  all: PlannerTemplate[],
  djId: string,
  eventType: string | null,
): { base: PlannerTemplate | null; override: PlannerTemplate | null } {
  const mine = all.filter((t) => t.dj_id === djId && !t.is_standard);
  const stock = all.filter((t) => t.is_standard);

  const base =
    mine.find((t) => t.event_type == null) ??
    stock.find((t) => t.event_type == null) ??
    null;

  const override = eventType
    ? (mine.find((t) => t.event_type === eventType) ??
       stock.find((t) => t.event_type === eventType) ??
       null)
    : null;

  return { base, override };
}

/**
 * Compose the field list actually sent to a client.
 *
 * base + override, then Do NOT play and Notes RE-PINNED to the end.
 *
 * The re-pin is not cosmetic. The overrides APPEND — so left alone, a wedding
 * planner buries "Anything else we should know" in the middle of the ceremony
 * questions, between "Last song" and "Run of show". Nobody scrolls back up to a
 * text box, and that box is the client's only way to tell the DJ something we
 * didn't ask about.
 *
 * Do NOT play gets the same treatment for the same reason, and because it's the
 * single most consequential answer on the form.
 */
export function composeFields(
  base: PlannerField[],
  override: PlannerField[],
): PlannerField[] {
  const pinnedIds = new Set([DO_NOT_PLAY_FIELD_ID, NOTES_FIELD_ID]);
  const pinned = base.filter((f) => pinnedIds.has(f.id));
  const rest = base.filter((f) => !pinnedIds.has(f.id));

  // An override must not redefine a base id — the seed guarantees it, but a
  // DJ's custom field could collide once PlannerPortal exists. Base wins for
  // the pinned two; otherwise the override's copy replaces the base's, which is
  // what "override" means.
  const overrideIds = new Set(override.map((f) => f.id));
  const keptRest = rest.filter((f) => !overrideIds.has(f.id));

  return [
    ...keptRest,
    ...override.filter((f) => !pinnedIds.has(f.id)),
    ...pinned,
  ];
}

/** Everything a client actually sees. Hidden fields are not sent. */
export const visibleFields = (fields: PlannerField[]): PlannerField[] =>
  fields.filter((f) => !f.hidden);

// ─────────────────────────────────────────────────────────────────────────
// PREFILL
// ─────────────────────────────────────────────────────────────────────────

/** "HH:MM:SS" → "HH:MM". The DB stores time with seconds; the pickers don't. */
const trimTime = (t: string | null | undefined): string =>
  t ? (t.length >= 5 ? t.slice(0, 5) : t) : '';

/**
 * Seed `responses` from what the booking already knows.
 *
 * Runs ONCE, at send time, and the result is stored — not computed on every
 * page load. If the DJ edits the booking afterwards, the planner keeps what the
 * client is looking at rather than shifting under them mid-answer.
 *
 * Only fills fields with no answer yet: a prefill must never overwrite
 * something a human typed.
 */
export function applyPrefill(
  fields: PlannerField[],
  booking: Partial<UpcomingBooking> & Record<string, unknown>,
  djName: string | null,
  existing: PlannerResponses = {},
): PlannerResponses {
  const out: PlannerResponses = { ...existing };

  const source: Record<PrefillKey, unknown> = {
    event_date:     booking.event_date ?? null,
    start_time:     trimTime(booking.start_time as string | null),
    end_time:       trimTime(booking.end_time as string | null),
    venue_name:     booking.venue_name ?? null,
    venue_address:  booking.venue_address ?? null,
    host_name:      booking.requester_name ?? null,
    guest_count:    (booking as { guest_count?: unknown }).guest_count ?? null,
    // Only when the booking actually has one — a cocktail start on a booking
    // with cocktail_needed false is a stale value from an earlier edit.
    cocktail_start: (booking as { cocktail_needed?: boolean }).cocktail_needed
      ? trimTime((booking as { cocktail_start_time?: string | null }).cocktail_start_time)
      : null,
    package_title:  booking.package_title ?? null,
    dj_name:        djName,
  };

  for (const f of fields) {
    if (!f.prefill) continue;
    if (out[f.id] !== undefined) continue;          // never overwrite an answer
    const v = source[f.prefill];
    if (v === null || v === undefined || v === '') continue;
    out[f.id] = { value: v };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// PROGRESS
// ─────────────────────────────────────────────────────────────────────────

/**
 * "12/34" for the status strip.
 *
 * Counts VISIBLE fields only, so a DJ hiding half the template doesn't leave
 * every client permanently stuck short of the total. Counts N/A as answered,
 * because it is one.
 */
export function plannerProgress(
  fields: PlannerField[],
  responses: PlannerResponses,
): { answered: number; total: number } {
  const vis = visibleFields(fields);
  let answered = 0;
  for (const f of vis) {
    const r = responses[f.id];
    if (!r) continue;
    if (isNa(r)) { answered++; continue; }
    const v = responseValue(r);
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    // An empty list is not an answer. A client who clicked "+ Add another" and
    // then didn't type anything hasn't told us a thing.
    if (Array.isArray(v) && v.length === 0) continue;
    answered++;
  }
  return { answered, total: vis.length };
}
