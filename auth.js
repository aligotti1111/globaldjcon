// ============================================================================
//  Global DJ Connect — Shared Auth Helper
//  Include on every page with: <script src="/auth.js"></script>
//  (Place this tag AFTER the Supabase SDK script and BEFORE any page logic.)
//
//  What this gives you:
//    window.db            — the Supabase client (same as existing pattern)
//    window.GDJAuth       — namespaced auth utilities
//    window.GDJAuth.ready(cb) — call cb once auth state is resolved; cb receives (currentUser, session)
//    window.GDJAuth.requireLogin() — redirect to /login if not logged in
//    window.GDJAuth.signOut() — sign out and redirect to /
//    window.currentUser   — the public.users profile row, or null (set once resolved)
//
//  Pages generally do one of:
//    GDJAuth.ready((cu) => { /* cu is your profile row, or null */ });
//    GDJAuth.requireLogin().then((cu) => { /* guaranteed logged in */ });
// ============================================================================

(function () {
  const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3cXZ6dXVzcXVydWh3Z3Vxb2xlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjkxNjUsImV4cCI6MjA4NzE0NTE2NX0.TKoNk-u5bEKgVy-pXRrCYv8Iui8SzIa5ExiVUyEJ6UE';

  if (!window.supabase || !window.supabase.createClient) {
    console.error('[auth.js] Supabase SDK must be loaded before auth.js');
    return;
  }

  // Create the shared client (use existing if another script already made one on this page)
  if (!window.db) {
    window.db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit'
      }
    });
  }
  const db = window.db;

  // Internal state
  let _currentUser = null;
  let _session = null;
  let _resolved = false;
  const _readyQueue = [];

  function flushReady() {
    _resolved = true;
    while (_readyQueue.length) {
      const cb = _readyQueue.shift();
      try { cb(_currentUser, _session); } catch (e) { console.error('[auth.js] ready callback error', e); }
    }
  }

  // Fetch the public.users profile row for a given auth user id (raw fetch — SDK can hang)
  async function loadProfile(userId, accessToken) {
    if (!userId) return null;
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/users?select=*&id=eq.' + encodeURIComponent(userId),
        { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + (accessToken || SUPABASE_KEY) } }
      );
      if (!res.ok) {
        console.error('[auth.js] profile load HTTP', res.status);
        return null;
      }
      const rows = await res.json();
      return (rows && rows[0]) || null;
    } catch (e) {
      console.error('[auth.js] profile load error', e);
      return null;
    }
  }

  // Read the session straight from localStorage (the SDK's getSession can hang)
  function readStoredSession() {
    try {
      const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];
      const raw = localStorage.getItem('sb-' + projectRef + '-auth-token');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Supabase has used a few shapes over time — normalize them
      if (parsed && parsed.access_token && parsed.user) return parsed;
      if (parsed && parsed.currentSession) return parsed.currentSession;
      return null;
    } catch (e) {
      return null;
    }
  }

  // Merge auth.users fields we want into the profile row so pages see
  // `currentUser.email` like the old code expected.
  function hydrateUser(authUser, profile) {
    if (!authUser) return null;
    const base = profile || { id: authUser.id };
    return Object.assign({}, base, {
      id: authUser.id,
      email: authUser.email,
      // convenience flag
      confirmed: !!authUser.email_confirmed_at
    });
  }

  // Resolve the current session and load profile; fires ready callbacks
  async function resolveInitialSession() {
    try {
      const session = readStoredSession();
      _session = session || null;
      if (session && session.user) {
        const profile = await loadProfile(session.user.id, session.access_token);
        _currentUser = hydrateUser(session.user, profile);
      } else {
        _currentUser = null;
      }
    } catch (e) {
      console.error('[auth.js] session resolve error', e);
      _currentUser = null;
      _session = null;
    } finally {
      window.currentUser = _currentUser; // set global so existing page code sees it
      flushReady();
    }
  }

  // Keep profile in sync if user signs in/out in another tab, token refreshes, etc.
  db.auth.onAuthStateChange(async (event, session) => {
    _session = session || null;
    if (session && session.user) {
      const profile = await loadProfile(session.user.id, session.access_token);
      _currentUser = hydrateUser(session.user, profile);
    } else {
      _currentUser = null;
    }
    window.currentUser = _currentUser;
    // If event fires before initial resolve (edge case), flush the queue
    if (!_resolved) flushReady();
  });

  // ── Public API ────────────────────────────────────────────────────────────

  const GDJAuth = {
    // Call cb(currentUser, session) once auth state is known
    ready(cb) {
      if (typeof cb !== 'function') return;
      if (_resolved) cb(_currentUser, _session);
      else _readyQueue.push(cb);
    },

    // Returns a promise that resolves when auth state is known
    waitUntilReady() {
      if (_resolved) return Promise.resolve(_currentUser);
      return new Promise((resolve) => _readyQueue.push(() => resolve(_currentUser)));
    },

    // Redirect to login if not authed; returns promise resolving to currentUser
    async requireLogin(redirectReturn = true) {
      const cu = await this.waitUntilReady();
      if (!cu) {
        const target = redirectReturn
          ? '/login?return=' + encodeURIComponent(window.location.pathname + window.location.search)
          : '/login';
        window.location.href = target;
        // Return an unresolved promise so caller doesn't continue
        return new Promise(() => {});
      }
      return cu;
    },

    // Returns the latest known user synchronously (may be null before resolve)
    user() { return _currentUser; },
    session() { return _session; },

    // Force-refetch the profile row (e.g., after updating account settings)
    async refreshProfile() {
      if (!_session || !_session.user) return null;
      const profile = await loadProfile(_session.user.id, _session.access_token);
      _currentUser = hydrateUser(_session.user, profile);
      window.currentUser = _currentUser;
      return _currentUser;
    },

    // Sign out and redirect (uses raw fetch — the SDK's signOut can hang)
    async signOut(redirectTo = '/') {
      try {
        const authKey = 'sb-hwqvzuusquruhwguqole-auth-token';
        const raw = localStorage.getItem(authKey);
        let token = '';
        if (raw) {
          try {
            const s = JSON.parse(raw);
            token = (s && s.access_token) || (s && s.currentSession && s.currentSession.access_token) || '';
          } catch (e) {}
        }
        if (token) {
          // Fire-and-forget server-side logout
          fetch(SUPABASE_URL + '/auth/v1/logout', {
            method: 'POST',
            headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token }
          }).catch(() => {});
        }
        localStorage.removeItem(authKey);
      } catch (e) {}
      // Also clear legacy storage keys from the old auth system
      try {
        sessionStorage.removeItem('currentUser');
        localStorage.removeItem('currentUser');
        sessionStorage.removeItem('adminUser');
      } catch (e) {}
      window.location.href = redirectTo;
    }
  };

  window.GDJAuth = GDJAuth;

  // Kick off the initial resolve immediately
  resolveInitialSession();
})();
