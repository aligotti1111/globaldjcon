// /claim-booking — landing page from the booking-invite email's "Add to
// My Account" CTA (shown when the host already has an account).
//
// Behavior:
//   - Not logged in → redirect to /login?redirect=/claim-booking?id=<id>
//   - Logged in but email doesn't match the booking's host_email →
//     show an error screen (no claim performed).
//   - Logged in with matching email → run the claim, then redirect to
//     /booking-requests.
//
// Server-side end-to-end — no client JS needed. The claim uses the same
// admin-backed logic as /api/claim-booking but executed inline so the
// page can redirect immediately on success.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import styles from './claimBooking.module.css';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ id?: string }>;
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
    // Bounce to login with a redirect-back URL so the user comes right
    // back here after authenticating.
    const back = `/claim-booking?id=${encodeURIComponent(bookingId)}`;
    redirect(`/login?redirect=${encodeURIComponent(back)}`);
  }

  // Look up the booking via admin to bypass RLS — we need to check
  // host_email even if the current user can't yet read this booking.
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from('bookings')
    .select('id, host_email, is_manual, requester_id')
    .eq('id', bookingId)
    .maybeSingle<{ id: string; host_email: string | null; is_manual: boolean; requester_id: string | null }>();

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
  if (!booking.host_email || booking.host_email.toLowerCase() !== user.email.toLowerCase()) {
    return (
      <ErrorScreen
        title="Wrong account"
        body={`This invitation was sent to a different email address. You're currently logged in as ${user.email}. Log out and sign in as the invited account to claim this booking.`}
      />
    );
  }

  // Already claimed by this user — skip the update, just redirect.
  if (booking.requester_id !== user.id) {
    // Look up the host's name for requester_name so the booking renders
    // nicely on the DJ's side.
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

  // All good — send them to booking-requests where the booking now
  // shows up in their outgoing tab.
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
