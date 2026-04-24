// VERIFY: triggerSignupVerification + post-signup welcome screen
// Extracted from signup.html

// ── POST-SIGNUP "CHECK YOUR EMAIL" SCREEN ────────────────
// User has signed up but isn't logged in yet (Supabase requires email confirmation
// before issuing a session). Show a clear instruction to check their inbox.
// When they click the link, Supabase will create the session and land them on
// account-settings.html (or update-dj-profile.html for DJs via redirect).
async function triggerSignupVerification(userId, email, role, slug) {
  // Token-based verification: the Netlify function generates a one-time token,
  // stores it in email_verification_tokens, and emails the user a link.
  // Clicking the link hits our verify-email function which flips
  // public.users.email_verified = true. auth.js sources `confirmed` from that
  // column, so a profile refresh below picks up the initial false value and
  // activates the banner + gates immediately.
  try {
    await fetch('/.netlify/functions/signup-send-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, email: email, role: role, slug: slug || null })
    });
    try {
      if (window.GDJAuth && window.GDJAuth.refreshProfile) {
        await window.GDJAuth.refreshProfile();
      }
    } catch (e) { console.warn('[signup] refresh after verification failed:', e); }
  } catch (e) {
    console.warn('[signup] verification trigger failed:', e);
  }
}

function showWelcomeAndRedirect(email, role, slug) {
  const container = document.querySelector('.container');
  // DJ-specific block: give them a jump-start to edit their profile while
  // they wait for the verification email to land.
  const djBuildBlock = role === 'dj' ? `
      <div style="margin-top:36px;padding:20px;border:1px solid var(--neon-dim);border-radius:8px;background:rgba(0,245,196,.04);">
        <p style="color:var(--white);font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:.05em;margin:0 0 10px;">Begin Building Your Profile</p>
        <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 18px;">Add your mixes, photos, equipment, rates, and availability now — you can still edit anytime.</p>
        <a href="/update-dj-profile.html" style="display:inline-block;background:var(--neon);color:#000;padding:.75rem 1.5rem;border-radius:6px;font-family:'Space Mono',monospace;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;font-weight:700;">Edit My Profile →</a>
      </div>
  ` : '';

  container.innerHTML = `
    <div class="logo">
      <a href="/" style="text-decoration:none;"><h1>GLOBAL DJ CONNECT</h1></a>
      <p class="tagline">Directory & Booking</p>
    </div>
    <div style="text-align:center;padding:20px 0;">
      <div style="width:72px;height:72px;margin:0 auto 24px;border-radius:50%;background:var(--neon-dim);border:1px solid var(--neon);display:flex;align-items:center;justify-content:center;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--neon)" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      </div>
      <h2 style="font-family:'Bebas Neue',sans-serif;font-size:36px;letter-spacing:.04em;margin-bottom:14px;color:var(--white);">Check Your Email</h2>
      <p style="color:var(--muted);font-size:15px;line-height:1.6;margin-bottom:8px;">We sent a confirmation link to</p>
      <p style="color:var(--neon);font-family:'Space Mono',monospace;font-size:15px;margin-bottom:28px;word-break:break-all;">${email}</p>
      <p style="color:var(--muted);font-size:13px;line-height:1.6;margin-bottom:32px;max-width:380px;margin-left:auto;margin-right:auto;">Click the link in that email to activate your account. The link expires in 1 hour.</p>
      <p style="color:var(--muted);font-size:12px;margin-top:20px;">Didn't get it? Check your spam folder, or <a href="javascript:void(0)" id="resend-link" style="color:var(--neon);text-decoration:underline;">resend the email</a>.</p>
      ${djBuildBlock}
    </div>
  `;

  // Wire up resend link
  const resendLink = document.getElementById('resend-link');
  if (resendLink) {
    resendLink.addEventListener('click', async function() {
      const orig = resendLink.textContent;
      resendLink.textContent = 'Sending...';
      resendLink.style.pointerEvents = 'none';
      try {
        const { error } = await db.auth.resend({
          type: 'signup',
          email: email,
          options: { emailRedirectTo: window.location.origin + '/account-settings.html?emailverified=1' }
        });
        if (error) throw error;
        resendLink.textContent = '✓ Sent — check your inbox';
        resendLink.style.color = 'var(--success)';
        setTimeout(() => {
          resendLink.textContent = orig;
          resendLink.style.color = 'var(--neon)';
          resendLink.style.pointerEvents = 'auto';
        }, 5000);
      } catch (err) {
        resendLink.textContent = '✗ ' + (err.message || 'Failed to resend');
        resendLink.style.color = 'var(--error)';
        setTimeout(() => {
          resendLink.textContent = orig;
          resendLink.style.color = 'var(--neon)';
          resendLink.style.pointerEvents = 'auto';
        }, 4000);
      }
    });
  }
}

