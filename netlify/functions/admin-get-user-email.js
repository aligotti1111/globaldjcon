// netlify/functions/admin-get-user-email.js
// Admin-only: fetch a user's email from auth.users by user id.
// After the Supabase Auth migration, email lives on auth.users (not public.users),
// so the admin panel needs a server-side lookup using the service role key
// to populate the email field in the edit modal.

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

  const { user_id } = body;
  if (!user_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'user_id required' }) };
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(user_id)}`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: res.status, headers, body: JSON.stringify({ error: 'Auth lookup failed: ' + errText }) };
    }
    const user = await res.json();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        email: (user && user.email) || null,
        confirmed: !!(user && user.email_confirmed_at)
      })
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || 'Lookup failed' }) };
  }
};
