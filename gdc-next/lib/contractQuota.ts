// Monthly signed-contract quota — the usage side of the tier system.
//
// Each paid tier allows N contracts per BILLING CYCLE (see CONTRACT_QUOTA in
// lib/access.ts). A contract occupies a slot the moment the DJ SENDS it, and
// the slot is FREED if the contract falls through (declined / voided /
// cancelled). We don't keep a counter column — the count is derived live from
// the bookings table, so it can never drift out of sync with reality.
//
// Window: the DJ's own Stripe billing period [sub_period_start, sub_period_end)
// — persisted by the webhook. If a DJ has no period on file (e.g. an admin
// comp, or before the first webhook backfills it), we fall back to the current
// CALENDAR month so the count is always bounded to ~one cycle.
//
// A contract "occupies a slot" when the booking has a contract_sent_at inside
// the window AND its contract_status is not one of the dead states. Re-sending
// the SAME booking's contract does not consume a second slot: it's one booking
// row, and the enforcement call excludes the current booking when it checks
// whether there's room.

import type { SupabaseClient } from '@supabase/supabase-js';
import { type AccessFields, contractQuotaFor } from './access';

// Statuses where the contract fell through — the slot is returned.
const DEAD_STATUSES = ['cancelled', 'declined', 'voided'];

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

  let q = admin
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('dj_id', djId)
    .not('contract_sent_at', 'is', null)
    .gte('contract_sent_at', cycleStart)
    .lt('contract_sent_at', cycleEnd)
    .not('contract_status', 'in', `(${DEAD_STATUSES.join(',')})`);
  if (opts.excludeBookingId) q = q.neq('id', opts.excludeBookingId);

  const { count } = await q;
  const used = count ?? 0;
  const remaining = Math.max(0, quota - used);
  // No room when the quota is already filled by other bookings. A zero quota
  // (free/lapsed) is always at-limit — but canUsePro() blocks those first.
  const atLimit = used >= quota;

  return { quota, used, remaining, atLimit, cycleStart, cycleEnd };
}
