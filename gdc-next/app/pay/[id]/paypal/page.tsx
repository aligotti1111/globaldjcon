// /pay/[id]/paypal — PayPal (and Venmo) hand-off page for a booking payment.
//
// NO LOGIN. The payment id is an unguessable UUID (capability URL), same model
// as the Venmo/card pay pages. Reads with the admin client; performs NO writes
// (opening the link is not payment). Capture happens only when the payer
// completes the PayPal flow, via /api/paypal/capture-order.
//
// The PayPal client id is a PUBLISHABLE value (safe in the browser) — the server
// reads it from env and passes it to the client component, which loads the SDK
// scoped to the DJ's connected merchant so the money goes to the DJ.

import { notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { paypalConfigured } from '@/lib/paypal/server';
import PaypalPay from './PaypalPay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PayRow {
  id: string; booking_id: string; kind: string;
  amount: number; amount_paid: number | null; currency: string | null; status: string;
}

export default async function PaypalPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!paypalConfigured()) notFound();

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  const { data: payData } = await db
    .from('booking_payments')
    .select('id, booking_id, kind, amount, amount_paid, currency, status')
    .eq('id', id).maybeSingle();
  const pay = payData as unknown as PayRow | null;
  if (!pay) notFound();

  const { data: bookingData } = await admin
    .from('bookings').select('dj_id, event_date, venue_name').eq('id', pay.booking_id).maybeSingle();
  const booking = bookingData as unknown as { dj_id: string | null; event_date: string | null; venue_name: string | null } | null;
  if (!booking?.dj_id) notFound();

  const { data: djData } = await admin
    .from('users').select('name, paypal_merchant_id, paypal_connect_ready').eq('id', booking.dj_id).maybeSingle();
  const dj = djData as unknown as { name: string | null; paypal_merchant_id: string | null; paypal_connect_ready: boolean | null } | null;
  // DJ hasn't finished connecting PayPal → nothing to pay to.
  if (!dj?.paypal_merchant_id || !dj.paypal_connect_ready) notFound();

  const clientId = process.env.PAYPAL_CLIENT_ID || '';
  if (!clientId) notFound();

  const outstanding = Math.max(0, Math.round((Number(pay.amount) - Number(pay.amount_paid || 0)) * 100) / 100);
  const settled = pay.status === 'paid' || pay.status === 'waived' || outstanding <= 0;
  const noun = pay.kind === 'balance' ? 'Balance' : pay.kind === 'deposit' ? 'Deposit' : 'Payment';

  return (
    <PaypalPay
      paymentId={pay.id}
      clientId={clientId}
      merchantId={dj.paypal_merchant_id}
      bnCode={process.env.PAYPAL_BN_CODE || undefined}
      amount={outstanding}
      currency={pay.currency || 'USD'}
      djName={dj.name || 'your DJ'}
      noun={noun}
      settled={settled}
      venueName={booking.venue_name}
      eventDate={booking.event_date}
    />
  );
}
