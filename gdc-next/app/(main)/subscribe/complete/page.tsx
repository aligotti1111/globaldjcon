// /subscribe/complete — where embedded Checkout redirects after payment.
// Retrieves the session to confirm it completed, then points the DJ to
// booking settings to finish setup. The webhook writes the tier onto the
// account (may lag a second), so this page just confirms checkout succeeded.

import Link from 'next/link';
import { getStripe } from '@/lib/stripe/server';

export const dynamic = 'force-dynamic';

export default async function CheckoutCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;

  let complete = false;
  if (session_id) {
    try {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(session_id);
      complete = session.status === 'complete';
    } catch {
      complete = false;
    }
  }

  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1rem',
      }}
    >
      <div
        style={{
          maxWidth: 460,
          width: '100%',
          textAlign: 'center',
          border: '1px solid rgba(255,255,255,.12)',
          borderRadius: 14,
          padding: '2.5rem 1.75rem',
          background: 'rgba(255,255,255,.02)',
        }}
      >
        {complete ? (
          <>
            <div style={{ fontSize: '2.5rem', marginBottom: '.5rem' }}>✓</div>
            <h1 style={{ fontSize: '1.6rem', marginBottom: '.5rem', color: 'var(--white,#fff)' }}>
              You&apos;re subscribed!
            </h1>
            <p style={{ color: 'var(--muted,#8a8aa0)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              Your plan is now active. Next, finish setting up your booking page so clients can
              book you.
            </p>
            <Link
              href="/booking-settings"
              style={{
                display: 'inline-block',
                background: 'var(--neon,#00e0a4)',
                color: '#06231b',
                padding: '.8rem 1.5rem',
                borderRadius: 8,
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              Go to Booking Settings
            </Link>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: '1.4rem', marginBottom: '.5rem', color: 'var(--white,#fff)' }}>
              Finishing up…
            </h1>
            <p style={{ color: 'var(--muted,#8a8aa0)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              If you completed payment, your plan will activate shortly. If something went wrong,
              you can try again.
            </p>
            <Link
              href="/subscribe"
              style={{
                display: 'inline-block',
                border: '1px solid rgba(255,255,255,.25)',
                color: 'var(--white,#fff)',
                padding: '.8rem 1.5rem',
                borderRadius: 8,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Back to Plans
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
