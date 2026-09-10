// POST /api/paypal/connect
//
// A DJ links (or unlinks) their own PayPal business account so hosts can pay
// deposits/invoices by PayPal. MULTIPARTY (PayPal Commerce Platform): the DJ is
// the payee/merchant of record, the money settles in THEIR PayPal, and the
// platform takes NO fee and never holds funds — the same zero-cut rule as the
// Stripe card rail and every manual method.
//
// Onboarding uses PARTNER REFERRALS: POST /v2/customer/partner-referrals mints a
// hosted action_url; the DJ signs into their PayPal, grants us permission, and
// is redirected back. Afterwards we read the seller's integration status
// (payments_receivable + primary_email_confirmed) and cache paypal_connect_ready
// — the flag that decides whether hosts ever see a PayPal button.
//
// Actions:
//   start      → mint a fresh onboarding action_url (also how a DJ resumes).
//   status     → read the seller's PayPal integration status and cache it.
//                Accepts an optional { merchantId } captured from the return URL
//                (merchantIdInPayPal); otherwise uses the stored id.
//   disconnect → forget the merchant id on OUR side only. The DJ's PayPal is
//                their property — we never touch it.
//
// Like the Stripe route: NEVER return 502 (Cloudflare eats the body). 500 for
// upstream failures, 4xx where it fits, and JSON on every branch.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { paypalFetch, paypalConfigured } from '@/lib/paypal/server';
import { getActingContext, canBilling } from '@/lib/acting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE_URL = 'https://globaldjconnect.com';
const DEADLINE_MS = 8000;

interface ConnectRow {
  paypal_merchant_id: string | null;
  paypal_connect_ready: boolean | null;
  paypal_email: string | null;
}

function withDeadline<T>(p: PromiseLike<T>, label: string, ms = DEADLINE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s.`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

// The platform's own PayPal merchant id (the partner). Seller-status reads are
// scoped under it: /v1/customer/partners/{partnerId}/merchant-integrations/...
function partnerId(): string | null {
  return process.env.PAYPAL_MERCHANT_ID || null;
}

export async function POST(req: Request) {
  try {
    if (!paypalConfigured()) {
      return NextResponse.json({ error: 'PayPal is not configured yet.' }, { status: 500 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authErr } = await withDeadline(supabase.auth.getUser(), 'Auth check');
    if (authErr) return NextResponse.json({ error: `Auth: ${authErr.message}` }, { status: 401 });
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    // OWNER ONLY — connecting / disconnecting a PayPal merchant is a payout rail.
    const acting = await getActingContext(user.id);
    if (!canBilling(acting.role)) {
      return NextResponse.json({ error: 'Only the account owner can manage payouts.' }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
    const action = typeof body.action === 'string' ? body.action : '';

    let admin: ReturnType<typeof createAdminClient> | null = null;
    try { admin = createAdminClient(); } catch (e) {
      return NextResponse.json({ error: `Admin client: ${errMsg(e, 'could not initialise')}` }, { status: 500 });
    }
    if (!admin) return NextResponse.json({ error: 'Admin client unavailable.' }, { status: 500 });

    const { data: rowData, error: rowErr } = await withDeadline(
      admin.from('users').select('paypal_merchant_id, paypal_connect_ready, paypal_email').eq('id', user.id).maybeSingle(),
      'Database read',
    );
    if (rowErr) return NextResponse.json({ error: `DB: ${rowErr.message}` }, { status: 500 });
    const row = rowData as unknown as ConnectRow | null;
    if (!row) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });

    const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || SITE_URL;

    // ─────────────────────────────── start ───────────────────────────────
    if (action === 'start') {
      // tracking_id ties the referral back to this DJ so status lookups can find
      // the resulting merchant by our own user id.
      const referral = {
        tracking_id: user.id,
        operations: [{
          operation: 'API_INTEGRATION',
          api_integration_preference: {
            rest_api_integration: {
              integration_method: 'PAYPAL',
              integration_type: 'THIRD_PARTY',
              // PAYMENT + REFUND only — no PARTNER_FEE, because we take no cut.
              third_party_details: { features: ['PAYMENT', 'REFUND'] },
            },
          },
        }],
        products: ['EXPRESS_CHECKOUT'],
        legal_consents: [{ type: 'SHARE_DATA_CONSENT', granted: true }],
        partner_config_override: {
          return_url: `${origin}/booking-settings?paypal=connected`,
          return_url_description: 'Return to Global DJ Connect',
        },
      };
      let res;
      try {
        res = await withDeadline(
          paypalFetch<{ links?: { rel: string; href: string }[] }>('/v2/customer/partner-referrals', { method: 'POST', body: referral }),
          'PayPal partner referral',
        );
      } catch (e) {
        return NextResponse.json({ error: `PayPal (referral): ${errMsg(e, 'unknown error')}` }, { status: 500 });
      }
      if (!res.ok) {
        return NextResponse.json({ error: `PayPal (referral ${res.status}): ${JSON.stringify(res.data).slice(0, 300)}` }, { status: 500 });
      }
      const url = res.data.links?.find((l) => l.rel === 'action_url')?.href;
      if (!url) return NextResponse.json({ error: 'PayPal returned no onboarding link.' }, { status: 500 });
      return NextResponse.json({ url });
    }

    // ────────────────────────────── status ───────────────────────────────
    if (action === 'status') {
      const pid = partnerId();
      if (!pid) return NextResponse.json({ error: 'PAYPAL_MERCHANT_ID (partner id) is not set.' }, { status: 500 });

      // Merchant id from the return URL (merchantIdInPayPal) wins on first
      // connect; otherwise use the one we already stored.
      const merchantId = (typeof body.merchantId === 'string' && body.merchantId) || row.paypal_merchant_id || '';
      if (!merchantId) {
        return NextResponse.json({ connected: false, ready: false });
      }

      let res;
      try {
        res = await withDeadline(
          paypalFetch<{ payments_receivable?: boolean; primary_email_confirmed?: boolean; primary_email?: string; merchant_id?: string }>(
            `/v1/customer/partners/${encodeURIComponent(pid)}/merchant-integrations/${encodeURIComponent(merchantId)}`,
          ),
          'PayPal status',
        );
      } catch (e) {
        return NextResponse.json({ connected: true, ready: false, error: errMsg(e, 'Could not reach PayPal.') });
      }
      if (!res.ok) {
        return NextResponse.json({ connected: true, ready: false, error: `PayPal (${res.status})` });
      }

      const receivable = !!res.data.payments_receivable;
      const emailConfirmed = !!res.data.primary_email_confirmed;
      const ready = receivable && emailConfirmed;
      const email = res.data.primary_email || row.paypal_email || null;

      // Cache the merchant id + email + readiness so the host-facing PayPal
      // button and later order calls have what they need.
      await withDeadline(
        admin.from('users').update({
          paypal_merchant_id: merchantId,
          paypal_email: email,
          paypal_connect_ready: ready,
        } as unknown as never).eq('id', user.id),
        'Database write',
      );

      return NextResponse.json({
        connected: true,
        ready,
        paymentsReceivable: receivable,
        emailConfirmed,
        // When connected but not ready, one of these two is what PayPal is
        // waiting on — the UI can tell the DJ which.
        actionNeeded: !ready,
        email,
      });
    }

    // ──────────────────────────── disconnect ─────────────────────────────
    if (action === 'disconnect') {
      const { error } = await withDeadline(
        admin.from('users').update({
          paypal_merchant_id: null,
          paypal_connect_ready: false,
          paypal_email: null,
        } as unknown as never).eq('id', user.id),
        'Database write',
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    console.error('[paypal/connect] unhandled', e);
    return NextResponse.json({ error: `Server: ${errMsg(e, 'unexpected error')}` }, { status: 500 });
  }
}
