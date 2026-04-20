// netlify/functions/admin-list-claims.js
// Lists profile_claims rows filtered by status. Admin-only.

const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') {
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

  const status = (event.queryStringParameters && event.queryStringParameters.status) || 'pending';
  const allowed = ['pending', 'approved', 'rejected', 'all'];
  if (!allowed.includes(status)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid status' }) };
  }

  const filter = status === 'all' ? '' : `&status=eq.${status}`;
  const url = `${SUPABASE_URL}/rest/v1/profile_claims?select=*${filter}&order=created_at.desc`;

  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('[admin-list-claims] fetch failed:', errText);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to list claims' }) };
  }
  const data = await res.json();
  return { statusCode: 200, headers, body: JSON.stringify(data) };
};
