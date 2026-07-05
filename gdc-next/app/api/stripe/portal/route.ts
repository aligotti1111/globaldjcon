// Stripe Customer Portal route.
//
// POST here to get a link to Stripe's hosted subscription-management page,
// where a DJ can cancel, switch plan, or update their card. Stripe hosts the
// entire UI — we just create a portal session for the logged-in user's Stripe
// customer and return its URL for the client to redirect to.
//
// Cancels/changes made in the portal fire the same webhooks as everything
// else (customer.subscription.updated / deleted), so the tier/status on the
// user stays in sync automatically.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  // Must be signed in.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  try {
    const admin = createAdminClient();

    // Find the user's Stripe customer id (set during their first checkout).
    const { data: rowData } = await admin
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();
    const row = rowData as unknown as { stripe_customer_id: string | null } | null;
    const customerId = row?.stripe_customer_id || null;

    if (!customerId) {
      return NextResponse.json(
        { error: 'No subscription found for this account.' },
        { status: 400 }
      );
    }

    const origin =
      req.headers.get('origin') ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'https://globaldjconnect.com';

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/subscribe`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[stripe/portal] error', e);
    return NextResponse.json({ error: 'Could not open billing portal' }, { status: 500 });
  }
}
