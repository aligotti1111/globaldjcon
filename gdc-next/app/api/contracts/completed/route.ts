// POST /api/contracts/completed
//
// DocuSeal webhook receiver. Fires when a contract submission is completed
// (all parties signed). It:
//   1. Marks the booking's contract_status = 'signed'.
//   2. Emails the DJ their signed copy + audit log (via Resend), since DocuSeal
//      can't email the DJ the final copy without also sending them a confusing
//      "please sign" request at creation.
//
// Point DocuSeal at this URL in Settings → Webhooks:
//   https://globaldjconnect.com/api/contracts/completed
// Optionally set DOCUSEAL_WEBHOOK_SECRET in Netlify and add a matching
// "?secret=..." to the webhook URL (or an X-Webhook-Secret header) to lock it.

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { getDocuseal } from '@/lib/docuseal';

export const runtime = 'nodejs';
export const maxDuration = 26;

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const SITE_URL = 'https://globaldjconnect.com';

function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Minimal branded wrapper — matches the /api/send-email look.
function emailTemplate(content: string): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000000;padding:24px 32px;" align="center">
<div style="font-family:'Bebas Neue',Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div>
</td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;">
<p style="margin:0;color:#888;font-size:11px;line-height:1.6;">© ${new Date().getFullYear()} Global DJ Connect · <a href="${SITE_URL}" style="color:#888;">globaldjconnect.com</a></p>
</td></tr></table>
</td></tr></table>`;
}

function ctaButton(href:
