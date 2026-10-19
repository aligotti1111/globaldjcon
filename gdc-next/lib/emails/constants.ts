// lib/emails/constants.ts
//
// Shared constants for the transactional email system (/api/send-email and the
// per-type builders). Kept in one place so the From/Reply-To identity and the
// link domain can't drift between modules.

export const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
export const REPLY_TO = 'info@globaldjconnect.com';
export const ADMIN_EMAIL = 'info@globaldjconnect.com';

// Always use the production domain for links in outgoing emails — staging
// deploys must never send emails with staging.globaldjconnect.com links to
// real users. Hardcoded so a misconfigured NEXT_PUBLIC_SITE_URL on a staging
// build can't leak through.
export const SITE_URL = 'https://globaldjconnect.com';
