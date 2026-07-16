// /pay/[id]/venmo — the Venmo hand-off page.
//
// WHY THIS PAGE EXISTS
// Venmo does not allow initiating a payment from their website. On a phone the
// link opens the app with the amount filled in; on a laptop it opens a profile
// the client CANNOT pay from — a dead end, silently.
//
// The deposit request arrives by EMAIL, and email can't detect the device. So a
// "Pay with Venmo" button in the email is right for the client reading it on
// their phone and useless for the one reading it on a laptop — and we have no
// way to know which. Half of them hit the wall.
//
// A page can know. The email now points here, and this decides:
//   • phone  → straight into the Venmo app, amount and note preloaded
//   • laptop → a QR of the SAME link, to scan with their phone
//
// One link in the email, correct on both. Nothing else could be.
//
// NO LOGIN. Clients don't have accounts. The payment id is an unguessable
// UUID — a capability URL, exactly like the DocuSeal signing link we already
// email them. It exposes the DJ's Venmo handle and the amount to whoever holds
// it, which is precisely what the email itself does. No new exposure.
//
// It reads with the ADMIN client because there is no session to read with. Note
// what it deliberately does NOT do: no writes, no status changes, nothing that
// treats opening a link as evidence of payment. The client can only ever claim
// they paid; only the DJ confirming turns it into money received.

import { notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  usableMethods,
  buildPayLink,
  referenceCode,
  type PaymentMethod,
} from '@/lib/paymentMethods';
import VenmoPay from './VenmoPay';

export const runtime = 'nodejs';
// Per-payment state and a live amount — must never be cached or prerendered.
export const dynamic = 'force-dynamic';

interface PayRow {
  id: string;
  booking_id: string;
  kind: string;
  amount: number;
  amount_paid: number | null;
  currency: string | null;
  status: string;
}

export default async function VenmoPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const admin = createAdminClient();
  // booking_payments predates the generated types/supabase.ts, so the typed
  // client rejects .from('booking_payments') outright. One cast for the new
  // table, same house pattern as /api/payments.
  const db = admin as unknown as SupabaseClient;

  const { data: payData } = await db
    .from('booking_payments')
    .select('id, booking_id, kind, amount, amount_paid, currency, status')
    .eq('id', id)
    .maybeSingle();
  const pay = payData as unknown as PayRow | null;
  if (!pay) notFound();

  const { data: bookingData } = await admin
    .from('bookings')
    .select('dj_id, event_date, venue_name')
    .eq('id', pay.booking_id)
    .maybeSingle();
  const booking = bookingData as unknown as {
    dj_id: string | null; event_date: string | null; venue_name: string | null;
  } | null;
  if (!booking?.dj_id) notFound();

  const { data: djData } = await admin
    .from('users')
    .select('dj_name, payment_methods')
    .eq('id', booking.dj_id)
    .maybeSingle();
  const dj = djData as unknown as { dj_name: string | null; payment_methods?: unknown } | null;

  const methods = usableMethods(
    (Array.isArray(dj?.payment_methods) ? dj?.payment_methods : []) as PaymentMethod[],
  );
  const venmo = methods.find((m) => m.type === 'venmo');
  // The DJ turned Venmo off (or never had it) between sending the request and
  // the client opening the email. Nothing to hand off to.
  if (!venmo) notFound();

  // What's actually left to pay — not the original ask. A client who already
  // sent part of it (the rails cap below a typical deposit: unverified Venmo
  // stops at $299.99/week) must not be shown the full amount again.
  const outstanding = Math.max(
    0,
    Math.round((Number(pay.amount) - Number(pay.amount_paid || 0)) * 100) / 100,
  );
  const settled = pay.status === 'paid' || pay.status === 'waived' || outstanding <= 0;

  const reference = referenceCode(pay.booking_id, pay.kind);
  const link = buildPayLink(venmo, outstanding, reference);
  if (!link) notFound();

  return (
    <VenmoPay
      link={link}
      amount={outstanding}
      currency={pay.currency || 'USD'}
      djName={dj?.dj_name || 'your DJ'}
      reference={reference}
      handle={`@${venmo.handle}`}
      settled={settled}
      venueName={booking.venue_name}
      eventDate={booking.event_date}
    />
  );
}
