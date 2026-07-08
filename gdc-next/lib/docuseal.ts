// Server-only DocuSeal client + shared contract constants.
//
// SERVER-ONLY. Reads DOCUSEAL_API_KEY from the environment (set in Netlify).
// Never import this into a Client Component.

import docuseal from '@docuseal/api';

let configured = false;

export function getDocuseal() {
  const key = process.env.DOCUSEAL_API_KEY;
  if (!key) throw new Error('DOCUSEAL_API_KEY is not set');
  if (!configured) {
    docuseal.configure({ key, url: 'https://api.docuseal.com' });
    configured = true;
  }
  return docuseal;
}

export const ROLE_DJ = 'DJ';
export const ROLE_CLIENT = 'Client';

// Booking-data fields the standard contract can auto-fill per booking.
export const CONTRACT_DATA_FIELDS = [
  'client_name', 'dj_name', 'event_date', 'event_type', 'venue_name',
  'event_address', 'start_time', 'end_time', 'package', 'price', 'deposit',
  'payment_terms',
] as const;

// The editable standard Mobile DJ contract. DJs start from this and tweak the
// wording. Friendly {{tags}} auto-fill per booking; {{dj_signature}} and
// {{client_signature}} become signature blocks. Kept plain but professional.
export const STANDARD_CONTRACT_TEXT = `DJ SERVICES AGREEMENT

This agreement confirms the booking of {{dj_name}} ("DJ") by {{client_name}} ("Client") for the event detailed below.

EVENT DETAILS
Event: {{event_type}}
Date: {{event_date}}
Time: {{start_time}} - {{end_time}}
Venue: {{venue_name}}, {{event_address}}
Package: {{package}}

PAYMENT
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
This document reflects the full agreement between both parties. Any changes will be made in writing and agreed by both. The DJ's total liability under this agreement is limited to the total fee paid.

SIGNATURES

DJ: {{dj_signature}}   {{dj_name}}

Client: {{client_signature}}   {{client_name}}`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Translate friendly tags in the (already HTML-escaped) text into DocuSeal HTML
// field ELEMENTS (text-field / signature-field). For HTML templates DocuSeal
// only recognizes these elements, not {{...}} text tags. Data fields are
// pre-filled (role DJ) per booking; signatures are collected from each party.
function translateTags(escaped: string): string {
  let out = escaped;
  out = out.replace(
    /\{\{\s*dj_signature\s*\}\}/gi,
    '<signature-field name="DJ Signature" role="DJ" style="width:220px;height:44px;display:inline-block;"></signature-field>',
  );
  out = out.replace(
    /\{\{\s*client_signature\s*\}\}/gi,
    '<signature-field name="Client Signature" role="Client" style="width:220px;height:44px;display:inline-block;"></signature-field>',
  );
  for (const f of CONTRACT_DATA_FIELDS) {
    const re = new RegExp(`\\{\\{\\s*${f}\\s*\\}\\}`, 'gi');
    out = out.replace(
      re,
      `<text-field name="${f}" role="DJ" required="false" style="width:180px;height:16px;display:inline-block;"></text-field>`,
    );
  }
  return out;
}

// Build the full HTML document for the contract from the DJ's edited text,
// optionally with a logo at the top. Field tags are left intact for DocuSeal.
export function buildContractHtml(text: string, logoUrl?: string | null): string {
  // Escape everything, THEN re-open the tag braces so DocuSeal still sees {{}}.
  // (escapeHtml doesn't touch braces, so tags survive; translateTags then
  // converts them.)
  const escaped = escapeHtml(text);
  const withTags = translateTags(escaped);
  const body = withTags
    .split('\n')
    .map((line) => (line.trim() === '' ? '<div style="height:10px"></div>' : `<div>${line}</div>`))
    .join('');
  const logo = logoUrl
    ? `<div style="text-align:center;margin-bottom:18px"><img src="${logoUrl}" style="max-height:90px;max-width:260px" /></div>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.55;color:#111;padding:36px}
    div{white-space:pre-wrap}
  </style></head><body>${logo}${body}</body></html>`;
}
