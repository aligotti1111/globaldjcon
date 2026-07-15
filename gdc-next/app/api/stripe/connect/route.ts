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

/**
 * The `start` action, method-agnostic. Creates the connected account if the DJ
 * doesn't have one yet, then mints a fresh single-use onboarding link.
 *
 * Shared by POST {action:'start'} and the GET ?run=start diagnostic so the two
 * can't diverge — the entire value of that experiment rests on the paths being
 * identical.
 *
 * Every hop is individually caught and labelled, and every network call is
 * raced against a deadline. Returns JSON on every branch, always.
 */
async function runStart(req: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await withDeadline(supabase.auth.getUser(), 'Auth check');
  if (authErr) return NextResponse.json({ error: `Auth: ${authErr.message}` }, { status: 401 });
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ error: `Admin client: ${errMsg(e, 'could not initialise')}` }, { status: 500 });
  }
  if (!admin) return NextResponse.json({ error: 'Admin client unavailable.' }, { status: 500 });

  const { data: rowData, error: rowErr } = await withDeadline(
    admin.from('users').select('stripe_connect_id, stripe_connect_ready').eq('id', user.id).maybeSingle(),
    'Database read',
  );
  if (rowErr) return NextResponse.json({ error: `DB: ${rowErr.message}` }, { status: 502 });
  const row = rowData as unknown as ConnectRow | null;
  if (!row) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });

  const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || SITE_URL;

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
      // Most common real-world failure: Connect not enabled on the platform
      // dashboard, or live mode without a completed platform profile.
      // Stripe's own message says which — surface it verbatim.
      return NextResponse.json({ error: `Stripe (create account): ${errMsg(e, 'unknown error')}` }, { status: 502 });
    }

    const { error: upErr } = await withDeadline(
      admin.from('users').update({ stripe_connect_id: accountId } as unknown as never).eq('id', user.id),
      'Database write',
    );
    // If we can't persist the id we'd orphan the Stripe account and mint a
    // second one next click — fail loudly instead.
    if (upErr) return NextResponse.json({ error: `DB (save account id): ${upErr.message}` }, { status: 502 });
  }
  // Narrowing guard: the assignment above lives inside a try, which TS won't
  // credit as definite, so accountId is still `string | null` here.
  if (!accountId) return NextResponse.json({ error: 'No Stripe account id.' }, { status: 502 });

  // Account links are single-use and expire in minutes — always fresh.
  // refresh_url lands back on Booking Settings, where the section offers the
  // resume button (this same action) again.
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

/**
 * GET /api/stripe/connect — self-check, openable straight in a browser.
 *
 * Exists because "Could not start Stripe onboarding." is the CLIENT's fallback
 * string: it appears whenever the response body isn't JSON, which is equally
 * consistent with "the fix isn't deployed yet" and "the function was killed
 * before it could answer". Those two are indistinguishable from the UI, and
 * guessing between them has already cost hours.
 *
 * So: a GET that needs no auth, no request body, and no button — just report
 * what the server can see about itself.
 *   • it answering AT ALL proves this file is live (v1 had no GET → 405)
 *   • `version` proves WHICH build is live
 *   • the env booleans prove whether the runtime can see the keys, which a
 *     green build says nothing about
 *   • `stripeInit` runs the exact call that would throw first in `start`
 *
 * Leaks nothing: booleans and lengths only, never a key or a fragment of one.
 */
export async function GET(req: Request) {
  // ── ?run=start — the SAME start work, over GET ────────────────────────
  //
  // TEMPORARY DIAGNOSTIC. Delete once cards work.
  //
  // A GET to this route returns 200 through the same Cloudflare, the same
  // Netlify function and the same module graph that a POST dies in with a
  // Cloudflare 502 "Host Error". So the difference is the METHOD, not the
  // code — unless the Stripe calls themselves are what kills it. Running the
  // identical work under GET separates those two in one click:
  //
  //   • JSON with a url  → the Stripe path is fine; POST is being mangled
  //                        somewhere between Cloudflare and the handler
  //   • 502 again        → the Stripe call itself crashes the process,
  //                        method is irrelevant
  //
  // Yes, a GET with side effects is wrong (it can create a Stripe account).
  // It's authed, it's idempotent in practice — an existing stripe_connect_id
  // is reused — and it is worth exactly one deploy to stop guessing.
  const url = new URL(req.url);
  const run = url.searchParams.get('run');

  // ── BISECT ────────────────────────────────────────────────────────────
  //
  // TEMPORARY. Delete once cards work.
  //
  // Established so far: a bare GET returns 200 with stripeInit:"ok", while
  // ?run=start dies as a Cloudflare 502 "Host Error" — origin returned an
  // invalid response — over BOTH GET and POST. Identical route, identical
  // module, identical everything except the work done. And the work is wrapped
  // in try/catch on every branch, so a throw is impossible to miss. The only
  // remaining explanation is that the PROCESS dies: a catch block can't run in
  // a process that no longer exists.
  //
  // Three calls sit between the bare GET and start:
  //   auth    → Supabase auth.getUser()      (network)
  //   db      → users select                 (network)
  //   ping    → stripe.accounts.list(1)      (network, READ-ONLY, no side effects)
  //   acct    → stripe.accounts.create()     (network, creates the account)
  //
  // Each runs alone, in its own request, so whichever one 502s IS the culprit
  // and the others still answer. `ping` is the interesting one: it's the
  // cheapest possible Stripe API call, so if it dies while the bare GET lives,
  // the problem is the Stripe SDK's network layer in this runtime and has
  // nothing to do with Connect at all.
  if (run && run !== 'start') {
    try {
      if (run === 'auth') {
        const supabase = await createClient();
        const t0 = Date.now();
        const { data, error } = await withDeadline(supabase.auth.getUser(), 'Auth check');
        return NextResponse.json({
          step: 'auth', ms: Date.now() - t0,
          userId: data?.user?.id ?? null, email: data?.user?.email ?? null,
          error: error?.message ?? null,
        });
      }
      if (run === 'db') {
        const supabase = await createClient();
        const { data: { user } } = await withDeadline(supabase.auth.getUser(), 'Auth check');
        if (!user) return NextResponse.json({ step: 'db', error: 'Not signed in' }, { status: 401 });
        const admin = createAdminClient();
        const t0 = Date.now();
        const { data, error } = await withDeadline(
          admin.from('users').select('stripe_connect_id, stripe_connect_ready').eq('id', user.id).maybeSingle(),
          'Database read',
        );
        return NextResponse.json({
          step: 'db', ms: Date.now() - t0,
          row: (data as unknown as ConnectRow | null) ?? null,
          error: error?.message ?? null,
        });
      }
      if (run === 'ping') {
        const stripe = getStripe();
        const t0 = Date.now();
        const list = await withDeadline(stripe.accounts.list({ limit: 1 }), 'Stripe ping');
        return NextResponse.json({ step: 'ping', ms: Date.now() - t0, count: list.data.length });
      }
      if (run === 'acct') {
        const supabase = await createClient();
        const { data: { user } } = await withDeadline(supabase.auth.getUser(), 'Auth check');
        if (!user) return NextResponse.json({ step: 'acct', error: 'Not signed in' }, { status: 401 });
        const stripe = getStripe();
        const t0 = Date.now();
        const account = await withDeadline(
          stripe.accounts.create({ type: 'standard', email: user.email || undefined, metadata: { user_id: user.id } }),
          'Stripe account create',
        );
        // Deliberately NOT saved — this is a probe. An orphan test account in
        // test mode is cheaper than another round of guessing.
        return NextResponse.json({ step: 'acct', ms: Date.now() - t0, id: account.id });
      }
      // ── save / link — start, minus one half each ──────────────────────
      //
      // auth, db, ping and acct ALL return JSON on their own. start does not.
      // So the fault is in one of the two calls no probe has touched yet:
      // the DB write that persists the account id, or accountLinks.create.
      // These two run everything start runs except one of those, which pins
      // it exactly.
      if (run === 'save' || run === 'link') {
        const supabase = await createClient();
        const { data: { user } } = await withDeadline(supabase.auth.getUser(), 'Auth check');
        if (!user) return NextResponse.json({ step: run, error: 'Not signed in' }, { status: 401 });
        const admin = createAdminClient();
        const stripe = getStripe();

        // Reuse an existing account so repeated probing doesn't litter Stripe.
        const { data: rowData } = await withDeadline(
          admin.from('users').select('stripe_connect_id, stripe_connect_ready').eq('id', user.id).maybeSingle(),
          'Database read',
        );
        const existing = (rowData as unknown as ConnectRow | null)?.stripe_connect_id ?? null;

        let accountId = existing;
        let created = false;
        if (!accountId) {
          const account = await withDeadline(
            stripe.accounts.create({ type: 'standard', email: user.email || undefined, metadata: { user_id: user.id } }),
            'Stripe account create',
          );
          accountId = account.id;
          created = true;
        }

        if (run === 'save') {
          // start MINUS accountLinks.create.
          const t0 = Date.now();
          const { error } = await withDeadline(
            admin.from('users').update({ stripe_connect_id: accountId } as unknown as never).eq('id', user.id),
            'Database write',
          );
          return NextResponse.json({
            step: 'save', ms: Date.now() - t0, accountId, created, reusedExisting: !created,
            error: error?.message ?? null,
          });
        }

        // run === 'link' — start MINUS the DB write.
        const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || SITE_URL;
        const t0 = Date.now();
        const link = await withDeadline(
          stripe.accountLinks.create({
            account: accountId as string,
            type: 'account_onboarding',
            refresh_url: `${origin}/booking-settings?stripe=refresh`,
            return_url: `${origin}/booking-settings?stripe=connected`,
          }),
          'Stripe account link',
        );
        return NextResponse.json({ step: 'link', ms: Date.now() - t0, accountId, created, url: link.url });
      }

      return NextResponse.json({ error: `Unknown run=${run}. Try auth, db, ping, acct, save, link, start.` }, { status: 400 });
    } catch (e) {
      return NextResponse.json({ step: run, error: errMsg(e, 'threw'), name: (e as Error)?.name ?? null }, { status: 500 });
    }
  }

  if (run === 'start') {
    try {
      return await runStart(req);
    } catch (e) {
      return NextResponse.json({ error: `GET start: ${errMsg(e, 'threw')}` }, { status: 500 });
    }
  }

  const out: Record<string, unknown> = {
    version: 'connect-v5-savelink',
    node: process.version,
    hasStripeSecret: !!process.env.STRIPE_SECRET_KEY,
    stripeKeyLooksLive: (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live'),
    stripeKeyLooksTest: (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test'),
    stripeKeyLength: (process.env.STRIPE_SECRET_KEY || '').length,
    hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || null,
  };
  try {
    getStripe();
    out.stripeInit = 'ok';
  } catch (e) {
    out.stripeInit = errMsg(e, 'threw');
  }
  try {
    createAdminClient();
    out.adminInit = 'ok';
  } catch (e) {
    out.adminInit = errMsg(e, 'threw');
  }
  return NextResponse.json(out);
}

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

    // Delegated so GET ?run=start and POST {action:'start'} execute LITERALLY
    // the same code. If one 502s and the other doesn't, the difference is the
    // HTTP method — a fact about Cloudflare/Netlify, not about us.
    // (runStart does its own auth + row read, so it goes before the lookups
    // below rather than after them.)
    if (action === 'start') return await runStart(req);

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
