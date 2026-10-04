// Monthly signed-contract quota — the usage side of the tier system.
//
// Each paid tier allows N contracts per BILLING CYCLE (see CONTRACT_QUOTA in
// lib/access.ts). A contract occupies a slot only once it is COMPLETED — i.e.
// signed by BOTH parties — because that's when it actually counts against the
// plan (sending/drafting a contract is free; nothing is consumed until it's
// fully executed). We don't keep a counter column — the count is derived live
// from the bookings table, so it can never drift out of sync with reality.
//
// Window: the DJ's own Stripe billing period [sub_period_start, sub_period_end)
// — persisted by the webhook. If a DJ has no period on file (e.g. an admin
// comp, or before the first webhook backfills it), we fall back to the current
// CALENDAR month so the count is always bounded to ~one cycle.
//
// A contract "occupies a slot" when the booking's contract_status is 'signed'
// (set by the DocuSeal completion webhook once both parties have signed) and
// its contract_signed_at falls inside the window. One booking = one slot; the
// enforcement call excludes the current booking so a re-check isn't off by one.

import type { SupabaseClient } from '@supabase/supabase-js';
import { type AccessFields, contractQuotaFor } from './access';

function monthWindow(now: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

export interface ContractUsage {
  quota: number;        // slots this cycle for the DJ's tier (0 = free/lapsed)
  used: number;         // slots occupied by OTHER bookings this cycle
  remaining: number;    // max(0, quota - used)
  atLimit: boolean;     // true when there's no room for a new contract
  cycleStart: string;
  cycleEnd: string;
}

/**
 * How many contract slots the DJ has used this cycle, and whether there's room
 * for one more. Pass `excludeBookingId` when checking a specific booking so a
 * RE-SEND of a contract already counted this cycle isn't blocked.
 */
export async function getContractUsage(
  admin: SupabaseClient,
  djId: string,
  access: AccessFields,
  opts: { excludeBookingId?: string; now?: Date } = {},
): Promise<ContractUsage> {
  const now = opts.now ?? new Date();
  const quota = contractQuotaFor(access, now);

  const fallback = monthWindow(now);
  const cycleStart = access.sub_period_start || fallback.start;
  const cycleEnd = access.sub_period_end || fallback.end;

  // Only fully-completed contracts count: contract_status === 'signed' (both
  // parties signed, set by the completion webhook) with a signed timestamp in
  // this cycle. Sent-but-unsigned and cancelled/declined contracts don't count.
  let q = admin
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('dj_id', djId)
    .eq('contract_status', 'signed')
    .not('contract_signed_at', 'is', null)
    .gte('contract_signed_at', cycleStart)
    .lt('contract_signed_at', cycleEnd);
  if (opts.excludeBookingId) q = q.neq('id', opts.excludeBookingId);

  const { count } = await q;
  const used = count ?? 0;
  const remaining = Math.max(0, quota - used);
  // No room when the quota is already filled by other bookings. A zero quota
  // (free/lapsed) is always at-limit — but canUsePro() blocks those first.
  const atLimit = used >= quota;

  return { quota, used, remaining, atLimit, cycleStart, cycleEnd };
}
