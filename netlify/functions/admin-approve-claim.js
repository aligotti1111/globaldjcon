// netlify/functions/admin-approve-claim.js
// Approves a profile claim:
//   1. Swaps the auth user's email from placeholder to the claimant's real email
//   2. Marks the user as claimed=true
//   3. Marks the claim as approved
//   4. Triggers a Supabase password reset email (which also serves as the "set your password" welcome)

const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Admin authorization ──────────────────────────────────────────
  const adminKey = event.headers['x-admin-key'] || event.headers['X-Admin-Key'];
  if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  // ── Parse input ───────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { claim_id, reviewed_notes } = body;
  if (!claim_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'claim_id is required' }) };
  }

  // ── Fetch the claim ───────────────────────────────────────────────
  const claimRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profile_claims?select=*&id=eq.${encodeURIComponent(claim_id)}`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  if (!claimRes.ok) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch claim' }) };
  }
  const claims = await claimRes.json();
  const claim = claims && claims[0];
  if (!claim) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Claim not found' }) };
  }
  if (claim.status !== 'pending') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Claim is not pending (status: ' + claim.status + ')' }) };
  }
  if (!claim.target_user_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Claim has no target user' }) };
  }

  const newEmail = (claim.claimant_email || '').toLowerCase().trim();
  if (!newEmail) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Claim has no claimant email' }) };
  }

  // ── Verify new email isn't already taken by another auth user ─────
  // Note: GET /auth/v1/admin/users ignores ?email= query params and returns
  // the full list. We must filter the returned users by email client-side.
  const emailCheckRes = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  if (emailCheckRes.ok) {
    const result = await emailCheckRes.json();
    const users = result.users || [];
    const conflict = users.find(u =>
      u.id !== claim.target_user_id &&
      (u.email || '').toLowerCase() === newEmail
    );
    if (conflict) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'That email is already registered to another account.' }) };
    }
  }

  // ── Swap email on auth user ───────────────────────────────────────
  const updateAuthRes = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users/${claim.target_user_id}`,
    {
      method: 'PUT',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: newEmail,
        email_confirm: true  // new email is pre-confirmed (we trust the admin's judgment)
      })
    }
  );

  if (!updateAuthRes.ok) {
    const errText = await updateAuthRes.text();
    console.error('[admin-approve-claim] email swap failed:', errText);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to update email: ' + errText }) };
  }

  // ── Mark user as claimed ──────────────────────────────────────────
  await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(claim.target_user_id)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ claimed: true })
    }
  );

  // ── Mark claim as approved ────────────────────────────────────────
  await fetch(
    `${SUPABASE_URL}/rest/v1/profile_claims?id=eq.${encodeURIComponent(claim.id)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_notes: reviewed_notes || null
      })
    }
  );

  // ── Fetch target user's public profile (name, slug, bizName) for the email ─
  let targetProfile = null;
  try {
    const pRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?select=name,venue_name,slug,role&id=eq.${encodeURIComponent(claim.target_user_id)}&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (pRes.ok) {
      const rows = await pRes.json();
      targetProfile = rows && rows[0] ? rows[0] : null;
    }
  } catch (e) { /* non-fatal */ }

  // ── Generate our own one-time password-setup token ──────────────────
  // We deliberately DO NOT use Supabase's built-in recovery flow here, because
  // that endpoint triggers Supabase's stock "Reset Your Password" email which
  // is (a) off-brand and (b) semantically wrong — this isn't a password reset,
  // it's a fresh account activation following an admin-approved claim.
  // Instead we generate a token, store it in our own password_setup_tokens
  // table, and include it in a custom "Profile Claimed" email.
  let setPasswordToken = null;
  let tokenStoreOk = false;
  try {
    // Generate a URL-safe 32-byte token (64 hex chars)
    const crypto = require('crypto');
    setPasswordToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/password_setup_tokens`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        token: setPasswordToken,
        user_id: claim.target_user_id,
        email: newEmail,
        expires_at: expiresAt
      })
    });
    tokenStoreOk = insertRes.ok;
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error('[admin-approve-claim] token insert failed:', errText);
    }
  } catch (e) {
    console.error('[admin-approve-claim] token generation error:', e);
  }

  // Determine the public site URL for the link (Netlify forwards the host)
  const host = event.headers['x-forwarded-host'] || event.headers['host'] || 'globaldjconnect.com';
  const proto = event.headers['x-forwarded-proto'] || 'https';
  const siteBase = `${proto}://${host}`;
  const setPasswordLink = tokenStoreOk
    ? `${siteBase}/set-password.html?token=${encodeURIComponent(setPasswordToken)}`
    : null;

  // ── Send the custom "Profile Claimed" email ──────────────────────
  let emailSent = false;
  if (setPasswordLink) {
    try {
      const emailRes = await fetch(`${siteBase}/.netlify/functions/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'profile_claimed',
          email: newEmail,
          name: targetProfile && targetProfile.name ? targetProfile.name : null,
          bizName: targetProfile ? (targetProfile.venue_name || targetProfile.name) : null,
          slug: targetProfile && targetProfile.slug ? targetProfile.slug : null,
          setPasswordLink: setPasswordLink
        })
      });
      emailSent = emailRes.ok;
      if (!emailRes.ok) {
        const errText = await emailRes.text();
        console.error('[admin-approve-claim] send-email failed:', errText);
      }
    } catch (e) {
      console.error('[admin-approve-claim] send-email error:', e);
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      user_id: claim.target_user_id,
      new_email: newEmail,
      email_sent: emailSent,
      message: emailSent
        ? 'Claim approved. Profile-claimed email sent to ' + newEmail + '.'
        : 'Claim approved, but the email send may have failed. Check Netlify logs.'
    })
  };
};
