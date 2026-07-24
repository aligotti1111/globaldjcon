// /api/guestlist/for-booking/[bookingId] — the DJ's per-booking guest list.
//   GET — load it (empty if none yet) + event details + DJ logo for the header.
//   PUT — save the entries. Session required; booking must belong to the DJ.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeGuests } from '@/lib/guestlist';

export const runtime = 'nodejs';

interface OwnedBooking {
  id: string; dj_id: string | null;
  event_date: string | null; start_time: string | null; end_time: string | null;
  venue_name: string | null; venue_address: string | null; venue_type: string | null;
}

async function ownedBooking(admin: SupabaseClient, bookingId: string, userId: string): Promise<OwnedBooking | null> {
  const { data } = await admin.from('bookings')
    .select('id, dj_id, event_date, start_time, end_time, venue_name, venue_address, venue_type')
    .eq('id', bookingId).maybeSingle();
  const b = data as unknown as OwnedBooking | null;
  if (!b || b.dj_id !== userId) return null;
  return b;
}

export async function GET(_req: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const b = await ownedBooking(admin, bookingId, user.id);
  if (!b) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const { data: djData } = await admin.from('users').select('name, contract_logo_url').eq('id', user.id).maybeSingle();
  const dj = djData as unknown as { name?: string | null; contract_logo_url?: string | null } | null;
  const meta = {
    djName: dj?.name || 'Your DJ',
    logoUrl: dj?.contract_logo_url || null,
    event: { date: b.event_date, start: b.start_time, end: b.end_time, venueName: b.venue_name, venueAddress: b.venue_address, eventType: b.venue_type },
  };

  const { data: gRow } = await admin.from('booking_guestlists')
    .select('id, guests, status, sent_at').eq('booking_id', bookingId).maybeSingle();
  const row = gRow as unknown as { id: string; guests: unknown; status: string; sent_at: string | null } | null;
  if (row) {
    return NextResponse.json({ ok: true, ...meta, id: row.id, guests: normalizeGuests(row.guests), status: row.status, sentAt: row.sent_at });
  }
  return NextResponse.json({ ok: true, ...meta, id: null, guests: [], status: 'draft', sentAt: null });
}

export async function PUT(req: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { guests?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const guests = normalizeGuests(body.guests);

  const admin = createAdminClient() as unknown as SupabaseClient;
  const b = await ownedBooking(admin, bookingId, user.id);
  if (!b) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const { data: up, error } = await admin.from('booking_guestlists')
    .upsert({ booking_id: bookingId, dj_id: user.id, guests, updated_at: new Date().toISOString() } as unknown as never, { onConflict: 'booking_id' })
    .select('id, status').single();
  if (error || !up) return NextResponse.json({ error: 'Could not save the guest list.' }, { status: 500 });
  const r = up as unknown as { id: string; status: string };
  return NextResponse.json({ ok: true, id: r.id, status: r.status });
}
