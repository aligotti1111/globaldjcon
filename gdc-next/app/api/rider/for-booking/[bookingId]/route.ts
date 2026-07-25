// /api/rider/for-booking/[bookingId] — the DJ's per-booking rider.
//   GET  — load this booking's rider; if none exists yet, return a seeded copy
//          from the DJ's default (booking_settings) or the starter template,
//          WITHOUT persisting. The DJ edits, then saves/deploys.
//   PUT  — save the edited rider (mode + items + pdf url). Status untouched —
//          a saved draft stays a draft.
// Session required; the booking must belong to the signed-in DJ.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActingContext } from '@/lib/acting';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeRiderItems, normalizeRiderMode, seedRider, equipChoiceFromBooking,
  type RiderItem, type RiderMode,
} from '@/lib/rider';

export const runtime = 'nodejs';

interface OwnedBooking {
  id: string; dj_id: string | null; equipment: string | null;
  event_date: string | null; start_time: string | null; end_time: string | null;
  venue_name: string | null; venue_address: string | null; venue_type: string | null;
}

async function ownedBooking(admin: SupabaseClient, bookingId: string, userId: string): Promise<OwnedBooking | null> {
  const { data } = await admin.from('bookings').select('id, dj_id, equipment, event_date, start_time, end_time, venue_name, venue_address, venue_type').eq('id', bookingId).maybeSingle();
  const b = data as unknown as OwnedBooking | null;
  if (!b || b.dj_id !== userId) return null;
  return b;
}

interface DjRiderCtx {
  rest: RiderItem[];             // hospitality + custom default
  systemDetail: string; decksDetail: string;
  mode: RiderMode; pdfUrl: string | null;
}

async function djSettings(admin: SupabaseClient, userId: string): Promise<DjRiderCtx> {
  const { data } = await admin.from('users').select('booking_settings').eq('id', userId).maybeSingle();
  const bs = (data as unknown as { booking_settings?: unknown } | null)?.booking_settings;
  let parsed: Record<string, unknown> = {};
  if (typeof bs === 'string') { try { parsed = JSON.parse(bs); } catch { parsed = {}; } }
  else if (bs && typeof bs === 'object') { parsed = bs as Record<string, unknown>; }
  const rest = normalizeRiderItems(parsed.rider_default).filter((i) => i.section === 'hospitality' || i.section === 'custom');
  const systemDetail = typeof parsed.equip_full_detail === 'string' ? parsed.equip_full_detail : '';
  const decksDetail = typeof parsed.equip_decks_detail === 'string' ? parsed.equip_decks_detail : '';
  const mode = normalizeRiderMode(parsed.rider_mode);
  const pdfUrl = typeof parsed.rider_pdf_url === 'string' && parsed.rider_pdf_url ? parsed.rider_pdf_url : null;
  return { rest, systemDetail, decksDetail, mode, pdfUrl };
}

export async function GET(_req: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const acting = await getActingContext(user.id);

  const admin = createAdminClient() as unknown as SupabaseClient;
  const b = await ownedBooking(admin, bookingId, acting.djId);
  if (!b) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  // DJ branding + this booking's event details, so the builder preview and the
  // host page can both show the header.
  const { data: djData } = await admin.from('users').select('name, contract_logo_url').eq('id', acting.djId).maybeSingle();
  const dj = djData as unknown as { name?: string | null; contract_logo_url?: string | null } | null;
  const meta = {
    djName: dj?.name || 'Your DJ',
    logoUrl: dj?.contract_logo_url || null,
    event: {
      date: b.event_date, start: b.start_time, end: b.end_time,
      venueName: b.venue_name, venueAddress: b.venue_address, eventType: b.venue_type,
    },
  };

  const { data: rRow } = await admin
    .from('booking_riders')
    .select('id, items, status, sent_at, rider_mode, rider_pdf_url')
    .eq('booking_id', bookingId)
    .maybeSingle();
  const row = rRow as unknown as {
    id: string; items: unknown; status: string; sent_at: string | null;
    rider_mode: unknown; rider_pdf_url: string | null;
  } | null;
  if (row) {
    return NextResponse.json({
      ok: true, ...meta, id: row.id, items: normalizeRiderItems(row.items),
      mode: normalizeRiderMode(row.rider_mode), pdfUrl: row.rider_pdf_url || null,
      status: row.status, sentAt: row.sent_at, seeded: false,
    });
  }

  const ctx = await djSettings(admin, acting.djId);
  const seeded = seedRider(ctx.rest, {
    choice: equipChoiceFromBooking(b.equipment),
    systemDetail: ctx.systemDetail,
    decksDetail: ctx.decksDetail,
  });
  return NextResponse.json({
    ok: true, ...meta, id: null, items: seeded,
    mode: ctx.mode, pdfUrl: ctx.pdfUrl,
    status: 'draft', sentAt: null, seeded: true,
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const acting = await getActingContext(user.id);

  let body: { items?: unknown; mode?: unknown; pdfUrl?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const items = normalizeRiderItems(body.items);
  const mode = normalizeRiderMode(body.mode);
  const pdfUrl = typeof body.pdfUrl === 'string' && body.pdfUrl ? body.pdfUrl : null;

  const admin = createAdminClient() as unknown as SupabaseClient;
  const b = await ownedBooking(admin, bookingId, acting.djId);
  if (!b) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const { data: up, error } = await admin
    .from('booking_riders')
    .upsert({
      booking_id: bookingId, dj_id: acting.djId, items,
      rider_mode: mode, rider_pdf_url: pdfUrl,
      updated_at: new Date().toISOString(),
    } as unknown as never, { onConflict: 'booking_id' })
    .select('id, status')
    .single();
  if (error || !up) return NextResponse.json({ error: 'Could not save the rider.' }, { status: 500 });
  const r = up as unknown as { id: string; status: string };
  return NextResponse.json({ ok: true, id: r.id, status: r.status });
}
