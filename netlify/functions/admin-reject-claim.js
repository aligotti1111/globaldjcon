// netlify/functions/admin-reject-claim.js
// Marks a pending claim as rejected. No user changes made.

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

  const adminKey = event.headers['x-admin-key'] || event.headers['X-Admin-Key'];
  if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { claim_id, reviewed_notes } = body;
  if (!claim_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'claim_id required' }) };
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profile_claims?id=eq.${encodeURIComponent(claim_id)}&status=eq.pending`,
    {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_notes: reviewed_notes || null
      })
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to reject: ' + errText }) };
  }

  const data = await res.json();
  if (!data || data.length === 0) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Claim not found or not pending' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true, claim: data[0] }) };
};
