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
import NotificationsClient from './NotificationsClient';

export const dynamic = 'force-dynamic';

interface PrefsRow {
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
}

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/notifications');

  const { data: row } = await supabase
    .from('users')
    .select(
      'id, role, sms_phone, sms_enabled, sms_notify_booking_request, sms_notify_booking_status, sms_notify_inbox_message, email_notify_booking_request, email_notify_booking_status, email_notify_inbox_message'
    )
    .eq('id', user.id)
    .single<PrefsRow>();

  if (!row) redirect('/login?redirect=/notifications');

  // Default every toggle to ON unless explicitly stored false. New columns
  // default true at the DB level too, so this is belt-and-suspenders for any
  // row that predates the migration.
  return (
    <NotificationsClient
      userId={row.id}
      init={{
        role: row.role,
        sms_phone: row.sms_phone || '',
        sms_enabled: !!row.sms_enabled,
        sms_notify_booking_request: row.sms_notify_booking_request !== false,
        sms_notify_booking_status: row.sms_notify_booking_status !== false,
        sms_notify_inbox_message: row.sms_notify_inbox_message !== false,
        email_notify_booking_request: row.email_notify_booking_request !== false,
        email_notify_booking_status: row.email_notify_booking_status !== false,
        email_notify_inbox_message: row.email_notify_inbox_message !== false,
      }}
    />
  );
}
