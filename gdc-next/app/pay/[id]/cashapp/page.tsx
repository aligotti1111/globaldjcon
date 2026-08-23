// /pay/[id]/cashapp — the Cash App hand-off page.
//
// WHY THIS PAGE EXISTS
// The deposit/balance request arrives by EMAIL, and email can't detect the
// device. A raw cash.app link tapped from inside an email app's built-in
// browser opens Cash App but often DROPS the prefilled amount during the
// hand-off to the app — the client lands in Cash App not knowing what to send.
// On a laptop the link opens a web page they usually can't pay from at all.
//
// A page can do better. The email now points here, and this decides:
//   • phone  → straight into the Cash App app, amount preloaded — and the
//              amount + $cashtag are shown ON THIS PAGE too, so if Cash App
//              drops the prefill the client still sees exactly what to send.
//   • laptop → a QR of the SAME link, to scan with their phone.
//
// One link in the email, correct on both, and the amount is never invisible.
//
// NO LOGIN. Clients don't have accounts. The payment id is an unguessable
// UUID — a capability URL, exactly like the Venmo page and the DocuSeal
// signing link we already email. It exposes the DJ's $cashtag and the amount
// to whoever holds it, which is precisely what the email itself does. No new
// exposure.
//
// It reads with the ADMIN client because there is no session to read with. It
// deliberately does NOT write: no status changes, nothing that treats opening
// a link as evidence of payment. The client can only ever claim they paid;
// only the DJ confirming turns it into money received.

import { notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  usableMethods,
  buildPayLink,
  referenceCode,
  type PaymentMethod,
} from '@/lib/paymentMethods';
import CashAppPay from './CashAppPay';

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

export default async function CashAppPayPage({ params }: { params: Promise<{ id: string }> }) {
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
    .select('name, payment_methods')
    .eq('id', booking.dj_id)
    .maybeSingle();
  const dj = djData as unknown as { name: string | null; payment_methods?: unknown } | null;

  const methods = usableMethods(
    (Array.isArray(dj?.payment_methods) ? dj?.payment_methods : []) as PaymentMethod[],
  );
  const cashapp = methods.find((m) => m.type === 'cashapp');
  // The DJ turned Cash App off (or never had it) between sending the request
  // and the client opening the email. Nothing to hand off to.
  if (!cashapp) notFound();

  // What's actually left to pay — not the original ask. A client who already
  // sent part of it (the rails cap below a typical deposit) must not be shown
  // the full amount again.
  const outstanding = Math.max(
    0,
    Math.round((Number(pay.amount) - Number(pay.amount_paid || 0)) * 100) / 100,
  );
  const settled = pay.status === 'paid' || pay.status === 'waived' || outstanding <= 0;

  const reference = referenceCode(pay.booking_id, pay.kind);
  const link = buildPayLink(cashapp, outstanding, reference);
  if (!link) notFound();

  return (
    <CashAppPay
      link={link}
      amount={outstanding}
      currency={pay.currency || 'USD'}
      djName={dj?.name || 'your DJ'}
      reference={reference}
      handle={`$${cashapp.handle}`}
      settled={settled}
      venueName={booking.venue_name}
      eventDate={booking.event_date}
    />
  );
}
