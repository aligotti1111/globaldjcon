// Shared registry of which booking fields the DJ can edit from the
// upcoming-bookings card, which tier each is in, and how it maps to a column.
// Imported by BOTH the edit UI (badges, which inputs to show) and the edit API
// route (authoritative apply / change-request creation), so the two can never
// disagree about a field's tier.

export type EditTier = 'notify' | 'approve';

export interface EditFieldDef {
  key: string;          // stable id used in the payload + field_edits keys
  label: string;        // human label for badges + emails
  col: string;          // bookings column it writes to ('price' is special)
  tier: EditTier;       // notify = apply now + FYI; approve = host must approve
  section: 'EVENT' | 'VENUE' | 'HOST' | 'PACKAGE' | 'PRICING';
  kind?: 'text' | 'number' | 'date' | 'time' | 'select';
}

// Final mapping (confirmed with the owner):
//   Event   — event type, guest count   = notify · date, times            = approve
//   Venue   — venue name, room          = notify · venue address          = approve
//   Host    — host name, contact phone  = notify
//   Package — package name              = notify · package details        = approve
//   Pricing — price                     = approve
export const EDIT_FIELDS: EditFieldDef[] = [
  { key: 'event_type',      label: 'Event type',      col: 'event_type',      tier: 'notify',  section: 'EVENT',   kind: 'select' },
  { key: 'guest_count',     label: 'Guest count',     col: 'guest_count',     tier: 'notify',  section: 'EVENT',   kind: 'number' },
  { key: 'event_date',      label: 'Event date',      col: 'event_date',      tier: 'approve', section: 'EVENT',   kind: 'date' },
  { key: 'start_time',      label: 'Start time',      col: 'start_time',      tier: 'approve', section: 'EVENT',   kind: 'time' },
  { key: 'end_time',        label: 'End time',        col: 'end_time',        tier: 'approve', section: 'EVENT',   kind: 'time' },

  { key: 'venue_name',      label: 'Venue name',      col: 'venue_name',      tier: 'notify',  section: 'VENUE',   kind: 'text' },
  { key: 'venue_type',      label: 'Venue type',      col: 'venue_type',      tier: 'notify',  section: 'VENUE',   kind: 'text' },
  { key: 'room_details',    label: 'Room details',    col: 'room_details',    tier: 'notify',  section: 'VENUE',   kind: 'text' },
  { key: 'venue_address',   label: 'Venue address',   col: 'venue_address',   tier: 'approve', section: 'VENUE',   kind: 'text' },

  { key: 'requester_name',  label: 'Host name',       col: 'requester_name',  tier: 'notify',  section: 'HOST',    kind: 'text' },
  { key: 'phone',           label: 'Contact phone',   col: 'phone',           tier: 'notify',  section: 'HOST',    kind: 'text' },

  { key: 'package_title',   label: 'Package name',    col: 'package_title',   tier: 'notify',  section: 'PACKAGE', kind: 'text' },
  { key: 'package_details', label: 'Package details', col: 'package_details', tier: 'approve', section: 'PACKAGE', kind: 'text' },

  { key: 'price',           label: 'Price',           col: 'price',           tier: 'approve', section: 'PRICING', kind: 'number' },
];

export const EDIT_FIELD_BY_KEY: Record<string, EditFieldDef> =
  Object.fromEntries(EDIT_FIELDS.map((f) => [f.key, f]));
