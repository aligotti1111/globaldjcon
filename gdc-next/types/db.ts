// Domain types for Global DJ Connect.
// These mirror the Supabase tables. The new dev should regenerate these from
// the live schema with: npx supabase gen types typescript --project-id hwqvzuusquruhwguqole

export type Role = 'dj' | 'venue' | 'host' | 'admin';

export type DjType = 'club' | 'mobile';

export type BookingStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'cancelled'
  | 'countered';

export type BookingType = 'club' | 'mobile';

export type Currency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'JPY' | 'MXN' | 'BRL' | 'CHF' | 'SEK' | 'NOK' | 'DKK' | 'NZD' | 'SGD' | 'ZAR' | 'AED' | 'INR';

// User profile from public.users.
// IMPORTANT: `email` is NOT here — email lives in auth.users only.
// Use AuthUser (below) when you need the email.
export interface UserProfile {
  id: string;
  name: string;
  role: Role;
  slug: string | null;
  zip: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  dj_type: DjType | null;
  email_verified: boolean;
  blocked_users: string[] | null;
  booking_settings: string | null; // JSON-stringified
  created_at: string;
  updated_at: string;
}

// The "current user" object the app actually uses — profile + auth email merged.
// This is what useUser() returns. Replaces the inconsistent sessionStorage
// pattern from the vanilla JS version.
export interface CurrentUser extends UserProfile {
  email: string; // from auth.users
}

export interface Booking {
  id: string;
  dj_id: string;
  requester_id: string;
  booking_type: BookingType;
  event_date: string; // YYYY-MM-DD
  venue_name: string | null;
  venue_address: string | null;
  venue_type: string | null;
  set_type: string | null;
  start_time: string | null;
  end_time: string | null;
  equipment: string | null;
  notes: string | null;
  offer_amount: number | null;
  quoted_rate: number | null;
  counter_rate: number | null;
  currency: Currency | null;
  status: BookingStatus;
  // Mobile-specific
  package_title: string | null;
  package_category: string | null;
  total_price: number | null;
  deposit_amount: number | null;
  deposit_pct: number | null;
  is_quote: boolean;
  created_at: string;
  updated_at: string;
}
