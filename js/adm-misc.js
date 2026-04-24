// MISC: loadStats, logout, init
// Extracted from admin.html

async function loadStats() {
  const [djs, hosts, venues] = await Promise.all([
    apiGet('users?select=id&role=eq.dj'),
    apiGet('users?select=id&role=eq.host'),
    apiGet('users?select=id&role=eq.venue')
  ]);
  document.getElementById('stat-djs').textContent = (djs || []).length;
  document.getElementById('stat-hosts').textContent = (hosts || []).length;
  document.getElementById('stat-venues').textContent = (venues || []).length;

  // Pending claims (admin endpoint)
  const claims = await adminGetClaims('pending');
  const n = (claims || []).length;
  document.getElementById('stat-claims').textContent = n;
  const card = document.getElementById('stat-claims-card');
  if (n > 0) card.classList.add('alert'); else card.classList.remove('alert');
  const pill = document.getElementById('claims-pill');
  if (pill) {
    pill.textContent = n;
    pill.style.display = n > 0 ? 'inline-block' : 'none';
  }
}

function logout() {
  sessionStorage.removeItem('adminUser');
  sessionStorage.removeItem('adminApiKey');
  window.location.href = '/';
}

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════
loadStats();

