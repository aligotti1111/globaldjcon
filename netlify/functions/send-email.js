// netlify/functions/send-email.js
const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO_DEFAULT = 'info@globaldjconnect.com';
const ADMIN_EMAIL = 'info@globaldjconnect.com';
const SITE_URL = 'https://globaldjconnect.com';

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

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { type } = body;
  let emailPayload;

  // ── 1. WELCOME (after signup confirmation) ────────────────────────
  if (type === 'welcome') {
    const { name, email, role, slug } = body;
    if (!name || !email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
    let profileBtn = '';
    if (role === 'dj' && slug) {
      profileBtn = `<a href="${SITE_URL}/${slug}" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin-right:12px;">View My Profile</a>`;
    }
    emailPayload = {
      from: FROM,
      to: [email],
      subject: `Welcome to Global DJ Connect, ${name}!`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Welcome, ${escHtml(name)}!</h2>
        <p style="color:#333333;line-height:1.65;margin-bottom:24px;">Your Global DJ Connect account is ready. Start exploring DJs, sending booking requests, or managing your profile.</p>
        ${profileBtn}
        <a href="${SITE_URL}/login.html" style="display:inline-block;background:transparent;color:#00f5c4;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;border:1px solid #00f5c4;">Log In</a>
      `)
    };

  // ── 2. NEW MESSAGE (inbox notification) ───────────────────────────
  } else if (type === 'new_message') {
    const { recipientEmail, recipientName, senderName, messagePreview } = body;
    if (!recipientEmail) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing recipient' }) };
    emailPayload = {
      from: FROM,
      to: [recipientEmail],
      subject: `New message from ${senderName || 'someone'} on Global DJ Connect`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Message</h2>
        <p style="color:#333333;line-height:1.65;margin-bottom:16px;">Hi ${escHtml(recipientName || 'there')},</p>
        <p style="color:#333333;line-height:1.65;margin-bottom:16px;"><strong>${escHtml(senderName || 'Someone')}</strong> sent you a message on Global DJ Connect:</p>
        ${messagePreview ? `<div style="background:#f8f8f8;border-left:3px solid #00f5c4;padding:16px 20px;margin-bottom:24px;color:#333333;line-height:1.65;font-style:italic;">${escHtml(messagePreview).replace(/\n/g, '<br>')}</div>` : ''}
        <a href="${SITE_URL}/inbox.html" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">View in Inbox</a>
      `)
    };

  // ── 3. CLAIM REQUEST ──────────────────────────────────────────────
  } else if (type === 'claim_request') {
    const { claimantName, claimantEmail, bizName, slug, verifyMsg } = body;
    if (!claimantName || !claimantEmail || !bizName) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields for claim_request' }) };
    }
    const profileUrl = slug ? `${SITE_URL}/${slug}` : 'N/A';

    // Admin notification
    const adminPayload = {
      from: FROM,
      reply_to: [claimantEmail],
      to: [ADMIN_EMAIL],
      subject: `Profile Claim Request: ${bizName}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Claim Request</h2>
        <p style="color:#666666;margin-bottom:24px;">Someone wants to claim a profile on Global DJ Connect.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Name</td></tr>
            <tr><td style="color:#1a1a2e;padding-bottom:14px;">${escHtml(claimantName)}</td></tr>
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Email</td></tr>
            <tr><td style="color:#00f5c4;padding-bottom:14px;"><a href="mailto:${claimantEmail}" style="color:#00f5c4;">${escHtml(claimantEmail)}</a></td></tr>
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Business / DJ Name</td></tr>
            <tr><td style="color:#1a1a2e;padding-bottom:14px;">${escHtml(bizName)}</td></tr>
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Profile URL</td></tr>
            <tr><td style="padding-bottom:14px;"><a href="${profileUrl}" style="color:#00f5c4;">${profileUrl}</a></td></tr>
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Verification Info</td></tr>
            <tr><td style="color:#333333;line-height:1.65;">${escHtml(verifyMsg || 'None provided').replace(/\n/g, '<br>')}</td></tr>
          </table>
        </div>
        <a href="${SITE_URL}/admin.html" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">Review in Admin Panel</a>
      `)
    };

    // Claimant receipt
    const claimantPayload = {
      from: FROM,
      to: [claimantEmail],
      subject: `We received your claim request for ${bizName}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Claim Request Received</h2>
        <p style="color:#333333;line-height:1.65;margin-bottom:16px;">Hi ${escHtml(claimantName)},</p>
        <p style="color:#333333;line-height:1.65;margin-bottom:24px;">Thanks for submitting a claim request for <strong>${escHtml(bizName)}</strong>. Our team will review your submission and reach out within 1–2 business days.</p>
        <p style="color:#333333;line-height:1.65;margin-bottom:8px;">Here's a copy of what you submitted:</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Business / DJ Name</td></tr>
            <tr><td style="color:#1a1a2e;padding-bottom:14px;">${escHtml(bizName)}</td></tr>
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Profile URL</td></tr>
            <tr><td style="padding-bottom:14px;"><a href="${profileUrl}" style="color:#00f5c4;">${profileUrl}</a></td></tr>
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Verification Info</td></tr>
            <tr><td style="color:#333333;line-height:1.65;">${escHtml(verifyMsg || 'None provided').replace(/\n/g, '<br>')}</td></tr>
          </table>
        </div>
        <p style="color:#666666;font-size:13px;line-height:1.65;">If you have questions in the meantime, just reply to this email.</p>
      `)
    };

    try {
      const [adminRes, claimantRes] = await Promise.all([
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
          body: JSON.stringify(adminPayload)
        }),
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
          body: JSON.stringify(claimantPayload)
        })
      ]);
      const adminResult = await adminRes.json();
      if (!adminRes.ok) {
        console.error('Admin email send error:', adminResult);
        return { statusCode: 500, headers, body: JSON.stringify({ error: adminResult.message || 'Admin email send failed' }) };
      }
      if (!claimantRes.ok) {
        const claimantResult = await claimantRes.json();
        console.error('Claimant receipt email error (non-fatal):', claimantResult);
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: adminResult.id }) };
    } catch (err) {
      console.error('Claim email error:', err);
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }

  // ── 4. CLAIM APPROVED — welcome the newly-activated user ──────────
  } else if (type === 'claim_approved') {
    const { name, email, bizName, setPasswordUrl } = body;
    if (!email || !setPasswordUrl) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields for claim_approved' }) };
    }
    emailPayload = {
      from: FROM,
      to: [email],
      subject: `Your Global DJ Connect account is ready`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Your Account Is Ready</h2>
        <p style="color:#333333;line-height:1.65;margin-bottom:16px;">Hi ${escHtml(name || 'there')},</p>
        <p style="color:#333333;line-height:1.65;margin-bottom:16px;">Good news — your claim for <strong>${escHtml(bizName || 'your profile')}</strong> has been approved. You now have full access to manage your listing on Global DJ Connect.</p>
        <p style="color:#333333;line-height:1.65;margin-bottom:24px;">To get started, set your password using the link below. This link expires in 1 hour.</p>
        <p style="margin-bottom:24px;"><a href="${setPasswordUrl}" style="display:inline-block;padding:14px 28px;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">Set Password & Log In</a></p>
        <p style="color:#666666;font-size:13px;line-height:1.65;">Or copy and paste this URL into your browser:<br>
        <span style="color:#888;word-break:break-all;">${setPasswordUrl}</span></p>
        <p style="color:#666666;font-size:13px;line-height:1.65;margin-top:24px;">If you didn't submit a claim, you can safely ignore this email.</p>
      `)
    };

  // ── 5. CONTACT US ─────────────────────────────────────────────────
  } else if (type === 'contact_us') {
    const { name, subject, message } = body; const email = (body.email || '').toLowerCase().trim();
    if (!name || !email || !subject || !message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields for contact_us' }) };
    }
    emailPayload = {
      from: FROM,
      reply_to: [email],
      to: [ADMIN_EMAIL],
      subject: `Contact Form: ${subject}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Contact Form Submission</h2>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;">From</p>
          <p style="margin:0 0 16px;color:#1a1a2e;">${escHtml(name)} &lt;<a href="mailto:${email}" style="color:#00f5c4;">${escHtml(email)}</a>&gt;</p>
          <p style="margin:0 0 8px;color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;">Subject</p>
          <p style="margin:0 0 16px;color:#1a1a2e;">${escHtml(subject)}</p>
          <p style="margin:0 0 8px;color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;">Message</p>
          <p style="margin:0;color:#333333;line-height:1.65;">${escHtml(message).replace(/\n/g, '<br>')}</p>
        </div>
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
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td bgcolor="#050507" style="background:#050507 !important;padding:24px 32px;border-bottom:3px solid #00f5c4;">
              <img src="https://hwqvzuusquruhwguqole.supabase.co/storage/v1/object/public/assets/logo-email.png" alt="Global DJ Connect" width="280" style="display:block;border:0;outline:none;" />
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1a1a2e;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;background:#f8f8f8;border-top:1px solid #e0e0e0;">
              <p style="margin:0;color:#888888;font-size:11px;line-height:1.6;">
                © ${new Date().getFullYear()} Global DJ Connect · <a href="${SITE_URL}" style="color:#888888;">globaldjconnect.com</a><br>
                Questions? Email us at <a href="mailto:info@globaldjconnect.com" style="color:#888888;">info@globaldjconnect.com</a>
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
