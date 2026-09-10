// Team activity log — the one place actions get recorded to the audit trail.
//
// Call logActivity(acting, {...}) from a server route AFTER the action has
// succeeded. It writes one append-only row scoped to the OWNER account
// (acting.djId) and attributed to whoever did it (acting.authUserId + role),
// so the owner's Team page can show "who did what, when".
//
// NON-FATAL: a failed log write must never break the action the user just took,
// so every path is wrapped and swallowed. The log is a record of the action,
// not part of it.

import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActingContext } from '@/lib/acting';

export interface ActivityEntry {
  /** Machine key, e.g. 'booking.accepted', 'payment.confirmed'. */
  action: string;
  /** Human one-liner shown in the log. */
  summary: string;
  /** Optional booking this relates to. */
  bookingId?: string | null;
}

export async function logActivity(acting: ActingContext, entry: ActivityEntry): Promise<void> {
  try {
    // team_activity_log postdates the generated types — one untyped cast, same
    // house pattern as the other new tables.
    const admin = createAdminClient() as unknown as SupabaseClient;
    await admin.from('team_activity_log').insert({
      owner_id: acting.djId,
      actor_id: acting.authUserId,
      actor_role: acting.role,
      action: entry.action,
      summary: entry.summary,
      booking_id: entry.bookingId ?? null,
    } as unknown as never);
  } catch {
    /* non-fatal: never let a log write break the action */
  }
}
