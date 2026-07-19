// /planner/[id] — the client's Planner & Playlist.
//
// WHY THIS PAGE EXISTS
// The DJ needs to know what to play, when to play it, and what to never play.
// That's a conversation currently held over text messages, phone calls and a
// Google Doc someone's mother made. This is the form that ends it.
//
// NO LOGIN. Clients don't have accounts and never will. The planner id is an
// unguessable UUID — a capability URL, exactly like the DocuSeal signing link
// and /pay/[id] we already email them. It exposes this booking's planner to
// whoever holds it, which is precisely what the email containing it already
// does. No new exposure.
//
// A client booking one party is not joining a platform. Making them create an
// account to tell you their first dance is how you don't get told their first
// dance.
//
// It reads with the ADMIN client because there is no session to read with. Note
// what it deliberately does NOT do: nothing here treats OPENING the link as
// evidence of anything. Only the client typing does that.

import { notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { visibleFields, type PlannerField, type PlannerResponses } from '@/lib/planner';
import { MOB_EVENT_LABELS } from '@/lib/constants';
import PlannerForm from './PlannerForm';

// Prefilled time questions that only ever echoed the booking's own start/end
// (and wedding cocktail) — now shown once in the "Your booking" strip instead of
// asked. Filtered from any planner's fields so they never double up.
const LEGACY_TIME_FIELD_IDS = new Set(['music_start', 'music_end', 'w_cocktail_start']);

export const runtime = 'nodejs';
// Per-planner state, and the client's own answers. Never cached, never
// prerendered — a cached planner page would serve one client another's answers.
export const dynamic = 'force-dynamic';

// A planner link should never turn up in a search result.
export const metadata = {
  title: 'Planner & Playlist — Global DJ Connect',
  robots: { index: false, follow: false },
};

interface PlannerRow {
  id: string;
  booking_id: string;
  dj_id: string;
  fields: PlannerField[];
  responses: PlannerResponses;
  status: 'sent' | 'partial' | 'submitted';
  submitted_at: string | null;
}

/** "19:30:00" -> "7:30 PM". The DB stores seconds; nobody reads clocks in 24h. */
function fmtTime(t: string | null): string {
  if (!t) return '';
  const [hRaw, m] = t.split(':');
  const h = Number(hRaw);
  if (!Number.isFinite(h)) return '';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m || '00'} ${ampm}`;
}

function fmtDate(d: string | null): string {
  if (!d) return '';
  // T12:00:00, not bare — `new Date('2026-07-25')` parses as UTC midnight and
  // renders as the 24th in every US timezone. Same bug we already fixed on the
  // check memo.
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

export default async function PlannerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const admin = createAdminClient();
  // booking_planners postdates the generated types/supabase.ts, so the typed
  // client rejects .from('booking_planners') outright. One cast for the new
  // table — same house pattern as /api/payments and /pay/[id].
  const db = admin as unknown as SupabaseClient;

  const { data: pData } = await db
    .from('booking_planners')
    .select('id, booking_id, dj_id, fields, responses, status, submitted_at')
    .eq('id', id)
    .maybeSingle();
  const planner = pData as unknown as PlannerRow | null;
  if (!planner) notFound();

  const { data: bData } = await admin
    .from('bookings')
    .select('event_date, start_time, end_time, venue_name, venue_address, guest_count, phone, package_title, event_type, event_details, cocktail_needed, cocktail_start_time, requester_name')
    .eq('id', planner.booking_id)
    .maybeSingle();
  const booking = bData as unknown as {
    event_date: string | null;
    start_time: string | null;
    end_time: string | null;
    venue_name: string | null;
    venue_address: string | null;
    guest_count: number | null;
    phone: string | null;
    package_title: string | null;
    // The friendly-labelled kind of party (weddings, birthday, …) — shown at the
    // top so the client knows the planner was written for THEIR event.
    event_type: string | null;
    // The event-type detail the client entered on the booking form — "25th
    // Anniversary", "College Graduation", "Guest of honor age: 30 · Surprise
    // party: Yes". Null for event types with no sub-question.
    event_details: string | null;
    // Weddings can carry a cocktail hour — its own start time, shown in the strip.
    cocktail_needed: boolean | null;
    cocktail_start_time: string | null;
    requester_name: string | null;
  } | null;

  // `name`, NOT `dj_name`. There is no users.dj_name — it's a column on BOOKINGS
  // and a contract placeholder. Selecting it made PostgREST reject the query,
  // which returned null, which silently fell back to "your DJ" on every planner
  // ever sent. A wrong column in a select doesn't throw; it hands you nothing,
  // and a fallback that reads fine is how it goes unnoticed.
  const { data: djData } = await admin
    .from('users')
    .select('name')
    .eq('id', planner.dj_id)
    .maybeSingle();
  const djName = (djData as unknown as { name?: string | null } | null)?.name || 'your DJ';

  // Hidden fields never reach the browser. Filtering here rather than in the
  // form means a hidden question isn't sitting in the page source of a document
  // we hand to a stranger.
  //
  // Also drop the legacy time fields. Music start/end were prefilled straight
  // from the booking's start/end — i.e. the same times now shown in the strip
  // above — and the wedding cocktail start likewise. They were duplicates, so
  // they're filtered here so ALREADY-SENT planners (whose snapshot still carries
  // them) dedupe too, not just planners sent after the template SQL.
  const fields = visibleFields(planner.fields ?? []).filter(
    (f) => !LEGACY_TIME_FIELD_IDS.has(f.id),
  );

  /**
   * What we already know, from the booking itself — not from a question.
   *
   * None of this was ever a field. We have it because they booked; asking for
   * it again is asking a client to type our own database back to us, and every
   * question they scroll past costs an answer on the ones that matter.
   *
   * Empty values are dropped rather than rendered as "—": a blank row is a
   * question mark, and this block exists to remove question marks.
   */
  // Times, labelled for the event. A general party has a start and an end; a
  // wedding's start/end ARE the reception, and it may have a cocktail hour
  // before it. These come straight off the booking — the same start_time /
  // end_time it was booked with — so they're shown here, never asked, and never
  // duplicated as separate "music starts / ends" questions.
  const isWedding = booking?.event_type === 'weddings';
  const startLabel = isWedding ? 'Reception start' : 'Start time';
  const endLabel = isWedding ? 'Reception end' : 'End time';
  const showCocktail = isWedding && !!booking?.cocktail_needed && !!booking?.cocktail_start_time;

  const known: { k: string; v: string }[] = [
    // Event type first — the client should see at a glance the planner was
    // written for their kind of party.
    { k: 'Event', v: booking?.event_type ? (MOB_EVENT_LABELS[booking.event_type] || '') : '' },
    { k: 'Date', v: fmtDate(booking?.event_date ?? null) },
    ...(showCocktail
      ? [{ k: 'Cocktail hour', v: fmtTime(booking?.cocktail_start_time ?? null) }]
      : []),
    { k: startLabel, v: fmtTime(booking?.start_time ?? null) },
    { k: endLabel, v: fmtTime(booking?.end_time ?? null) },
    { k: 'Venue', v: [booking?.venue_name, booking?.venue_address].filter(Boolean).join(' · ') },
    // The event-type detail from the booking form (surprise party, type of
    // anniversary/graduation/reunion, birthday age). Carries through as a known
    // fact — shown, never re-asked. Empty for event types without a sub-field.
    { k: 'Occasion', v: booking?.event_details || '' },
    { k: 'Package', v: booking?.package_title || '' },
    { k: 'Guests', v: booking?.guest_count ? `${booking.guest_count}` : '' },
    // The person who booked — the host/client on file. Shown here as a known
    // fact with their number, so the day-of contact lives in the strip instead
    // of being asked as a question.
    { k: 'Booked by', v: booking?.requester_name || '' },
    { k: 'Your number', v: booking?.phone || '' },
  ].filter((r) => !!r.v);

  return (
    <PlannerForm
      plannerId={planner.id}
      fields={fields}
      initialResponses={planner.responses ?? {}}
      initialStatus={planner.status}
      djName={djName}
      hostName={booking?.requester_name || null}
      eventDateLabel={fmtDate(booking?.event_date ?? null)}
      venueName={booking?.venue_name || null}
      known={known}
    />
  );
}
