// API route: GET /api/verify-email?token=<hex>
// Ports /netlify/functions/verify-email.js to a Next.js route.
//
// Validates the verification token, marks public.users.email_verified = true,
// marks the token as used, and either redirects the user to the account
// settings page (success) or returns an HTML error page (invalid/expired).

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
  let tokenRow: {
    user_id: string;
    used_at: string | null;
    expires_at: string;
  } | null = null;
  try {
    const { data, error } = await admin
      .from('email_verification_tokens')
      .select('user_id, used_at, expires_at')
      .eq('token', token)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    tokenRow = data;
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

  // Already used? Treat as success — user may have clicked twice.
  if (tokenRow.used_at) {
    return NextResponse.redirect(`${origin}/account-settings?emailverified=1`, 302);
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
      .update({ email_verified: true })
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
      .update({ used_at: new Date().toISOString() })
      .eq('token', token);
  } catch (e) {
    console.warn('[verify-email] mark-used failed (non-fatal)', e);
  }

  // Step 4: redirect to settings page with the verified flag set
  return NextResponse.redirect(`${origin}/account-settings?emailverified=1`, 302);
}
