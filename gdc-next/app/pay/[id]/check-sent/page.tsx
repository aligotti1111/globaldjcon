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
import { splitMailAddress, checkMemo, referenceCode, checkContactVerb } from '@/lib/paymentMethods';
import CheckSent from './CheckSent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PayRow {
  id: string; booking_id: string; kind: string; amount: number; currency: string | null; status: string;
  marked_sent_at: string | null; client_handoff: string | null;
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
    .select('id, booking_id, kind, amount, currency, status, marked_sent_at, client_handoff')
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
  // Cash mirrors check for the BALANCE: whether the host may pay in cash the
  // night of the event, and (if not) how far ahead the cash must be dropped off.
  // Cash can never be mailed, so the only hand-off is an in-person drop-off.
  let cashNightOf = false;
  let cashLeadWeeks: number | null = null;
  let cashCanText = false;
  // Which cash hand-offs the DJ turned on: exchange in person (meet, with a
  // phone) and drop off at the office (with an address). The host only sees the
  // options the DJ enabled.
  let cashMeet = false;
  let cashOffice = false;
  // Optional office where the host can drop off cash / a check, with open hours.
  let dropoffAddress: string | null = null;
  let dropoffHours: string | null = null;
  // Deposit only: how long the host has to get the deposit to the DJ (label).
  let depositLeadLabel: string | null = null;
  // Check-specific: the DJ's rules (night-of allowed? how far ahead?) plus the
  // payable-to name, mailing address, and a call/text number — all relayed to
  // the host when they're paying the BALANCE by check.
  let checkNightOf = false;
  let checkLeadWeeks: number | null = null;
  let checkPhone: string | null = null;
  let checkPayTo: string | null = null;
  let checkAddressLines: string[] = [];
  let checkVerb = 'call or text';
  // Which ways the DJ accepts a check (default all on). The host only sees the
  // ways the DJ left enabled.
  let checkMail = true;
  let checkMeet = true;
  let checkOffice = true;
  if (booking?.dj_id) {
    const { data: djData } = await admin
      .from('users')
      .select('name, payment_methods')
      .eq('id', booking.dj_id)
      .maybeSingle();
    const dj = djData as { name?: string | null; payment_methods?: unknown } | null;
    djName = dj?.name?.trim() || null;
    const methods = Array.isArray(dj?.payment_methods)
      ? (dj!.payment_methods as Array<{ type?: string; handle?: string; contact?: string; checkNightOf?: boolean; checkLeadWeeks?: number; checkPhone?: string; checkCall?: boolean; checkText?: boolean; cashNightOf?: boolean; cashLeadWeeks?: number; smsOk?: boolean; dropoffAddress?: string; dropoffHours?: string; checkMail?: boolean; checkMeet?: boolean; checkOffice?: boolean; cashMeet?: boolean; cashOffice?: boolean; depositLeadLabel?: string; depositLeadWeeks?: number }>)
      : [];
    // Deposit lead applies to the chosen rail (cash or check). Prefer the new
    // label; fall back to the legacy weeks number for rows saved before.
    const payMethodEntry = methods.find((m) => m?.type === payMethod);
    depositLeadLabel = typeof payMethodEntry?.depositLeadLabel === 'string'
      ? payMethodEntry.depositLeadLabel
      : (typeof payMethodEntry?.depositLeadWeeks === 'number'
          ? `${payMethodEntry.depositLeadWeeks} week${payMethodEntry.depositLeadWeeks === 1 ? '' : 's'}`
          : null);
    // The DJ has one physical office — the address and open hours may have been
    // filled on either the cash or the check tile. Use whichever has them so the
    // hours always appear under the office address, no matter which rail the host
    // is on.
    const officeFallbackAddress = methods.find((m) => (m?.dropoffAddress || '').trim())?.dropoffAddress?.trim() || null;
    const officeFallbackHours = methods.find((m) => (m?.dropoffHours || '').trim())?.dropoffHours?.trim() || null;
    if (payMethod === 'cash') {
      const csh = methods.find((m) => m?.type === 'cash');
      // Which ways the DJ accepts cash: meet-up (default on) and office (default off).
      cashMeet = csh?.cashMeet !== false;
      cashOffice = csh?.cashOffice === true;
      cashPhone = cashMeet ? (csh?.handle?.trim() || null) : null;
      cashNightOf = csh?.cashNightOf === true;
      cashLeadWeeks = typeof csh?.cashLeadWeeks === 'number' ? csh.cashLeadWeeks : null;
      cashCanText = cashMeet && csh?.smsOk === true;
      dropoffAddress = cashOffice ? (csh?.dropoffAddress?.trim() || officeFallbackAddress) : null;
      dropoffHours = cashOffice ? (csh?.dropoffHours?.trim() || officeFallbackHours) : null;
    }
    if (payMethod === 'check') {
      const chk = methods.find((m) => m?.type === 'check');
      checkNightOf = chk?.checkNightOf === true;
      checkLeadWeeks = typeof chk?.checkLeadWeeks === 'number' ? chk!.checkLeadWeeks : null;
      checkPhone = chk?.checkPhone?.trim() || null;
      checkPayTo = chk?.handle?.trim() || null;
      checkAddressLines = chk?.contact ? splitMailAddress(chk.contact) : [];
      checkVerb = checkContactVerb({ checkCall: chk?.checkCall, checkText: chk?.checkText });
      checkMail = chk?.checkMail !== false;
      checkMeet = chk?.checkMeet === true;
      checkOffice = chk?.checkOffice === true;
      dropoffAddress = chk?.dropoffAddress?.trim() || officeFallbackAddress;
      dropoffHours = chk?.dropoffHours?.trim() || officeFallbackHours;
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
  // Same deadline math for a cash balance that must be dropped off ahead of time.
  let cashDeadline: string | null = null;
  if (payMethod === 'cash' && !cashNightOf && cashLeadWeeks && booking?.event_date) {
    const d = new Date(`${booking.event_date}T12:00:00`);
    if (!isNaN(d.getTime())) {
      d.setDate(d.getDate() - cashLeadWeeks * 7);
      cashDeadline = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
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
      initialChoice={pay.client_handoff as 'nightof' | 'meet' | 'office' | 'dropoff' | 'mail' | null}
      alreadyChosen={!!pay.marked_sent_at}
      djName={djName}
      cashPhone={cashPhone}
      cashNightOf={cashNightOf}
      cashDeadline={cashDeadline}
      cashLeadWeeks={cashLeadWeeks}
      cashCanText={cashCanText}
      cashMeet={cashMeet}
      cashOffice={cashOffice}
      depositLeadLabel={depositLeadLabel}
      dropoffAddressLines={dropoffAddress ? splitMailAddress(dropoffAddress) : []}
      dropoffHours={dropoffHours}
      checkNightOf={checkNightOf}
      checkDeadline={checkDeadline}
      checkLeadWeeks={checkLeadWeeks}
      checkPhone={checkPhone}
      checkPayTo={checkPayTo}
      checkAddressLines={checkAddressLines}
      checkContactVerb={checkVerb}
      checkCanMail={checkMail}
      checkCanDropoff={checkMeet || checkOffice}
      checkMeet={checkMeet}
      checkOffice={checkOffice}
      checkMemoLine={payMethod === 'check' ? checkMemo(booking?.event_date ?? null, booking?.venue_name ?? null, referenceCode(pay.booking_id, pay.kind)) : ''}
    />
  );
}
