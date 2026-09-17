// /api/comp-codes/redeem — validate and redeem a COMP CODE.
//
// A comp code grants free access (a tier for N months) with NO card and NO
// Stripe. It writes the same comp columns an admin grant does
// (comp_tier / comp_expires_at / comp_source='code'), so everything downstream
// — access gating, the "add a card to continue" trial_end flow — works exactly
// the same as an admin-granted comp.
//
// Two modes on POST:
//   { code, preview: true }  → validate only, return what the code would do
//                              (drives the live "✓ Pro free for 3 months" text).
//   { code }                 → actually redeem it for the logged-in user.
//
// Rules:
//   • code must exist, be active, not past expires_at, and under max_uses.
//   • one redemption per (code, account) — re-redeeming the same code is blocked.
//   • applying never SHORTENS access: the new comp expiry is the later of the
//     current comp expiry (if still in the future) and now + months, and the
//     tier is the higher of the two. One comp at a time.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext } from '@/lib/acting';
import { TIER_LABELS, type Tier } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CompCodeRow {
  id: string;
  code: string;
  grant_tier: number;
  months: number;
  expires_at: string | null;
  max_uses: number | null;
  uses_count: number;
  active: boolean;
}

export async function POST(req: Request) {
  let body: { code?: string; preview?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  }

  const code = (body.code || '').trim().toUpperCase();
  const preview = !!body.preview;
  if (!code) {
    return NextResponse.json({ ok: false, error: 'Enter a code.' }, { status: 400 });
  }

  // Who's redeeming — must be logged in.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Please sign in to redeem a code.' }, { status: 401 });
  }

  // Team members act on the OWNER's account and have no subscription of their
  // own, so a comp on their login is meaningless and abusable. Only the account
  // owner (a DJ) can redeem — block members outright (both preview and apply).
  const acting = await getActingContext(user.id);
  if (acting.isMember) {
    return NextResponse.json(
      { ok: false, error: 'Team members can’t redeem codes — the account owner handles the subscription.' },
      { status: 403 },
    );
  }

  const admin = createAdminClient() as unknown as SupabaseClient;

  // Only DJ owner accounts subscribe, so only they can redeem a comp code.
  const { data: selfProfile } = await admin
    .from('users')
    .select('role, sub_tier, sub_status')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null; sub_tier: number | null; sub_status: string | null }>();
  if (selfProfile?.role !== 'dj') {
    return NextResponse.json(
      { ok: false, error: 'Only DJ accounts can redeem a code.' },
      { status: 403 },
    );
  }

  // A comp doesn't pause an active PAID Stripe subscription — they'd keep being
  // billed and the free months would be wasted. Block redemption while a paid
  // subscription is live (active / trialing / past_due) and tell them to cancel
  // first; the comp then covers them once the paid plan lapses.
  const activePaid =
    (selfProfile?.sub_tier ?? 0) >= 1 &&
    ['active', 'trialing', 'past_due'].includes(selfProfile?.sub_status ?? '');
  if (activePaid) {
    return NextResponse.json(
      { ok: false, error: 'You already have an active subscription. Cancel it first (you keep access until it ends), then redeem your code.' },
      { status: 409 },
    );
  }

  // Look the code up (case-insensitive since stored uppercase).
  const { data: codeData } = await admin
    .from('comp_codes')
    .select('*')
    .eq('code', code)
    .maybeSingle<CompCodeRow>();

  if (!codeData || !codeData.active) {
    return NextResponse.json({ ok: false, error: 'That code isn’t valid.' }, { status: 404 });
  }
  const now = Date.now();
  if (codeData.expires_at && new Date(codeData.expires_at).getTime() <= now) {
    return NextResponse.json({ ok: false, error: 'That code has expired.' }, { status: 410 });
  }
  if (codeData.max_uses != null && codeData.uses_count >= codeData.max_uses) {
    return NextResponse.json({ ok: false, error: 'That code has been fully redeemed.' }, { status: 409 });
  }

  const tier = codeData.grant_tier as Tier;
  const tierLabel = TIER_LABELS[tier] ?? `Tier ${tier}`;

  // Already redeemed by this account?
  const { data: existingRedemption } = await admin
    .from('comp_code_redemptions')
    .select('id')
    .eq('code_id', codeData.id)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string }>();
  const alreadyRedeemed = !!existingRedemption;

  // Preview: just describe it (and flag if they already used it).
  if (preview) {
    return NextResponse.json({
      ok: true,
      preview: true,
      tier,
      tierLabel,
      months: codeData.months,
      alreadyRedeemed,
      description: `${tierLabel} free for ${codeData.months} month${codeData.months === 1 ? '' : 's'}`,
    });
  }

  if (alreadyRedeemed) {
    return NextResponse.json({ ok: false, error: 'You’ve already redeemed this code.' }, { status: 409 });
  }

  // Compute the new comp. STACK from the current end date so a second code adds
  // real time instead of being swallowed: base = the later of "now" and their
  // existing comp end, then + N calendar months. Tier never downgrades.
  const { data: profile } = await admin
    .from('users')
    .select('comp_tier, comp_expires_at')
    .eq('id', user.id)
    .maybeSingle<{ comp_tier: number | null; comp_expires_at: string | null }>();

  const existingExpMs = profile?.comp_expires_at ? new Date(profile.comp_expires_at).getTime() : 0;
  const existingActive = existingExpMs > now;
  const base = new Date(existingActive ? existingExpMs : now);
  base.setUTCMonth(base.getUTCMonth() + codeData.months); // true calendar months
  const newExpiresAt = base.toISOString();
  const newTier = Math.max(existingActive ? (profile?.comp_tier ?? 0) : 0, tier);

  // Ledger FIRST — the UNIQUE(code_id, user_id) constraint is the real guard
  // against two requests racing past the alreadyRedeemed check above.
  const { error: ledgerErr } = await admin.from('comp_code_redemptions').insert({
    code_id: codeData.id,
    user_id: user.id,
    granted_tier: tier,
    granted_months: codeData.months,
    new_expires_at: newExpiresAt,
  } as unknown as never);
  if (ledgerErr) {
    const pgCode = (ledgerErr as { code?: string }).code;
    if (pgCode === '23505') {
      return NextResponse.json({ ok: false, error: 'You’ve already redeemed this code.' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: 'Could not apply the code. Please try again.' }, { status: 500 });
  }

  // Grant the comp.
  const { error: updErr } = await admin
    .from('users')
    .update({
      comp_tier: newTier,
      comp_expires_at: newExpiresAt,
      comp_source: 'code',
    } as unknown as never)
    .eq('id', user.id);
  if (updErr) {
    // Roll the ledger row back so they can retry cleanly.
    await admin.from('comp_code_redemptions').delete().eq('code_id', codeData.id).eq('user_id', user.id);
    return NextResponse.json({ ok: false, error: 'Could not apply the code. Please try again.' }, { status: 500 });
  }

  // Usage count (best-effort; the ledger row is the real guard).
  await admin
    .from('comp_codes')
    .update({ uses_count: codeData.uses_count + 1 } as unknown as never)
    .eq('id', codeData.id);

  return NextResponse.json({
    ok: true,
    tier: newTier,
    tierLabel: TIER_LABELS[newTier as Tier] ?? tierLabel,
    expiresAt: newExpiresAt,
    description: `${tierLabel} free for ${codeData.months} month${codeData.months === 1 ? '' : 's'}`,
  });
}
