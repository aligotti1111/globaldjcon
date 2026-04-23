// ============================================================================
//  Global DJ Connect — UI Chrome (nav, verify banner, verify modal)
//  Include on every page AFTER auth.js:
//    <script src="/auth.js"></script>
//    <script src="/ui-chrome.js"></script>
//
//  This file owns all the cross-page UI that depends on auth state. It
//  consumes the public GDJAuth API + the GDJAuth:userChanged custom event
//  fired by auth.js, and never touches Supabase directly.
//
//  Splitting these concerns means UI tweaks in here can't break the auth
//  layer, and tweaks to auth.js can't accidentally break the chrome.
//
//  Pages opt into the rendered nav by including:
//    <div class="nav-btns" id="nav-btns"></div>
//  in their header. Pages without this container still get the body class
//  toggling, the verify banner, and the verify modal.
// ============================================================================

(function () {
  if (!window.GDJAuth) {
    console.error('[ui-chrome.js] GDJAuth not found — load auth.js first');
    return;
  }
  var GDJAuth = window.GDJAuth;

  // ── Path helpers used by nav rendering ──────────────────────────────────
  function currentPath() {
    var p = (window.location.pathname || '/').toLowerCase();
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
    var slug = String(user.slug).toLowerCase();
    if (p === '/' + slug || p === '/' + slug + '.html') return true;
    if (p === '/dj-profile' || p === '/dj-profile.html') {
      var qs = new URLSearchParams(window.location.search);
      var qSlug = (qs.get('slug') || qs.get('dj') || '').toLowerCase();
      if (qSlug && qSlug === slug) return true;
    }
    return false;
  }

  // ── Nav SVG icons ───────────────────────────────────────────────────────
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

  // ── Nav HTML builder ────────────────────────────────────────────────────
  // Rules:
  //   Logged out:   Sign In + Create Account (mobile renders nothing — pages hardcode their own)
  //   DJ:           Inbox, Booking Requests, View My Profile (hide on own profile),
  //                 Update My Profile (hide on update page), Logout
  //   Venue/host:   Inbox, Booking Requests, Settings, Logout
  function buildNavHtml(user) {
    var isMobile = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;

    if (!user) {
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
      parts.push(
        '<a href="/account-settings.html" class="gdj-nav-icon" id="nav-settings-btn" title="Account Settings">' +
          NAV_SVGS.settings +
        '</a>'
      );
    }

    parts.push(
      '<button id="nav-logout" class="gdj-nav-btn gdj-nav-outline" onclick="GDJAuth.signOut()">' +
        NAV_SVGS.logout + '<span class="gdj-nav-text">Log Out</span>' +
      '</button>'
    );

    return parts.join('');
  }

  // ── Nav styling ─────────────────────────────────────────────────────────
  // Self-contained styles so the nav looks identical regardless of host page CSS.
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
      // Defense-in-depth pending rules (the load-critical copy lives in auth.js)
      + 'body.is-auth-pending .hc-signin{visibility:hidden !important;}'
      + 'body.is-auth-pending #nav-btns{visibility:hidden !important;}'
      + 'body.is-auth-pending #signin-btn,body.is-auth-pending #signup-btn,body.is-auth-pending #signup-btn-mobile,body.is-auth-pending #view-profile-btn,body.is-auth-pending #profile-btn{visibility:hidden !important;}'
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
    // Preserve hardcoded children marked with data-keep (e.g. mobile Sign In icon)
    var preserved = [];
    var keepers = container.querySelectorAll('[data-keep]');
    for (var i = 0; i < keepers.length; i++) preserved.push(keepers[i]);
    container.innerHTML = buildNavHtml(GDJAuth.user());
    for (var j = 0; j < preserved.length; j++) container.appendChild(preserved[j]);
  }

  // Expose for legacy GDJAuth.renderNav() callers (back-compat shim in auth.js)
  GDJAuth._renderNavImpl = renderNav;

  // ── Body class toggling ─────────────────────────────────────────────────
  // Runs on every page once auth resolves, independent of whether the page
  // has a #nav-btns container. Without this, pages like the homepage (which
  // renders its own header) would never lose the is-auth-pending class.
  function applyAuthBodyClasses() {
    var cu = GDJAuth.user();
    document.documentElement.classList.remove('is-auth-pending');
    if (document.body) {
      document.body.classList.remove('is-auth-pending');
      if (cu) {
        document.body.classList.add('is-logged-in');
        document.body.classList.remove('is-logged-out');
      } else {
        document.body.classList.add('is-logged-out');
        document.body.classList.remove('is-logged-in');
      }
    }
  }

  // ── Verify banner ───────────────────────────────────────────────────────
  // Sticky banner shown to logged-in but unverified users. Skipped on auth
  // pages where it's redundant.
  function shouldShowVerifyBanner() {
    var cu = GDJAuth.user();
    if (!cu) return false;
    if (cu.confirmed) return false;
    var path = (window.location.pathname || '').toLowerCase();
    var skip = ['/login', '/signup', '/forgot-password', '/reset-password', '/set-password'];
    for (var i = 0; i < skip.length; i++) {
      var p = skip[i];
      if (path === p || path === p + '.html' || path.indexOf(p + '/') === 0) return false;
    }
    return true;
  }

  function injectVerifyBanner() {
    if (!shouldShowVerifyBanner()) {
      // If we're on a skip page but a banner already exists from a previous
      // navigation, tear it down.
      removeVerifyBanner();
      return;
    }
    if (document.getElementById('gdj-verify-banner')) return;

    if (!document.getElementById('gdj-verify-banner-styles')) {
      var style = document.createElement('style');
      style.id = 'gdj-verify-banner-styles';
      style.textContent = ''
        + '#gdj-verify-banner { position:fixed; top:0; left:0; right:0; width:100%; z-index:9999; background:linear-gradient(90deg, rgba(255,179,71,.1), rgba(255,179,71,.18), rgba(255,179,71,.1)); border-bottom:1px solid rgba(255,179,71,.35); padding:.55rem 1rem; display:flex; align-items:center; gap:.6rem; justify-content:center; font-family:\'Space Mono\',monospace; font-size:.7rem; letter-spacing:.04em; color:#ffb347; box-sizing:border-box; }'
        + '#gdj-verify-banner .msg { flex:0 1 auto; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }'
        + '#gdj-verify-banner button { background:transparent; border:1px solid rgba(255,179,71,.5); color:#ffb347; padding:.25rem .65rem; border-radius:4px; font-family:inherit; font-size:inherit; letter-spacing:inherit; cursor:pointer; flex:0 0 auto; white-space:nowrap; }'
        + '#gdj-verify-banner button:hover:not(:disabled) { background:rgba(255,179,71,.12); border-color:#ffb347; }'
        + '#gdj-verify-banner button:disabled { opacity:.5; cursor:default; }'
        + '@keyframes gdjVerifyFlash { 0%{background:rgba(255,179,71,.45);} 100%{background:rgba(255,179,71,.12);} }'
        + '@media(max-width:600px) {'
        + '  #gdj-verify-banner { padding:.5rem .6rem; gap:.5rem; font-size:.6rem; }'
        + '  #gdj-verify-banner button { padding:.25rem .55rem; font-size:.55rem; }'
        + '}';
      document.head.appendChild(style);
    }

    var banner = document.createElement('div');
    banner.id = 'gdj-verify-banner';
    var isNarrow = window.matchMedia('(max-width:600px)').matches;
    var msgText = isNarrow
      ? '✉ Verify email to unlock booking.'
      : '✉ Verify your email to unlock messaging &amp; booking.';
    banner.innerHTML =
      '<span class="msg">' + msgText + '</span>' +
      '<button id="gdj-verify-resend" type="button">Resend</button>';
    document.body.insertBefore(banner, document.body.firstChild);

    // Push the page content down by the banner's actual height. Recompute on
    // resize since the height changes between mobile and desktop breakpoints.
    function syncBodyPad() {
      var b = document.getElementById('gdj-verify-banner');
      if (!b) { document.body.style.paddingTop = ''; return; }
      document.body.style.paddingTop = b.offsetHeight + 'px';
    }
    syncBodyPad();
    window.addEventListener('resize', syncBodyPad);

    document.getElementById('gdj-verify-resend').addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true;
      var orig = btn.textContent;
      btn.textContent = 'Sending...';
      var result = await GDJAuth.resendVerificationEmail();
      if (result.ok) {
        btn.textContent = '✓ Sent — check your inbox';
        setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 5000);
      } else {
        btn.textContent = '✗ ' + (result.error || 'Failed');
        setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 4000);
      }
    });

    // Clean up legacy per-session hide flag from older banner versions
    try { sessionStorage.removeItem('gdjVerifyBannerHidden'); } catch (e) {}
  }

  function removeVerifyBanner() {
    var b = document.getElementById('gdj-verify-banner');
    if (b) b.remove();
    document.body.style.paddingTop = '';
  }

  // ── Verify modal ────────────────────────────────────────────────────────
  // Themed in-page modal shown when GDJAuth.requireVerifiedEmail() blocks.
  // Wired via GDJAuth._onBlockedAction so auth.js can call it without
  // depending on this file.
  function showVerifyModal(opts) {
    opts = opts || {};
    var existing = document.getElementById('gdj-verify-modal');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'gdj-verify-modal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1.5rem;animation:gdjModalFade .15s ease;';
    overlay.innerHTML =
      '<style>' +
        '@keyframes gdjModalFade { from { opacity:0; } to { opacity:1; } }' +
        '@keyframes gdjModalSlide { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }' +
        '#gdj-verify-modal .gdj-modal-card { background:#13131e; border:1px solid rgba(255,179,71,.3); border-radius:12px; max-width:440px; width:100%; padding:32px 28px; text-align:center; animation:gdjModalSlide .2s ease; box-shadow:0 20px 60px rgba(0,0,0,.6); }' +
        '#gdj-verify-modal .gdj-modal-icon { width:56px; height:56px; margin:0 auto 18px; border-radius:50%; background:rgba(255,179,71,.12); border:1px solid rgba(255,179,71,.4); display:flex; align-items:center; justify-content:center; }' +
        '#gdj-verify-modal h3 { font-family:\'Bebas Neue\',sans-serif; font-size:26px; letter-spacing:.05em; color:#ffb347; margin:0 0 12px; }' +
        '#gdj-verify-modal p { color:#c4c4d4; font-size:14px; line-height:1.6; margin:0 0 22px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }' +
        '#gdj-verify-modal .gdj-modal-actions { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }' +
        '#gdj-verify-modal button, #gdj-verify-modal a { font-family:\'Space Mono\',monospace; font-size:.7rem; letter-spacing:.08em; text-transform:uppercase; padding:.7rem 1.4rem; border-radius:6px; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; border:1px solid; background:transparent; }' +
        '#gdj-verify-modal .primary { background:#ffb347; border-color:#ffb347; color:#000; font-weight:700; }' +
        '#gdj-verify-modal .primary:hover:not(:disabled) { background:#ffc170; border-color:#ffc170; }' +
        '#gdj-verify-modal .secondary { border-color:#3a3a4e; color:#c4c4d4; }' +
        '#gdj-verify-modal .secondary:hover { border-color:#5a5a6e; color:#fff; }' +
        '#gdj-verify-modal button:disabled { opacity:.5; cursor:default; }' +
      '</style>' +
      '<div class="gdj-modal-card" role="dialog" aria-modal="true" aria-labelledby="gdj-modal-title">' +
        '<div class="gdj-modal-icon">' +
          '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffb347" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>' +
        '</div>' +
        '<h3 id="gdj-modal-title">' + (opts.title || 'Verification Required') + '</h3>' +
        '<p>' + (opts.body || '') + '</p>' +
        '<div class="gdj-modal-actions">' +
          (opts.primaryHref
            ? '<a href="' + opts.primaryHref + '" class="primary">' + (opts.primaryLabel || 'OK') + '</a>'
            : '<button type="button" class="primary" id="gdj-modal-primary">' + (opts.primaryLabel || 'OK') + '</button>') +
          '<button type="button" class="secondary" id="gdj-modal-close">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    function close() { overlay.remove(); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.getElementById('gdj-modal-close').addEventListener('click', close);
    var primaryBtn = document.getElementById('gdj-modal-primary');
    if (primaryBtn) {
      primaryBtn.addEventListener('click', async function () {
        if (opts.primaryAction === 'resend') {
          primaryBtn.disabled = true;
          var orig = primaryBtn.textContent;
          primaryBtn.textContent = 'Sending...';
          var result = await GDJAuth.resendVerificationEmail();
          if (result.ok) {
            primaryBtn.textContent = '✓ Sent — check your inbox';
            setTimeout(close, 2500);
          } else {
            primaryBtn.textContent = '✗ ' + (result.error || 'Failed');
            setTimeout(function () { primaryBtn.textContent = orig; primaryBtn.disabled = false; }, 4000);
          }
        } else {
          close();
        }
      });
    }

    // After showing the modal, also flash the top banner if it exists
    var banner = document.getElementById('gdj-verify-banner');
    if (banner && opts.kind === 'verify-required') {
      banner.style.animation = 'none';
      void banner.offsetWidth;
      banner.style.animation = 'gdjVerifyFlash 1s ease';
    }
  }

  // Register modal as the blocked-action handler so requireVerifiedEmail uses it
  GDJAuth._onBlockedAction = showVerifyModal;

  // ── Lifecycle wiring ────────────────────────────────────────────────────
  // Initial paint: as soon as the DOM has the #nav-btns container, paint with
  // whatever state we have. Will re-render when auth resolves below.
  function scheduleInitialNavRender() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderNav);
    } else {
      renderNav();
    }
  }
  scheduleInitialNavRender();

  // Re-render once auth resolves
  GDJAuth.ready(applyAuthBodyClasses);
  GDJAuth.ready(function () {
    renderNav();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectVerifyBanner);
    } else {
      injectVerifyBanner();
    }
  });

  // React to user state changes (refreshProfile, sign-in/out in another tab,
  // token refresh) — auth.js fires GDJAuth:userChanged on document.
  document.addEventListener('GDJAuth:userChanged', function () {
    applyAuthBodyClasses();
    renderNav();
    var cu = GDJAuth.user();
    if (cu && cu.confirmed) removeVerifyBanner();
    else if (shouldShowVerifyBanner()) injectVerifyBanner();
  });

  // Re-render when crossing the mobile breakpoint so the nav updates on
  // resize / orientation change (mobile uses fewer buttons than desktop).
  if (window.matchMedia) {
    try {
      var mq = window.matchMedia('(max-width: 640px)');
      var mqHandler = function () { renderNav(); };
      if (mq.addEventListener) mq.addEventListener('change', mqHandler);
      else if (mq.addListener) mq.addListener(mqHandler);
    } catch (e) {}
  }
})();
