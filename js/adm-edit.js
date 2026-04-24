// EDIT: quickVerify, openEditModal, saveEdit, role/type updates
// Extracted from admin.html

// click an email confirmation link. Used when a user can't access their email
// or for trusted accounts created manually.
async function quickVerify(id, name) {
  if (!confirm(`Mark ${name} as email-verified?\n\nThis bypasses the email confirmation step. Use only when you've confirmed the account belongs to a real person.`)) return;
  try {
    const result = await adminPost('admin-update-user', { user_id: id, updates: { email_verified: true } });
    if (result.user && userCache[id]) userCache[id] = result.user;
    // Update local cache so re-render reflects new state without a full refetch
    const active = document.querySelector('.tab-btn.active').dataset.tab;
    if (['djs','hosts','venues'].includes(active)) {
      const role = active.slice(0, -1);
      const list = listCache[role] || [];
      const row = list.find(u => u.id === id);
      if (row) row.email_verified = true;
      renderUserList(role);
    }
  } catch (err) {
    alert('✗ ' + (err.message || 'Verify failed'));
  }
}

// ═══════════════════════════════════════════════════════════════════
// EDIT USER MODAL
// ═══════════════════════════════════════════════════════════════════
function openEditModal(userId) {
  const u = userCache[userId];
  if (!u) {
    alert('User data not found in cache. Try refreshing the tab.');
    return;
  }

  document.getElementById('edit-user-id').value = u.id;
  document.getElementById('edit-sub').textContent = (u.name || u.venue_name || 'Account') + ' • ' + (u.role || '').toUpperCase();

  // Email lives on auth.users — fetch via admin endpoint
  const emailInput = document.getElementById('edit-email');
  const emailHint = document.getElementById('edit-email-hint');
  emailInput.value = '';
  emailInput.placeholder = 'Loading...';
  emailInput.disabled = true;
  emailInput.dataset.original = '';
  if (emailHint) { emailHint.textContent = 'New email is auto-confirmed; no verification email sent to user.'; emailHint.style.color = ''; }
  adminPost('admin-get-user-email', { user_id: u.id }).then(r => {
    const e = (r && r.email) || '';
    emailInput.value = e;
    emailInput.placeholder = 'No email on file';
    emailInput.dataset.original = e;
    emailInput.disabled = false;
  }).catch(err => {
    emailInput.placeholder = 'Could not load email';
    emailInput.disabled = false;
    if (emailHint) { emailHint.textContent = 'Lookup error: ' + (err.message || 'failed'); emailHint.style.color = 'var(--error,#ff5f5f)'; }
  });

  // Identity
  setVal('edit-name', u.name);
  setVal('edit-venue-name', u.venue_name);
  setVal('edit-slug', u.slug);
  setVal('edit-role', u.role || 'dj');
  setVal('edit-type', u.dj_type || '');

  // Location
  setVal('edit-country', u.country);
  setVal('edit-state', u.state);
  setVal('edit-city', u.city);
  setVal('edit-zip', u.zip);
  setVal('edit-address', u.address);
  setVal('edit-travel-distance', u.travel_distance || '');

  // Bio
  setVal('edit-bio', u.bio);

  // Contact
  ['phone','website','instagram','soundcloud','tiktok','facebook','twitch'].forEach(k => setVal('edit-' + k, u[k]));

  // Flags
  document.getElementById('edit-claimed').checked = u.claimed !== false;
  document.getElementById('edit-private').checked = u.profile_private === true;
  document.getElementById('edit-email-verified').checked = u.email_verified === true;

  // Adjust visible groups based on role
  updateEditRole();

  // Reset feedback
  document.getElementById('edit-fb').textContent = '';
  document.getElementById('edit-fb').className = 'form-fb';
  document.getElementById('edit-slug-preview').textContent = u.slug || 'slug';

  document.getElementById('edit-modal').style.display = 'flex';
}

function setVal(id, v) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = (v === null || v === undefined) ? '' : v;
}

function updateEditRole() {
  const role = document.getElementById('edit-role').value;
  document.getElementById('edit-group-venue-name').style.display = role === 'venue' ? 'flex' : 'none';
  document.getElementById('edit-group-address').style.display = role === 'venue' ? 'flex' : 'none';
  document.getElementById('edit-group-type').style.display = role === 'dj' ? 'flex' : 'none';
  document.getElementById('edit-group-travel').style.display = role === 'dj' ? 'flex' : 'none';
}

// Live slug preview in edit modal
document.getElementById('edit-slug').addEventListener('input', (e) => {
  const s = (e.target.value || '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  document.getElementById('edit-slug-preview').textContent = s || 'slug';
});

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
}

async function saveEdit() {
  const btn = document.getElementById('edit-save-btn');
  const fb = document.getElementById('edit-fb');
  const userId = document.getElementById('edit-user-id').value;

  const updates = {
    name: document.getElementById('edit-name').value.trim() || null,
    venue_name: document.getElementById('edit-venue-name').value.trim() || null,
    slug: (document.getElementById('edit-slug').value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')) || null,
    role: document.getElementById('edit-role').value,
    dj_type: document.getElementById('edit-type').value || null,
    country: document.getElementById('edit-country').value.trim() || null,
    state: document.getElementById('edit-state').value.trim() || null,
    city: document.getElementById('edit-city').value.trim() || null,
    zip: document.getElementById('edit-zip').value.trim() || null,
    address: document.getElementById('edit-address').value.trim() || null,
    bio: document.getElementById('edit-bio').value.trim() || null,
    phone: document.getElementById('edit-phone').value.trim() || null,
    website: document.getElementById('edit-website').value.trim() || null,
    instagram: document.getElementById('edit-instagram').value.trim() || null,
    soundcloud: document.getElementById('edit-soundcloud').value.trim() || null,
    tiktok: document.getElementById('edit-tiktok').value.trim() || null,
    facebook: document.getElementById('edit-facebook').value.trim() || null,
    twitch: document.getElementById('edit-twitch').value.trim() || null,
    claimed: document.getElementById('edit-claimed').checked,
    profile_private: document.getElementById('edit-private').checked,
    email_verified: document.getElementById('edit-email-verified').checked
  };
  const td = document.getElementById('edit-travel-distance').value.trim();
  if (td !== '') updates.travel_distance = td === 'worldwide' ? 'worldwide' : (parseInt(td, 10) || null);

  // Include email only if it changed (auth.users update is more expensive + auditable)
  const emailEl = document.getElementById('edit-email');
  const newEmail = (emailEl.value || '').trim().toLowerCase();
  const origEmail = (emailEl.dataset.original || '').trim().toLowerCase();
  if (newEmail && newEmail !== origEmail) {
    updates.email = newEmail;
  }

  btn.disabled = true; btn.textContent = 'Saving...';
  fb.textContent = ''; fb.className = 'form-fb';

  try {
    const result = await adminPost('admin-update-user', { user_id: userId, updates });
    fb.textContent = '✓ Saved';
    fb.className = 'form-fb ok';
    // Update cache with new values
    if (result.user) userCache[userId] = result.user;
    // If email changed, update the email map so the list reflects it without a full refetch
    if (result.email_updated && result.email) {
      emailMap[userId] = result.email;
      // Bust the promise cache too, so next explicit reload re-fetches from source of truth
      emailMapPromise = null;
    }
    // Refresh the visible list
    setTimeout(() => {
      closeEditModal();
      const active = document.querySelector('.tab-btn.active').dataset.tab;
      if (['djs','hosts','venues'].includes(active)) loadUsers(active.slice(0, -1));
    }, 700);
  } catch (err) {
    fb.textContent = '✗ ' + (err.message || 'Save failed');
    fb.className = 'form-fb err';
  } finally {
    btn.disabled = false; btn.textContent = 'Save Changes';
  }
}

