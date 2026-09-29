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
import { splitMailAddress, checkMemo, referenceCode } from '@/lib/paymentMethods';
import CheckSent from './CheckSent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PayRow {
  id: string; booking_id: string; kind: string; amount: number; currency: string | null; status: string;
}

export default async function CheckSentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mode?: string; method?: string }> }) {
  const { id } = await params;
  const { mode, method } = await searchParams;
  const atEvent = mode === 'at-event';
  const payMethod = method === 'cash' ? 'cash' : method === 'check' ? 'check' : null;
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
    .select('event_date, venue_name, dj_id')
    .eq('id', pay.booking_id)
    .maybeSingle();
  const booking = bookingData as unknown as { event_date: string | null; venue_name: string | null; dj_id: string | null } | null;

  // The DJ's display name (used in place of a vague "your DJ") and, for a cash
  // choice, the phone the host should call/text to arrange a drop-off.
  let djName: string | null = null;
  let cashPhone: string | null = null;
  // Check-specific: the DJ's rules (night-of allowed? how far ahead?) plus the
  // payable-to name, mailing address, and a call/text number — all relayed to
  // the host when they're paying the BALANCE by check.
  let checkNightOf = false;
  let checkLeadWeeks: number | null = null;
  let checkPhone: string | null = null;
  let checkPayTo: string | null = null;
  let checkAddressLines: string[] = [];
  if (booking?.dj_id) {
    const { data: djData } = await admin
      .from('users')
      .select('name, payment_methods')
      .eq('id', booking.dj_id)
      .maybeSingle();
    const dj = djData as { name?: string | null; payment_methods?: unknown } | null;
    djName = dj?.name?.trim() || null;
    const methods = Array.isArray(dj?.payment_methods)
      ? (dj!.payment_methods as Array<{ type?: string; handle?: string; contact?: string; checkNightOf?: boolean; checkLeadWeeks?: number; checkPhone?: string }>)
      : [];
    if (payMethod === 'cash') {
      cashPhone = methods.find((m) => m?.type === 'cash')?.handle?.trim() || null;
    }
    if (payMethod === 'check') {
      const chk = methods.find((m) => m?.type === 'check');
      checkNightOf = chk?.checkNightOf === true;
      checkLeadWeeks = typeof chk?.checkLeadWeeks === 'number' ? chk!.checkLeadWeeks : null;
      checkPhone = chk?.checkPhone?.trim() || null;
      checkPayTo = chk?.handle?.trim() || null;
      checkAddressLines = chk?.contact ? splitMailAddress(chk.contact) : [];
    }
  }

  // Deadline the check must be RECEIVED by = event date − leadWeeks. Computed
  // server-side so the host just sees a date. Only when the DJ requires it ahead.
  let checkDeadline: string | null = null;
  if (payMethod === 'check' && !checkNightOf && checkLeadWeeks && booking?.event_date) {
    const d = new Date(`${booking.event_date}T12:00:00`);
    if (!isNaN(d.getTime())) {
      d.setDate(d.getDate() - checkLeadWeeks * 7);
      checkDeadline = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }
  }

  return (
    <CheckSent
      paymentId={pay.id}
      amount={Number(pay.amount)}
      currency={pay.currency || 'USD'}
      kind={pay.kind}
      alreadySettled={pay.status === 'paid' || pay.status === 'waived'}
      eventDate={booking?.event_date || null}
      venueName={booking?.venue_name || null}
      atEvent={atEvent}
      method={payMethod}
      djName={djName}
      cashPhone={cashPhone}
      checkNightOf={checkNightOf}
      checkDeadline={checkDeadline}
      checkLeadWeeks={checkLeadWeeks}
      checkPhone={checkPhone}
      checkPayTo={checkPayTo}
      checkAddressLines={checkAddressLines}
      checkMemoLine={payMethod === 'check' ? checkMemo(booking?.event_date ?? null, booking?.venue_name ?? null, referenceCode(pay.booking_id, pay.kind)) : ''}
    />
  );
}
