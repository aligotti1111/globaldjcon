// netlify/functions/admin-list-emails.js
// Admin-only: returns { users: [{ id, email, confirmed }] } for ALL auth users.
// Used by the admin panel to show emails in account lists and to enable
// email-based search, without issuing a separate lookup per row.

const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
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

  try {
    // Paginate through auth.users (default per_page is 50, max is 1000)
    const out = [];
    const perPage = 1000;
    let page = 1;
    while (true) {
      const res = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?per_page=${perPage}&page=${page}`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
      );
      if (!res.ok) {
        const errText = await res.text();
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Auth list failed: ' + errText }) };
      }
      const result = await res.json();
      const users = (result && result.users) || [];
      for (const u of users) {
        out.push({
          id: u.id,
          email: u.email || null,
          confirmed: !!u.email_confirmed_at
        });
      }
      if (users.length < perPage) break;
      page++;
      if (page > 20) break; // safety stop at 20k users
    }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, users: out }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || 'List failed' }) };
  }
};
