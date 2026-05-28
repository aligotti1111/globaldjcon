// API route: GET /api/verify-email?token=<hex>
//
// Validates the verification token, marks the user's email as verified
// (sets BOTH email_verified=true AND email_verified_at=now()), fires a
// fire-and-forget welcome email, then auto-logs them in via a Supabase
// magic link and redirects to a role-appropriate destination page.
//
// The destination page renders <EmailVerifiedBanner /> which detects the
// fresh email_verified_at timestamp (within last 60s) on the user record
// and shows a green "Email confirmed" notice.
//
// Welcome email: sent ONLY on the first successful verification (NOT on
// duplicate clicks of the verify link). Fire-and-forget — a failed send
// is logged but does not block the redirect or fail the verification.
//
// Destinations after successful verification:
//   - DJ    → /update-dj-profile
//   - venue → /account-settings
//   - host  → /
//
// Security note: the magic link in the redirect URL grants a session to
// whoever follows it. The link is one-time-use (consumed on first follow)
// and short-lived. Standard tradeoff (same as password reset emails).
//
// Fallback: if magic-link generation fails for any reason, falls back to
// a plain redirect. The user will be bounced to /login by middleware, but
// their email is still marked verified.

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase/admin';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const LOGO_URL = 'https://hwqvzuusquruhwguqole.supabase.co/storage/v1/object/public/assets/gdj-logo-email.png';

// Returns an HTML error page styled to match the site theme
function htmlErrorResponse(title: string, message: string, status: number, origin: string) {
  const color = '#ff5f5f';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title} — Global DJ Connect</title><style>
    body{margin:0;padding:0;background:#050507;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f0f0f8;display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .card{background:#13131e;border:1px solid #1e1e30;border-radius:12px;padding:40px 32px;max-width:480px;width:90%;text-align:center;}
    h1{font-family:'Bebas Neue',sans-serif;font-size:32px;letter-spacing:.05em;color:${color};margin:0 0 16px;}
    p{font-size:15px;line-height:1.6;color:#c4c4d4;margin:0 0 16px;}
    a{display:inline-block;margin-top:20px;background:${color};color:#000;padding:12px 24px;border-radius:6px;font-weight:700;text-decoration:none;letter-spacing:.04em;font-size:14px;}
  </style></head><body>
    <div class="card">
      <h1>${title}</h1>
      <p>${message}</p>
      <a href="${origin}/login">Sign In</a>
    </div>
  </body></html>`;
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}

// Decide where to send the user post-verification based on their role.
// Returns a path (no origin) — the caller composes the full URL.
// No more ?emailverified=1 query param needed; the banner detects the
// fresh email_verified_at timestamp on the user record.
function destinationPathForRole(role: string | null | undefined): string {
  switch ((role || '').toLowerCase()) {
    case 'dj':
      return '/update-dj-profile';
    case 'venue':
      return '/account-settings';
    case 'host':
      return '/';
    default:
      return '/';
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return htmlErrorResponse(
      'Server Error',
      'Verification service is misconfigured. Please contact support.',
      500,
      origin
    );
  }

  const token = requestUrl.searchParams.get('token') || '';
  if (!token) {
    return htmlErrorResponse(
      'Missing Token',
      'No verification token was provided in the link.',
      400,
      origin
    );
  }

  const admin = createAdminClient();

  // Step 1: look up the token row
  type TokenRow = {
    user_id: string;
    used_at: string | null;
    expires_at: string;
    booking_redirect: string | null;
  };
  let tokenRow: TokenRow | null = null;
  try {
    const { data, error } = await admin
      .from('email_verification_tokens')
      .select('user_id, used_at, expires_at, booking_redirect')
      .eq('token', token)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    // Cast: the generated Supabase types don't include this table, so
    // .maybeSingle() returns `never`. We know the shape from the .select().
    tokenRow = data as TokenRow | null;
  } catch (e) {
    console.error('[verify-email] token lookup failed', e);
    return htmlErrorResponse(
      'Verification Error',
      'Could not validate the token. Please try again.',
      502,
      origin
    );
  }

  if (!tokenRow) {
    return htmlErrorResponse(
      'Invalid Link',
      'This verification link is invalid. It may have been mistyped or already used.',
      404,
      origin
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  // Look up a user's role + email + name + slug. Role drives destination,
  // email is needed for the magic link, name + slug feed the welcome email.
  async function lookupUserDetails(userId: string): Promise<{
    role: string | null;
    email: string | null;
    name: string | null;
    slug: string | null;
  }> {
    const result: {
      role: string | null;
      email: string | null;
      name: string | null;
      slug: string | null;
    } = {
      role: null,
      email: null,
      name: null,
      slug: null,
    };
    try {
      const { data } = await admin
        .from('users')
        .select('role, name, slug')
        .eq('id', userId)
        .maybeSingle<{ role: string | null; name: string | null; slug: string | null }>();
      result.role = data?.role ?? null;
      result.name = data?.name ?? null;
      result.slug = data?.slug ?? null;
    } catch (e) {
      console.warn('[verify-email] profile lookup failed (non-fatal)', e);
    }
    try {
      const { data } = await admin.auth.admin.getUserById(userId);
      result.email = data?.user?.email ?? null;
    } catch (e) {
      console.warn('[verify-email] email lookup failed (non-fatal)', e);
    }
    return result;
  }

  // Generate a one-time magic-link URL that, when followed, establishes a
  // session for the user and then redirects to `destinationPath`. Returns
  // null if the magic link can't be generated for any reason.
  async function generateAutoLoginUrl(
    email: string,
    destinationPath: string
  ): Promise<string | null> {
    try {
      const redirectTo = `${origin}${destinationPath}`;
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo },
      });
      if (error) {
        console.warn('[verify-email] generateLink error (non-fatal)', error);
        return null;
      }
      const actionLink = data?.properties?.action_link;
      return actionLink || null;
    } catch (e) {
      console.warn('[verify-email] generateLink threw (non-fatal)', e);
      return null;
    }
  }

  // Compose the final redirect: prefer auto-login magic link; fall back to
  // a plain redirect to the destination path.
  async function buildFinalRedirect(userId: string): Promise<string> {
    const { role, email } = await lookupUserDetails(userId);
    const destinationPath = destinationPathForRole(role);
    if (email) {
      const magicUrl = await generateAutoLoginUrl(email, destinationPath);
      if (magicUrl) return magicUrl;
    }
    return `${origin}${destinationPath}`;
  }

  // Fire-and-forget welcome email. Called only on the FIRST successful
  // verification (not on duplicate clicks). Uses the existing send-email
  // route which already has a 'welcome' template branch. Does not throw —
  // a failed send is logged but never blocks the verification flow.
  async function sendWelcomeEmail(
    email: string | null,
    name: string | null,
    role: string | null,
    slug: string | null
  ): Promise<void> {
    if (!email || !name || !role) {
      console.warn('[verify-email] skipping welcome email: missing email/name/role');
      return;
    }
    try {
      const res = await fetch(`${origin}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'welcome',
          name,
          email,
          role,
          slug: slug || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn('[verify-email] welcome email non-OK response', res.status, body);
      }
    } catch (e) {
      console.warn('[verify-email] welcome email send threw (non-fatal)', e);
    }
  }

  // Dedicated "continue your booking" follow-up email. Sent only when the
  // signup carried a booking intent (booking_redirect stored on the token)
  // AND only on first verification. Fire-and-forget. Looks up the DJ's
  // display name from the slug for a friendlier subject/body.
  async function sendBookingFollowupEmail(
    toEmail: string | null,
    toName: string | null,
    bookingRedirect: string | null
  ): Promise<void> {
    if (!toEmail || !bookingRedirect) return;
    if (!process.env.RESEND_API_KEY) {
      console.warn('[verify-email] skipping booking follow-up: RESEND_API_KEY not set');
      return;
    }
    try {
      // booking_redirect looks like "/<slug>?date=YYYY-MM-DD&book=1"
      const qIndex = bookingRedirect.indexOf('?');
      const slug = bookingRedirect.slice(1, qIndex === -1 ? undefined : qIndex).split('/')[0];
      const params = qIndex === -1
        ? new URLSearchParams()
        : new URLSearchParams(bookingRedirect.slice(qIndex + 1));
      const dateStr = params.get('date') || '';
      const niceDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
        ? new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
          })
        : '';

      // Look up the DJ's display name from the slug (best-effort).
      let djName = 'your DJ';
      try {
        const { data } = await admin
          .from('users')
          .select('name')
          .eq('slug', slug)
          .maybeSingle<{ name: string | null }>();
        if (data?.name) djName = data.name;
      } catch { /* non-fatal — fall back to generic */ }

      // Plain link to the booking page. No magic link needed: a user who
      // has just verified stays logged in (durable cookie session), so the
      // booking link only needs to navigate them to the right page — they
      // already have a session. Using a magic link here was fragile: those
      // OTPs are one-time-use and short-lived, so by the time the user
      // clicked it from their inbox it often returned otp_expired and
      // dumped them on the homepage with an auth error. A plain link can't
      // expire and "just works" because the session is already present.
      // (If the email is opened in a different browser with no session, the
      // booking gate simply asks them to log in once — acceptable.)
      const bookingUrl = `${origin}${bookingRedirect}`;
      const greeting = toName ? `Hi ${toName},` : 'Hi,';
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body{margin:0;padding:0;background:#050507;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f0f0f8;}
        .wrap{max-width:560px;margin:0 auto;padding:40px 24px;}
        .card{background:#13131e;border:1px solid #1e1e30;border-radius:12px;padding:40px 32px;}
        h1{font-family:'Bebas Neue',sans-serif;font-size:32px;letter-spacing:.05em;color:#00f5c4;margin:0 0 16px;}
        p{font-size:15px;line-height:1.6;color:#c4c4d4;margin:0 0 16px;}
        .btn{display:inline-block;background:#00f5c4;color:#000;padding:14px 28px;border-radius:6px;font-weight:700;text-decoration:none;letter-spacing:.04em;font-size:14px;margin:20px 0;}
        .footer{font-size:12px;color:#6a6a80;text-align:center;margin-top:24px;}
        .logo{text-align:center;margin-bottom:24px;}
        .logo img{max-width:220px;height:auto;}
      </style></head><body>
        <div class="wrap">
          <div class="logo"><img src="${LOGO_URL}" alt="Global DJ Connect"></div>
          <div class="card">
            <h1>Finish Your Booking</h1>
            <p>${greeting}</p>
            <p>Your email is verified and your account is ready. Pick up where you left off and request to book <strong>${djName}</strong>${niceDate ? ` for <strong>${niceDate}</strong>` : ''}.</p>
            <p style="text-align:center;"><a href="${bookingUrl}" class="btn">Continue Your Booking</a></p>
            <p style="font-size:13px;color:#8a8a9e;">Or paste this link into your browser:<br><span style="word-break:break-all;color:#00f5c4;">${bookingUrl}</span></p>
          </div>
          <div class="footer">Global DJ Connect · globaldjconnect.com</div>
        </div>
      </body></html>`;

      const resend = new Resend(process.env.RESEND_API_KEY);
      const { error } = await resend.emails.send({
        from: FROM,
        to: [toEmail],
        replyTo: REPLY_TO,
        subject: `Finish booking ${djName}${niceDate ? ` · ${niceDate}` : ''}`,
        html,
      });
      if (error) {
        console.warn('[verify-email] booking follow-up send error (non-fatal)', error);
      }
    } catch (e) {
      console.warn('[verify-email] booking follow-up threw (non-fatal)', e);
    }
  }

  // ── Already-used token: treat as success but DON'T re-stamp verified_at ─
  // User clicked the link twice. Email is already verified — don't refresh
  // the timestamp (would re-trigger the banner unexpectedly).
  if (tokenRow.used_at) {
    const finalUrl = await buildFinalRedirect(tokenRow.user_id);
    return NextResponse.redirect(finalUrl, 302);
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    return htmlErrorResponse(
      'Link Expired',
      'This verification link has expired. Sign in and click "Resend Email" in the banner at the top of the page to get a new one.',
      410,
      origin
    );
  }

  // Step 2: flip email_verified = true AND set email_verified_at = now().
  // The timestamp is what EmailVerifiedBanner uses to decide whether to
  // show — if it's within the last 60 seconds, the banner appears.
  try {
    const { error } = await admin
      .from('users')
      .update({
        email_verified: true,
        email_verified_at: new Date().toISOString(),
      } as unknown as never)
      .eq('id', tokenRow.user_id);
    if (error) throw error;
  } catch (e) {
    console.error('[verify-email] users update failed', e);
    return htmlErrorResponse(
      'Verification Error',
      'Could not mark your account as verified. Please contact support.',
      502,
      origin
    );
  }

  // Step 3: mark token as used (non-fatal if this fails)
  try {
    await admin
      .from('email_verification_tokens')
      .update({ used_at: new Date().toISOString() } as unknown as never)
      .eq('token', token);
  } catch (e) {
    console.warn('[verify-email] mark-used failed (non-fatal)', e);
  }

  // Step 4: send welcome email (fire-and-forget, first-verify only).
  // We're past the tokenRow.used_at check above, so this branch runs only
  // on the very first successful verification — no risk of double-sends.
  // Look up user details once and reuse for both welcome + redirect.
  const userDetails = await lookupUserDetails(tokenRow.user_id);
  await sendWelcomeEmail(
    userDetails.email,
    userDetails.name,
    userDetails.role,
    userDetails.slug
  );
  // If this signup carried a booking intent, send the dedicated
  // "continue your booking" email now (first-verify only, fire-and-forget).
  await sendBookingFollowupEmail(
    userDetails.email,
    userDetails.name,
    tokenRow.booking_redirect
  );

  // Step 5: redirect via auto-login magic link to the role-appropriate
  // destination. The banner will detect the fresh email_verified_at
  // timestamp on the user record and show itself.
  const destinationPath = destinationPathForRole(userDetails.role);
  let finalUrl = `${origin}${destinationPath}`;
  if (userDetails.email) {
    const magicUrl = await generateAutoLoginUrl(userDetails.email, destinationPath);
    if (magicUrl) finalUrl = magicUrl;
  }
  return NextResponse.redirect(finalUrl, 302);
}
