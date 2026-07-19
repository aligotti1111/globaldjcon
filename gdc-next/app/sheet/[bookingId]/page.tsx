// /sheet/[bookingId] — the DJ's copy of the printable Planner & Playlist.
//
// DJ-AUTHED, by session. /planner/[id] and /planner/[id]/print are the client's
// capability urls; this is keyed on a BOOKING id, which turns up in the app's
// own urls and isn't a secret, so ownership is checked properly.
//
// The rendering lives in PlannerSheetView — shared with the client's
// /planner/[id]/print so the two copies are identical. This page only does the
// DJ-side data fetch, including resolving a BLANK sheet from the template when
// no planner has been sent yet (so the DJ can download a blank to fill by hand).

import { notFound, redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  visibleFields,
  pickTemplate,
  composeFields,
  applyPrefill,
  type PlannerField,
  type PlannerResponses,
  type PlannerTemplate,
} from '@/lib/planner';
import PlannerSheetView, { type SheetBooking } from './PlannerSheetView';

// Prefilled time questions that only echoed the booking's own start/end (and
// wedding cocktail) — now shown in the header, never asked. Filtered so they
// don't print twice.
const LEGACY_TIME_FIELD_IDS = new Set(['music_start', 'music_end', 'w_cocktail_start']);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Planner & Playlist — Global DJ Connect',
  robots: { index: false, follow: false },
};

export default async function SheetPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  const { data: pData } = await db
    .from('booking_planners')
    .select('id, dj_id, fields, responses, status, submitted_at')
    .eq('booking_id', bookingId)
    .maybeSingle();
  const planner = pData as unknown as {
    id: string;
    dj_id: string;
    fields: PlannerField[] | null;
    responses: PlannerResponses | null;
    status: string;
    submitted_at: string | null;
  } | null;

  const { data: bData } = await admin
    .from('bookings')
    .select('dj_id, event_type, event_details, event_date, start_time, end_time, venue_name, venue_address, guest_count, phone, cocktail_needed, cocktail_start_time, requester_name')
    .eq('id', bookingId)
    .maybeSingle();
  const b = bData as unknown as (SheetBooking & { dj_id: string | null }) | null;

  // 404 rather than 403 on someone else's booking. Ownership is read from
  // whichever record we have: the planner if one exists, otherwise the booking.
  const ownerId = planner?.dj_id ?? b?.dj_id ?? null;
  if (!b || ownerId !== user.id) notFound();

  let responses: PlannerResponses;
  let fields: PlannerField[];
  let status: string;
  let submittedAt: string | null;

  if (planner) {
    responses = planner.responses ?? {};
    fields = visibleFields(planner.fields ?? []);
    status = planner.status;
    submittedAt = planner.submitted_at;
  } else {
    // No planner sent yet — resolve the DJ's template and render it BLANK,
    // prefilled only with what the booking already knows. Nothing is written.
    const { data: tData } = await db
      .from('planners')
      .select('id, dj_id, name, event_type, is_standard, fields')
      .or(`is_standard.eq.true,dj_id.eq.${b.dj_id}`);
    const templates = (tData as unknown as PlannerTemplate[] | null) || [];
    const { base, override } = pickTemplate(templates, b.dj_id ?? '', b.event_type);
    const composed = composeFields(base?.fields || [], override?.fields || []);

    const { data: djData } = await admin
      .from('users')
      .select('name')
      .eq('id', b.dj_id ?? '')
      .maybeSingle();
    const djName = (djData as unknown as { name?: string | null } | null)?.name || null;

    responses = applyPrefill(composed, b as unknown as Parameters<typeof applyPrefill>[1], djName, {});
    fields = visibleFields(composed);
    status = 'sent';
    submittedAt = null;
  }

  fields = fields.filter((f) => !LEGACY_TIME_FIELD_IDS.has(f.id));

  return (
    <PlannerSheetView
      b={b}
      fields={fields}
      responses={responses}
      status={status}
      submittedAt={submittedAt}
      plannerExists={!!planner}
    />
  );
}
