// netlify/functions/admin-approve-claim.js
// Approves a profile claim:
//   1. Swaps the auth user's email from placeholder to the claimant's real email
//   2. Marks the user as claimed=true
//   3. Marks the claim as approved
//   4. Triggers a Supabase password reset email (doubles as "set your password" welcome)

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

  // ── Check new email isn't already taken by a different user ──────
  const emailCheckRes = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(newEmail)}`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  if (emailCheckRes.ok) {
    const result = await emailCheckRes.json();
    const users = result.users || [];
    const conflict = users.find(u => u.id !== claim.target_user_id);
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
        email_confirm: true
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

  // ── Trigger "set your password" email via Supabase's recover flow ─
  const recoverRes = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email: newEmail })
  });

  if (!recoverRes.ok) {
    const errText = await recoverRes.text();
    console.warn('[admin-approve-claim] recover email send may have failed:', errText);
    // Non-fatal; the email swap already succeeded
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      user_id: claim.target_user_id,
      new_email: newEmail,
      message: 'Claim approved. Password setup email sent to ' + newEmail + '.'
    })
  };
};
