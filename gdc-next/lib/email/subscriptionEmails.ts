// Subscription lifecycle emails, sent from the Stripe webhook (subscribed) and
// the on-site cancel route (cancellation). Both use the same black-header /
// white-card shell as every other transactional email.
//
//   · You're subscribed  → plan + renew date + the booking-engine setup steps.
//   · Subscription set to cancel → plan + the date access ends.

import { Resend } from 'resend';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const SITE_URL = 'https://globaldjconnect.com';

const TIER_NAMES: Record<number, string> = {
  0: 'Free',
  1: 'Starter',
  2: 'Pro',
  3: 'Premium Pro',
  4: 'Enterprise',
};
export function planName(tier: number | null | undefined): string {
  return TIER_NAMES[tier ?? 0] || 'Plan';
}

function shell(content: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000;padding:24px 32px;" align="center"><div style="font-family:'Bebas Neue',Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div></td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;"><p style="margin:0;color:#888;font-size:11px;">© ${new Date().getFullYear()} Global DJ Connect · globaldjconnect.com · <a href="${SITE_URL}/notifications" style="color:#888;">Manage emails</a></p></td></tr>
</table></td></tr></table>`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

// The booking-engine setup steps for the DJ's type — mirrors the in-app
// SetupChecklist. Shown to a brand-new subscriber (all still to do).
function setupSteps(djType: string | null): string[] {
  return djType === 'club'
    ? ['Settings', 'Equipment & Rates', 'Contracts', 'DJ Rider', 'Guest List', 'Payments']
    : ['Settings', 'Packages', 'Contracts', 'Payments', 'Planner & Playlist'];
}

function checklistHtml(steps: string[]): string {
  const rows = steps
    .map(
      (label, i) => `<tr>
<td width="30" valign="middle" style="padding:6px 12px 6px 0;"><div style="width:22px;height:22px;border-radius:50%;border:1.5px solid #c7c7cf;color:#9a9aa5;font-weight:700;font-size:12px;line-height:20px;text-align:center;font-family:Arial,sans-serif;">${i + 1}</div></td>
<td valign="middle" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#1a1a2e;font-weight:500;padding:6px 0;">${label}</td>
</tr>`,
    )
    .join('');
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 24px;width:100%;">${rows}</table>`;
}

function resend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

// ── You're subscribed ─────────────────────────────────────────────────────
export async function sendSubscribedEmail(
  to: string,
  opts: { tier: number; interval?: string | null; renewIso?: string | null; djType?: string | null },
): Promise<void> {
  const r = resend();
  if (!r) return;
  const plan = planName(opts.tier);
  const intervalLabel = opts.interval === 'yearly' ? 'billed yearly' : opts.interval === 'monthly' ? 'billed monthly' : '';
  const renew = fmtDate(opts.renewIso);
  const steps = setupSteps(opts.djType ?? null);

  const content = `<h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin:0 0 12px;">You're subscribed 🎉</h2>
<p style="color:#666;line-height:1.6;margin:0 0 16px;">Thanks for subscribing to Global DJ Connect. Here are your plan details, and the last few steps to switch your booking engine on.</p>
<table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f3fbf8;border:1px solid #cdeee4;border-radius:8px;margin:0 0 22px;">
<tr><td style="padding:14px 16px;">
<div style="font-size:14px;color:#111;"><span style="color:#777;">Plan</span> &nbsp;<strong>${plan}${intervalLabel ? ` <span style="color:#777;font-weight:500;">(${intervalLabel})</span>` : ''}</strong></div>
${renew ? `<div style="font-size:14px;color:#111;margin-top:6px;"><span style="color:#777;">Renews</span> &nbsp;<strong>${renew}</strong></div>` : ''}
</td></tr></table>
<p style="color:#999;margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Finish your booking setup</p>
${checklistHtml(steps)}
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#0a6f61;border-radius:6px;"><a href="${SITE_URL}/booking-settings" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Finish Setup</a></td></tr></table>`;

  try {
    await r.emails.send({ from: FROM, replyTo: REPLY_TO, to: [to], subject: `You're subscribed — ${plan} plan`, html: shell(content) });
  } catch {
    /* non-fatal — never block the subscription sync over an email */
  }
}

// ── Subscription set to cancel ────────────────────────────────────────────
export async function sendSubscriptionCanceledEmail(
  to: string,
  opts: { tier: number; endIso?: string | null },
): Promise<void> {
  const r = resend();
  if (!r) return;
  const plan = planName(opts.tier);
  const end = fmtDate(opts.endIso);

  const content = `<h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin:0 0 12px;">Subscription canceled</h2>
<p style="color:#666;line-height:1.6;margin:0 0 16px;">Your <strong>${plan}</strong> subscription is set to cancel.${end ? ` You'll keep full access until <strong>${end}</strong>, and then your account moves to the Free plan.` : ' Your account will move to the Free plan at the end of your current billing period.'}</p>
<p style="color:#666;line-height:1.6;margin:0 0 22px;">Changed your mind? You can resume anytime before then — your setup and bookings stay exactly as they are.</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#0a6f61;border-radius:6px;"><a href="${SITE_URL}/subscribe" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Manage subscription</a></td></tr></table>`;

  try {
    await r.emails.send({ from: FROM, replyTo: REPLY_TO, to: [to], subject: 'Your subscription is set to cancel', html: shell(content) });
  } catch {
    /* non-fatal */
  }
}
