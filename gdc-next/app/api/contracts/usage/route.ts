// GET /api/contracts/usage
//
// The logged-in DJ's signed-contract usage for the current billing cycle:
// { quota, used, remaining, atLimit, cycleEnd }. Drives the "X of N used this
// cycle" indicator in the contract-sending UI. Read-only; the authoritative
// block still happens server-side in /api/contracts/prepare.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { type AccessFields, contractQuotaFor } from '@/lib/access';
import { getContractUsage } from '@/lib/contractQuota';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('users')
    .select('sub_tier, sub_status, sub_period_start, sub_period_end, comp_tier, comp_expires_at, comp_source')
    .eq('id', user.id)
    .maybeSingle();

  const access = (row || {}) as unknown as AccessFields;

  // Free/lapsed DJs have no contract allowance — return a clean zero-state so
  // the UI can decide whether to show an upgrade nudge instead of a meter.
  const quota = contractQuotaFor(access);
  if (quota <= 0) {
    return NextResponse.json({ quota: 0, used: 0, remaining: 0, atLimit: true, cycleEnd: null });
  }

  const usage = await getContractUsage(admin, user.id, access);
  return NextResponse.json({
    quota: usage.quota,
    used: usage.used,
    remaining: usage.remaining,
    atLimit: usage.atLimit,
    cycleEnd: usage.cycleEnd,
  });
}
