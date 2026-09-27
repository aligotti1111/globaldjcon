// /change/[token] — the HOST's approve/decline page for a DJ's pending booking
// changes. Public (the token is the credential). Loads the whole still-pending
// batch for the booking the token belongs to, shows old → new for each, the
// legal note, and Approve / Decline buttons wired to /api/bookings/change-response.

import type { Metadata } from 'next';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import ChangeRespond from './ChangeRespond';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Review booking changes — Global DJ Connect', robots: { index: false } };

interface ReqRow { id: string; booking_id: string; dj_id: string; field: string; old_value: string | null; new_value: string | null; status: string; }

export default async function ChangePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient() as unknown as SupabaseClient;

  const { data: hit } = await admin.from('booking_change_requests').select('booking_id, dj_id, status').eq('token', token).maybeSingle<{ booking_id: string; dj_id: string; status: string }>();

  let pending: ReqRow[] = [];
  let ctx: { djName: string; when: string | null; venue: string | null } | null = null;
  let resolvedStatus: string | null = hit?.status ?? null;

  if (hit) {
    const { data: pend } = await admin.from('booking_change_requests')
      .select('id, booking_id, dj_id, field, old_value, new_value, status')
      .eq('booking_id', hit.booking_id).eq('status', 'pending');
    pending = (pend || []) as unknown as ReqRow[];
    const { data: bk } = await admin.from('bookings').select('event_date, venue_name, venue_type').eq('id', hit.booking_id).maybeSingle<{ event_date: string | null; venue_name: string | null; venue_type: string | null }>();
    const { data: dj } = await admin.from('users').select('name').eq('id', hit.dj_id).maybeSingle<{ name: string | null }>();
    let when: string | null = null;
    if (bk?.event_date) { try { when = new Date(`${bk.event_date.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); } catch { when = bk.event_date; } }
    ctx = { djName: dj?.name || 'Your DJ', when, venue: bk?.venue_name || bk?.venue_type || null };
    if (pending.length === 0) resolvedStatus = 'done';
  }

  // The DJ cancelled this specific request → the host can no longer act on it.
  const cancelled = hit?.status === 'cancelled' || hit?.status === 'superseded';

  return (
    <ChangeRespond
      token={token}
      valid={!!hit}
      cancelled={cancelled}
      resolved={resolvedStatus === 'approved' || resolvedStatus === 'declined' || resolvedStatus === 'done'}
      ctx={ctx}
      changes={pending.map((r) => ({ label: r.field, old: r.old_value || '—', neu: r.new_value || '—' }))}
    />
  );
}
