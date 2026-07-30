// lib/acting.ts — "who am I acting as?" resolution for team seats.
//
// A logged-in user is EITHER the account owner (default) or an active team
// member of some owner. Everything DJ-scoped should read/write the resolved
// `djId`, not the raw auth user id. Owners resolve to themselves, so existing
// behavior is unchanged.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

export type ActingRole = 'owner' | 'admin' | 'manager' | 'assistant';

export interface ActingContext {
  authUserId: string;  // the person logged in
  djId: string;        // the account being acted on (owner's id if a member)
  role: ActingRole;
  isMember: boolean;
}

export async function getActingContext(authUserId: string): Promise<ActingContext> {
  const admin = createAdminClient() as unknown as SupabaseClient;
  // limit(1) rather than maybeSingle: a user could (in theory) hold more than one
  // active membership; maybeSingle would ERROR and silently fall back to owner.
  // Accept blocks multi-membership, but read defensively regardless.
  const { data } = await admin
    .from('team_members')
    .select('owner_id, role, status')
    .eq('member_id', authUserId)
    .eq('status', 'active')
    .order('accepted_at', { ascending: true })
    .limit(1);
  const rows = (data as unknown as { owner_id: string; role: string }[] | null) || [];
  const row = rows[0] || null;
  if (row && (row.role === 'admin' || row.role === 'manager' || row.role === 'assistant')) {
    return { authUserId, djId: row.owner_id, role: row.role as ActingRole, isMember: true };
  }
  return { authUserId, djId: authUserId, role: 'owner', isMember: false };
}

// Role → permission helpers (used by UI + server gates in the next phase).
// ── Capability helpers (owner always allowed) ──────────────────────────────
// Manager+ actions: accept/deny bookings, send contracts, request deposits,
// add manual bookings, edit saved default templates + settings, take money.
const isManagerPlus = (r: ActingRole | string): boolean => r === 'owner' || r === 'admin' || r === 'manager';
// Assistant+ actions: everyone with a seat. Send documents (planner/playlist,
// rider/guest list, flyer) and send invoices.
const isAssistantPlus = (r: ActingRole | string): boolean => isManagerPlus(r) || r === 'assistant';

export const canMoney = isManagerPlus;          // legacy alias (money-state changes)
export const canSettings = isManagerPlus;
export const canBilling = (r: ActingRole | string): boolean => r === 'owner';
export const canManageTeam = (r: ActingRole | string): boolean => r === 'owner' || r === 'admin';

// Manager+ only
export const canAcceptBookings = isManagerPlus; // accept/deny/counter, add manual bookings
export const canSendContracts = isManagerPlus;
export const canRequestDeposit = isManagerPlus;
// Assistant+ (all seats)
export const canInvoice = isAssistantPlus;      // send an invoice / receipt
export const canSendDocs = isAssistantPlus;     // planner, playlist, rider, guest list, flyer
