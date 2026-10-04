// /api/claim-booking — server-side claim of a manual booking by a newly
// signed-up host. Required because the bookings table RLS doesn't permit
// a host to UPDATE a row they don't yet own (requester_id != auth.uid()).
//
// Flow:
//   1. Client sends { bookingId } in POST body — auth comes from the
//      session cookie (createClient() reads it).
//   2. We verify the authenticated user's email matches the booking's
//      host_email AND the booking is is_manual=true. This is the same
//      ownership check we'd do client-side, but enforced here so the
//      admin client can bypass RLS for the actual update.
//   3. If valid, update requester_id + requester_name to the new user.
//   4. Return { ok: true } or appropriate error.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { bookingId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const bookingId = body.bookingId;
  if (!bookingId || typeof bookingId !== 'string') {
    return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Look up the booking + verify ownership via host_email match.
  const { data: booking, error: lookupErr } = await admin
    .from('bookings')
    .select('id, host_email, is_manual, requester_id')
    .eq('id', bookingId)
    .maybeSingle<{ id: string; host_email: string | null; is_manual: boolean; requester_id: string | null }>();

  if (lookupErr) {
    return NextResponse.json({ error: 'Lookup failed: ' + lookupErr.message }, { status: 500 });
  }
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }
  if (!booking.is_manual) {
    return NextResponse.json({ error: 'Not a manual booking' }, { status: 400 });
  }
  if (!booking.host_email || booking.host_email.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: 'Email does not match booking invitation' }, { status: 403 });
  }
  // If already claimed by someone else (not the DJ), reject. The DJ's id
  // is the initial requester_id at creation time — if requester_id has
  // already been swapped to another non-DJ user, that's a prior claim.
  // (We can't easily check "not the DJ" without an extra fetch — but
  // running the update again with the same final state is idempotent,
  // so this isn't a correctness problem; we just don't gate on it.)

  // Fetch the user's name from public.users so the booking's
  // requester_name reflects the host, not the DJ.
  const { data: profile } = await admin
    .from('users')
    .select('name')
    .eq('id', user.id)
    .maybeSingle<{ name: string | null }>();

  const { error: updateErr } = await admin
    .from('bookings')
    .update({
      requester_id: user.id,
      requester_name: profile?.name || null,
    } as unknown as never)
    .eq('id', bookingId);

  if (updateErr) {
    return NextResponse.json({ error: 'Update failed: ' + updateErr.message }, { status: 500 });
  }

  // CLAIM EVERYTHING BY EMAIL. The host likely has OTHER manual bookings under
  // the same email (past gigs, other dates with this or another DJ). Claiming
  // the one in the link and leaving the rest invisible would be confusing, so we
  // sweep every manual booking whose host_email matches this account and attach
  // them too — each carries its own contract/deposit/planner history, keyed to
  // the booking, so they appear fully-populated in Upcoming Events.
  //
  // Authorization is the email match (same rule as the single claim above).
  // A manual booking starts owned by its DJ (requester_id = dj_id), so "not yet
  // claimed by a host" means requester_id is null OR requester_id === dj_id. We
  // NEVER reassign a booking already claimed by a real host (a different user),
  // which is why we filter in JS on the dj_id/null condition rather than a blind
  // update. Best-effort: a failure here doesn't undo the primary claim above.
  let alsoClaimed = 0;
  try {
    const { data: mine } = await admin
      .from('bookings')
      .select('id, dj_id, requester_id')
      .eq('is_manual', true)
      .ilike('host_email', user.email)
      .is('deleted_at', null);
    const rows = (mine as { id: string; dj_id: string | null; requester_id: string | null }[] | null) || [];
    const toClaim = rows
      .filter((b) => b.id !== bookingId && (!b.requester_id || b.requester_id === b.dj_id))
      .map((b) => b.id);
    if (toClaim.length > 0) {
      const { error: sweepErr } = await admin
        .from('bookings')
        .update({ requester_id: user.id, requester_name: profile?.name || null } as unknown as never)
        .in('id', toClaim);
      if (!sweepErr) alsoClaimed = toClaim.length;
    }
  } catch { /* non-fatal — the primary claim already succeeded */ }

  return NextResponse.json({ ok: true, alsoClaimed });
}
