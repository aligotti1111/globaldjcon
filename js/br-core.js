// CORE: Supabase init, state vars, label maps, IIFE bootstrap, badges, switchTab, formatters
// Extracted from booking-requests.html

const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3cXZ6dXVzcXVydWh3Z3Vxb2xlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjkxNjUsImV4cCI6MjA4NzE0NTE2NX0.TKoNk-u5bEKgVy-pXRrCYv8Iui8SzIa5ExiVUyEJ6UE';
const db = window.db || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
// currentUser may be null at script-parse time — auth.js hydrates sessionStorage
// asynchronously after a Supabase Auth session loads. Use `let` and re-read
// after GDJAuth.requireLogin() resolves before redirecting.
let currentUser = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || 'null');

let activeCounterBookingId = null;
let activeMsgBookingId = null;
let activeMsgUserId = null;
let incomingBookings = [];
let outgoingBookings = [];
let pkgEditOriginalItems = []; // original <li> text items for diffing
let pkgEditCurrentHtml = ''; // current package_details HTML (with any amber spans)

// Club/Bar DJ check (recomputed after auth resolves)
let isClubBarDJ = currentUser && currentUser.role === 'dj' && currentUser.dj_type !== 'mobile';

const equipLabels = {sound_system:'Full Sound System & Decks',decks_only:'Decks/Controller Only',venue_provides:'Venue Provides All Equipment'};
const setTypeLabels = {opening:'Opening Set',headliner:'Headliner',closing:'Closing Set',opening_close:'Opening – Close',opening_and_closing:'Opening & Closing Set'};
const currencySymbols = {USD:'$',EUR:'€',GBP:'£',CAD:'CA$',AUD:'A$',JPY:'¥',MXN:'MX$',BRL:'R$',CHF:'Fr',SEK:'kr',NOK:'kr',DKK:'kr',NZD:'NZ$',SGD:'S$',ZAR:'R',AED:'د.إ',INR:'₹'};

// Nav visibility handled by GDJAuth.renderNav() in auth.js.

(function(){
  function bootstrap() {
    // Re-read sessionStorage now that auth.js has had a chance to hydrate it
    if (!currentUser) {
      currentUser = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || 'null');
    }
    if (!currentUser && window.GDJAuth && window.GDJAuth.user) {
      currentUser = window.GDJAuth.user();
    }
    if (!currentUser) {
      window.location.href = '/login.html?return=' + encodeURIComponent(window.location.pathname + window.location.search);
      return;
    }
    isClubBarDJ = currentUser.role === 'dj' && currentUser.dj_type !== 'mobile';
    if (isClubBarDJ) {
      document.getElementById('incoming-section').style.display = 'block';
    }
    loadInboxBadge();
    loadBookingBadge();
    // Trigger the page's main data load now that we have a confirmed user
    if (typeof loadAllBookings === 'function') loadAllBookings();
  }
  if (window.GDJAuth) {
    GDJAuth.ready(bootstrap);
  } else {
    // auth.js not loaded — fall back to legacy behavior
    document.addEventListener('DOMContentLoaded', bootstrap);
  }
})();

async function loadBookingBadge() {
  try {
    // Incoming pending (DJ receiving requests)
    let incoming = 0;
    if (currentUser.role === 'dj') {
      const { data } = await db.from('bookings').select('id').eq('dj_id', currentUser.id).eq('status', 'pending');
      incoming = (data||[]).length;
    }
    // Outgoing countered (anyone who made a booking and got a counter back)
    const { data: countered } = await db.from('bookings').select('id').eq('requester_id', currentUser.id).eq('status', 'counter');
    const count = incoming + (countered||[]).length;
    const badge = document.getElementById('nav-booking-count');
    if (badge && count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.style.display = 'flex'; }
  } catch(e) {}
}

function navLogout(){ sessionStorage.removeItem('currentUser'); localStorage.removeItem('currentUser'); window.location.href = '/login.html'; }

async function loadInboxBadge(){
  try{
    const {data:t} = await db.from('messages').select('id').eq('to_user_id',currentUser.id).eq('read',false).is('parent_id',null);
    const {data:r} = await db.from('messages').select('id').eq('to_user_id',currentUser.id).eq('read',false).not('parent_id','is',null);
    const count = ((t||[]).length)+((r||[]).length);
    const badge = document.getElementById('nav-unread-count');
    if(badge && count>0){badge.textContent=count>99?'99+':count;badge.style.display='flex';}
  }catch(e){}
}

// group: 'in' or 'out', filter: 'pending'|'approved'|'denied'|'all'
function switchTab(group, filter, btn) {
  const section = group === 'in' ? 'incoming' : 'outgoing';
  // Deactivate tabs within this group only
  document.querySelectorAll(`#${section}-section .tab-btn`).forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`#${section}-section .tab-pane`).forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`${group}-tab-pane-${filter}`).classList.add('active');
  renderList(group, filter);
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {weekday:'short',month:'short',day:'numeric',year:'numeric'});
}
function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const p = h < 12 ? 'AM' : 'PM';
  return (h % 12 || 12) + ':' + String(m).padStart(2,'0') + ' ' + p;
}

let blockedUsers = [];
let djZip = null;

