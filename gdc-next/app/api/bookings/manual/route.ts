// POST /api/bookings/manual   — create a manual booking
// PATCH /api/bookings/manual  — update a manual booking (or patch a field)
//
// Manual bookings used to be written straight from the browser via the
// RLS-bound Supabase client. That works for an owner (dj_id === auth.uid()),
// but a TEAMMATE acting for an owner writes dj_id = owner's id ≠ auth.uid(),
// which the bookings INSERT policy rejects (RLS 42501). Reads already go
// through the admin client + acting context for exactly this reason, so the
// writes now follow the same pattern: authorize via getActingContext, then
// write with the admin client scoped hard to the acting owner's id.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext, canAcceptBookings } from '@/lib/acting';

export const runtime = 'nodejs';
export const maxDuration = 26;

const SELECT_COLS = 'id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, venue_type_desc, set_type, event_type, event_details, cocktail_needed, cocktail_start_time, package_title, package_details, package_category, package_index, overtime_rate, booking_type, is_manual, flyer_url, host_email, host_email_sent_at, requester_name, offer_amount, original_rate, discount_code, discount_label, discount_amount, currency, tax_pct, tax_amount, total_with_tax, deposit_pct, deposit_amount';

// Columns a client is allowed to set on a manual booking. Anything else in the
// payload (id, dj_id, requester_id, status, is_manual…) is ignored — those are
// controlled server-side.
const WRITABLE = new Set([
  'booking_type', 'event_date', 'start_time', 'end_time',
  'venue_name', 'venue_address', 'venue_lat', 'venue_lon', 'venue_type', 'venue_type_desc',
  'set_type', 'event_type', 'event_details', 'cocktail_needed', 'cocktail_start_time',
  'package_title', 'package_details', 'package_category', 'package_index', 'overtime_rate',
  'host_email', 'host_email_sent_at', 'requester_name', 'offer_amount', 'currency',
  'tax_pct', 'tax_amount', 'total_with_tax', 'deposit_pct', 'deposit_amount',
]);

function clean(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (payload && typeof payload === 'object') {
    for (const [k, v] of Object.entries(payload)) if (WRITABLE.has(k)) out[k] = v;
  }
  return out;
}

async function authorize() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  const acting = await getActingContext(user.id);
  // Adding/editing a manual booking is accepting a booking — manager+ only.
  if (!canAcceptBookings(acting.role)) {
    return { error: NextResponse.json({ error: 'Your role cannot add or edit bookings.' }, { status: 403 }) };
  }
  return { djId: acting.djId, admin: createAdminClient() };
}

export async function POST(req: Request) {
  const auth = await authorize();
  if ('error' in auth) return auth.error;
  const { djId, admin } = auth;

  let body: { payload?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const row = { ...clean(body.payload), dj_id: djId, requester_id: djId, is_manual: true, status: 'approved' };

  const { data, error } = await admin
    .from('bookings')
    .insert(row as unknown as never)
    .select(SELECT_COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: 400 });
  return NextResponse.json({ ok: true, booking: data });
}

export async function PATCH(req: Request) {
  const auth = await authorize();
  if ('error' in auth) return auth.error;
  const { djId, admin } = auth;

  let body: { id?: string; payload?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { data, error } = await admin
    .from('bookings')
    .update(clean(body.payload) as unknown as never)
    .eq('id', id)
    .eq('dj_id', djId)
    .select(SELECT_COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: 400 });
  return NextResponse.json({ ok: true, booking: data });
}
