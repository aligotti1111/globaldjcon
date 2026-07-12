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
// MUST match lib/contractText.ts CONTRACT_DATA_FIELDS — including the club-only
// fields set_type/equipment (and duration/overtime_rate). When these were
// missing here, the club standard contract left {{set_type}}/{{equipment}} as
// literal text because translateTags never converted them into fields.
export const CONTRACT_DATA_FIELDS = [
  'client_name', 'dj_name', 'event_date', 'event_type', 'venue_name',
  'event_address', 'start_time', 'end_time', 'package',
  'set_type', 'equipment', 'duration', 'overtime_rate', 'price', 'deposit',
  'payment_terms', 'cocktail_hour',
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
    '<signature-field name="DJ Signature" role="DJ" format="typed" style="width:220px;height:44px;display:inline-block;"></signature-field>',
  );
  out = out.replace(
    /\{\{\s*client_signature\s*\}\}/gi,
    '<signature-field name="Client Signature" role="Client" format="typed" style="width:220px;height:44px;display:inline-block;"></signature-field>',
  );
  // Size each auto-fill field to the KIND of value it holds so short values
  // (times, price) don't leave big gaps and long ones (address) don't overflow.
  const FIELD_WIDTH: Record<string, number> = {
    start_time: 90, end_time: 90, price: 90, deposit: 90, duration: 90,
    event_date: 130, overtime_rate: 120,
    client_name: 170, dj_name: 170, venue_name: 170, set_type: 170, event_type: 170,
    equipment: 220, package: 260, event_address: 300, payment_terms: 480,
    cocktail_hour: 200,
  };
  for (const f of CONTRACT_DATA_FIELDS) {
    const re = new RegExp(`\\{\\{\\s*${f}\\s*\\}\\}`, 'gi');
    const w = FIELD_WIDTH[f] || 160;
    out = out.replace(
      re,
      `<text-field name="${f}" role="DJ" required="false" readonly="true" style="width:${w}px;height:16px;display:inline-block;"></text-field>`,
    );
  }
  return out;
}

// Two-column signature block: DJ on the left, Client on the right, each with
// the name field stacked over the signature field. Appended by buildContractHtml
// (the SIGNATURES lines are intentionally not in the contract text).
const SIGNATURE_BLOCK = `<div style="margin-top:34px">
  <div style="font-weight:bold;margin-bottom:16px">SIGNATURES</div>
  <div style="display:flex;justify-content:flex-start;gap:56px">
    <div style="width:240px">
      <div style="margin-bottom:4px">DJ Name:</div>
      <div style="margin-bottom:20px"><text-field name="dj_name" role="DJ" required="false" readonly="true" style="width:180px;height:16px;display:inline-block;"></text-field></div>
      <div style="margin-bottom:4px">DJ Signature:</div>
      <div><signature-field name="DJ Signature" role="DJ" format="typed" style="width:220px;height:44px;display:inline-block;"></signature-field></div>
    </div>
    <div style="width:240px">
      <div style="margin-bottom:4px">Client Name:</div>
      <div style="margin-bottom:20px"><text-field name="client_name" role="DJ" required="false" readonly="true" style="width:180px;height:16px;display:inline-block;"></text-field></div>
      <div style="margin-bottom:4px">Client Signature:</div>
      <div><signature-field name="Client Signature" role="Client" format="typed" style="width:220px;height:44px;display:inline-block;"></signature-field></div>
    </div>
  </div>
</div>`;

// Build the full HTML document for the contract from the DJ's edited text,
// optionally with a logo at the top. Field tags are left intact for DocuSeal,
// and the two-column signature block is appended at the end.
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
    body{font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111;padding:40px}
    div{white-space:pre-wrap}
  </style></head><body>${logo}${body}${SIGNATURE_BLOCK}</body></html>`;
}

// Per-booking build: the booking's DATA is written straight into the text (real
// text, not fixed-width fields) so nothing has awkward gaps, and any line whose
// only tag came back empty is dropped entirely (used for the wedding cocktail
// hour — if the booking has none, the line vanishes). Only the signatures stay
// as fields. Produced fresh for each booking, then turned into a throwaway
// DocuSeal template to submit from.
export function buildBookedContractHtml(
  text: string,
  values: Record<string, string>,
  logoUrl?: string | null,
): string {
  // 1) Drop short "Label: {{tag}}" lines whose value came back empty (e.g. no
  //    cocktail hour). Prose sentences that merely contain a tag are kept.
  const kept = text.split('\n').filter((line) => {
    const tags = line.match(/\{\{\s*([a-z_]+)\s*\}\}/gi) || [];
    if (tags.length === 0) return true; // plain text line, always keep
    const allEmpty = tags.every((t) => {
      const name = t.replace(/[^a-z_]/gi, '');
      return !(values[name] || '').trim();
    });
    if (!allEmpty) return true;
    // Every tag empty — only drop if the rest of the line is just a short label.
    const nonTag = line.replace(/\{\{\s*[a-z_]+\s*\}\}/gi, '').replace(/[:\-–·,()"']/g, '').trim();
    return nonTag.length > 30; // keep real prose, drop bare "Label:" lines
  }).join('\n');

  // 2) Escape, then bake each value in as real text.
  let esc = escapeHtml(kept);
  for (const f of CONTRACT_DATA_FIELDS) {
    const re = new RegExp(`\\{\\{\\s*${f}\\s*\\}\\}`, 'gi');
    esc = esc.replace(re, escapeHtml(values[f] || ''));
  }
  // Any signature tags left in the body become fields.
  esc = esc
    .replace(/\{\{\s*dj_signature\s*\}\}/gi, '<signature-field name="DJ Signature" role="DJ" format="typed" style="width:220px;height:44px;display:inline-block;"></signature-field>')
    .replace(/\{\{\s*client_signature\s*\}\}/gi, '<signature-field name="Client Signature" role="Client" format="typed" style="width:220px;height:44px;display:inline-block;"></signature-field>');

  const body = esc
    .split('\n')
    .map((line) => (line.trim() === '' ? '<div style="height:10px"></div>' : `<div>${line}</div>`))
    .join('');
  const logo = logoUrl
    ? `<div style="text-align:center;margin-bottom:18px"><img src="${logoUrl}" style="max-height:90px;max-width:260px" /></div>`
    : '';

  // Names baked in; only the signature inputs remain as fields.
  const djName = escapeHtml(values.dj_name || 'DJ');
  const clientName = escapeHtml(values.client_name || 'Client');
  const sigBlock = `<div style="margin-top:34px">
  <div style="font-weight:bold;margin-bottom:16px">SIGNATURES</div>
  <div style="display:flex;justify-content:space-between;gap:48px">
    <div style="flex:1;min-width:0">
      <div style="margin-bottom:16px">DJ Name: ${djName}</div>
      <div style="margin-bottom:4px">DJ Signature:</div>
      <div><signature-field name="DJ Signature" role="DJ" format="typed" style="width:220px;height:44px;display:inline-block;"></signature-field></div>
    </div>
    <div style="flex:1;min-width:0">
      <div style="margin-bottom:16px">Client Name: ${clientName}</div>
      <div style="margin-bottom:4px">Client Signature:</div>
      <div><signature-field name="Client Signature" role="Client" format="typed" style="width:220px;height:44px;display:inline-block;"></signature-field></div>
    </div>
  </div>
</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111;padding:40px}
    div{white-space:pre-wrap}
  </style></head><body>${logo}${body}${sigBlock}</body></html>`;
}
