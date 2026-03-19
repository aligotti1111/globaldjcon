// netlify/functions/send-email.js
// Handles all transactional emails for Global DJ Connect via Resend
// Set RESEND_API_KEY in Netlify environment variables

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const ADMIN_EMAIL = 'info@globaldjconnect.com';
const SITE_URL = 'https://globaldjconnect.com';

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { type } = body;
  if (!type) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing email type' }) };
  }

  let emailPayload;

  // ── 1. PASSWORD RESET ──────────────────────────────────────────────
  if (type === 'password_reset') {
    const { name, email, resetToken } = body;
    if (!name || !email || !resetToken) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields for password_reset' }) };
    }
    const resetLink = `${SITE_URL}/reset-password.html?token=${resetToken}`;
    emailPayload = {
      from: FROM,
      reply_to: REPLY_TO,
      to: [email],
      subject: 'Reset Your Password – Global DJ Connect',
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#f0f0f8;margin-bottom:8px;">Password Reset</h2>
        <p style="color:#6b6b88;margin-bottom:24px;">Hi ${escHtml(name)}, you requested to reset your password.</p>
        <a href="${resetLink}" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">Reset My Password</a>
        <p style="color:#6b6b88;font-size:12px;margin-top:24px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        <p style="color:#2a2a3a;font-size:11px;margin-top:8px;word-break:break-all;">${resetLink}</p>
      `)
    };

  // ── 2. WELCOME EMAIL ───────────────────────────────────────────────
  } else if (type === 'welcome') {
    const { name, email, role, slug } = body;
    if (!name || !email || !role) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields for welcome' }) };
    }

    let roleMsg = '';
    let profileBtn = '';
    if (role === 'dj' && slug) {
      roleMsg = 'Your DJ profile is live and ready for bookings.';
      profileBtn = `<a href="${SITE_URL}/${slug}" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin-right:12px;">View My Profile</a>`;
    } else if (role === 'host') {
      roleMsg = 'You can now search for DJs and send booking inquiries.';
    } else if (role === 'venue') {
      roleMsg = 'Your venue account is ready. Find the perfect DJ for your events.';
    }

    emailPayload = {
      from: FROM,
      reply_to: REPLY_TO,
      to: [email],
      subject: 'Welcome to Global DJ Connect 🎧',
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2.2rem;color:#f0f0f8;margin-bottom:8px;">Welcome, ${escHtml(name)}!</h2>
        <p style="color:#6b6b88;margin-bottom:8px;">You're officially on the Global DJ Connect network.</p>
        <p style="color:#6b6b88;margin-bottom:28px;">${roleMsg}</p>
        ${profileBtn}
        <a href="${SITE_URL}/login.html" style="display:inline-block;background:transparent;color:#00f5c4;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;border:1px solid #00f5c4;">Log In</a>
        <p style="color:#6b6b88;font-size:12px;margin-top:28px;">Questions? Reply to this email and we'll help you out.</p>
      `)
    };

  // ── 3. INBOX MESSAGE NOTIFICATION ─────────────────────────────────
  } else if (type === 'inbox_notification') {
    const { recipientName, recipientEmail, senderName, senderEmail, subject, message } = body;
    if (!recipientEmail || !senderName || !subject || !message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields for inbox_notification' }) };
    }
    emailPayload = {
      from: FROM,
      reply_to: REPLY_TO,
      to: [recipientEmail],
      subject: `New message on Global DJ Connect: ${subject}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#f0f0f8;margin-bottom:8px;">New Message</h2>
        <p style="color:#6b6b88;margin-bottom:24px;">Hi ${escHtml(recipientName || 'there')}, you have a new message from <strong style="color:#f0f0f8;">${escHtml(senderName)}</strong>.</p>
        <div style="background:#0a0a10;border:1px solid #1e1e30;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="color:#6b6b88;font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;font-family:monospace;">Subject</p>
          <p style="color:#f0f0f8;font-weight:600;margin-bottom:16px;">${escHtml(subject)}</p>
          <p style="color:#6b6b88;font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;font-family:monospace;">Message</p>
          <p style="color:#c0c0d0;line-height:1.65;">${escHtml(message).replace(/\n/g, '<br>')}</p>
        </div>
        ${senderEmail ? `<p style="color:#6b6b88;font-size:12px;margin-bottom:20px;">Reply directly to: <a href="mailto:${senderEmail}?subject=Re: ${encodeURIComponent(subject)}" style="color:#00f5c4;">${escHtml(senderEmail)}</a></p>` : ''}
        <a href="${SITE_URL}/inbox.html" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">View in Inbox</a>
      `)
    };

  // ── 4. CLAIM REQUEST (admin notification) ─────────────────────────
  } else if (type === 'claim_request') {
    const { claimantName, claimantEmail, bizName, slug, verifyMsg } = body;
    if (!claimantName || !claimantEmail || !bizName) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields for claim_request' }) };
    }
    const profileUrl = slug ? `${SITE_URL}/${slug}` : 'N/A';
    emailPayload = {
      from: FROM,
      reply_to: claimantEmail,
      to: [ADMIN_EMAIL],
      subject: `Profile Claim Request: ${bizName}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#f0f0f8;margin-bottom:8px;">New Claim Request</h2>
        <p style="color:#6b6b88;margin-bottom:24px;">Someone wants to claim a profile on Global DJ Connect.</p>
        <div style="background:#0a0a10;border:1px solid #1e1e30;border-radius:8px;padding:20px;margin-bottom:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="color:#6b6b88;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Name</td></tr>
            <tr><td style="color:#f0f0f8;padding-bottom:14px;">${escHtml(claimantName)}</td></tr>
            <tr><td style="color:#6b6b88;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Email</td></tr>
            <tr><td style="color:#00f5c4;padding-bottom:14px;"><a href="mailto:${claimantEmail}" style="color:#00f5c4;">${escHtml(claimantEmail)}</a></td></tr>
            <tr><td style="color:#6b6b88;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Business / DJ Name</td></tr>
            <tr><td style="color:#f0f0f8;padding-bottom:14px;">${escHtml(bizName)}</td></tr>
            <tr><td style="color:#6b6b88;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Profile URL</td></tr>
            <tr><td style="padding-bottom:14px;"><a href="${profileUrl}" style="color:#00f5c4;">${profileUrl}</a></td></tr>
            <tr><td style="color:#6b6b88;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Verification Info</td></tr>
            <tr><td style="color:#c0c0d0;line-height:1.65;">${escHtml(verifyMsg || 'None provided').replace(/\n/g, '<br>')}</td></tr>
          </table>
        </div>
        <a href="mailto:${claimantEmail}?subject=Re: Your Profile Claim for ${encodeURIComponent(bizName)}" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">Reply to Claimant</a>
      `)
    };

  } else {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown email type: ${type}` }) };
  }

  // ── SEND VIA RESEND ────────────────────────────────────────────────
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify(emailPayload)
    });

    const result = await res.json();
    if (!res.ok) {
      console.error('Resend error:', result);
      return { statusCode: 500, headers, body: JSON.stringify({ error: result.message || 'Email send failed' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: result.id }) };

  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// ── HELPERS ────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emailTemplate(content) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#050507;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#050507;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <!-- Header -->
          <tr>
            <td style="padding-bottom:32px;border-bottom:1px solid #1e1e30;margin-bottom:32px;">
              <p style="margin:0;font-family:'Bebas Neue',Impact,sans-serif;font-size:28px;letter-spacing:.1em;background:linear-gradient(135deg,#f0f0f8 30%,#00f5c4 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">GLOBAL DJ CONNECT</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 0;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding-top:32px;border-top:1px solid #1e1e30;">
              <p style="margin:0;color:#2a2a3a;font-size:11px;line-height:1.6;">
                © ${new Date().getFullYear()} Global DJ Connect · <a href="${SITE_URL}" style="color:#2a2a3a;">globaldjconnect.com</a><br>
                Questions? Email us at <a href="mailto:info@globaldjconnect.com" style="color:#2a2a3a;">info@globaldjconnect.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
