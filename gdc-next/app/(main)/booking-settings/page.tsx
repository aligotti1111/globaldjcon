// /booking-settings — DJ-only page for configuring bookings.
//
// The booking configuration used to live as a tab inside /update-dj-profile.
// It now has its own page so DJs reach it directly from the header/menu.
// This server component just auth-gates + hydrates; BookingSettingsClient
// owns the booking_settings state, autosave, and renders the existing
// BookingTab / ClubBookingTab components unchanged.
//
// The "activate first" gate the spec describes is already built into those
// tab components: when booking_enabled is off they render the activation
// toggle; when on they render the full settings.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext, canDiscounts } from '@/lib/acting';
import { canBook, type AccessFields } from '@/lib/access';
import BookingSettingsClient from './BookingSettingsClient';
import DiscountsOnlyClient from './DiscountsOnlyClient';

export const dynamic = 'force-dynamic';

interface ProfileRow {
  id: string;
  role: string;
  dj_type: 'club' | 'mobile' | null;
  slug: string | null;
  booking_settings: string | null;
  event_types: string | null;
  sub_tier: number | null;
  sub_status: string | null;
  sub_period_end: string | null;
  comp_tier: number | null;
  comp_expires_at: string | null;
}

export default async function BookingSettingsPage() {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) redirect('/login?redirect=/booking-settings');
  // Booking settings are Owner-only — with ONE exception: managers & admins may
  // reach a DISCOUNTS-ONLY view (see discountsOnly below) to create promo codes
  // and sales. Assistants (and any other member) still get sent to the bookings
  // they can work.
  const acting = await getActingContext(authUser.id);
  const discountsOnly = acting.isMember;
  if (acting.isMember && !canDiscounts(acting.role)) redirect('/upcoming-bookings');

  // A member acts on the OWNER's account, so the row we configure is the
  // owner's (acting.djId) — read with the service-role client since a teammate
  // can't select the owner's users row directly. Owners read their own row.
  const SELECT = 'id, role, dj_type, slug, booking_settings, event_types, mob_custom_event_types, mob_specialty_types, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at';
  const { data: row } = acting.isMember
    ? await createAdminClient().from('users').select(SELECT).eq('id', acting.djId).single<ProfileRow>()
    : await supabase.from('users').select(SELECT).eq('id', acting.djId).single<ProfileRow>();

  if (!row) redirect('/login?error=profile_not_found');

  // DJ-only. Hosts/venues don't take bookings, so send them to their settings.
  // (The owner account behind a member seat is always a DJ.)
  if (row.role !== 'dj') redirect('/account-settings');

  // Whether booking is actually LIVE (subscription/comp). DJs can configure
  // everything regardless, but nothing goes public until this is true.
  const hasBookingAccess = canBook(row as unknown as AccessFields);

  // Manager/admin teammate: show ONLY the Discounts & Promo Codes box, saving
  // to the owner's account through /api/dj/discounts. The full settings page
  // stays owner-only.
  if (discountsOnly) {
    return <DiscountsOnlyClient bookingSettings={row.booking_settings} />;
  }

  return (
    <BookingSettingsClient
      hasBookingAccess={hasBookingAccess}
      initialProfile={{
        id: row.id,
        dj_type: row.dj_type,
        slug: row.slug,
        booking_settings: row.booking_settings,
        event_types: row.event_types,
        mob_custom_event_types: (row as { mob_custom_event_types?: unknown }).mob_custom_event_types,
        mob_specialty_types: (row as { mob_specialty_types?: unknown }).mob_specialty_types,
      }}
    />
  );
}
