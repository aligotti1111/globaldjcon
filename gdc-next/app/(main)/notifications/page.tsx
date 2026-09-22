// /notifications — single home for all notification preferences (email + text).
//
// Server Component: auth gate + fetch the user's notification prefs (both the
// sms_* columns and the email_notify_* columns added alongside them). The
// client component owns all the toggle state + the save.
//
// Reached from:
//   - DJ accounts:     header avatar dropdown (desktop) + burger menu (mobile)
//   - Host/Venue:      a link in Account Settings
//
// The row is typed with a LOCAL interface and read via .single<PrefsRow>(),
// so this page compiles without regenerating types/supabase.ts after the
// email_notify_* migration. The save in the client uses the same
// `as unknown as never` update cast the rest of the app uses.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { canBook, type AccessFields } from '@/lib/access';
import NotificationsClient from './NotificationsClient';

export const dynamic = 'force-dynamic';

interface PrefsRow extends AccessFields {
  id: string;
  role: string;
  sms_phone: string | null;
  sms_enabled: boolean | null;
  sms_notify_booking_request: boolean | null;
  sms_notify_booking_status: boolean | null;
  sms_notify_inbox_message: boolean | null;
  email_notify_booking_request: boolean | null;
  email_notify_booking_status: boolean | null;
  email_notify_inbox_message: boolean | null;
  // Digest opt-ins (default OFF).
  email_notify_weekly_digest: boolean | null;
  email_notify_monthly_digest: boolean | null;
}

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/notifications');

  const { data: row } = await supabase
    .from('users')
    .select(
      'id, role, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, sms_phone, sms_enabled, sms_notify_booking_request, sms_notify_booking_status, sms_notify_inbox_message, email_notify_booking_request, email_notify_booking_status, email_notify_inbox_message, email_notify_weekly_digest, email_notify_monthly_digest'
    )
    .eq('id', user.id)
    .single<PrefsRow>();

  if (!row) redirect('/login?redirect=/notifications');

  // Teammates act on the owner's paid account, so they pass the booking gate;
  // otherwise it's real subscription/comp access.
  const hasBooking = row.role === 'teammate' || canBook(row as AccessFields);

  // Default every toggle to ON unless explicitly stored false. New columns
  // default true at the DB level too, so this is belt-and-suspenders for any
  // row that predates the migration.
  return (
    <NotificationsClient
      userId={row.id}
      init={{
        role: row.role,
        canBook: hasBooking,
        sms_phone: row.sms_phone || '',
        sms_enabled: !!row.sms_enabled,
        sms_notify_booking_request: row.sms_notify_booking_request !== false,
        sms_notify_booking_status: row.sms_notify_booking_status !== false,
        sms_notify_inbox_message: row.sms_notify_inbox_message !== false,
        email_notify_booking_request: row.email_notify_booking_request !== false,
        email_notify_booking_status: row.email_notify_booking_status !== false,
        email_notify_inbox_message: row.email_notify_inbox_message !== false,
        // Digests are opt-IN, so default OFF (only on when explicitly true).
        email_notify_weekly_digest: row.email_notify_weekly_digest === true,
        email_notify_monthly_digest: row.email_notify_monthly_digest === true,
      }}
    />
  );
}
