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
import { getActingContext } from '@/lib/acting';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // Teammates see the OWNER's contract allowance, not their own empty one.
  const acting = await getActingContext(user.id);

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('users')
    .select('sub_tier, sub_status, sub_period_start, sub_period_end, comp_tier, comp_expires_at, comp_source')
    .eq('id', acting.djId)
    .maybeSingle();

  const access = (row || {}) as unknown as AccessFields;

  // Free/lapsed DJs have no contract allowance — return a clean zero-state so
  // the UI can decide whether to show an upgrade nudge instead of a meter.
  const quota = contractQuotaFor(access);
  if (quota <= 0) {
    return NextResponse.json({ quota: 0, used: 0, remaining: 0, atLimit: true, cycleEnd: null });
  }

  const usage = await getContractUsage(admin, acting.djId, access);

  // Pending contracts: SENT and awaiting the client's signature — i.e. actually
  // out in the world, in flight, not yet completed. This mirrors exactly what
  // the booking dashboard labels "Pending": only awaiting_client.
  //
  // awaiting_dj is deliberately EXCLUDED — the contract exists but the DJ hasn't
  // signed it yet, so it has NOT gone out. The dashboard reads that as "Not Sent",
  // not "Pending", so counting it here would overstate what's in flight. Deleted
  // bookings are excluded too so stale rows don't inflate the number.
  let pending = 0;
  try {
    const { count } = await (admin as unknown as import('@supabase/supabase-js').SupabaseClient)
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('dj_id', acting.djId)
      .is('deleted_at', null)
      .eq('contract_status', 'awaiting_client');
    pending = count ?? 0;
  } catch { /* non-fatal */ }

  return NextResponse.json({
    quota: usage.quota,
    used: usage.used,
    remaining: usage.remaining,
    atLimit: usage.atLimit,
    cycleEnd: usage.cycleEnd,
    pending,
  });
}
