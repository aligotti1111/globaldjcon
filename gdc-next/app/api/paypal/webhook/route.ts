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
  custom_id?: string;
  amount?: { value?: string };
}
interface WebhookEvent {
  event_type?: string;
  resource?: CaptureResource;
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

    // Only the "money captured" event marks a payment paid.
    if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
      return NextResponse.json({ ok: true, ignored: event.event_type || 'unknown' });
    }

    const paymentId = event.resource?.custom_id || '';
    if (!paymentId) return NextResponse.json({ ok: true, reason: 'no_custom_id' });

    const db = createAdminClient() as unknown as SupabaseClient;
    const { data: pData } = await db
      .from('booking_payments')
      .select('id, amount, amount_paid, status')
      .eq('id', paymentId).maybeSingle();
    const p = pData as { id: string; amount: number; amount_paid: number | null; status: string } | null;
    if (!p) return NextResponse.json({ ok: true, reason: 'payment_not_found' });
    if (p.status === 'paid' || p.status === 'waived') return NextResponse.json({ ok: true, alreadyPaid: true });

    const capturedStr = event.resource?.amount?.value;
    const captured = capturedStr != null ? Number(capturedStr) : round2(Math.max(0, Number(p.amount) - Number(p.amount_paid || 0)));
    const nextPaid = round2(Number(p.amount_paid || 0) + captured);
    const status = nextPaid >= Number(p.amount) - 0.01 ? 'paid' : 'partial';

    await db
      .from('booking_payments')
      .update({ amount_paid: nextPaid, status, method: 'paypal', confirmed_at: new Date().toISOString() } as unknown as never)
      .eq('id', p.id);

    return NextResponse.json({ ok: true, status });
  } catch (e) {
    console.error('[paypal/webhook]', e);
    return NextResponse.json({ ok: false, reason: 'error' });
  }
}
