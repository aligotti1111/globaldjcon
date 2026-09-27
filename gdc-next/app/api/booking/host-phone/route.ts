// POST /api/booking/host-phone — the HOST updates the contact phone on their own
// booking, from their upcoming-events card. No approval, no email: it just saves.
// The DJ's card shows an "Updated by host" badge next to the phone (we stamp
// bookings.field_edits.phone = 'hostupdated:<ISO>').
//
// Auth: the signed-in user must be the booking's requester (the host). Scoped
// hard to requester_id so one host can't touch another's booking.
//
// Body: { bookingId: string, phone: string }

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { bookingId?: string; phone?: string };
  const bookingId = body.bookingId;
  const phone = (body.phone || '').trim();
  if (!bookingId) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  if (phone.replace(/\D/g, '').length < 7) return NextResponse.json({ error: 'Enter a valid phone number.' }, { status: 400 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: b } = await admin
    .from('bookings')
    .select('id, requester_id, phone, field_edits')
    .eq('id', bookingId)
    .maybeSingle<{ id: string; requester_id: string | null; phone: string | null; field_edits: Record<string, string> | null }>();
  // Only the host who made the booking may update it here.
  if (!b || b.requester_id !== user.id) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  if ((b.phone || '') === phone) return NextResponse.json({ ok: true, phone });

  const marks = { ...(b.field_edits || {}), phone: `hostupdated:${new Date().toISOString()}` };
  const { error } = await admin
    .from('bookings')
    .update({ phone, field_edits: marks } as unknown as never)
    .eq('id', bookingId);
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  return NextResponse.json({ ok: true, phone });
}
