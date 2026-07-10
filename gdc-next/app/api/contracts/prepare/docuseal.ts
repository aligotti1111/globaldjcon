// Server-only DocuSeal client + shared contract constants.
//
// SERVER-ONLY. Reads DOCUSEAL_API_KEY from the environment (set in Netlify).
// Never import this into a Client Component.

import docuseal from '@docuseal/api';
import { CONTRACT_DATA_FIELDS } from './contractText';

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

export { CONTRACT_DATA_FIELDS };


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
  for (const f of CONTRACT_DATA_FIELDS) {
    const re = new RegExp(`\\{\\{\\s*${f}\\s*\\}\\}`, 'gi');
    out = out.replace(
      re,
      `<text-field name="${f}" role="DJ" required="false" readonly="true" style="width:180px;height:16px;display:inline-block;"></text-field>`,
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
