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
import PlannerForm from './PlannerForm';

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
    .select('event_date, start_time, end_time, venue_name, event_type, requester_name')
    .eq('id', planner.booking_id)
    .maybeSingle();
  const booking = bData as unknown as {
    event_date: string | null;
    venue_name: string | null;
    requester_name: string | null;
  } | null;

  const { data: djData } = await admin
    .from('users')
    .select('dj_name')
    .eq('id', planner.dj_id)
    .maybeSingle();
  const djName = (djData as unknown as { dj_name?: string | null } | null)?.dj_name || 'your DJ';

  // Hidden fields never reach the browser. Filtering here rather than in the
  // form means a hidden question isn't sitting in the page source of a document
  // we hand to a stranger.
  const fields = visibleFields(planner.fields ?? []);

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
    />
  );
}
