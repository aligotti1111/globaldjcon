// EVENTS & INIT: search/filter listeners + IIFE bootstraps
// Extracted from index.html

// ─── EVENTS ───────────────────────────────────────────
let searchGeoTimeout = null;
document.getElementById('search').addEventListener('input', e => {
  searchTerm = e.target.value;
  // If search looks like a city or zip, geocode it to enable distance filtering
  clearTimeout(searchGeoTimeout);
  const q = searchTerm.trim();
  if (q.length >= 3) {
    searchGeoTimeout = setTimeout(async () => {
      // Only geocode if query looks like a location (has digits or is a known place pattern)
      // Skip geocoding for name searches (letters/spaces only)
      const looksLikeLocation = /\d/.test(q);
      if (looksLikeLocation) {
        const coords = await geocodeCity(q);
        if (coords) {
          userLocation = coords;
          sortMode = 'nearest';
          const ss = document.getElementById('sort-select'); if (ss) ss.value = 'nearest';
        }
      } else {
        // Name search — clear location so distance doesn't filter results
        userLocation = null;
        if (sortMode === 'nearest') sortMode = 'name';
      }
      renderPublic();
    }, 600);
  } else {
    renderPublic();
  }
});
document.querySelectorAll('.pill').forEach(pill=>{
  pill.addEventListener('click',()=>{
    const f=pill.dataset.filter;
    if(activeFilters.has(f)){
      if(activeFilters.size > 1){ activeFilters.delete(f); pill.classList.remove('active'); updatePillText(pill, false); }
    } else {
      activeFilters.add(f); pill.classList.add('active'); updatePillText(pill, true);
    }
    renderPublic();
  });
});

function updatePillText(pill, active) {
  const base = pill.dataset.label || pill.textContent.replace('✓ ', '');
  if (!pill.dataset.label) pill.dataset.label = base;
  pill.textContent = active ? base + ' ✓' : base;
}

// Init checkmarks on load
document.querySelectorAll('.pill.active').forEach(pill => updatePillText(pill, true));

(async () => {
  try {
    await renderPublic(true);
  } catch (e) {
    console.error('[index] renderPublic failed:', e);
  }
})();

// Check if admin hash is present and user is logged in
if (window.location.hash === '#admin') {
  const isAdmin = sessionStorage.getItem('adminUser') === '1';
  if (isAdmin) {
    (async () => {
      DJS = await loadDJs();
      goTo('admin');
    })();
  } else {
    window.location.href = 'login.html';
  }
}

// Listen for admin access from auth redirect
window.addEventListener('openAdmin', () => {
  (async () => {
    DJS = await loadDJs();
    goTo('admin');
  })();
});

// Check if user is logged in and update header buttons
// Uses localStorage directly since the Supabase SDK can hang in this environment
(async function() {
  let currentUser = null;
  try {
    // Supabase stores the session in localStorage under sb-<project-ref>-auth-token
    const authKey = 'sb-hwqvzuusquruhwguqole-auth-token';
    const raw = localStorage.getItem(authKey);
    if (raw) {
      const session = JSON.parse(raw);
      const accessToken = session && (session.access_token || (session.currentSession && session.currentSession.access_token));
      const userId = session && session.user && session.user.id
        || session && session.currentSession && session.currentSession.user && session.currentSession.user.id;
      const userEmail = session && session.user && session.user.email
        || session && session.currentSession && session.currentSession.user && session.currentSession.user.email;
      if (accessToken && userId) {
        // Fetch profile row via raw fetch
        const res = await fetch(
          'https://hwqvzuusquruhwguqole.supabase.co/rest/v1/users?select=*&id=eq.' + encodeURIComponent(userId),
          { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + accessToken } }
        );
        const rows = res.ok ? await res.json() : [];
        const profile = (rows && rows[0]) || {};
        currentUser = Object.assign({}, profile, { id: userId, email: userEmail });
      }
    }
  } catch (e) {
    console.error('[index] session check failed:', e);
  }

  if (currentUser) {
    document.getElementById('signin-btn').style.display = 'none';
    document.getElementById('signup-btn').style.display = 'none';
    document.getElementById('logout-btn').style.display = 'inline-flex';
    document.getElementById('inbox-btn').style.display = 'inline-flex';
    document.getElementById('settings-btn').style.display = 'inline-flex';
    // Mobile menu
    var li = document.getElementById('mobile-menu-loggedin'); if (li) li.style.display = 'block';

    if (currentUser.role === 'dj') {
      document.getElementById('profile-btn').style.display = 'inline-flex';
      document.getElementById('settings-btn').style.display = 'none';
      document.getElementById('booking-requests-btn').style.display = 'inline-flex';
      if (currentUser.slug) {
        document.getElementById('view-profile-btn').href = '/' + currentUser.slug;
        document.getElementById('view-profile-btn').style.display = 'inline-flex';
      }
      var djEl = document.getElementById('mobile-menu-dj'); if (djEl) djEl.style.display = 'block';
      var mv = document.getElementById('mob-view-profile'); if (mv && currentUser.slug) mv.href = '/' + currentUser.slug;
    } else {
      var vEl = document.getElementById('mobile-menu-venue'); if (vEl) vEl.style.display = 'block';
    }

    // Get access token for authenticated API calls (badges, bookings)
    const authRaw = localStorage.getItem('sb-hwqvzuusquruhwguqole-auth-token');
    let _accessToken = '';
    try {
      const s = authRaw ? JSON.parse(authRaw) : null;
      _accessToken = (s && s.access_token) || (s && s.currentSession && s.currentSession.access_token) || '';
    } catch(e) {}
    function apiGet(path) {
      return fetch('https://hwqvzuusquruhwguqole.supabase.co/rest/v1/' + path, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (_accessToken || SUPABASE_ANON_KEY) }
      }).then(r => r.ok ? r.json() : []).catch(() => []);
    }

    if (currentUser.role !== 'dj') {
      // Venue/host: show booking icon only if they have responses
      apiGet('bookings?select=id&requester_id=eq.' + currentUser.id + '&status=in.(counter,approved)')
        .then(data => { if (data && data.length > 0) document.getElementById('booking-requests-btn').style.display = 'inline-flex'; });
    }

    async function refreshInboxBadge() {
      try {
        const top = await apiGet('messages?select=id&to_user_id=eq.' + currentUser.id + '&from_user_id=neq.' + currentUser.id + '&read=eq.false&parent_id=is.null');
        const reps = await apiGet('messages?select=id&to_user_id=eq.' + currentUser.id + '&from_user_id=neq.' + currentUser.id + '&read=eq.false&parent_id=not.is.null');
        const count = ((top || []).length) + ((reps || []).length);
        const badge = document.getElementById('inbox-badge');
        if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.style.display = 'flex'; }
        else { badge.style.display = 'none'; }
      } catch(e) {}
    }
    refreshInboxBadge();
    setInterval(refreshInboxBadge, 30000);

    async function refreshBookingBadge() {
      try {
        let count = 0;
        if (currentUser.role === 'dj') {
          const data = await apiGet('bookings?select=id&dj_id=eq.' + currentUser.id + '&status=eq.pending');
          count += (data||[]).length;
        }
        const countered = await apiGet('bookings?select=id&requester_id=eq.' + currentUser.id + '&status=eq.counter');
        count += (countered||[]).length;
        const badge = document.getElementById('booking-requests-badge');
        if (badge && count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.style.display = 'flex'; }
        else if (badge) badge.style.display = 'none';
        const btn = document.getElementById('booking-requests-btn');
        if (btn && count > 0) btn.style.display = 'inline-flex';
      } catch(e) {}
    }
    refreshBookingBadge();
    setInterval(refreshBookingBadge, 30000);

    async function refreshDraftsBadge() {
      try {
        const data = await apiGet('booking_drafts?select=id&requester_id=eq.' + currentUser.id);
        const count = (data||[]).length;
        const btn = document.getElementById('drafts-btn');
        const badge = document.getElementById('drafts-badge');
        if (btn) btn.style.display = count > 0 ? 'inline-flex' : 'none';
        if (badge && count > 0) { badge.textContent = count; badge.style.display = 'flex'; }
        else if (badge) badge.style.display = 'none';
      } catch(e) {}
    }
    refreshDraftsBadge();
    setInterval(refreshDraftsBadge, 60000);
  } else {
    // Logged out — show sign in btn + mobile menu
    var si = document.getElementById('signin-btn'); if (si) { si.style.setProperty('display','inline-flex','important'); si.style.fontSize = '.58rem'; si.style.padding = '.45rem .7rem'; }
    var lo = document.getElementById('mobile-menu-loggedout'); if (lo) lo.style.display = 'block';
  }
})();

