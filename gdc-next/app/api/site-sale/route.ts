// GET /api/site-sale — public, read-only. Returns the currently-live site-wide
// sales so the homepage + pricing pages can show a banner and discounted prices
// without a login. Only non-sensitive fields are exposed (no Stripe ids).

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getLiveSales } from '@/lib/siteSale';
import { TIER_LABELS, type Tier } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const admin = createAdminClient();
    const live = await getLiveSales(admin);

    // Percent sales → what the cards need to render discounted prices.
    const percentSales = live
      .filter((s) => s.kind === 'percent' && s.percent_off && s.applies_to)
      .map((s) => ({ percentOff: s.percent_off as number, appliesTo: s.applies_to as 'monthly' | 'yearly' | 'both' }));

    // Free (comp) sale → drives a "sign up free" banner for logged-out visitors.
    const freeRow = live.find((s) => s.kind === 'free' && s.grant_tier && s.grant_months);
    const freeSale = freeRow
      ? {
          tier: freeRow.grant_tier as number,
          tierLabel: TIER_LABELS[freeRow.grant_tier as Tier] ?? `Tier ${freeRow.grant_tier}`,
          months: freeRow.grant_months as number,
        }
      : null;

    return NextResponse.json({ percentSales, freeSale });
  } catch (e) {
    // A missing table (pre-migration) or any error just means "no sale".
    console.warn('[site-sale] read skipped', e);
    return NextResponse.json({ percentSales: [], freeSale: null });
  }
}
