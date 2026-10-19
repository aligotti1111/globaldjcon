// lib/emails/recipients.ts
//
// Server-side recipient resolution for booking-related emails.
//
// WHY THIS EXISTS (security): /api/send-email renders Global-DJ-Connect-branded
// mail and can address any inbox. Historically each booking branch took its
// recipient straight from the request body (body.djEmail / body.recipientEmail
// / body.hostEmail), so any authenticated user could POST a booking email type
// with an arbitrary recipient and relay branded phishing/spam — names, prices,
// and CTA links all attacker-controlled — without ever touching a real booking.
//
// This module makes the recipient a property OF THE BOOKING ROW rather than of
// the request. Every booking email resolves its recipient through here from the
// booking's own party fields. Combined with the per-booking ownership gate in
// the route (the caller must be a party to the booking), the recipient can only
// ever be the other party of a booking the caller already owns — the relay is
// closed structurally, not by scattered per-branch checks.

import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';

// Booking ids are v4 UUIDs; reject anything that isn't shaped like one before
// hitting the DB so a malformed id can't widen a query.
const UUID_RE = /^[0-9a-f-]{36}$/i;

export interface BookingParties {
  id: string;
  djId: string | null;
  requesterId: string | null;
  // booking.host_email — the host address the DJ entered on a MANUAL booking,
  // before that host has an account. The host party's deliverable address when
  // requester_id is null.
  hostEmail: string | null;
  // booking.dj_email — the DJ address a host entered when adding a DJ to an
  // event, before that DJ has (or is linked to) an account.
  djInviteEmail: string | null;
  // Resolved from dj_id / requester_id via the admin API (account emails).
  djEmail: string | null;
  requesterEmail: string | null;
}

// Load a booking's parties + their deliverable addresses, all server-side.
// Returns null for a missing/malformed id so callers 400/404.
export async function loadBookingParties(bookingId: unknown): Promise<BookingParties | null> {
  if (typeof bookingId !== 'string' || !UUID_RE.test(bookingId)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from('bookings')
    .select('id, dj_id, requester_id, host_email, dj_email')
    .eq('id', bookingId)
    .maybeSingle();
  const row = data as {
    id: string;
    dj_id: string | null;
    requester_id: string | null;
    host_email: string | null;
    dj_email: string | null;
  } | null;
  if (!row) return null;
  const [djEmail, requesterEmail] = await Promise.all([
    row.dj_id ? resolveUserEmail(row.dj_id) : Promise.resolve(null),
    row.requester_id ? resolveUserEmail(row.requester_id) : Promise.resolve(null),
  ]);
  return {
    id: row.id,
    djId: row.dj_id,
    requesterId: row.requester_id,
    hostEmail: row.host_email,
    djInviteEmail: row.dj_email,
    djEmail,
    requesterEmail,
  };
}

export type BookingPartyRole = 'dj' | 'host';

// The deliverable address for one party of a booking, bound to the row.
//   'dj'   → the DJ's account email, else the pre-account invite email.
//   'host' → the booker's account email, else the manual-booking host email.
// Returns null when that party has no address on file; callers 400.
export function recipientForParty(
  parties: BookingParties,
  role: BookingPartyRole,
): string | null {
  if (role === 'dj') return parties.djEmail || parties.djInviteEmail || null;
  // DJ-created MANUAL bookings store requester_id = the DJ's own id (they own
  // both sides of the row); the real host lives only in host_email. In that
  // case the account email behind requester_id is the DJ's — not the host's —
  // so prefer host_email, or we'd mail host-facing notices back to the DJ.
  if (parties.requesterId && parties.requesterId === parties.djId) {
    return parties.hostEmail || null;
  }
  return parties.requesterEmail || parties.hostEmail || null;
}
