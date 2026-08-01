// Server-only: record that the CLIENT viewed a host page for a booking stage.
//
// This is the spam-safe alternative to email open-tracking pixels: nothing is
// added to the email. When the client opens one of OUR hosted pages (planner,
// rider, guest list) — pages the email already links to — we stamp the FIRST
// view time on bookings.email_opens[stage]. The DJ sees "Viewed <date>".
//
// We skip the DJ's own visits (owner id === dj_id) so a DJ opening the host
// link to check it doesn't count as the client viewing it.

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function recordStageView(bookingId: string, stage: string, djId: string | null): Promise<void> {
  try {
    // Don't count the DJ (owner) viewing their own host link.
    const supa = await createClient();
    const { data: { user } } = await supa.auth.getUser();
    if (user && djId && user.id === djId) return;

    const admin = createAdminClient();
    const { data } = await admin.from('bookings').select('email_opens').eq('id', bookingId).maybeSingle();
    const cur = ((data as { email_opens?: Record<string, string> | null } | null)?.email_opens) || {};
    if (cur[stage]) return; // keep the FIRST view
    await admin
      .from('bookings')
      .update({ email_opens: { ...cur, [stage]: new Date().toISOString() } } as unknown as never)
      .eq('id', bookingId);
  } catch { /* non-fatal — never break the page over a view stamp */ }
}
