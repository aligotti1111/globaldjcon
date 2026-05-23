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
  | 'manual_booking_invite'
  | 'event_invite_from_host'
  | 'booking_activity';

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
// Title-case a stored value — "bar" → "Bar", "opening - closing" →
// "Opening - Closing". Applied so labels read cleanly in emails
// regardless of how they were stored.
function titleCaseLabel(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
function setTypeLabel(s: string | null | undefined): string {
  if (!s) return '';
  return CLUB_SET_TYPE_LABELS_EMAIL[s] || titleCaseLabel(s);
}
function venueTypeLabel(v: string | null | undefined): string {
  if (!v) return '';
  return CLUB_VENUE_TYPE_LABELS_EMAIL[v] || titleCaseLabel(v);
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
  equipmentText?: string;       // club only — pre-formatted equipment label
  rateLabel?: string;           // e.g. "Quoted Rate" / "Counter Offer"
  rateValue?: string;           // e.g. "$300 USD"
  rateBreakdown?: string;       // optional hourly breakdown, e.g. "$330/hr × 3 hr"
  message?: string;
}): string {
  const dateStr = opts.date ? fmtDate(opts.date) : '';
  const rows: string[] = [];
  if (dateStr) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Date:</strong> ${dateStr}</p>`);
  if (opts.timeRange && opts.timeRange !== '—') rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Time:</strong> ${escHtml(opts.timeRange)}</p>`);
  if (opts.packageTitle) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Package:</strong> ${escHtml(opts.packageTitle)}</p>`);
  if (opts.eventTypeText) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Event Type:</strong> ${escHtml(opts.eventTypeText)}</p>`);
  if (opts.venueName) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Venue:</strong> ${escHtml(opts.venueName)}</p>`);
  if (opts.venueAddress) {
    const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(opts.venueAddress)}`;
    rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Address:</strong> <a href="${mapsHref}" style="color:#0a7d5a;text-decoration:underline;">${escHtml(opts.venueAddress)}</a></p>`);
  }
  if (opts.venueTypeText) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Venue Type:</strong> ${escHtml(opts.venueTypeText)}</p>`);
  if (opts.setTypeText) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Set Type:</strong> ${escHtml(opts.setTypeText)}</p>`);
  if (opts.equipmentText) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Equipment:</strong> ${escHtml(opts.equipmentText)}</p>`);
  if (opts.rateLabel && opts.rateValue) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">${escHtml(opts.rateLabel)}:</strong> ${escHtml(opts.rateValue)}${opts.rateBreakdown ? ` <span style="color:#999;">(${escHtml(opts.rateBreakdown)})</span>` : ''}</p>`);
  if (opts.message) rows.push(`<p style="margin:8px 0 0;color:#666;font-size:13px;line-height:1.6;white-space:pre-wrap;"><strong style="color:#1a1a2e;">Message:</strong><br>${escHtml(opts.message)}</p>`);
  // Trim the trailing margin on the last row for a tight look
  if (rows.length > 0) rows[rows.length - 1] = rows[rows.length - 1].replace('margin:0 0 8px', 'margin:0');
  return `<div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">${rows.join('')}</div>`;
}

// Mobile booking-request card. Used by booking_request (DJ-facing) and
// booking_request_confirmation (booker-facing) so both parties see an
// identical card. Field order is fixed:
//   Event Type, Date, Time, Venue, Address, Package (+ details), Quoted Rate
//
// Weddings: the time row is labelled "Reception Start Time / Reception End
// Time" and, when cocktail-hour music was requested, two extra rows show
// the cocktail start time and whether it shares the reception room.
//
// packageDetails is trusted HTML from the DJ's profile editor (same source
// the public booking form renders) — rendered inline under the Package row.
function mobileBookingRequestBox(opts: {
  eventTypeText?: string;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  venueName?: string;
  venueAddress?: string;
  packageTitle?: string;
  packageDetails?: string;
  rateLabel?: string;
  rateValue?: string;
  isWedding?: boolean;
  cocktailNeeded?: boolean | null;
  cocktailStart?: string | null;
  cocktailSameRoom?: boolean | null;
}): string {
  const rows: string[] = [];
  const row = (label: string, value: string) =>
    `<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">${label}:</strong> ${value}</p>`;

  if (opts.eventTypeText) rows.push(row('Event Type', escHtml(opts.eventTypeText)));

  const dateStr = opts.date ? fmtDate(opts.date) : '';
  if (dateStr) rows.push(row('Date', dateStr));

  // Wedding bookings call the slot a reception. When both times are
  // present we render two separate labelled rows; otherwise a single
  // range row keeps non-wedding bookings unchanged.
  const startStr = fmtTime(opts.startTime);
  const endStr = fmtTime(opts.endTime);
  if (opts.isWedding) {
    if (startStr) rows.push(row('Reception Start Time', escHtml(startStr)));
    if (endStr) rows.push(row('Reception End Time', escHtml(endStr)));
  } else {
    const range = fmtTimeRange(opts.startTime, opts.endTime);
    if (range !== '—') rows.push(row('Time', escHtml(range)));
  }

  // Cocktail-hour rows — only when this is a wedding AND the booker
  // requested music for cocktail hour.
  if (opts.isWedding && opts.cocktailNeeded) {
    const ckStart = fmtTime(opts.cocktailStart);
    if (ckStart) rows.push(row('Cocktail Hour Start', escHtml(ckStart)));
    rows.push(row(
      'Cocktail Hour Room',
      opts.cocktailSameRoom
        ? 'Same room as reception'
        : 'Separate room from reception',
    ));
  }

  if (opts.venueName) rows.push(row('Venue', escHtml(opts.venueName)));
  if (opts.venueAddress) {
    const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(opts.venueAddress)}`;
    rows.push(row('Address', `<a href="${mapsHref}" style="color:#0a7d5a;text-decoration:underline;">${escHtml(opts.venueAddress)}</a>`));
  }

  if (opts.packageTitle) {
    rows.push(row('Package', escHtml(opts.packageTitle)));
    // Package details are trusted HTML authored by the DJ. Render inline,
    // indented under the Package row.
    if (opts.packageDetails && opts.packageDetails.trim()) {
      rows.push(`<div style="margin:0 0 8px 0;padding:8px 12px;background:#ffffff;border:1px solid #e6e6e6;border-radius:6px;color:#666;font-size:13px;line-height:1.6;">${opts.packageDetails}</div>`);
    }
  }

  if (opts.rateLabel && opts.rateValue) {
    rows.push(row(opts.rateLabel, escHtml(opts.rateValue)));
  }

  if (rows.length > 0) {
    rows[rows.length - 1] = rows[rows.length - 1].replace('margin:0 0 8px', 'margin:0');
  }
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
    // Mobile-only: HTML package details + wedding cocktail-hour context.
    const packageDetails = body.packageDetails as string | undefined;
    const isWedding = body.isWedding === true;
    const cocktailNeeded = body.cocktailNeeded === true;
    const cocktailStart = body.cocktailStart as string | undefined;
    const cocktailSameRoom = body.cocktailSameRoom === true;
    // Club-specific fields (kept for backward compat with that flow).
    const setType = body.setType as string | undefined;
    const venueType = body.venueType as string | undefined;
    const equipment = body.equipment as string | undefined;
    // Mobile vs club: the club booking form always sends a setType; the
    // mobile form never does. Mobile bookings render via the shared
    // mobileBookingRequestBox; club keeps its existing inline card.
    const isMobileBooking = !setType;
    // Optional rate fields. A host request carries a price in one of two
    // ways depending on the DJ's rate type:
    //   • offers mode  → offerAmount  (the booker's own offer)
    //   • flat/hourly  → quotedRate   (the DJ's computed price for the gig)
    // Quote-mode bookings (DJ hasn't set a rate) have neither. We show the
    // rate when EITHER is present and only fall back to the prompt note
    // when there's genuinely no price on the request.
    const offerAmount = body.offerAmount as number | string | undefined;
    const quotedRate = body.quotedRate as number | string | undefined;
    const offerCurrency = (body.offerCurrency as string | undefined)
      || (body.currency as string | undefined) || 'USD';
    const totalHours = body.totalHours as number | string | undefined;
    const hourlyRate = body.hourlyRate as number | string | undefined;
    const hasOffer = offerAmount != null && String(offerAmount).trim() !== '';
    const hasQuoted = quotedRate != null && String(quotedRate).trim() !== '';
    const rateValueNum = hasOffer ? Number(offerAmount)
      : hasQuoted ? Number(quotedRate)
      : null;
    // Per-hour rate — present only for hourly-rate bookings. When set, the
    // rate box shows the "$X/hr × N hr" breakdown beside the total.
    const hourlyRateNum = hourlyRate != null && String(hourlyRate).trim() !== ''
      ? Number(hourlyRate) : null;

    const dateStr = fmtDate(eventDate);
    const timeStr = fmtTimeRange(startTime, endTime);
    // Set type (club) — "Event Type" labelling belongs to mobile bookings.
    // setTypeLabel / venueTypeLabel title-case the stored value.
    const setTypeText = setTypeLabel(setType);
    const venueTypeDisplay = venueTypeLabel(venueType);
    // Equipment — booker picks which gear the DJ supplies. Maps the stored
    // code to the same wording shown in the booking form.
    const equipmentLabel = ({
      sound_system: 'DJ provides system + decks',
      decks_only: 'DJ provides decks',
      venue_provides: 'Venue provides all',
    } as Record<string, string>)[equipment || ''] || '';
    // Address row — link to Google Maps so the DJ/host can tap straight
    // through to directions.
    const mapsHref = venueAddress
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueAddress)}`
      : '';
    const row = (label: string, value: string) =>
      `<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">${label}:</strong> ${value}</p>`;
    const lastRow = (label: string, value: string) =>
      `<p style="margin:0;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">${label}:</strong> ${value}</p>`;

    // DJ-facing rate box. Mobile and club share this — for mobile it
    // renders the "respond with your quote" prompt when no rate is set.
    const djRateBox = rateValueNum != null && !isNaN(rateValueNum)
      ? `<div style="background:#eafaf4;border:1px solid #b6e8d6;border-radius:8px;padding:14px 20px;margin-bottom:24px;">
           <p style="margin:0;color:#1a1a2e;font-size:14px;"><strong>${hasOffer ? 'Offered Rate' : 'Quoted Rate'}:</strong> ${currencySymbol(offerCurrency)}${escHtml(String(rateValueNum.toLocaleString()))} ${escHtml(offerCurrency)}${
             totalHours != null && String(totalHours).trim() !== '' && !hasOffer
               ? ` <span style="color:#666;">(${escHtml(String(totalHours))} hr total)</span>`
               : ''
           }</p>${
             hourlyRateNum != null && !isNaN(hourlyRateNum) && totalHours != null && String(totalHours).trim() !== ''
               ? `<p style="margin:6px 0 0;color:#666;font-size:13px;">${currencySymbol(offerCurrency)}${escHtml(String(hourlyRateNum.toLocaleString()))}/hr × ${escHtml(String(totalHours))} hr</p>`
               : ''
           }
         </div>`
      : `<div style="background:#fff7e6;border:1px solid #f0d9a8;border-radius:8px;padding:14px 20px;margin-bottom:24px;">
           <p style="margin:0;color:#7a5a13;font-size:14px;">This request doesn't include a set rate. Open the booking request and <strong>respond with your quote</strong> to move it forward.</p>
         </div>`;

    // Mobile bookings: card built by the shared helper with the fixed
    // field order, package details, and wedding/cocktail rows. The Quoted
    // Rate row is folded into the card; the prompt box only shows when
    // there's no rate. Club bookings keep their original inline card.
    const mobileCard = mobileBookingRequestBox({
      eventTypeText: eventTypeLabel(eventType),
      date: eventDate,
      startTime,
      endTime,
      venueName,
      venueAddress,
      packageTitle,
      packageDetails,
      rateLabel: rateValueNum != null && !isNaN(rateValueNum) ? 'Quoted Rate' : undefined,
      rateValue: rateValueNum != null && !isNaN(rateValueNum)
        ? `${currencySymbol(offerCurrency)}${rateValueNum.toLocaleString()} ${offerCurrency}`
        : undefined,
      isWedding,
      cocktailNeeded,
      cocktailStart,
      cocktailSameRoom,
    });

    const djBody = isMobileBooking
      ? `${mobileCard}${
          rateValueNum != null && !isNaN(rateValueNum)
            ? ''
            : `<div style="background:#fff7e6;border:1px solid #f0d9a8;border-radius:8px;padding:14px 20px;margin-bottom:24px;">
                 <p style="margin:0;color:#7a5a13;font-size:14px;">This request doesn't include a set rate. Open the booking request and <strong>respond with your quote</strong> to move it forward.</p>
               </div>`
        }`
      : `<div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          ${row('Date', dateStr)}
          ${timeStr !== '—' ? row('Time', escHtml(timeStr)) : ''}
          ${packageTitle ? row('Package', escHtml(packageTitle)) : ''}
          ${eventTypeLabel(eventType) ? row('Event Type', escHtml(eventTypeLabel(eventType))) : ''}
          ${venueName ? row('Venue', escHtml(venueName)) : ''}
          ${venueAddress ? row('Address', `<a href="${mapsHref}" style="color:#0a7d5a;text-decoration:underline;">${escHtml(venueAddress)}</a>`) : ''}
          ${venueTypeDisplay ? row('Venue Type', escHtml(venueTypeDisplay)) : ''}
          ${setTypeText ? row('Set Type', escHtml(setTypeText)) : ''}
          ${equipmentLabel ? lastRow('Equipment', escHtml(equipmentLabel)) : ''}
        </div>
        ${djRateBox}`;

    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [djEmail],
      subject: `New Booking Request from ${requesterName || 'a booker'} – ${dateStr}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Booking Request</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(djName || 'there')}, you have a new booking request from <strong>${escHtml(requesterName || 'a booker')}</strong>.</p>
        ${djBody}
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
    // Mobile-only: HTML package details + wedding cocktail-hour context.
    const packageDetails = body.packageDetails as string | undefined;
    const isWedding = body.isWedding === true;
    const cocktailNeeded = body.cocktailNeeded === true;
    const cocktailStart = body.cocktailStart as string | undefined;
    const cocktailSameRoom = body.cocktailSameRoom === true;
    const setType = body.setType as string | undefined;
    const venueType = body.venueType as string | undefined;
    const equipment = body.equipment as string | undefined;
    // Mobile vs club — same discriminator the DJ-side email uses.
    const isMobileBooking = !setType;
    // Rate fields — mirror the DJ-side request email so the booker keeps
    // a record of the price they requested at.
    const offerAmount = body.offerAmount as number | string | undefined;
    const quotedRate = body.quotedRate as number | string | undefined;
    const confCurrency = (body.offerCurrency as string | undefined)
      || (body.currency as string | undefined) || 'USD';
    const confTotalHours = body.totalHours as number | string | undefined;
    const confHourlyRate = body.hourlyRate as number | string | undefined;
    const confHasOffer = offerAmount != null && String(offerAmount).trim() !== '';
    const confHasQuoted = quotedRate != null && String(quotedRate).trim() !== '';
    const confRateNum = confHasOffer ? Number(offerAmount)
      : confHasQuoted ? Number(quotedRate)
      : null;
    const confHourlyNum = confHourlyRate != null && String(confHourlyRate).trim() !== ''
      ? Number(confHourlyRate) : null;
    const confEquipmentLabel = ({
      sound_system: 'DJ provides system + decks',
      decks_only: 'DJ provides decks',
      venue_provides: 'Venue provides all',
    } as Record<string, string>)[equipment || ''] || '';
    const dateStr = fmtDate(eventDate);
    // Mobile bookings render the identical card the DJ receives, via the
    // shared helper. Club bookings keep the existing bookingInfoBox layout.
    const confCard = isMobileBooking
      ? mobileBookingRequestBox({
          eventTypeText: eventTypeLabel(eventType),
          date: eventDate,
          startTime,
          endTime,
          venueName,
          venueAddress,
          packageTitle,
          packageDetails,
          rateLabel: confRateNum != null && !isNaN(confRateNum) ? 'Quoted Rate' : undefined,
          rateValue: confRateNum != null && !isNaN(confRateNum)
            ? `${currencySymbol(confCurrency)}${confRateNum.toLocaleString()} ${confCurrency}`
            : undefined,
          isWedding,
          cocktailNeeded,
          cocktailStart,
          cocktailSameRoom,
        })
      : bookingInfoBox({
          eventTypeText: eventTypeLabel(eventType),
          setTypeText: setTypeLabel(setType),
          date: eventDate,
          timeRange: fmtTimeRange(startTime, endTime),
          packageTitle,
          venueTypeText: venueTypeLabel(venueType),
          venueName,
          venueAddress,
          equipmentText: confEquipmentLabel,
          rateLabel: confRateNum != null && !isNaN(confRateNum)
            ? (confHasOffer ? 'Offered Rate' : 'Quoted Rate')
            : undefined,
          rateValue: confRateNum != null && !isNaN(confRateNum)
            ? `${currencySymbol(confCurrency)}${confRateNum.toLocaleString()} ${confCurrency}${
                confTotalHours != null && String(confTotalHours).trim() !== '' && !confHasOffer
                  ? ` (${confTotalHours} hr total)` : ''
              }`
            : undefined,
          rateBreakdown: confHourlyNum != null && !isNaN(confHourlyNum)
            && confTotalHours != null && String(confTotalHours).trim() !== ''
            ? `${currencySymbol(confCurrency)}${confHourlyNum.toLocaleString()}/hr × ${confTotalHours} hr`
            : undefined,
        });
    // Mobile quote-style requests: tell the booker the DJ will reply with
    // an offer, matching the prompt the DJ sees on their side.
    const confQuoteNote = isMobileBooking && (confRateNum == null || isNaN(confRateNum))
      ? `<div style="background:#fff7e6;border:1px solid #f0d9a8;border-radius:8px;padding:14px 20px;margin-bottom:24px;">
           <p style="margin:0;color:#7a5a13;font-size:14px;">This request doesn't include a set rate — the DJ will <strong>respond with an offer</strong>.</p>
         </div>`
      : '';
    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [requesterEmail],
      subject: `Booking request sent to ${djName || 'your DJ'} – ${dateStr}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Booking Request Sent</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(requesterName || 'there')}, your booking request has been sent to <strong>${escHtml(djName || 'the DJ')}</strong>. They'll respond shortly — you'll get an email when they do.</p>
        ${confCard}
        ${confQuoteNote}
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

  } else if (type === 'event_invite_from_host') {
    // Host/venue added a DJ to a manual event on /upcoming-events. Two cases:
    //   1. DJ already has an account → "You have a pending booking" + login CTA
    //   2. DJ NOT on system → "Create an account to claim this booking" + signup CTA
    const recipientEmail = body.recipientEmail as string | undefined;
    if (!recipientEmail || !recipientEmail.includes('@')) {
      return NextResponse.json(
        { error: 'Missing or invalid recipientEmail for event_invite_from_host' },
        { status: 400 },
      );
    }
    const hostName = (body.hostName as string | undefined) || 'A host';
    const djFound = body.djFound === true;
    const djType = body.djType as string | null | undefined; // 'club' | 'mobile' if known
    const bookingId = body.bookingId as string | undefined;
    const eventDate = body.eventDate as string | null | undefined;
    const startTime = body.startTime as string | null | undefined;
    const endTime = body.endTime as string | null | undefined;
    const eventType = body.eventType as string | undefined; // 'club' | 'mobile'
    const venueName = body.venueName as string | null | undefined;
    const venueAddress = body.venueAddress as string | null | undefined;
    const rate = body.rate as number | null | undefined;
    const currency = (body.currency as string | undefined) || 'USD';

    // Type-mismatch note: club/bar event going to a mobile DJ (or vice versa).
    // Only relevant when the DJ exists on the system AND their dj_type
    // doesn't match the event's booking_type.
    const eventTypeLabelStr = eventType === 'club' ? 'Club / Bar' : eventType === 'mobile' ? 'Mobile / Private' : 'Event';
    const typeMismatch = djFound && djType && eventType && djType !== eventType;
    const mismatchNote = typeMismatch
      ? `<p style="color:#666666;margin-bottom:14px;font-size:13px;line-height:1.5;background:#fff3cd;border-left:3px solid #f0ad4e;padding:10px 12px;border-radius:4px;"><strong>Note:</strong> This is a ${escHtml(eventTypeLabelStr)} event. Your profile is registered as a ${escHtml(djType === 'club' ? 'Club / Bar' : 'Mobile')} DJ. You can still accept the booking — it will appear in your upcoming bookings — but it won't be displayed publicly on your profile event list.</p>`
      : '';

    const rateLine = (rate != null && Number.isFinite(rate) && rate > 0)
      ? `<p style="margin:0 0 8px;color:#1a1a2e;"><strong>Rate:</strong> ${escHtml(currency)} ${rate.toLocaleString()}</p>`
      : '';

    // Compose a one-line "shared event details for {date} at {venue}"
    // summary used in the intro paragraph and subject line.
    const fmtDateShort = (d: string | null | undefined): string => {
      if (!d) return '';
      const [y, m, day] = d.split('-').map((s) => parseInt(s, 10));
      const dt = new Date(y, m - 1, day);
      return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    };
    const dateStr = fmtDateShort(eventDate);
    const venueStr = (venueName || '').trim() || (venueAddress || '').split(',')[0].trim();
    const detailsLine = [dateStr, venueStr].filter(Boolean).join(' at ');

    const ctaHref = djFound
      ? `${SITE_URL}/claim-booking?id=${encodeURIComponent(bookingId || '')}`
      : `${SITE_URL}/signup?email=${encodeURIComponent(recipientEmail)}${bookingId ? `&claim_booking=${encodeURIComponent(bookingId)}` : ''}`;
    const ctaLabel = djFound ? 'Add Booking to My Account' : 'Create Account';

    const intro = djFound
      ? `${escHtml(hostName)} has shared event details${detailsLine ? ` for ${escHtml(detailsLine)}` : ''}. Log in to see this in your upcoming bookings.`
      : `${escHtml(hostName)} has shared event details${detailsLine ? ` for ${escHtml(detailsLine)}` : ''}. Create a free account to manage it and access future bookings.`;

    const subject = `New event from ${hostName}`;

    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [recipientEmail],
      subject,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">You've Been Added to an Event</h2>
        <p style="color:#666666;margin-bottom:20px;">${intro}</p>
        ${mismatchNote}
        ${bookingInfoBox({
          date: eventDate,
          timeRange: fmtTimeRange(startTime, endTime),
          venueName: venueName || undefined,
          venueAddress: venueAddress || undefined,
        })}
        ${rateLine ? `<div style="margin:14px 0;">${rateLine}</div>` : ''}
        ${ctaButton(ctaHref, ctaLabel)}
        <p style="color:#999999;margin-top:24px;font-size:12px;line-height:1.6;text-align:center;">If you weren't expecting this email, please reply to let us know.</p>
      `),
    };

  } else if (type === 'booking_activity') {
    // Fired by the client whenever a user adds a note or uploads a flyer
    // on a booking that's shared with another party. Server figures out
    // the other party's email (the DJ if actor is the host, or vice versa)
    // and sends a short notification with a link to the booking.
    //
    // Required fields: bookingId, actorId, activity ('note' | 'flyer').
    const bookingId = body.bookingId as string | undefined;
    const actorId = body.actorId as string | undefined;
    const activity = body.activity as 'note' | 'flyer' | undefined;
    if (!bookingId || !actorId || !activity) {
      return NextResponse.json(
        { error: 'booking_activity requires bookingId, actorId, activity' },
        { status: 400 },
      );
    }

    // Look up the booking (admin) to find both parties.
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const admin = createAdminClient();
    const { data: booking } = await admin
      .from('bookings')
      .select('id, dj_id, requester_id, event_date, start_time, end_time, venue_name, venue_address, booking_type')
      .eq('id', bookingId)
      .maybeSingle<{
        id: string;
        dj_id: string | null;
        requester_id: string | null;
        event_date: string | null;
        start_time: string | null;
        end_time: string | null;
        venue_name: string | null;
        venue_address: string | null;
        booking_type: string | null;
      }>();
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    // Only club/bar bookings have notes/flyers visible to both sides.
    if (booking.booking_type !== 'club') {
      return NextResponse.json({ ok: true, skipped: 'not club booking' });
    }

    // The "other party" is whichever side ISN'T the actor.
    let recipientId: string | null = null;
    if (booking.dj_id === actorId) recipientId = booking.requester_id;
    else if (booking.requester_id === actorId) recipientId = booking.dj_id;
    if (!recipientId) {
      // No counterparty (e.g., manual event with no DJ yet) — skip silently.
      return NextResponse.json({ ok: true, skipped: 'no counterparty' });
    }

    // Look up the recipient's email via auth.users, and both parties' names.
    const { data: { user: recipUser } } = await admin.auth.admin.getUserById(recipientId);
    const recipientEmail = recipUser?.email || null;
    if (!recipientEmail) {
      return NextResponse.json({ ok: true, skipped: 'no recipient email' });
    }
    const { data: actorProfile } = await admin
      .from('users')
      .select('name')
      .eq('id', actorId)
      .maybeSingle<{ name: string | null }>();
    const actorName = actorProfile?.name || 'Someone';

    // Recipient's CTA path — DJ goes to upcoming-bookings, host to upcoming-events.
    const recipientIsRequester = recipientId === booking.requester_id;
    const ctaPath = recipientIsRequester ? '/upcoming-events' : '/upcoming-bookings';
    const ctaUrl = `${SITE_URL}${ctaPath}`;

    // Compose copy.
    const fmtDate = (d: string | null | undefined) => {
      if (!d) return '';
      const [y, m, day] = d.split('-').map((s) => parseInt(s, 10));
      const dt = new Date(y, m - 1, day);
      return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    };
    const dateStr = fmtDate(booking.event_date);
    const venueStr = (booking.venue_name || '').trim() || (booking.venue_address || '').split(',')[0].trim();
    const eventDescriptor = [dateStr, venueStr].filter(Boolean).join(' at ');

    const actionLabel = activity === 'note' ? 'added a note' : 'uploaded a flyer';
    const subject = `${actorName} ${actionLabel} on your booking`;
    const h2 = activity === 'note' ? 'New note on your booking' : 'New flyer on your booking';

    emailPayload = {
      from: FROM,
      replyTo: REPLY_TO,
      to: [recipientEmail],
      subject,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">${h2}</h2>
        <p style="color:#666666;margin-bottom:20px;">
          <strong>${escHtml(actorName)}</strong> ${actionLabel} on your booking${eventDescriptor ? ` for ${escHtml(eventDescriptor)}` : ''}.
        </p>
        ${ctaButton(ctaUrl, 'View Booking')}
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
