// CORE: Supabase init, auth gate, admin key, apiGet, adminPost, claim helpers
// Extracted from admin.html

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3cXZ6dXVzcXVydWh3Z3Vxb2xlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjkxNjUsImV4cCI6MjA4NzE0NTE2NX0.TKoNk-u5bEKgVy-pXRrCYv8Iui8SzIa5ExiVUyEJ6UE';

// ── Admin gate ─────────────────────────────────────────────────────
// The admin is NOT a normal Supabase user. Their session is a flag in sessionStorage
// set by login.html when they enter admin@globaldjconnect.com + spinlist2025.
// For privileged Netlify function calls we also need the ADMIN_API_KEY.
// Since the key lives only in Netlify env, we prompt for it once per session.

if (sessionStorage.getItem('adminUser') !== '1') {
  alert('Admin access required. Please sign in.');
  window.location.href = 'login.html';
}

let ADMIN_API_KEY = sessionStorage.getItem('adminApiKey') || '';
function ensureAdminKey() {
  if (ADMIN_API_KEY) return ADMIN_API_KEY;
  const k = prompt('Enter admin API key (set as ADMIN_API_KEY in Netlify env). Only needed once per session.');
  if (k) {
    ADMIN_API_KEY = k.trim();
    sessionStorage.setItem('adminApiKey', ADMIN_API_KEY);
  }
  return ADMIN_API_KEY;
}

// ── Public-read helpers (users + claim lookup) ─────────────────────
const userCache = {}; // id -> full user object, populated by loadUsers
async function apiGet(path) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
  });
  if (!res.ok) return [];
  return res.json();
}

// Privileged admin function calls
async function adminPost(fnName, body) {
  const key = ensureAdminKey();
  if (!key) throw new Error('Admin API key required');
  const res = await fetch('/.netlify/functions/' + fnName, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
    body: JSON.stringify(body)
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(result.error || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return result;
}

// For privileged reads (pending claims, etc.) we also need a path.
// We'll expose a minimal read endpoint via a new function OR just use
// the anon key for reads where possible. Since profile_claims SELECT is
// DENY-by-default under RLS, we need the service_role key on the server.
// For simplicity, we expose claim reads via a third tiny function.
// For now, we'll use one function `admin-list-claims`.

async function adminGetClaims(status) {
  const key = ensureAdminKey();
  if (!key) return [];
  try {
    const res = await fetch('/.netlify/functions/admin-list-claims?status=' + encodeURIComponent(status || 'pending'), {
      headers: { 'X-Admin-Key': key }
    });
    if (!res.ok) return [];
    return res.json();
  } catch (e) { return []; }
}

