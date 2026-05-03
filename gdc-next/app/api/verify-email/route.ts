// API route: GET /api/verify-email?token=<hex>
//
// Validates the verification token, marks public.users.email_verified = true,
// marks the token as used, and then AUTO-LOGS THE USER IN by generating a
// one-time magic link via the Supabase admin API and redirecting the browser
// to it. Supabase's auth callback consumes the magic link, sets the session
// cookie, and sends the user on to their role-appropriate destination —
// already signed in, with the green EmailVerifiedBanner showing.
//
// Destinations after successful verification + auto-login:
//   - DJ    → /update-dj-profile?emailverified=1
//   - venue → /account-settings?emailverified=1
//   - host  → /?emailverified=1
//
// Security note: the magic link in the redirect URL grants a session to
// whoever follows it. The link is one-time-use (consumed on first follow)
// and short-lived. Anyone with access to the verification email could
// theoretically intercept and use it — but the same is true of any
// password-reset link, so this is the standard tradeoff.
//
// Fallback: if the magic-link generation fails for any reason, we fall back
// to the previous behavior (redirect without auto-login). The user will be
// bounced to /login by middleware, but their email is still verified.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

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
function destinationPathForRole(role: string | null | undefined): string {
  switch ((role || '').toLowerCase()) {
    case 'dj':
      return '/update-dj-profile?emailverified=1';
    case 'venue':
      return '/account-settings?emailverified=1';
    case 'host':
      return '/?emailverified=1';
    default:
      return '/?emailverified=1';
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
  };
  let tokenRow: TokenRow | null = null;
  try {
    const { data, error } = await admin
      .from('email_verification_tokens')
      .select('user_id, used_at, expires_at')
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

  // Look up a user's role + email so we can pick the right destination AND
  // generate a magic link (which needs the email).
  async function lookupUserDetails(userId: string): Promise<{
    role: string | null;
    email: string | null;
  }> {
    const result: { role: string | null; email: string | null } = {
      role: null,
      email: null,
    };
    // Role from public.users
    try {
      const { data } = await admin
        .from('users')
        .select('role')
        .eq('id', userId)
        .maybeSingle<{ role: string | null }>();
      result.role = data?.role ?? null;
    } catch (e) {
      console.warn('[verify-email] role lookup failed (non-fatal)', e);
    }
    // Email from auth.users (the source of truth for email)
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
  // null if the magic link can't be generated for any reason — the caller
  // should fall back to a plain redirect (user will hit /login but email
  // is still verified).
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
  // a plain redirect to the destination path (which will go through /login
  // due to middleware protection).
  async function buildFinalRedirect(userId: string): Promise<string> {
    const { role, email } = await lookupUserDetails(userId);
    const destinationPath = destinationPathForRole(role);
    if (email) {
      const magicUrl = await generateAutoLoginUrl(email, destinationPath);
      if (magicUrl) return magicUrl;
    }
    // Fallback: plain redirect (no auto-login).
    return `${origin}${destinationPath}`;
  }

  // ── Already-used token: treat as success but still try to auto-login ─
  // User may have clicked the email link twice. Their email is already
  // verified, so just send them on through the normal flow.
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

  // Step 2: flip email_verified = true
  try {
    const { error } = await admin
      .from('users')
      .update({ email_verified: true } as unknown as never)
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

  // Step 4: redirect via auto-login magic link to the role-appropriate
  // destination. If the magic-link generation fails, falls back to a
  // plain redirect (user goes through /login but is still verified).
  const finalUrl = await buildFinalRedirect(tokenRow.user_id);
  return NextResponse.redirect(finalUrl, 302);
}
