// netlify/functions/signup-send-verification.js
// Sends an email-verification link to a freshly-signed-up user (or resends on
// request from the verify-email banner). Uses our own token system stored in
// public.email_verification_tokens — completely independent of Supabase Auth's
// email_confirmed_at flag, which Supabase re-populates on every login.
//
// POST { user_id, email, role, slug? }

const crypto = require('crypto');

const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';
const SITE_URL = 'https://globaldjconnect.com';
const TOKEN_TTL_HOURS = 24;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }) };
  }
  if (!RESEND_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'RESEND_API_KEY not set' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { user_id, email, role } = body;
  if (!user_id || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'user_id and email are required' }) };
  }

  // Step 1: generate a fresh token + insert into email_verification_tokens
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();

  try {
    const insertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/email_verification_tokens`,
      {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          token: token,
          user_id: user_id,
          email: email,
          expires_at: expiresAt
        })
      }
    );
    if (!insertRes.ok) {
      const txt = await insertRes.text();
      console.error('[signup-send-verification] token insert failed', insertRes.status, txt);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not create verification token', detail: txt }) };
    }
  } catch (e) {
    console.error('[signup-send-verification] token insert exception', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e) }) };
  }

  // Step 2: build the verification link pointing at our own endpoint
  const verifyUrl = `${SITE_URL}/.netlify/functions/verify-email?token=${encodeURIComponent(token)}`;

  // Step 3: send the email via Resend
  const logoUrl = 'https://hwqvzuusquruhwguqole.supabase.co/storage/v1/object/public/assets/gdj-logo-email.png';
  const roleDisplay = role === 'dj' ? 'DJ' : (role === 'venue' ? 'Venue' : 'Host');

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
      <div class="logo"><img src="${logoUrl}" alt="Global DJ Connect"></div>
      <div class="card">
        <h1>Confirm Your Email</h1>
        <p>Welcome to Global DJ Connect! You've been signed up as a ${roleDisplay}.</p>
        <p>Click the button below to verify your email and unlock messaging, booking, and all features:</p>
        <p style="text-align:center;"><a href="${verifyUrl}" class="btn">Verify Email</a></p>
        <p style="font-size:13px;color:#8a8a9e;">Or paste this link into your browser:<br><span style="word-break:break-all;color:#00f5c4;">${verifyUrl}</span></p>
        <p style="font-size:13px;color:#8a8a9e;margin-top:24px;">This link expires in ${TOKEN_TTL_HOURS} hours. If you didn't sign up, you can safely ignore this email.</p>
      </div>
      <div class="footer">Global DJ Connect · globaldjconnect.com</div>
    </div>
  </body></html>`;

  try {
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Global DJ Connect <info@globaldjconnect.com>',
        to: [email],
        reply_to: 'info@globaldjconnect.com',
        subject: 'Confirm Your Email — Global DJ Connect',
        html: html
      })
    });
    if (!sendRes.ok) {
      const txt = await sendRes.text();
      console.error('[signup-send-verification] Resend failed', sendRes.status, txt);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Email send failed', detail: txt }) };
    }
  } catch (e) {
    console.error('[signup-send-verification] Resend exception', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e) }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};
