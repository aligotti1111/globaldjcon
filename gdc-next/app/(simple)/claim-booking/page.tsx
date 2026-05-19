// /claim-booking — landing page from the booking-invite email's "Add to
// My Account" CTA. Handles two flows:
//
//   1. HOST flow (existing): DJ created a manual booking and emailed the
//      host. Host has an existing account → comes here → email matches
//      booking.host_email → requester_id is set to host.
//
//   2. DJ flow (new): Host/venue created a manual event on /upcoming-events
//      and attached a DJ via email. The DJ already has an account → comes
//      here → email matches booking.dj_email → dj_id is set to the DJ.
//
// Behavior:
//   - Not logged in → /login?redirect=/claim-booking?id=<id>
//   - Logged in but email doesn't match either side → error screen
//   - Logged in with matching email → run the claim, then redirect:
//       - host claim → /booking-requests
//       - DJ claim → /upcoming-bookings

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import styles from './claimBooking.module.css';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ id?: string }>;
}

interface BookingLookup {
  id: string;
  host_email: string | null;
  dj_email: string | null;
  is_manual: boolean;
  requester_id: string | null;
  dj_id: string | null;
}

export default async function ClaimBookingPage({ searchParams }: PageProps) {
  const { id: bookingId } = await searchParams;

  if (!bookingId) {
    return (
      <ErrorScreen
        title="Missing booking id"
        body="This link is missing the booking reference. Please use the link from your email."
      />
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !user.email) {
    const back = `/claim-booking?id=${encodeURIComponent(bookingId)}`;
    redirect(`/login?redirect=${encodeURIComponent(back)}`);
  }

  // Admin lookup of the booking — bypasses RLS since the user may not yet
  // own this row.
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from('bookings')
    .select('id, host_email, dj_email, is_manual, requester_id, dj_id')
    .eq('id', bookingId)
    .maybeSingle<BookingLookup>();

  if (!booking) {
    return (
      <ErrorScreen
        title="Booking not found"
        body="We couldn't find a booking matching this link. It may have been deleted."
      />
    );
  }
  if (!booking.is_manual) {
    return (
      <ErrorScreen
        title="Not a manual booking"
        body="This booking can't be claimed via this link."
      />
    );
  }

  const userEmail = user.email.toLowerCase();
  const hostEmailMatch = booking.host_email?.toLowerCase() === userEmail;
  const djEmailMatch = booking.dj_email?.toLowerCase() === userEmail;

  if (!hostEmailMatch && !djEmailMatch) {
    return (
      <ErrorScreen
        title="Wrong account"
        body={`This invitation was sent to a different email address. You're currently logged in as ${user.email}. Log out and sign in as the invited account to claim this booking.`}
      />
    );
  }

  // ── DJ claim path ──────────────────────────────────────────────────
  if (djEmailMatch) {
    // Verify the user's role is dj; only DJs can be attached as dj_id.
    const { data: profile } = await admin
      .from('users')
      .select('role, dj_type')
      .eq('id', user.id)
      .maybeSingle<{ role: string | null; dj_type: string | null }>();
    if (profile?.role !== 'dj') {
      return (
        <ErrorScreen
          title="DJ account required"
          body="This invitation is for a DJ. You need to be signed in as a DJ to claim it."
        />
      );
    }
    // Already linked → just redirect.
    if (booking.dj_id !== user.id) {
      const { error: updateErr } = await admin
        .from('bookings')
        .update({
          dj_id: user.id,
          dj_email: null,
        } as unknown as never)
        .eq('id', bookingId);
      if (updateErr) {
        return (
          <ErrorScreen
            title="Couldn't link booking"
            body={'Something went wrong: ' + updateErr.message}
          />
        );
      }
    }
    redirect('/upcoming-bookings');
  }

  // ── Host claim path ────────────────────────────────────────────────
  if (booking.requester_id !== user.id) {
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
      return (
        <ErrorScreen
          title="Couldn't link booking"
          body={'Something went wrong: ' + updateErr.message}
        />
      );
    }
  }
  redirect('/booking-requests');
}

function ErrorScreen({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.body}>
      <div className={styles.container}>
        <div className={styles.logo}>
          <Link href="/">
            <h1>GLOBAL DJ CONNECT</h1>
          </Link>
        </div>
        <div className={styles.card}>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.text}>{body}</p>
          <Link href="/booking-requests" className={styles.btn}>Go to booking requests</Link>
        </div>
      </div>
    </div>
  );
}
