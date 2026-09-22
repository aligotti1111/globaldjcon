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
import crypto from 'crypto';
import { Resend } from 'resend';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { canBook, type AccessFields } from '@/lib/access';
import {
  parseBookingSettings,
  packageTiers,
  type BookingSettings,
} from '@/app/(main)/[slug]/bookingSettings';
import { usableMethods, type PaymentMethod } from '@/lib/paymentMethods';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE_URL = 'https://globaldjconnect.com';
const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const WINDOW_DAYS = 7;
const MIN_HOURS_BETWEEN = 20; // effectively once per day

interface Flags { hasPackage: boolean; hasEquip: boolean; hasPayment: boolean; }

// The data-driven booking flags we can verify server-side.
function bookingFlags(bs: BookingSettings | null, methods: PaymentMethod[] | null, stripeReady: boolean | null): Flags {
  const hasEquip = !!(bs?.equip_full || bs?.equip_decks || bs?.equip_none);
  const packs = bs?.mob_packages || {};
  const hasPackage = Object.values(packs).some(
    (arr) =>
      Array.isArray(arr) &&
      arr.some(
        (pkg) =>
          !!pkg &&
          !!(pkg.title && String(pkg.title).trim()) &&
          (pkg.reqAll === true || packageTiers(pkg).length > 0)
      )
  );
  const hasPayment = usableMethods(methods || []).length > 0 || stripeReady === true;
  return { hasPackage, hasEquip, hasPayment };
}

// Setup completeness — same logic as the public-profile gate + banner.
function isSetupComplete(djType: string | null, f: Flags): boolean {
  return djType === 'club' ? f.hasEquip : f.hasPackage;
}

// The full step list for the DJ's type, mirroring the in-app SetupChecklist.
// Only the data-driven steps (packages / equipment / payments) can be confirmed
// from the server; the rest are shown as remaining steps to complete.
interface Step { label: string; done: boolean; }
function stepsFor(djType: string | null, f: Flags): Step[] {
  if (djType === 'club') {
    return [
      { label: 'Settings', done: false },
      { label: 'Equipment & Rates', done: f.hasEquip },
      { label: 'Contracts', done: false },
      { label: 'DJ Rider', done: false },
      { label: 'Guest List', done: false },
      { label: 'Payments', done: f.hasPayment },
    ];
  }
  return [
    { label: 'Settings', done: false },
    { label: 'Packages', done: f.hasPackage },
    { label: 'Contracts', done: false },
    { label: 'Payments', done: f.hasPayment },
    { label: 'Planner & Playlist', done: false },
  ];
}

// Renders the steps as a vertical checklist (top-to-bottom): a numbered/checked
// circle on the left, the step name on the right.
function checklistHtml(steps: Step[]): string {
  const rows = steps
    .map((s, i) => {
      const circle = s.done
        ? `<td width="30" valign="middle" style="padding:6px 12px 6px 0;"><div style="width:24px;height:24px;border-radius:50%;background:#00c9a7;color:#04121a;font-weight:700;font-size:13px;line-height:24px;text-align:center;font-family:Arial,sans-serif;">&#10003;</div></td>`
        : `<td width="30" valign="middle" style="padding:6px 12px 6px 0;"><div style="width:22px;height:22px;border-radius:50%;border:1.5px solid #c7c7cf;color:#9a9aa5;font-weight:700;font-size:12px;line-height:20px;text-align:center;font-family:Arial,sans-serif;">${i + 1}</div></td>`;
      const label = `<td valign="middle" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:${s.done ? '#0a6f61' : '#1a1a2e'};font-weight:${s.done ? 600 : 500};padding:6px 0;">${s.label}${s.done ? ' <span style="color:#00a98f;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">Done</span>' : ''}</td>`;
      return `<tr>${circle}${label}</tr>`;
    })
    .join('');
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;width:100%;">${rows}</table>`;
}

function reminderEmailHtml(message: string, steps: Step[], dismissHref: string): string {
  const ctaHref = `${SITE_URL}/booking-settings`;
  const doneCount = steps.filter((s) => s.done).length;
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000000;padding:24px 32px;" align="center">
<div style="font-family:'Bebas Neue',Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div>
</td></tr>
<tr><td style="padding:32px;">
<h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Finish Setup</h2>
<p style="color:#666666;margin-bottom:8px;line-height:1.6;">${message}</p>
<p style="color:#999999;margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Your setup checklist · ${doneCount} of ${steps.length} done</p>
${checklistHtml(steps)}
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#0a6f61;border-radius:6px;"><a href="${ctaHref}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.02em;">Finish Setup</a></td></tr></table>
<p style="text-align:center;margin:18px 0 0;line-height:1.6;">
<a href="${dismissHref}" style="color:#999999;font-size:12px;text-decoration:underline;">Done — stop sending me these reminders</a>
<br><span style="color:#bbbbbb;font-size:11px;">Clicking this turns off the setup reminder emails for good.</span>
</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;">
<p style="margin:0;color:#888;font-size:11px;line-height:1.6;">© ${new Date().getFullYear()} Global DJ Connect · <a href="${SITE_URL}" style="color:#888;">globaldjconnect.com</a></p>
</td></tr></table>
</td></tr></table>`;
}

// Signed token so the one-click "Done" link can only turn off the recipient's
// own reminders. Verified by /api/dj/activate-reminders/dismiss.
function reminderToken(id: string): string {
  return crypto.createHmac('sha256', process.env.CRON_SECRET || '').update(id).digest('hex').slice(0, 32);
}

interface DjRow extends AccessFields {
  id: string;
  dj_type: string | null;
  booking_settings: string | null;
  payment_methods: PaymentMethod[] | null;
  stripe_connect_ready: boolean | null;
  setup_reviewed: boolean | null;
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
      'id, dj_type, booking_settings, payment_methods, stripe_connect_ready, setup_reviewed, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, activate_reminder_first_at, activate_reminder_last_at, activate_reminder_count'
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
    const flags = bookingFlags(bs, dj.payment_methods, dj.stripe_connect_ready);
    const complete = isSetupComplete(dj.dj_type, flags);

    // Not eligible (no access, already set up, or the DJ tapped "Done — stop
    // reminders" in a previous email) → clear any tracking so a future re-entry
    // into the "subscribed but incomplete" state starts fresh.
    if (!access || complete || dj.setup_reviewed) {
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
      "You're subscribed, but the Booking engine is not live. Complete the remaining steps below to activate booking engine on your profile.";
    const steps = stepsFor(dj.dj_type, flags);
    const dismissHref = `${SITE_URL}/api/dj/activate-reminders/dismiss?u=${dj.id}&t=${reminderToken(dj.id)}`;

    try {
      await resend.emails.send({
        from: FROM,
        replyTo: REPLY_TO,
        to: [email],
        subject: 'Finish setup to start taking bookings',
        html: reminderEmailHtml(message, steps, dismissHref),
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
