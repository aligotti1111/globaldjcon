// POST /api/stripe/connect
//
// A DJ links (or unlinks) their own Stripe account so hosts can pay deposits
// and invoices by card. STANDARD connected accounts with DIRECT charges:
//
//   • the DJ is merchant of record — their name on the statement
//   • the DJ pays Stripe's 2.9% + 30¢, not the platform
//   • the DJ owns disputes/chargebacks, not the platform
//   • the platform takes NO application fee and never holds funds —
//     the same zero-cut rule as every manual rail
//
// Onboarding uses ACCOUNT LINKS, not OAuth: accounts.create({type:'standard'})
// then accountLinks.create(...). No STRIPE_CONNECT_CLIENT_ID env var needed —
// the only prerequisite is Connect being enabled on the platform's Stripe
// dashboard.
//
// Actions:
//   start      → create the account if needed, return a fresh onboarding URL.
//                Also how a DJ RESUMES abandoned onboarding: account links are
//                single-use and expire, so we mint a new one every time.
//   status     → retrieve the account, cache charges_enabled into
//                users.stripe_connect_ready (that cached flag is what decides
//                whether hosts ever see a card button).
//   disconnect → forget the account id on OUR side only. The Stripe account
//                is the DJ's own property — we never delete it.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/server';

export const runtime = 'nodejs';
export const maxDuration = 20;

const SITE_URL = 'https://globaldjconnect.com';

interface ConnectRow {
  stripe_connect_id: string | null;
  stripe_connect_ready: boolean | null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const action = typeof body.action === 'string' ? body.action : '';

  const admin = createAdminClient();
  // stripe_connect_id / stripe_connect_ready are newer than the generated
  // types/supabase.ts — select them explicitly and cast the result (same
  // pattern as stripe_customer_id in /api/stripe/checkout).
  const { data: rowData, error: rowErr } = await admin
    .from('users')
    .select('stripe_connect_id, stripe_connect_ready')
    .eq('id', user.id)
    .maybeSingle();
  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 502 });
  const row = rowData as unknown as ConnectRow | null;
  if (!row) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });

  // Where Stripe sends the DJ afterwards. Origin first so previews/local work;
  // the hardcoded fallback matches the rest of the codebase.
  const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || SITE_URL;

  // ─────────────────────────────── start ───────────────────────────────
  if (action === 'start') {
    try {
      const stripe = getStripe();

      let accountId = row.stripe_connect_id;
      if (!accountId) {
        const account = await stripe.accounts.create({
          type: 'standard',
          email: user.email || undefined,
          metadata: { user_id: user.id },
        });
        accountId = account.id;
        const { error } = await admin
          .from('users')
          .update({ stripe_connect_id: accountId } as unknown as never)
          .eq('id', user.id);
        // If we can't persist the id we'd orphan the Stripe account and mint
        // a second one next click — fail loudly instead.
        if (error) return NextResponse.json({ error: error.message }, { status: 502 });
      }

      // Account links are single-use and expire in minutes — always fresh.
      // refresh_url lands back on Booking Settings, where the section offers
      // the resume button (this same action) again.
      const link = await stripe.accountLinks.create({
        account: accountId,
        type: 'account_onboarding',
        refresh_url: `${origin}/booking-settings?stripe=refresh`,
        return_url: `${origin}/booking-settings?stripe=connected`,
      });
      return NextResponse.json({ url: link.url });
    } catch (e) {
      // Most common real-world failure: Connect not enabled on the platform
      // dashboard. Stripe's message says so — surface it.
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Could not start Stripe onboarding.' },
        { status: 502 },
      );
    }
  }

  // ─────────────────────────────── status ──────────────────────────────
  if (action === 'status') {
    if (!row.stripe_connect_id) {
      return NextResponse.json({ connected: false, ready: false, chargesEnabled: false, detailsSubmitted: false });
    }
    try {
      const stripe = getStripe();
      const account = await stripe.accounts.retrieve(row.stripe_connect_id);
      const chargesEnabled = !!account.charges_enabled;

      // Cache into users.stripe_connect_ready — the flag every host-facing
      // card button is driven by. Only write when it actually changed.
      if (chargesEnabled !== !!row.stripe_connect_ready) {
        await admin
          .from('users')
          .update({ stripe_connect_ready: chargesEnabled } as unknown as never)
          .eq('id', user.id);
      }

      return NextResponse.json({
        connected: true,
        ready: chargesEnabled,
        chargesEnabled,
        detailsSubmitted: !!account.details_submitted,
      });
    } catch (e) {
      // Account retrieval failing (revoked from the Stripe side, deleted
      // account) reads as "connected but not ready" — never crash settings.
      return NextResponse.json({
        connected: true,
        ready: false,
        chargesEnabled: false,
        detailsSubmitted: false,
        error: e instanceof Error ? e.message : 'Could not reach Stripe.',
      });
    }
  }

  // ───────────────────────────── disconnect ────────────────────────────
  if (action === 'disconnect') {
    // OUR pointer only. The Stripe account belongs to the DJ — deleting it
    // would destroy their payout history and any other business they run on
    // it. Reconnecting later just creates a fresh account.
    const { error } = await admin
      .from('users')
      .update({ stripe_connect_id: null, stripe_connect_ready: false } as unknown as never)
      .eq('id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
