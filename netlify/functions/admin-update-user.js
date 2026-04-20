// netlify/functions/admin-update-user.js
// Admin-only: update fields on a public.users row using service_role.
// Whitelists allowed fields so admin cant accidentally write something weird.

const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';

const ALLOWED_FIELDS = [
  'name', 'slug', 'role', 'type',
  'venue_name', 'address',
  'country', 'state', 'city', 'zip',
  'bio',
  'phone', 'website', 'instagram', 'soundcloud', 'tiktok', 'facebook', 'twitch',
  'travel_distance',
  'profile_private',
  'claimed'
];

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

  const { user_id, updates } = body;
  if (!user_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'user_id required' }) };
  }
  if (!updates || typeof updates !== 'object') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'updates object required' }) };
  }

  // Build patch from allowed fields only
  const patch = {};
  for (const k of ALLOWED_FIELDS) {
    if (k in updates) {
      // Empty strings -> null for cleanliness, except for booleans
      const v = updates[k];
      if (v === '' || v === undefined) patch[k] = null;
      else patch[k] = v;
    }
  }

  if (Object.keys(patch).length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No allowed fields to update' }) };
  }

  // If slug is being changed, check uniqueness
  if (patch.slug) {
    const slugCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/users?select=id&slug=eq.${encodeURIComponent(patch.slug)}&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (slugCheck.ok) {
      const rows = await slugCheck.json();
      if (rows && rows[0] && rows[0].id !== user_id) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'That slug is already taken by another user' }) };
      }
    }
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(user_id)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(patch)
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error('[admin-update-user] PATCH failed:', errText);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Update failed: ' + errText }) };
  }

  const data = await res.json();
  if (!data || data.length === 0) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'User not found' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true, user: data[0] }) };
};
