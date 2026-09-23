// /api/cron/comp-expiry — daily job that warns DJs whose FREE (comp) access is
// about to run out and invites them to subscribe.
//
// Rules:
//   • Fires ~7 days before comp_expires_at (any comp still in the future and
//     inside the 7-day window that we haven't warned about yet).
//   • Grants +3 bonus days on send, so they get a little extra runway.
//   • One warning per distinct comp grant: we stamp comp_expiry_notified_for
//     with the (post-extension) expiry, so it won't re-send; re-granting a new
//     comp with a later expiry re-arms it.
//   • Skips anyone who has ALREADY added billing (an active/trialing/past_due
//     Stripe subscription, or a stored subscription id) — they'll convert
//     automatically and don't need the nudge.
//
// Protected by CRON_SECRET (header 'x-cron-secret' or ?secret=). Manually
// testable: https://globaldjconnect.com/api/cron/comp-expiry?secret=YOUR_SECRET

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE_URL = 'https://globaldjconnect.com';
const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const WARN_DAYS = 7;   // start warning this many days out
const BONUS_DAYS = 3;  // extra days granted on send

interface CompRow {
  id: string;
  comp_tier: number | null;
  comp_expires_at: string | null;
  sub_status: string | null;
  stripe_subscription_id: string | null;
  comp_expiry_notified_for: string | null;
}

// True when the DJ has already put billing in place (so they'll convert on
// their own and don't need an expiry nudge).
function hasBilling(dj: CompRow): boolean {
  if (dj.stripe_subscription_id) return true;
  return ['active', 'trialing', 'past_due'].includes(dj.sub_status ?? '');
}

function expiryEmailHtml(endDate: string, daysLeft: number): string {
  const ctaHref = `${SITE_URL}/subscribe`;
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000000;padding:24px 32px;" align="center">
<div style="font-family:'Bebas Neue',Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div>
</td></tr>
<tr><td style="padding:32px;">
<h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Your free access is ending</h2>
<p style="color:#666666;margin-bottom:8px;line-height:1.6;">Your complimentary access ends on <strong>${endDate}</strong> — that's about <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong> from now. Subscribe to keep your booking engine live and keep taking bookings without interruption.</p>
<p style="color:#0a6f61;margin:0 0 20px;line-height:1.6;font-size:14px;">We've added <strong>3 bonus days</strong> to your free access so you have time to decide.</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#0a6f61;border-radius:6px;"><a href="${ctaHref}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.02em;">Subscribe now</a></td></tr></table>
<p style="text-align:center;margin:16px 0 0;color:#999999;font-size:12px;line-height:1.6;">If you don't subscribe, your booking engine simply pauses when access ends — your profile and data stay put, and you can reactivate any time.</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;">
<p style="margin:0;color:#888;font-size:11px;line-height:1.6;">© ${new Date().getFullYear()} Global DJ Connect · <a href="${SITE_URL}" style="color:#888;">globaldjconnect.com</a></p>
</td></tr></table>
</td></tr></table>`;
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
    .select('id, comp_tier, comp_expires_at, sub_status, stripe_subscription_id, comp_expiry_notified_for')
    .eq('role', 'dj')
    .not('comp_expires_at', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const djs = (data as unknown as CompRow[]) || [];
  const resend = new Resend(process.env.RESEND_API_KEY);
  const now = Date.now();

  let sent = 0;
  let skipped = 0;

  for (const dj of djs) {
    if (!dj.comp_expires_at) { skipped++; continue; }
    const expMs = new Date(dj.comp_expires_at).getTime();

    // Already expired, or not within the warning window yet.
    if (expMs <= now) { skipped++; continue; }
    const daysLeft = (expMs - now) / 86_400_000;
    if (daysLeft > WARN_DAYS) { skipped++; continue; }

    // Already added billing → they'll convert on their own; no nudge.
    if (hasBilling(dj)) { skipped++; continue; }

    // Already warned about THIS comp expiry? (stamp = the post-extension date)
    if (dj.comp_expiry_notified_for) { skipped++; continue; }

    const email = await resolveUserEmail(dj.id);
    if (!email) { skipped++; continue; }

    // Grant the bonus days.
    const newExp = new Date(expMs + BONUS_DAYS * 86_400_000);
    const newExpIso = newExp.toISOString();
    const endDate = newExp.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
    const daysLeftRounded = Math.max(1, Math.round((newExp.getTime() - now) / 86_400_000));

    try {
      await resend.emails.send({
        from: FROM,
        replyTo: REPLY_TO,
        to: [email],
        subject: 'Your free access is ending — keep your booking engine live',
        html: expiryEmailHtml(endDate, daysLeftRounded),
      });
    } catch (e) {
      console.error('[comp-expiry] send failed for', dj.id, e);
      skipped++;
      continue;
    }

    await admin
      .from('users')
      .update({
        comp_expires_at: newExpIso,
        comp_expiry_notified_for: newExpIso,
      } as unknown as never)
      .eq('id', dj.id);
    sent++;
  }

  return NextResponse.json({ ok: true, sent, skipped, scanned: djs.length });
}

export async function POST(req: Request) {
  return run(req);
}
export async function GET(req: Request) {
  return run(req);
}
