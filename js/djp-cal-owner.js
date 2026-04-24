// OWNER CALENDAR: ownerCal* and the day editor
// Extracted from dj-profile.html

let ownerBookingDays = {};
let ownerCalWindowMonths = 12;
let ownerGlobalAllowOffers = false;
let ownerEquipFull = false;
let ownerEquipDecks = false;
let ownerEquipNone = false;
let ownerGlobalRateType = 'flat';
let ownerGlobalRateSystem = '';
let ownerGlobalRateDecks = '';
let ownerGlobalRateNoEquip = '';
let ownerCalYear = new Date().getFullYear();
let ownerCalMonth = new Date().getMonth();
const OWNER_CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function renderOwnerCalendar(bookingDays, globalAllowOffers, equipFull, equipDecks, equipNone, globalRateType, globalRateSystem, globalRateDecks, globalRateNoEquip, bookingWindowMonths) {
  ownerBookingDays = bookingDays || {};
  ownerCalWindowMonths = bookingWindowMonths || 12;
  ownerGlobalAllowOffers = !!globalAllowOffers;
  ownerEquipFull = !!equipFull;
  ownerEquipDecks = !!equipDecks;
  ownerEquipNone = !!equipNone;
  ownerGlobalRateType = globalRateType || 'flat';
  ownerGlobalRateSystem = globalRateSystem || '';
  ownerGlobalRateDecks = globalRateDecks || '';
  ownerGlobalRateNoEquip = globalRateNoEquip || '';
  ownerCalYear = new Date().getFullYear();
  ownerCalMonth = new Date().getMonth();
  const container = document.getElementById('p-booking-calendar');
  if (!container) return;

  // Build month and year dropdowns
  let monthOpts = '', yearOpts = '';
  OWNER_CAL_MONTHS.forEach((name, i) => {
    monthOpts += `<option value="${i}">${name}</option>`;
  });
  const todayY = new Date().getFullYear();
  for (let y = todayY; y <= todayY + 5; y++) {
    yearOpts += `<option value="${y}">${y}</option>`;
  }

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:1rem;">
      <button type="button" id="owner-cal-prev-btn" onclick="ownerCalPrev()"
        style="background:transparent;border:1px solid var(--white);color:var(--white);border-radius:5px;padding:.4rem .8rem;cursor:pointer;font-size:.9rem;transition:all .2s;"
        onmouseover="this.style.borderColor='var(--neon)';this.style.color='var(--neon)'"
        onmouseout="this.style.borderColor='var(--white)';this.style.color='var(--white)'">‹</button>
      <select id="owner-cal-month-select" onchange="ownerCalJumpSplit()"
        style="flex:2;background:var(--deep);border:1px solid var(--white);border-radius:5px;padding:.4rem .75rem;color:var(--white);font-family:'Space Mono',monospace;font-size:.65rem;letter-spacing:.04em;cursor:pointer;outline:none;">
        ${monthOpts}
      </select>
      <select id="owner-cal-year-select" onchange="ownerCalJumpSplit()"
        style="flex:1;background:var(--deep);border:1px solid var(--white);border-radius:5px;padding:.4rem .75rem;color:var(--white);font-family:'Space Mono',monospace;font-size:.65rem;cursor:pointer;outline:none;">
        ${yearOpts}
      </select>
      <button type="button" id="owner-cal-next-btn" onclick="ownerCalNext()"
        style="background:transparent;border:1px solid var(--white);color:var(--white);border-radius:5px;padding:.4rem .8rem;cursor:pointer;font-size:.9rem;transition:all .2s;"
        onmouseover="this.style.borderColor='var(--neon)';this.style.color='var(--neon)'"
        onmouseout="this.style.borderColor='var(--white)';this.style.color='var(--white)'">›</button>
      <button type="button" id="owner-cal-view-toggle" onclick="ownerCalToggleView()"
        style="background:transparent;border:1px solid var(--white);color:var(--white);border-radius:5px;padding:.4rem .75rem;cursor:pointer;font-family:'Space Mono',monospace;font-size:.55rem;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;transition:all .2s;margin-left:auto;"
        onmouseover="this.style.borderColor='var(--neon)';this.style.color='var(--neon)'"
        onmouseout="if(!this.dataset.active){this.style.borderColor='var(--white)';this.style.color='var(--white)'}">${ownerCalWindowLabel()}</button>
    </div>
    <div id="owner-cal-single-wrap">
      <div id="owner-cal-grid-wrap"></div>
      <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-top:.75rem;">
        <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:var(--neon);"><span style="width:10px;height:10px;border-radius:2px;background:rgba(0,245,196,.15);border:1px solid rgba(0,245,196,.3);display:inline-block;"></span>Open</div>
        <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:#ff5f5f;"><span style="width:10px;height:10px;border-radius:2px;background:rgba(255,95,95,.1);border:1px solid rgba(255,95,95,.3);display:inline-block;"></span>Booked</div>
        <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:var(--muted);"><span style="width:10px;height:10px;border-radius:2px;background:rgba(107,107,136,.1);border:1px solid rgba(107,107,136,.3);display:inline-block;"></span>Unavailable</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:.35rem;margin-top:.4rem;">
        <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.55rem;color:var(--muted);"><span style="color:rgba(255,255,255,.3);font-size:.65rem;font-weight:700;">✕</span> Mark unavailable</div>
        <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.55rem;color:var(--muted);"><span style="color:var(--neon);font-size:.65rem;font-weight:700;">✓</span> Mark available</div>
        <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.55rem;color:var(--muted);"><span style="font-size:.65rem;">✏️</span> Edit day / set rate</div>
      </div>
    </div>
    <div id="owner-cal-rolling-wrap" style="display:none;"></div>
    <div id="owner-cal-alert" style="margin-top:.4rem;"></div>`;
  drawOwnerCalMonth();
}

function drawOwnerCalMonth() {
  const wrap = document.getElementById('owner-cal-grid-wrap');
  if (!wrap) return;
  const today = new Date();
  const y = ownerCalYear, m = ownerCalMonth;

  const mSel = document.getElementById('owner-cal-month-select');
  const ySel = document.getElementById('owner-cal-year-select');
  if (mSel) mSel.value = m;
  if (ySel) ySel.value = y;

  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  let html = `<div style="text-align:center;font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:.08em;color:var(--white);margin-bottom:.75rem;">${OWNER_CAL_MONTHS[m]} ${y}</div>`;
  html += `<div style="display:grid;grid-template-columns:repeat(7,1fr);border-left:1px solid var(--border);border-top:1px solid var(--border);border-radius:8px 8px 0 0;overflow:hidden;width:100%;box-sizing:border-box;">`;
  dayNames.forEach((name, i) => {
    html += `<div style="background:rgba(255,255,255,.04);border-right:1px solid var(--border);border-bottom:1px solid var(--border);${i===0?'border-radius:8px 0 0 0;':''}${i===6?'border-radius:0 8px 0 0;':''}padding:.6rem 0;text-align:center;font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);">${name}</div>`;
  });
  html += `</div><div style="display:grid;grid-template-columns:repeat(7,1fr);border-left:1px solid var(--border);border-radius:0 0 8px 8px;overflow:hidden;width:100%;box-sizing:border-box;">`;

  for (let i = 0; i < firstDay; i++) {
    html += `<div style="border-right:1px solid rgba(255,255,255,.1);border-bottom:1px solid rgba(255,255,255,.1);min-height:72px;background:rgba(255,255,255,.01);"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayData = ownerBookingDays[key] || {};
    const isPast = new Date(y, m, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const isBooked = dayData.booked;
    const isUnavail = dayData.unavailable;
    const isToday = y === today.getFullYear() && m === today.getMonth() && d === today.getDate();

    let bg = 'transparent';
    if (isBooked) bg = 'rgba(255,60,60,.28)';
    else if (isUnavail) bg = 'rgba(90,90,120,.22)';
    else if (isToday) bg = 'rgba(0,245,196,.18)';
    else if (!isPast) bg = 'rgba(0,245,196,.1)';

    let numColor = 'var(--white)';
    if (isPast) numColor = 'var(--muted)';
    else if (isBooked) numColor = '#ff5f5f';
    else if (isUnavail) numColor = 'var(--muted)';
    else if (isToday) numColor = 'var(--neon)';

    let badge = '';
    if (!isPast) {
      if (isBooked) badge = '';
      else if (isUnavail) badge = '';
      else badge = '';
    }

    const isEdited = !isBooked && !isUnavail && ownerBookingDays[key] && Object.keys(ownerBookingDays[key]).length > 0;

    const isLastRow = Math.floor((firstDay + d - 1) / 7) === Math.floor((firstDay + daysInMonth - 1) / 7);
    html += `<div style="position:relative;border-right:1px solid rgba(255,255,255,.1);border-bottom:1px solid rgba(255,255,255,.1);${isLastRow?'border-bottom:none;':''}min-height:72px;padding:.5rem .4rem .4rem;background:${bg};${isToday?'outline:2px solid var(--neon);outline-offset:-1px;':''}text-align:left;vertical-align:top;">
      <div style="font-size:.95rem;font-weight:${isToday?'700':'400'};color:${numColor};line-height:1;">${d}</div>
      ${badge}
      ${!isPast?`
        ${!isBooked ? `<button type="button" onclick="ownerQuickMark('${key}')" title="${isUnavail?'Mark available':'Mark unavailable'}" style="position:absolute;bottom:4px;left:4px;background:transparent;border:none;color:${isUnavail?'var(--neon)':'rgba(255,255,255,.2)'};cursor:pointer;font-size:.65rem;padding:0;line-height:1;font-weight:700;transition:color .15s;" onmouseover="this.style.color='${isUnavail?'var(--white)':'#ff5f5f'}'" onmouseout="this.style.color='${isUnavail?'var(--neon)':'rgba(255,255,255,.2)'}'}">${isUnavail?'✓':'✕'}</button>` : ''}
        <div style="position:absolute;bottom:4px;right:4px;display:flex;align-items:center;gap:3px;">
          ${isEdited ? `<span style="font-family:'Space Mono',monospace;font-size:.45rem;letter-spacing:.04em;text-transform:uppercase;color:var(--neon);opacity:.8;">edited</span>` : ''}
          <button type="button" onclick="ownerOpenDayEditor('${key}')" title="Edit day" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:.6rem;padding:0;line-height:1;">✏️</button>
        </div>
      `:''}
    </div>`;
  }

  const totalCells = firstDay + daysInMonth;
  const remainder = totalCells % 7;
  if (remainder !== 0) {
    for (let i = remainder; i < 7; i++) {
      html += `<div style="border-right:1px solid var(--border);min-height:72px;background:rgba(255,255,255,.01);"></div>`;
    }
  }
  html += `</div>`;
  wrap.innerHTML = html;
}

function ownerCalPrev() {
  ownerCalMonth--;
  if (ownerCalMonth < 0) { ownerCalMonth = 11; ownerCalYear--; }
  drawOwnerCalMonth();
}
function ownerCalNext() {
  ownerCalMonth++;
  if (ownerCalMonth > 11) { ownerCalMonth = 0; ownerCalYear++; }
  drawOwnerCalMonth();
}
function ownerCalJumpSplit() {
  ownerCalMonth = parseInt(document.getElementById('owner-cal-month-select').value);
  ownerCalYear = parseInt(document.getElementById('owner-cal-year-select').value);
  drawOwnerCalMonth();
}

let ownerCalRollingActive = false;

function ownerCalToggleView() {
  ownerCalRollingActive = !ownerCalRollingActive;
  const toggle = document.getElementById('owner-cal-view-toggle');
  const single = document.getElementById('owner-cal-single-wrap');
  const rolling = document.getElementById('owner-cal-rolling-wrap');
  const prev = document.getElementById('owner-cal-prev-btn');
  const next = document.getElementById('owner-cal-next-btn');
  const mSel = document.getElementById('owner-cal-month-select');
  const ySel = document.getElementById('owner-cal-year-select');
  if (ownerCalRollingActive) {
    single.style.display = 'none';
    rolling.style.display = 'block';
    if (prev) prev.style.display = 'none';
    if (next) next.style.display = 'none';
    if (mSel) mSel.style.display = 'none';
    if (ySel) ySel.style.display = 'none';
    toggle.textContent = '← Month View';
    toggle.style.borderColor = 'var(--neon)';
    toggle.style.color = 'var(--neon)';
    toggle.dataset.active = '1';
    drawOwnerRolling12Months();
  } else {
    single.style.display = 'block';
    rolling.style.display = 'none';
    if (prev) prev.style.display = '';
    if (next) next.style.display = '';
    if (mSel) mSel.style.display = '';
    if (ySel) ySel.style.display = '';
    toggle.textContent = ownerCalWindowLabel();
    toggle.style.borderColor = 'var(--white)';
    toggle.style.color = 'var(--white)';
    delete toggle.dataset.active;
  }
}

function ownerCalWindowLabel() {
  const m = ownerCalWindowMonths || 12;
  if (m < 12) return m + ' Month' + (m > 1 ? 's' : '');
  const y = m / 12; return y + ' Year' + (y > 1 ? 's' : '');
}

function drawOwnerRolling12Months() {
  const rolling = document.getElementById('owner-cal-rolling-wrap');
  if (!rolling) return;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const monthNames = OWNER_CAL_MONTHS;
  const dayLabels = ['S','M','T','W','T','F','S'];

  let html = `<div class="cal-months-grid">`;

  for (let i = 0; i < ownerCalWindowMonths; i++) {
    let mo = today.getMonth() + i;
    let yr = today.getFullYear() + Math.floor(mo / 12);
    mo = mo % 12;
    const firstDay = new Date(yr, mo, 1).getDay();
    const daysInMonth = new Date(yr, mo + 1, 0).getDate();

    html += `<div style="background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:8px;padding:.6rem;">
      <div style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.05em;text-transform:uppercase;color:var(--white);margin-bottom:.4rem;">${monthNames[mo]} <span style="color:var(--neon);">${yr}</span></div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;margin-bottom:2px;">
        ${dayLabels.map(d=>`<div style="font-family:'Space Mono',monospace;font-size:.42rem;text-align:center;color:var(--muted);">${d}</div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;">`;

    for (let b = 0; b < firstDay; b++) html += `<div></div>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayData = ownerBookingDays[key] || {};
      const isPast = key < todayKey;
      const isBooked = dayData.booked;
      const isUnavail = dayData.unavailable;
      const isToday = key === todayKey;

      let bg = isPast ? 'transparent' : 'rgba(0,245,196,.1)';
      let color = isPast ? 'var(--muted)' : 'var(--white)';
      let border = isToday ? '1px solid var(--neon)' : '1px solid transparent';
      let click = '';

      if (isBooked) { bg = 'rgba(255,60,60,.28)'; color = '#ff5f5f'; border = '1px solid rgba(255,95,95,.2)'; }
      else if (isUnavail) { bg = 'rgba(90,90,120,.22)'; color = 'var(--muted)'; border = '1px solid rgba(107,107,136,.2)'; }
      else if (isToday) { bg = 'rgba(0,245,196,.18)'; color = 'var(--neon)'; }
      else if (!isPast) { click = `onclick="ownerCalToggleView();ownerCalMonth=${mo};ownerCalYear=${yr};drawOwnerCalMonth();document.querySelectorAll('#owner-cal-month-select').forEach(s=>s.value=${mo});document.querySelectorAll('#owner-cal-year-select').forEach(s=>s.value=${yr});"` }

      html += `<div style="background:${bg};border:${border};border-radius:3px;padding:.25rem .1rem;text-align:center;cursor:${isPast||isBooked||isUnavail?'default':'pointer'};aspect-ratio:1;" ${click}>
        <div style="font-family:'Space Mono',monospace;font-size:.6rem;color:${color};">${d}</div>
      </div>`;
    }

    html += `</div></div>`;
  }

  html += `</div>
  <div style="display:flex;gap:1rem;flex-wrap:wrap;justify-content:center;">
    <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:var(--neon);"><span style="width:10px;height:10px;border-radius:2px;background:rgba(0,245,196,.15);border:1px solid rgba(0,245,196,.3);display:inline-block;"></span>Open</div>
    <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:#ff5f5f;"><span style="width:10px;height:10px;border-radius:2px;background:rgba(255,95,95,.1);border:1px solid rgba(255,95,95,.3);display:inline-block;"></span>Booked</div>
    <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:var(--muted);"><span style="width:10px;height:10px;border-radius:2px;background:rgba(107,107,136,.1);border:1px solid rgba(107,107,136,.3);display:inline-block;"></span>Unavailable</div>
  </div>`;

  rolling.innerHTML = html;
}

function ownerQuickMark(key) {
  if (ownerBookingDays[key] && ownerBookingDays[key].booked) return;
  if (ownerBookingDays[key] && ownerBookingDays[key].unavailable) {
    delete ownerBookingDays[key];
  } else {
    ownerBookingDays[key] = { unavailable: true };
  }
  drawOwnerCalMonth();
  autoSaveOwnerCalendar();
}

let dayLocTimeout = null;
function dayLocAutocomplete(input) {
  clearTimeout(dayLocTimeout);
  const val = input.value.trim();
  let dropdown = document.getElementById('day-loc-dropdown');
  if (!val || val.length < 3) { if (dropdown) dropdown.remove(); return; }
  dayLocTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=5&addressdetails=1`, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      if (dropdown) dropdown.remove();
      if (!data || !data.length) return;
      dropdown = document.createElement('div');
      dropdown.id = 'day-loc-dropdown';
      dropdown.style.cssText = 'position:absolute;z-index:9999;background:var(--card);border:1px solid var(--border);border-radius:6px;width:100%;max-height:200px;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,.4);';
      data.forEach(item => {
        const a = item.address;
        const parts = [
          a.house_number && a.road ? a.house_number + ' ' + a.road : a.road,
          a.suburb && a.city && a.suburb !== a.city ? a.suburb : (a.city || a.town || a.village || a.municipality),
          a.state,
          a.postcode
        ].filter(Boolean);
        const label = parts.join(', ');
        const opt = document.createElement('div');
        opt.style.cssText = 'padding:.55rem .85rem;font-size:.83rem;color:var(--white);cursor:pointer;border-bottom:1px solid var(--border);';
        opt.textContent = label;
        opt.onmouseover = () => opt.style.background = 'var(--deep)';
        opt.onmouseout  = () => opt.style.background = '';
        opt.onclick = () => { input.value = label; dropdown.remove(); };
        dropdown.appendChild(opt);
      });
      const wrap = input.parentElement;
      wrap.style.position = 'relative';
      wrap.appendChild(dropdown);
      const close = () => { if (document.getElementById('day-loc-dropdown')) document.getElementById('day-loc-dropdown').remove(); document.removeEventListener('click', close); };
      setTimeout(() => document.addEventListener('click', close), 100);
    } catch(e) {}
  }, 400);
}

async function ownerSaveEquipAndOpenDay(key) {
  const full  = document.getElementById('eq-full').checked;
  const decks = document.getElementById('eq-decks').checked;
  const none  = document.getElementById('eq-none').checked;
  const alertEl = document.getElementById('equip-modal-alert');
  if (!full && !decks && !none) {
    alertEl.style.color = 'var(--error)';
    alertEl.textContent = '✗ Please select at least one option.';
    return;
  }
  alertEl.style.color = 'var(--muted)';
  alertEl.textContent = 'Saving...';
  try {
    const cu = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || 'null');
    const { data: current } = await db.from('users').select('booking_settings').eq('id', cu.id).single();
    const bs = current && current.booking_settings ? (typeof current.booking_settings === 'string' ? JSON.parse(current.booking_settings) : current.booking_settings) : {};
    bs.equip_full = full;
    bs.equip_decks = decks;
    bs.equip_none = none;
    bs.equip_full_detail = document.getElementById('eq-full-detail')?.value.trim() || '';
    bs.equip_decks_detail = document.getElementById('eq-decks-detail')?.value.trim() || '';
    const { error } = await db.from('users').update({ booking_settings: JSON.stringify(bs) }).eq('id', cu.id);
    if (error) throw error;
    // Update globals
    ownerEquipFull = full;
    ownerEquipDecks = decks;
    ownerEquipNone = none;
    // Close this modal and open the day editor
    document.getElementById('day-editor-modal').remove();
    ownerOpenDayEditor(key);
  } catch(e) {
    alertEl.style.color = 'var(--error)';
    alertEl.textContent = '✗ ' + e.message;
  }
}

function ownerOpenDayEditor(key) {
  const d = ownerBookingDays[key] || {};

  // Guard: equipment must be selected first — show inline selector
  if (!ownerEquipFull && !ownerEquipDecks && !ownerEquipNone) {
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
            <input type="checkbox" id="eq-full" style="margin-top:2px;accent-color:var(--neon);flex-shrink:0;" onchange="if(this.checked){document.getElementById('eq-decks').checked=false;document.getElementById('eq-none').checked=false;document.getElementById('eq-full-detail-wrap').style.display='block';document.getElementById('eq-decks-detail-wrap').style.display='none';}else{document.getElementById('eq-full-detail-wrap').style.display='none';}">
            <div style="flex:1;">
              <div style="font-size:.88rem;color:var(--white);">I can provide Sound System &amp; Decks/Controller</div>
              <div id="eq-full-detail-wrap" style="display:none;margin-top:.4rem;">
                <input type="text" id="eq-full-detail" placeholder="List your system (e.g. QSC K12.2, Pioneer CDJ-3000)" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.45rem .7rem;color:var(--white);font-size:.83rem;font-family:'DM Sans',sans-serif;">
              </div>
            </div>
          </label>
          <label style="display:flex;align-items:flex-start;gap:.6rem;cursor:pointer;padding:.7rem .9rem;background:var(--deep);border:1px solid var(--border);border-radius:6px;">
            <input type="checkbox" id="eq-decks" style="margin-top:2px;accent-color:var(--neon);flex-shrink:0;" onchange="if(this.checked){document.getElementById('eq-full').checked=false;document.getElementById('eq-none').checked=false;document.getElementById('eq-decks-detail-wrap').style.display='block';document.getElementById('eq-full-detail-wrap').style.display='none';}else{document.getElementById('eq-decks-detail-wrap').style.display='none';}">
            <div style="flex:1;">
              <div style="font-size:.88rem;color:var(--white);">I can provide only Decks/Controller</div>
              <div id="eq-decks-detail-wrap" style="display:none;margin-top:.4rem;">
                <input type="text" id="eq-decks-detail" placeholder="List your decks/controller (e.g. Pioneer DDJ-1000)" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.45rem .7rem;color:var(--white);font-size:.83rem;font-family:'DM Sans',sans-serif;">
              </div>
            </div>
          </label>
          <label style="display:flex;align-items:flex-start;gap:.6rem;cursor:pointer;padding:.7rem .9rem;background:var(--deep);border:1px solid var(--border);border-radius:6px;">
            <input type="checkbox" id="eq-none" style="margin-top:2px;accent-color:var(--neon);flex-shrink:0;" onchange="if(this.checked){document.getElementById('eq-full').checked=false;document.getElementById('eq-decks').checked=false;document.getElementById('eq-full-detail-wrap').style.display='none';document.getElementById('eq-decks-detail-wrap').style.display='none';}">
            <div style="font-size:.88rem;color:var(--white);">I require all equipment provided by venue</div>
          </label>
        </div>
        <div id="equip-modal-alert" style="font-family:'Space Mono',monospace;font-size:.62rem;min-height:1rem;margin-bottom:.75rem;"></div>
        <div style="display:flex;gap:.75rem;">
          <button type="button" onclick="document.getElementById('day-editor-modal').remove()" style="flex:1;padding:.75rem;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--muted);font-family:'Space Mono',monospace;font-size:.62rem;cursor:pointer;">Cancel</button>
          <button type="button" onclick="ownerSaveEquipAndOpenDay('${key}')" style="flex:1;padding:.75rem;background:var(--neon);border:none;border-radius:6px;color:var(--black);font-family:'Space Mono',monospace;font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;">Save &amp; Continue</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    return;
  }

  const existing = document.getElementById('day-editor-modal');
  if (existing) existing.remove();

  const [y, m, day] = key.split('-').map(Number);
  const dateObj = new Date(y, m - 1, day);
  const formattedDate = dateObj.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });

  // Compute defaults — use day-specific if set, else fall back to global rates
  const hasCustomRate = d.rate || d.rateSystem || d.rateDecks || d.hourlyRate || d.hourlyRateSystem || d.hourlyRateDecks;
  const defaultRateType = d.rateType || (ownerGlobalAllowOffers ? 'offers' : ownerGlobalRateType);
  const isOffersDay = defaultRateType === 'offers';
  const isHourlyDay = defaultRateType === 'hourly';
  const defaultRateSystem = (!isOffersDay && !isHourlyDay) ? (d.rateSystem ?? (hasCustomRate ? '' : ownerGlobalRateSystem)) : '';
  const defaultRateDecks = (!isOffersDay && !isHourlyDay) ? (d.rateDecks ?? (hasCustomRate ? '' : ownerGlobalRateDecks)) : '';
  const defaultRate = (!isOffersDay && !isHourlyDay) ? (d.rate ?? (hasCustomRate ? '' : ownerGlobalRateNoEquip)) : '';
  const defaultHourlyRateSystem = (!isOffersDay && isHourlyDay) ? (d.hourlyRateSystem ?? (hasCustomRate ? '' : (ownerGlobalRateType === 'hourly' ? ownerGlobalRateSystem : ''))) : '';
  const defaultHourlyRateDecks = (!isOffersDay && isHourlyDay) ? (d.hourlyRateDecks ?? (hasCustomRate ? '' : (ownerGlobalRateType === 'hourly' ? ownerGlobalRateDecks : ''))) : '';
  const defaultHourlyRate = (!isOffersDay && isHourlyDay) ? (d.hourlyRate ?? (hasCustomRate ? '' : (ownerGlobalRateType === 'hourly' ? ownerGlobalRateNoEquip : ''))) : '';

  const modal = document.createElement('div');
  modal.id = 'day-editor-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:1.5rem;';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.75rem;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.25rem;">
        <div style="font-family:'Space Mono',monospace;font-size:.72rem;letter-spacing:.06em;color:var(--neon);">${formattedDate}</div>
        <button type="button" onclick="document.getElementById('day-editor-modal').remove()" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:1.2rem;">✕</button>
      </div>
      <div style="margin-bottom:1.25rem;"></div>
      <div style="margin-bottom:1rem;display:flex;flex-direction:column;gap:.5rem;">
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;"><input type="radio" name="day-status" value="available" ${!d.booked&&!d.unavailable?'checked':''} style="accent-color:var(--neon);" onchange="ownerToggleDayStatus()"><span style="font-size:.85rem;color:var(--white);">Available</span></label>
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;"><input type="radio" name="day-status" value="unavailable" ${d.unavailable?'checked':''} style="accent-color:var(--muted);" onchange="ownerToggleDayStatus()"><span style="font-size:.85rem;color:var(--muted);">Unavailable</span></label>
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;"><input type="radio" name="day-status" value="booked" ${d.booked?'checked':''} style="accent-color:var(--error);" onchange="ownerToggleDayStatus()"><span style="font-size:.85rem;color:#ff5f5f;">Booked (has event)</span></label>
      </div>
      <div id="day-booked-fields" style="display:${d.booked?'block':'none'};">
        <div style="background:var(--deep);border-radius:8px;padding:1rem;margin-bottom:1rem;">
          <div style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.75rem;">Event Details (Optional)</div>
          <div style="margin-bottom:.6rem;"><label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:.25rem;">Event / Venue Name</label>
            <input type="text" id="day-event-name" value="${d.eventName||''}" placeholder="e.g. Saturday Night Live" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;"></div>
          <div style="margin-bottom:.6rem;"><label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:.25rem;">Venue Address</label>
            <div style="display:flex;gap:.5rem;">
              <input type="text" id="day-location" value="${d.location!=='Private'?(d.location||''):''}" placeholder="Start typing address..." autocomplete="off" oninput="dayLocAutocomplete(this)" style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;" ${d.location==='Private'?'disabled':''}>
              <label style="display:flex;align-items:center;gap:.3rem;cursor:pointer;white-space:nowrap;font-size:.78rem;color:var(--muted);"><input type="checkbox" id="day-private" ${d.location==='Private'?'checked':''} style="accent-color:var(--neon);" onchange="document.getElementById('day-location').disabled=this.checked;"> Private</label>
            </div></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;">
            <div><label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:.25rem;">Start Time</label><select id="day-start" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;cursor:pointer;outline:none;">${d.startTime?`<option value="${d.startTime}" selected>${(()=>{const [h,mi]=d.startTime.split(':').map(Number);const p=h<12?'AM':'PM';const h12=h%12||12;return h12+':'+String(mi).padStart(2,'0')+' '+p;})()}</option>`:''}<option value="">--</option><option value="00:00">12:00 AM</option><option value="00:30">12:30 AM</option><option value="01:00">1:00 AM</option><option value="01:30">1:30 AM</option><option value="02:00">2:00 AM</option><option value="02:30">2:30 AM</option><option value="03:00">3:00 AM</option><option value="03:30">3:30 AM</option><option value="04:00">4:00 AM</option><option value="04:30">4:30 AM</option><option value="05:00">5:00 AM</option><option value="05:30">5:30 AM</option><option value="06:00">6:00 AM</option><option value="06:30">6:30 AM</option><option value="07:00">7:00 AM</option><option value="07:30">7:30 AM</option><option value="08:00">8:00 AM</option><option value="08:30">8:30 AM</option><option value="09:00">9:00 AM</option><option value="09:30">9:30 AM</option><option value="10:00">10:00 AM</option><option value="10:30">10:30 AM</option><option value="11:00">11:00 AM</option><option value="11:30">11:30 AM</option><option value="12:00">12:00 PM</option><option value="12:30">12:30 PM</option><option value="13:00">1:00 PM</option><option value="13:30">1:30 PM</option><option value="14:00">2:00 PM</option><option value="14:30">2:30 PM</option><option value="15:00">3:00 PM</option><option value="15:30">3:30 PM</option><option value="16:00">4:00 PM</option><option value="16:30">4:30 PM</option><option value="17:00">5:00 PM</option><option value="17:30">5:30 PM</option><option value="18:00">6:00 PM</option><option value="18:30">6:30 PM</option><option value="19:00">7:00 PM</option><option value="19:30">7:30 PM</option><option value="20:00">8:00 PM</option><option value="20:30">8:30 PM</option><option value="21:00">9:00 PM</option><option value="21:30">9:30 PM</option><option value="22:00">10:00 PM</option><option value="22:30">10:30 PM</option><option value="23:00">11:00 PM</option><option value="23:30">11:30 PM</option></select></div>
            <div><label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:.25rem;">End Time <span style="font-size:.65rem;">(optional)</span></label><select id="day-end" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;cursor:pointer;outline:none;">${d.endTime?`<option value="${d.endTime}" selected>${(()=>{const [h,mi]=d.endTime.split(':').map(Number);const p=h<12?'AM':'PM';const h12=h%12||12;return h12+':'+String(mi).padStart(2,'0')+' '+p;})()}</option>`:''}<option value="">--</option><option value="00:00">12:00 AM</option><option value="00:30">12:30 AM</option><option value="01:00">1:00 AM</option><option value="01:30">1:30 AM</option><option value="02:00">2:00 AM</option><option value="02:30">2:30 AM</option><option value="03:00">3:00 AM</option><option value="03:30">3:30 AM</option><option value="04:00">4:00 AM</option><option value="04:30">4:30 AM</option><option value="05:00">5:00 AM</option><option value="05:30">5:30 AM</option><option value="06:00">6:00 AM</option><option value="06:30">6:30 AM</option><option value="07:00">7:00 AM</option><option value="07:30">7:30 AM</option><option value="08:00">8:00 AM</option><option value="08:30">8:30 AM</option><option value="09:00">9:00 AM</option><option value="09:30">9:30 AM</option><option value="10:00">10:00 AM</option><option value="10:30">10:30 AM</option><option value="11:00">11:00 AM</option><option value="11:30">11:30 AM</option><option value="12:00">12:00 PM</option><option value="12:30">12:30 PM</option><option value="13:00">1:00 PM</option><option value="13:30">1:30 PM</option><option value="14:00">2:00 PM</option><option value="14:30">2:30 PM</option><option value="15:00">3:00 PM</option><option value="15:30">3:30 PM</option><option value="16:00">4:00 PM</option><option value="16:30">4:30 PM</option><option value="17:00">5:00 PM</option><option value="17:30">5:30 PM</option><option value="18:00">6:00 PM</option><option value="18:30">6:30 PM</option><option value="19:00">7:00 PM</option><option value="19:30">7:30 PM</option><option value="20:00">8:00 PM</option><option value="20:30">8:30 PM</option><option value="21:00">9:00 PM</option><option value="21:30">9:30 PM</option><option value="22:00">10:00 PM</option><option value="22:30">10:30 PM</option><option value="23:00">11:00 PM</option><option value="23:30">11:30 PM</option></select></div>
          </div>
          <div style="margin-top:.6rem;">
            <label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:.25rem;">Event Info / Ticket URL <span style="font-size:.65rem;">(optional)</span></label>
            <input type="text" id="day-ticket-url" value="${d.ticketUrl||''}" placeholder="https://tickets.com/event" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;margin-bottom:.4rem;">
          </div>
        </div>
      </div>
      <div id="day-avail-fields" style="display:${(!d.booked&&!d.unavailable)?'block':'none'};">
        <div style="background:var(--deep);border-radius:8px;padding:1rem;margin-bottom:1rem;">
          <div style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.75rem;">Rate for This Day</div>
          <div style="text-align:center;margin-bottom:.75rem;">
            <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);font-weight:700;display:block;margin-bottom:.5rem;">Rate Type</label>
            <div style="display:inline-flex;border:1px solid var(--border);border-radius:5px;overflow:hidden;margin-bottom:.5rem;">
              <button type="button" id="rate-type-flat" onclick="ownerSetRateType('flat')" data-active="${defaultRateType!=='hourly'&&defaultRateType!=='offers'?'true':'false'}" style="padding:.55rem 1.5rem;border:none;border-right:1px solid var(--border);background:${defaultRateType!=='hourly'&&defaultRateType!=='offers'?'var(--neon-dim)':'transparent'};color:${defaultRateType!=='hourly'&&defaultRateType!=='offers'?'var(--neon)':'var(--white)'};font-family:'Space Mono',monospace;font-size:.7rem;cursor:pointer;">Flat Rate</button>
              <button type="button" id="rate-type-hourly" onclick="ownerSetRateType('hourly')" data-active="${defaultRateType==='hourly'?'true':'false'}" style="padding:.55rem 1.5rem;border:none;border-right:1px solid var(--border);background:${defaultRateType==='hourly'?'var(--neon-dim)':'transparent'};color:${defaultRateType==='hourly'?'var(--neon)':'var(--white)'};font-family:'Space Mono',monospace;font-size:.7rem;cursor:pointer;">Hourly</button>
              <button type="button" id="rate-type-offers" onclick="ownerSetRateType('offers')" data-active="${defaultRateType==='offers'?'true':'false'}" style="padding:.55rem 1.5rem;border:none;background:${defaultRateType==='offers'?'var(--neon-dim)':'transparent'};color:${defaultRateType==='offers'?'var(--neon)':'var(--white)'};font-family:'Space Mono',monospace;font-size:.7rem;cursor:pointer;">Offers</button>
            </div>
            <div id="day-offers-label" style="display:${defaultRateType==='offers'?'block':'none'};font-size:.72rem;color:var(--white);line-height:1.5;">Offers can be countered and negotiated through the platform.</div>
          </div>
          <div id="day-flat-fields" style="display:${defaultRateType!=='hourly'&&defaultRateType!=='offers'?'block':'none'};">
            ${ownerEquipFull ? `
            <div style="margin-bottom:.5rem;">
              <label style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.3rem;">Rate with Sound System &amp; Decks/Controller</label>
              <div style="display:flex;align-items:center;gap:.4rem;">
                <span style="color:var(--muted);">$</span>
                <input type="number" id="day-rate-system" value="${defaultRateSystem}" placeholder="0" min="0" style="max-width:160px;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.45rem .65rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
              </div>
            </div>` : ''}
            ${(ownerEquipDecks || ownerEquipFull) ? `
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
            ${ownerEquipFull ? `
            <div style="margin-bottom:.5rem;">
              <label style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.3rem;">Rate with Sound System &amp; Decks/Controller</label>
              <div style="display:flex;align-items:center;gap:.4rem;">
                <span style="color:var(--muted);">$</span>
                <input type="number" id="day-hourly-system" value="${defaultHourlyRateSystem}" placeholder="0" min="0" style="max-width:160px;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:.45rem .65rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
                <span style="font-family:'Space Mono',monospace;font-size:.62rem;font-weight:700;color:var(--neon);letter-spacing:.06em;">PER HOUR</span>
              </div>
            </div>` : ''}
            ${(ownerEquipDecks || ownerEquipFull) ? `
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
        <button type="button" onclick="ownerSaveDayEditor('${key}')" style="flex:1;padding:.75rem;background:var(--neon);border:none;border-radius:6px;color:var(--black);font-family:'Space Mono',monospace;font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;">Save Day</button>
        <button type="button" onclick="document.getElementById('day-editor-modal').remove()" style="padding:.75rem 1rem;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--muted);font-family:'Space Mono',monospace;font-size:.65rem;cursor:pointer;">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function ownerToggleDayStatus() {
  const val = document.querySelector('input[name="day-status"]:checked').value;
  document.getElementById('day-booked-fields').style.display = val === 'booked' ? 'block' : 'none';
  document.getElementById('day-avail-fields').style.display = val === 'available' ? 'block' : 'none';
}

function ownerSetRateType(type) {
  ['flat','hourly','offers'].forEach(t => {
    const btn = document.getElementById('rate-type-' + t);
    if (!btn) return;
    btn.style.background = type === t ? 'var(--neon-dim)' : 'transparent';
    btn.style.color = type === t ? 'var(--neon)' : 'var(--white)';
    btn.dataset.active = type === t ? 'true' : 'false';
  });
  document.getElementById('day-flat-fields').style.display   = type === 'flat'   ? 'block' : 'none';
  document.getElementById('day-hourly-fields').style.display = type === 'hourly' ? 'block' : 'none';
  document.getElementById('day-offers-fields').style.display = type === 'offers' ? 'block' : 'none';
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

function ownerSaveDayEditor(key) {
  const statusVal = document.querySelector('input[name="day-status"]:checked').value;
  if (statusVal === 'unavailable') {
    ownerBookingDays[key] = { unavailable: true };
  } else if (statusVal === 'booked') {
    const isPrivate = document.getElementById('day-private').checked;
    ownerBookingDays[key] = {
      booked: true,
      eventName: document.getElementById('day-event-name').value.trim(),
      location: isPrivate ? 'Private' : document.getElementById('day-location').value.trim(),
      startTime: document.getElementById('day-start').value,
      endTime: document.getElementById('day-end').value,
      ticketUrl: document.getElementById('day-ticket-url').value.trim() || null,
    };
  } else {
    const offersActive = document.getElementById('rate-type-offers')?.dataset.active === 'true';
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

    const flatRate = document.getElementById('day-flat-rate')?.value || null;
    const rateSystem = document.getElementById('day-rate-system')?.value || null;
    const rateDecks = document.getElementById('day-rate-decks')?.value || null;
    const hourlyRate = document.getElementById('day-hourly-rate')?.value || null;
    const hourlyRateSystem = document.getElementById('day-hourly-system')?.value || null;
    const hourlyRateDecks = document.getElementById('day-hourly-decks')?.value || null;
    const flatHours = document.getElementById('day-flat-hours')?.value || null;
    const dayBaseRate = document.getElementById('day-base-rate')?.value || null;
    const hasCustom = flatRate || rateSystem || rateDecks || hourlyRate || hourlyRateSystem || hourlyRateDecks;
    if (hasCustom || dayBaseRate || offersActive) {
      ownerBookingDays[key] = { booked: false, rateType, rate: offersActive ? null : flatRate, rateSystem: offersActive ? null : rateSystem, rateDecks: offersActive ? null : rateDecks, flatHours: offersActive ? null : flatHours, hourlyRate: offersActive ? null : hourlyRate, hourlyRateSystem: offersActive ? null : hourlyRateSystem, hourlyRateDecks: offersActive ? null : hourlyRateDecks, base_rate: dayBaseRate };
    } else {
      delete ownerBookingDays[key];
    }
  }
  document.getElementById('day-editor-modal').remove();
  drawOwnerCalMonth();
  autoSaveOwnerCalendar();
}

async function autoSaveOwnerCalendar() {
  const cu = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || 'null');
  if (!cu) return;
  const alertEl = document.getElementById('owner-cal-alert');
  try {
    const { data: current, error: fetchErr } = await db.from('users').select('booking_settings').eq('id', cu.id).single();
    if (fetchErr) throw fetchErr;
    const bs = current && current.booking_settings ? (typeof current.booking_settings === 'string' ? JSON.parse(current.booking_settings) : current.booking_settings) : {};
    bs.booking_days = ownerBookingDays;
    const { error } = await db.from('users').update({ booking_settings: JSON.stringify(bs) }).eq('id', cu.id);
    if (error) throw error;
    if (alertEl) {
      alertEl.innerHTML = '<span style="font-size:.6rem;color:var(--success);">✓ Saved</span>';
      setTimeout(function(){ if(alertEl) alertEl.innerHTML=''; }, 2000);
    }
  } catch(e) {
    if (alertEl) alertEl.innerHTML = '<span style="font-size:.6rem;color:var(--error);">✗ ' + e.message + '</span>';
  }
}

async function ownerSaveCalendar(btn) {
  const cu = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || 'null');
  if (!cu) { alert('Not logged in'); return; }
  const orig = btn.textContent;
  btn.textContent = 'Saving...'; btn.disabled = true;
  try {
    const { data: current, error: fetchErr } = await db.from('users').select('booking_settings').eq('id', cu.id).single();
    if (fetchErr) throw fetchErr;
    const bs = current && current.booking_settings ? (typeof current.booking_settings === 'string' ? JSON.parse(current.booking_settings) : current.booking_settings) : {};
    bs.booking_days = ownerBookingDays;
    const { error } = await db.from('users').update({ booking_settings: JSON.stringify(bs) }).eq('id', cu.id);
    if (error) throw error;
    const alertEl = document.getElementById('owner-cal-alert');
    if (alertEl) { alertEl.innerHTML = '<div style="font-family:\'Space Mono\',monospace;font-size:.65rem;color:var(--success);padding:.4rem 0;">✓ Calendar saved.</div>'; setTimeout(()=>alertEl.innerHTML='',3000); }
  } catch(e) {
    const alertEl = document.getElementById('owner-cal-alert');
    if (alertEl) alertEl.innerHTML = `<div style="font-family:'Space Mono',monospace;font-size:.65rem;color:var(--error);padding:.4rem 0;">✗ ${e.message}</div>`;
  }
  btn.textContent = orig; btn.disabled = false;
}


