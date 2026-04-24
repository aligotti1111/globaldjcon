// TYPE SELECT: account type (DJ/host/venue) + DJ subtype + travel error helper
// Extracted from signup.html

function selectAccountType(type) {
  currentAccountType = type;
  document.getElementById('step-type').style.display = 'none';
  document.getElementById('alert').innerHTML = '';
  document.querySelectorAll('.acct-form').forEach(f => f.style.display = 'none');
  document.getElementById('form-' + type).style.display = 'block';
}

function backToTypeSelect() {
  document.querySelectorAll('.acct-form').forEach(f => f.style.display = 'none');
  document.getElementById('step-type').style.display = 'block';
  document.getElementById('alert').innerHTML = '';
  currentAccountType = null;
}

// ── DJ TYPE TOGGLE BUTTONS ──────────────────────────────
function selectDjType(value) {
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('selected'));
  const btn = document.querySelector(`.type-btn[data-value="${value}"]`);
  if (btn) btn.classList.add('selected');
  const label = document.getElementById('name-label');
  const input = document.getElementById('name');
  if (value === 'mobile') {
    if (label) label.textContent = 'Company Name';
    if (input) input.placeholder = 'Premier Events LLC';
  } else if (value === 'club') {
    if (label) label.textContent = 'DJ Name';
    if (input) input.placeholder = 'DJ Nova';
  } else {
    if (label) label.textContent = 'DJ / Company Name';
    if (input) input.placeholder = 'DJ Nova or Premier Events LLC';
  }
}

// Hide travel-distance error and clear red border once a value is picked
function clearTravelError() {
  const errEl = document.getElementById('dj-travel-error');
  const selEl = document.getElementById('dj-travel');
  if (errEl) errEl.style.display = 'none';
  if (selEl) selEl.style.borderColor = '';
}

