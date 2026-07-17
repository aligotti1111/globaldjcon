// GET /api/planner/for-booking/[bookingId]
//
// The DJ reading their client's answers. This is the other end of the feature:
// /planner/[id] is where the answers go in, this is where they come out.
//
// WHY A ROUTE AND NOT PAGE PROPS: /upcoming-bookings deliberately reduces every
// planner to "12/34" on the server and sends nothing else. A DJ with 40 upcoming
// bookings would otherwise ship 40 clients' full answer sets to the browser to
// render four columns of icons. The answers load when a row is opened, for the
// one booking that was opened.
//
// AUTH IS THE DJ'S SESSION, not the planner uuid. Deliberately different from
// /api/planner/[id]: the client's route is keyed on a capability url because a
// client has no account. A DJ does, and "which planner?" here is answered by a
// BOOKING id — which is not secret and turns up in urls all over the app. So
// ownership is checked properly.
//
// Cloudflare eats 502s. 500 only.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { visibleFields, type PlannerField, type PlannerResponses } from '@/lib/planner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    const { bookingId } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(bookingId)) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    const admin = createAdminClient();
    const db = admin as unknown as SupabaseClient;

    const { data: pData } = await db
      .from('booking_planners')
      .select('id, booking_id, dj_id, fields, responses, status, sent_at, submitted_at')
      .eq('booking_id', bookingId)
      .maybeSingle();
    const planner = pData as unknown as {
      id: string;
      dj_id: string;
      fields: PlannerField[] | null;
      responses: PlannerResponses | null;
      status: string;
      sent_at: string | null;
      submitted_at: string | null;
    } | null;

    // No planner is not an error — most bookings won't have one. `null` lets the
    // panel say "not requested" instead of showing a failure.
    if (!planner) return NextResponse.json({ planner: null });

    // Ownership on the PLANNER's dj_id, not the booking's. They're written
    // together and can't diverge today, but this is the row being handed over,
    // so this is the row whose owner should have to match.
    if (planner.dj_id !== user.id) {
      // 404, not 403 — a DJ probing booking ids shouldn't learn which ones exist.
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    // Hidden fields don't come back. The DJ hid them; a read view that shows
    // them anyway would be showing questions the client never saw, with no
    // answers, forever.
    return NextResponse.json({
      planner: {
        id: planner.id,
        status: planner.status,
        sent_at: planner.sent_at,
        submitted_at: planner.submitted_at,
        fields: visibleFields(planner.fields || []),
        responses: planner.responses || {},
      },
    });
  } catch {
    // 500, never 502 — see the header.
    return NextResponse.json({ error: 'Could not load the planner.' }, { status: 500 });
  }
}
