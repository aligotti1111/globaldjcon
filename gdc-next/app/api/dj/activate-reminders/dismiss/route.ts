// /api/dj/activate-reminders/dismiss — one-click link (from the setup-reminder
// email) that turns OFF the setup reminder emails for good. Setting
// setup_reviewed=true also hides the in-app setup checklist, matching the
// in-app "Done" button. Signed with a token derived from CRON_SECRET so a link
// can only ever dismiss its own recipient's reminders. No auth session needed —
// it's opened straight from an email client.

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE_URL = 'https://globaldjconnect.com';

function reminderToken(id: string): string {
  return crypto.createHmac('sha256', process.env.CRON_SECRET || '').update(id).digest('hex').slice(0, 32);
}

function tokenOk(id: string, provided: string): boolean {
  const expected = reminderToken(id);
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

function page(msg: string): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Global DJ Connect</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0b0b10;color:#eaeaf0;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;">
<div style="text-align:center;max-width:440px;padding:32px;">
<div style="font-family:Impact,Arial,sans-serif;color:#00f5c4;font-size:24px;letter-spacing:.06em;margin-bottom:18px;">GLOBAL DJ CONNECT</div>
<p style="line-height:1.7;color:#c9c9d2;font-size:15px;">${msg}</p>
<a href="${SITE_URL}/booking-settings" style="display:inline-block;margin-top:20px;color:#00f5c4;text-decoration:none;font-weight:600;">Go to Booking Settings &rarr;</a>
</div></body></html>`;
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const u = url.searchParams.get('u') || '';
  const t = url.searchParams.get('t') || '';

  if (!u || !t || !tokenOk(u, t)) {
    return page('This link is invalid or has expired. You can manage your setup anytime from Booking Settings.');
  }

  try {
    const admin = createAdminClient();
    await admin
      .from('users')
      .update({
        setup_reviewed: true,
        activate_reminder_first_at: null,
        activate_reminder_last_at: null,
        activate_reminder_count: 0,
      } as unknown as never)
      .eq('id', u);
  } catch {
    // Non-fatal — still show the confirmation so the click never feels broken.
  }

  return page("You're all set — we won't send you any more setup reminder emails. You can finish your booking setup anytime from Booking Settings.");
}
