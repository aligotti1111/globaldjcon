// GET /api/dj/find-by-code?code=GDC-1A2B-D
//
// Reverse-lookup for the payment reference code. Every deposit/invoice link
// carries a code so the DJ can match an incoming Venmo/Zelle/etc. to a booking
// (see referenceCode() in lib/paymentMethods): GDC-<first 4 of the booking id>-<D|B|X>.
//
// The DJ pastes that code into the header search; this route parses out the
// id prefix, finds the matching booking(s) among their own, and returns a
// small summary plus the payment ledger so they can see at a glance which
// booking it is and where the money stands.
//
// Resolved through the acting context so it works for the owner and for a
// teammate seated on the owner's account.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext } from '@/lib/acting';
import { MOB_EVENT_LABELS } from '@/lib/constants';
import { referenceCode } from '@/lib/paymentMethods';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Booking = {
  id: string;
  event_type: string | null;
  venue_type: string | null;
  venue_name: string | null;
  event_date: string | null;
  requester_name: string | null;
  status: string | null;
  currency: string | null;
  total_with_tax: number | null;
  counter_rate: number | null;
  quoted_rate: number | null;
  offer_amount: number | null;
  deposit_amount: number | null;
};

type Payment = {
  booking_id: string;
  kind: string | null;
  amount: number | null;
  amount_paid: number | null;
  status: string | null;
  currency: string | null;
};

// Pull the 4-char booking-id prefix out of whatever the DJ typed. Accepts the
// full code ("GDC-1A2B-D"), just the middle ("1A2B"), lower/upper case, extra
// spaces or missing dashes. Returns null if we can't find 4 usable chars.
function parsePrefix(raw: string): string | null {
  let s = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('GDC')) s = s.slice(3);
  if (s.length < 4) return null;
  return s.slice(0, 4);
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const url = new URL(req.url);
  const prefix = parsePrefix(url.searchParams.get('code') || '');
  if (!prefix) return NextResponse.json({ items: [], error: 'Enter a code like GDC-1A2B-D.' }, { status: 200 });

  const acting = await getActingContext(user.id);
  const djId = acting.djId;
  const admin = createAdminClient() as unknown as SupabaseClient;

  const { data: rows } = await admin
    .from('bookings')
    .select('id, event_type, venue_type, venue_name, event_date, requester_name, status, currency, total_with_tax, counter_rate, quoted_rate, offer_amount, deposit_amount')
    .eq('dj_id', djId)
    .is('deleted_at', null)
    .limit(3000);
  const bookings = (rows || []) as unknown as Booking[];

  // The code's prefix is the first four characters of the booking id (the id's
  // first group is 8 hex chars, so no dash sits inside the first four).
  const matched = bookings.filter((b) => b.id.slice(0, 4).toUpperCase() === prefix);
  if (matched.length === 0) {
    return NextResponse.json({ items: [] });
  }

  // Pull the payment ledger for the matched bookings so the DJ sees where the
  // money stands (requested / says-sent / partial / paid).
  const ids = matched.map((b) => b.id);
  const { data: payRows } = await admin
    .from('booking_payments')
    .select('booking_id, kind, amount, amount_paid, status, currency')
    .in('booking_id', ids);
  const paysByBooking: Record<string, Payment[]> = {};
  for (const p of ((payRows as Payment[] | null) || [])) {
    (paysByBooking[p.booking_id] ||= []).push(p);
  }

  const items = matched.map((b) => {
    const price = b.total_with_tax ?? b.counter_rate ?? b.quoted_rate ?? b.offer_amount ?? null;
    const label = b.event_type ? (MOB_EVENT_LABELS[b.event_type] || b.event_type) : (b.venue_type || 'Booking');
    return {
      id: b.id,
      label,
      venueName: b.venue_name,
      eventDate: b.event_date,
      requesterName: b.requester_name,
      status: b.status,
      currency: b.currency || 'USD',
      price: price != null ? Number(price) : null,
      depositCode: referenceCode(b.id, 'deposit'),
      balanceCode: referenceCode(b.id, 'balance'),
      payments: (paysByBooking[b.id] || []).map((p) => ({
        kind: p.kind,
        amount: p.amount != null ? Number(p.amount) : null,
        amountPaid: p.amount_paid != null ? Number(p.amount_paid) : 0,
        status: p.status,
        currency: p.currency || b.currency || 'USD',
      })),
    };
  });

  return NextResponse.json({ items });
}
