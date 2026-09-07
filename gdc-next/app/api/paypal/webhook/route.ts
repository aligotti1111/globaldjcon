// POST /api/paypal/webhook
//
// PayPal calls this when a capture completes (and on refunds). It's the backstop
// that guarantees a booking_payment flips to paid even if the browser closed
// before /api/paypal/capture-order returned. Both paths are idempotent — a row
// already 'paid' is left alone.
//
// SECURITY: every event is verified against PayPal before we act on it, using
// /v1/notifications/verify-webhook-signature + PAYPAL_WEBHOOK_ID. An unverified
// or unconfigured event is acknowledged (200) but never processed, so a spoofed
// POST can't mark anything paid.
//
// custom_id on the capture resource is the booking_payment id we set when the
// order was created.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { paypalFetch, paypalConfigured } from '@/lib/paypal/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const round2 = (n: number) => Number(n.toFixed(2));

interface CaptureResource {
  id?: string;
  status?: string;
  custom_id?: string;
  amount?: { value?: string; currency_code?: string };
}
interface WebhookEvent {
  event_type?: string;
  resource?: CaptureResource;
}

interface PayRow {
  id: string;
  amount: number;
  amount_paid: number | null;
  status: string;
  currency: string | null;
}

export async function POST(req: Request) {
  // Always 200 so PayPal doesn't retry-storm us on our own bugs; the body says
  // what happened.
  try {
    const raw = await req.text();
    if (!paypalConfigured() || !process.env.PAYPAL_WEBHOOK_ID) {
      return NextResponse.json({ ok: false, reason: 'not_configured' });
    }

    let event: WebhookEvent;
    try { event = JSON.parse(raw) as WebhookEvent; } catch { return NextResponse.json({ ok: false, reason: 'bad_json' }); }

    // ── Verify the signature against PayPal ──
    const h = req.headers;
    const verifyBody = {
      auth_algo: h.get('paypal-auth-algo'),
      cert_url: h.get('paypal-cert-url'),
      transmission_id: h.get('paypal-transmission-id'),
      transmission_sig: h.get('paypal-transmission-sig'),
      transmission_time: h.get('paypal-transmission-time'),
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    };
    const verify = await paypalFetch<{ verification_status?: string }>(
      '/v1/notifications/verify-webhook-signature',
      { method: 'POST', body: verifyBody },
    );
    if (!verify.ok || verify.data.verification_status !== 'SUCCESS') {
      return NextResponse.json({ ok: false, reason: 'verification_failed' });
    }

    const type = event.event_type || '';
    const resource = event.resource || {};
    const db = createAdminClient() as unknown as SupabaseClient;

    // ── Refund / reversal: money went back to the buyer ──
    if (type === 'PAYMENT.CAPTURE.REFUNDED' || type === 'PAYMENT.CAPTURE.REVERSED') {
      const paymentId = resource.custom_id || '';
      if (!paymentId) return NextResponse.json({ ok: true, reason: 'no_custom_id' });
      const { data: pData, error: selErr } = await db
        .from('booking_payments')
        .select('id, amount, amount_paid, status, currency')
        .eq('id', paymentId).maybeSingle();
      if (selErr) return NextResponse.json({ ok: false, reason: 'db_error' }, { status: 500 });
      const p = pData as PayRow | null;
      if (!p) return NextResponse.json({ ok: true, reason: 'payment_not_found' });
      const refunded = Number(resource.amount?.value ?? 0);
      const nextPaid = round2(Math.max(0, Number(p.amount_paid || 0) - refunded));
      const status = nextPaid <= 0.01 ? 'pending' : nextPaid >= Number(p.amount) - 0.01 ? 'paid' : 'partial';
      const { error: upErr } = await db
        .from('booking_payments')
        .update({ amount_paid: nextPaid, status } as unknown as never)
        .eq('id', p.id);
      if (upErr) return NextResponse.json({ ok: false, reason: 'db_error' }, { status: 500 });
      return NextResponse.json({ ok: true, refunded: true, status });
    }

    // ── Capture denied after a pending hold: undo any paid mark from it ──
    if (type === 'PAYMENT.CAPTURE.DENIED') {
      const capId = resource.id || '';
      if (!capId) return NextResponse.json({ ok: true, reason: 'no_capture_id' });
      const { data: pData, error: selErr } = await db
        .from('booking_payments')
        .select('id, amount, amount_paid, status, currency')
        .eq('paypal_capture_id', capId).maybeSingle();
      if (selErr) return NextResponse.json({ ok: false, reason: 'db_error' }, { status: 500 });
      const p = pData as PayRow | null;
      if (!p) return NextResponse.json({ ok: true, reason: 'no_matching_capture' });
      const denied = Number(resource.amount?.value ?? p.amount_paid ?? 0);
      const nextPaid = round2(Math.max(0, Number(p.amount_paid || 0) - denied));
      const status = nextPaid <= 0.01 ? 'pending' : nextPaid >= Number(p.amount) - 0.01 ? 'paid' : 'partial';
      const { error: upErr } = await db
        .from('booking_payments')
        .update({ amount_paid: nextPaid, status, paypal_capture_id: null } as unknown as never)
        .eq('id', p.id);
      if (upErr) return NextResponse.json({ ok: false, reason: 'db_error' }, { status: 500 });
      return NextResponse.json({ ok: true, denied: true, status });
    }

    // Only the "money captured" event marks a payment paid.
    if (type !== 'PAYMENT.CAPTURE.COMPLETED') {
      return NextResponse.json({ ok: true, ignored: type || 'unknown' });
    }
    // A COMPLETED order can carry a still-pending capture — only a COMPLETED
    // capture is settled money.
    if (resource.status && resource.status !== 'COMPLETED') {
      return NextResponse.json({ ok: true, reason: 'capture_not_completed', captureStatus: resource.status });
    }

    const paymentId = resource.custom_id || '';
    if (!paymentId) return NextResponse.json({ ok: true, reason: 'no_custom_id' });

    const { data: pData, error: selErr } = await db
      .from('booking_payments')
      .select('id, amount, amount_paid, status, currency')
      .eq('id', paymentId).maybeSingle();
    if (selErr) return NextResponse.json({ ok: false, reason: 'db_error' }, { status: 500 });
    const p = pData as PayRow | null;
    if (!p) return NextResponse.json({ ok: true, reason: 'payment_not_found' });
    if (p.status === 'paid' || p.status === 'waived') return NextResponse.json({ ok: true, alreadyPaid: true });

    // Currency sanity — a mismatched capture isn't for this row.
    const capCur = (resource.amount?.currency_code || '').toUpperCase();
    if (capCur && p.currency && capCur !== p.currency.toUpperCase()) {
      return NextResponse.json({ ok: true, reason: 'currency_mismatch' });
    }

    const capturedStr = resource.amount?.value;
    const captured = capturedStr != null ? Number(capturedStr) : round2(Math.max(0, Number(p.amount) - Number(p.amount_paid || 0)));
    const nextPaid = round2(Number(p.amount_paid || 0) + captured);
    const status = nextPaid >= Number(p.amount) - 0.01 ? 'paid' : 'partial';
    const captureId = resource.id || null;

    // Idempotent on the capture id: if the capture route already recorded this
    // exact capture, the guard makes this a no-op — the money is never counted
    // twice, no matter which path wins the race.
    const { data: upData, error: upErr } = await db
      .from('booking_payments')
      .update({ amount_paid: nextPaid, status, method: 'paypal', confirmed_at: new Date().toISOString(), paypal_capture_id: captureId } as unknown as never)
      .eq('id', p.id)
      .is('paypal_capture_id', null)
      .select('id');
    // A real DB failure returns 500 so PayPal RETRIES (it backs off for ~3
    // days) — the webhook is the backstop, so it must not silently 200 on error.
    if (upErr) return NextResponse.json({ ok: false, reason: 'db_error' }, { status: 500 });
    if (!Array.isArray(upData) || upData.length === 0) {
      return NextResponse.json({ ok: true, alreadyPaid: true });
    }

    return NextResponse.json({ ok: true, status });
  } catch (e) {
    console.error('[paypal/webhook]', e);
    // 500 → PayPal retries. An empty-bodied 5xx is fine here: this is OUR
    // endpoint returning a real status code, not an upstream 502 whose body
    // Cloudflare would eat.
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
