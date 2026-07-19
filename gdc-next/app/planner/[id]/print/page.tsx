// /planner/[id]/print — the CLIENT's downloadable Planner & Playlist.
//
// NO LOGIN. Keyed on the planner's capability url — the same unguessable id as
// /planner/[id], read with the admin client because there is no session. This
// is what the "Download PDF" button on the planner page opens (with ?download=1
// so it downloads on open). It renders the SAME PlannerSheetView the DJ's
// /sheet page does, so the client's copy and the DJ's copy are identical.
//
// It only ever READS. Opening this link is not evidence of anything — same as
// opening the planner form itself.

import { notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { visibleFields, type PlannerField, type PlannerResponses } from '@/lib/planner';
import PlannerSheetView, { type SheetBooking } from '@/app/sheet/[bookingId]/PlannerSheetView';

// Same legacy time fields the other planner surfaces filter out.
const LEGACY_TIME_FIELD_IDS = new Set(['music_start', 'music_end', 'w_cocktail_start']);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Planner & Playlist — Global DJ Connect',
  robots: { index: false, follow: false },
};

export default async function PlannerPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  const { data: pData } = await db
    .from('booking_planners')
    .select('id, booking_id, dj_id, fields, responses, status, submitted_at, logo_hidden')
    .eq('id', id)
    .maybeSingle();
  const planner = pData as unknown as {
    id: string;
    booking_id: string;
    dj_id: string;
    fields: PlannerField[] | null;
    responses: PlannerResponses | null;
    status: string;
    submitted_at: string | null;
    logo_hidden: boolean | null;
  } | null;
  if (!planner) notFound();

  // The DJ's business logo (users.contract_logo_url) — printed at the top, unless
  // the DJ hid it on THIS client's planner.
  const { data: logoData } = await admin
    .from('users')
    .select('contract_logo_url')
    .eq('id', planner.dj_id)
    .maybeSingle();
  const logoUrl = planner.logo_hidden
    ? null
    : (logoData as unknown as { contract_logo_url?: string | null } | null)?.contract_logo_url || null;

  const { data: bData } = await admin
    .from('bookings')
    .select('event_type, event_details, event_date, start_time, end_time, venue_name, venue_address, guest_count, phone, cocktail_needed, cocktail_start_time, ceremony_needed, ceremony_start_time, ceremony_same_room, requester_name')
    .eq('id', planner.booking_id)
    .maybeSingle();
  const b = bData as unknown as SheetBooking | null;

  const fields = visibleFields(planner.fields ?? []).filter((f) => !LEGACY_TIME_FIELD_IDS.has(f.id));

  return (
    <PlannerSheetView
      b={b}
      fields={fields}
      responses={planner.responses ?? {}}
      status={planner.status}
      submittedAt={planner.submitted_at}
      plannerExists
      logoUrl={logoUrl}
      paper
    />
  );
}
