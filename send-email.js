// ── 5. CONTACT US ─────────────────────────────────────────────────
  } else if (type === 'contact_us') {
    const { name, email, subject, message } = body;
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
