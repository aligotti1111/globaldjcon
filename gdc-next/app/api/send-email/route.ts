// Email API route — replaces /netlify/functions/send-email.js.
// Same Resend integration as the vanilla function. Each email type is a
// branch below; helpers at the top handle email resolution + escaping +
// the shared HTML wrapper template.
//
// Adding a new email type: declare it in the EmailType union, add a branch
// to the switch in POST(), and call pickEmail() to get the recipient.

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { resolveUserEmail } from '@/lib/supabase/admin';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const ADMIN_EMAIL = 'info@globaldjconnect.com';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://globaldjconnect.com';

// All email types supported by this route. Mirror of vanilla send-email.js.
type EmailType =
  | 'welcome'
  | 'inbox_notification'
  | 'claim_request'
  | 'claim_received'
  | 'profile_claimed'
  | 'contact_us'
  | 'booking_request'
  | 'booking_status'
  | 'mob_booking_status'
  | 'booking_counter';

// ── Helpers ────────────────────────────────────────────────────────────

// Resolve a recipient's email — explicit address wins, else look up by
// userId via the admin API. Returns null when neither works.
async function pickEmail(
  explicitEmail: string | null | undefined,
  userId: string | null | undefined,
): Promise<string | null> {
  if (explicitEmail && explicitEmail.includes('@')) return explicitEmail;
  if (userId) return await resolveUserEmail(userId);
  return null;
}

function escHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(eventDate: string | null | undefined): string {
  if (!eventDate) return '—';
  // Force noon so timezone shifts can't bump it to a neighbouring day
  return new Date(eventDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function statusColor(status: string): string {
  if (status === 'approved') return '#3ddc84';
  if (status === 'denied') return '#ff5f5f';
  return '#ffb347';
}

function currencySymbol(code: string | null | undefined): string {
  const map: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$',
    JPY: '¥', KRW: '₩', CNY: '¥', INR: '₹', BRL: 'R$', MXN: '$',
  };
  return map[code || 'USD'] || '$';
}

// Shared HTML wrapper — neon header bar + footer. Vanilla parity.
function emailTemplate(content: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;"><tr><td align="center" style="padding:40px 20px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td bgcolor="#050507" style="padding:24px 32px;border-bottom:3px solid #00f5c4;">
<img src="https://hwqvzuusquruhwguqole.supabase.co/storage/v1/object/public/assets/logo-email.png" alt="Global DJ Connect" width="280" style="display:block;border:0;" /></td></tr>
<tr><td style="padding:32px;color:#1a1a2e;">${content}</td></tr>
<tr><td style="padding:24px 32px;background:#f8f8f8;border-top:1px solid #e0e0e0;">
<p style="margin:0;color:#888;font-size:11px;line-height:1.6;">© ${new Date().getFullYear()} Global DJ Connect · <a href="${SITE_URL}" style="color:#888;">globaldjconnect.com</a></p>
</td></tr></table></td></tr></table></body></html>`;
}

// Standard CTA button (neon)
function ctaButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">${escHtml(label)}</a>`;
}

// ── Handler ────────────────────────────────────────────────────────────

interface BasePayload { type?: EmailType }

export async function POST(request: Request) {
  let body: BasePayload & Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { type } = body;
  if (!type) {
    return NextResponse.json({ error: 'Missing email type' }, { status: 400 });
  }

  let emailPayload: {
    from: string;
    reply_to: string | string[];
    to: string[];
    subject: string;
    html: string;
  };

  // ── 1. WELCOME ────────────────────────────────────────────────────
  if (type === 'welcome') {
    const name = body.name as string | undefined;
    const email = body.email as string | undefined;
    const role = body.role as string | undefined;
    const slug = body.slug as string | undefined;
    if (!name || !email || !role) {
      return NextResponse.json({ error: 'Missing fields for welcome' }, { status: 400 });
    }

    let roleMsg = '';
    let profileBtn = '';
    if (role === 'dj' && slug) {
      roleMsg = 'Your DJ profile is live and ready for bookings.';
      profileBtn = `<a href="${SITE_URL}/${slug}" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin-right:12px;">View My Profile</a>`;
    } else if (role === 'host') {
      roleMsg = 'You can now search for DJs and send booking inquiries.';
    } else if (role === 'venue') {
      roleMsg = 'Your venue account is ready. Find the perfect DJ for your events.';
    }

    emailPayload = {
      from: FROM,
      reply_to: REPLY_TO,
      to: [email],
      subject: 'Welcome to Global DJ Connect 🎧',
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2.2rem;color:#1a1a2e;margin-bottom:8px;">Welcome, ${escHtml(name)}!</h2>
        <p style="color:#666666;margin-bottom:8px;">You're officially on the Global DJ Connect network.</p>
        <p style="color:#666666;margin-bottom:28px;">${roleMsg}</p>
        ${profileBtn}
        <a href="${SITE_URL}/login" style="display:inline-block;background:transparent;color:#00f5c4;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;border:1px solid #00f5c4;">Log In</a>
        <p style="color:#666666;font-size:12px;margin-top:28px;">Questions? Reply to this email and we'll help you out.</p>
      `),
    };

  // ── 2. INBOX NOTIFICATION ─────────────────────────────────────────
  } else if (type === 'inbox_notification') {
    const recipientName = body.recipientName as string | undefined;
    const recipientEmail = await pickEmail(
      body.recipientEmail as string | undefined,
      body.recipientUserId as string | undefined,
    );
    const senderName = body.senderName as string | undefined;
    const senderEmail = body.senderEmail as string | undefined;
    const subject = body.subject as string | undefined;
    const message = body.message as string | undefined;
    if (!recipientEmail || !senderName || !subject || !message) {
      return NextResponse.json(
        { error: 'Missing fields for inbox_notification' },
        { status: 400 }
      );
    }
    emailPayload = {
      from: FROM,
      reply_to: REPLY_TO,
      to: [recipientEmail],
      // Include sender name in subject so the inbox preview is useful at a
      // glance. Falls back to a generic subject if name is missing.
      subject: senderName
        ? `New message from ${senderName}`
        : `New message: ${subject}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Message</h2>
        <p style="color:#666666;margin-bottom:24px;">Hi ${escHtml(recipientName || 'there')}, you have a new message from <strong style="color:#1a1a2e;">${escHtml(senderName)}</strong>.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;font-family:monospace;">Subject</p>
          <p style="color:#1a1a2e;font-weight:600;margin-bottom:16px;">${escHtml(subject)}</p>
          <p style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;font-family:monospace;">Message</p>
          <p style="color:#333333;line-height:1.65;">${escHtml(message).replace(/\n/g, '<br>')}</p>
        </div>
        ${senderEmail ? `<p style="color:#666666;font-size:12px;margin-bottom:20px;">Reply directly to: <a href="mailto:${senderEmail}?subject=Re: ${encodeURIComponent(subject)}" style="color:#00f5c4;">${escHtml(senderEmail)}</a></p>` : ''}
        ${ctaButton(`${SITE_URL}/inbox`, 'View in Inbox')}
      `),
    };

  // ── 3. CLAIM REQUEST (admin notification) ─────────────────────────
  } else if (type === 'claim_request') {
    const claimantName = body.claimantName as string | undefined;
    const claimantEmail = body.claimantEmail as string | undefined;
    const bizName = body.bizName as string | undefined;
    const slug = body.slug as string | undefined;
    const verifyMsg = body.verifyMsg as string | undefined;
    if (!claimantName || !claimantEmail || !bizName) {
      return NextResponse.json({ error: 'Missing fields for claim_request' }, { status: 400 });
    }
    const profileUrl = slug ? `${SITE_URL}/${slug}` : 'N/A';
    emailPayload = {
      from: FROM,
      reply_to: [claimantEmail],
      to: [ADMIN_EMAIL],
      subject: `Profile Claim Request: ${bizName}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Claim Request</h2>
        <p style="color:#666666;margin-bottom:24px;">Someone wants to claim a profile on Global DJ Connect.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Name</td></tr>
            <tr><td style="color:#1a1a2e;padding-bottom:14px;">${escHtml(claimantName)}</td></tr>
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Email</td></tr>
            <tr><td style="color:#00f5c4;padding-bottom:14px;"><a href="mailto:${claimantEmail}" style="color:#00f5c4;">${escHtml(claimantEmail)}</a></td></tr>
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Business / DJ Name</td></tr>
            <tr><td style="color:#1a1a2e;padding-bottom:14px;">${escHtml(bizName)}</td></tr>
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Profile URL</td></tr>
            <tr><td style="padding-bottom:14px;"><a href="${profileUrl}" style="color:#00f5c4;">${profileUrl}</a></td></tr>
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Verification Info</td></tr>
            <tr><td style="color:#333333;line-height:1.65;">${escHtml(verifyMsg || 'None provided').replace(/\n/g, '<br>')}</td></tr>
          </table>
        </div>
        <a href="mailto:${claimantEmail}?subject=Re: Your Profile Claim for ${encodeURIComponent(bizName)}" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">Reply to Claimant</a>
      `),
    };

  // ── 3a. CLAIM RECEIVED (receipt to claimant) ──────────────────────
  } else if (type === 'claim_received') {
    const claimantName = body.claimantName as string | undefined;
    const claimantEmail = body.claimantEmail as string | undefined;
    const bizName = body.bizName as string | undefined;
    const slug = body.slug as string | undefined;
    if (!claimantEmail || !bizName) {
      return NextResponse.json({ error: 'Missing fields for claim_received' }, { status: 400 });
    }
    const profileUrl = slug ? `${SITE_URL}/${slug}` : SITE_URL;
    const greet = claimantName ? escHtml(claimantName) : 'there';
    emailPayload = {
      from: FROM,
      reply_to: REPLY_TO,
      to: [claimantEmail],
      subject: `We received your claim request for "${bizName}"`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2.2rem;color:#1a1a2e;margin-bottom:8px;">Claim Request Received</h2>
        <p style="color:#666666;margin-bottom:16px;">Hi ${greet},</p>
        <p style="color:#666666;margin-bottom:16px;">We got your request to claim <strong style="color:#1a1a2e;">${escHtml(bizName)}</strong> on Global DJ Connect.</p>
        <p style="color:#666666;margin-bottom:24px;">Our team will review your request and reach back out within 1–2 business days. Once approved, you'll receive a separate email with a link to set your password and take over the profile.</p>
        ${slug ? `<div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          <div style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;margin-bottom:6px;">Profile Being Claimed</div>
          <a href="${profileUrl}" style="color:#00b89a;word-break:break-all;">${profileUrl}</a>
        </div>` : ''}
        <p style="color:#666666;font-size:12px;margin-top:24px;">Questions in the meantime? Just reply to this email.</p>
      `),
    };

  // ── 3b. PROFILE CLAIMED (approval + set-password link) ────────────
  } else if (type === 'profile_claimed') {
    const name = body.name as string | undefined;
    const email = body.email as string | undefined;
    const bizName = body.bizName as string | undefined;
    const slug = body.slug as string | undefined;
    const setPasswordLink = body.setPasswordLink as string | undefined;
    if (!email || !setPasswordLink) {
      return NextResponse.json({ error: 'Missing fields for profile_claimed' }, { status: 400 });
    }
    const profileUrl = slug ? `${SITE_URL}/${slug}` : SITE_URL;
    const greet = name ? escHtml(name) : 'there';
    const biz = bizName ? escHtml(bizName) : 'your profile';
    emailPayload = {
      from: FROM,
      reply_to: REPLY_TO,
      to: [email],
      subject: `Your profile "${bizName || 'listing'}" on Global DJ Connect has been claimed`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2.2rem;color:#1a1a2e;margin-bottom:8px;">Profile Claimed — Welcome!</h2>
        <p style="color:#666666;margin-bottom:16px;">Hi ${greet},</p>
        <p style="color:#666666;margin-bottom:16px;">Your claim for <strong style="color:#1a1a2e;">${biz}</strong> on Global DJ Connect has been approved. The profile is now yours to manage.</p>
        <p style="color:#666666;margin-bottom:24px;">To finish activating your account, set your password using the button below. This link expires in 24 hours.</p>
        ${ctaButton(setPasswordLink, 'Set My Password')}
        ${slug ? `<p style="color:#666666;font-size:13px;margin-top:24px;">Once you're in, you can view and edit your profile at:</p>
        <p style="margin-bottom:20px;"><a href="${profileUrl}" style="color:#00b89a;word-break:break-all;">${profileUrl}</a></p>` : ''}
        <p style="color:#666666;font-size:12px;margin-top:24px;">If you didn't request this claim, please reply to this email and we'll look into it.</p>
      `),
    };

  // ── 4. CONTACT US ─────────────────────────────────────────────────
  } else if (type === 'contact_us') {
    const name = (body.name as string | undefined)?.trim();
    const email = (body.email as string | undefined)?.toLowerCase().trim();
    const subject = (body.subject as string | undefined)?.trim();
    const message = (body.message as string | undefined)?.trim();
    if (!name || !email || !subject || !message) {
      return NextResponse.json({ error: 'Missing fields for contact_us' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    emailPayload = {
      from: FROM,
      reply_to: [email],
      to: [ADMIN_EMAIL],
      subject: `Contact Form: ${subject}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Contact Message</h2>
        <p style="color:#666;margin-bottom:24px;">Someone submitted the contact form on Global DJ Connect.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Name</td></tr>
            <tr><td style="color:#1a1a2e;padding-bottom:14px;">${escHtml(name)}</td></tr>
            <tr><td style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Email</td></tr>
            <tr><td style="color:#00f5c4;padding-bottom:14px;"><a href="mailto:${email}" style="color:#00f5c4;">${escHtml(email)}</a></td></tr>
            <tr><td style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Subject</td></tr>
            <tr><td style="color:#1a1a2e;padding-bottom:14px;">${escHtml(subject)}</td></tr>
            <tr><td style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Message</td></tr>
            <tr><td style="color:#333;line-height:1.65;">${escHtml(message).replace(/\n/g, '<br>')}</td></tr>
          </table>
        </div>
        <a href="mailto:${email}?subject=Re: ${encodeURIComponent(subject)}" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">Reply to ${escHtml(name)}</a>
      `),
    };

  // ── 5. BOOKING REQUEST (alert DJ of new booking) ──────────────────
  } else if (type === 'booking_request') {
    const djEmail = await pickEmail(
      body.djEmail as string | undefined,
      body.djUserId as string | undefined,
    );
    if (!djEmail) {
      return NextResponse.json(
        { error: 'Could not resolve DJ email for booking_request' },
        { status: 400 }
      );
    }
    const djName = body.djName as string | undefined;
    const requesterName = body.requesterName as string | undefined;
    const eventDate = body.eventDate as string | undefined;
    const venueName = body.venueName as string | undefined;
    const venueAddress = body.venueAddress as string | undefined;
    const dateStr = fmtDate(eventDate);
    emailPayload = {
      from: FROM,
      reply_to: REPLY_TO,
      to: [djEmail],
      subject: `New Booking Request from ${requesterName || 'a booker'} – ${dateStr}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Booking Request</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(djName || 'there')}, you have a new booking request from <strong>${escHtml(requesterName || 'a booker')}</strong>.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Date:</strong> ${dateStr}</p>
          ${venueName ? `<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Venue:</strong> ${escHtml(venueName)}</p>` : ''}
          ${venueAddress ? `<p style="margin:0;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Address:</strong> ${escHtml(venueAddress)}</p>` : ''}
        </div>
        ${ctaButton(`${SITE_URL}/booking-requests`, 'View Booking Request')}
      `),
    };

  // ── 6. BOOKING STATUS (DJ approved/denied a CLUB booking) ─────────
  } else if (type === 'booking_status') {
    const requesterEmail = await pickEmail(
      body.requesterEmail as string | undefined,
      body.requesterUserId as string | undefined,
    );
    if (!requesterEmail) {
      return NextResponse.json(
        { error: 'Could not resolve requester email for booking_status' },
        { status: 400 }
      );
    }
    const requesterName = body.requesterName as string | undefined;
    const djName = body.djName as string | undefined;
    const status = (body.status as string | undefined) || 'updated';
    const eventDate = body.eventDate as string | undefined;
    const venueName = body.venueName as string | undefined;
    const dateStr = fmtDate(eventDate);
    const sCap = status.charAt(0).toUpperCase() + status.slice(1);
    emailPayload = {
      from: FROM,
      reply_to: REPLY_TO,
      to: [requesterEmail],
      subject: `Booking ${sCap} – ${djName || 'DJ'}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Booking ${sCap}</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(requesterName || 'there')}, your booking request to <strong>${escHtml(djName || 'the DJ')}</strong>${venueName ? ` for <strong>${escHtml(venueName)}</strong>` : ''} on ${dateStr} has been <span style="color:${statusColor(status)};font-weight:700;">${status}</span>.</p>
        ${status === 'approved' ? `<p style="color:#666;margin-bottom:24px;">The DJ will be in touch with further details.</p>` : ''}
        ${ctaButton(`${SITE_URL}/booking-requests`, 'View My Bookings')}
      `),
    };

  // ── 7. MOBILE BOOKING STATUS (DJ approved/denied a MOBILE booking) ─
  } else if (type === 'mob_booking_status') {
    const requesterEmail = await pickEmail(
      body.requesterEmail as string | undefined,
      body.requesterUserId as string | undefined,
    );
    if (!requesterEmail) {
      return NextResponse.json(
        { error: 'Could not resolve requester email for mob_booking_status' },
        { status: 400 }
      );
    }
    const requesterName = body.requesterName as string | undefined;
    const djName = body.djName as string | undefined;
    const status = (body.status as string | undefined) || 'updated';
    const eventDate = body.eventDate as string | undefined;
    const packageTitle = body.packageTitle as string | undefined;
    const dateStr = fmtDate(eventDate);
    const sCap = status.charAt(0).toUpperCase() + status.slice(1);
    const pkgLine = packageTitle
      ? `<p style="color:#666;margin-bottom:16px;">Package: <strong style="color:#1a1a2e;">${escHtml(packageTitle)}</strong></p>`
      : '';
    emailPayload = {
      from: FROM,
      reply_to: REPLY_TO,
      to: [requesterEmail],
      subject: `Booking ${sCap} – ${djName || 'DJ'}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Booking ${sCap}</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(requesterName || 'there')}, your booking request to <strong>${escHtml(djName || 'the DJ')}</strong> for ${dateStr} has been <span style="color:${statusColor(status)};font-weight:700;">${status}</span>.</p>
        ${pkgLine}
        ${status === 'approved' ? `<p style="color:#666;margin-bottom:24px;">The DJ will be in touch with further details about your event.</p>` : ''}
        ${ctaButton(`${SITE_URL}/booking-requests`, 'View My Bookings')}
      `),
    };

  // ── 8. BOOKING COUNTER OFFER (alert other party of a counter-offer) ─
  } else if (type === 'booking_counter') {
    const recipientEmail = await pickEmail(
      body.recipientEmail as string | undefined,
      body.recipientUserId as string | undefined,
    );
    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'Could not resolve recipient email for booking_counter' },
        { status: 400 }
      );
    }
    const recipientName = body.recipientName as string | undefined;
    const senderName = body.senderName as string | undefined;
    const fromRole = body.fromRole as string | undefined;
    const counterRate = body.counterRate as number | string | undefined;
    const counterMessage = body.counterMessage as string | undefined;
    const eventDate = body.eventDate as string | undefined;
    const venueName = body.venueName as string | undefined;
    const currency = (body.currency as string | undefined) || 'USD';
    const sym = currencySymbol(currency);
    const dateStr = fmtDate(eventDate);
    const senderLabel = fromRole === 'dj' ? 'DJ' : 'booker';
    const counterStr = counterRate != null
      ? `${sym}${Number(counterRate).toLocaleString()}`
      : '—';
    emailPayload = {
      from: FROM,
      reply_to: REPLY_TO,
      to: [recipientEmail],
      subject: `Counter Offer from ${senderName || senderLabel}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Counter Offer</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(recipientName || 'there')}, <strong>${escHtml(senderName || senderLabel)}</strong> has sent a counter offer for your booking${venueName ? ` at <strong>${escHtml(venueName)}</strong>` : ''} on ${dateStr}.</p>
        <div style="background:#f8f8f8;border-radius:8px;padding:20px;margin-bottom:24px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;color:#888;margin-bottom:4px;">Counter Rate</div>
          <div style="font-size:2em;font-weight:700;color:#00b89a;">${counterStr} <span style="font-size:.6em;color:#888;">${currency}</span></div>
          ${counterMessage ? `<div style="margin-top:12px;color:#333;line-height:1.6;">"${escHtml(counterMessage)}"</div>` : ''}
        </div>
        ${ctaButton(`${SITE_URL}/booking-requests`, 'View Booking')}
      `),
    };

  } else {
    return NextResponse.json(
      { error: `Unknown email type: ${type}` },
      { status: 400 }
    );
  }

  // ── Send via Resend ──
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error('RESEND_API_KEY not set');
      return NextResponse.json({ error: 'Email service not configured' }, { status: 500 });
    }
    const resend = new Resend(apiKey);
    const result = await resend.emails.send(emailPayload);
    if (result.error) {
      console.error('Resend error:', result.error);
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, id: result.data?.id });
  } catch (err) {
    console.error('Email send error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
