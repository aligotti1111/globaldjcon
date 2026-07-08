// Server-only DocuSeal client + shared contract constants.
//
// SERVER-ONLY. Reads DOCUSEAL_API_KEY from the environment (set in Netlify).
// Never import this into a Client Component.
//
// How tags work: the DJ types tags directly into their own contract document
// (PDF or Word). DocuSeal auto-detects {{...}} tags from the uploaded file and
// turns them into fields — we don't edit the binary. Data tags (event_date,
// price, ...) become fields we PRE-FILL per booking. Signature tags carry a
// role + type so the DJ and client each get their own signature block.

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

// Booking-data fields a DJ can drop into their contract as simple {{tag}}s.
// Pre-filled (read-only) per booking at submission time. The DocuSeal field
// name equals the tag key so pre-fill maps cleanly.
export const CONTRACT_DATA_FIELDS = [
  { key: 'client_name', label: 'Client name' },
  { key: 'dj_name', label: 'Your (DJ) name' },
  { key: 'event_date', label: 'Event date' },
  { key: 'event_type', label: 'Event type' },
  { key: 'venue_name', label: 'Venue name' },
  { key: 'event_address', label: 'Event address' },
  { key: 'start_time', label: 'Start time' },
  { key: 'end_time', label: 'End time' },
  { key: 'package', label: 'Package' },
  { key: 'price', label: 'Agreed price' },
  { key: 'deposit', label: 'Deposit' },
] as const;

// Exact signature tags DJs copy-paste where each party signs. DJ signs first
// (order: 'preserved'), then the client.
export const SIGNATURE_TAGS = {
  dj: '{{Signature;role=DJ;type=signature}}',
  client: '{{Signature;role=Client;type=signature}}',
} as const;

export type ContractDataKey = (typeof CONTRACT_DATA_FIELDS)[number]['key'];
