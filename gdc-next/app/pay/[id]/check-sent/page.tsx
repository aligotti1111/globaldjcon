// /pay/[id]/check-sent — the "I've mailed my check" confirmation page.
//
// Reached from the Check option in a deposit/balance email. No login: the
// payment id is an unguessable UUID (a capability URL, same as the Venmo page
// and the DocuSeal signing link we already email). It reads with the admin
// client because there's no session. The actual notify is a POST from the
// button below — a link prefetch must never fire it.

import { notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import CheckSent from './CheckSent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PayRow {
  id: string; booking_id: string; kind: string; amount: number; currency: string | null; status: string;
}

export default async function CheckSentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  const { data: payData } = await db
    .from('booking_payments')
    .select('id, booking_id, kind, amount, currency, status')
    .eq('id', id)
    .maybeSingle();
  const pay = payData as unknown as PayRow | null;
  if (!pay) notFound();

  const { data: bookingData } = await admin
    .from('bookings')
    .select('event_date, venue_name')
    .eq('id', pay.booking_id)
    .maybeSingle();
  const booking = bookingData as unknown as { event_date: string | null; venue_name: string | null } | null;

  return (
    <CheckSent
      paymentId={pay.id}
      amount={Number(pay.amount)}
      currency={pay.currency || 'USD'}
      kind={pay.kind}
      alreadySettled={pay.status === 'paid' || pay.status === 'waived'}
      eventDate={booking?.event_date || null}
      venueName={booking?.venue_name || null}
    />
  );
}
