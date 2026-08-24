// Public "pay by card" bounce. The invoice email links here (no login). It
// mints a fresh Stripe Checkout session on the DJ's connected account and
// 303-redirects the payer straight to Stripe. The session URL can't live in
// the email itself (it's created per-click and expires), so this tiny route
// creates it on demand. On success Stripe returns to ./done, which verifies
// and marks the payment paid — preserving card's auto-confirmation without a
// login.
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/server';
import { referenceCode } from '@/lib/paymentMethods';
import type { SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const SITE_URL = 'https://globaldjconnect.com';
const round2 = (n: number) => Number(n.toFixed(2));

interface PaymentRow {
  id: string;
  booking_id: string;
  kind: string;
  amount: number;
  amount_paid: number | null;
  currency: string | null;
  status: string;
  stripe_session_id: string | null;
}
interface BookingRow {
  id: string;
  dj_id: string | null;
  host_email: string | null;
  event_date: string | null;
  venue_name: string | null;
  currency: string | null;
}
interface DjRow {
  stripe_connect_id: string | null;
  stripe_connect_ready: boolean | null;
  name: string | null;
}

function done(paymentId: string, qs: string) {
  return NextResponse.redirect(`${SITE_URL}/pay/${paymentId}/card/done?${qs}`, { status: 303 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: paymentId } = await params;
  // Generated Supabase types omit booking_payments (and others), so we talk to
  // the DB through a generically-typed client — same pattern as the payments
  // route. Service-role key; RLS does not apply here.
  const db = createAdminClient() as unknown as SupabaseClient;

  const { data: pData } = await db
    .from('booking_payments')
    .select('id, booking_id, kind, amount, amount_paid, currency, status, stripe_session_id')
    .eq('id', paymentId)
    .maybeSingle();
  const p = pData as PaymentRow | null;
  if (!p) return done(paymentId, 'e=notfound');
  if (p.status === 'paid' || p.status === 'waived' || p.stripe_session_id) return done(paymentId, 'state=settled');

  const { data: bData } = await db
    .from('bookings')
    .select('id, dj_id, host_email, event_date, venue_name, currency')
    .eq('id', p.booking_id)
    .maybeSingle();
  const b = bData as BookingRow | null;
  if (!b) return done(paymentId, 'e=notfound');

  const { data: djData } = b.dj_id
    ? await db.from('users').select('stripe_connect_id, stripe_connect_ready, name').eq('id', b.dj_id).maybeSingle()
    : { data: null };
  const dj = djData as unknown as DjRow | null;
  if (!dj?.stripe_connect_id || !dj.stripe_connect_ready) return done(paymentId, 'e=notready');

  const outstanding = round2(Math.max(0, Number(p.amount) - Number(p.amount_paid || 0)));
  if (!(outstanding > 0) || outstanding < 0.5) return done(paymentId, 'state=settled');

  const reference = referenceCode(p.booking_id, p.kind);
  const noun = p.kind === 'balance' ? 'Balance' : p.kind === 'deposit' ? 'Deposit' : 'Payment';
  const djName = dj.name || 'the DJ';
  const cur = (p.currency || 'USD').toLowerCase();

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: cur,
              unit_amount: Math.round(outstanding * 100),
              product_data: {
                name: `${noun} — ${djName}${b.event_date ? ` · ${b.event_date}` : ''}`,
                description: `Ref ${reference}${b.venue_name ? ` · ${b.venue_name}` : ''}`,
              },
            },
          },
        ],
        metadata: { payment_id: p.id, booking_id: p.booking_id, reference },
        payment_intent_data: { metadata: { payment_id: p.id, booking_id: p.booking_id, reference } },
        customer_email: b.host_email || undefined,
        success_url: `${SITE_URL}/pay/${p.id}/card/done?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/pay/${p.id}/card/done?state=cancelled`,
      },
      { stripeAccount: dj.stripe_connect_id },
    );
    return NextResponse.redirect(session.url || `${SITE_URL}/pay/${p.id}/card/done?e=failed`, { status: 303 });
  } catch {
    return done(paymentId, 'e=failed');
  }
}
