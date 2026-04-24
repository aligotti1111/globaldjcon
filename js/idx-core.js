// CORE: Supabase, loadDJs/saveDJs, login/logout, slug helpers, label/icon helpers
// Extracted from index.html

// ═══════════════════════════════════════════════════════
// SUPABASE CONFIGURATION
// ═══════════════════════════════════════════════════════
// Ensure db exists even if auth.js hasn't loaded/run yet.
if (!window.db && window.supabase && window.supabase.createClient) {
  window.db = window.supabase.createClient(
    'https://hwqvzuusquruhwguqole.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3cXZ6dXVzcXVydWh3Z3Vxb2xlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjkxNjUsImV4cCI6MjA4NzE0NTE2NX0.TKoNk-u5bEKgVy-pXRrCYv8Iui8SzIa5ExiVUyEJ6UE',
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit'
      }
    }
  );
}
const db = window.db;

// Clean up URL hash after login redirect (Supabase appends tokens there).
// We wait briefly for the SDK to process them, then remove from the URL.
if (window.location.hash && window.location.hash.includes('access_token')) {
  setTimeout(() => {
    try {
      history.replaceState(null, document.title, window.location.pathname + window.location.search);
    } catch(e) {}
  }, 500);
}

// ─── CONFIG ───────────────────────────────────────────
const ADMIN_PASSWORD = 'spinlist2025';
const STORE_KEY = 'spinlist_djs_v1';

// ─── DATA ─────────────────────────────────────────────
// Using raw fetch because the Supabase SDK sometimes hangs in this environment
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3cXZ6dXVzcXVydWh3Z3Vxb2xlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjkxNjUsImV4cCI6MjA4NzE0NTE2NX0.TKoNk-u5bEKgVy-pXRrCYv8Iui8SzIa5ExiVUyEJ6UE';

async function loadDJs(){
  try {
    const res = await fetch(
      'https://hwqvzuusquruhwguqole.supabase.co/rest/v1/users?select=*&role=eq.dj&order=name.asc',
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } }
    );
    if (!res.ok) {
      console.error('loadDJs HTTP error:', res.status);
      return [];
    }
    const data = await res.json();
    // Filter out profile_private=true on the client (keep the query simple)
    const visible = (data || []).filter(d => d.profile_private !== true);
    // Transform Supabase data to match our format
    return visible.map(dj => ({
      id: dj.id,
      slug: dj.slug,
      name: dj.name,
      dj_type: dj.dj_type,
      country: dj.country,
      state: dj.state,
      city: dj.city,
      zip: dj.zip,
      rate: dj.rate,
      rating: dj.rating || 0,
      avail: dj.availability || 'available',
      phone: dj.phone,
      email: null,
      website: dj.website,
      instagram: dj.instagram,
      tiktok: dj.tiktok,
      facebook: dj.facebook,
      soundcloud: dj.soundcloud,
      bio: dj.bio,
      avatar_url: dj.avatar_url,
      travel_distance: dj.travel_distance,
      event_specialization: dj.event_specialization,
      club_genres: dj.club_genres
    }));
  } catch (err) {
    console.error('loadDJs failed:', err);
    return [];
  }
}

async function saveDJs(djList){ 
  // For admin panel - bulk operations are handled individually
  console.log('Saved', djList.length, 'DJs to Supabase');
}

let DJS = [];

// ─── NAVIGATION ───────────────────────────────────────
function goTo(view){
  // Check auth for admin panel
  if(view === 'admin') {
    const isAdmin = sessionStorage.getItem('adminUser') === '1';
    if (!isAdmin) {
      alert('Please sign in with admin credentials to access the admin panel.');
      window.location.href = 'login.html';
      return;
    }
  }
  
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+view).classList.add('active');
  if(view==='public') renderPublic(false);
  if(view==='admin'){ DJS=loadDJs(); renderAdmin(); }
}
function goToLogin(){
  window.location.href = 'login.html';
}

function doLogin(){
  window.location.href = 'login.html';
}
function logout(){
  // Clear Supabase session from localStorage directly (the SDK's signOut hangs)
  try {
    const authKey = 'sb-hwqvzuusquruhwguqole-auth-token';
    const raw = localStorage.getItem(authKey);
    let token = '';
    if (raw) {
      try {
        const s = JSON.parse(raw);
        token = (s && s.access_token) || (s && s.currentSession && s.currentSession.access_token) || '';
      } catch(e) {}
    }
    // Fire-and-forget server-side logout (revokes refresh token)
    if (token) {
      fetch('https://hwqvzuusquruhwguqole.supabase.co/auth/v1/logout', {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
      }).catch(() => {});
    }
    // Clear local session state
    localStorage.removeItem(authKey);
    sessionStorage.removeItem('currentUser');
    localStorage.removeItem('currentUser');
    sessionStorage.removeItem('adminUser');
  } catch(e) {}
  window.location.href = '/';
}


// ─── HELPERS ──────────────────────────────────────────
function djSlug(dj){
  if(dj.slug) return dj.slug;
  return (dj.name||'').toLowerCase().trim().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'') || dj.id;
}
function djProfileURL(slug) {
  const isLocal = window.location.hostname === 'localhost' || window.location.protocol === 'file:';
  return isLocal ? 'dj-profile.html?dj='+slug : '/'+slug;
}
function initials(n){ return (n||'?').replace(/^DJ\s+/i,'').split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase()||'DJ'; }
function avatarStyle(t){ return t==='club'?'background:linear-gradient(135deg,#1a1a07,#2d2d0d);color:var(--pink);':'background:linear-gradient(135deg,#071a14,#0d2a1e);color:var(--neon);'; }
function starsHTML(r){ let h='<div class="rating-stars">'; for(let i=1;i<=5;i++) h+=`<svg class="star${i>r?' empty':''}" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`; return h+'</div>'; }
function availHTML(a){ return a==='available'?'<span class="dot"></span> Available':a==='busy'?'<span class="dot busy"></span> Booked':'<span class="dot offline"></span> Offline'; }
const IC={
  phone:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .84h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>`,
  email:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
  globe:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>`,
  ig:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>`,
  sc:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18a3 3 0 010-6c0-.17.01-.34.04-.5A5 5 0 0113 9a3 3 0 016 0h1a3 3 0 010 6H3z"/></svg>`,
};

