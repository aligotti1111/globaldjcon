// /pay/[id] — the payment HUB.
//
// WHY THIS PAGE EXISTS
// The deposit/invoice email lists every way a DJ accepts money. But a DJ often
// wants to just TEXT a client "here's how to pay" — and a text can't carry an
// email's stack of buttons. This one short link does: it opens a page showing
// EVERY option the DJ has enabled, and each one hands off correctly (card →
// Stripe Checkout, PayPal → the PayPal page, Venmo/Cash App → their app pages,
// Zelle/cash/check → copy-and-instructions). One URL, textable, complete.
//
// It mirrors the email exactly (same usableMethods, same connect gating) so the
// two never drift. Card comes first when Stripe is on; connected PayPal replaces
// the manual PayPal row; everything else follows in the module's display order.
//
// NO LOGIN. Clients have no accounts. The payment id is an unguessable UUID — a
// capability URL, the same exposure the email already carries. Admin read only:
// no writes, opening the link is never treated as payment. Only the DJ
// confirming what actually arrived settles the ledger.

import { notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  usableMethods,
  buildPayLink,
  referenceCode,
  displayHandle,
  copyInstruction,
  cashLine,
  cashDropoff,
  checkMemo,
  isLinkable,
  METHOD_TYPES,
  type PaymentMethod,
  type PaymentMethodType,
} from '@/lib/paymentMethods';
import PayHub, { type HubOption } from './PayHub';

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

// Brand accent per rail — the little dot beside each option.
const ACCENT: Partial<Record<PaymentMethodType | 'card', string>> = {
  card: '#635BFF',
  paypal: '#0070ba',
  venmo: '#3D95CE',
  cashapp: '#00D632',
  zelle: '#6D1ED4',
  cash: '#2E7D32',
  check: '#455A64',
  other: '#8a8aa0',
};

export default async function PayHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const admin = createAdminClient();
  // booking_payments predates the generated types, so the typed client rejects
  // .from('booking_payments'). One cast, same house pattern as /api/payments.
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
    .select('name, payment_methods, stripe_connect_ready, paypal_connect_ready')
    .eq('id', booking.dj_id)
    .maybeSingle();
  const dj = djData as unknown as {
    name: string | null;
    payment_methods?: unknown;
    stripe_connect_ready?: boolean | null;
    paypal_connect_ready?: boolean | null;
  } | null;

  const cardReady = !!dj?.stripe_connect_ready;
  const paypalReady = !!dj?.paypal_connect_ready;
  const methods = usableMethods(
    (Array.isArray(dj?.payment_methods) ? dj?.payment_methods : []) as PaymentMethod[],
  );

  // Nothing to offer at all — the DJ turned everything off since sending.
  if (methods.length === 0 && !cardReady && !paypalReady) notFound();

  // What's actually left — not the original ask. A client who already sent part
  // of it must not be shown the full amount again.
  const outstanding = Math.max(
    0,
    Math.round((Number(pay.amount) - Number(pay.amount_paid || 0)) * 100) / 100,
  );
  const settled = pay.status === 'paid' || pay.status === 'waived' || outstanding <= 0;
  const reference = referenceCode(pay.booking_id, pay.kind);

  // ── Build the option list, in the same order as the email ──
  const options: HubOption[] = [];

  // Card first, when Stripe is live. No static link — the button page mints a
  // Checkout session server-side.
  if (cardReady) {
    options.push({
      type: 'card',
      label: 'Debit or credit card',
      sub: 'Visa · Mastercard · Amex — confirms instantly',
      href: `/pay/${pay.id}/card`,
      linkLabel: 'Pay by card',
      accent: ACCENT.card!,
    });
  }

  // Connected PayPal replaces the manual PayPal row entirely.
  if (paypalReady) {
    options.push({
      type: 'paypal',
      label: 'PayPal',
      sub: 'Pay with your PayPal balance, bank, or card',
      href: `/pay/${pay.id}/paypal`,
      linkLabel: 'Pay with PayPal',
      accent: ACCENT.paypal!,
    });
  }

  for (const m of methods) {
    // Manual PayPal is superseded by the connected button above.
    if (m.type === 'paypal' && paypalReady) continue;

    const label = METHOD_TYPES[m.type]?.label || m.type;
    const accent = ACCENT[m.type] || ACCENT.other!;

    if (m.type === 'venmo') {
      options.push({ type: 'venmo', label: 'Venmo', sub: displayHandle(m), href: `/pay/${pay.id}/venmo`, linkLabel: 'Pay with Venmo', accent });
      continue;
    }
    if (m.type === 'cashapp') {
      options.push({ type: 'cashapp', label: 'Cash App', sub: displayHandle(m), href: `/pay/${pay.id}/cashapp`, linkLabel: 'Pay with Cash App', accent });
      continue;
    }
    if (m.type === 'paypal') {
      // Manual PayPal (DJ gave a PayPal.me link or a bare email).
      const link = isLinkable(m) ? buildPayLink(m, outstanding, reference) : null;
      if (link) {
        options.push({ type: 'paypal', label: 'PayPal', sub: displayHandle(m), href: link, external: true, linkLabel: 'Pay with PayPal', accent });
      } else {
        options.push({ type: 'paypal', label: 'PayPal', instruction: copyInstruction(m), copy: displayHandle(m), accent });
      }
      continue;
    }
    if (m.type === 'zelle') {
      options.push({ type: 'zelle', label: 'Zelle', instruction: copyInstruction(m), copy: displayHandle(m), accent });
      continue;
    }
    if (m.type === 'cash') {
      const lines = [cashLine(m)];
      const drop = cashDropoff(m);
      if (drop) lines.push(`Or drop it at: ${drop}`);
      options.push({ type: 'cash', label: 'Cash', lines, accent });
      continue;
    }
    if (m.type === 'check') {
      const lines: string[] = [];
      if (m.contact) lines.push(`Mail to: ${m.contact}`);
      lines.push(`Include: ${checkMemo(booking.event_date, booking.venue_name, reference)}`);
      options.push({
        type: 'check',
        label: 'Check',
        instruction: copyInstruction(m),
        copy: m.handle,
        lines,
        secondary: { href: `/pay/${pay.id}/check-sent`, label: 'Mailed it? Let your DJ know →' },
        accent,
      });
      continue;
    }
    // other
    options.push({ type: 'other', label, lines: m.note ? [m.note] : [m.handle], accent });
  }

  return (
    <PayHub
      amount={outstanding}
      currency={pay.currency || 'USD'}
      djName={dj?.name || 'your DJ'}
      kind={pay.kind}
      reference={reference}
      settled={settled}
      venueName={booking.venue_name}
      eventDate={booking.event_date}
      options={options}
    />
  );
}
