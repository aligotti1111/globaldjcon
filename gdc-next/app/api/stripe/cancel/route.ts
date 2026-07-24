// POST /api/stripe/cancel   { action?: 'cancel' | 'resume' }
//
// On-site subscription cancel / resume — no Stripe-hosted portal.
//   cancel → sets cancel_at_period_end = true. The DJ KEEPS full access until
//            the end of the period they already paid for; at that point Stripe
//            fires customer.subscription.deleted and the webhook lapses them.
//   resume → clears cancel_at_period_end (undo a scheduled cancel).
//
// Returns { ok, cancelAtPeriodEnd, periodEnd } so the page can show
// "set to cancel on <date>" without a round-trip.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { action?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const resume = body.action === 'resume';

  const admin = createAdminClient();
  const { data: rowData } = await admin
    .from('users')
    .select('stripe_subscription_id')
    .eq('id', user.id)
    .maybeSingle();
  const subId = (rowData as unknown as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id || null;
  if (!subId) {
    return NextResponse.json({ error: 'No active subscription found.' }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.update(subId, { cancel_at_period_end: !resume });
    const periodEndUnix = sub.items?.data?.[0]?.current_period_end;
    const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;
    return NextResponse.json({ ok: true, cancelAtPeriodEnd: !resume, periodEnd });
  } catch (e) {
    console.error('[stripe/cancel] error', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not update your subscription.' },
      { status: 500 },
    );
  }
}
