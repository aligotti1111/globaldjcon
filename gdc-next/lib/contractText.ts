// Client-safe contract constants (no server-only imports). Used by both the
// contract editors (client components) and the server template builder.

// Booking-data fields the standard contract can auto-fill per booking.
export const CONTRACT_DATA_FIELDS = [
  'client_name', 'dj_name', 'event_date', 'event_type', 'venue_name',
  'event_address', 'start_time', 'end_time', 'package',
  'set_type', 'equipment', 'duration', 'overtime_rate', 'price', 'deposit', 'payment_terms',
  'cocktail_hour', 'tax', 'grand_total', 'agreement_date',
] as const;

// Shared clauses used by both contract types.
const SHARED_CLAUSES = `PAYMENT
{{payment_terms}}

CANCELLATION
The deposit, if any, is non-refundable, as it reserves the date exclusively for the Client. Cancellations made within 14 days of the event remain subject to the full balance. Should the DJ be unable to perform due to circumstances beyond their control, the DJ will arrange a suitable replacement or refund payments made, up to the amount paid.

CLIENT RESPONSIBILITIES
The Client will provide access to the venue for setup, along with adequate power and space for the DJ's equipment. The Client is responsible for communicating any venue rules, sound limits, or curfews in advance.

OVERTIME
Performance beyond the scheduled end time may be arranged on the day at the DJ's overtime rate, subject to venue approval.

EQUIPMENT
All equipment provided remains the property of the DJ. The Client is responsible for damage caused by guests to the DJ's equipment.

CIRCUMSTANCES BEYOND CONTROL
Neither party is liable for failure to perform due to events beyond reasonable control, such as illness, severe weather, venue closure, or power failure. In such cases, both parties will work in good faith toward a fair resolution or rescheduled date.

AGREEMENT
This document reflects the full agreement between both parties. Any changes will be made in writing and agreed by both. The DJ's total liability under this agreement is limited to the total fee paid.`;
// NOTE: the SIGNATURES block is NOT in the text — buildContractHtml appends it
// as a two-column layout (DJ on the left, Client on the right, each with the
// name stacked over the signature).

// Mobile DJ contract — private events (weddings, parties, etc.).
export const MOBILE_CONTRACT_TEXT = `DJ SERVICES AGREEMENT

This agreement confirms the booking of {{dj_name}} ("DJ") by {{client_name}} ("Client") for the event detailed below.

Agreement entered on {{agreement_date}}.

EVENT DETAILS
Event: {{event_type}}
Date: {{event_date}}
Time: {{start_time}} - {{end_time}}
Venue: {{venue_name}}
Address: {{event_address}}
Price: {{price}}
Package: {{package}}
Tax: {{tax}}
Total: {{grand_total}}

${SHARED_CLAUSES}`;

// Club/Bar DJ contract — venue bookings (sets, residencies, etc.).
export const CLUB_CONTRACT_TEXT = `DJ SERVICES AGREEMENT

This agreement confirms the booking of {{dj_name}} ("DJ") by {{client_name}} ("Client") for the booking detailed below.

Agreement entered on {{agreement_date}}.

BOOKING DETAILS
Venue: {{venue_name}}
Date: {{event_date}}
Set time: {{start_time}} - {{end_time}}
Set type: {{set_type}}
Equipment: {{equipment}}
Price: {{price}}
Deposit: {{deposit}}
Tax: {{tax}}
Total: {{grand_total}}

${SHARED_CLAUSES}`;

// Wedding DJ contract — mobile DJs only. Wedding-specific wording + fields, on
// top of the shared clauses.
export const WEDDING_CONTRACT_TEXT = `WEDDING DJ SERVICES AGREEMENT

This agreement confirms the booking of {{dj_name}} ("DJ") by {{client_name}} ("Client") for the wedding detailed below.

Agreement entered on {{agreement_date}}.

WEDDING DETAILS
Client/Host: {{client_name}}
Date: {{event_date}}
Cocktail hour: {{cocktail_hour}}
Reception time: {{start_time}} - {{end_time}}
Venue: {{venue_name}}
Address: {{event_address}}
Package: {{package}}
Price: {{price}}
Overtime rate: {{overtime_rate}}/hr
Tax: {{tax}}
Total: {{grand_total}}

SERVICES
The DJ will provide music and MC services for the wedding, including announcements and coordination of key moments (grand entrance, first dance, parent dances, cake cutting, speeches/toasts, bouquet and garter toss, and last dance), and will play music suited to the couple's preferences throughout the reception.

MUSIC & REQUESTS
The Client may provide a must-play list, a do-not-play list, and selections for special moments (ceremony, first dance, parent dances) in advance. The DJ will make reasonable efforts to honor requests, subject to availability and appropriateness for the event.

TIMELINE
The Client will provide the wedding-day timeline and the names to be announced in advance. The DJ will coordinate with the venue, photographer, and planner as needed to keep the reception running on schedule.

${SHARED_CLAUSES}`;

// Pick the right default contract text for a DJ's type.
export function defaultContractText(djType?: string | null): string {
  return djType === 'club' ? CLUB_CONTRACT_TEXT : MOBILE_CONTRACT_TEXT;
}
