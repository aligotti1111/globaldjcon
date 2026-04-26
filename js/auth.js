// ============================================================================
//  Global DJ Connect — Auth Core
//  Include on every page with: <script src="/auth.js"></script>
//  (Place this tag AFTER the Supabase SDK script and BEFORE any page logic.)
//  Pair with /ui-chrome.js for the nav, verify banner, and verify modal UI.
//
//  What this gives you:
//    window.db                    — the Supabase client (same as existing pattern)
//    window.GDJAuth               — namespaced auth utilities
//    window.GDJAuth.ready(cb)     — call cb once auth state is resolved; cb gets (currentUser, session)
//    window.GDJAuth.requireLogin()— redirect to /login if not logged in
//    window.GDJAuth.signOut()     — sign out and redirect to /
//    window.currentUser           — the public.users profile row, or null (set once resolved)
//
//  Pages generally do one of:
//    GDJAuth.ready((cu) => { /* cu is your profile row, or null */ });
//    GDJAuth.requireLogin().then((cu) => { /* guaranteed logged in */ });
//
//  EXTENSION HOOKS (set by ui-chrome.js, do not call directly):
//    GDJAuth._onBlockedAction(opts)   — invoked when requireVerifiedEmail blocks
//    Custom event 'GDJAuth:userChanged' fires on document when user state changes
// ============================================================================

(function () {
  const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3cXZ6dXVzcXVydWh3Z3Vxb2xlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjkxNjUsImV4cCI6MjA4NzE0NTE2NX0.TKoNk-u5bEKgVy-pXRrCYv8Iui8SzIa5ExiVUyEJ6UE';

  if (!window.supabase || !window.supabase.createClient) {
    console.error('[auth.js] Supabase SDK must be loaded before auth.js');
    return;
  }

  // ── Pending-state plumbing ───────────────────────────────────────────────
  // Mark the document as auth-pending IMMEDIATELY so pages can hide
  // signed-in/signed-out specific UI until the session is resolved (kills the
  // "flash of signed-out content" when a user reloads). Stamp <html> right now
  // (synchronous, before <body> may even exist) and propagate to <body> once
  // it parses. The CSS rules that hide UI live in ui-chrome.js but the class
  // toggling lives here because it's load-critical and must run first.
  document.documentElement.classList.add('is-auth-pending');
  function _markBodyPending() {
    if (_resolved) return;
    if (document.body) document.body.classList.add('is-auth-pending');
  }
  if (document.body) _markBodyPending();
  else document.addEventListener('DOMContentLoaded', _markBodyPending, { once: true });

  // Inject the pending-state CSS RIGHT NOW so it's active during the
  // auth-resolution window. We rely on visibility:hidden (not display:none)
  // so layout stays stable — when auth resolves and the pending class is
  // removed, elements simply become visible without reflow.
  // (This stays in auth.js because removing it would mean a flash on every
  // page load until ui-chrome.js loads. It's a tiny self-contained block.)
  (function injectPendingCss() {
    if (document.getElementById('gdj-auth-pending-styles')) return;
    var pendingCss = ''
      + 'html.is-auth-pending #signin-btn,'
      + 'html.is-auth-pending #signup-btn,'
      + 'html.is-auth-pending #signup-btn-mobile,'
      + 'html.is-auth-pending #view-profile-btn,'
      + 'html.is-auth-pending #profile-btn,'
      + 'html.is-auth-pending .hc-signin,'
      + 'html.is-auth-pending #nav-btns'
      + '{visibility:hidden !important;}';
    var s = document.createElement('style');
    s.id = 'gdj-auth-pending-styles';
    s.textContent = pendingCss;
    (document.head || document.documentElement).appendChild(s);
  })();

  // ── Supabase client ──────────────────────────────────────────────────────
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

  // ── Internal state ───────────────────────────────────────────────────────
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

  // Notify any subscribed listener (typically ui-chrome.js) that the user
  // state may have changed. Decoupled via custom event so auth.js never
  // imports/calls UI code directly.
  function emitUserChanged() {
    try {
      var evt = new CustomEvent('GDJAuth:userChanged', {
        detail: { user: _currentUser, session: _session }
      });
      document.dispatchEvent(evt);
    } catch (e) {
      // Ancient browsers — fall back to a basic event
      var ev2 = document.createEvent('Event');
      ev2.initEvent('GDJAuth:userChanged', false, false);
      document.dispatchEvent(ev2);
    }
  }

  // ── Profile / session loading ────────────────────────────────────────────
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
    // `confirmed` is sourced from our own public.users.email_verified column
    // — NOT from Supabase's auth.users.email_confirmed_at, which Supabase
    // re-populates on every login when the project's "Confirm email" toggle
    // is off. We control email_verified entirely via our verify-email
    // Netlify function; the user clicks the link in their email and we
    // flip the column to true. Default false for new accounts.
    return Object.assign({}, base, {
      id: authUser.id,
      email: authUser.email,
      confirmed: !!(profile && profile.email_verified)
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
      emitUserChanged();
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
    emitUserChanged();
  });

  // ── Public API ───────────────────────────────────────────────────────────

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
    // If blocked, fires GDJAuth._onBlockedAction (set by ui-chrome.js to show the themed
    // modal). Falls back to a plain alert if no UI handler is registered, so this still
    // works on a hypothetical page that doesn't load ui-chrome.js.
    //   if (!GDJAuth.requireVerifiedEmail()) return;
    requireVerifiedEmail(actionLabel) {
      if (!_currentUser) {
        if (typeof GDJAuth._onBlockedAction === 'function') {
          GDJAuth._onBlockedAction({
            kind: 'login-required',
            title: 'Sign In Required',
            body: 'Please sign in first.',
            primaryLabel: 'Sign In',
            primaryHref: '/login.html'
          });
        } else {
          alert('Please sign in first.');
        }
        return false;
      }
      if (!_currentUser.confirmed) {
        const action = actionLabel || 'do this';
        if (typeof GDJAuth._onBlockedAction === 'function') {
          GDJAuth._onBlockedAction({
            kind: 'verify-required',
            title: 'Verify Your Email',
            body: 'You need to verify your email before you can ' + action + '. Check your email account for the confirmation email. Check your spam folder if not in primary inbox.',
            primaryLabel: 'Resend Email',
            primaryAction: 'resend'
          });
        } else {
          alert('Please verify your email before you can ' + action + '.');
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
        // Route through our Netlify function which uses service-role to
        // generate a fresh signup confirmation link + dispatches via Resend.
        const res = await fetch('/.netlify/functions/signup-send-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: _currentUser.id,
            email: _currentUser.email,
            role: _currentUser.role || 'host',
            slug: _currentUser.slug || null
          })
        });
        if (!res.ok) {
          const txt = await res.text();
          return { ok: false, error: txt || ('HTTP ' + res.status) };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e && e.message) || 'Failed to resend' };
      }
    },

    // Force-refetch the profile row from public.users. The `confirmed` flag
    // is sourced from this row (email_verified column), so re-reading the
    // row picks up verification changes made by our verify-email function.
    // Fires GDJAuth:userChanged so ui-chrome.js can re-render nav + banner.
    async refreshProfile() {
      if (!_session || !_session.user) return null;
      const profile = await loadProfile(_session.user.id, _session.access_token);
      _currentUser = hydrateUser(_session.user, profile);
      window.currentUser = _currentUser;
      emitUserChanged();
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
    },

    // ── Hooks for ui-chrome.js (do not call directly from page code) ────
    // ui-chrome.js sets _onBlockedAction to display the themed verify modal.
    // Default is null — requireVerifiedEmail falls back to alert() if unset.
    _onBlockedAction: null,

    // ui-chrome.js exposes renderNav as a passthrough so legacy callers that
    // do GDJAuth.renderNav() keep working. Same fallback approach: if
    // ui-chrome.js isn't loaded, this is a no-op.
    renderNav() {
      if (typeof GDJAuth._renderNavImpl === 'function') GDJAuth._renderNavImpl();
    },
    _renderNavImpl: null
  };

  window.GDJAuth = GDJAuth;

  // Kick off the initial resolve immediately
  resolveInitialSession();
})();
