// Update-payment-method route — ON-SITE, no Stripe portal redirect.
//
// Creates a Stripe Checkout Session in `mode: 'setup'` using the SAME embedded
// UI the subscription checkout uses (ui_mode 'embedded_page' → returns a
// client_secret the front-end mounts in an on-page modal). The DJ enters a new
// card without ever leaving globaldjconnect.com; on completion Checkout returns
// to /subscribe/card-updated, which sets the new card as the default for the
// customer + their subscription (see that page).
//
// OWNER ONLY — billing belongs to the account owner, never a teammate.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/server';
import { getActingContext, canBilling } from '@/lib/acting';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const acting = await getActingContext(user.id);
  if (!canBilling(acting.role)) {
    return NextResponse.json({ error: 'Only the account owner can manage billing.' }, { status: 403 });
  }

  try {
    const admin = createAdminClient();
    const { data: rowData } = await admin
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();
    const customerId = (rowData as unknown as { stripe_customer_id: string | null } | null)?.stripe_customer_id || null;
    if (!customerId) {
      return NextResponse.json({ error: 'No subscription found for this account.' }, { status: 400 });
    }

    const origin =
      req.headers.get('origin') ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'https://globaldjconnect.com';

    const stripe = getStripe();
    // 'embedded_page' matches the subscription checkout on this account's pinned
    // API version (it rejects 'embedded'); it returns a client_secret to mount
    // in the on-site modal. On completion Checkout returns to the URL below.
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      ui_mode: 'embedded_page' as unknown as 'embedded',
      // Setup-mode embedded sessions require a currency (nominal — no charge is
      // made; it only sets up the card as the customer's saved payment method).
      currency: 'usd',
      customer: customerId,
      return_url: `${origin}/subscribe/card-updated?session_id={CHECKOUT_SESSION_ID}`,
    });

    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (e) {
    // Surface Stripe's reason (owner-only route) — same handling as the portal,
    // so a stale/test customer or config issue is diagnosable.
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Could not start card update: ${detail}` }, { status: 500 });
  }
}
