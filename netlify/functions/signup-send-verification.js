// netlify/functions/signup-send-verification.js
// Called immediately after a user signs up (when Supabase "Confirm email" is OFF,
// so email_confirmed_at gets auto-populated). We:
//   1) Clear email_confirmed_at so our banner + gates kick in
//   2) Use Supabase admin API to generate a signup confirmation link
//   3) Email that link to the user via Resend (through the existing send-email function)
//
// POST { user_id, email, role, slug? }

const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';
const SITE_URL = 'https://globaldjconnect.com';

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
  if (!SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { user_id, email, role, slug } = body;
  if (!user_id || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'user_id and email are required' }) };
  }

  // Step 1: clear email_confirmed_at so our code treats the user as unverified
  try {
    const clearRes = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(user_id)}`,
      {
        method: 'PUT',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email_confirm: false })
      }
    );
    if (!clearRes.ok) {
      const txt = await clearRes.text();
      console.error('[signup-send-verification] clear email_confirm failed', clearRes.status, txt);
      // Non-fatal — try to continue and send email anyway
    }
  } catch (e) {
    console.error('[signup-send-verification] clear exception', e);
  }

  // Step 2: generate a signup confirmation link via admin API
  let confirmationUrl;
  try {
    const linkRes = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/generate_link`,
      {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'signup',
          email: email,
          options: {
            redirect_to: `${SITE_URL}/account-settings.html?emailverified=1`
          }
        })
      }
    );
    if (!linkRes.ok) {
      const txt = await linkRes.text();
      console.error('[signup-send-verification] generate_link failed', linkRes.status, txt);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not generate confirmation link', detail: txt }) };
    }
    const linkData = await linkRes.json();
    confirmationUrl = (linkData && (linkData.properties?.action_link || linkData.action_link)) || null;
    if (!confirmationUrl) {
      console.error('[signup-send-verification] no action_link in response', JSON.stringify(linkData));
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'No confirmation link returned' }) };
    }
  } catch (e) {
    console.error('[signup-send-verification] generate_link exception', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e) }) };
  }

  // Step 3: send the confirmation email via Resend
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'RESEND_API_KEY not set' }) };
  }

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
        <p style="text-align:center;"><a href="${confirmationUrl}" class="btn">Verify Email</a></p>
        <p style="font-size:13px;color:#8a8a9e;">Or paste this link into your browser:<br><span style="word-break:break-all;color:#00f5c4;">${confirmationUrl}</span></p>
        <p style="font-size:13px;color:#8a8a9e;margin-top:24px;">This link expires in 24 hours. If you didn't sign up, you can safely ignore this email.</p>
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
