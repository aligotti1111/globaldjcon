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
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  event_type: string | null;
  venue_type: string | null;
  venue_type_desc: string | null;
  booking_type: string | null;
  currency: string | null;
}

// Turn a stored code ("weddings", "corporate_event") into a readable label.
function prettyType(s: string | null): string {
  if (!s) return '';
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// "18:00" / "18:00:00" → "6:00 PM". Passes through anything already formatted.
function fmtTime(t: string | null): string {
  if (!t) return '';
  if (/[ap]m/i.test(t)) return t.trim();
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  let hr = parseInt(m[1], 10);
  const ap = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  return `${hr}:${m[2]} ${ap}`;
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
    .select('id, dj_id, host_email, event_date, start_time, end_time, venue_name, venue_address, event_type, venue_type, venue_type_desc, booking_type, currency')
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

  // Line-item detail shown on the Stripe checkout page. Name = what's owed +
  // the DJ; description packs the event facts (type · date · time · venue ·
  // address) plus the reference. Stripe wraps the description over a few lines.
  const eventTypeLabel = prettyType(b.event_type || b.venue_type_desc || b.venue_type);
  const timeRange = [fmtTime(b.start_time), fmtTime(b.end_time)].filter(Boolean).join(' – ');
  const productName = `${noun} — ${djName}`;
  const detailBits = [
    eventTypeLabel,
    b.event_date,
    timeRange,
    b.venue_name,
    b.venue_address,
    `Ref ${reference}`,
  ].filter(Boolean);
  const productDesc = detailBits.join(' · ');

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
                name: productName,
                description: productDesc,
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
