// MOBILE BOOKING: calendar, package builder, autosave
// Extracted from update-dj-profile.html

async function saveBookingSettings() {
  const btn = document.getElementById('save-booking-btn');
  const alertEl = document.getElementById('booking-alert');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const settings = {
      booking_enabled: document.getElementById('booking-enabled').checked,
      booking_window_months: parseInt(document.getElementById('booking-window-select').value) || 12,
      currency: document.getElementById('rate-currency').value,
      equip_full: document.getElementById('equip-full').checked,
      equip_full_detail: document.getElementById('equip-full-detail').value.trim(),
      equip_decks: document.getElementById('equip-decks').checked,
      equip_decks_detail: document.getElementById('equip-decks-detail').value.trim(),
      equip_none: document.getElementById('equip-none').checked,
      rate_no_equip: document.getElementById('rate-no-equip-val').value || null,
      rate_with_system: document.getElementById('rate-with-system-val').value || null,
      rate_with_decks: document.getElementById('rate-with-decks-val').value || null,
      global_rate_type: document.getElementById('allow-offers').value === 'true' ? 'offers' : (document.getElementById('global-rate-type-hourly').style.background.includes('neon') ? 'hourly' : 'flat'),
      global_rate_hours: null,
      allow_offers: document.getElementById('allow-offers').value === 'true',
      base_rate: document.getElementById('base-rate-val')?.value || null,
      booking_days: bookingDays,
    };
    const _ur = await updateUserRow({ booking_settings: JSON.stringify(settings) }); const error = _ur.ok ? null : { message: _ur.error };
    if (error) throw error;
    // Verify it saved by re-reading
    const { data: check } = await db.from('users').select('booking_settings').eq('id', currentUser.id).single();
    if (!check || !check.booking_settings) throw new Error('Save appeared to succeed but data not found. Ensure booking_settings column exists in Supabase: ALTER TABLE users ADD COLUMN IF NOT EXISTS booking_settings text;');
    if (alertEl) { alertEl.innerHTML = '<div class="alert alert-success">✓ Booking settings saved.</div>'; setTimeout(() => { alertEl.innerHTML = ''; }, 3000); }
  } catch(e) {
    if (alertEl) alertEl.innerHTML = '<div class="alert alert-error">' + e.message + '</div>';
    else alert('Booking save error: ' + e.message);
  }
  btn.disabled = false; btn.textContent = 'Save Booking Settings';
}

// ── MOBILE DJ BOOKING ─────────────────────────────────────

let mobBookingDays = {};
let mobPackages = { general: [], wedding: [], mitzvah: [] };
let mobSelectedTypes = [];
let mobCalYear = new Date().getFullYear();
let mobCalMonth = new Date().getMonth();

// Category definitions
const MOB_CAT_GENERAL_TYPES = ['birthday','graduation','holiday','community','corporate','anniversary','sweet16','reunion','school','other'];
const MOB_CAT_WEDDING_TYPES = ['weddings'];
const MOB_CAT_MITZVAH_TYPES = ['mitzvah'];

function getMobActiveCategories() {
  const cats = [];
  const types = mobSelectedTypes;
  if (types.some(t => MOB_CAT_GENERAL_TYPES.includes(t))) cats.push('general');
  if (types.some(t => MOB_CAT_WEDDING_TYPES.includes(t))) cats.push('wedding');
  if (types.some(t => MOB_CAT_MITZVAH_TYPES.includes(t))) cats.push('mitzvah');
  return cats;
}

function getMobTypesFromProfile() {
  return Array.from(document.querySelectorAll('input[name="mobile-events"]:checked')).map(cb => cb.value);
}

// ── MOBILE CALENDAR ───────────────────────────────────────

function mobCalKey(y, m, d) {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function renderMobCal() {
  const container = document.getElementById('mob-cal-container');
  if (!container) return;
  container.innerHTML = '';
  const today = new Date();
  const windowMonths = parseInt(document.getElementById('mob-booking-window')?.value || '24');
  const maxDate = new Date(today.getFullYear(), today.getMonth() + windowMonths, today.getDate());

  for (let offset = 0; offset < 3; offset++) {
    let y = mobCalYear, m = mobCalMonth + offset;
    while (m > 11) { m -= 12; y++; }

    const monthWrap = document.createElement('div');
    monthWrap.style.cssText = 'background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:8px;padding:.5rem;';

    const header = document.createElement('div');
    header.style.cssText = 'font-family:"Space Mono",monospace;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--white);margin-bottom:.5rem;text-align:center;';
    header.textContent = CAL_MONTHS[m] + ' ' + y;
    monthWrap.appendChild(header);

    const labelRow = document.createElement('div');
    labelRow.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:2px;';
    DAY_LABELS.forEach(l => {
      const lbl = document.createElement('div');
      lbl.style.cssText = 'text-align:center;font-family:"Space Mono",monospace;font-size:.5rem;color:var(--muted);padding:.15rem 0;';
      lbl.textContent = l;
      labelRow.appendChild(lbl);
    });
    monthWrap.appendChild(labelRow);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:2px;';
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const defaultPerDay = parseInt(document.getElementById('mob-bookings-per-day')?.value || '1');

    for (let i = 0; i < firstDay; i++) grid.appendChild(document.createElement('div'));

    for (let d = 1; d <= daysInMonth; d++) {
      const key = mobCalKey(y, m, d);
      const dayData = mobBookingDays[key] || {};
      const dateObj = new Date(y, m, d);
      const isPast = dateObj < new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const isBeyondWindow = dateObj > maxDate;
      const isBooked = dayData.booked;
      const isUnavail = dayData.unavailable;
      const bookingsLeft = dayData.bookings_available != null ? dayData.bookings_available : defaultPerDay;
      const isFullyBooked = !isBooked && !isUnavail && bookingsLeft <= 0;
      const isEdited = !isBooked && !isUnavail && mobBookingDays[key] && Object.keys(mobBookingDays[key]).length > 0;

      const cell = document.createElement('div');
      let bg = 'rgba(0,245,196,.04)', border = 'rgba(0,245,196,.2)', numColor = 'var(--white)';
      if (isPast || isBeyondWindow) { bg = 'rgba(255,255,255,.02)'; border = 'rgba(30,30,48,.5)'; numColor = 'var(--muted)'; }
      if (isBooked) { bg = 'rgba(255,95,95,.08)'; border = 'rgba(255,95,95,.4)'; numColor = '#ff5f5f'; }
      if (isUnavail) { bg = 'rgba(107,107,136,.08)'; border = 'rgba(107,107,136,.4)'; numColor = 'var(--muted)'; }
      if (isFullyBooked) { bg = 'rgba(255,179,71,.06)'; border = 'rgba(255,179,71,.3)'; numColor = '#ffb347'; }
      cell.style.cssText = `position:relative;border-radius:5px;padding:4px 2px 2px;text-align:center;border:1px solid ${border};background:${bg};min-height:52px;`;

      const perDayLabel = '';

      // Edited label — owner only indicator
      const editedDot = isEdited ? `<span style="position:absolute;bottom:3px;left:50%;transform:translateX(-50%);font-family:'Space Mono',monospace;font-size:.38rem;letter-spacing:.04em;text-transform:uppercase;color:var(--neon);opacity:.9;white-space:nowrap;">edited</span>` : '';

      cell.innerHTML = `<div style="font-size:.72rem;color:${numColor};line-height:1.2;">${d}</div>${perDayLabel}
        ${!isPast && !isBeyondWindow ? `
          ${!isBooked ? `<button type="button" onclick="mobQuickMark('${key}')" title="${isUnavail ? 'Mark available' : 'Mark unavailable'}"
            style="position:absolute;bottom:3px;left:2px;background:transparent;border:none;color:${isUnavail ? 'var(--neon)' : 'rgba(255,255,255,.2)'};cursor:pointer;font-size:.65rem;padding:0;line-height:1;font-weight:700;">${isUnavail ? '✓' : '✕'}</button>` : ''}
          <button type="button" onclick="mobOpenDayEditor('${key}')" title="Edit day"
            style="position:absolute;bottom:3px;right:2px;background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:.65rem;padding:0;line-height:1;">✏️</button>
          ${editedDot}
        ` : ''}`;
      grid.appendChild(cell);
    }
    monthWrap.appendChild(grid);
    container.appendChild(monthWrap);
  }
}

function mobQuickMark(key) {
  if (mobBookingDays[key] && mobBookingDays[key].booked) return;
  if (mobBookingDays[key] && mobBookingDays[key].unavailable) {
    delete mobBookingDays[key];
  } else {
    mobBookingDays[key] = { unavailable: true };
  }
  renderMobCal();
  mobAutoSaveCalendar();
}

function mobCalPrev() { mobCalMonth -= 3; while (mobCalMonth < 0) { mobCalMonth += 12; mobCalYear--; } renderMobCal(); }
function mobCalNext() { mobCalMonth += 3; while (mobCalMonth > 11) { mobCalMonth -= 12; mobCalYear++; } renderMobCal(); }

function mobOpenDayEditor(key) {
  const d = mobBookingDays[key] || {};
  const defaultPerDay = parseInt(document.getElementById('mob-bookings-per-day')?.value || '1');
  const [y, m, day] = key.split('-').map(Number);
  const dateObj = new Date(y, m - 1, day);
  const formattedDate = dateObj.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
  const currentPerDay = d.bookings_available != null ? d.bookings_available : defaultPerDay;

  const existing = document.getElementById('mob-day-editor-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'mob-day-editor-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:1.5rem;';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.75rem;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
        <div style="font-family:'Space Mono',monospace;font-size:.72rem;letter-spacing:.06em;color:var(--neon);">${formattedDate}</div>
        <button type="button" onclick="document.getElementById('mob-day-editor-modal').remove()" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:1.2rem;">✕</button>
      </div>

      <div style="margin-bottom:1rem;display:flex;flex-direction:column;gap:.5rem;">
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;">
          <input type="radio" name="mob-day-status" value="available" ${!d.booked && !d.unavailable ? 'checked' : ''} style="accent-color:var(--neon);" onchange="mobToggleDayStatus()">
          <span style="font-size:.85rem;color:var(--white);">Available</span>
        </label>
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;">
          <input type="radio" name="mob-day-status" value="unavailable" ${d.unavailable ? 'checked' : ''} style="accent-color:var(--muted);" onchange="mobToggleDayStatus()">
          <span style="font-size:.85rem;color:var(--muted);">Unavailable</span>
        </label>
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;">
          <input type="radio" name="mob-day-status" value="booked" ${d.booked ? 'checked' : ''} style="accent-color:#ff5f5f;" onchange="mobToggleDayStatus()">
          <span style="font-size:.85rem;color:#ff5f5f;">Booked</span>
        </label>
      </div>

      <!-- Available fields -->
      <div id="mob-day-avail-fields" style="${!d.booked && !d.unavailable ? '' : 'display:none;'}">
        <div style="margin-bottom:.75rem;">
          <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--neon);display:block;margin-bottom:.35rem;">Bookings available this day</label>
          <input type="number" id="mob-day-bookings" min="0" max="99" value="${currentPerDay}" style="width:80px;background:var(--deep);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-family:'Space Mono',monospace;font-size:.8rem;text-align:center;">
          <span style="font-size:.75rem;color:var(--muted);margin-left:.5rem;">Set to 0 to mark as unavailable</span>
        </div>
      </div>

      <!-- Booked fields -->
      <div id="mob-day-booked-fields" style="${d.booked ? '' : 'display:none;'}">
        <div style="margin-bottom:.75rem;">
          <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.35rem;">Event Name</label>
          <input type="text" id="mob-day-event-name" placeholder="Wedding Reception, Birthday Party..." value="${d.eventName||''}" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
        </div>
        <div style="margin-bottom:.75rem;">
          <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;margin-bottom:.35rem;">
            <input type="checkbox" id="mob-day-private" ${d.location==='Private'?'checked':''} style="accent-color:var(--neon);">
            <span style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);">Private Location</span>
          </label>
          <input type="text" id="mob-day-location" placeholder="Location" value="${d.location !== 'Private' ? (d.location||'') : ''}" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
        </div>
        <div style="display:flex;gap:.75rem;margin-bottom:.75rem;">
          <div style="flex:1;">
            <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.35rem;">Start Time</label>
            <input type="time" id="mob-day-start" value="${d.startTime||''}" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
          </div>
          <div style="flex:1;">
            <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.35rem;">End Time</label>
            <input type="time" id="mob-day-end" value="${d.endTime||''}" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
          </div>
        </div>
      </div>

      <div style="display:flex;gap:.75rem;margin-top:1rem;">
        <button type="button" onclick="document.getElementById('mob-day-editor-modal').remove()" style="flex:1;padding:.75rem;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--muted);font-family:'Space Mono',monospace;font-size:.62rem;cursor:pointer;">Cancel</button>
        <button type="button" onclick="mobSaveDayEditor('${key}')" style="flex:1;padding:.75rem;background:var(--neon);border:none;border-radius:6px;color:var(--black);font-family:'Space Mono',monospace;font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;">Save Day</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function mobToggleDayStatus() {
  const val = document.querySelector('input[name="mob-day-status"]:checked')?.value;
  document.getElementById('mob-day-avail-fields').style.display = val === 'available' ? '' : 'none';
  document.getElementById('mob-day-booked-fields').style.display = val === 'booked' ? '' : 'none';
}

function mobSaveDayEditor(key) {
  const statusVal = document.querySelector('input[name="mob-day-status"]:checked')?.value;
  const defaultPerDay = parseInt(document.getElementById('mob-bookings-per-day')?.value || '1');
  if (statusVal === 'unavailable') {
    mobBookingDays[key] = { unavailable: true };
  } else if (statusVal === 'booked') {
    const isPrivate = document.getElementById('mob-day-private').checked;
    mobBookingDays[key] = {
      booked: true,
      eventName: document.getElementById('mob-day-event-name').value.trim(),
      location: isPrivate ? 'Private' : document.getElementById('mob-day-location').value.trim(),
      startTime: document.getElementById('mob-day-start').value,
      endTime: document.getElementById('mob-day-end').value,
    };
  } else {
    const perDay = parseInt(document.getElementById('mob-day-bookings')?.value || defaultPerDay);
    if (perDay <= 0) {
      mobBookingDays[key] = { unavailable: true };
    } else if (perDay !== defaultPerDay) {
      mobBookingDays[key] = { bookings_available: perDay };
    } else {
      delete mobBookingDays[key];
    }
  }
  document.getElementById('mob-day-editor-modal').remove();
  renderMobCal();
  mobAutoSaveCalendar();
}

async function mobAutoSaveCalendar() {
  try {
    const { data: current } = await db.from('users').select('booking_settings').eq('id', currentUser.id).single();
    const bs = current && current.booking_settings ? (typeof current.booking_settings === 'string' ? JSON.parse(current.booking_settings) : current.booking_settings) : {};
    bs.mob_booking_days = mobBookingDays;
    await updateUserRow({ booking_settings: JSON.stringify(bs) });
  } catch(e) { console.error('mobAutoSaveCalendar error:', e); }
}

async function mobAutoSave() {
  try {
    const { data: current } = await db.from('users').select('booking_settings').eq('id', currentUser.id).single();
    const bs = current && current.booking_settings ? (typeof current.booking_settings === 'string' ? JSON.parse(current.booking_settings) : current.booking_settings) : {};
    bs.mob_booking_window = parseInt(document.getElementById('mob-booking-window')?.value || '24');
    bs.mob_bookings_per_day = parseInt(document.getElementById('mob-bookings-per-day')?.value || '1');
    bs.mob_deposit_pct = parseInt(document.getElementById('mob-deposit-pct')?.value || '0');
    await updateUserRow({ booking_settings: JSON.stringify(bs) });
  } catch(e) { console.error('mobAutoSave error:', e); }
}

// ── MOBILE PACKAGES ───────────────────────────────────────

const PKG_SETUP_HOURS = ['1','2','3','4','5'];

function renderMobPackageTabs(fromCheckboxes) {
  if (fromCheckboxes) mobSelectedTypes = getMobTypesFromProfile();
  if (!mobSelectedTypes || mobSelectedTypes.length === 0) {
    const fromCbs = getMobTypesFromProfile();
    if (fromCbs.length > 0) mobSelectedTypes = fromCbs;
  }
  const cats = getMobActiveCategories();
  const tabsEl = document.getElementById('pkg-cat-tabs');
  const noTypesMsg = document.getElementById('pkg-no-types-msg');

  // Hide outer tabs — navigation is now inside each package card
  if (tabsEl) tabsEl.style.display = 'none';
  ['general','wedding','mitzvah'].forEach(c => {
    const p = document.getElementById('pkg-pane-' + c);
    if (p) p.style.display = 'none';
  });

  if (cats.length === 0) {
    if (noTypesMsg) noTypesMsg.style.display = 'block';
    return;
  }
  if (noTypesMsg) noTypesMsg.style.display = 'none';

  // Always render into the general pane (single container)
  const generalPane = document.getElementById('pkg-pane-general');
  if (generalPane) generalPane.style.display = '';
  renderMobPackages('general');
}

function switchPkgCat(cat) {
  // No-op — outer tabs removed, inner tabs handle navigation
}

function renderMobPackages(cat) {
  const pane = document.getElementById('pkg-pane-' + cat);
  if (!pane) return;
  pane.innerHTML = '';

  const catPkgs = (mobPackages[cat] || []).filter(p => p && p.title && p.title.trim());
  if ((cat === 'wedding' || cat === 'mitzvah') && catPkgs.length === 0) {
    const catName = cat === 'wedding' ? 'Wedding' : 'Bar/Bat Mitzvah';
    const notice = document.createElement('div');
    notice.style.cssText = 'display:flex;align-items:flex-start;gap:.6rem;padding:.75rem 1rem;background:rgba(255,95,95,.08);border:1px solid rgba(255,95,95,.3);border-radius:8px;margin-bottom:1rem;';
    notice.innerHTML = `<span style="color:#ff5f5f;font-size:1rem;flex-shrink:0;line-height:1.4;">⚠</span><span style="font-size:.8rem;color:#ff5f5f;line-height:1.5;">Please add at least one package to begin accepting ${catName} bookings.</span>`;
    pane.appendChild(notice);
  }

  // Sync all active categories to the same package count first
  const activeCats = getMobActiveCategories();
  const maxLen = Math.max(...activeCats.map(c => (mobPackages[c]||[]).length), 1);
  activeCats.forEach(c => {
    if (!mobPackages[c]) mobPackages[c] = [];
    while (mobPackages[c].length < maxLen) mobPackages[c].push(newMobPackage());
  });
  if (!mobPackages[cat] || mobPackages[cat].length === 0) mobPackages[cat] = [newMobPackage()];
  mobPackages[cat].forEach((pkg, idx) => pane.appendChild(buildPkgCard(cat, idx, pkg)));

  if (mobPackages[cat].length < 10) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.style.cssText = 'margin-top:.75rem;width:100%;padding:.65rem;background:transparent;border:1px dashed var(--border);border-radius:6px;color:var(--muted);font-family:"Space Mono",monospace;font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;';
    addBtn.textContent = '+ Add Another Package';
    addBtn.onmouseover = () => { addBtn.style.borderColor = 'var(--neon)'; addBtn.style.color = 'var(--neon)'; };
    addBtn.onmouseout = () => { addBtn.style.borderColor = 'var(--border)'; addBtn.style.color = 'var(--muted)'; };
    addBtn.onclick = () => {
      const activeCats = getMobActiveCategories();
      activeCats.forEach(c => {
        if (!mobPackages[c]) mobPackages[c] = [];
        // Pad any shorter cats to match before adding
        while (mobPackages[c].length < mobPackages[cat].length) mobPackages[c].push(newMobPackage());
        mobPackages[c].push(newMobPackage());
      });
      renderMobPackages(cat);
    };
    pane.appendChild(addBtn);
  }
}

function newMobPackage() {
  return { title:'', details:'', price4:'', price5:'', price6:'', overtime:'', reqAll:false, setupHours:'', photo:'', cocktailIncluded:true, cocktailPrice:'' };
}

function buildPkgCard(cat, idx, pkg) {
  const isWedding = cat === 'wedding';
  const activeCats = getMobActiveCategories();
  const catLabels = { general: 'General', wedding: 'Wedding', mitzvah: 'Bar/Bat Mitzvah' };
  const card = document.createElement('div');
  card.style.cssText = 'background:rgba(10,10,16,.6);border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:.75rem;';

  const headerRow = document.createElement('div');
  headerRow.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;margin-bottom:1.25rem;padding-bottom:.3rem;border-bottom:1px solid rgba(0,245,196,.3);';
  headerRow.innerHTML = `
    <div style="font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:.08em;color:var(--neon);text-align:center;">Package ${idx + 1}</div>
    ${idx > 0 ? `<button type="button" onclick="removeMobPackage('${cat}',${idx})" style="position:absolute;right:0;background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:.85rem;" title="Remove package">✕</button>` : ''}
  `;
  card.appendChild(headerRow);

  // Category tabs inside card — all packages when multiple active categories
  if (activeCats.length > 1) {
    const MOB_GENERAL_EVENT_NAMES = {
      birthday:'Birthday Parties', graduation:'Graduations', holiday:'Holiday Parties',
      community:'Community Events', corporate:'Corporate Events', anniversary:'Anniversaries',
      sweet16:'Sweet 16 / Quinceañera', reunion:'Reunions', school:'School Events', other:'Other'
    };
    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;gap:.35rem;margin-bottom:1rem;background:rgba(10,10,16,.6);padding:3px;border-radius:7px;border:1px solid var(--border);overflow-x:auto;';

    activeCats.forEach((c, ci) => {
      const tabBtn = document.createElement('button');
      tabBtn.type = 'button';
      tabBtn.dataset.internalCat = c;
      const isFirst = ci === 0;
      tabBtn.style.cssText = `flex:1;padding:.45rem .5rem;border:${isFirst?'1px solid var(--neon)':'1px solid transparent'};border-radius:5px;font-family:"Space Mono",monospace;font-size:.6rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;white-space:nowrap;background:${isFirst?'var(--neon-dim)':'transparent'};color:${isFirst?'var(--neon)':'var(--muted)'};transition:all .15s;display:flex;align-items:center;justify-content:center;gap:.3rem;`;
      tabBtn.onclick = () => switchInternalPkgTab(cat, idx, c, tabBtn);

      // Exclamation badge for wedding/mitzvah with no saved packages
      const catPkgs = (mobPackages[c] || []).filter(p => p && p.title && p.title.trim());
      const needsAttention = (c === 'wedding' || c === 'mitzvah') && catPkgs.length === 0;
      const alertBadge = needsAttention
        ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;background:#ff5f5f;color:#fff;font-size:.6rem;font-weight:900;clip-path:polygon(50% 0%,100% 100%,0% 100%);flex-shrink:0;">!</span>`
        : '';

      if (c === 'general') {
        const generalTypes = mobSelectedTypes.filter(t => MOB_CAT_GENERAL_TYPES.includes(t));
        const typeList = generalTypes.map(t => MOB_GENERAL_EVENT_NAMES[t] || t).join(', ') || 'All general events';
        tabBtn.innerHTML = `<span>${catLabels[c]}</span>
          ${alertBadge}
          <span style="position:relative;display:inline-flex;align-items:center;"
            onmouseenter="this.querySelector('.pkg-cat-tip').style.display='block';event.stopPropagation();"
            onmouseleave="this.querySelector('.pkg-cat-tip').style.display='none';"
            onmousemove="var t=this.querySelector('.pkg-cat-tip');t.style.top=(event.clientY-t.offsetHeight-10)+'px';t.style.left=event.clientX+'px';"
            onclick="event.stopPropagation();">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1px solid currentColor;font-size:.55rem;cursor:default;opacity:.8;flex-shrink:0;">i</span>
            <span class="pkg-cat-tip" style="display:none;position:fixed;background:var(--card);border:1px solid var(--neon);border-radius:8px;padding:.65rem .9rem;font-size:.75rem;color:var(--white);z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.6);font-family:'DM Sans',sans-serif;font-weight:400;text-transform:none;letter-spacing:0;max-width:240px;white-space:normal;line-height:1.6;">${typeList}</span>
          </span>`;
      } else {
        tabBtn.innerHTML = `<span>${catLabels[c]}</span>${alertBadge}`;
      }

      tabBar.appendChild(tabBtn);
    });
    card.appendChild(tabBar);
  }

  if (activeCats.length > 1) {
    activeCats.forEach((c, ci) => {
      const paneDiv = document.createElement('div');
      paneDiv.id = `inner-pkg-pane-${cat}-${idx}-${c}`;
      paneDiv.style.display = ci === 0 ? '' : 'none';
      buildCatPane(paneDiv, c, idx);
      card.appendChild(paneDiv);
    });
  } else {
    const pricePane = document.createElement('div');
    buildCatPane(pricePane, cat, idx);
    card.appendChild(pricePane);
  }

  const saveRow = document.createElement('div');
  saveRow.style.cssText = 'margin-top:.75rem;display:flex;align-items:center;gap:.75rem;';
  saveRow.innerHTML = `
    <button type="button" onclick="mobSavePackages('${cat}',${idx},this)" style="padding:.5rem 1.1rem;background:var(--neon);border:none;border-radius:6px;color:var(--black);font-family:'Space Mono',monospace;font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;">Save Package</button>
    <span id="mob-pkg-save-${cat}-${idx}" style="font-family:'Space Mono',monospace;font-size:.6rem;color:var(--neon);"></span>`;
  card.appendChild(saveRow);

  return card;
}

function buildCatPane(container, cat, idx) {
  const pkg = (mobPackages[cat] && mobPackages[cat][idx]) ? mobPackages[cat][idx] : newMobPackage();
  const btnStyle = `padding:.2rem .45rem;background:var(--card);border:1px solid var(--border);border-radius:4px;color:var(--white);font-size:.72rem;cursor:pointer;line-height:1;`;
  const editorId = `pkg-editor-${cat}-${idx}`;
  const photoBoxId = `pkg-photo-box-${cat}-${idx}`;
  const photoPreviewId = `pkg-photo-preview-${cat}-${idx}`;
  const photoStatusId = `pkg-photo-status-${cat}-${idx}`;

  // Title
  container.appendChild(pkgField('Package Title <span style="color:#ff5f5f;">*</span>', `<input type="text" placeholder="e.g. Essentials, Gold, Premium" value="${escHtml(pkg.title||'')}" onchange="mobPkgChange('${cat}',${idx},'title',this.value)" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">`));

  // Details
  const detailWrap = document.createElement('div');
  detailWrap.style.marginBottom = '.75rem';
  detailWrap.innerHTML = `<label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.35rem;">Package Details <span style="color:#ff5f5f;">*</span></label>
    <div style="display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.35rem;align-items:center;">
      <button type="button" onclick="pkgCmd('bold','${editorId}')" style="${btnStyle}font-weight:700;">B</button>
      <button type="button" onclick="pkgCmd('italic','${editorId}')" style="${btnStyle}font-style:italic;">I</button>
      <button type="button" onclick="pkgCmd('underline','${editorId}')" style="${btnStyle}text-decoration:underline;">U</button>
      <span style="width:1px;height:18px;background:var(--border);margin:0 2px;"></span>
      <button type="button" onclick="pkgCmd('insertUnorderedList','${editorId}')" style="${btnStyle}">• List</button>
      <button type="button" onclick="pkgCheckList('${editorId}')" style="${btnStyle}color:var(--neon);">✓ List</button>
      <button type="button" onclick="pkgCmd('insertOrderedList','${editorId}')" style="${btnStyle}">1. List</button>
      <span style="width:1px;height:18px;background:var(--border);margin:0 2px;"></span>
      <select id="font-sel-${cat}-${idx}" onchange="pkgFont(this,'${editorId}')" style="padding:.22rem .4rem;background:var(--card);border:1px solid var(--border);border-radius:4px;color:var(--white);font-size:.72rem;cursor:pointer;outline:none;min-width:90px;">
        <option value="">Font</option>
        <option value="DM Sans, sans-serif">DM Sans</option>
        <option value="Georgia, serif">Georgia</option>
        <option value="Space Mono, monospace">Mono</option>
        <option value="Arial, sans-serif">Arial</option>
        <option value="Times New Roman, serif">Times</option>
      </select>
    </div>
    <div id="${editorId}" contenteditable="true" data-cat="${cat}" data-idx="${idx}" oninput="mobPkgChange('${cat}',${idx},'details',this.innerHTML)" style="min-height:80px;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:1rem 1.1rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;line-height:1.6;outline:none;">${pkg.details||''}</div>`;
  container.appendChild(detailWrap);

  // Pricing
  buildPricingSection(container, cat, idx);

  // Setup hours
  const setupWrap = document.createElement('div');
  setupWrap.style.cssText = 'display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem;';
  setupWrap.innerHTML = `
    <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);">The number of hours required to set up prior to event start time:</label>
    <select onchange="mobPkgChange('${cat}',${idx},'setupHours',this.value)" style="background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.4rem .6rem;color:var(--white);font-family:'Space Mono',monospace;font-size:.7rem;cursor:pointer;">
      <option value="">—</option>
      ${PKG_SETUP_HOURS.map(h => `<option value="${h}" ${pkg.setupHours===h?'selected':''}>${h} hr${h==='1'?'':'s'}</option>`).join('')}
    </select>`;
  container.appendChild(setupWrap);

  // Photo
  const photoWrap = document.createElement('div');
  photoWrap.style.marginBottom = '.5rem';
  photoWrap.innerHTML = `
    <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.35rem;">Package Setup Photo</label>
    ${pkg.photo ? `
    <div id="${photoBoxId}" style="display:flex;align-items:center;gap:.75rem;">
      <img src="${escHtml(pkg.photo)}" alt="Package photo" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border);flex-shrink:0;">
      <div style="display:flex;flex-direction:column;gap:.4rem;">
        <label style="display:inline-flex;align-items:center;gap:.4rem;padding:.4rem .75rem;background:var(--neon-dim);border:1px solid var(--neon);border-radius:5px;cursor:pointer;font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--neon);">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Replace Photo
          <input type="file" accept="image/*" onchange="handlePkgPhotoUpload(this,'${cat}',${idx},'${photoPreviewId}','${photoStatusId}','${photoBoxId}')" style="display:none;">
        </label>
        <button type="button" onclick="removePkgPhoto(event,'${cat}',${idx},'${photoPreviewId}','${photoBoxId}')" style="display:inline-flex;align-items:center;gap:.4rem;padding:.4rem .75rem;background:transparent;border:1px solid rgba(255,95,95,.3);border-radius:5px;cursor:pointer;font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:#ff5f5f;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Remove
        </button>
      </div>
    </div>
    <div id="${photoPreviewId}" style="display:none;"></div>` : `
    <div class="upload-box" id="${photoBoxId}" style="position:relative;border:2px dashed var(--border);border-radius:6px;cursor:pointer;overflow:hidden;background:var(--deep);">
      <input type="file" accept="image/*" onchange="handlePkgPhotoUpload(this,'${cat}',${idx},'${photoPreviewId}','${photoStatusId}','${photoBoxId}')" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;z-index:2;">
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1.25rem .75rem;gap:.4rem;min-height:90px;pointer-events:none;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--muted);opacity:.6;"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        <span style="font-family:'Space Mono',monospace;font-size:.62rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);">Click to upload photo</span>
        <span style="font-size:.68rem;color:var(--muted);">JPG, PNG, WebP</span>
      </div>
      <div id="${photoPreviewId}" style="display:none;position:relative;">
        <img src="" alt="Package photo" style="width:100%;max-height:140px;object-fit:cover;display:block;">
      </div>
    </div>`}
    <div id="${photoStatusId}" class="upload-status"></div>`;
  container.appendChild(photoWrap);
}

function buildPricingSection(container, cat, idx) {
  const pkg = (mobPackages[cat] && mobPackages[cat][idx]) ? mobPackages[cat][idx] : newMobPackage();
  const isWedding = cat === 'wedding';
  const priceLabel = isWedding ? 'Reception' : '';
  const reqAll = !!(pkg.reqAll);

  const priceWrap = document.createElement('div');
  priceWrap.style.marginBottom = '.75rem';
  priceWrap.innerHTML = `<label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.5rem;">Pricing <span style="color:#ff5f5f;">*</span></label>`;

  ['4','5','6'].forEach(hrs => {
    const priceField = `price${hrs}`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem;';
    row.innerHTML = `
      <span style="font-family:'Space Mono',monospace;font-size:.6rem;color:var(--muted);white-space:nowrap;min-width:80px;">${hrs} Hour Event${isWedding && priceLabel ? ' ('+priceLabel+')' : ''}:</span>
      <span style="color:var(--muted);font-size:.85rem;${reqAll?'opacity:.35;':''}">$</span>
      <input type="number" min="0" placeholder="0" value="${escHtml(String(pkg[priceField]||''))}" ${reqAll?'disabled':''} onchange="mobPkgChange('${cat}',${idx},'${priceField}',this.value)" style="flex:1;max-width:120px;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.4rem .6rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;${reqAll?'opacity:.35;':''}" id="mob-pkg-price-${cat}-${idx}-${hrs}">`;
    priceWrap.appendChild(row);
  });

  const reqToggleRow = document.createElement('div');
  reqToggleRow.style.cssText = 'display:flex;align-items:center;gap:.6rem;margin-top:.6rem;margin-bottom:.6rem;padding:.55rem .75rem;background:rgba(107,107,136,.08);border:1px solid rgba(107,107,136,.2);border-radius:6px;cursor:pointer;';
  reqToggleRow.innerHTML = `
    <input type="checkbox" id="mob-pkg-reqall-${cat}-${idx}" ${reqAll?'checked':''} onchange="mobPkgReqAllToggle('${cat}',${idx},this.checked)" style="accent-color:var(--neon);width:15px;height:15px;flex-shrink:0;">
    <label for="mob-pkg-reqall-${cat}-${idx}" style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);cursor:pointer;line-height:1.4;">Require event host to request price</label>`;
  priceWrap.appendChild(reqToggleRow);

  const otRow = document.createElement('div');
  otRow.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:.5rem;margin-top:.25rem;';
  otRow.innerHTML = `
    <span style="font-family:'Space Mono',monospace;font-size:.6rem;color:var(--muted);white-space:nowrap;min-width:80px;${reqAll?'opacity:.35;':''}">Hourly Overtime:</span>
    <div style="display:flex;align-items:center;gap:.5rem;flex:1;">
      <span style="color:var(--muted);font-size:.85rem;${reqAll?'opacity:.35;':''}">$</span>
      <input type="number" min="0" placeholder="0" value="${escHtml(String(pkg.overtime||''))}" ${reqAll?'disabled':''} id="mob-pkg-ot-${cat}-${idx}" onchange="mobPkgChange('${cat}',${idx},'overtime',this.value)" style="flex:1;max-width:120px;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.4rem .6rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;${reqAll?'opacity:.35;':''}">
      <span style="font-family:'Space Mono',monospace;font-size:.58rem;color:var(--neon);white-space:nowrap;letter-spacing:.06em;text-transform:uppercase;${reqAll?'opacity:.35;':''}">Per Hour</span>
    </div>`;
  priceWrap.appendChild(otRow);
  container.appendChild(priceWrap);

  if (isWedding) {
    const cocktailWrap = document.createElement('div');
    cocktailWrap.id = `mob-pkg-cocktail-wrap-${cat}-${idx}`;
    cocktailWrap.style.cssText = `margin-bottom:.75rem;padding:.75rem;background:rgba(0,245,196,.04);border:1px solid rgba(0,245,196,.12);border-radius:6px;${reqAll?'display:none;':''}`;
    const incl = pkg.cocktailIncluded !== false;
    cocktailWrap.innerHTML = `
      <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;margin-bottom:${incl?'0':'.6rem'};">
        <input type="checkbox" ${incl?'checked':''} onchange="mobPkgChange('${cat}',${idx},'cocktailIncluded',this.checked);this.closest('[style]').querySelector('.cocktail-price-wrap').style.display=this.checked?'none':'';" style="accent-color:var(--neon);">
        <span style="font-size:.82rem;color:var(--white);">Cocktail hour music included in reception price?</span>
      </label>
      <div class="cocktail-price-wrap" style="${incl?'display:none;':''}margin-top:.5rem;display:flex;align-items:center;gap:.5rem;">
        <span style="font-family:'Space Mono',monospace;font-size:.6rem;color:var(--muted);white-space:nowrap;">Cocktail Hour Price:</span>
        <span style="color:var(--muted);font-size:.85rem;">$</span>
        <input type="number" min="0" placeholder="0" value="${escHtml(String(pkg.cocktailPrice||''))}" id="mob-pkg-cocktail-price-${cat}-${idx}" onchange="mobPkgChange('${cat}',${idx},'cocktailPrice',this.value)" style="flex:1;max-width:120px;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.4rem .6rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
      </div>`;
    container.appendChild(cocktailWrap);
  }
}

function switchInternalPkgTab(outerCat, idx, selectedCat, clickedBtn) {
  const activeCats = getMobActiveCategories();
  // Update tab button styles using the tab bar parent
  const tabBar = clickedBtn.parentElement;
  if (tabBar) {
    tabBar.querySelectorAll('button[data-internal-cat]').forEach(btn => {
      const active = btn.dataset.internalCat === selectedCat;
      btn.style.background = active ? 'var(--neon-dim)' : 'transparent';
      btn.style.color = active ? 'var(--neon)' : 'var(--muted)';
      btn.style.border = active ? '1px solid var(--neon)' : '1px solid transparent';
    });
  }
  // Show/hide panes
  activeCats.forEach(c => {
    const pane = document.getElementById(`inner-pkg-pane-${outerCat}-${idx}-${c}`);
    if (pane) pane.style.display = c === selectedCat ? '' : 'none';
  });
}

function removeMobPackage(cat, idx) {
  getMobActiveCategories().forEach(c => {
    if (mobPackages[c] && mobPackages[c].length > idx) mobPackages[c].splice(idx, 1);
  });
  renderMobPackages(cat);
}

async function handlePkgPhotoUpload(input, cat, idx, previewId, statusId, boxId) {
  const file = input.files[0];
  if (!file || !currentUser) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const path = currentUser.id + '/packages/pkg_' + cat + '_' + idx + '_' + Date.now() + '.' + ext;
  const pkgStorageUrl = SUPABASE_URL + '/storage/v1/object/avatars/';
  const pkgPublicUrl  = SUPABASE_URL + '/storage/v1/object/public/avatars/';
  const statusEl = document.getElementById(statusId);
  if (statusEl) { statusEl.textContent = 'Uploading...'; statusEl.className = 'upload-status uploading'; }
  try {
    const res = await fetch(pkgStorageUrl + path, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + SUPABASE_KEY, 'apikey': SUPABASE_KEY, 'Content-Type': file.type, 'x-upsert': 'true' },
      body: file
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Upload failed'); }
    const publicUrl = pkgPublicUrl + path + '?t=' + Date.now();
    mobPkgChange(cat, idx, 'photo', publicUrl);
    const box = document.getElementById(boxId);
    if (box) {
      box.innerHTML = `
        <img src="${publicUrl}" alt="Package photo" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border);flex-shrink:0;">
        <div style="display:flex;flex-direction:column;gap:.4rem;">
          <label style="display:inline-flex;align-items:center;gap:.4rem;padding:.4rem .75rem;background:var(--neon-dim);border:1px solid var(--neon);border-radius:5px;cursor:pointer;font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--neon);">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Replace Photo
            <input type="file" accept="image/*" onchange="handlePkgPhotoUpload(this,'${cat}',${idx},'${previewId}','${statusId}','${boxId}')" style="display:none;">
          </label>
          <button type="button" onclick="removePkgPhoto(event,'${cat}',${idx},'${previewId}','${boxId}')" style="display:inline-flex;align-items:center;gap:.4rem;padding:.4rem .75rem;background:transparent;border:1px solid rgba(255,95,95,.3);border-radius:5px;cursor:pointer;font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:#ff5f5f;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Remove
          </button>
        </div>`;
      box.style.cssText = 'display:flex;align-items:center;gap:.75rem;';
      box.className = '';
    }
    if (statusEl) { statusEl.textContent = '✓ Uploaded'; statusEl.className = 'upload-status done'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
  } catch(err) {
    if (statusEl) { statusEl.textContent = '✗ ' + err.message; statusEl.className = 'upload-status error'; }
  }
}

function removePkgPhoto(e, cat, idx, previewId, boxId) {
  e.stopPropagation();
  mobPkgChange(cat, idx, 'photo', '');
  const box = document.getElementById(boxId);
  if (box) {
    box.className = 'upload-box';
    box.style.cssText = 'position:relative;border:2px dashed var(--border);border-radius:6px;cursor:pointer;overflow:hidden;background:var(--deep);';
    box.innerHTML = `
      <input type="file" accept="image/*" onchange="handlePkgPhotoUpload(this,'${cat}',${idx},'${previewId}','pkg-photo-status-${cat}-${idx}','${boxId}')" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;z-index:2;">
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1.25rem .75rem;gap:.4rem;min-height:90px;pointer-events:none;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--muted);opacity:.6;"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        <span style="font-family:'Space Mono',monospace;font-size:.62rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);">Click to upload photo</span>
        <span style="font-size:.68rem;color:var(--muted);">JPG, PNG, WebP</span>
      </div>
      <div id="${previewId}" style="display:none;"></div>`;
  }
}

function pkgCmd(cmd, editorId) {
  const el = document.getElementById(editorId);
  if (el) el.focus();
  document.execCommand(cmd, false, null);
}

// Insert (or toggle) a checkmark-styled bulleted list. Uses execCommand('insertUnorderedList')
// and then finds the enclosing <ul> at the selection and stamps class="gdj-check-list"
// so both the editor preview and the public booking page can render it as a ✓ list.
function pkgCheckList(editorId) {
  const el = document.getElementById(editorId);
  if (!el) return;
  el.focus();
  // Find the <ul> the selection is inside (if any) BEFORE running the command
  const getContainingUL = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let node = sel.anchorNode;
    if (!node) return null;
    if (node.nodeType === 3) node = node.parentElement;
    while (node && node !== el) {
      if (node.tagName === 'UL') return node;
      node = node.parentElement;
    }
    return null;
  };
  const existingUL = getContainingUL();
  if (existingUL) {
    // Already in a UL — toggle the class rather than running the command (which would unwrap it)
    existingUL.classList.toggle('gdj-check-list');
  } else {
    document.execCommand('insertUnorderedList', false, null);
    const newUL = getContainingUL();
    if (newUL) newUL.classList.add('gdj-check-list');
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function pkgFont(select, editorId) {
  const font = select.value;
  select.value = '';
  if (!font) return;
  const el = document.getElementById(editorId);
  if (!el) return;
  el.focus();

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    el.style.fontFamily = font;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  document.execCommand('styleWithCSS', false, true);
  document.execCommand('fontName', false, font);
  el.querySelectorAll('font[face]').forEach(f => {
    const span = document.createElement('span');
    span.style.fontFamily = f.getAttribute('face');
    while (f.firstChild) span.appendChild(f.firstChild);
    f.parentNode.replaceChild(span, f);
  });
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// Sync font dropdown to reflect active font at cursor
const PKG_FONT_MAP = [
  { key: 'DM Sans', val: 'DM Sans, sans-serif' },
  { key: 'Georgia', val: 'Georgia, serif' },
  { key: 'Space Mono', val: 'Space Mono, monospace' },
  { key: 'Arial', val: 'Arial, sans-serif' },
  { key: 'Times New Roman', val: 'Times New Roman, serif' },
];
document.addEventListener('selectionchange', function() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const node = sel.anchorNode;
  if (!node) return;
  const editor = node.nodeType === 3 ? node.parentElement?.closest('[contenteditable]') : node.closest?.('[contenteditable]');
  if (!editor || !editor.id) return;
  const parts = editor.id.split('-'); // pkg-editor-{cat}-{idx}
  if (parts[0] !== 'pkg' || parts[1] !== 'editor') return;
  const cat = parts[2], idx = parts[3];
  const selEl = document.getElementById(`font-sel-${cat}-${idx}`);
  if (!selEl) return;
  const computedFont = window.getComputedStyle(node.nodeType === 3 ? node.parentElement : node).fontFamily;
  const matched = PKG_FONT_MAP.find(f => computedFont.toLowerCase().includes(f.key.toLowerCase()));
  selEl.value = matched ? matched.val : '';
});

function pkgField(labelText, inputHtml) {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = '.75rem';
  wrap.innerHTML = `<label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.35rem;">${labelText}</label>${inputHtml}`;
  return wrap;
}

function escHtml(str) {
  return (str||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function mobPkgChange(cat, idx, field, val) {
  if (!mobPackages[cat]) mobPackages[cat] = [];
  if (!mobPackages[cat][idx]) mobPackages[cat][idx] = newMobPackage();
  if (field === 'cocktailIncluded') val = (val === true || val === 'true');
  mobPackages[cat][idx][field] = val;
  // Flag the form dirty so the "leave site?" warning fires on unsaved edits.
  // Auto-save below only fires when ALL required fields are filled, so without
  // this flag a partial entry would be lost silently if the user navigates away.
  formDirty = true;
  // Auto-save silently if all required fields are filled for the active tab
  mobPkgAutoSave(cat, idx);
}

function hasPrice(val) {
  if (val === null || val === undefined || val === '') return false;
  const n = parseFloat(val);
  return !isNaN(n); // 0 is valid
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

// Returns the currently active inner category tab for a given package card
function getActivePkgCat(outerCat, idx) {
  const activeCats = getMobActiveCategories();
  if (activeCats.length <= 1) return outerCat;
  for (const c of activeCats) {
    const pane = document.getElementById(`inner-pkg-pane-${outerCat}-${idx}-${c}`);
    if (pane && pane.style.display !== 'none') return c;
  }
  return activeCats[0];
}

// Check if a single category's package has all required fields filled
function pkgCatComplete(cat, idx) {
  const p = mobPackages[cat]?.[idx];
  if (!p) return false;
  if (!p.title?.trim()) return false;
  if (!stripHtml(p.details)) return false;
  if (!p.reqAll) {
    if (!hasPrice(p.price4)) return false;
    if (!hasPrice(p.price5)) return false;
    if (!hasPrice(p.price6)) return false;
  }
  return true;
}

// Silently save if the active category's required fields are all filled
let _autoSaveTimers = {};
function mobPkgAutoSave(cat, idx) {
  const activeCat = getActivePkgCat(cat, idx);
  if (!pkgCatComplete(activeCat, idx)) return;
  const key = `${cat}-${idx}`;
  clearTimeout(_autoSaveTimers[key]);
  _autoSaveTimers[key] = setTimeout(async () => {
    try {
      const { data: current } = await db.from('users').select('booking_settings').eq('id', currentUser.id).single();
      const bs = current?.booking_settings ? (typeof current.booking_settings === 'string' ? JSON.parse(current.booking_settings) : current.booking_settings) : {};
      bs.mob_packages = mobPackages;
      await updateUserRow({ booking_settings: JSON.stringify(bs) });
      // Saved successfully — clear the dirty flag so the leave-site warning
      // doesn't fire when the user navigates away.
      formDirty = false;
      const alertEl = document.getElementById(`mob-pkg-save-${cat}-${idx}`);
      if (alertEl) { alertEl.textContent = '✓ Auto-saved'; alertEl.style.color = 'var(--muted)'; setTimeout(() => { if (alertEl) alertEl.textContent = ''; }, 2000); }
    } catch(e) { /* silent fail */ }
  }, 1000);
}

function mobPkgReqAllToggle(cat, idx, checked) {
  mobPkgChange(cat, idx, 'reqAll', checked);
  // Disable/enable all price inputs and overtime
  ['4','5','6'].forEach(hrs => {
    const el = document.getElementById(`mob-pkg-price-${cat}-${idx}-${hrs}`);
    if (el) { el.disabled = checked; el.style.opacity = checked ? '.35' : ''; }
  });
  const ot = document.getElementById(`mob-pkg-ot-${cat}-${idx}`);
  if (ot) { ot.disabled = checked; ot.style.opacity = checked ? '.35' : ''; }
  // Hide/show cocktail block entirely
  const cocktailWrap = document.getElementById(`mob-pkg-cocktail-wrap-${cat}-${idx}`);
  if (cocktailWrap) cocktailWrap.style.display = checked ? 'none' : '';
}

function removeMobPackage(cat, idx) {
  ['general','wedding','mitzvah'].forEach(c => {
    if (mobPackages[c] && mobPackages[c].length > idx) mobPackages[c].splice(idx, 1);
  });
  renderMobPackages(cat);
}

async function mobSavePackages(cat, idx, btn) {
  const alertEl = document.getElementById(`mob-pkg-save-${cat}-${idx}`);
  const activeCat = getActivePkgCat(cat, idx);
  const catLabels = { general: 'General', wedding: 'Wedding', mitzvah: 'Bar/Bat Mitzvah' };
  const errors = [];

  const sharedPkg = mobPackages[activeCat]?.[idx];
  if (!sharedPkg?.title?.trim()) errors.push('Package title is required');
  if (!stripHtml(sharedPkg?.details)) errors.push('Package details are required');

  const p = mobPackages[activeCat]?.[idx];
  if (!p?.reqAll) {
    if (!hasPrice(p?.price4)) errors.push(`${catLabels[activeCat]}: 4 hour price required`);
    if (!hasPrice(p?.price5)) errors.push(`${catLabels[activeCat]}: 5 hour price required`);
    if (!hasPrice(p?.price6)) errors.push(`${catLabels[activeCat]}: 6 hour price required`);
  }

  if (errors.length > 0) {
    if (alertEl) {
      alertEl.innerHTML = errors.map(e => `<div style="color:#ff5f5f;font-size:.75rem;">✕ ${e}</div>`).join('');
      setTimeout(() => { if (alertEl) alertEl.innerHTML = ''; }, 4000);
    }
    return;
  }

  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const { data: current } = await db.from('users').select('booking_settings').eq('id', currentUser.id).single();
    const bs = current && current.booking_settings ? (typeof current.booking_settings === 'string' ? JSON.parse(current.booking_settings) : current.booking_settings) : {};
    bs.mob_packages = mobPackages;
    const _ur = await updateUserRow({ booking_settings: JSON.stringify(bs) }); const error = _ur.ok ? null : { message: _ur.error };
    if (error) throw error;
    // Saved successfully — clear the dirty flag so the leave-site warning
    // doesn't fire when the user navigates away.
    formDirty = false;
    if (alertEl) { alertEl.textContent = '✓ Saved'; alertEl.style.color = 'var(--neon)'; setTimeout(() => { alertEl.textContent = ''; }, 2500); }
    // Refresh tab badges only — don't reset mobSelectedTypes
    // Two places to update: the outer pkg-cat-tabs (hidden but kept in sync)
    // AND the inner card tabs (data-internal-cat) which are what the user
    // actually sees on each package card.
    const updateBadges = (root) => {
      if (!root) return;
      root.querySelectorAll('button[data-cat],button[data-internal-cat]').forEach(btn => {
        const c = btn.dataset.internalCat || btn.dataset.cat;
        const catPkgs = (mobPackages[c] || []).filter(p => p && p.title && p.title.trim());
        const needsAttention = (c === 'wedding' || c === 'mitzvah') && catPkgs.length === 0;
        const badge = btn.querySelector('span[style*="clip-path"]');
        if (needsAttention && !badge) {
          const b = document.createElement('span');
          b.title = 'No packages added yet';
          b.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;background:#ff5f5f;color:#fff;font-size:.6rem;font-weight:900;clip-path:polygon(50% 0%,100% 100%,0% 100%);flex-shrink:0;';
          b.textContent = '!';
          btn.appendChild(b);
        } else if (!needsAttention && badge) {
          badge.remove();
        }
      });
    };
    updateBadges(document.getElementById('pkg-cat-tabs'));
    // Inner card tabs live inside each package card under #pkg-pane-general
    updateBadges(document.getElementById('pkg-pane-general'));
  } catch(e) {
    if (alertEl) { alertEl.textContent = '✗ ' + e.message; alertEl.style.color = 'var(--error)'; }
  }
  btn.disabled = false; btn.textContent = 'Save Package';
}

