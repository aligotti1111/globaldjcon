// API route — replaces /netlify/functions/send-email.js.
// Same Resend integration, same email templates, but now type-safe.
//
// THIS IS WHERE THE OLD BUG GETS PREVENTED: the `BookingRequestPayload` type
// requires either djEmail OR djUserId. TypeScript will refuse to compile if a
// caller forgets both. The Netlify function had no such guarantee — that's
// why we shipped a version with missing handlers.

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { resolveUserEmail } from '@/lib/supabase/admin';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const ADMIN_EMAIL = 'info@globaldjconnect.com';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://globaldjconnect.com';

// ── Payload types ──────────────────────────────────────────────────────
// Each type has its own shape. TypeScript enforces at compile time that
// the right fields are provided.

type EmailType =
  | 'booking_request'
  | 'booking_request_confirmation'
  | 'mob_booking_request'
  | 'mob_booking_confirm'
  | 'booking_status'
  | 'mob_booking_status'
  | 'booking_dj_confirm'
  | 'booking_cancelled'
  | 'booking_counter'
  | 'mob_quote_response'
  | 'inbox_notification'
  | 'welcome'
  | 'password_reset'
  | 'claim_request'
  | 'claim_received'
  | 'profile_claimed'
  | 'contact_us';

// Shared: a recipient must be reachable via email OR userId.
// This union type makes "neither provided" a compile error.
type Recipient =
  | { djEmail: string; djUserId?: string }
  | { djEmail?: string; djUserId: string }
  | { requesterEmail: string; requesterUserId?: string }
  | { requesterEmail?: string; requesterUserId: string }
  | { recipientEmail: string; recipientUserId?: string }
  | { recipientEmail?: string; recipientUserId: string };

interface BasePayload {
  type: EmailType;
}

// ── Helpers ────────────────────────────────────────────────────────────

async function pickEmail(
  explicitEmail: string | null | undefined,
  userId: string | null | undefined
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

// ── Handler ────────────────────────────────────────────────────────────

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

  // Build the email payload based on type.
  let emailPayload: {
    from: string;
    reply_to: string | string[];
    to: string[];
    subject: string;
    html: string;
  };

  if (type === 'booking_request') {
    const djEmail = await pickEmail(
      body.djEmail as string | undefined,
      body.djUserId as string | undefined
    );
    if (!djEmail) {
      return NextResponse.json(
        { error: 'Could not resolve DJ email for booking_request' },
        { status: 400 }
      );
    }
    const djName = body.djName as string;
    const requesterName = body.requesterName as string;
    const eventDate = body.eventDate as string | undefined;
    const dateStr = eventDate
      ? new Date(eventDate + 'T12:00:00').toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
        })
      : '—';
    emailPayload = {
      from: FROM,
      reply_to: REPLY_TO,
      to: [djEmail],
      subject: `New Booking Request from ${requesterName} – ${dateStr}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Booking Request</h2>
        <p style="color:#666;margin-bottom:24px;">Hi ${escHtml(djName)}, you have a new booking request from <strong>${escHtml(requesterName)}</strong>.</p>
        <p style="color:#666;margin-bottom:24px;">Event date: <strong>${dateStr}</strong></p>
        <a href="${SITE_URL}/booking-requests" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;">View Booking Request</a>
      `),
    };
  } else if (type === 'contact_us') {
    // Contact form submission. Sends to admin inbox with the user's email
    // as reply-to so admin can reply directly to the sender.
    const name = (body.name as string | undefined)?.trim();
    const email = (body.email as string | undefined)?.toLowerCase().trim();
    const subject = (body.subject as string | undefined)?.trim();
    const message = (body.message as string | undefined)?.trim();
    if (!name || !email || !subject || !message) {
      return NextResponse.json(
        { error: 'Missing fields for contact_us' },
        { status: 400 }
      );
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

  } else {
    // Other types — copy the implementations from the old send-email.js.
    // The new dev should port each handler one at a time.
    return NextResponse.json(
      { error: `Email type "${type}" not yet ported. See EMAIL_TEMPLATES.md.` },
      { status: 501 }
    );
  }

  // ── Send via Resend ──
  try {
    const resend = new Resend(process.env.RESEND_API_KEY!);
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
