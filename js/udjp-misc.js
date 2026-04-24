// MISC: loadBookingSettings, blocked users, confirm modal, deferred loaders
// Extracted from update-dj-profile.html

// ── LOAD BOOKING SETTINGS ─────────────────────────────────
async function loadBookingSettings() {
  const { data } = await db.from('users').select('booking_settings,dj_type,event_types').eq('id', currentUser.id).single();
  if (!data) return;
  const isClub = data.dj_type === 'club';
  const isMobile = data.dj_type === 'mobile';
  // Show booking tab
  if (isClub || isMobile) {
    document.getElementById('tab-btn-booking').style.display = '';
  }
  // Show correct section
  if (isClub) {
    document.getElementById('club-booking-section').style.display = 'block';
  }
  if (isMobile) {
    document.getElementById('mobile-booking-section').style.display = 'block';
    // Load mobile event types for package tabs
    if (data.event_types) mobSelectedTypes = data.event_types.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (!data.booking_settings) {
    document.getElementById('booking-setup').style.display = 'none';
    const cs = document.getElementById('cal-section');
    if (cs) cs.style.display = 'none';
    return;
  }
  try {
    const s = typeof data.booking_settings === 'string' ? JSON.parse(data.booking_settings) : data.booking_settings;
    if (isClub) {
      if (s.equip_full) { document.getElementById('equip-full').checked = true; updateRateFields('equip-full'); }
      if (s.equip_full_detail) document.getElementById('equip-full-detail').value = s.equip_full_detail;
      if (s.equip_decks) { document.getElementById('equip-decks').checked = true; updateRateFields('equip-decks'); }
      if (s.equip_decks_detail) document.getElementById('equip-decks-detail').value = s.equip_decks_detail;
      if (s.equip_none) { document.getElementById('equip-none').checked = true; updateRateFields('equip-none'); }
      if (s.rate_no_equip) document.getElementById('rate-no-equip-val').value = s.rate_no_equip;
      if (s.rate_with_system) document.getElementById('rate-with-system-val').value = s.rate_with_system;
      if (s.rate_with_decks) document.getElementById('rate-with-decks-val').value = s.rate_with_decks;
      if (s.global_rate_type) setGlobalRateType(s.global_rate_type);
      else if (s.allow_offers) setGlobalRateType('offers');
      if (s.base_rate && document.getElementById('base-rate-val')) document.getElementById('base-rate-val').value = s.base_rate;
      if (s.currency) { document.getElementById('rate-currency').value = s.currency; updateCurrencySymbols(); }
      if (s.booking_days) bookingDays = s.booking_days;
      if (s.booking_window_months) {
        const sel = document.getElementById('booking-window-select');
        if (sel) sel.value = String(s.booking_window_months);
      }
      updateRateFields();
    }
    if (isMobile) {
      if (s.mob_booking_window) { const sel = document.getElementById('mob-booking-window'); if (sel) sel.value = String(s.mob_booking_window); }
      if (s.mob_bookings_per_day) { const el = document.getElementById('mob-bookings-per-day'); if (el) el.value = s.mob_bookings_per_day; }
      if (s.mob_deposit_pct != null) { const el = document.getElementById('mob-deposit-pct'); if (el) el.value = String(s.mob_deposit_pct); }
      if (s.mob_booking_days) mobBookingDays = s.mob_booking_days;
      if (s.mob_packages) mobPackages = s.mob_packages;
    }
    // Set UI toggle state directly — no save triggered
    const enabled = !!s.booking_enabled;
    document.getElementById('booking-enabled').checked = enabled;
    const track = document.getElementById('booking-toggle-track');
    const thumb = document.getElementById('booking-toggle-thumb');
    track.style.background = enabled ? 'var(--neon)' : 'var(--border)';
    thumb.style.background = enabled ? 'var(--black)' : 'var(--muted)';
    thumb.style.transform = enabled ? 'translateX(20px)' : 'translateX(0)';
    document.getElementById('booking-setup').style.display = enabled ? 'block' : 'none';
    const cs = document.getElementById('cal-section');
    if (cs) cs.style.display = (enabled && isClub) ? '' : 'none';
    if (enabled && isClub) renderCal();
    if (enabled && isMobile) { renderMobCal(); renderMobPackageTabs(); }
  } catch(e) { console.error('Error loading booking settings:', e); }
}

// Both loaders need currentUser populated. Defer them until GDJAuth resolves
// (auth.js sets currentUser via the awaited block above, but these were running
// at module-load time before that ever completed — causing null.id crashes
// AND making the booking-enabled toggle appear unchecked on reload because
// loadBookingSettings silently failed).
(async function deferredLoaders() {
  if (typeof GDJAuth !== 'undefined' && GDJAuth.waitUntilReady) {
    const cu = await GDJAuth.waitUntilReady();
    if (cu && !currentUser) currentUser = cu;
  }
  if (!currentUser || !currentUser.id) return;
  try { await loadBookingSettings(); formDirty = false; } catch(e) { console.error('loadBookingSettings:', e); }
  try { await loadBlockedUsers(); } catch(e) { console.error('loadBlockedUsers:', e); }
})();

async function loadBlockedUsers() {
  const { data } = await db.from('users').select('blocked_users').eq('id', currentUser.id).single();
  const blockedIds = data?.blocked_users || [];
  if (!blockedIds.length) return;
  const { data: users } = await db.from('users').select('id,name').in('id', blockedIds);
  if (!users || !users.length) return;
  const section = document.getElementById('blocked-users-section');
  const list = document.getElementById('blocked-users-list');
  section.style.display = 'block';
  list.innerHTML = users.map(u => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem .85rem;background:var(--deep);border:1px solid var(--border);border-radius:8px;margin-bottom:.5rem;">
      <span style="font-size:.88rem;color:var(--white);">${u.name || 'Unknown User'}</span>
      <button onclick="unblockUser('${u.id}')" style="font-family:'Space Mono',monospace;font-size:.55rem;letter-spacing:.06em;text-transform:uppercase;background:transparent;border:1px solid var(--border);color:var(--muted);padding:.3rem .65rem;border-radius:5px;cursor:pointer;" onmouseover="this.style.borderColor='var(--neon)';this.style.color='var(--neon)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">Unblock</button>
    </div>`).join('');
}

async function unblockUser(userId) {
  const { data } = await db.from('users').select('blocked_users').eq('id', currentUser.id).single();
  const updated = (data?.blocked_users || []).filter(id => id !== userId);
  await updateUserRow({ blocked_users: updated });
  loadBlockedUsers();
  if (updated.length === 0) document.getElementById('blocked-users-section').style.display = 'none';
}

let _confirmCallback = null;
function showConfirm(message, okLabel, okStyle, callback) {
  document.getElementById('confirm-message').textContent = message;
  const okBtn = document.getElementById('confirm-ok-btn');
  okBtn.textContent = okLabel || 'Confirm';
  okBtn.className = 'btn ' + (okStyle || 'btn-primary');
  okBtn.setAttribute('style', 'flex:1;');
  _confirmCallback = callback;
  document.getElementById('confirm-modal').style.display = 'flex';
}
function closeConfirm() { document.getElementById('confirm-modal').style.display = 'none'; _confirmCallback = null; }
function confirmOk() { const cb = _confirmCallback; closeConfirm(); if (cb) cb(); }

