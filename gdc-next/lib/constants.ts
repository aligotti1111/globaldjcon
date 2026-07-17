// Centralized constants for Global DJ Connect.
//
// Single source of truth for label maps, currency symbols, and string
// enums. Before this file, these were duplicated across 3+ components
// (CURRENCY_SYMBOLS appeared in ClubBookingForm, ClubBookingCard, and
// CounterModal — each with slightly different keys). Drift was inevitable.
//
// When adding a new event type / equipment option / currency:
//   1. Add it here
//   2. (optional) Add a TypeScript union type below for compile-time safety
//   3. Use the constant — never inline the string elsewhere
//
// Constants are grouped by domain. Keep them in alphabetical order within
// each group so future additions land in a predictable spot.

// ───────────────────────────────────────────────────────────────────
// CURRENCY
// ───────────────────────────────────────────────────────────────────

// ISO 4217 currency codes the DJ form lets the user pick. Anything else
// gets rendered as the raw code (no symbol).
export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: '$',
  AUD: '$',
  JPY: '¥',
  KRW: '₩',
  CNY: '¥',
  INR: '₹',
  BRL: 'R$',
  MXN: '$',
};

// Symbol-or-fallback helper. Use this everywhere instead of indexing
// CURRENCY_SYMBOLS directly so the fallback is consistent.
export function currencySymbol(code: string | null | undefined): string {
  return CURRENCY_SYMBOLS[code || 'USD'] || '$';
}

// ───────────────────────────────────────────────────────────────────
// MOBILE DJ — event types
// Used by mobile DJ profiles + booking forms (event_type column on
// public.bookings). The labels here are what the booker sees.
//
// NOTE ON THE RULE ABOVE ("never inline the string elsewhere"):
// this map is currently copied, not imported, in three places —
//   • app/(main)/[slug]/mobileBookingForm.ts  (MOB_EVENT_TYPE_LABELS)
//   • app/api/send-email/route.ts
//   • app/(main)/upcoming-events/UpcomingEventsClient.tsx
// which is why splitting one event type is a ten-file change. Those three
// are identical to this map and could genuinely be replaced by an import.
//
// The two OTHER label maps are NOT duplicates and must not be merged in:
// [slug]/constants.ts and update-dj-profile/constants.ts use the PLURAL
// ("Weddings", "Sweet 16s") because they label what a DJ offers. This map is
// singular ("Wedding", "Sweet 16") because it labels one booking. Same keys,
// different sentence.
// ───────────────────────────────────────────────────────────────────

export const MOB_EVENT_LABELS: Record<string, string> = {
  weddings: 'Wedding',
  birthday: 'Birthday Party',
  corporate: 'Corporate Event',
  anniversary: 'Anniversary',
  graduation: 'Graduation',
  // Split from a single 'sweet16' => 'Sweet 16 / Quinceañera' entry. They're
  // two different parties — a quinceañera has its own running order, its own
  // traditions — and a DJ who does one may not do the other. The combined
  // option made a booker pick a label that was half wrong either way.
  sweet16: 'Sweet 16',
  quinceanera: 'Quinceañera',
  mitzvah: 'Bar/Bat Mitzvah',
  reunion: 'Reunion',
  holiday: 'Holiday Party',
  school: 'School Event',
  community: 'Community Event',
  other: 'Other',
};

// Compile-time union of valid mobile event types — derived from the
// label map so it can never go out of sync.
export type MobEventType = keyof typeof MOB_EVENT_LABELS;

// ───────────────────────────────────────────────────────────────────
// CLUB DJ — set types
// Used by club DJ booking forms + cards (set_type column on
// public.bookings).
// ───────────────────────────────────────────────────────────────────

export const CLUB_SET_TYPE_LABELS: Record<string, string> = {
  opening: 'Opening Set',
  headliner: 'Headliner',
  closing: 'Closing Set',
  opening_close: 'Opening – Close',
  opening_and_closing: 'Opening & Closing',
};

export type ClubSetType = keyof typeof CLUB_SET_TYPE_LABELS;

// ───────────────────────────────────────────────────────────────────
// CLUB DJ — equipment / venue type
// equipment column on public.bookings indicates who provides the gear.
// venue_type indicates whether it's a bar or a club.
// ───────────────────────────────────────────────────────────────────

export const CLUB_EQUIPMENT_LABELS: Record<string, string> = {
  sound_system: 'DJ provides Sound System & Decks',
  decks_only: 'DJ provides Decks/Controller only',
  venue_provides: 'Venue provides all equipment',
};

export type ClubEquipment = keyof typeof CLUB_EQUIPMENT_LABELS;

export const CLUB_VENUE_TYPE_LABELS: Record<string, string> = {
  bar: 'Bar',
  club: 'Club',
};

export type ClubVenueType = keyof typeof CLUB_VENUE_TYPE_LABELS;

// ───────────────────────────────────────────────────────────────────
// BOOKING — status
// status column on public.bookings. Values match what the DB stores
// AND what BookingCardShell expects for class lookups.
// ───────────────────────────────────────────────────────────────────

export type BookingStatus = 'pending' | 'approved' | 'denied' | 'counter' | 'cancelled';

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
  counter: 'Countered',
  cancelled: 'Cancelled',
};

// ───────────────────────────────────────────────────────────────────
// BOOKING — booking_type
// booking_type column on public.bookings. Distinguishes mobile vs
// club bookings so the right card variant + payload is used.
// ───────────────────────────────────────────────────────────────────

export type BookingType = 'mobile' | 'club';

// ───────────────────────────────────────────────────────────────────
// USERS — roles
// role column on public.users. Drives navigation, permissions, and
// which tabs/forms render on signup + account settings.
// ───────────────────────────────────────────────────────────────────

export type UserRole = 'dj' | 'venue' | 'host' | 'admin';

// ───────────────────────────────────────────────────────────────────
// USERS — DJ subtype
// dj_type column on public.users. Mobile DJs travel to events;
// club DJs play at venues. Drives which booking form a visitor sees
// on the DJ's profile.
// ───────────────────────────────────────────────────────────────────

export type DjType = 'mobile' | 'club';
