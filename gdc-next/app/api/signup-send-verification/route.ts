// API route: POST /api/signup-send-verification
// Ports /netlify/functions/signup-send-verification.js to a Next.js route.
//
// Generates a one-time email-verification token, stores it in
// public.email_verification_tokens, and sends the user a verification link
// via Resend. The link points at /api/verify-email?token=... which flips
// public.users.email_verified = true.
//
// Auth note: this is intentionally NOT behind auth — it's called immediately
// after signUp from the browser (when the user has a session but maybe not
// a usable one yet) AND from the resend button on the success screen (where
// there's no session). We rely on the token system being self-validating.
//
// Body: { user_id?, email, role, slug? }
//   user_id is optional. When omitted (resend case), we look it up by email
//   via the admin auth API.

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { randomBytes } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

const TOKEN_TTL_HOURS = 24;
const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const LOGO_URL = 'https://hwqvzuusquruhwguqole.supabase.co/storage/v1/object/public/assets/gdj-logo-email.png';

interface SendVerificationBody {
  user_id?: string;
  email: string;
  role: 'dj' | 'host' | 'venue';
  slug?: string | null;
  // Optional booking intent — set when the signup originated from a
  // "Sign in to book" gate (embed or profile calendar). When both are
  // present, the confirmation email includes a "Continue booking" link.
  bookingDjSlug?: string | null;
  bookingDate?: string | null;
}

export async function POST(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY not set' },
      { status: 500 }
    );
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY not set' }, { status: 500 });
  }

  let body: SendVerificationBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { email, role } = body;
  let { user_id } = body;
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // If user_id wasn't provided (resend case), look it up by email
  if (!user_id) {
    try {
      // Supabase admin.listUsers can paginate; we use email filter via the
      // dedicated method when available, otherwise fall back to a small list.
      const { data, error } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (error) throw error;
      const match = data?.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (!match) {
        return NextResponse.json(
          { error: 'No account found for that email' },
          { status: 404 }
        );
      }
      user_id = match.id;
    } catch (e) {
      console.error('[signup-send-verification] user lookup failed', e);
      return NextResponse.json(
        { error: 'Could not look up the user. Please try again.' },
        { status: 500 }
      );
    }
  }

  // Generate token + insert into email_verification_tokens
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();

  try {
    const { error } = await admin
      .from('email_verification_tokens')
      .insert({
        token,
        user_id,
        email,
        expires_at: expiresAt,
      } as unknown as never);
    if (error) throw error;
  } catch (e) {
    console.error('[signup-send-verification] token insert failed', e);
    return NextResponse.json(
      { error: 'Could not create verification token' },
      { status: 502 }
    );
  }

  // Build the verify URL using the same origin we received the request on,
  // so verification works on staging (gdc-next-staging.netlify.app) AND
  // production (globaldjconnect.com) without env-var juggling.
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const verifyUrl = `${origin}/api/verify-email?token=${encodeURIComponent(token)}`;
  const roleDisplay = role === 'dj' ? 'DJ' : (role === 'venue' ? 'Venue' : 'Host');

  // Optional "Continue booking" link — only when the signup carried a
  // booking intent (slug + a valid YYYY-MM-DD date). Lands the verified
  // user back on the DJ profile with the date pre-selected and the
  // booking form opening (book=1). This is a SEPARATE link from Verify —
  // it does not change what the Verify button does.
  const { bookingDjSlug, bookingDate } = body;
  const validDate = !!bookingDate && /^\d{4}-\d{2}-\d{2}$/.test(bookingDate);
  const bookingUrl = (bookingDjSlug && validDate)
    ? `${origin}/${encodeURIComponent(bookingDjSlug)}?date=${encodeURIComponent(bookingDate!)}&book=1`
    : null;
  const niceDate = validDate
    ? new Date(`${bookingDate}T12:00:00`).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      })
    : '';
  const bookingBlock = bookingUrl
    ? `<p style="margin-top:28px;">Once your email is verified, continue the booking you started:</p>
       <p style="text-align:center;"><a href="${bookingUrl}" class="btn btn2">Continue Your Booking${niceDate ? ` · ${niceDate}` : ''}</a></p>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:0;background:#050507;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f0f0f8;}
    .wrap{max-width:560px;margin:0 auto;padding:40px 24px;}
    .card{background:#13131e;border:1px solid #1e1e30;border-radius:12px;padding:40px 32px;}
    h1{font-family:'Bebas Neue',sans-serif;font-size:32px;letter-spacing:.05em;color:#00f5c4;margin:0 0 16px;}
    p{font-size:15px;line-height:1.6;color:#c4c4d4;margin:0 0 16px;}
    .btn{display:inline-block;background:#00f5c4;color:#000;padding:14px 28px;border-radius:6px;font-weight:700;text-decoration:none;letter-spacing:.04em;font-size:14px;margin:20px 0;}
    .btn2{background:transparent;color:#00f5c4;border:1px solid #00f5c4;}
    .footer{font-size:12px;color:#6a6a80;text-align:center;margin-top:24px;}
    .logo{text-align:center;margin-bottom:24px;}
    .logo img{max-width:220px;height:auto;}
  </style></head><body>
    <div class="wrap">
      <div class="logo"><img src="${LOGO_URL}" alt="Global DJ Connect"></div>
      <div class="card">
        <h1>Confirm Your Email</h1>
        <p>Welcome to Global DJ Connect! You've been signed up as a ${roleDisplay}.</p>
        <p>Click the button below to verify your email and unlock messaging, booking, and all features:</p>
        <p style="text-align:center;"><a href="${verifyUrl}" class="btn">Verify Email</a></p>
        <p style="font-size:13px;color:#8a8a9e;">Or paste this link into your browser:<br><span style="word-break:break-all;color:#00f5c4;">${verifyUrl}</span></p>
        ${bookingBlock}
        <p style="font-size:13px;color:#8a8a9e;margin-top:24px;">This link expires in ${TOKEN_TTL_HOURS} hours. If you didn't sign up, you can safely ignore this email.</p>
      </div>
      <div class="footer">Global DJ Connect · globaldjconnect.com</div>
    </div>
  </body></html>`;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM,
      to: [email],
      replyTo: REPLY_TO,
      subject: 'Confirm Your Email — Global DJ Connect',
      html,
    });
    if (error) throw error;
  } catch (e) {
    console.error('[signup-send-verification] Resend failed', e);
    return NextResponse.json({ error: 'Email send failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
