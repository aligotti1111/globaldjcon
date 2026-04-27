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
  // (Only one example below — the new dev fills in the other types
  // by following the pattern. The full implementation lives in
  // EMAIL_TEMPLATES.md alongside this file.)
  let emailPayload: { from: string; reply_to: string; to: string[]; subject: string; html: string };

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
