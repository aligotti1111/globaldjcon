// netlify/functions/admin-create-user.js
// Creates a Supabase Auth user + public.users profile row with service_role privileges.
// Called by the admin panel. Protected by the X-Admin-Key header.

const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
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

  // ── Parse + validate input ───────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    role,       // 'dj' | 'host' | 'venue'
    name,
    slug,       // required for dj/venue, optional for host
    type,       // dj-specific
    country, state, city, zip,
    rate, travel_distance,
    phone, website, instagram, tiktok, facebook, soundcloud,
    bio,
    venue_name, address  // venue-specific
  } = body;

  if (!role || !['dj', 'host', 'venue'].includes(role)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid role' }) };
  }
  if (!name) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name is required' }) };
  }
  if ((role === 'dj' || role === 'venue') && !slug) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Slug is required for dj/venue' }) };
  }

  // ── Generate placeholder email + random password ─────────────────
  const baseSlug = slug || (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  const placeholderEmail = `${role}-${baseSlug}-${Date.now().toString(36)}@globaldjconnect.local`;
  const randomPassword = cryptoRandomPassword(20);

  // ── Check slug uniqueness via PostgREST ──────────────────────────
  if (slug) {
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?select=id&slug=eq.${encodeURIComponent(slug)}&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing && existing.length > 0) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'That slug is already taken.' }) };
      }
    }
  }

  // ── Create auth user via Supabase Admin API (pre-confirmed) ──────
  const authCreateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: placeholderEmail,
      password: randomPassword,
      email_confirm: true,
      user_metadata: {
        role, name, slug, type, country, state, city, zip
      }
    })
  });

  if (!authCreateRes.ok) {
    const errText = await authCreateRes.text();
    console.error('[admin-create-user] auth create failed:', errText);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create auth user: ' + errText }) };
  }

  const authUser = await authCreateRes.json();
  const userId = authUser.id || (authUser.user && authUser.user.id);
  if (!userId) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Auth user created but no ID returned' }) };
  }

  // ── Update public.users row with full details + mark unclaimed ───
  const profileUpdates = {
    role, name, slug, type,
    country, state, city, zip,
    rate, travel_distance,
    phone, website, instagram, tiktok, facebook, soundcloud,
    bio,
    venue_name, address,
    claimed: false
  };
  Object.keys(profileUpdates).forEach(k => {
    if (profileUpdates[k] === undefined) delete profileUpdates[k];
  });

  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(profileUpdates)
    }
  );

  if (!profileRes.ok) {
    const errText = await profileRes.text();
    console.error('[admin-create-user] profile update failed:', errText);
    // Rollback: delete the auth user we just created
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    }).catch(() => {});
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to update profile: ' + errText }) };
  }

  const profile = (await profileRes.json())[0] || {};

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      user_id: userId,
      placeholder_email: placeholderEmail,
      profile
    })
  };
};

function cryptoRandomPassword(len = 20) {
  const crypto = require('crypto');
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}
