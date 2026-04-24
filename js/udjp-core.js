// CORE: Supabase client, currentUser, updateUserRow, auth gate
// Extracted from update-dj-profile.html

const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3cXZ6dXVzcXVydWh3Z3Vxb2xlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjkxNjUsImV4cCI6MjA4NzE0NTE2NX0.TKoNk-u5bEKgVy-pXRrCYv8Iui8SzIa5ExiVUyEJ6UE';
const db = window.db || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// DJ type ('mobile' or 'club') — populated from data.dj_type during loadProfile, immutable on this page
let userDjType = null;

async function hashPassword(password) {
  if (!password) return null;
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'gdj_salt_2025');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// currentUser is set either by auth.js (new flow) or from legacy sessionStorage (old flow).
// We use let (not const) so the async auth.js resolution can populate it before we gate on it.
let currentUser = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || 'null');

// Helper: PATCH the current user's row using raw fetch with the active access token.
// Use this instead of `db.from('users').update(...).eq('id', currentUser.id)` to avoid
// the SDK silently no-op'ing writes when its session header isn't attached yet.
// Returns { ok: true, data } on success, { ok: false, error } on failure.
async function updateUserRow(updateData) {
  try {
    const session = (typeof GDJAuth !== 'undefined' && GDJAuth.session) ? GDJAuth.session() : null;
    const accessToken = session && session.access_token;
    if (!accessToken) return { ok: false, error: 'Not authenticated' };
    if (!currentUser || !currentUser.id) return { ok: false, error: 'No current user' };
    const res = await fetch(
      'https://hwqvzuusquruhwguqole.supabase.co/rest/v1/users?id=eq.' + encodeURIComponent(currentUser.id),
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify(updateData)
      }
    );
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: 'HTTP ' + res.status + ': ' + errText };
    }
    const rows = await res.json();
    if (!rows || rows.length === 0) {
      return { ok: false, error: 'No rows updated (permissions?)' };
    }
    return { ok: true, data: rows[0] };
  } catch (e) {
    return { ok: false, error: e.message || 'Update failed' };
  }
}

(async function authGate() {
  // Give auth.js a chance to resolve if it hasn't already
  if (typeof GDJAuth !== 'undefined' && GDJAuth.waitUntilReady) {
    const cu = await GDJAuth.waitUntilReady();
    if (cu) currentUser = cu;
  }
  if (!currentUser) {
    window.location.href = 'login.html';
    return;
  }
  if (currentUser.role !== 'dj' && currentUser.role !== 'admin') {
    window.location.href = 'account-settings.html';
  }
})();
