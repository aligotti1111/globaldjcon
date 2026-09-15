// /subscribe/card-updated — where the on-site "Update payment method" embedded
// setup returns after the DJ enters a new card. Retrieves the setup session,
// grabs the new payment method, and makes it the DEFAULT for the customer AND
// their active subscription(s) — so the next invoice charges the new card.
// Never touches Stripe's hosted portal.

import Link from 'next/link';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/server';

export const dynamic = 'force-dynamic';

export default async function CardUpdatedPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;

  let updated = false;
  if (session_id) {
    try {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['setup_intent'],
      });

      const si = session.setup_intent as Stripe.SetupIntent | null;
      const pm =
        typeof si?.payment_method === 'string'
          ? si.payment_method
          : si?.payment_method?.id ?? null;
      const customer =
        typeof session.customer === 'string'
          ? session.customer
          : session.customer?.id ?? null;

      if (session.status === 'complete' && pm && customer) {
        // Make the new card the default for future invoices.
        await stripe.customers.update(customer, {
          invoice_settings: { default_payment_method: pm },
        });
        // And on every live subscription, so renewals bill the new card.
        const subs = await stripe.subscriptions.list({ customer, status: 'all', limit: 20 });
        for (const s of subs.data) {
          if (['active', 'trialing', 'past_due', 'unpaid'].includes(s.status)) {
            await stripe.subscriptions.update(s.id, { default_payment_method: pm });
          }
        }
        updated = true;
      }
    } catch {
      updated = false;
    }
  }

  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
      <div
        style={{
          maxWidth: 460, width: '100%', textAlign: 'center',
          border: '1px solid rgba(255,255,255,.12)', borderRadius: 14,
          padding: '2.5rem 1.75rem', background: 'rgba(255,255,255,.02)',
        }}
      >
        {updated ? (
          <>
            <div style={{ fontSize: '2.5rem', marginBottom: '.5rem' }}>✓</div>
            <h1 style={{ fontSize: '1.6rem', marginBottom: '.5rem', color: 'var(--white,#fff)' }}>
              Payment method updated
            </h1>
            <p style={{ color: 'var(--muted,#8a8aa0)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              Your new card is now on file and will be used for future payments.
            </p>
            <Link
              href="/subscribe"
              style={{ display: 'inline-block', background: 'var(--neon,#00e0a4)', color: '#06231b', padding: '.8rem 1.5rem', borderRadius: 8, fontWeight: 700, textDecoration: 'none' }}
            >
              Back to Your Plan
            </Link>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: '1.4rem', marginBottom: '.5rem', color: 'var(--white,#fff)' }}>
              Finishing up…
            </h1>
            <p style={{ color: 'var(--muted,#8a8aa0)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              If you saved a new card it will apply shortly. If something went wrong, you can try again.
            </p>
            <Link
              href="/subscribe"
              style={{ display: 'inline-block', border: '1px solid rgba(255,255,255,.25)', color: 'var(--white,#fff)', padding: '.8rem 1.5rem', borderRadius: 8, fontWeight: 600, textDecoration: 'none' }}
            >
              Back to Your Plan
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
