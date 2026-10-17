// POST /api/paypal/create-order  { paymentId }
//
// Public (no login) — the pay page calls this to open a PayPal order for a
// booking_payment. MULTIPARTY: the order's payee is the DJ's connected merchant,
// so the money is captured into the DJ's PayPal, not ours. custom_id carries the
// payment id so the capture + webhook can mark the right row paid.
//
// Returns { id } (the PayPal order id) for the JS SDK's createOrder, or
// { error } with a non-502 status (Cloudflare eats 502 bodies — see the Stripe
// connect route for the full story).

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { paypalFetch, paypalConfigured } from '@/lib/paypal/server';
import { referenceCode } from '@/lib/paymentMethods';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const round2 = (n: number) => Number(n.toFixed(2));

interface PaymentRow {
  id: string; booking_id: string; kind: string;
  amount: number; amount_paid: number | null; currency: string | null; status: string;
}
interface BookingRow { id: string; dj_id: string | null; currency: string | null; }
interface DjRow { paypal_merchant_id: string | null; paypal_connect_ready: boolean | null; name: string | null; }

export async function POST(req: Request) {
  try {
    if (!paypalConfigured()) return NextResponse.json({ error: 'PayPal is not configured.' }, { status: 500 });

    let body: { paymentId?: unknown };
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
    const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
    if (!paymentId) return NextResponse.json({ error: 'Missing paymentId' }, { status: 400 });

    const db = createAdminClient() as unknown as SupabaseClient;

    const { data: pData } = await db
      .from('booking_payments')
      .select('id, booking_id, kind, amount, amount_paid, currency, status')
      .eq('id', paymentId).maybeSingle();
    const p = pData as PaymentRow | null;
    if (!p) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });
    if (p.status === 'paid' || p.status === 'waived') return NextResponse.json({ error: 'Already settled.' }, { status: 409 });

    const { data: bData } = await db.from('bookings').select('id, dj_id, currency').eq('id', p.booking_id).maybeSingle();
    const b = bData as BookingRow | null;
    if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });

    const { data: djData } = b.dj_id
      ? await db.from('users').select('paypal_merchant_id, paypal_connect_ready, name').eq('id', b.dj_id).maybeSingle()
      : { data: null };
    const dj = djData as unknown as DjRow | null;
    if (!dj?.paypal_merchant_id || !dj.paypal_connect_ready) {
      return NextResponse.json({ error: 'This DJ has not finished connecting PayPal.' }, { status: 409 });
    }

    const outstanding = round2(Math.max(0, Number(p.amount) - Number(p.amount_paid || 0)));
    if (!(outstanding > 0)) return NextResponse.json({ error: 'Nothing left to pay.' }, { status: 409 });

    const cur = (p.currency || b.currency || 'USD').toUpperCase();
    const reference = referenceCode(p.booking_id, p.kind);
    const noun = p.kind === 'balance' ? 'Balance' : p.kind === 'deposit' ? 'Deposit' : 'Payment';

    // invoice_id must be UNIQUE per order. The old scheme reused a short, stable
    // per-row code as a duplicate-payment guard, but (a) only 4 hex chars means
    // two different bookings collide at a few hundred rows (PayPal then rejects a
    // legitimate host with DUPLICATE_INVOICE_ID), and (b) it blocks a legitimate
    // re-payment after a refund. Double-payment is already prevented by the row
    // claim + the paypal_capture_id guard in capture-order, so we make this
    // unique per order (payment id + a base-36 timestamp) and keep the readable
    // code in the description. Stays well under PayPal's 127-char limit.
    const invoiceId = `${p.id}-${Date.now().toString(36)}`;

    const order = {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: cur, value: outstanding.toFixed(2) },
        // payee = the DJ's connected merchant → money lands in THEIR PayPal.
        payee: { merchant_id: dj.paypal_merchant_id },
        // custom_id ties the capture/webhook back to this payment row.
        custom_id: p.id,
        invoice_id: invoiceId,
        description: `${noun} ${reference} — ${dj.name || 'DJ'}`.slice(0, 127),
      }],
    };

    // onBehalfOf so the order is created for the DJ's account (their settings,
    // their branding) — consistent with the capture call.
    const res = await paypalFetch<{ id?: string }>('/v2/checkout/orders', { method: 'POST', body: order, onBehalfOf: dj.paypal_merchant_id });
    if (!res.ok || !res.data.id) {
      return NextResponse.json({ error: `PayPal (order ${res.status}): ${JSON.stringify(res.data).slice(0, 300)}` }, { status: 500 });
    }
    return NextResponse.json({ id: res.data.id });
  } catch (e) {
    console.error('[paypal/create-order]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
