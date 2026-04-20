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

    // Is the user's email verified? (false if not logged in, or logged in but unconfirmed)
    isEmailVerified() {
      return !!(_currentUser && _currentUser.confirmed);
    },

    // Gate a critical action behind email verification. Returns true if user may proceed.
    // If blocked, shows a friendly alert + returns false. Use at the top of booking/messaging handlers.
    //   if (!GDJAuth.requireVerifiedEmail()) return;
    requireVerifiedEmail(actionLabel) {
      if (!_currentUser) {
        alert('Please sign in first.');
        return false;
      }
      if (!_currentUser.confirmed) {
        const action = actionLabel || 'do this';
        const msg = 'Please verify your email before you can ' + action + '.\n\nCheck your inbox for the confirmation link — or click "Resend" in the banner at the top of the page.';
        alert(msg);
        // Nudge the banner to flash if present
        const banner = document.getElementById('gdj-verify-banner');
        if (banner) {
          banner.style.animation = 'none';
          // restart animation
          void banner.offsetWidth;
          banner.style.animation = 'gdjVerifyFlash 1s ease';
        }
        return false;
      }
      return true;
    },

    // Resend the email verification link. Returns { ok: boolean, error?: string }.
    async resendVerificationEmail() {
      if (!_currentUser || !_currentUser.email) {
        return { ok: false, error: 'Not logged in' };
      }
      if (_currentUser.confirmed) {
        return { ok: false, error: 'Email already verified' };
      }
      try {
        const { error } = await db.auth.resend({
          type: 'signup',
          email: _currentUser.email,
          options: { emailRedirectTo: window.location.origin + '/account-settings.html?emailverified=1' }
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e && e.message) || 'Failed to resend' };
      }
    },

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

  // ── Verification banner auto-injection ────────────────────────────────────
  // When logged in but email is not verified, show a sticky banner on the page
  // that lets the user resend the verification email.
  // Skip on auth-related pages where the banner doesn't make sense.
  function shouldShowVerifyBanner() {
    if (!_currentUser) return false;
    if (_currentUser.confirmed) return false;
    const path = (window.location.pathname || '').toLowerCase();
    const skip = ['/login', '/signup', '/forgot-password', '/reset-password', '/claim', '/contact', '/privacy', '/admin'];
    if (skip.some(p => path === p || path === p + '.html' || path.startsWith(p + '/'))) return false;
    return true;
  }

  function injectVerifyBanner() {
    if (!shouldShowVerifyBanner()) return;
    if (document.getElementById('gdj-verify-banner')) return;

    const style = document.createElement('style');
    style.textContent = `
      #gdj-verify-banner { position:sticky; top:0; left:0; right:0; z-index:500; background:linear-gradient(90deg, rgba(255,179,71,.1), rgba(255,179,71,.18), rgba(255,179,71,.1)); border-bottom:1px solid rgba(255,179,71,.35); padding:.6rem 1.5rem; display:flex; align-items:center; gap:.8rem; flex-wrap:wrap; justify-content:center; font-family:'Space Mono',monospace; font-size:.7rem; letter-spacing:.04em; color:#ffb347; }
      #gdj-verify-banner .msg { flex:0 1 auto; }
      #gdj-verify-banner button { background:transparent; border:1px solid rgba(255,179,71,.5); color:#ffb347; padding:.3rem .8rem; border-radius:4px; font-family:inherit; font-size:inherit; letter-spacing:inherit; cursor:pointer; }
      #gdj-verify-banner button:hover:not(:disabled) { background:rgba(255,179,71,.12); border-color:#ffb347; }
      #gdj-verify-banner button:disabled { opacity:.5; cursor:default; }
      #gdj-verify-banner .close { border:none; padding:.2rem .5rem; font-size:1rem; line-height:1; opacity:.6; }
      #gdj-verify-banner .close:hover { opacity:1; background:transparent; }
      @keyframes gdjVerifyFlash { 0%{background:rgba(255,179,71,.45);} 100%{background:rgba(255,179,71,.12);} }
    `;
    document.head.appendChild(style);

    const banner = document.createElement('div');
    banner.id = 'gdj-verify-banner';
    banner.innerHTML = `
      <span class="msg">✉ Verify your email to unlock messaging &amp; booking.</span>
      <button id="gdj-verify-resend" type="button">Resend Email</button>
      <button class="close" id="gdj-verify-close" type="button" title="Hide for this session">×</button>
    `;
    document.body.insertBefore(banner, document.body.firstChild);

    document.getElementById('gdj-verify-resend').addEventListener('click', async function() {
      const btn = this;
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = 'Sending...';
      const result = await GDJAuth.resendVerificationEmail();
      if (result.ok) {
        btn.textContent = '✓ Sent — check your inbox';
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 5000);
      } else {
        btn.textContent = '✗ ' + (result.error || 'Failed');
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 4000);
      }
    });

    document.getElementById('gdj-verify-close').addEventListener('click', function() {
      banner.style.display = 'none';
      try { sessionStorage.setItem('gdjVerifyBannerHidden', '1'); } catch(e) {}
    });

    // Respect per-session hide
    try {
      if (sessionStorage.getItem('gdjVerifyBannerHidden') === '1') banner.style.display = 'none';
    } catch (e) {}
  }

  // Also remove banner if user becomes verified later (e.g., they click link in another tab)
  function removeVerifyBanner() {
    const b = document.getElementById('gdj-verify-banner');
    if (b) b.remove();
  }

  // Hook banner into ready resolution
  GDJAuth.ready(() => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectVerifyBanner);
    } else {
      injectVerifyBanner();
    }
  });

  // Re-check banner state on auth state changes
  db.auth.onAuthStateChange(() => {
    if (_currentUser && _currentUser.confirmed) removeVerifyBanner();
    else if (shouldShowVerifyBanner()) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectVerifyBanner);
      } else {
        injectVerifyBanner();
      }
    }
  });

  // Kick off the initial resolve immediately
  resolveInitialSession();
})();
