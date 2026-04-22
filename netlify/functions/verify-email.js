// netlify/functions/verify-email.js
// Validates an email-verification token and marks the user as verified by
// flipping public.users.email_verified to true. Then redirects the user to
// /account-settings.html?emailverified=1 so the green confirmation banner
// shows and the verify-banner disappears.
//
// GET /.netlify/functions/verify-email?token=<hex>

const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';
const SITE_URL = 'https://globaldjconnect.com';

function htmlResponse(title, message, isError) {
  const color = isError ? '#ff5f5f' : '#00f5c4';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title} — Global DJ Connect</title><style>
    body{margin:0;padding:0;background:#050507;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f0f0f8;display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .card{background:#13131e;border:1px solid #1e1e30;border-radius:12px;padding:40px 32px;max-width:480px;width:90%;text-align:center;}
    h1{font-family:'Bebas Neue',sans-serif;font-size:32px;letter-spacing:.05em;color:${color};margin:0 0 16px;}
    p{font-size:15px;line-height:1.6;color:#c4c4d4;margin:0 0 16px;}
    a{display:inline-block;margin-top:20px;background:${color};color:#000;padding:12px 24px;border-radius:6px;font-weight:700;text-decoration:none;letter-spacing:.04em;font-size:14px;}
  </style></head><body>
    <div class="card">
      <h1>${title}</h1>
      <p>${message}</p>
      <a href="${SITE_URL}/login.html">Sign In</a>
    </div>
  </body></html>`;
}

exports.handler = async (event) => {
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: htmlResponse('Server Error', 'Verification service is misconfigured. Please contact support.', true)
    };
  }

  const token = (event.queryStringParameters && event.queryStringParameters.token) || '';
  if (!token) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: htmlResponse('Missing Token', 'No verification token was provided in the link.', true)
    };
  }

  // Step 1: look up the token row
  let tokenRow;
  try {
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/email_verification_tokens?token=eq.${encodeURIComponent(token)}&select=*`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (!lookupRes.ok) {
      const txt = await lookupRes.text();
      console.error('[verify-email] token lookup HTTP', lookupRes.status, txt);
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'text/html' },
        body: htmlResponse('Verification Error', 'Could not validate the token. Please try again.', true)
      };
    }
    const rows = await lookupRes.json();
    tokenRow = rows && rows[0];
  } catch (e) {
    console.error('[verify-email] token lookup exception', e);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: htmlResponse('Server Error', 'Something went wrong validating your token.', true)
    };
  }

  if (!tokenRow) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html' },
      body: htmlResponse('Invalid Link', 'This verification link is invalid. It may have been mistyped or already used.', true)
    };
  }

  if (tokenRow.used_at) {
    // Already used. Treat as success (user may have clicked twice) — redirect
    // them anyway so they land on the settings page in a verified state.
    return {
      statusCode: 302,
      headers: { Location: `${SITE_URL}/account-settings.html?emailverified=1` },
      body: ''
    };
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    return {
      statusCode: 410,
      headers: { 'Content-Type': 'text/html' },
      body: htmlResponse('Link Expired', 'This verification link has expired. Sign in and click "Resend Email" in the banner at the top of the page to get a new one.', true)
    };
  }

  // Step 2: flip email_verified = true on public.users
  try {
    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(tokenRow.user_id)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({ email_verified: true })
      }
    );
    if (!updateRes.ok) {
      const txt = await updateRes.text();
      console.error('[verify-email] users update failed', updateRes.status, txt);
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'text/html' },
        body: htmlResponse('Verification Error', 'Could not mark your account as verified. Please contact support.', true)
      };
    }
  } catch (e) {
    console.error('[verify-email] users update exception', e);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: htmlResponse('Server Error', 'Something went wrong marking your account verified.', true)
    };
  }

  // Step 3: mark token as used
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/email_verification_tokens?token=eq.${encodeURIComponent(token)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({ used_at: new Date().toISOString() })
      }
    );
  } catch (e) {
    // Non-fatal — verification succeeded even if we couldn't mark the token used
    console.warn('[verify-email] mark-used failed (non-fatal)', e);
  }

  // Step 4: redirect to settings page with verified flag (triggers green banner)
  return {
    statusCode: 302,
    headers: { Location: `${SITE_URL}/account-settings.html?emailverified=1` },
    body: ''
  };
};
