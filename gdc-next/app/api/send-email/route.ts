// Email API route — replaces /netlify/functions/send-email.js.
// Same Resend integration as the vanilla function. Each email type is a
// branch below; helpers at the top handle email resolution + escaping +
// the shared HTML wrapper template.
//
// Adding a new email type: declare it in the EmailType union, add a branch
// to the switch in POST(), and call pickEmail() to get the recipient.

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { resolveUserEmail, resolveUserIdByEmail } from '@/lib/supabase/admin';
import { sendSmsNotification, withSmsFooter, type SmsEvent } from '@/lib/supabase/sms';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const ADMIN_EMAIL = 'info@globaldjconnect.com';
// Always use the production domain for links in outgoing emails — staging
// deploys must never send emails with staging.globaldjconnect.com links to
// real users. Hardcoded so a misconfigured NEXT_PUBLIC_SITE_URL on a staging
// build can't leak through.
const SITE_URL = 'https://globaldjconnect.com';

// All email types supported by this route. Mirror of vanilla send-email.js.
type EmailType =
  | 'welcome'
  | 'inbox_notification'
  | 'claim_request'
  | 'claim_received'
  | 'profile_claimed'
  | 'contact_us'
  | 'booking_request'
  | 'booking_request_confirmation'
  | 'booking_status'
  | 'mob_booking_status'
  | 'booking_counter'
  | 'quote_sent'
  | 'booking_approved'
  | 'manual_booking_invite';

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

// Format a "HH:MM" 24h time as "h:mm AM/PM". Returns empty string for
// missing values so the caller can decide how to render absence.
function fmtTime(t: string | null | undefined): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  const hour12 = h % 12 || 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Render a start/end time pair as a single human label.
//   start + end → "8:00 PM – 11:00 PM"
//   start only  → "8:00 PM"
//   neither     → "—"
function fmtTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  const s = fmtTime(start);
  const e = fmtTime(end);
  if (s && e) return `${s} – ${e}`;
  if (s) return s;
  return '—';
}

// Map mobile event_type slugs to display labels. Falls back to the slug
// itself with the first letter capitalized — handles "other" + custom
// labels gracefully.
function eventTypeLabel(t: string | null | undefined): string {
  if (!t) return '';
  const map: Record<string, string> = {
    wedding: 'Wedding',
    mitzvah: 'Bar/Bat Mitzvah',
    corporate: 'Corporate Event',
    birthday: 'Birthday Party',
    anniversary: 'Anniversary',
    'house-party': 'House Party',
    school: 'School Event',
    other: 'Other Event',
  };
  if (map[t]) return map[t];
  return t.charAt(0).toUpperCase() + t.slice(1);
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

// Shared HTML wrapper — solid dark header bar + footer. Vanilla parity.
// Header background: solid #000000 to match the logo PNG's own backdrop.
// Logo is wrapped in an inner centering table because some email clients
// (notably Gmail mobile) ignore text-align on the parent <td> for block
// images. The inner table forces horizontal centering reliably.
function emailTemplate(content: string): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000000;padding:24px 32px;" align="center">
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td align="center">
<img src="https://hwqvzuusquruhwguqole.supabase.co/storage/v1/object/public/assets/logo-email.png" alt="Global DJ Connect" width="280" style="display:block;border:0;outline:none;text-decoration:none;" />
</td></tr></table>
</td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;">
<p style="margin:0;color:#888;font-size:11px;line-height:1.6;">© ${new Date().getFullYear()} Global DJ Connect · <a href="${SITE_URL}" style="color:#888;">globaldjconnect.com</a></p>
</td></tr></table>
</td></tr></table>`;
}

function ctaButton(href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#0a6f61;border-radius:6px;"><a href="${href}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.02em;">${label}</a></td></tr></table>`;
}

// Friendly labels for raw club booking enums — match constants.ts.
// Used when emails render set_type / venue_type values from bookings rows.
const CLUB_SET_TYPE_LABELS_EMAIL: Record<string, string> = {
  opening: 'Opening Set',
  headliner: 'Headliner',
  closing: 'Closing Set',
  opening_close: 'Opening – Close',
  opening_and_closing: 'Opening & Closing',
};
const CLUB_VENUE_TYPE_LABELS_EMAIL: Record<string, string> = {
  bar: 'Bar',
  club: 'Club',
};
function setTypeLabel(s: string | null | undefined): string {
  if (!s) return '';
  return CLUB_SET_TYPE_LABELS_EMAIL[s] || s;
}
function venueTypeLabel(v: string | null | undefined): string {
  if (!v) return '';
  return CLUB_VENUE_TYPE_LABELS_EMAIL[v] || v;
}

// Shared booking-info card — same look as the booking_request email.
// Pass any subset of fields; missing ones are skipped. Used by
// quote_sent and booking_counter so they show the same booking
// context the original request email did.
//
// eventTypeText vs setTypeText: pick whichever fits the booking type.
// Mobile DJ bookings use eventTypeText (Wedding / Birthday / Corporate).
// Club/bar bookings use setTypeText (Headliner / Opener / Closing).
// They render with different labels ("Event Type:" vs "Set Type:") so
// the wording matches what the booker/DJ actually picked.
function bookingInfoBox(opts: {
  eventTypeText?: string;       // mobile only — already-formatted (e.g. "Wedding")
  setTypeText?: string;         // club only — already-formatted (e.g. "Headliner")
  date?: string | null;         // raw event_date YYYY-MM-DD
  timeRange?: string;           // pre-formatted, e.g. "9:00 PM – 1:00 AM"
  packageTitle?: string;
  venueTypeText?: string;       // pre-formatted, e.g. "Bar"
  venueName?: string;
  venueAddress?: string;
  rateLabel?: string;           // e.g. "Quoted Rate" / "Counter Offer"
  rateValue?: string;           // e.g. "$300 USD"
  message?: string;
}): string {
  const dateStr = opts.date ? fmtDate(opts.date) : '';
  const rows: string[] = [];
  if (opts.eventTypeText) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Event Type:</strong> ${escHtml(opts.eventTypeText)}</p>`);
  if (opts.setTypeText) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Set Type:</strong> ${escHtml(opts.setTypeText)}</p>`);
  if (dateStr) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Date:</strong> ${dateStr}</p>`);
  if (opts.timeRange && opts.timeRange !== '—') rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Time:</strong> ${escHtml(opts.timeRange)}</p>`);
  if (opts.packageTitle) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Package:</strong> ${escHtml(opts.packageTitle)}</p>`);
  if (opts.venueTypeText) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Venue Type:</strong> ${escHtml(opts.venueTypeText)}</p>`);
  if (opts.venueName) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Venue:</strong> ${escHtml(opts.venueName)}</p>`);
  if (opts.venueAddress) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Address:</strong> ${escHtml(opts.venueAddress)}</p>`);
  if (opts.rateLabel && opts.rateValue) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">${escHtml(opts.rateLabel)}:</strong> ${escHtml(opts.rateValue)}</p>`);
  if (opts.message) rows.push(`<p style="margin:8px 0 0;color:#666;font-size:13px;line-height:1.6;white-space:pre-wrap;"><strong style="color:#1a1a2e;">Message:</strong><br>${escHtml(opts.message)}</p>`);
  // Trim the trailing margin on the last row for a tight look
  if (rows.length > 0) rows[rows.length - 1] = rows[rows.length - 1].replace('margin:0 0 8px', 'margin:0');
  return `<div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">${rows.join('')}</div>`;
}

// ── POST handler ───────────────────────────────────────────────────────

export async function POST(req: Request) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const type = body.type as EmailType | undefined;
  if (!type) {
    return NextResponse.json({ error: 'Missing type' }, { status: 400 });
  }

  let emailPayload: Parameters<typeof resend.emails.send>[0] | null = null;
  // Optional SMS to fire after the email sends. Each branch below sets this
  // if the event has a corresponding text-notification (booking_request,
  // booking_status, mob_booking_status, inbox_notification). Branches that
  // don't set it (welcome, claim_*, contact_us, etc.) simply skip SMS.
  let smsPlan: { userId: string; event: SmsEvent; body: string } | null = null;

  // ── 1. WELCOME ─────────────────────────────────────────────────────
  if (type === 'welcome') {
    const recipientEmail = await pickEmail(
      body.email as string | undefined,
      body.userId as string | undefined,
    );
    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'Could not resolve recipient email for welcome' },
        { status: 400 }
      );
    }
    const recipientName = body.name as string | undefined;
    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [recipientEmail],
      subject: 'Welcome to Global DJ Connect 🎧',
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Welcome${recipientName ? `, ${escHtml(recipientName)}` : ''}!</h2>
        <p style="color:#666666;margin-bottom:8px;">You're officially on the Global DJ Connect network.</p>
        <p style="color:#666666;margin-bottom:24px;">Browse DJs, send booking requests, manage gigs — everything you need is in your dashboard.</p>
        ${ctaButton(`${SITE_URL}`, 'Open Dashboard')}
      `),
    };

  // ── 2. INBOX NOTIFICATION (new message arrived in user's inbox) ────
  } else if (type === 'inbox_notification') {
    const recipientEmail = await pickEmail(
      body.recipientEmail as string | undefined,
      body.recipientUserId as string | undefined,
    );
    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'Missing fields for inbox_notification' },
        { status: 400 }
      );
    }
    const recipientName = body.recipientName as string | undefined;
    const senderName = body.senderName as string | undefined;
    const subject = (body.subject as string | undefined) || '(no subject)';
    const message = (body.message as string | undefined) || '';
    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [recipientEmail],
      // Include sender name in subject so the inbox preview is useful at a
      // glance. Falls back to a generic subject if name is missing.
      subject: senderName
        ? `New message from ${senderName}`
        : `New message: ${subject}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Message</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(recipientName || 'there')}, you have a new message from <strong>${escHtml(senderName || 'a Global DJ Connect user')}</strong>.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;color:#1a1a2e;font-size:13px;font-weight:600;">${escHtml(subject)}</p>
          <p style="margin:0;color:#666;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escHtml(message)}</p>
        </div>
        ${ctaButton(`${SITE_URL}/inbox`, 'View Inbox')}
      `),
    };

    if (body.recipientUserId) {
      // Truncate the preview so the text isn't a wall of text. SMS has
      // a 160-char practical limit before it gets split into segments
      // (and costs more) — keep the body well under that with footer.
      const preview = message.length > 80
        ? message.slice(0, 80).trim() + '…'
        : message;
      const smsLines = [
        `New message from ${senderName || 'a user'}.`,
        subject ? `Re: ${subject}` : null,
        preview,
        `View: ${SITE_URL}/inbox`,
      ].filter(Boolean).join('\n');
      smsPlan = {
        userId: body.recipientUserId as string,
        event: 'inbox_message',
        body: withSmsFooter(smsLines),
      };
    }

  // ── 3. CLAIM REQUEST (admin notified of new claim) ─────────────────
  } else if (type === 'claim_request') {
    const claimerName = body.claimerName as string | undefined;
    const claimerEmail = body.claimerEmail as string | undefined;
    const profileSlug = body.profileSlug as string | undefined;
    const profileName = body.profileName as string | undefined;
    const message = (body.message as string | undefined) || '';
    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [ADMIN_EMAIL],
      subject: `New profile claim: ${profileName || profileSlug}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Profile Claim</h2>
        <p style="color:#666;margin-bottom:16px;"><strong>${escHtml(claimerName || 'Someone')}</strong> (${escHtml(claimerEmail || 'no email')}) has claimed the profile <strong>${escHtml(profileName || profileSlug || '?')}</strong>.</p>
        ${message ? `<div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;"><p style="margin:0;color:#666;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escHtml(message)}</p></div>` : ''}
        ${ctaButton(`${SITE_URL}/admin`, 'Review in Admin Panel')}
      `),
    };

  // ── 4. CLAIM RECEIVED (auto-confirmation to the claimer) ───────────
  } else if (type === 'claim_received') {
    const recipientEmail = await pickEmail(
      body.email as string | undefined,
      body.userId as string | undefined,
    );
    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'Could not resolve recipient email for claim_received' },
        { status: 400 }
      );
    }
    const claimerName = body.claimerName as string | undefined;
    const profileName = body.profileName as string | undefined;
    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [recipientEmail],
      subject: 'We received your profile claim',
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Claim Received</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(claimerName || 'there')}, we got your claim for <strong>${escHtml(profileName || 'your profile')}</strong>. We'll review it and get back to you shortly.</p>
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
    // Optional context fields — present for mobile bookings, partially
    // present for club bookings, may be missing for legacy paths. Each
    // is rendered conditionally so missing fields just don't show up.
    const startTime = body.startTime as string | undefined;
    const endTime = body.endTime as string | undefined;
    const eventType = body.eventType as string | undefined;
    const packageTitle = body.packageTitle as string | undefined;
    // Club-specific fields (kept for backward compat with that flow).
    const setType = body.setType as string | undefined;
    const venueType = body.venueType as string | undefined;

    const dateStr = fmtDate(eventDate);
    const timeStr = fmtTimeRange(startTime, endTime);
    const typeLabel = eventTypeLabel(eventType) || (setType ? setType : '');

    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [djEmail],
      subject: `New Booking Request from ${requesterName || 'a booker'} – ${dateStr}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Booking Request</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(djName || 'there')}, you have a new booking request from <strong>${escHtml(requesterName || 'a booker')}</strong>.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          ${typeLabel ? `<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Event Type:</strong> ${escHtml(typeLabel)}</p>` : ''}
          <p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Date:</strong> ${dateStr}</p>
          ${timeStr !== '—' ? `<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Time:</strong> ${escHtml(timeStr)}</p>` : ''}
          ${packageTitle ? `<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Package:</strong> ${escHtml(packageTitle)}</p>` : ''}
          ${venueType ? `<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Venue Type:</strong> ${escHtml(venueType)}</p>` : ''}
          ${venueName ? `<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Venue:</strong> ${escHtml(venueName)}</p>` : ''}
          ${venueAddress ? `<p style="margin:0;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Address:</strong> ${escHtml(venueAddress)}</p>` : ''}
        </div>
        ${ctaButton(`${SITE_URL}/booking-requests`, 'View Booking Request')}
      `),
    };

    // SMS to the DJ. Short, no HTML, links to the booking-requests page.
    if (body.djUserId) {
      const smsLines = [
        `New booking request from ${requesterName || 'a booker'}.`,
        `${dateStr}${timeStr !== '—' ? ` · ${timeStr}` : ''}`,
        venueName ? `Venue: ${venueName}` : null,
        `View: ${SITE_URL}/booking-requests`,
      ].filter(Boolean).join('\n');
      smsPlan = {
        userId: body.djUserId as string,
        event: 'booking_request',
        body: withSmsFooter(smsLines),
      };
    }

  // ── 5b. BOOKING REQUEST CONFIRMATION (sent to BOOKER) ─────────────
  // Mirror of booking_request but addressed to the booker — confirms
  // their submission landed and gives them a record of what they sent.
  // Same info card layout for visual consistency.
  } else if (type === 'booking_request_confirmation') {
    const requesterEmail = await pickEmail(
      body.requesterEmail as string | undefined,
      body.requesterUserId as string | undefined,
    );
    if (!requesterEmail) {
      return NextResponse.json(
        { error: 'Could not resolve requester email for booking_request_confirmation' },
        { status: 400 }
      );
    }
    const djName = body.djName as string | undefined;
    const requesterName = body.requesterName as string | undefined;
    const eventDate = body.eventDate as string | undefined;
    const venueName = body.venueName as string | undefined;
    const venueAddress = body.venueAddress as string | undefined;
    const startTime = body.startTime as string | undefined;
    const endTime = body.endTime as string | undefined;
    const eventType = body.eventType as string | undefined;
    const packageTitle = body.packageTitle as string | undefined;
    const setType = body.setType as string | undefined;
    const venueType = body.venueType as string | undefined;
    const dateStr = fmtDate(eventDate);
    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [requesterEmail],
      subject: `Booking request sent to ${djName || 'your DJ'} – ${dateStr}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Booking Request Sent</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(requesterName || 'there')}, your booking request has been sent to <strong>${escHtml(djName || 'the DJ')}</strong>. They'll respond shortly — you'll get an email when they do.</p>
        ${bookingInfoBox({
          eventTypeText: eventTypeLabel(eventType),
          setTypeText: setTypeLabel(setType),
          date: eventDate,
          timeRange: fmtTimeRange(startTime, endTime),
          packageTitle,
          venueTypeText: venueTypeLabel(venueType),
          venueName,
          venueAddress,
        })}
        ${ctaButton(`${SITE_URL}/booking-requests`, 'View Your Request')}
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
    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [requesterEmail],
      subject: `Your booking with ${djName || 'the DJ'} was ${status}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Booking ${status.charAt(0).toUpperCase() + status.slice(1)}</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(requesterName || 'there')}, your booking request with <strong>${escHtml(djName || 'the DJ')}</strong> was <span style="color:${statusColor(status)};font-weight:600;">${escHtml(status)}</span>.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Date:</strong> ${dateStr}</p>
          ${venueName ? `<p style="margin:0;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Venue:</strong> ${escHtml(venueName)}</p>` : ''}
        </div>
        ${ctaButton(`${SITE_URL}/booking-requests`, 'View Booking')}
      `),
    };

    if (body.requesterUserId) {
      const smsLines = [
        `Your booking with ${djName || 'the DJ'} was ${status}.`,
        `${dateStr}${venueName ? ` · ${venueName}` : ''}`,
        `View: ${SITE_URL}/booking-requests`,
      ].join('\n');
      smsPlan = {
        userId: body.requesterUserId as string,
        event: 'booking_status',
        body: withSmsFooter(smsLines),
      };
    }

  // ── 7. MOB BOOKING STATUS (DJ approved/denied a MOBILE booking) ───
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
    const venueName = body.venueName as string | undefined;
    const dateStr = fmtDate(eventDate);
    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [requesterEmail],
      subject: `Your booking with ${djName || 'the DJ'} was ${status}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Booking ${status.charAt(0).toUpperCase() + status.slice(1)}</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(requesterName || 'there')}, your mobile booking request with <strong>${escHtml(djName || 'the DJ')}</strong> was <span style="color:${statusColor(status)};font-weight:600;">${escHtml(status)}</span>.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Date:</strong> ${dateStr}</p>
          ${venueName ? `<p style="margin:0;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Venue:</strong> ${escHtml(venueName)}</p>` : ''}
        </div>
        ${ctaButton(`${SITE_URL}/booking-requests`, 'View Booking')}
      `),
    };

    if (body.requesterUserId) {
      const smsLines = [
        `Your booking with ${djName || 'the DJ'} was ${status}.`,
        `${dateStr}${venueName ? ` · ${venueName}` : ''}`,
        `View: ${SITE_URL}/booking-requests`,
      ].join('\n');
      smsPlan = {
        userId: body.requesterUserId as string,
        event: 'booking_status',
        body: withSmsFooter(smsLines),
      };
    }

  // ── 8. BOOKING COUNTER (one side counter-offered the other) ───────
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
    const counterRate = body.counterRate as number | undefined;
    const counterMessage = body.counterMessage as string | undefined;
    const eventDate = body.eventDate as string | undefined;
    const venueName = body.venueName as string | undefined;
    const venueAddress = body.venueAddress as string | undefined;
    const startTime = body.startTime as string | undefined;
    const endTime = body.endTime as string | undefined;
    const setType = body.setType as string | undefined;
    const venueType = body.venueType as string | undefined;
    const packageTitle = body.packageTitle as string | undefined;
    const currency = (body.currency as string | undefined) || 'USD';
    const dateStr = fmtDate(eventDate);
    const sym = currencySymbol(currency);
    // Subject — explicitly identifies the sender's role so the booker
    // sees "Counter from DJ <name>" and the DJ sees "Counter from Host
    // <name>". Falls back to the generic 'other party' wording if names
    // or role aren't available.
    const senderRoleLabel = fromRole === 'dj' ? 'DJ' : fromRole === 'booker' ? 'Host' : '';
    const senderSubjectName = senderName
      ? (senderRoleLabel ? `${senderRoleLabel} ${senderName}` : senderName)
      : (senderRoleLabel ? `the ${senderRoleLabel.toLowerCase()}` : 'the other party');
    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [recipientEmail],
      subject: `Counter Offer from ${senderSubjectName} – ${dateStr}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Counter Offer</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(recipientName || 'there')}, <strong>${escHtml(senderName || 'the other party')}</strong> sent a counter offer on your booking.</p>
        ${bookingInfoBox({
          setTypeText: setTypeLabel(setType),
          date: eventDate,
          timeRange: fmtTimeRange(startTime, endTime),
          packageTitle,
          venueTypeText: venueTypeLabel(venueType),
          venueName,
          venueAddress,
          rateLabel: 'Counter Offer',
          rateValue: counterRate ? `${sym}${Number(counterRate).toLocaleString()} ${currency}` : '',
          message: counterMessage,
        })}
        ${ctaButton(`${SITE_URL}/booking-requests`, 'Review Counter Offer')}
      `),
    };

  // ── 8b. QUOTE SENT (DJ has responded to a quote request with a price) ─
  // Sent to the booker when the DJ clicks "Send Quote" on a quote-mode
  // club booking. This is the FIRST quote on the booking — not a counter
  // — so it's framed as "Quote Received" rather than "Counter Offer".
  } else if (type === 'quote_sent') {
    const recipientEmail = await pickEmail(
      body.recipientEmail as string | undefined,
      body.recipientUserId as string | undefined,
    );
    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'Could not resolve recipient email for quote_sent' },
        { status: 400 }
      );
    }
    const recipientName = body.recipientName as string | undefined;
    const djName = body.djName as string | undefined;
    const quotedRate = body.quotedRate as number | undefined;
    const quoteMessage = body.quoteMessage as string | undefined;
    const eventDate = body.eventDate as string | undefined;
    const venueName = body.venueName as string | undefined;
    const venueAddress = body.venueAddress as string | undefined;
    const startTime = body.startTime as string | undefined;
    const endTime = body.endTime as string | undefined;
    const setType = body.setType as string | undefined;
    const venueType = body.venueType as string | undefined;
    const currency = (body.currency as string | undefined) || 'USD';
    const dateStr = fmtDate(eventDate);
    const sym = currencySymbol(currency);
    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [recipientEmail],
      subject: `Quote received from ${djName || 'your DJ'} – ${dateStr}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Quote Received</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(recipientName || 'there')}, <strong>${escHtml(djName || 'your DJ')}</strong> sent you a quote for your booking request.</p>
        ${bookingInfoBox({
          setTypeText: setTypeLabel(setType),
          date: eventDate,
          timeRange: fmtTimeRange(startTime, endTime),
          venueTypeText: venueTypeLabel(venueType),
          venueName,
          venueAddress,
          rateLabel: 'Quoted Rate',
          rateValue: quotedRate ? `${sym}${Number(quotedRate).toLocaleString()} ${currency}` : '',
          message: quoteMessage,
        })}
        <p style="color:#666;margin-bottom:16px;font-size:13px;">You can accept this quote, propose a counter-offer, or decline.</p>
        ${ctaButton(`${SITE_URL}/booking-requests`, 'Review Quote')}
      `),
    };

  // ── 8c. BOOKING APPROVED (sent to BOTH parties when booking is confirmed) ─
  // Fired from both djUpdateStatus(approve) and acceptCounter() in
  // BookingRequestsClient. The client makes TWO calls — one for booker,
  // one for DJ — each with the appropriate name in the recipient slot.
  // Carries the same info card the request email used, plus a green
  // "Booking Approved" header and the agreed price line.
  } else if (type === 'booking_approved') {
    const recipientEmail = await pickEmail(
      body.recipientEmail as string | undefined,
      body.recipientUserId as string | undefined,
    );
    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'Could not resolve recipient email for booking_approved' },
        { status: 400 }
      );
    }
    const recipientName = body.recipientName as string | undefined;
    const recipientRole = body.recipientRole as string | undefined; // 'dj' | 'booker'
    const otherPartyName = body.otherPartyName as string | undefined;
    const agreedPrice = body.agreedPrice as number | undefined;
    const eventDate = body.eventDate as string | undefined;
    const venueName = body.venueName as string | undefined;
    const venueAddress = body.venueAddress as string | undefined;
    const startTime = body.startTime as string | undefined;
    const endTime = body.endTime as string | undefined;
    const setType = body.setType as string | undefined;
    const venueType = body.venueType as string | undefined;
    const eventType = body.eventType as string | undefined;
    const packageTitle = body.packageTitle as string | undefined;
    const currency = (body.currency as string | undefined) || 'USD';
    const dateStr = fmtDate(eventDate);
    const sym = currencySymbol(currency);
    const otherLabel = recipientRole === 'dj' ? 'Booker' : 'DJ';
    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [recipientEmail],
      subject: `Booking confirmed with ${otherPartyName || otherLabel} – ${dateStr}`,
      html: emailTemplate(`
        <!-- Approved badge — green pill above the heading. -->
        <div style="display:inline-block;padding:5px 12px;background:rgba(61,220,132,0.12);border:1px solid rgba(61,220,132,0.4);border-radius:14px;color:#3ddc84;font-family:'Space Mono',monospace;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;">✓ Booking Approved</div>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin:4px 0 8px;">Price Agreed – Booking Confirmed</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(recipientName || 'there')}, your booking with <strong>${escHtml(otherPartyName || ('the ' + otherLabel.toLowerCase()))}</strong> has been confirmed.</p>
        ${bookingInfoBox({
          eventTypeText: eventType,
          setTypeText: setTypeLabel(setType),
          date: eventDate,
          timeRange: fmtTimeRange(startTime, endTime),
          packageTitle,
          venueTypeText: venueTypeLabel(venueType),
          venueName,
          venueAddress,
          rateLabel: 'Agreed Price',
          rateValue: agreedPrice ? `${sym}${Number(agreedPrice).toLocaleString()} ${currency}` : '',
        })}
        <p style="color:#666;margin-bottom:16px;font-size:13px;">You can review full booking details and the other party's contact info in your dashboard.</p>
        ${ctaButton(`${SITE_URL}/booking-requests`, 'View Booking')}
      `),
    };

  // ── 9. CONTACT US (admin gets a contact form submission) ──────────
  } else if (type === 'contact_us') {
    const senderName = body.name as string | undefined;
    const senderEmail = body.email as string | undefined;
    const subject = (body.subject as string | undefined) || '(no subject)';
    const message = (body.message as string | undefined) || '';
    emailPayload = {
      from: FROM,
      replyTo: senderEmail || REPLY_TO,
      to: [ADMIN_EMAIL],
      subject: `Contact form: ${subject}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Contact Form Submission</h2>
        <p style="color:#666;margin-bottom:16px;"><strong>${escHtml(senderName || 'Someone')}</strong> (${escHtml(senderEmail || 'no email')}) sent a message.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;color:#1a1a2e;font-size:13px;font-weight:600;">${escHtml(subject)}</p>
          <p style="margin:0;color:#666;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escHtml(message)}</p>
        </div>
      `),
    };

  // ── 10. PROFILE CLAIMED (admin approved the claim) ────────────────
  } else if (type === 'profile_claimed') {
    const recipientEmail = await pickEmail(
      body.email as string | undefined,
      body.userId as string | undefined,
    );
    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'Could not resolve recipient email for profile_claimed' },
        { status: 400 }
      );
    }
    const claimerName = body.claimerName as string | undefined;
    const profileName = body.profileName as string | undefined;
    const profileSlug = body.profileSlug as string | undefined;
    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [recipientEmail],
      subject: `Your profile claim was approved`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Profile Approved</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(claimerName || 'there')}, your claim on <strong>${escHtml(profileName || 'your profile')}</strong> has been approved. You can now sign in and edit your profile.</p>
        ${ctaButton(`${SITE_URL}/${profileSlug || ''}`, 'View Profile')}
      `),
    };

  // ── 11. MANUAL BOOKING INVITE (DJ-added booking sent to host's email) ──
  // DJ creates a manual booking and chooses to notify the host. We email
  // the host with full booking details and a CTA to sign up + claim the
  // booking. The signup link carries the host's email (prefill) and the
  // booking id (to auto-link after signup completes — handled in the
  // signup flow, not here).
  } else if (type === 'manual_booking_invite') {
    const recipientEmail = body.hostEmail as string | undefined;
    if (!recipientEmail || !recipientEmail.includes('@')) {
      return NextResponse.json(
        { error: 'Missing or invalid hostEmail for manual_booking_invite' },
        { status: 400 }
      );
    }
    const djName = (body.djName as string | undefined) || 'Your DJ';
    const djType = body.djType as string | undefined; // 'club' | 'mobile'
    const bookingId = body.bookingId as string | undefined;
    const eventDate = body.eventDate as string | null | undefined;
    const startTime = body.startTime as string | null | undefined;
    const endTime = body.endTime as string | null | undefined;
    const venueName = body.venueName as string | null | undefined;
    const venueAddress = body.venueAddress as string | null | undefined;
    const venueType = body.venueType as string | null | undefined;
    const setType = body.setType as string | null | undefined;
    const eventType = body.eventType as string | null | undefined;
    const isResend = body.isResend === true;

    // Build the CTA. If the host's email already has an account, send them
    // to a dedicated claim landing page (which requires login + email match);
    // otherwise send them to signup with email prefilled + booking id stashed.
    const existingUserId = await resolveUserIdByEmail(recipientEmail);
    const ctaHref = existingUserId
      ? `${SITE_URL}/claim-booking?id=${encodeURIComponent(bookingId || '')}`
      : `${SITE_URL}/signup?email=${encodeURIComponent(recipientEmail)}${
          bookingId ? `&claim_booking=${encodeURIComponent(bookingId)}` : ''
        }`;
    const ctaLabel = existingUserId ? 'Add Booking to My Account' : 'Create Account';
    const accountPitch = existingUserId
      ? `You already have an account at Global DJ Connect — click below to add this booking to your account.`
      : `Create a free account to keep track of this booking, message ${escHtml(djName)} directly, and manage any future bookings — all in one place.`;

    const intro = isResend
      ? `${escHtml(djName)} has updated the details for your upcoming booking. Here's the latest info on file:`
      : `${escHtml(djName)} is your DJ for an upcoming event and wants to share the booking details with you. Here's everything on file:`;

    const subject = isResend
      ? `Updated booking details from ${djName}`
      : `Booking details from ${djName}`;

    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [recipientEmail],
      subject,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">${isResend ? 'Booking Updated' : 'Your Booking Details'}</h2>
        <p style="color:#666666;margin-bottom:20px;">${intro}</p>
        ${bookingInfoBox({
          eventTypeText: djType === 'mobile' ? eventTypeLabel(eventType || undefined) : undefined,
          setTypeText: djType === 'club' ? setTypeLabel(setType) : undefined,
          venueTypeText: djType === 'club' ? venueTypeLabel(venueType) : undefined,
          date: eventDate,
          timeRange: fmtTimeRange(startTime, endTime),
          venueName: venueName || undefined,
          venueAddress: venueAddress || undefined,
        })}
        <p style="color:#666666;margin-bottom:20px;">${accountPitch}</p>
        ${ctaButton(ctaHref, ctaLabel)}
        <p style="color:#999999;margin-top:24px;font-size:12px;line-height:1.6;text-align:center;">If you weren't expecting this email, please reply to let us know.</p>
      `),
    };

  } else {
    return NextResponse.json({ error: `Unsupported email type: ${type}` }, { status: 400 });
  }

  if (!emailPayload) {
    return NextResponse.json({ error: 'Email payload not constructed' }, { status: 500 });
  }

  try {
    const { data, error } = await resend.emails.send(emailPayload);
    if (error) {
      console.error('Resend error:', error);
      return NextResponse.json({ error: error.message || 'Resend failed' }, { status: 500 });
    }
    // Fire SMS in parallel with the response. We don't await — text
    // delivery is best-effort and shouldn't delay returning success on
    // the email. Failures are logged inside sendSmsNotification.
    if (smsPlan) {
      sendSmsNotification(smsPlan.userId, smsPlan.event, smsPlan.body).catch((e) => {
        console.error('[sms] dispatch failed:', e);
      });
    }
    return NextResponse.json({ ok: true, id: data?.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('send-email failed:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
