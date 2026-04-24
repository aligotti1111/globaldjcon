// CLAIMS: loadClaims, approveClaim, rejectClaim
// Extracted from admin.html

// PENDING CLAIMS
// ═══════════════════════════════════════════════════════════════════
async function loadClaims() {
  const list = document.getElementById('claims-list');
  list.innerHTML = '<div class="empty-admin">Loading claims...</div>';

  const claims = await adminGetClaims('pending');
  if (!claims || claims.length === 0) {
    list.innerHTML = '<div class="empty-admin">No pending claims right now.</div>';
    return;
  }

  list.innerHTML = claims.map(c => {
    const profileUrl = c.target_slug ? 'https://globaldjconnect.com/' + c.target_slug : '';
    const submitted = new Date(c.created_at).toLocaleString();
    return `<div class="claim-card pending" id="claim-${c.id}">
      <div class="claim-head">
        <div class="claim-title">${escapeHtml(c.target_biz_name)}</div>
        <div class="claim-status pending">Pending</div>
      </div>
      <div class="claim-row"><div class="label">Submitted</div><div class="value">${submitted}</div></div>
      <div class="claim-row"><div class="label">Claimant</div><div class="value">${escapeHtml(c.claimant_name)}</div></div>
      <div class="claim-row"><div class="label">Their Email</div><div class="value"><a href="mailto:${c.claimant_email}">${escapeHtml(c.claimant_email)}</a></div></div>
      ${profileUrl ? `<div class="claim-row"><div class="label">Profile</div><div class="value"><a href="${profileUrl}" target="_blank">${profileUrl}</a></div></div>` : ''}
      ${c.target_user_id ? '' : '<div class="claim-row"><div class="label">⚠ Warning</div><div class="value" style="color:var(--error);">No target user ID — may have been deleted or never existed. Approval will fail.</div></div>'}
      <div class="claim-row"><div class="label">Verification</div><div class="value" style="white-space:pre-wrap;">${escapeHtml(c.verify_msg || 'None provided')}</div></div>
      <div class="claim-actions">
        <button class="btn btn-success" onclick="approveClaim('${c.id}')" ${c.target_user_id ? '' : 'disabled style="opacity:.4;cursor:not-allowed;"'}>✓ Approve</button>
        <button class="btn btn-danger" onclick="rejectClaim('${c.id}')">✗ Reject</button>
      </div>
    </div>`;
  }).join('');
}

async function approveClaim(claimId) {
  const notes = prompt('Optional notes about this approval (leave blank if none):') || '';
  if (!confirm('Approve this claim? The user\'s email will be swapped and they\'ll receive a set-password email.')) return;

  const card = document.getElementById('claim-' + claimId);
  const btns = card.querySelectorAll('button'); btns.forEach(b => b.disabled = true);

  try {
    const result = await adminPost('admin-approve-claim', { claim_id: claimId, reviewed_notes: notes });
    alert('✓ ' + (result.message || 'Claim approved'));
    // Bust the email-map cache so the approved DJ's new email shows up
    emailMapPromise = null;
    loadClaims();
    loadStats();
    // If the DJs tab is currently open, reload it with fresh email data
    const active = document.querySelector('.tab-btn.active');
    if (active && ['djs','hosts','venues'].includes(active.dataset.tab)) {
      loadUsers(active.dataset.tab.slice(0, -1));
    }
  } catch (err) {
    alert('✗ ' + (err.message || 'Approval failed'));
    btns.forEach(b => b.disabled = false);
  }
}

async function rejectClaim(claimId) {
  const reason = prompt('Reason for rejection (required):');
  if (!reason) return;
  if (!confirm('Reject this claim?')) return;

  try {
    await adminPost('admin-reject-claim', { claim_id: claimId, reviewed_notes: reason });
    alert('✗ Claim rejected');
    loadClaims();
    loadStats();
  } catch (err) {
    alert('✗ ' + (err.message || 'Reject failed'));
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

