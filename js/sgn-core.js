// CORE: Supabase init, currentAccountType, auth-redirect, alert observer
// Extracted from signup.html

const SUPABASE_URL = 'https://hwqvzuusquruhwguqole.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3cXZ6dXVzcXVydWh3Z3Vxb2xlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjkxNjUsImV4cCI6MjA4NzE0NTE2NX0.TKoNk-u5bEKgVy-pXRrCYv8Iui8SzIa5ExiVUyEJ6UE';
// Reuse the client created by auth.js (avoids "multiple GoTrueClient instances" bug)
const db = window.db || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const BASE_URL = 'globaldjconnect.com/';
let currentAccountType = null;

// Already-signed-in users shouldn't be on the signup page — bounce them home.
if (window.GDJAuth && window.GDJAuth.ready) {
  window.GDJAuth.ready(function(cu) {
    if (cu) window.location.replace('/');
  });
}

// Auto-dismiss toast alerts after 7 seconds (errors stay long enough to read but don't pile up)
(function setupAlertObserver() {
  const alertEl = document.getElementById('alert');
  if (!alertEl) return;
  let dismissTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(dismissTimer);
    if (alertEl.innerHTML.trim()) {
      dismissTimer = setTimeout(() => { alertEl.innerHTML = ''; }, 7000);
    }
  });
  observer.observe(alertEl, { childList: true, subtree: true });
})();

