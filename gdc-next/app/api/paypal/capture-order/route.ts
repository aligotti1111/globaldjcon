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
  paypal_order_id?: string | null;
}
interface BookingRow { id: string; dj_id: string | null; currency: string | null; }
interface DjRow { paypal_merchant_id: string | null; }

interface CaptureObj {
  id?: string;
  status?: string;
  custom_id?: string;
  amount?: { value?: string; currency_code?: string };
}
interface OrderResp {
  id?: string;
  status?: string;
  purchase_units?: {
    custom_id?: string;
    amount?: { value?: string; currency_code?: string };
    payee?: { merchant_id?: string };
    payments?: { captures?: CaptureObj[] };
  }[];
}

// Pull PayPal's machine-readable issue code out of an error body, wherever it
// put it this time.
function issueOf(data: unknown): string {
  const d = data as { name?: string; details?: { issue?: string }[] } | null;
  return d?.details?.[0]?.issue || d?.name || '';
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
      .select('id, booking_id, kind, amount, amount_paid, currency, status, paypal_order_id')
      .eq('id', paymentId).maybeSingle();
    const p = pData as PaymentRow | null;
    if (!p) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });
    // Idempotent: already settled → success, don't double-capture.
    if (p.status === 'paid' || p.status === 'waived') return NextResponse.json({ ok: true, alreadyPaid: true });

    // DJ merchant, to capture on their behalf. Never capture without it — a
    // capture with no auth-assertion would post against the wrong account.
    const { data: bData } = await db.from('bookings').select('id, dj_id, currency').eq('id', p.booking_id).maybeSingle();
    const b = bData as BookingRow | null;
    const djId = b?.dj_id || null;
    const { data: djData } = djId
      ? await db.from('users').select('paypal_merchant_id').eq('id', djId).maybeSingle()
      : { data: null };
    const merchant = (djData as unknown as DjRow | null)?.paypal_merchant_id || '';
    if (!merchant) return NextResponse.json({ error: 'This DJ is not connected to PayPal.' }, { status: 409 });

    const cur = (p.currency || b?.currency || 'USD').toUpperCase();
    const outstanding = round2(Math.max(0, Number(p.amount) - Number(p.amount_paid || 0)));

    // ── Verify the order BEFORE capturing (money hasn't moved yet) ──
    // Confirms the client-supplied orderId actually belongs to THIS payment,
    // is payable to THIS DJ, for the right amount and currency, and is ready to
    // capture. Without this a caller could capture someone else's order through
    // this payment's id.
    const look = await paypalFetch<OrderResp>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { onBehalfOf: merchant });
    if (!look.ok) {
      return NextResponse.json({ error: `PayPal (order ${look.status}): ${JSON.stringify(look.data).slice(0, 200)}` }, { status: 502 });
    }
    const opu = look.data.purchase_units?.[0];
    if ((opu?.custom_id || '') !== p.id) {
      return NextResponse.json({ error: 'Order does not match this payment.' }, { status: 409 });
    }
    if ((opu?.payee?.merchant_id || '') !== merchant) {
      return NextResponse.json({ error: 'Order is not payable to this DJ.' }, { status: 409 });
    }
    if ((opu?.amount?.currency_code || '').toUpperCase() !== cur || round2(Number(opu?.amount?.value)) !== outstanding) {
      return NextResponse.json({ error: 'Order amount does not match the request.' }, { status: 409 });
    }

    // ── Claim the row so two tabs / a retried approval can't both capture ──
    // First writer sets paypal_order_id; the loser gets 0 rows. A retry of the
    // SAME order is allowed to proceed (it's the same money, and PayPal itself
    // rejects a genuine double-capture below).
    const { data: claimData } = await db
      .from('booking_payments')
      .update({ paypal_order_id: orderId } as unknown as never)
      .eq('id', p.id)
      .is('paypal_order_id', null)
      .select('id');
    const claimed = Array.isArray(claimData) && claimData.length > 0;
    if (!claimed && (p.paypal_order_id || '') !== orderId) {
      return NextResponse.json({ error: 'A payment is already in progress for this request.' }, { status: 409 });
    }

    // ── Capture (idempotency key so PayPal dedupes our own retries) ──
    const res = await paypalFetch<OrderResp>(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      { method: 'POST', body: {}, onBehalfOf: merchant, headers: { 'PayPal-Request-Id': `cap-${p.id}-${orderId}` } },
    );

    // Already captured (a retry after a dropped connection): the money moved on
    // the first attempt — GET the order and settle from that instead of 500ing
    // a host who was, in fact, charged.
    let orderData = res.data;
    if (!res.ok) {
      if (issueOf(res.data) === 'ORDER_ALREADY_CAPTURED') {
        const re = await paypalFetch<OrderResp>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { onBehalfOf: merchant });
        if (!re.ok) return NextResponse.json({ error: `PayPal (recheck ${re.status})` }, { status: 502 });
        orderData = re.data;
      } else {
        return NextResponse.json({ error: `PayPal (capture ${res.status}): ${JSON.stringify(res.data).slice(0, 300)}` }, { status: 502 });
      }
    }

    const cap = orderData.purchase_units?.[0]?.payments?.captures?.[0];
    // Defense in depth: the capture must carry our payment's custom_id.
    if (cap?.custom_id && cap.custom_id !== p.id) {
      return NextResponse.json({ error: 'Capture does not match this payment.' }, { status: 409 });
    }

    const captureId = cap?.id || null;
    const capStatus = cap?.status || '';

    // A COMPLETED order can hold a PENDING capture (eCheck, review holds). Money
    // has NOT settled — don't mark paid; the PAYMENT.CAPTURE.COMPLETED webhook
    // finalizes it (and PAYMENT.CAPTURE.DENIED clears it). Only COMPLETED here.
    if (capStatus !== 'COMPLETED') {
      return NextResponse.json({ ok: true, pending: true, captureStatus: capStatus || 'UNKNOWN' });
    }

    const capturedStr = cap?.amount?.value;
    const captured = capturedStr != null ? Number(capturedStr) : outstanding;
    const nextPaid = round2(Number(p.amount_paid || 0) + captured);
    const status = nextPaid >= Number(p.amount) - 0.01 ? 'paid' : 'partial';

    // Idempotent on the capture id: if this capture was already recorded (by a
    // retry or the webhook winning the race), the guard makes the update a
    // no-op and we report success without adding the money twice.
    const { data: upData, error: upErr } = await db
      .from('booking_payments')
      .update({ amount_paid: nextPaid, status, method: 'paypal', confirmed_at: new Date().toISOString(), paypal_capture_id: captureId } as unknown as never)
      .eq('id', p.id)
      .is('paypal_capture_id', null)
      .select('id');
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (!Array.isArray(upData) || upData.length === 0) {
      return NextResponse.json({ ok: true, alreadyPaid: true });
    }

    return NextResponse.json({ ok: true, status });
  } catch (e) {
    console.error('[paypal/capture-order]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
