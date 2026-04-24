// TABS: switchTab + create-form state (setRole, setType, resetForm)
// Extracted from admin.html

// TABS
// ═══════════════════════════════════════════════════════════════════
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');

  if (tab === 'claims') loadClaims();
  if (tab === 'djs') loadUsers('dj');
  if (tab === 'hosts') loadUsers('host');
  if (tab === 'venues') loadUsers('venue');
}

// ═══════════════════════════════════════════════════════════════════
// CREATE ACCOUNT FORM
// ═══════════════════════════════════════════════════════════════════
let currentRole = 'dj';
let currentType = '';

function setRole(role) {
  currentRole = role;
  document.querySelectorAll('.role-opt').forEach(el => el.classList.remove('selected'));
  document.querySelector(`.role-opt[data-role="${role}"]`).classList.add('selected');

  document.getElementById('identity-label').textContent =
    role === 'dj' ? 'DJ Identity' : role === 'host' ? 'Host Info' : 'Venue Info';

  document.getElementById('group-venue-name').style.display = role === 'venue' ? 'flex' : 'none';
  document.getElementById('group-address').style.display = role === 'venue' ? 'flex' : 'none';
  document.getElementById('group-slug').style.display = role === 'host' ? 'none' : 'flex';
  document.getElementById('group-type').style.display = role === 'dj' ? 'flex' : 'none';
}

function setType(t) {
  currentType = t;
  document.getElementById('type-mobile').classList.remove('active-mobile');
  document.getElementById('type-club').classList.remove('active-club');
  if (t === 'mobile') document.getElementById('type-mobile').classList.add('active-mobile');
  if (t === 'club') document.getElementById('type-club').classList.add('active-club');
}

function resetForm() {
  document.querySelectorAll('.form-input, .form-select, .form-textarea').forEach(el => el.value = '');
  document.getElementById('zip-result').textContent = '';
  document.getElementById('slug-preview').textContent = 'dj-nova';
  setType('');
  document.getElementById('create-fb').textContent = '';
}

