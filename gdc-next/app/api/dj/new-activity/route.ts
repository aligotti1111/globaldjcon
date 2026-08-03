// GET /api/dj/new-activity
//
// The notification bell's data: the most recent HOST action on each of the
// DJ's upcoming bookings — contract signed, a payment the host said they paid,
// the planner submitted, the rider or guest list confirmed. One item per
// booking (its newest action), newest first. Same signals as the Upcoming
// Bookings "New activity" view, resolved through the acting context so it works
// for the owner and for a teammate seated on the owner's account.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext } from '@/lib/acting';
import { MOB_EVENT_LABELS } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Slot = 'contract' | 'deposit' | 'invoice' | 'song_list' | 'guestlist';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ items: [], count: 0 });

  const acting = await getActingContext(user.id);
  const djId = acting.djId;
  const admin = createAdminClient() as unknown as SupabaseClient;
  const today = new Date().toISOString().slice(0, 10);

  const { data: rows } = await admin
    .from('bookings')
    .select('id, event_date, event_type, venue_type, contract_status, contract_signed_at, contract_sent_at')
    .eq('dj_id', djId)
    .is('deleted_at', null)
    .gte('event_date', today)
    .or('status.eq.approved,status.eq.cancelled,is_manual.eq.true')
    .limit(200);
  const bookings = (rows || []) as {
    id: string; event_date: string | null; event_type: string | null; venue_type: string | null;
    contract_status: string | null; contract_signed_at: string | null; contract_sent_at: string | null;
  }[];
  const ids = bookings.map((b) => b.id);

  const activity: Record<string, { ts: string; t: number; slot: Slot }> = {};
  const note = (bid: string, ts: string | null | undefined, slot: Slot) => {
    if (!ts) return;
    const t = Date.parse(ts);
    if (Number.isNaN(t)) return;
    const cur = activity[bid];
    if (!cur || t > cur.t) activity[bid] = { ts, t, slot };
  };

  if (ids.length > 0) {
    const [{ data: pay }, { data: plan }, { data: riders }, { data: gls }] = await Promise.all([
      admin.from('booking_payments').select('booking_id, kind, marked_sent_at').in('booking_id', ids),
      admin.from('booking_planners').select('booking_id, submitted_at').in('booking_id', ids),
      admin.from('booking_riders').select('booking_id, confirmed_at').in('booking_id', ids),
      admin.from('booking_guestlists').select('booking_id, confirmed_at').in('booking_id', ids),
    ]);
    for (const p of ((pay as { booking_id: string; kind: string | null; marked_sent_at: string | null }[] | null) || [])) {
      note(p.booking_id, p.marked_sent_at, p.kind === 'deposit' ? 'deposit' : 'invoice');
    }
    for (const p of ((plan as { booking_id: string; submitted_at: string | null }[] | null) || [])) {
      note(p.booking_id, p.submitted_at, 'song_list');
    }
    for (const r of ((riders as { booking_id: string; confirmed_at: string | null }[] | null) || [])) {
      note(r.booking_id, r.confirmed_at, 'song_list');
    }
    for (const g of ((gls as { booking_id: string; confirmed_at: string | null }[] | null) || [])) {
      note(g.booking_id, g.confirmed_at, 'guestlist');
    }
  }

  for (const b of bookings) {
    const signedAt = b.contract_status === 'signed'
      ? (b.contract_signed_at || b.contract_sent_at || null)
      : (b.contract_signed_at || null);
    note(b.id, signedAt, 'contract');
  }

  const byId = Object.fromEntries(bookings.map((b) => [b.id, b]));
  const items = Object.entries(activity)
    .map(([bid, a]) => {
      const b = byId[bid];
      const label = b?.event_type
        ? (MOB_EVENT_LABELS[b.event_type] || b.event_type)
        : (b?.venue_type || 'Booking');
      return { bookingId: bid, slot: a.slot, at: a.ts, eventDate: b?.event_date || null, label };
    })
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at));

  return NextResponse.json({ items: items.slice(0, 20), count: items.length });
}
