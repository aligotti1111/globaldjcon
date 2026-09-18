// POST /api/promo-preview — public, read-only. Describes what a promo code
// would do (comp or discount), WITHOUT redeeming it, so the signup form can
// show a live discounted price before the account exists. No auth, no side
// effects — it only reads the code tables.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { TIER_LABELS, type Tier } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { code?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }); }
  const code = (body.code || '').trim().toUpperCase();
  if (!code) return NextResponse.json({ ok: false });

  try {
    const admin = createAdminClient() as unknown as SupabaseClient;
    const now = Date.now();

    // Comp code → free access.
    const { data: comp } = await admin
      .from('comp_codes')
      .select('grant_tier, months, expires_at, active, max_uses, uses_count')
      .eq('code', code)
      .maybeSingle<{ grant_tier: number; months: number; expires_at: string | null; active: boolean; max_uses: number | null; uses_count: number }>();
    if (
      comp && comp.active &&
      !(comp.expires_at && new Date(comp.expires_at).getTime() <= now) &&
      !(comp.max_uses != null && comp.uses_count >= comp.max_uses)
    ) {
      const tierLabel = TIER_LABELS[comp.grant_tier as Tier] ?? `Tier ${comp.grant_tier}`;
      return NextResponse.json({
        ok: true, type: 'comp', tier: comp.grant_tier, tierLabel, months: comp.months,
        description: `${tierLabel} free for ${comp.months} month${comp.months === 1 ? '' : 's'}`,
      });
    }

    // Discount code → % off a paid plan.
    const { data: disc } = await admin
      .from('discount_codes')
      .select('percent_off, applies_to, expires_at, active')
      .eq('code', code)
      .maybeSingle<{ percent_off: number; applies_to: 'monthly' | 'yearly' | 'both'; expires_at: string | null; active: boolean }>();
    if (disc && disc.active && !(disc.expires_at && new Date(disc.expires_at).getTime() <= now)) {
      return NextResponse.json({
        ok: true, type: 'discount', percentOff: disc.percent_off, appliesTo: disc.applies_to,
        description: `${disc.percent_off}% off`,
      });
    }

    return NextResponse.json({ ok: false });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
