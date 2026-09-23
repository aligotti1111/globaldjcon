// lib/activationEmail.ts — the "finish setup to activate your booking engine"
// email, shared by:
//   • the daily /api/cron/activate-reminders nudge series, and
//   • an immediate first-touch when a DJ gains booking access via a COMP code
//     or a PROMO/paid signup (they'd otherwise wait up to a day for the cron).
//
// The step checklist + HTML live here so both callers render the exact same
// email. sendActivationWelcome() is the first-time-only send: it fires once per
// account, only while setup is still incomplete, and seeds the reminder
// timestamps so the daily cron continues the series from that day.

import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveUserEmail } from '@/lib/supabase/admin';
import { canBook, type AccessFields } from '@/lib/access';
import {
  parseBookingSettings,
  packageTiers,
  type BookingSettings,
} from '@/app/(main)/[slug]/bookingSettings';
import { usableMethods, type PaymentMethod } from '@/lib/paymentMethods';

const SITE_URL = 'https://globaldjconnect.com';
const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const MIN_HOURS_BETWEEN = 20; // effectively once per day

export interface Flags { hasPackage: boolean; hasEquip: boolean; hasPayment: boolean; }

// The data-driven booking flags we can verify server-side.
export function bookingFlags(
  bs: BookingSettings | null,
  methods: PaymentMethod[] | null,
  stripeReady: boolean | null,
): Flags {
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
export function isSetupComplete(djType: string | null, f: Flags): boolean {
  return djType === 'club' ? f.hasEquip : f.hasPackage;
}

// The full step list for the DJ's type, mirroring the in-app SetupChecklist.
// Only the data-driven steps (packages / equipment / payments) can be confirmed
// from the server; the rest are shown as remaining steps to complete.
export interface Step { label: string; done: boolean; }
export function stepsFor(djType: string | null, f: Flags): Step[] {
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

// How many steps still remain (for the "X steps away" copy).
export function remainingCount(steps: Step[]): number {
  return steps.filter((s) => !s.done).length;
}

// Renders the steps as a vertical checklist (top-to-bottom).
export function checklistHtml(steps: Step[]): string {
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

export function reminderEmailHtml(
  message: string,
  steps: Step[],
  dismissHref: string,
  heading = 'Finish Setup',
): string {
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
<h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">${heading}</h2>
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

// Signed dismiss token (mirrors the cron's), so the one-click "Done" link can
// only turn off the recipient's own reminders.
export function reminderDismissHref(userId: string): string {
  // Lazy import keeps this file usable in edge-free node routes without pulling
  // node:crypto at module load in environments that don't need it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto') as typeof import('crypto');
  const token = crypto
    .createHmac('sha256', process.env.CRON_SECRET || '')
    .update(userId)
    .digest('hex')
    .slice(0, 32);
  return `${SITE_URL}/api/dj/activate-reminders/dismiss?u=${userId}&t=${token}`;
}

interface WelcomeRow extends AccessFields {
  id: string;
  dj_type: string | null;
  booking_settings: string | null;
  payment_methods: PaymentMethod[] | null;
  stripe_connect_ready: boolean | null;
  setup_reviewed: boolean | null;
  activate_welcome_sent: boolean | null;
}

export type WelcomeResult =
  | { sent: true; remaining: number }
  | { sent: false; reason: 'already-sent' | 'setup-complete' | 'no-access' | 'no-email' | 'error' };

// First-time-only "your booking engine is X steps from active" email. Safe to
// call on every path that grants booking access (comp redeem, paid/promo
// subscription activation): it self-gates so it fires at most once per account
// and only while setup is incomplete. Seeds the reminder timestamps so the
// daily cron continues the nudge series from today rather than doubling up.
export async function sendActivationWelcome(
  admin: SupabaseClient,
  userId: string,
): Promise<WelcomeResult> {
  try {
    const { data } = await admin
      .from('users')
      .select(
        'id, dj_type, booking_settings, payment_methods, stripe_connect_ready, setup_reviewed, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, activate_welcome_sent'
      )
      .eq('id', userId)
      .maybeSingle();

    const dj = data as unknown as WelcomeRow | null;
    if (!dj) return { sent: false, reason: 'error' };

    // Only first-time, and only while booking isn't live yet.
    if (dj.activate_welcome_sent) return { sent: false, reason: 'already-sent' };
    if (!canBook(dj)) return { sent: false, reason: 'no-access' };

    const bs = parseBookingSettings(dj.booking_settings);
    const flags = bookingFlags(bs, dj.payment_methods, dj.stripe_connect_ready);
    if (isSetupComplete(dj.dj_type, flags)) return { sent: false, reason: 'setup-complete' };

    const email = await resolveUserEmail(userId);
    if (!email) return { sent: false, reason: 'no-email' };

    const steps = stepsFor(dj.dj_type, flags);
    const remaining = remainingCount(steps);
    const message =
      `You're all set with access — your booking engine is <strong>${remaining} step${remaining === 1 ? '' : 's'}</strong> away from going live on your profile. Finish the steps below and hosts can book you.`;

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      replyTo: REPLY_TO,
      to: [email],
      subject: `Your booking engine is ${remaining} step${remaining === 1 ? '' : 's'} from active`,
      html: reminderEmailHtml(message, steps, reminderDismissHref(userId), 'Activate Your Booking Engine'),
    });

    // Mark first-time done + seed the cron series from today (so it doesn't
    // re-send within MIN_HOURS_BETWEEN and the 7-day window starts now).
    const nowIso = new Date().toISOString();
    await admin
      .from('users')
      .update({
        activate_welcome_sent: true,
        activate_reminder_first_at: nowIso,
        activate_reminder_last_at: nowIso,
        activate_reminder_count: 1,
      } as unknown as never)
      .eq('id', userId);

    return { sent: true, remaining };
  } catch (e) {
    console.warn('[activationEmail] sendActivationWelcome failed for', userId, e);
    return { sent: false, reason: 'error' };
  }
}

export { MIN_HOURS_BETWEEN };
