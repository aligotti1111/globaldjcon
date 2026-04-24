// USERS: ensureEmailMap, loadUsers, renderUserList, viewUser, deleteUser
// Extracted from admin.html

// Per-role cache of full user list (for client-side filtering)
const listCache = { dj: [], host: [], venue: [] };
// Map of user_id -> email (populated by admin-list-emails)
let emailMap = {};
let emailMapPromise = null;

async function ensureEmailMap(force) {
  if (!force && emailMapPromise) return emailMapPromise;
  emailMapPromise = adminPost('admin-list-emails', {}).then(r => {
    emailMap = {};
    (r && r.users || []).forEach(u => { emailMap[u.id] = u.email || ''; });
    return emailMap;
  }).catch(err => {
    console.error('[admin] failed to load emails:', err);
    return {};
  });
  return emailMapPromise;
}

async function loadUsers(role) {
  const list = document.getElementById(role + '-list');
  list.innerHTML = '<div class="empty-admin">Loading...</div>';

  const [users] = await Promise.all([
    apiGet('users?select=*&role=eq.' + role + '&order=name'),
    ensureEmailMap()
  ]);

  // Cache by id so edit modal can populate without another fetch
  (users || []).forEach(u => { userCache[u.id] = u; });
  listCache[role] = users || [];

  document.getElementById(role + '-count').textContent =
    (users || []).length + ((users || []).length === 1 ? ' account' : ' accounts');

  renderUserList(role);
}

function renderUserList(role) {
  const list = document.getElementById(role + '-list');
  const users = listCache[role] || [];
  const q = (document.getElementById(role + '-search').value || '').trim().toLowerCase();

  let filtered = users;
  if (q) {
    filtered = users.filter(u => {
      const name = role === 'venue' ? (u.venue_name || u.name || '') : (u.name || '');
      const email = emailMap[u.id] || '';
      const slug = u.slug || '';
      return name.toLowerCase().includes(q)
        || email.toLowerCase().includes(q)
        || slug.toLowerCase().includes(q);
    });
  }

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-admin">${q ? 'No matches for "' + escapeHtml(q) + '"' : 'No ' + role + ' accounts yet.'}</div>`;
    return;
  }

  list.innerHTML = filtered.map(u => {
    const unclaimedBadge = !u.claimed ? '<span class="ar-type unclaimed">Unclaimed</span>' : '';
    const name = role === 'venue' ? (u.venue_name || u.name) : u.name;
    const loc = [u.city, u.state, u.country].filter(Boolean).join(', ');
    const email = emailMap[u.id] || '';
    const emailCell = email
      ? `<div class="ar-detail" style="color:var(--white);" title="${escapeHtml(email)}">${escapeHtml(email)}</div>`
      : `<div class="ar-detail" style="color:#6b6b88;font-style:italic;">no email</div>`;
    const verifyBtn = u.email_verified !== true
      ? `<button class="btn btn-outline" onclick="quickVerify('${u.id}','${escapeHtml(name || 'this user').replace(/'/g, "\\'")}')" style="padding:.4rem .8rem;font-size:.6rem;border-color:#ffb347;color:#ffb347;">Verify</button>`
      : '';
    return `<div class="admin-row">
      ${unclaimedBadge}
      <div class="ar-name">${escapeHtml(name || 'Unnamed')}</div>
      ${emailCell}
      <div class="ar-detail">${escapeHtml(loc || '—')}</div>
      <div class="ar-detail">${escapeHtml(u.slug || '—')}</div>
      <button class="btn btn-admin" onclick="openEditModal('${u.id}')" style="padding:.4rem .8rem;font-size:.6rem;">Edit</button>
      ${verifyBtn}
      <button class="btn btn-outline" onclick="viewUser('${u.slug}')" style="padding:.4rem .8rem;font-size:.6rem;">View</button>
      <button class="btn btn-danger" onclick="deleteUser('${u.id}','${escapeHtml(name || 'this user').replace(/'/g, "\\'")}')">Delete</button>
    </div>`;
  }).join('');
}

function filterList(role) {
  renderUserList(role);
}

// Force a full resync — drops the email cache and re-pulls both users + emails.
// Used by the per-tab "↻ Refresh" button and after email-changing admin actions.
async function refreshUsers(role) {
  emailMapPromise = null;
  await loadUsers(role);
}

function viewUser(slug) {
  if (!slug) return;
  window.open('/' + slug, '_blank');
}

async function deleteUser(id, name) {
  if (!confirm(`Permanently delete ${name}? This cannot be undone.`)) return;
  try {
    await adminPost('admin-delete-user', { user_id: id });
    alert('Account deleted.');
    // Refresh whichever tab we're on
    const active = document.querySelector('.tab-btn.active').dataset.tab;
    if (['djs','hosts','venues'].includes(active)) loadUsers(active.slice(0, -1));
    loadStats();
  } catch (err) {
    alert('✗ ' + (err.message || 'Delete failed'));
  }
}

