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
import { parseBookingSettings } from '@/app/(main)/[slug]/bookingSettings';
import { type PaymentMethod } from '@/lib/paymentMethods';
import {
  bookingFlags, isSetupComplete, stepsFor, reminderEmailHtml, reminderDismissHref,
  MIN_HOURS_BETWEEN,
} from '@/lib/activationEmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const WINDOW_DAYS = 7;

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
    const dismissHref = reminderDismissHref(dj.id);

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
