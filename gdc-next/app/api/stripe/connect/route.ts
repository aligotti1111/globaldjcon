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
//
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS FILE IS SHAPED THE WAY IT IS (the 502 hunt):
//
// v1 returned a real JSON {error} on every failure path it knew about, yet
// production served a 502 with an HTML body — so the client's
// `res.json().catch(() => ({}))` produced an empty object and the UI fell back
// to a generic "Could not start Stripe onboarding." with no cause. A GET to
// this path returned 405, which proves the module loads and POST is exported.
// So the handler was ENTERED and then died in a way its own catch never saw.
//
// Two things cause that, and both are handled here now:
//
//   1. A throw OUTSIDE a try block. v1 ran createClient / getUser /
//      createAdminClient / the users select before any try. Any of those
//      throwing escapes to the platform, which renders HTML. FIX: the entire
//      handler body is wrapped, and the wrapper always returns JSON.
//
//   2. The function being KILLED rather than throwing. Netlify's sync function
//      limit is ~10s and `export const maxDuration` is a Vercel setting that
//      does nothing here — v1's `maxDuration = 20` was meaningless. A killed
//      process cannot run a catch block, so no amount of try/catch alone can
//      save it. FIX: every network call is raced against a deadline well under
//      the platform's, so we return a real message with time to spare.
//
// The rule this encodes: an API route must never be able to answer with
// something that isn't JSON. A caller that can't parse the error is a caller
// that can only guess.
// ─────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/server';

export const runtime = 'nodejs';
// Opt out of any caching — this reads per-user state and talks to Stripe.
export const dynamic = 'force-dynamic';

const SITE_URL = 'https://globaldjconnect.com';

// Comfortably under Netlify's ~10s kill. If Stripe or Supabase hasn't answered
// in 8s it isn't going to, and a named error beats an opaque 502.
const DEADLINE_MS = 8000;

interface ConnectRow {
  stripe_connect_id: string | null;
  stripe_connect_ready: boolean | null;
}

/**
 * Race a promise against a deadline so a hang becomes a message instead of a
 * platform kill. `label` names the call, so the DJ (and the logs) learn WHICH
 * hop stalled — "Stripe timed out creating the account" is actionable in a way
 * that a bare 502 never is.
 *
 * PromiseLike, not Promise: Supabase's query builders are thenables, not real
 * Promises, so `Promise<T>` here would be a build error on every .select()/
 * .update() call site.
 */
function withDeadline<T>(p: PromiseLike<T>, label: string, ms = DEADLINE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s.`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export async function POST(req: Request) {
  // EVERYTHING is inside this try. Nothing in this handler is permitted to
  // reach the platform's HTML error page.
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await withDeadline(supabase.auth.getUser(), 'Auth check');
    if (authErr) return NextResponse.json({ error: `Auth: ${authErr.message}` }, { status: 401 });
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
    const action = typeof body.action === 'string' ? body.action : '';

    // Throws if SUPABASE_SERVICE_ROLE_KEY is missing — in v1 that throw was
    // outside any try and would have escaped as a 502.
    // ( `| null` + an explicit guard rather than definite-assignment: TS treats
    //   an assignment inside a try as "might not have happened" for code after
    //   it, even when the catch returns. )
    let admin: ReturnType<typeof createAdminClient> | null = null;
    try {
      admin = createAdminClient();
    } catch (e) {
      return NextResponse.json({ error: `Admin client: ${errMsg(e, 'could not initialise')}` }, { status: 500 });
    }
    if (!admin) return NextResponse.json({ error: 'Admin client unavailable.' }, { status: 500 });

    // stripe_connect_id / stripe_connect_ready are newer than the generated
    // types/supabase.ts — select them explicitly and cast the result (same
    // pattern as stripe_customer_id in /api/stripe/checkout).
    const { data: rowData, error: rowErr } = await withDeadline(
      admin.from('users').select('stripe_connect_id, stripe_connect_ready').eq('id', user.id).maybeSingle(),
      'Database read',
    );
    if (rowErr) return NextResponse.json({ error: `DB: ${rowErr.message}` }, { status: 502 });
    const row = rowData as unknown as ConnectRow | null;
    if (!row) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });

    // Where Stripe sends the DJ afterwards. Origin first so previews/local work;
    // the hardcoded fallback matches the rest of the codebase.
    const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || SITE_URL;

    // ─────────────────────────────── start ───────────────────────────────
    if (action === 'start') {
      let stripe: ReturnType<typeof getStripe> | null = null;
      try {
        stripe = getStripe();
      } catch (e) {
        // A missing/blank STRIPE_SECRET_KEY throws right here.
        return NextResponse.json({ error: `Stripe init: ${errMsg(e, 'no secret key configured')}` }, { status: 500 });
      }
      if (!stripe) return NextResponse.json({ error: 'Stripe unavailable.' }, { status: 500 });

      let accountId = row.stripe_connect_id;
      if (!accountId) {
        try {
          const account = await withDeadline(
            stripe.accounts.create({
              type: 'standard',
              email: user.email || undefined,
              metadata: { user_id: user.id },
            }),
            'Stripe account create',
          );
          accountId = account.id;
        } catch (e) {
          // Most common real-world failure: Connect not enabled on the
          // platform dashboard, or live mode without a completed platform
          // profile. Stripe's own message says which — surface it verbatim.
          return NextResponse.json({ error: `Stripe (create account): ${errMsg(e, 'unknown error')}` }, { status: 502 });
        }

        const { error: upErr } = await withDeadline(
          admin.from('users').update({ stripe_connect_id: accountId } as unknown as never).eq('id', user.id),
          'Database write',
        );
        // If we can't persist the id we'd orphan the Stripe account and mint
        // a second one next click — fail loudly instead.
        if (upErr) return NextResponse.json({ error: `DB (save account id): ${upErr.message}` }, { status: 502 });
      }
      // Narrowing guard: the assignment above lives inside a try, which TS
      // won't credit as definite, so accountId is still `string | null` here.
      if (!accountId) return NextResponse.json({ error: 'No Stripe account id.' }, { status: 502 });

      // Account links are single-use and expire in minutes — always fresh.
      // refresh_url lands back on Booking Settings, where the section offers
      // the resume button (this same action) again.
      try {
        const link = await withDeadline(
          stripe.accountLinks.create({
            account: accountId,
            type: 'account_onboarding',
            refresh_url: `${origin}/booking-settings?stripe=refresh`,
            return_url: `${origin}/booking-settings?stripe=connected`,
          }),
          'Stripe account link',
        );
        return NextResponse.json({ url: link.url });
      } catch (e) {
        return NextResponse.json({ error: `Stripe (account link): ${errMsg(e, 'unknown error')}` }, { status: 502 });
      }
    }

    // ─────────────────────────────── status ──────────────────────────────
    if (action === 'status') {
      if (!row.stripe_connect_id) {
        return NextResponse.json({ connected: false, ready: false, chargesEnabled: false, detailsSubmitted: false });
      }
      try {
        const stripe = getStripe();
        const account = await withDeadline(stripe.accounts.retrieve(row.stripe_connect_id), 'Stripe account fetch');
        const chargesEnabled = !!account.charges_enabled;

        // Cache into users.stripe_connect_ready — the flag every host-facing
        // card button is driven by. Only write when it actually changed.
        if (chargesEnabled !== !!row.stripe_connect_ready) {
          await withDeadline(
            admin.from('users').update({ stripe_connect_ready: chargesEnabled } as unknown as never).eq('id', user.id),
            'Database write',
          );
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
          error: errMsg(e, 'Could not reach Stripe.'),
        });
      }
    }

    // ───────────────────────────── disconnect ────────────────────────────
    if (action === 'disconnect') {
      // OUR pointer only. The Stripe account belongs to the DJ — deleting it
      // would destroy their payout history and any other business they run on
      // it. Reconnecting later just creates a fresh account.
      const { error } = await withDeadline(
        admin
          .from('users')
          .update({ stripe_connect_id: null, stripe_connect_ready: false } as unknown as never)
          .eq('id', user.id),
        'Database write',
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 502 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    // The backstop. Anything that got past the specific handlers above still
    // leaves here as JSON, never as a platform HTML page.
    console.error('[stripe/connect] unhandled', e);
    return NextResponse.json({ error: `Server: ${errMsg(e, 'unexpected error')}` }, { status: 500 });
  }
}
