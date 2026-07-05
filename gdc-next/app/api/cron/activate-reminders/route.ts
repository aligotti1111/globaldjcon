// /api/cron/activate-reminders — daily job that emails subscribed DJs whose
// booking isn't live yet because they haven't finished setup (mobile: no
// bookable package; club: no equipment picked).
//
// Rules (mirror the in-app ActivateBookingBanner):
//   • Only DJs with booking access (subscription/comp) AND incomplete setup.
//   • At most one email per day per DJ.
//   • Stops after a 7-day window from the first reminder.
//   • Resets (so it can start fresh later) the moment a DJ completes setup or
//     loses access.
//
// Protected by CRON_SECRET (header 'x-cron-secret' or ?secret=). The Netlify
// scheduled function calls it daily; you can also hit it manually to test:
//   https://globaldjconnect.com/api/cron/activate-reminders?secret=YOUR_SECRET

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { canBook, type AccessFields } from '@/lib/access';
import {
  parseBookingSettings,
  packageTiers,
  type BookingSettings,
} from '@/app/(main)/[slug]/bookingSettings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE_URL = 'https://globaldjconnect.com';
const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const WINDOW_DAYS = 7;
const MIN_HOURS_BETWEEN = 20; // effectively once per day

// Setup completeness — same logic as the public-profile gate + banner.
function isSetupComplete(djType: string | null, bs: BookingSettings | null): boolean {
  if (!bs) return false;
  if (djType === 'club') {
    return !!(bs.equip_full || bs.equip_decks || bs.equip_none);
  }
  const packs = bs.mob_packages || {};
  return Object.values(packs).some(
    (arr) =>
      Array.isArray(arr) &&
      arr.some(
        (pkg) =>
          !!pkg &&
          !!(pkg.title && String(pkg.title).trim()) &&
          (pkg.reqAll === true || packageTiers(pkg).length > 0)
      )
  );
}

function reminderEmailHtml(message: string): string {
  const ctaHref = `${SITE_URL}/booking-settings`;
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000000;padding:24px 32px;" align="center">
<div style="font-family:'Bebas Neue',Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div>
</td></tr>
<tr><td style="padding:32px;">
<h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">One step left to take bookings</h2>
<p style="color:#666666;margin-bottom:20px;line-height:1.6;">${message}</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#0a6f61;border-radius:6px;"><a href="${ctaHref}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.02em;">Finish Setup</a></td></tr></table>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;">
<p style="margin:0;color:#888;font-size:11px;line-height:1.6;">© ${new Date().getFullYear()} Global DJ Connect · <a href="${SITE_URL}" style="color:#888;">globaldjconnect.com</a></p>
</td></tr></table>
</td></tr></table>`;
}

interface DjRow extends AccessFields {
  id: string;
  dj_type: string | null;
  booking_settings: string | null;
  activate_reminder_first_at: string | null;
  activate_reminder_last_at: string | null;
  activate_reminder_count: number | null;
}

async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('users')
    .select(
      'id, dj_type, booking_settings, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, activate_reminder_first_at, activate_reminder_last_at, activate_reminder_count'
    )
    .eq('role', 'dj');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const djs = (data as unknown as DjRow[]) || [];
  const resend = new Resend(process.env.RESEND_API_KEY);
  const now = Date.now();

  let sent = 0;
  let skipped = 0;
  let reset = 0;

  for (const dj of djs) {
    const access = canBook(dj);
    const bs = parseBookingSettings(dj.booking_settings);
    const complete = isSetupComplete(dj.dj_type, bs);

    // Not eligible (no access, or already set up) → clear any tracking so a
    // future re-entry into the "subscribed but incomplete" state starts fresh.
    if (!access || complete) {
      if (dj.activate_reminder_first_at || (dj.activate_reminder_count || 0) > 0) {
        await admin
          .from('users')
          .update({
            activate_reminder_first_at: null,
            activate_reminder_last_at: null,
            activate_reminder_count: 0,
          } as unknown as never)
          .eq('id', dj.id);
        reset++;
      }
      continue;
    }

    // Eligible: subscribed + incomplete.
    const firstAt = dj.activate_reminder_first_at
      ? new Date(dj.activate_reminder_first_at).getTime()
      : null;
    // Past the 7-day window → stop nagging.
    if (firstAt && now - firstAt >= WINDOW_DAYS * 86_400_000) {
      skipped++;
      continue;
    }
    // Already emailed within the last ~day → skip.
    const lastAt = dj.activate_reminder_last_at
      ? new Date(dj.activate_reminder_last_at).getTime()
      : null;
    if (lastAt && now - lastAt < MIN_HOURS_BETWEEN * 3_600_000) {
      skipped++;
      continue;
    }

    const email = await resolveUserEmail(dj.id);
    if (!email) {
      skipped++;
      continue;
    }

    const message =
      dj.dj_type === 'club'
        ? "You're subscribed, but your Book button isn't live yet. Pick an equipment option to activate booking on your profile."
        : "You're subscribed, but your Book button isn't live yet. Add your first package to activate booking on your profile.";

    try {
      await resend.emails.send({
        from: FROM,
        replyTo: REPLY_TO,
        to: [email],
        subject: 'Finish setup to start taking bookings',
        html: reminderEmailHtml(message),
      });
    } catch (e) {
      console.error('[activate-reminders] send failed for', dj.id, e);
      skipped++;
      continue;
    }

    await admin
      .from('users')
      .update({
        activate_reminder_first_at: dj.activate_reminder_first_at || new Date().toISOString(),
        activate_reminder_last_at: new Date().toISOString(),
        activate_reminder_count: (dj.activate_reminder_count || 0) + 1,
      } as unknown as never)
      .eq('id', dj.id);
    sent++;
  }

  return NextResponse.json({ ok: true, sent, skipped, reset, scanned: djs.length });
}

export async function POST(req: Request) {
  return run(req);
}
export async function GET(req: Request) {
  return run(req);
}
