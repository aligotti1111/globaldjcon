// netlify/functions/admin-delete-user.js
// Permanently deletes a Supabase Auth user and their public.users row.

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

  // Delete from auth.users — the FK cascade from public.users -> auth.users
  // will remove the public.users row automatically (our SQL set ON DELETE CASCADE).
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(user_id)}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });

  if (!res.ok && res.status !== 404) {
    const errText = await res.text();
    console.error('[admin-delete-user] delete failed:', errText);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to delete: ' + errText }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true, user_id }) };
};
