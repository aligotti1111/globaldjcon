// netlify/functions/send-email.js
// Handles all transactional emails for Global DJ Connect via Resend
// Set RESEND_API_KEY in Netlify environment variables

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
const ADMIN_EMAIL = 'info@globaldjconnect.com';
const SITE_URL = 'https://globaldjconnect.com';

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
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
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Password Reset</h2>
        <p style="color:#666666;margin-bottom:24px;">Hi ${escHtml(name)}, you requested to reset your password.</p>
        <a href="${resetLink}" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">Reset My Password</a>
        <p style="color:#666666;font-size:12px;margin-top:24px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
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
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2.2rem;color:#1a1a2e;margin-bottom:8px;">Welcome, ${escHtml(name)}!</h2>
        <p style="color:#666666;margin-bottom:8px;">You're officially on the Global DJ Connect network.</p>
        <p style="color:#666666;margin-bottom:28px;">${roleMsg}</p>
        ${profileBtn}
        <a href="${SITE_URL}/login.html" style="display:inline-block;background:transparent;color:#00f5c4;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;border:1px solid #00f5c4;">Log In</a>
        <p style="color:#666666;font-size:12px;margin-top:28px;">Questions? Reply to this email and we'll help you out.</p>
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
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Message</h2>
        <p style="color:#666666;margin-bottom:24px;">Hi ${escHtml(recipientName || 'there')}, you have a new message from <strong style="color:#1a1a2e;">${escHtml(senderName)}</strong>.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;font-family:monospace;">Subject</p>
          <p style="color:#1a1a2e;font-weight:600;margin-bottom:16px;">${escHtml(subject)}</p>
          <p style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;font-family:monospace;">Message</p>
          <p style="color:#333333;line-height:1.65;">${escHtml(message).replace(/\n/g, '<br>')}</p>
        </div>
        ${senderEmail ? `<p style="color:#666666;font-size:12px;margin-bottom:20px;">Reply directly to: <a href="mailto:${senderEmail}?subject=Re: ${encodeURIComponent(subject)}" style="color:#00f5c4;">${escHtml(senderEmail)}</a></p>` : ''}
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
        <a href="mailto:${claimantEmail}?subject=Re: Your Profile Claim for ${encodeURIComponent(bizName)}" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">Reply to Claimant</a>
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
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Contact Message</h2>
        <p style="color:#666666;margin-bottom:24px;">Someone submitted the contact form on Global DJ Connect.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Name</td></tr>
            <tr><td style="color:#1a1a2e;padding-bottom:14px;">${escHtml(name)}</td></tr>
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Email</td></tr>
            <tr><td style="color:#00f5c4;padding-bottom:14px;"><a href="mailto:${email}" style="color:#00f5c4;">${escHtml(email)}</a></td></tr>
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Subject</td></tr>
            <tr><td style="color:#1a1a2e;padding-bottom:14px;">${escHtml(subject)}</td></tr>
            <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Message</td></tr>
            <tr><td style="color:#333333;line-height:1.65;">${escHtml(message).replace(/\n/g, '<br>')}</td></tr>
          </table>
        </div>
        <a href="mailto:${email}?subject=Re: ${encodeURIComponent(subject)}" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">Reply to ${escHtml(name)}</a>
      `)
    };

  } else if (type === 'booking_request') {
    const { djName, djEmail, requesterName, eventDate, venueName, venueAddress, venueType, setType, startTime, endTime, equipment, notes, offerAmount, quotedRate, currency } = body;
    const sym = {USD:'$',EUR:'€',GBP:'£',CAD:'CA$',AUD:'A$',JPY:'¥',MXN:'MX$',BRL:'R$',CHF:'Fr',SEK:'kr',NOK:'kr',DKK:'kr',NZD:'NZ$',SGD:'S$',ZAR:'R',AED:'د.إ',INR:'₹'}[currency||'USD'] || '$';
    const equipLabels = {sound_system:'Full Sound System & Decks',decks_only:'Decks/Controller Only',venue_provides:'Venue Provides All Equipment'};
    const setLabels = {opening:'Opening Set',headliner:'Headliner',closing:'Closing Set',opening_close:'Opening – Close',opening_and_closing:'Opening & Closing Set'};
    const formatT = t => { if(!t) return ''; const [h,m]=t.split(':').map(Number); const p=h<12?'AM':'PM'; return (h%12||12)+':'+String(m).padStart(2,'0')+' '+p; };
    const dateStr = eventDate ? new Date(eventDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}) : '—';
    emailPayload = {
      from: FROM, reply_to: REPLY_TO, to: [djEmail],
      subject: `New Booking Request from ${escHtml(requesterName)} – ${dateStr}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Booking Request</h2>
        <p style="color:#666666;margin-bottom:24px;">Hi ${escHtml(djName)}, you have a new booking request from <strong>${escHtml(requesterName)}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Date</td></tr>
          <tr><td style="color:#1a1a2e;padding-bottom:12px;font-weight:600;">${dateStr}</td></tr>
          <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Venue</td></tr>
          <tr><td style="color:#1a1a2e;padding-bottom:12px;">${escHtml(venueName)}${venueAddress ? '<br><span style="color:#888;font-size:12px;">'+escHtml(venueAddress)+'</span>' : ''}</td></tr>
          <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Event Type</td></tr>
          <tr><td style="color:#1a1a2e;padding-bottom:12px;">${venueType==='club'?'Club':'Bar'}${setType?' · '+(setLabels[setType]||setType):''}</td></tr>
          <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Time</td></tr>
          <tr><td style="color:#1a1a2e;padding-bottom:12px;">${formatT(startTime)}${endTime?' – '+formatT(endTime):''}</td></tr>
          <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Equipment</td></tr>
          <tr><td style="color:#1a1a2e;padding-bottom:12px;">${equipLabels[equipment]||equipment||'—'}</td></tr>
          ${quotedRate ? `<tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Quoted Rate</td></tr><tr><td style="color:#00b89a;font-weight:700;font-size:1.1em;padding-bottom:12px;">${sym}${Number(quotedRate).toLocaleString()} ${currency||'USD'}</td></tr>` : ''}
          ${offerAmount ? `<tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Their Offer</td></tr><tr><td style="color:#00b89a;font-weight:700;font-size:1.1em;padding-bottom:12px;">${sym}${Number(offerAmount).toLocaleString()} ${currency||'USD'}</td></tr>` : ''}
          ${notes ? `<tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Notes</td></tr><tr><td style="color:#333333;line-height:1.6;padding-bottom:12px;">${escHtml(notes)}</td></tr>` : ''}
        </table>
        <a href="${SITE_URL}/booking-requests.html" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">View Booking Request</a>
      `)
    };

  } else if (type === 'booking_confirmation') {
    const { requesterName, requesterEmail, djName, eventDate, venueName, venueAddress, venueType, setType, startTime, endTime, equipment, notes, offerAmount, quotedRate, currency } = body;
    const sym = {USD:'$',EUR:'€',GBP:'£',CAD:'CA$',AUD:'A$',JPY:'¥',MXN:'MX$',BRL:'R$',CHF:'Fr',SEK:'kr',NOK:'kr',DKK:'kr',NZD:'NZ$',SGD:'S$',ZAR:'R',AED:'د.إ',INR:'₹'}[currency||'USD'] || '$';
    const equipLabels = {sound_system:'Full Sound System & Decks',decks_only:'Decks/Controller Only',venue_provides:'Venue Provides All Equipment'};
    const setLabels = {opening:'Opening Set',headliner:'Headliner',closing:'Closing Set',opening_close:'Opening – Close',opening_and_closing:'Opening & Closing Set'};
    const formatT = t => { if(!t) return ''; const [h,m]=t.split(':').map(Number); const p=h<12?'AM':'PM'; return (h%12||12)+':'+String(m).padStart(2,'0')+' '+p; };
    const dateStr = eventDate ? new Date(eventDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}) : '—';
    emailPayload = {
      from: FROM, reply_to: REPLY_TO, to: [requesterEmail],
      subject: `Booking Request Sent – ${escHtml(djName)}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Booking Request Sent</h2>
        <p style="color:#666666;margin-bottom:24px;">Hi ${escHtml(requesterName)}, your booking request has been sent to <strong style="color:#1a1a2e;">${escHtml(djName)}</strong>. They'll be in touch soon.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">DJ</td></tr>
          <tr><td style="color:#1a1a2e;padding-bottom:12px;font-weight:600;">${escHtml(djName)}</td></tr>
          <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Date</td></tr>
          <tr><td style="color:#1a1a2e;padding-bottom:12px;font-weight:600;">${dateStr}</td></tr>
          <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Venue</td></tr>
          <tr><td style="color:#1a1a2e;padding-bottom:12px;">${escHtml(venueName)}${venueAddress ? '<br><span style="color:#888;font-size:12px;">'+escHtml(venueAddress)+'</span>' : ''}</td></tr>
          <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Event Type</td></tr>
          <tr><td style="color:#1a1a2e;padding-bottom:12px;">${venueType==='club'?'Club':'Bar'}${setType?' · '+(setLabels[setType]||setType):''}</td></tr>
          <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Time</td></tr>
          <tr><td style="color:#1a1a2e;padding-bottom:12px;">${formatT(startTime)}${endTime?' – '+formatT(endTime):''}</td></tr>
          <tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Equipment</td></tr>
          <tr><td style="color:#1a1a2e;padding-bottom:12px;">${equipLabels[equipment]||equipment||'—'}</td></tr>
          ${quotedRate ? `<tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Quoted Rate</td></tr><tr><td style="color:#00b89a;font-weight:700;font-size:1.1em;padding-bottom:12px;">${sym}${Number(quotedRate).toLocaleString()} ${currency||'USD'}</td></tr>` : ''}
          ${offerAmount ? `<tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Your Offer</td></tr><tr><td style="color:#00b89a;font-weight:700;font-size:1.1em;padding-bottom:12px;">${sym}${Number(offerAmount).toLocaleString()} ${currency||'USD'}</td></tr>` : ''}
          ${notes ? `<tr><td style="color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;padding:6px 0 2px;">Notes</td></tr><tr><td style="color:#333333;line-height:1.6;padding-bottom:12px;">${escHtml(notes)}</td></tr>` : ''}
        </table>
        <a href="${SITE_URL}/inbox.html" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">Go to Inbox</a>
      `)
    };

  } else if (type === 'booking_status') {
    const { requesterName, requesterEmail, djName, status, eventDate, venueName } = body;
    const dateStr = eventDate ? new Date(eventDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}) : '—';
    const statusColor = status === 'approved' ? '#3ddc84' : status === 'denied' ? '#ff5f5f' : '#ffb347';
    emailPayload = {
      from: FROM, reply_to: REPLY_TO, to: [requesterEmail],
      subject: `Booking ${status.charAt(0).toUpperCase()+status.slice(1)} – ${escHtml(djName)}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Booking ${status.charAt(0).toUpperCase()+status.slice(1)}</h2>
        <p style="color:#666666;margin-bottom:16px;">Hi ${escHtml(requesterName)}, your booking request to <strong>${escHtml(djName)}</strong> for <strong>${escHtml(venueName)}</strong> on ${dateStr} has been <span style="color:${statusColor};font-weight:700;">${status}</span>.</p>
        ${status === 'approved' ? `<p style="color:#666666;margin-bottom:24px;">The DJ will be in touch with further details.</p>` : ''}
        <a href="${SITE_URL}" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">Find More DJs</a>
      `)
    };

  } else if (type === 'booking_counter') {
    const { requesterName, requesterEmail, djName, counterRate, counterMessage, eventDate, venueName, currency } = body;
    const sym = {USD:'$',EUR:'€',GBP:'£',CAD:'CA$',AUD:'A$'}[currency||'USD'] || '$';
    const dateStr = eventDate ? new Date(eventDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}) : '—';
    emailPayload = {
      from: FROM, reply_to: REPLY_TO, to: [requesterEmail],
      subject: `Counter Offer from ${escHtml(djName)}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Counter Offer</h2>
        <p style="color:#666666;margin-bottom:16px;">Hi ${escHtml(requesterName)}, <strong>${escHtml(djName)}</strong> has sent a counter offer for your booking at <strong>${escHtml(venueName)}</strong> on ${dateStr}.</p>
        <div style="background:#f8f8f8;border-radius:8px;padding:20px;margin-bottom:24px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-family:monospace;color:#888;margin-bottom:4px;">Counter Rate</div>
          <div style="font-size:2em;font-weight:700;color:#00b89a;">${sym}${Number(counterRate).toLocaleString()} <span style="font-size:.6em;color:#888;">${currency||'USD'}</span></div>
          ${counterMessage ? `<div style="margin-top:12px;color:#333;line-height:1.6;">"${escHtml(counterMessage)}"</div>` : ''}
        </div>
        <a href="${SITE_URL}/inbox.html" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;">Reply to DJ</a>
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
          <!-- Header -->
          <tr>
            <td bgcolor="#050507" style="background:#050507 !important;padding:24px 32px;border-bottom:3px solid #00f5c4;">
              <img src="https://hwqvzuusquruhwguqole.supabase.co/storage/v1/object/public/assets/logo-email.png" alt="Global DJ Connect" width="280" style="display:block;border:0;outline:none;" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;color:#1a1a2e;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
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
