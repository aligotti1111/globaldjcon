// CLUB BOOKING: settings UI, calendar, day editor, rate fields
// Extracted from update-dj-profile.html

// ── BOOKING FEATURE (CLUB/BAR DJ) ─────────────────────────

// Show booking tab for all DJs
function updateNameLabel() {
  const label = document.getElementById('name-label');
  const input = document.getElementById('name');
  if (userDjType === 'mobile') {
    if (label) label.textContent = 'Company Name';
    if (input) input.placeholder = 'Premier Events LLC';
  } else if (userDjType === 'club') {
    if (label) label.textContent = 'DJ Name';
    if (input) input.placeholder = 'DJ Nova';
  } else {
    if (label) label.textContent = 'DJ / Company Name';
    if (input) input.placeholder = 'e.g. DJ Nova';
  }
}

function checkShowBookingTab() {
  const isClub = userDjType === 'club';
  const isMobile = userDjType === 'mobile';
  // Booking tab always visible for now (until subscription is added)
  document.getElementById('tab-btn-booking').style.display = '';
  document.getElementById('club-booking-section').style.display = isClub ? 'block' : 'none';
  document.getElementById('mobile-booking-section').style.display = isMobile ? 'block' : 'none';
  const calSection = document.getElementById('cal-section');
  if (calSection) calSection.style.display = isClub ? 'block' : 'none';
  if (isClub) updateRateFields(null);
  if (isMobile) renderMobPackageTabs(true);
}

// Toggle booking setup visibility
function toggleBookingSetup(userInitiated) {
  const checkbox = document.getElementById('booking-enabled');
  const enabled = checkbox.checked;
  const isClub = userDjType === 'club';

  // Club DJs: warn when activating for first time
  if (enabled && userInitiated && isClub) {
    checkbox.checked = false; // revert until confirmed
    showBookingActivateModal();
    return;
  }

  // Confirm when user actively clicks to turn OFF
  if (!enabled && userInitiated) {
    showConfirm(
      'Are you sure you want to deactivate the booking feature? Your settings will be saved and can be reactivated at any time.',
      'Deactivate',
      'btn-danger',
      () => _doToggleBooking(false)
    );
    checkbox.checked = true;
    return;
  }
  _doToggleBooking(enabled);
}

function showBookingActivateModal() {
  const existing = document.getElementById('booking-activate-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'booking-activate-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:1.5rem;';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.75rem;width:100%;max-width:420px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:.05em;color:var(--white);margin-bottom:.75rem;">Activate Booking?</div>
      <p style="font-size:.85rem;color:var(--muted);line-height:1.7;margin-bottom:1rem;">Activating booking will allow venues to send you booking requests for the dates you've made available.</p>

      <div style="display:flex;gap:.75rem;">
        <button type="button" onclick="document.getElementById('booking-activate-modal').remove()" style="flex:1;padding:.75rem;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--muted);font-family:'Space Mono',monospace;font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;">Cancel</button>
        <button type="button" onclick="confirmActivateBooking()" style="flex:1;padding:.75rem;background:var(--neon);border:none;border-radius:6px;color:var(--black);font-family:'Space Mono',monospace;font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;">Continue</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function confirmActivateBooking() {
  document.getElementById('booking-activate-modal').remove();
  document.getElementById('booking-enabled').checked = true;
  _doToggleBooking(true);
}

function _doToggleBooking(enabled, skipSave) {
  const checkbox = document.getElementById('booking-enabled');
  checkbox.checked = enabled;
  const track = document.getElementById('booking-toggle-track');
  const thumb = document.getElementById('booking-toggle-thumb');
  document.getElementById('booking-setup').style.display = enabled ? 'block' : 'none';
  const calSection = document.getElementById('cal-section');
  const isClub = userDjType === 'club';
  const isMobile = userDjType === 'mobile';
  if (calSection) calSection.style.display = (enabled && isClub) ? '' : 'none';
  track.style.background = enabled ? 'var(--neon)' : 'var(--border)';
  thumb.style.background = enabled ? 'var(--black)' : 'var(--muted)';
  thumb.style.transform = enabled ? 'translateX(20px)' : 'translateX(0)';
  if (enabled && isClub) renderCal();
  if (enabled && isMobile) {
    renderMobCal(); renderMobPackageTabs();
  }
  if (skipSave) return;
  // Save only booking_enabled — all other settings untouched.
  // After saving, re-read the row to verify the value actually persisted.
  // (If a parallel write races, the toggle could appear to "succeed" then
  // silently disappear on the next page load. The verify catches that.)
  (async () => {
    const alertEl = document.getElementById('booking-alert');
    try {
      const { data: current } = await db.from('users').select('booking_settings').eq('id', currentUser.id).single();
      const bs = current && current.booking_settings ? (typeof current.booking_settings === 'string' ? JSON.parse(current.booking_settings) : current.booking_settings) : {};
      bs.booking_enabled = enabled;
      const _ur = await updateUserRow({ booking_settings: JSON.stringify(bs) });
      if (!_ur.ok) throw new Error(_ur.error || 'Save failed');

      // Verify by re-reading the row from the DB
      const { data: verify } = await db.from('users').select('booking_settings').eq('id', currentUser.id).single();
      const verifyBs = verify && verify.booking_settings ? (typeof verify.booking_settings === 'string' ? JSON.parse(verify.booking_settings) : verify.booking_settings) : {};
      if (verifyBs.booking_enabled !== enabled) {
        console.error('[booking] save verification FAILED — wrote', enabled, 'but DB shows', verifyBs.booking_enabled, 'full row:', verifyBs);
        if (alertEl) alertEl.innerHTML = `<div class="alert alert-error">✗ Save did not persist. Please try again or contact support. (DB shows booking_enabled=${verifyBs.booking_enabled})</div>`;
        return;
      }
      if (alertEl) { alertEl.innerHTML = `<div class="alert alert-success">✓ Booking ${enabled ? 'activated' : 'deactivated'}.</div>`; setTimeout(() => alertEl.innerHTML = '', 3000); }
    } catch(e) {
      console.error('Failed to save booking enabled state:', e);
      if (alertEl) alertEl.innerHTML = `<div class="alert alert-error">✗ ${e.message}</div>`;
    }
  })();
}

// Equipment checkboxes are mutually exclusive — one at a time
function updateRateFields(selected) {
  // Only uncheck others if a specific selection was made
  if (selected) {
    ['equip-full','equip-decks','equip-none'].forEach(id => {
      if (id !== selected) document.getElementById(id).checked = false;
    });
  }

  const full  = document.getElementById('equip-full').checked;
  const decks = document.getElementById('equip-decks').checked;
  const none  = document.getElementById('equip-none').checked;
  const hasEquip = full || decks || none;

  // Show/hide detail text inputs
  document.getElementById('equip-full-detail').style.display  = full  ? 'block' : 'none';
  document.getElementById('equip-decks-detail').style.display = decks ? 'block' : 'none';

  // Lock/unlock rate section based on equipment selection
  const notice = document.getElementById('rates-equip-notice');
  if (notice) notice.style.display = hasEquip ? 'none' : 'block';
  ['global-rate-type-flat','global-rate-type-hourly','global-rate-type-offers'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.style.pointerEvents = hasEquip ? '' : 'none';
      btn.style.opacity = hasEquip ? '' : '0.35';
    }
  });
  const saveRatesBtn = document.getElementById('save-rates-btn');
  if (saveRatesBtn) {
    saveRatesBtn.disabled = !hasEquip;
    saveRatesBtn.style.opacity = hasEquip ? '' : '0.35';
    saveRatesBtn.style.cursor = hasEquip ? 'pointer' : 'not-allowed';
    saveRatesBtn.style.pointerEvents = hasEquip ? '' : 'none';
  }

  // Rate fields per spec:
  // Checkbox 1 (full system) → 3 rates: no-equip, with-system, with-decks
  // Checkbox 2 (decks only)  → 2 rates: no-equip, with-decks
  // Checkbox 3 (none)        → 1 rate:  no-equip only
  document.getElementById('rate-with-system').style.display = full ? 'block' : 'none';
  document.getElementById('rate-with-decks').style.display  = (full || decks) ? 'block' : 'none';
  document.getElementById('rate-no-equip').style.display    = (full || decks || none) ? 'block' : 'none';

  // If allow-offers is on, hide all rate boxes
  if (document.getElementById('allow-offers').value === 'true') {
    document.getElementById('rate-with-system').style.display = 'none';
    document.getElementById('rate-with-decks').style.display  = 'none';
    document.getElementById('rate-no-equip').style.display    = 'none';
  }

  // Auto-save equipment if a selection was made
  if (selected) {
    saveEquipmentSection({ disabled: false, textContent: '' });
  }
}

// ── CALENDAR ──────────────────────────────────────────────
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
// bookingDays: { 'YYYY-MM-DD': { booked: bool, eventName, location, startTime, endTime, rate, rateType, minHours } }
let bookingDays = {};

function calKey(y, m, d) {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

const CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_LABELS = ['S','M','T','W','T','F','S'];

function renderCal() {
  const container = document.getElementById('cal-months-container');
  container.innerHTML = '';
  const today = new Date();

  for (let offset = 0; offset < 3; offset++) {
    let y = calYear, m = calMonth + offset;
    while (m > 11) { m -= 12; y++; }

    const monthWrap = document.createElement('div');
    monthWrap.style.cssText = 'background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:8px;padding:.75rem;';

    // Month header
    const header = document.createElement('div');
    header.style.cssText = 'font-family:"Space Mono",monospace;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--white);margin-bottom:.6rem;text-align:center;';
    header.textContent = CAL_MONTHS[m] + ' ' + y;
    monthWrap.appendChild(header);

    // Day labels
    const labelRow = document.createElement('div');
    labelRow.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:3px;';
    DAY_LABELS.forEach(l => {
      const lbl = document.createElement('div');
      lbl.style.cssText = 'text-align:center;font-family:"Space Mono",monospace;font-size:.5rem;color:var(--muted);padding:.2rem 0;';
      lbl.textContent = l;
      labelRow.appendChild(lbl);
    });
    monthWrap.appendChild(labelRow);

    // Day grid
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:3px;';
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
      grid.appendChild(document.createElement('div'));
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const key = calKey(y, m, d);
      const dayData = bookingDays[key] || {};
      const isPast = new Date(y, m, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const isBooked = dayData.booked;
      const isUnavail = dayData.unavailable;

      const isEdited = !isBooked && !isUnavail && bookingDays[key] && Object.keys(bookingDays[key]).length > 0;

      const cell = document.createElement('div');
      cell.style.cssText = `position:relative;border-radius:5px;padding:4px 2px 2px;text-align:center;border:1px solid ${isBooked ? 'rgba(255,95,95,.4)' : isUnavail ? 'rgba(107,107,136,.4)' : 'rgba(0,245,196,.2)'};background:${isBooked ? 'rgba(255,95,95,.08)' : isUnavail ? 'rgba(107,107,136,.08)' : isPast ? 'rgba(255,255,255,.02)' : 'rgba(0,245,196,.04)'};min-height:38px;`;

      cell.innerHTML = `<div style="font-size:.7rem;color:${isPast ? 'var(--muted)' : isBooked ? '#ff5f5f' : isUnavail ? 'var(--muted)' : 'var(--white)'};">${d}</div>
        ${!isPast ? `
          ${!isBooked ? `<button type="button" onclick="quickMarkBooked('${key}')" title="${isUnavail ? 'Mark available' : 'Mark unavailable'}"
            style="position:absolute;top:1px;left:1px;background:transparent;border:none;color:${isUnavail ? 'var(--neon)' : 'rgba(255,255,255,.2)'};cursor:pointer;font-size:.6rem;padding:0;line-height:1;font-weight:700;">${isUnavail ? '✓' : '✕'}</button>` : ''}
          <button type="button" onclick="openDayEditor('${key}')" title="Edit day"
            style="position:absolute;top:1px;right:1px;background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:.6rem;padding:0;line-height:1;">✏️</button>
          ${isEdited ? `<span style="position:absolute;bottom:2px;left:50%;transform:translateX(-50%);font-family:'Space Mono',monospace;font-size:.42rem;letter-spacing:.04em;text-transform:uppercase;color:var(--neon);opacity:.8;white-space:nowrap;">edited</span>` : ''}
        ` : ''}`;
      grid.appendChild(cell);
    }
    monthWrap.appendChild(grid);
    container.appendChild(monthWrap);
  }
}

function quickMarkBooked(key) {
  if (bookingDays[key] && bookingDays[key].booked) return;
  if (bookingDays[key] && bookingDays[key].unavailable) {
    delete bookingDays[key];
  } else {
    bookingDays[key] = { unavailable: true };
  }
  renderCal();
  autoSaveCalendar();
}

function calPrev() {
  calMonth -= 3;
  while (calMonth < 0) { calMonth += 12; calYear--; }
  renderCal();
}
function calNext() {
  calMonth += 3;
  while (calMonth > 11) { calMonth -= 12; calYear++; }
  renderCal();
}

async function saveBookingWindow() {
  try {
    const months = parseInt(document.getElementById('booking-window-select').value) || 12;
    const { data: current } = await db.from('users').select('booking_settings').eq('id', currentUser.id).single();
    const bs = current && current.booking_settings ? (typeof current.booking_settings === 'string' ? JSON.parse(current.booking_settings) : current.booking_settings) : {};
    bs.booking_window_months = months;
    await updateUserRow({ booking_settings: JSON.stringify(bs) });
  } catch(e) { console.error('Error saving booking window:', e); }
}

async function editProfileSaveEquipAndOpenDay(key) {
  const full  = document.getElementById('meq-full').checked;
  const decks = document.getElementById('meq-decks').checked;
  const none  = document.getElementById('meq-none').checked;
  const alertEl = document.getElementById('meq-alert');
  if (!full && !decks && !none) {
    alertEl.style.color = 'var(--error)';
    alertEl.textContent = '✗ Please select at least one option.';
    return;
  }
  alertEl.style.color = 'var(--muted)';
  alertEl.textContent = 'Saving...';
  try {
    // Update the actual page checkboxes so the day editor reads them correctly
    document.getElementById('equip-full').checked = full;
    document.getElementById('equip-decks').checked = decks;
    document.getElementById('equip-none').checked = none;
    if (document.getElementById('equip-full-detail') && document.getElementById('meq-full-detail')) {
      document.getElementById('equip-full-detail').value = document.getElementById('meq-full-detail').value;
    }
    if (document.getElementById('equip-decks-detail') && document.getElementById('meq-decks-detail')) {
      document.getElementById('equip-decks-detail').value = document.getElementById('meq-decks-detail').value;
    }
    await saveEquipmentSection({ disabled: false, textContent: '' });
    updateRateFields();
    document.getElementById('day-editor-modal').remove();
    openDayEditor(key);
  } catch(e) {
    alertEl.style.color = 'var(--error)';
    alertEl.textContent = '✗ ' + e.message;
  }
}

// ── DAY EDITOR MODAL ──────────────────────────────────────
function openDayEditor(key) {
  const d = bookingDays[key] || {};
  const globalAllowOffers = document.getElementById('allow-offers').value === 'true';

  // Guard: equipment must be selected first — show inline selector
  const guardEquipFull = document.getElementById('equip-full').checked;
  const guardEquipDecks = document.getElementById('equip-decks').checked;
  const guardEquipNone = document.getElementById('equip-none').checked;
  if (!guardEquipFull && !guardEquipDecks && !guardEquipNone) {
    const existing = document.getElementById('day-editor-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'day-editor-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:1.5rem;';
    modal.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.75rem;width:100%;max-width:380px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
          <div style="font-family:'Space Mono',monospace;font-size:.65rem;letter-spacing:.08em;text-transform:uppercase;color:var(--neon);">Equipment Setup</div>
          <button type="button" onclick="document.getElementById('day-editor-modal').remove()" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:1.1rem;">✕</button>
        </div>
        <div style="font-size:.85rem;color:var(--muted);margin-bottom:1.25rem;line-height:1.5;">Please update your equipment selection before updating rates.</div>
        <div style="display:flex;flex-direction:column;gap:.6rem;margin-bottom:1.25rem;">
          <label style="display:flex;align-items:flex-start;gap:.6rem;cursor:pointer;padding:.7rem .9rem;background:var(--deep);border:1px solid var(--border);border-radius:6px;">
            <input type="checkbox" id="meq-full" style="margin-top:2px;accent-color:var(--neon);flex-shrink:0;" onchange="if(this.checked){document.getElementById('meq-decks').checked=false;document.getElementById('meq-none').checked=false;document.getElementById('meq-full-detail-wrap').style.display='block';document.getElementById('meq-decks-detail-wrap').style.display='none';}else{document.getElementById('meq-full-detail-wrap').style.display='none';}">
            <div style="flex:1;">
              <div style="font-size:.88rem;color:var(--white);">I can provide Sound System &amp; Decks/Controller</div>
              <div id="meq-full-detail-wrap" style="display:none;margin-top:.4rem;">
                <input type="text" id="meq-full-detail" placeholder="List your system (e.g. QSC K12.2, Pioneer CDJ-3000)" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.45rem .7rem;color:var(--white);font-size:.83rem;font-family:'DM Sans',sans-serif;">
              </div>
            </div>
          </label>
          <label style="display:flex;align-items:flex-start;gap:.6rem;cursor:pointer;padding:.7rem .9rem;background:var(--deep);border:1px solid var(--border);border-radius:6px;">
            <input type="checkbox" id="meq-decks" style="margin-top:2px;accent-color:var(--neon);flex-shrink:0;" onchange="if(this.checked){document.getElementById('meq-full').checked=false;document.getElementById('meq-none').checked=false;document.getElementById('meq-decks-detail-wrap').style.display='block';document.getElementById('meq-full-detail-wrap').style.display='none';}else{document.getElementById('meq-decks-detail-wrap').style.display='none';}">
            <div style="flex:1;">
              <div style="font-size:.88rem;color:var(--white);">I can provide only Decks/Controller</div>
              <div id="meq-decks-detail-wrap" style="display:none;margin-top:.4rem;">
                <input type="text" id="meq-decks-detail" placeholder="List your decks/controller (e.g. Pioneer DDJ-1000)" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.45rem .7rem;color:var(--white);font-size:.83rem;font-family:'DM Sans',sans-serif;">
              </div>
            </div>
          </label>
          <label style="display:flex;align-items:flex-start;gap:.6rem;cursor:pointer;padding:.7rem .9rem;background:var(--deep);border:1px solid var(--border);border-radius:6px;">
            <input type="checkbox" id="meq-none" style="margin-top:2px;accent-color:var(--neon);flex-shrink:0;" onchange="if(this.checked){document.getElementById('meq-full').checked=false;document.getElementById('meq-decks').checked=false;document.getElementById('meq-full-detail-wrap').style.display='none';document.getElementById('meq-decks-detail-wrap').style.display='none';}">
            <div style="font-size:.88rem;color:var(--white);">I require all equipment provided by venue</div>
          </label>
        </div>
        <div id="meq-alert" style="font-family:'Space Mono',monospace;font-size:.62rem;min-height:1rem;margin-bottom:.75rem;"></div>
        <div style="display:flex;gap:.75rem;">
          <button type="button" onclick="document.getElementById('day-editor-modal').remove()" style="flex:1;padding:.75rem;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--muted);font-family:'Space Mono',monospace;font-size:.62rem;cursor:pointer;">Cancel</button>
          <button type="button" onclick="editProfileSaveEquipAndOpenDay('${key}')" style="flex:1;padding:.75rem;background:var(--neon);border:none;border-radius:6px;color:var(--black);font-family:'Space Mono',monospace;font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;">Save &amp; Continue</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    return;
  }
  const existing = document.getElementById('day-editor-modal');
  if (existing) existing.remove();

  // Format key as "Monday, October 1, 2026"
  const [y, m, day] = key.split('-').map(Number);
  const dateObj = new Date(y, m - 1, day);
  const formattedDate = dateObj.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });

  // Get default equipment
  const equipFull = document.getElementById('equip-full').checked;
  const equipDecks = document.getElementById('equip-decks').checked;
  const equipNone = document.getElementById('equip-none').checked;
  let equipLabel = '';
  if (equipFull) equipLabel = 'Sound System &amp; Decks/Controller';
  else if (equipDecks) equipLabel = 'Decks/Controller Only';
  else if (equipNone) equipLabel = 'Venue Provides All Equipment';

  // Read global rates — use as defaults if day has no custom rate
  const hasCustomRate = d.rate || d.rateSystem || d.rateDecks || d.hourlyRate || d.hourlyRateSystem || d.hourlyRateDecks;
  const globalRateType = globalAllowOffers ? 'flat' : (document.getElementById('global-rate-type-hourly').style.background.includes('neon') ? 'hourly' : 'flat');
  const defaultRateType = d.rateType || (globalAllowOffers ? 'offers' : globalRateType);
  const globalSystem = document.getElementById('rate-with-system-val')?.value || '';
  const globalDecks = document.getElementById('rate-with-decks-val')?.value || '';
  const globalNoEquip = document.getElementById('rate-no-equip-val')?.value || '';
  const isOffersDay = defaultRateType === 'offers';
  const isHourlyDay = defaultRateType === 'hourly';
  const defaultRateSystem = (!isOffersDay && !isHourlyDay) ? (d.rateSystem ?? (hasCustomRate ? '' : globalSystem)) : '';
  const defaultRateDecks = (!isOffersDay && !isHourlyDay) ? (d.rateDecks ?? (hasCustomRate ? '' : globalDecks)) : '';
  const defaultRate = (!isOffersDay && !isHourlyDay) ? (d.rate ?? (hasCustomRate ? '' : globalNoEquip)) : '';
  const defaultHourlyRateSystem = (!isOffersDay && isHourlyDay) ? (d.hourlyRateSystem ?? (hasCustomRate ? '' : (globalRateType === 'hourly' ? globalSystem : ''))) : '';
  const defaultHourlyRateDecks = (!isOffersDay && isHourlyDay) ? (d.hourlyRateDecks ?? (hasCustomRate ? '' : (globalRateType === 'hourly' ? globalDecks : ''))) : '';
  const defaultHourlyRate = (!isOffersDay && isHourlyDay) ? (d.hourlyRate ?? (hasCustomRate ? '' : (globalRateType === 'hourly' ? globalNoEquip : ''))) : '';

  const modal = document.createElement('div');
  modal.id = 'day-editor-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:1.5rem;';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.75rem;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.25rem;">
        <div style="font-family:'Space Mono',monospace;font-size:.72rem;letter-spacing:.06em;color:var(--neon);">${formattedDate}</div>
        <button type="button" onclick="document.getElementById('day-editor-modal').remove()" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:1.2rem;">✕</button>
      </div>
      ${equipLabel ? `<div style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.05em;color:var(--muted);margin-bottom:1.25rem;">Default equipment: ${equipLabel}</div>` : '<div style="margin-bottom:1.25rem;"></div>'}

      <div style="margin-bottom:1rem;display:flex;flex-direction:column;gap:.5rem;">
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;">
          <input type="radio" name="day-status" id="day-status-avail" value="available" ${!d.booked && !d.unavailable ? 'checked' : ''} style="accent-color:var(--neon);" onchange="toggleDayBooked()">
          <span style="font-size:.85rem;color:var(--white);">Available</span>
        </label>
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;">
          <input type="radio" name="day-status" id="day-status-unavail" value="unavailable" ${d.unavailable ? 'checked' : ''} style="accent-color:var(--muted);" onchange="toggleDayBooked()">
          <span style="font-size:.85rem;color:var(--muted);">Unavailable</span>
        </label>
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;">
          <input type="radio" name="day-status" id="day-status-booked" value="booked" ${d.booked ? 'checked' : ''} style="accent-color:var(--error);" onchange="toggleDayBooked()">
          <span style="font-size:.85rem;color:#ff5f5f;">Booked (has event)</span>
        </label>
      </div>

      <div id="day-booked-fields" style="display:${d.booked ? 'block' : 'none'};">
        <div style="background:var(--deep);border-radius:8px;padding:1rem;margin-bottom:1rem;">
          <div style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.75rem;">Event Details (Optional)</div>
          <div style="margin-bottom:.6rem;">
            <label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:.25rem;">Event / Venue Name</label>
            <input type="text" id="day-event-name" value="${d.eventName||''}" placeholder="e.g. Saturday Night Live" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
          </div>
          <div style="margin-bottom:.6rem;">
            <label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:.25rem;">Venue Address</label>
            <div style="display:flex;gap:.5rem;">
              <input type="text" id="day-location" value="${d.location !== 'Private' ? (d.location||'') : ''}" placeholder="Start typing address..." autocomplete="off" oninput="dayLocAutocomplete(this)" style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;" ${d.location==='Private'?'disabled':''}>
              <label style="display:flex;align-items:center;gap:.3rem;cursor:pointer;white-space:nowrap;font-size:.78rem;color:var(--muted);">
                <input type="checkbox" id="day-private" ${d.location==='Private'?'checked':''} style="accent-color:var(--neon);" onchange="document.getElementById('day-location').disabled=this.checked;"> Private
              </label>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;">
            <div>
              <label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:.25rem;">Start Time</label>
              <select id="day-start" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;cursor:pointer;outline:none;">${d.startTime ? `<option value="${d.startTime}" selected>${(()=>{const [h,mi]=d.startTime.split(':').map(Number);const p=h<12?'AM':'PM';const h12=h%12||12;return h12+':'+String(mi).padStart(2,'0')+' '+p;})()}</option>` : ''}<option value="">--</option><option value="00:00">12:00 AM</option><option value="00:30">12:30 AM</option><option value="01:00">1:00 AM</option><option value="01:30">1:30 AM</option><option value="02:00">2:00 AM</option><option value="02:30">2:30 AM</option><option value="03:00">3:00 AM</option><option value="03:30">3:30 AM</option><option value="04:00">4:00 AM</option><option value="04:30">4:30 AM</option><option value="05:00">5:00 AM</option><option value="05:30">5:30 AM</option><option value="06:00">6:00 AM</option><option value="06:30">6:30 AM</option><option value="07:00">7:00 AM</option><option value="07:30">7:30 AM</option><option value="08:00">8:00 AM</option><option value="08:30">8:30 AM</option><option value="09:00">9:00 AM</option><option value="09:30">9:30 AM</option><option value="10:00">10:00 AM</option><option value="10:30">10:30 AM</option><option value="11:00">11:00 AM</option><option value="11:30">11:30 AM</option><option value="12:00">12:00 PM</option><option value="12:30">12:30 PM</option><option value="13:00">1:00 PM</option><option value="13:30">1:30 PM</option><option value="14:00">2:00 PM</option><option value="14:30">2:30 PM</option><option value="15:00">3:00 PM</option><option value="15:30">3:30 PM</option><option value="16:00">4:00 PM</option><option value="16:30">4:30 PM</option><option value="17:00">5:00 PM</option><option value="17:30">5:30 PM</option><option value="18:00">6:00 PM</option><option value="18:30">6:30 PM</option><option value="19:00">7:00 PM</option><option value="19:30">7:30 PM</option><option value="20:00">8:00 PM</option><option value="20:30">8:30 PM</option><option value="21:00">9:00 PM</option><option value="21:30">9:30 PM</option><option value="22:00">10:00 PM</option><option value="22:30">10:30 PM</option><option value="23:00">11:00 PM</option><option value="23:30">11:30 PM</option></select>
            </div>
            <div>
              <label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:.25rem;">End Time <span style="font-size:.65rem;">(optional)</span></label>
              <select id="day-end" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;cursor:pointer;outline:none;">${d.endTime ? `<option value="${d.endTime}" selected>${(()=>{const [h,mi]=d.endTime.split(':').map(Number);const p=h<12?'AM':'PM';const h12=h%12||12;return h12+':'+String(mi).padStart(2,'0')+' '+p;})()}</option>` : ''}<option value="">--</option><option value="00:00">12:00 AM</option><option value="00:30">12:30 AM</option><option value="01:00">1:00 AM</option><option value="01:30">1:30 AM</option><option value="02:00">2:00 AM</option><option value="02:30">2:30 AM</option><option value="03:00">3:00 AM</option><option value="03:30">3:30 AM</option><option value="04:00">4:00 AM</option><option value="04:30">4:30 AM</option><option value="05:00">5:00 AM</option><option value="05:30">5:30 AM</option><option value="06:00">6:00 AM</option><option value="06:30">6:30 AM</option><option value="07:00">7:00 AM</option><option value="07:30">7:30 AM</option><option value="08:00">8:00 AM</option><option value="08:30">8:30 AM</option><option value="09:00">9:00 AM</option><option value="09:30">9:30 AM</option><option value="10:00">10:00 AM</option><option value="10:30">10:30 AM</option><option value="11:00">11:00 AM</option><option value="11:30">11:30 AM</option><option value="12:00">12:00 PM</option><option value="12:30">12:30 PM</option><option value="13:00">1:00 PM</option><option value="13:30">1:30 PM</option><option value="14:00">2:00 PM</option><option value="14:30">2:30 PM</option><option value="15:00">3:00 PM</option><option value="15:30">3:30 PM</option><option value="16:00">4:00 PM</option><option value="16:30">4:30 PM</option><option value="17:00">5:00 PM</option><option value="17:30">5:30 PM</option><option value="18:00">6:00 PM</option><option value="18:30">6:30 PM</option><option value="19:00">7:00 PM</option><option value="19:30">7:30 PM</option><option value="20:00">8:00 PM</option><option value="20:30">8:30 PM</option><option value="21:00">9:00 PM</option><option value="21:30">9:30 PM</option><option value="22:00">10:00 PM</option><option value="22:30">10:30 PM</option><option value="23:00">11:00 PM</option><option value="23:30">11:30 PM</option></select>
            </div>
          </div>
          <div style="margin-top:.6rem;">
            <label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:.25rem;">Event Info / Ticket URL <span style="font-size:.65rem;">(optional)</span></label>
            <input type="text" id="day-ticket-url" value="${d.ticketUrl||''}" placeholder="https://tickets.com/event" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;margin-bottom:.4rem;">
          </div>
        </div>
      </div>

      <div id="day-avail-fields" style="display:${(!d.booked && !d.unavailable) ? 'block' : 'none'};">
        <div style="background:var(--deep);border-radius:8px;padding:1rem;margin-bottom:1rem;">
          <div style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.75rem;">Rate for This Day</div>
          <div style="text-align:center;margin-bottom:.75rem;">
            <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);font-weight:700;display:block;margin-bottom:.5rem;">Rate Type</label>
            <div style="display:inline-flex;border:1px solid var(--border);border-radius:5px;overflow:hidden;margin-bottom:.5rem;">
              <button type="button" id="rate-type-flat" onclick="setDayRateType('flat')" style="padding:.55rem 1.5rem;border:none;border-right:1px solid var(--border);background:${defaultRateType!=='hourly'&&defaultRateType!=='offers'?'var(--neon-dim)':'transparent'};color:${defaultRateType!=='hourly'&&defaultRateType!=='offers'?'var(--neon)':'var(--white)'};font-family:'Space Mono',monospace;font-size:.7rem;cursor:pointer;">Flat Rate</button>
              <button type="button" id="rate-type-hourly" onclick="setDayRateType('hourly')" style="padding:.55rem 1.5rem;border:none;border-right:1px solid var(--border);background:${defaultRateType==='hourly'?'var(--neon-dim)':'transparent'};color:${defaultRateType==='hourly'?'var(--neon)':'var(--white)'};font-family:'Space Mono',monospace;font-size:.7rem;cursor:pointer;">Hourly</button>
              <button type="button" id="rate-type-offers" onclick="setDayRateType('offers')" style="padding:.55rem 1.5rem;border:none;background:${defaultRateType==='offers'?'var(--neon-dim)':'transparent'};color:${defaultRateType==='offers'?'var(--neon)':'var(--white)'};font-family:'Space Mono',monospace;font-size:.7rem;cursor:pointer;">Offers</button>
            </div>
            <div id="day-offers-label" style="display:${defaultRateType==='offers'?'block':'none'};font-size:.72rem;color:var(--white);line-height:1.5;">Offers can be countered and negotiated through the platform.</div>
          </div>

          <div id="day-flat-fields" style="display:${defaultRateType!=='hourly'&&defaultRateType!=='offers'?'block':'none'};">
            ${equipFull ? `
            <div style="margin-bottom:.5rem;">
              <label style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.3rem;">Rate with Sound System &amp; Decks/Controller</label>
              <div style="display:flex;align-items:center;gap:.4rem;">
                <span style="color:var(--muted);">$</span>
                <input type="number" id="day-rate-system" value="${defaultRateSystem}" placeholder="0" min="0" style="max-width:160px;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.45rem .65rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
              </div>
            </div>` : ''}
            ${equipDecks || equipFull ? `
            <div style="margin-bottom:.5rem;">
              <label style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.3rem;">Rate with Decks/Controller Only</label>
              <div style="display:flex;align-items:center;gap:.4rem;">
                <span style="color:var(--muted);">$</span>
                <input type="number" id="day-rate-decks" value="${defaultRateDecks}" placeholder="0" min="0" style="max-width:160px;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.45rem .65rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
              </div>
            </div>` : ''}
            <div style="margin-bottom:.5rem;">
              <label style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.3rem;">Rate (No Equipment Provided)</label>
              <div style="display:flex;align-items:center;gap:.4rem;">
                <span style="color:var(--muted);">$</span>
                <input type="number" id="day-flat-rate" value="${defaultRate}" placeholder="0" min="0" style="max-width:160px;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.45rem .65rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
              </div>
            </div>
          </div>

          <div id="day-hourly-fields" style="display:${defaultRateType==='hourly'?'block':'none'};">
            ${equipFull ? `
            <div style="margin-bottom:.5rem;">
              <label style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.3rem;">Rate with Sound System &amp; Decks/Controller</label>
              <div style="display:flex;align-items:center;gap:.4rem;">
                <span style="color:var(--muted);">$</span>
                <input type="number" id="day-hourly-system" value="${defaultHourlyRateSystem}" placeholder="0" min="0" style="max-width:160px;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.45rem .65rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
                <span style="font-family:'Space Mono',monospace;font-size:.62rem;font-weight:700;color:var(--neon);letter-spacing:.06em;">PER HOUR</span>
              </div>
            </div>` : ''}
            ${equipDecks || equipFull ? `
            <div style="margin-bottom:.5rem;">
              <label style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.3rem;">Rate with Decks/Controller Only</label>
              <div style="display:flex;align-items:center;gap:.4rem;">
                <span style="color:var(--muted);">$</span>
                <input type="number" id="day-hourly-decks" value="${defaultHourlyRateDecks}" placeholder="0" min="0" style="max-width:160px;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.45rem .65rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
                <span style="font-family:'Space Mono',monospace;font-size:.62rem;font-weight:700;color:var(--neon);letter-spacing:.06em;">PER HOUR</span>
              </div>
            </div>` : ''}
            <div style="margin-bottom:.5rem;">
              <label style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.3rem;">Rate (No Equipment Provided)</label>
              <div style="display:flex;align-items:center;gap:.4rem;">
                <span style="color:var(--muted);">$</span>
                <input type="number" id="day-hourly-rate" value="${defaultHourlyRate}" placeholder="0" min="0" style="max-width:160px;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.45rem .65rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
                <span style="font-family:'Space Mono',monospace;font-size:.62rem;font-weight:700;color:var(--neon);letter-spacing:.06em;">PER HOUR</span>
              </div>
            </div>
          </div>

          <div id="day-offers-fields" style="display:${defaultRateType==='offers'?'block':'none'};">
            <div style="margin-bottom:.5rem;">
              <label style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.3rem;">Base Rate (minimum offer)</label>
              <div style="display:flex;align-items:center;gap:.4rem;">
                <span style="color:var(--muted);">$</span>
                <input type="number" id="day-base-rate" value="${d.base_rate||''}" placeholder="0" min="0" style="max-width:160px;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.45rem .65rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:.5rem;">
        <button type="button" onclick="saveDayEditor('${key}')" style="flex:1;padding:.75rem;background:var(--neon);border:none;border-radius:6px;color:var(--black);font-family:'Space Mono',monospace;font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;">Save Day</button>
        <button type="button" onclick="document.getElementById('day-editor-modal').remove()" style="padding:.75rem 1rem;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--muted);font-family:'Space Mono',monospace;font-size:.65rem;cursor:pointer;">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function toggleDayBooked() {
  const val = document.querySelector('input[name="day-status"]:checked').value;
  document.getElementById('day-booked-fields').style.display = val === 'booked' ? 'block' : 'none';
  document.getElementById('day-avail-fields').style.display = val === 'available' ? 'block' : 'none';
}

function setDayRateType(type) {
  ['flat','hourly','offers'].forEach(t => {
    const btn = document.getElementById('rate-type-' + t);
    if (!btn) return;
    const active = type === t;
    btn.style.background = active ? 'var(--neon-dim)' : 'transparent';
    btn.style.color = active ? 'var(--neon)' : 'var(--white)';
  });
  document.getElementById('day-flat-fields').style.display    = type === 'flat'   ? 'block' : 'none';
  document.getElementById('day-hourly-fields').style.display  = type === 'hourly' ? 'block' : 'none';
  document.getElementById('day-offers-fields').style.display  = type === 'offers' ? 'block' : 'none';
  const ol = document.getElementById('day-offers-label');
  if (ol) { ol.style.display = type === 'offers' ? 'block' : 'none'; ol.style.color = 'var(--white)'; }
  if (type !== 'flat') {
    ['day-flat-rate','day-rate-system','day-rate-decks'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  }
  if (type !== 'hourly') {
    ['day-hourly-rate','day-hourly-system','day-hourly-decks'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  }
  if (type !== 'offers') {
    const br = document.getElementById('day-base-rate'); if (br) br.value = '';
  }
}

function saveDayEditor(key) {
  const statusVal = document.querySelector('input[name="day-status"]:checked').value;
  if (statusVal === 'unavailable') {
    bookingDays[key] = { unavailable: true };
  } else if (statusVal === 'booked') {
    const isPrivate = document.getElementById('day-private').checked;
    bookingDays[key] = {
      booked: true,
      eventName: document.getElementById('day-event-name').value.trim(),
      location: isPrivate ? 'Private' : document.getElementById('day-location').value.trim(),
      startTime: document.getElementById('day-start').value,
      endTime: document.getElementById('day-end').value,
      ticketUrl: document.getElementById('day-ticket-url').value.trim() || null,
    };
  } else {
    // available
    const flatRate = document.getElementById('day-flat-rate')?.value || null;
    const rateSystem = document.getElementById('day-rate-system')?.value || null;
    const rateDecks = document.getElementById('day-rate-decks')?.value || null;
    const hourlyRate = document.getElementById('day-hourly-rate')?.value || null;
    const hourlyRateSystem = document.getElementById('day-hourly-system')?.value || null;
    const hourlyRateDecks = document.getElementById('day-hourly-decks')?.value || null;
    const flatHours = document.getElementById('day-flat-hours')?.value || null;
    const dayBaseRate = document.getElementById('day-base-rate')?.value || null;
    const offersActive = document.getElementById('rate-type-offers')?.style.background.includes('neon');
    const rateType = offersActive ? 'offers' : (document.getElementById('day-hourly-fields').style.display === 'block' ? 'hourly' : 'flat');

    // Validate: visible rate fields must have a value
    if (offersActive) {
      const br = document.getElementById('day-base-rate');
      if (br && br.value.trim() === '') {
        br.style.borderColor = 'rgba(255,95,95,.8)';
        br.addEventListener('input', () => br.style.borderColor = '', { once: true });
        return;
      }
    } else {
      const rateInputs = rateType === 'hourly'
        ? ['day-hourly-system','day-hourly-decks','day-hourly-rate']
        : ['day-rate-system','day-rate-decks','day-flat-rate'];
      let hasEmpty = false;
      for (const id of rateInputs) {
        const el = document.getElementById(id);
        if (el && el.value.trim() === '') {
          el.style.borderColor = 'rgba(255,95,95,.8)';
          el.addEventListener('input', () => el.style.borderColor = '', { once: true });
          hasEmpty = true;
        }
      }
      if (hasEmpty) return;
    }
    const hasCustom = flatRate || rateSystem || rateDecks || hourlyRate || hourlyRateSystem || hourlyRateDecks;
    if (hasCustom || dayBaseRate || offersActive) {
      bookingDays[key] = {
        booked: false,
        rateType,
        rate: offersActive ? null : flatRate,
        rateSystem: offersActive ? null : rateSystem,
        rateDecks: offersActive ? null : rateDecks,
        flatHours: offersActive ? null : flatHours,
        hourlyRate: offersActive ? null : hourlyRate,
        hourlyRateSystem: offersActive ? null : hourlyRateSystem,
        hourlyRateDecks: offersActive ? null : hourlyRateDecks,
        base_rate: dayBaseRate,
      };
    } else {
      delete bookingDays[key];
    }
  }
  document.getElementById('day-editor-modal').remove();
  renderCal();
  autoSaveCalendar();
}

async function autoSaveCalendar() {
  const alertEl = document.getElementById('booking-alert');
  try {
    const { data: current } = await db.from('users').select('booking_settings').eq('id', currentUser.id).single();
    const bs = current && current.booking_settings ? (typeof current.booking_settings === 'string' ? JSON.parse(current.booking_settings) : current.booking_settings) : {};
    bs.booking_days = bookingDays;
    const _ur = await updateUserRow({ booking_settings: JSON.stringify(bs) }); const error = _ur.ok ? null : { message: _ur.error };
    if (error) throw error;
    if (alertEl) { alertEl.innerHTML = '<span style="font-size:.6rem;color:var(--success);">✓ Calendar saved</span>'; setTimeout(() => alertEl.innerHTML = '', 2000); }
  } catch(e) {
    if (alertEl) alertEl.innerHTML = '<span style="font-size:.6rem;color:var(--error);">✗ ' + e.message + '</span>';
  }
}

function updateCurrencySymbols() {
  const sel = document.getElementById('rate-currency');
  const opt = sel.options[sel.selectedIndex];
  const symbol = opt ? opt.getAttribute('data-symbol') : '$';
  const code = sel.value;
  document.querySelectorAll('.currency-symbol').forEach(el => el.textContent = symbol);
  const hint = document.getElementById('rate-currency-hint');
  if (hint) hint.textContent = `(${code})`;
}

async function saveEquipmentSection(btn) {
  await savePartialBooking(btn, 'equip-save-alert', {
    equip_full: document.getElementById('equip-full').checked,
    equip_full_detail: document.getElementById('equip-full-detail').value.trim(),
    equip_decks: document.getElementById('equip-decks').checked,
    equip_decks_detail: document.getElementById('equip-decks-detail').value.trim(),
    equip_none: document.getElementById('equip-none').checked,
  });
}

function setGlobalRateType(type) {
  const isFlat = type === 'flat';
  const isHourly = type === 'hourly';
  const isOffers = type === 'offers';

  // Update hidden allow-offers value
  document.getElementById('allow-offers').value = isOffers ? 'true' : 'false';

  // Style all 3 buttons
  ['offers','flat','hourly'].forEach(t => {
    const btn = document.getElementById('global-rate-type-' + t);
    const active = type === t;
    btn.style.background = active ? 'var(--neon-dim)' : 'transparent';
    btn.style.color = active ? 'var(--neon)' : 'var(--white)';
  });

  // Show/hide rate fields
  if (isOffers) {
    document.getElementById('rate-with-system').style.display = 'none';
    document.getElementById('rate-with-decks').style.display  = 'none';
    document.getElementById('rate-no-equip').style.display    = 'none';
  } else {
    updateRateFields();
  }

  // Labels
  document.getElementById('global-offers-label').style.display = isOffers ? 'block' : 'none';

  // Base rate wrap
  document.getElementById('global-base-rate-wrap').style.display = isOffers ? 'block' : 'none';

  // Per-hour labels
  document.querySelectorAll('.per-hour-label').forEach(el => el.style.display = isHourly ? 'inline' : 'none');

  const flatHoursField = document.getElementById('global-flat-hours-field');
  if (flatHoursField) flatHoursField.style.display = isFlat ? 'flex' : 'none';
}

async function saveRateSection(btn) {
  const isOffers = document.getElementById('allow-offers').value === 'true';
  const isHourly = document.getElementById('global-rate-type-hourly').style.background.includes('neon');
  const isFlat = document.getElementById('global-rate-type-flat').style.background.includes('neon');
  const alertEl = document.getElementById('rate-save-alert');

  if (!isOffers && !isHourly && !isFlat) {
    alertEl.style.color = 'var(--error)';
    alertEl.textContent = '✗ Please select a rate type first.';
    setTimeout(() => alertEl.textContent = '', 3000);
    return;
  }

  // Validate: any visible rate field must have a value entered
  if (!isOffers) {
    const checks = [
      { id: 'rate-with-system', valId: 'rate-with-system-val' },
      { id: 'rate-with-decks',  valId: 'rate-with-decks-val'  },
      { id: 'rate-no-equip',    valId: 'rate-no-equip-val'    },
    ];
    let hasEmpty = false;
    for (const { id, valId } of checks) {
      const wrap = document.getElementById(id);
      const input = document.getElementById(valId);
      if (wrap.style.display !== 'none' && input.value.trim() === '') {
        input.style.borderColor = 'var(--error)';
        input.addEventListener('input', () => input.style.borderColor = '', { once: true });
        hasEmpty = true;
      }
    }
    if (hasEmpty) {
      alertEl.style.color = 'var(--error)';
      alertEl.textContent = '✗ All visible rate fields must have a value.';
      setTimeout(() => alertEl.textContent = '', 3000);
      return;
    }
  } else {
    const baseRate = document.getElementById('base-rate-val');
    if (baseRate && baseRate.value.trim() === '') {
      baseRate.style.borderColor = 'var(--error)';
      baseRate.addEventListener('input', () => baseRate.style.borderColor = '', { once: true });
      alertEl.style.color = 'var(--error)';
      alertEl.textContent = '✗ Please enter a base rate.';
      setTimeout(() => alertEl.textContent = '', 3000);
      return;
    }
  }

  const rateType = isOffers ? 'offers' : (isHourly ? 'hourly' : 'flat');
  await savePartialBooking(btn, 'rate-save-alert', {
    global_rate_type: rateType,
    rate_no_equip: document.getElementById('rate-no-equip-val').value || null,
    rate_with_system: document.getElementById('rate-with-system-val').value || null,
    rate_with_decks: document.getElementById('rate-with-decks-val').value || null,
    allow_offers: isOffers,
    base_rate: document.getElementById('base-rate-val')?.value || null,
  });
}

async function savePartialBooking(btn, alertId, fields) {
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving...';
  const alertEl = document.getElementById(alertId);
  try {
    const { data: current } = await db.from('users').select('booking_settings').eq('id', currentUser.id).single();
    const bs = current && current.booking_settings ? (typeof current.booking_settings === 'string' ? JSON.parse(current.booking_settings) : current.booking_settings) : {};
    Object.assign(bs, fields);
    const _ur = await updateUserRow({ booking_settings: JSON.stringify(bs) }); const error = _ur.ok ? null : { message: _ur.error };
    if (error) throw error;
    if (alertEl) { alertEl.style.color = 'var(--success)'; alertEl.textContent = '✓ Saved'; setTimeout(() => alertEl.textContent = '', 2500); }
    formDirty = false;
  } catch(e) {
    if (alertEl) { alertEl.style.color = 'var(--error)'; alertEl.textContent = '✗ ' + e.message; }
  }
  btn.disabled = false; btn.textContent = orig;
}

