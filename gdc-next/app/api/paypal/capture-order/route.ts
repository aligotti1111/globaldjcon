// POST /api/paypal/capture-order  { paymentId, orderId }
//
// Public (no login) — the pay page's onApprove calls this to capture the PayPal
// order and mark the booking_payment paid. Captured on behalf of the DJ's
// merchant (multiparty), so the funds land in the DJ's PayPal. The webhook
// (PAYMENT.CAPTURE.COMPLETED) is the backstop that also marks paid, so both are
// written to be idempotent: a row already 'paid' is left alone.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { paypalFetch, paypalConfigured } from '@/lib/paypal/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const round2 = (n: number) => Number(n.toFixed(2));

interface PaymentRow {
  id: string; booking_id: string; kind: string;
  amount: number; amount_paid: number | null; currency: string | null; status: string;
}
interface DjRow { paypal_merchant_id: string | null; }

interface CaptureResp {
  status?: string;
  purchase_units?: {
    custom_id?: string;
    payments?: { captures?: { amount?: { value?: string } }[] };
  }[];
}

export async function POST(req: Request) {
  try {
    if (!paypalConfigured()) return NextResponse.json({ error: 'PayPal is not configured.' }, { status: 500 });

    let body: { paymentId?: unknown; orderId?: unknown };
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
    const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
    const orderId = typeof body.orderId === 'string' ? body.orderId : '';
    if (!paymentId || !orderId) return NextResponse.json({ error: 'Missing paymentId or orderId' }, { status: 400 });

    const db = createAdminClient() as unknown as SupabaseClient;

    const { data: pData } = await db
      .from('booking_payments')
      .select('id, booking_id, kind, amount, amount_paid, currency, status')
      .eq('id', paymentId).maybeSingle();
    const p = pData as PaymentRow | null;
    if (!p) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });
    // Idempotent: already settled → success, don't double-capture.
    if (p.status === 'paid' || p.status === 'waived') return NextResponse.json({ ok: true, alreadyPaid: true });

    // DJ merchant, to capture on their behalf.
    const { data: bData } = await db.from('bookings').select('dj_id').eq('id', p.booking_id).maybeSingle();
    const djId = (bData as { dj_id: string | null } | null)?.dj_id || null;
    const { data: djData } = djId
      ? await db.from('users').select('paypal_merchant_id').eq('id', djId).maybeSingle()
      : { data: null };
    const merchant = (djData as unknown as DjRow | null)?.paypal_merchant_id || undefined;

    const res = await paypalFetch<CaptureResp>(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      { method: 'POST', body: {}, onBehalfOf: merchant },
    );
    if (!res.ok || res.data.status !== 'COMPLETED') {
      return NextResponse.json({ error: `PayPal (capture ${res.status}): ${JSON.stringify(res.data).slice(0, 300)}` }, { status: 500 });
    }

    // Safety: the order's custom_id must match the payment we're settling.
    const pu = res.data.purchase_units?.[0];
    if (pu?.custom_id && pu.custom_id !== p.id) {
      return NextResponse.json({ error: 'Order does not match this payment.' }, { status: 409 });
    }

    const capturedStr = pu?.payments?.captures?.[0]?.amount?.value;
    const captured = capturedStr != null ? Number(capturedStr) : round2(Math.max(0, Number(p.amount) - Number(p.amount_paid || 0)));
    const nextPaid = round2(Number(p.amount_paid || 0) + captured);
    const status = nextPaid >= Number(p.amount) - 0.01 ? 'paid' : 'partial';

    const { error: upErr } = await db
      .from('booking_payments')
      .update({ amount_paid: nextPaid, status, method: 'paypal', confirmed_at: new Date().toISOString() } as unknown as never)
      .eq('id', p.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, status });
  } catch (e) {
    console.error('[paypal/capture-order]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
