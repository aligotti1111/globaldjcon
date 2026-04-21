// netlify/functions/set-password-from-token.js
// Public endpoint used by /set-password.html after a claim approval.
// Flow:
//   1. Client POSTs { token, password }
//   2. We look up the token in password_setup_tokens using service_role
//   3. Validate: token exists, not used, not expired
//   4. Set the user's password via /auth/v1/admin/users/<user_id>
//   5. Mark the token as used (one-time)

const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!token) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Token required' }) };
  }
  if (!password || password.length < 8) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Password must be at least 8 characters' }) };
  }

  // ── Look up the token ──────────────────────────────────────────
  const lookupRes = await fetch(
    `${SUPABASE_URL}/rest/v1/password_setup_tokens?select=*&token=eq.${encodeURIComponent(token)}&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  if (!lookupRes.ok) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Token lookup failed' }) };
  }
  const rows = await lookupRes.json();
  const row = rows && rows[0];
  if (!row) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Invalid or unknown link. Ask the admin to re-approve your claim if you believe this is an error.' }) };
  }
  if (row.used_at) {
    return { statusCode: 410, headers, body: JSON.stringify({ error: 'This link has already been used. If you need to change your password, use the Forgot Password option on the sign-in page.' }) };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { statusCode: 410, headers, body: JSON.stringify({ error: 'This link has expired. Ask the admin to re-approve your claim to get a new link.' }) };
  }

  // ── Set the password on the auth user ──────────────────────────
  const updateRes = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(row.user_id)}`,
    {
      method: 'PUT',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: password, email_confirm: true })
    }
  );
  if (!updateRes.ok) {
    const errText = await updateRes.text();
    console.error('[set-password-from-token] password update failed:', errText);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to set password: ' + errText }) };
  }

  // ── Mark token as used (one-time) ──────────────────────────────
  await fetch(
    `${SUPABASE_URL}/rest/v1/password_setup_tokens?token=eq.${encodeURIComponent(token)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ used_at: new Date().toISOString() })
    }
  ).catch(() => {}); // non-fatal — password was set successfully

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      email: row.email,
      message: 'Password set. You can now sign in.'
    })
  };
};
