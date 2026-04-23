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
    // If blocked, shows a themed in-page modal + returns false. Use at the top of booking/messaging handlers.
    //   if (!GDJAuth.requireVerifiedEmail()) return;
    requireVerifiedEmail(actionLabel) {
      if (!_currentUser) {
        showVerifyModal({ title: 'Sign In Required', body: 'Please sign in first.', primaryLabel: 'Sign In', primaryHref: '/login.html' });
        return false;
      }
      if (!_currentUser.confirmed) {
        const action = actionLabel || 'do this';
        showVerifyModal({
          title: 'Verify Your Email',
          body: 'You need to verify your email before you can ' + action + '. Check your email account for the confirmation email. Check your spam folder if not in primary inbox.',
          primaryLabel: 'Resend Email',
          primaryAction: 'resend'
        });
        // Nudge the banner to flash if present
        const banner = document.getElementById('gdj-verify-banner');
        if (banner) {
          banner.style.animation = 'none';
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
    async refreshProfile() {
      if (!_session || !_session.user) return null;
      const profile = await loadProfile(_session.user.id, _session.access_token);
      _currentUser = hydrateUser(_session.user, profile);
      window.currentUser = _currentUser;
      renderNav();
      // Banner state depends on _currentUser.confirmed — re-evaluate
      if (_currentUser && _currentUser.confirmed) {
        removeVerifyBanner();
      } else {
        injectVerifyBanner();
      }
      return _currentUser;
    },

    // Re-render the top nav toolbar (exposed so pages can trigger it manually if needed)
    renderNav() { renderNav(); },

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

  // ── Top nav toolbar rendering ─────────────────────────────────────────────
  // Single source of truth for what buttons show in the header across all pages.
  // Rules:
  //   Logged out:    Sign In + Create Account
  //   DJ:            Inbox, Booking Requests, View My Profile (hide on own
  //                  profile page), Update My Profile (hide on update page),
  //                  Logout
  //   Venue / host:  Inbox, Booking Requests, Settings, Logout
  // Pages opt in by including <div class="nav-btns" id="nav-btns"></div> in
  // their header. This helper will wipe and rebuild that container.
  function currentPath() {
    var p = (window.location.pathname || '/').toLowerCase();
    // Strip trailing slash (except for root) and .html extension for matching
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p;
  }

  function isOnUpdateProfilePage() {
    var p = currentPath();
    return p === '/update-dj-profile' || p === '/update-dj-profile.html';
  }

  function isOnOwnDjProfilePage(user) {
    if (!user || user.role !== 'dj' || !user.slug) return false;
    var p = currentPath();
    // DJ profiles render at /<slug> or /<slug>.html or /dj-profile.html?slug=<slug>
    var slug = String(user.slug).toLowerCase();
    if (p === '/' + slug || p === '/' + slug + '.html') return true;
    if (p === '/dj-profile' || p === '/dj-profile.html') {
      // Check query string for slug match
      var qs = new URLSearchParams(window.location.search);
      var qSlug = (qs.get('slug') || qs.get('dj') || '').toLowerCase();
      if (qSlug && qSlug === slug) return true;
    }
    return false;
  }

  // SVG icons used in the nav (kept inline to avoid extra requests)
  // All SVGs have explicit width/height so they don't blow out on pages
  // whose CSS doesn't size .btn svg.
  var NAV_SVGS = {
    signin:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>',
    signup:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
    profile: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    edit:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15.232 5.232l3.536 3.536M9 13l-4 4 4-4zm6.364-6.364A2 2 0 0118.2 9.4L8 19.6H4v-4L14.2 5.4a2 2 0 012.164-.532z" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    inbox:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    booking: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>',
    settings:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
    logout:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>'
  };

  function buildNavHtml(user) {
    var isMobile = (typeof window !== 'undefined') && window.matchMedia && window.matchMedia('(max-width: 640px)').matches;

    if (!user) {
      // Mobile: render nothing. Each page hardcodes its own Sign In text button.
      if (isMobile) return '';
      return (
        '<a href="/login.html" id="nav-signin" class="gdj-nav-btn gdj-nav-outline">' +
          NAV_SVGS.signin + '<span class="gdj-nav-text">Sign In</span>' +
        '</a>' +
        '<a href="/signup.html" id="nav-signup" class="gdj-nav-btn gdj-nav-primary">' +
          NAV_SVGS.signup + '<span class="gdj-nav-text">Create Account</span>' +
        '</a>'
      );
    }

    var parts = [];
    // On mobile the top bar only carries Inbox + Booking icons. Everything else
    // (View/Update Profile, Settings, Logout) lives in the hamburger menu that
    // each page hardcodes. We detect viewport here and bail after the two icons.

    // Inbox + Booking Requests — all logged-in users, all pages
    parts.push(
      '<a href="/inbox.html" class="gdj-nav-icon" id="nav-inbox-btn" title="Inbox">' +
        NAV_SVGS.inbox +
        '<span class="gdj-nav-badge" id="nav-unread-count" style="display:none;"></span>' +
      '</a>'
    );
    parts.push(
      '<a href="/booking-requests.html" class="gdj-nav-icon" id="nav-booking-requests-btn" title="Booking Requests">' +
        NAV_SVGS.booking +
        '<span class="gdj-nav-badge" id="nav-booking-count" style="display:none;"></span>' +
      '</a>'
    );

    if (isMobile) return parts.join('');

    if (user.role === 'dj') {
      // DJ: View My Profile (hide on own profile), Update My Profile (hide on update page)
      if (!isOnOwnDjProfilePage(user) && user.slug) {
        parts.push(
          '<a href="/' + encodeURIComponent(user.slug) + '" id="nav-view-profile" class="gdj-nav-btn gdj-nav-outline">' +
            NAV_SVGS.profile + '<span class="gdj-nav-text">View My Profile</span>' +
          '</a>'
        );
      }
      if (!isOnUpdateProfilePage()) {
        parts.push(
          '<a href="/update-dj-profile.html" id="nav-profile" class="gdj-nav-btn gdj-nav-primary">' +
            NAV_SVGS.edit +
            '<span class="gdj-nav-text">Update My Profile</span>' +
          '</a>'
        );
      }
    } else {
      // Venue / host: Settings icon
      parts.push(
        '<a href="/account-settings.html" class="gdj-nav-icon" id="nav-settings-btn" title="Account Settings">' +
          NAV_SVGS.settings +
        '</a>'
      );
    }

    // Logout — always last for logged-in users
    parts.push(
      '<button id="nav-logout" class="gdj-nav-btn gdj-nav-outline" onclick="GDJAuth.signOut()">' +
        NAV_SVGS.logout + '<span class="gdj-nav-text">Log Out</span>' +
      '</button>'
    );

    return parts.join('');
  }

  // Inject self-contained styles for the nav buttons so they look right
  // on every page regardless of that page's local CSS.
  // Mirrors the .btn / .btn-outline / .btn-primary / .inbox-nav-btn styles
  // from dj-profile.html so the nav looks identical everywhere.
  function injectNavStyles() {
    if (document.getElementById('gdj-nav-styles')) return;
    var css = ''
      + '#nav-btns{display:flex;gap:.5rem;align-items:center;flex-wrap:nowrap;}'
      + '.gdj-nav-btn{display:inline-flex;align-items:center;gap:.45rem;font-family:"Space Mono",monospace;font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;padding:.6rem 1rem;border-radius:6px;border:1px solid;cursor:pointer;text-decoration:none;transition:all .2s;white-space:nowrap;line-height:1;}'
      + '.gdj-nav-btn svg{width:14px;height:14px;flex-shrink:0;}'
      + '.gdj-nav-outline{background:transparent;border-color:#1e1e30;color:#9a9aaf;}'
      + '.gdj-nav-outline:hover{border-color:#00f5c4;color:#00f5c4;}'
      + '#nav-view-profile,#nav-signin{border-color:#f0f0f8;color:#f0f0f8;}'
      + '#nav-view-profile:hover,#nav-signin:hover{border-color:#00f5c4;color:#00f5c4;}'
      + '.gdj-nav-primary{background:#00f5c4;border-color:#00f5c4;color:#050507;font-weight:700;}'
      + '.gdj-nav-primary:hover{opacity:.85;}'
      + '.gdj-nav-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;border:1px solid #1e1e30;color:#9a9aaf;cursor:pointer;background:transparent;transition:all .2s;text-decoration:none;}'
      + '.gdj-nav-icon:hover{border-color:#00f5c4;color:#00f5c4;}'
      + '.gdj-nav-icon svg{width:16px;height:16px;}'
      + '.gdj-nav-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#ff5f5f;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:monospace;}'
      + '.hc-signin{display:inline-flex;align-items:center;gap:.4rem;font-family:"Space Mono",monospace;font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;padding:.55rem .9rem;border-radius:6px;border:1px solid #f0f0f8;color:#f0f0f8;text-decoration:none;transition:all .2s;white-space:nowrap;line-height:1;}'
      + '.hc-signin:hover{border-color:#00f5c4;color:#00f5c4;}'
      + 'body.is-logged-in .hc-signin{display:none !important;}'
      + '@media (max-width:640px){.gdj-nav-text{display:none;}.gdj-nav-btn{padding:.55rem .7rem;}.hc-signin{padding:.45rem .7rem;font-size:.58rem;}}';
    var style = document.createElement('style');
    style.id = 'gdj-nav-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function renderNav() {
    var container = document.getElementById('nav-btns');
    if (!container) return;
    injectNavStyles();
    // Preserve hardcoded children marked with data-keep attribute (like the mobile Sign In icon)
    var preserved = [];
    var keepers = container.querySelectorAll('[data-keep]');
    for (var i = 0; i < keepers.length; i++) preserved.push(keepers[i]);
    container.innerHTML = buildNavHtml(_currentUser);
    for (var j = 0; j < preserved.length; j++) container.appendChild(preserved[j]);
    // Toggle body classes so hardcoded page elements can show/hide based on auth state
    if (document.body) {
      if (_currentUser) {
        document.body.classList.add('is-logged-in');
        document.body.classList.remove('is-logged-out');
      } else {
        document.body.classList.add('is-logged-out');
        document.body.classList.remove('is-logged-in');
      }
    }
  }

  // Initial render: as soon as the DOM has the #nav-btns container, paint with
  // whatever state we have (may be logged-out initially; will re-render when
  // auth resolves below).
  function scheduleInitialNavRender() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderNav);
    } else {
      renderNav();
    }
  }
  scheduleInitialNavRender();

  // Re-render once auth resolves and on every subsequent auth state change
  GDJAuth.ready(renderNav);
  db.auth.onAuthStateChange(() => {
    // A tick later so _currentUser has been updated by the onAuthStateChange
    // listener higher up in this file
    setTimeout(renderNav, 0);
  });

  // Re-render when crossing the mobile breakpoint so the nav updates on
  // resize / orientation change (mobile uses fewer buttons than desktop)
  if (window.matchMedia) {
    try {
      var mq = window.matchMedia('(max-width: 640px)');
      var mqHandler = function () { renderNav(); };
      if (mq.addEventListener) mq.addEventListener('change', mqHandler);
      else if (mq.addListener) mq.addListener(mqHandler); // older Safari
    } catch (e) {}
  }

  // ── Verification banner auto-injection ────────────────────────────────────
  // When logged in but email is not verified, show a sticky banner on the page
  // that lets the user resend the verification email.
  // Skip on auth-related pages where the banner doesn't make sense.
  function shouldShowVerifyBanner() {
    if (!_currentUser) return false;
    if (_currentUser.confirmed) return false;
    // Skip banner on auth-flow pages where it's confusing or redundant.
    const path = (window.location.pathname || '').toLowerCase();
    const skip = ['/login', '/signup', '/forgot-password', '/reset-password', '/set-password'];
    if (skip.some(p => path === p || path === p + '.html' || path.startsWith(p + '/'))) return false;
    return true;
  }

  // Themed in-page modal used by requireVerifiedEmail in place of the browser alert.
  // opts: { title, body, primaryLabel, primaryHref?, primaryAction? }
  function showVerifyModal(opts) {
    const existing = document.getElementById('gdj-verify-modal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'gdj-verify-modal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1.5rem;animation:gdjModalFade .15s ease;';
    overlay.innerHTML = `
      <style>
        @keyframes gdjModalFade { from { opacity:0; } to { opacity:1; } }
        @keyframes gdjModalSlide { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        #gdj-verify-modal .gdj-modal-card { background:#13131e; border:1px solid rgba(255,179,71,.3); border-radius:12px; max-width:440px; width:100%; padding:32px 28px; text-align:center; animation:gdjModalSlide .2s ease; box-shadow:0 20px 60px rgba(0,0,0,.6); }
        #gdj-verify-modal .gdj-modal-icon { width:56px; height:56px; margin:0 auto 18px; border-radius:50%; background:rgba(255,179,71,.12); border:1px solid rgba(255,179,71,.4); display:flex; align-items:center; justify-content:center; }
        #gdj-verify-modal h3 { font-family:'Bebas Neue',sans-serif; font-size:26px; letter-spacing:.05em; color:#ffb347; margin:0 0 12px; }
        #gdj-verify-modal p { color:#c4c4d4; font-size:14px; line-height:1.6; margin:0 0 22px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
        #gdj-verify-modal .gdj-modal-actions { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
        #gdj-verify-modal button, #gdj-verify-modal a { font-family:'Space Mono',monospace; font-size:.7rem; letter-spacing:.08em; text-transform:uppercase; padding:.7rem 1.4rem; border-radius:6px; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; border:1px solid; background:transparent; }
        #gdj-verify-modal .primary { background:#ffb347; border-color:#ffb347; color:#000; font-weight:700; }
        #gdj-verify-modal .primary:hover:not(:disabled) { background:#ffc170; border-color:#ffc170; }
        #gdj-verify-modal .secondary { border-color:#3a3a4e; color:#c4c4d4; }
        #gdj-verify-modal .secondary:hover { border-color:#5a5a6e; color:#fff; }
        #gdj-verify-modal button:disabled { opacity:.5; cursor:default; }
      </style>
      <div class="gdj-modal-card" role="dialog" aria-modal="true" aria-labelledby="gdj-modal-title">
        <div class="gdj-modal-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffb347" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        </div>
        <h3 id="gdj-modal-title">${opts.title || 'Verification Required'}</h3>
        <p>${opts.body || ''}</p>
        <div class="gdj-modal-actions">
          ${opts.primaryHref
            ? `<a href="${opts.primaryHref}" class="primary">${opts.primaryLabel || 'OK'}</a>`
            : `<button type="button" class="primary" id="gdj-modal-primary">${opts.primaryLabel || 'OK'}</button>`}
          <button type="button" class="secondary" id="gdj-modal-close">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('gdj-modal-close').addEventListener('click', close);
    const primaryBtn = document.getElementById('gdj-modal-primary');
    if (primaryBtn) {
      primaryBtn.addEventListener('click', async () => {
        if (opts.primaryAction === 'resend') {
          primaryBtn.disabled = true;
          const orig = primaryBtn.textContent;
          primaryBtn.textContent = 'Sending...';
          const result = await GDJAuth.resendVerificationEmail();
          if (result.ok) {
            primaryBtn.textContent = '✓ Sent — check your inbox';
            setTimeout(close, 2500);
          } else {
            primaryBtn.textContent = '✗ ' + (result.error || 'Failed');
            setTimeout(() => { primaryBtn.textContent = orig; primaryBtn.disabled = false; }, 4000);
          }
        } else {
          close();
        }
      });
    }
  }

  function injectVerifyBanner() {
    if (!shouldShowVerifyBanner()) {
      // If we're on a skip page but a banner already exists from a previous
      // navigation, tear it down.
      removeVerifyBanner();
      return;
    }
    if (document.getElementById('gdj-verify-banner')) return;

    const style = document.createElement('style');
    style.textContent = `
      #gdj-verify-banner { position:fixed; top:0; left:0; right:0; width:100%; z-index:9999; background:linear-gradient(90deg, rgba(255,179,71,.1), rgba(255,179,71,.18), rgba(255,179,71,.1)); border-bottom:1px solid rgba(255,179,71,.35); padding:.55rem 1rem; display:flex; align-items:center; gap:.6rem; justify-content:center; font-family:'Space Mono',monospace; font-size:.7rem; letter-spacing:.04em; color:#ffb347; box-sizing:border-box; }
      #gdj-verify-banner .msg { flex:0 1 auto; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #gdj-verify-banner button { background:transparent; border:1px solid rgba(255,179,71,.5); color:#ffb347; padding:.25rem .65rem; border-radius:4px; font-family:inherit; font-size:inherit; letter-spacing:inherit; cursor:pointer; flex:0 0 auto; white-space:nowrap; }
      #gdj-verify-banner button:hover:not(:disabled) { background:rgba(255,179,71,.12); border-color:#ffb347; }
      #gdj-verify-banner button:disabled { opacity:.5; cursor:default; }
      @keyframes gdjVerifyFlash { 0%{background:rgba(255,179,71,.45);} 100%{background:rgba(255,179,71,.12);} }
      @media(max-width:600px) {
        #gdj-verify-banner { padding:.5rem .6rem; gap:.5rem; font-size:.6rem; }
        #gdj-verify-banner button { padding:.25rem .55rem; font-size:.55rem; }
      }
    `;
    document.head.appendChild(style);

    const banner = document.createElement('div');
    banner.id = 'gdj-verify-banner';
    const isNarrow = window.matchMedia('(max-width:600px)').matches;
    const msgText = isNarrow
      ? '✉ Verify email to unlock booking.'
      : '✉ Verify your email to unlock messaging &amp; booking.';
    banner.innerHTML = `
      <span class="msg">${msgText}</span>
      <button id="gdj-verify-resend" type="button">Resend</button>
    `;
    document.body.insertBefore(banner, document.body.firstChild);

    // Push the page content down by the banner's actual height so nothing slides
    // beneath it. Recompute on resize since the height changes between mobile
    // and desktop breakpoints.
    function syncBodyPad() {
      const b = document.getElementById('gdj-verify-banner');
      if (!b) { document.body.style.paddingTop = ''; return; }
      document.body.style.paddingTop = b.offsetHeight + 'px';
    }
    syncBodyPad();
    window.addEventListener('resize', syncBodyPad);

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

    // Clean up legacy per-session hide flag from older banner versions so the
    // banner shows even for users who previously dismissed it.
    try { sessionStorage.removeItem('gdjVerifyBannerHidden'); } catch (e) {}
  }

  // Also remove banner if user becomes verified later (e.g., they click link in another tab)
  function removeVerifyBanner() {
    const b = document.getElementById('gdj-verify-banner');
    if (b) b.remove();
    document.body.style.paddingTop = '';
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
