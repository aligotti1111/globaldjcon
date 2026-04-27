// MOBILE DJ PUBLIC BOOKING: all mobPub* + mpf_ phone helpers
// Extracted from dj-profile.html

// ── MOBILE DJ PUBLIC BOOKING ──────────────────────────────

let mobPubDjData = null;
let mobPubBs = null;
let mobPubIsOwner = false;
let mobPubCalYear = new Date().getFullYear();
let mobPubCalMonth = new Date().getMonth();
let mobPubSelectedDate = null;
let mobPubSelectedPkg = null;
let mobPubRollingActive = false;
// Cached lat/lon for the DJ's home zip — fetched once per session via Nominatim
let mobPubDjCoords = null;

// Haversine distance between two lat/lon points, returned in miles.
function mobPubHaversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const R = 3958.8; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// One-shot Nominatim lookup for the DJ's zip → {lat, lon}. Cached for the session.
async function mobPubGetDjCoords(zip) {
  if (mobPubDjCoords) return mobPubDjCoords;
  if (!zip) return null;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(zip)}&limit=1`);
    const data = await res.json();
    if (data && data[0]) {
      mobPubDjCoords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      return mobPubDjCoords;
    }
  } catch(e) { /* network or parse fail — silently skip the warning */ }
  return null;
}

// Distance-warning modal: returns a Promise<boolean> — true if host wants to proceed.
function mobPubConfirmDistance(miles, limit, djName) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem;';
    overlay.innerHTML = `
      <div style="background:var(--card);border:1px solid rgba(255,200,0,.45);border-radius:12px;max-width:440px;width:100%;padding:1.75rem 1.5rem;box-shadow:0 12px 48px rgba(0,0,0,.5);">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:.06em;color:#ffc800;margin-bottom:.85rem;">⚠ Outside Travel Range</div>
        <div style="font-size:.9rem;color:var(--white);line-height:1.5;margin-bottom:1.25rem;">
          This event is approximately <strong>${miles} miles</strong> from ${djName}'s home base. Their listed travel range is <strong>${limit} miles</strong>.
          <br><br>
          You can still send the request, but the DJ may decline or charge an additional travel fee.
        </div>
        <div style="display:flex;gap:.6rem;">
          <button type="button" id="mpf-dist-cancel" style="flex:1;padding:.75rem;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--white);font-family:'Space Mono',monospace;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;">Cancel</button>
          <button type="button" id="mpf-dist-confirm" style="flex:1;padding:.75rem;background:#ffc800;border:none;border-radius:6px;color:#000;font-family:'Space Mono',monospace;font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;">Send Anyway</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#mpf-dist-cancel').onclick = () => { document.body.removeChild(overlay); resolve(false); };
    overlay.querySelector('#mpf-dist-confirm').onclick = () => { document.body.removeChild(overlay); resolve(true); };
  });
}

const MOB_EVENT_TYPE_LABELS = {
  weddings:'Wedding', birthday:'Birthday Party', corporate:'Corporate Event',
  anniversary:'Anniversary', graduation:'Graduation', sweet16:'Sweet 16 / Quinceañera',
  mitzvah:'Bar/Bat Mitzvah', reunion:'Reunion', holiday:'Holiday Party',
  school:'School Event', community:'Community Event', other:'Other'
};

const MOB_TIME_OPTIONS = (() => {
  const opts = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = String(h).padStart(2,'0'), mm = String(m).padStart(2,'0');
      const label = `${h===0?12:h>12?h-12:h}:${mm} ${h<12?'AM':'PM'}`;
      opts.push({ val:`${hh}:${mm}`, label });
    }
  }
  return opts;
})();

function renderMobilePublicBooking(djData, bs, isOwner, djSlug) {
  mobPubDjData = djData;
  mobPubBs = bs;
  mobPubIsOwner = isOwner;
  const container = document.getElementById('p-booking-calendar');
  if (!container) return;

  const windowMonths = bs.mob_booking_window || 24;
  const defaultPerDay = bs.mob_bookings_per_day || 1;
  const bookingDays = bs.mob_booking_days || {};
  const packages = bs.mob_packages || {};
  const today = new Date();
  mobPubCalYear = today.getFullYear();
  mobPubCalMonth = today.getMonth();

  container.innerHTML = `
    <div id="mob-pub-cal-wrap">
      <div id="mob-pub-cal-single-wrap">
        <!-- Single header row holds prev/dropdowns/next AND the toggle (embed btn injected by dj-profile) -->
        <div id="mob-pub-cal-header" style="display:flex;align-items:center;gap:.5rem;margin-bottom:1rem;flex-wrap:nowrap;">
          <button type="button" id="mob-pub-cal-prev" onclick="mobPubCalNav(-1)" style="background:transparent;border:1px solid var(--white);color:var(--white);border-radius:5px;padding:.4rem .8rem;cursor:pointer;font-size:.9rem;transition:all .2s;" onmouseover="this.style.borderColor='var(--neon)';this.style.color='var(--neon)'" onmouseout="this.style.borderColor='var(--white)';this.style.color='var(--white)'">‹</button>
          <select id="mob-pub-cal-month-select" onchange="mobPubCalJumpSplit()" style="flex:2;background:var(--deep);border:1px solid var(--white);border-radius:5px;padding:.4rem .75rem;color:var(--white);font-family:'Space Mono',monospace;font-size:.65rem;letter-spacing:.04em;cursor:pointer;outline:none;"></select>
          <select id="mob-pub-cal-year-select" onchange="mobPubCalJumpSplit()" style="flex:1;background:var(--deep);border:1px solid var(--white);border-radius:5px;padding:.4rem .75rem;color:var(--white);font-family:'Space Mono',monospace;font-size:.65rem;cursor:pointer;outline:none;"></select>
          <button type="button" id="mob-pub-cal-next" onclick="mobPubCalNav(1)" style="background:transparent;border:1px solid var(--white);color:var(--white);border-radius:5px;padding:.4rem .8rem;cursor:pointer;font-size:.9rem;transition:all .2s;" onmouseover="this.style.borderColor='var(--neon)';this.style.color='var(--neon)'" onmouseout="this.style.borderColor='var(--white)';this.style.color='var(--white)'">›</button>
          <button type="button" id="mob-pub-cal-view-toggle" onclick="mobPubToggleView()"
            style="background:transparent;border:1px solid var(--white);color:var(--white);border-radius:5px;padding:.4rem .85rem;cursor:pointer;font-family:'Space Mono',monospace;font-size:.55rem;letter-spacing:.08em;text-transform:uppercase;transition:all .2s;white-space:nowrap;"
            onmouseover="this.style.borderColor='var(--neon)';this.style.color='var(--neon)'"
            onmouseout="if(this.textContent!=='← Month View'){this.style.borderColor='var(--white)';this.style.color='var(--white)'}">12 Months</button>
        </div>
        <!-- Month-name header below the controls -->
        <div id="mob-pub-cal-label" style="text-align:center;font-family:'Bebas Neue',sans-serif;font-size:1.5rem;letter-spacing:.08em;color:var(--neon);text-shadow:0 0 18px rgba(0,245,196,.35);margin-bottom:.75rem;"></div>
        <div id="mob-pub-cal-grid"></div>
      </div>
      <div id="mob-pub-cal-rolling-wrap" style="display:none;"></div>
      <div style="display:flex;flex-wrap:wrap;gap:1rem;margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:var(--neon);"><span style="width:10px;height:10px;border-radius:2px;background:rgba(0,245,196,.15);border:1px solid rgba(0,245,196,.3);display:inline-block;"></span>Available</div>
        <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:#ff5f5f;"><span style="width:10px;height:10px;border-radius:2px;background:rgba(255,95,95,.1);border:1px solid rgba(255,95,95,.3);display:inline-block;"></span>Booked</div>
        <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:var(--muted);"><span style="width:10px;height:10px;border-radius:2px;background:rgba(107,107,136,.1);border:1px solid rgba(107,107,136,.3);display:inline-block;"></span>Unavailable</div>
      </div>
    </div>
    <div id="mob-pub-booking-form" style="display:none;margin-top:1.5rem;"></div>`;

  drawMobPubCal();
  mobPubPopulateDropdowns();
}

// ── Booking-window helpers (mirrors club calendar) ─────────────
function mobPubMaxYM() {
  const win = (mobPubBs && mobPubBs.mob_booking_window) || 24;
  const t = new Date();
  const totalMonths = t.getFullYear() * 12 + t.getMonth() + win;
  return { year: Math.floor(totalMonths / 12), month: totalMonths % 12 };
}
function mobPubMinYM() {
  const t = new Date();
  return { year: t.getFullYear(), month: t.getMonth() };
}
function mobPubInRange(y, m) {
  const min = mobPubMinYM(), max = mobPubMaxYM();
  const v = y * 12 + m;
  return v >= (min.year * 12 + min.month) && v <= (max.year * 12 + max.month);
}
function mobPubShowOutOfRangeMsg() {
  const wrap = document.getElementById('mob-pub-cal-wrap');
  if (!wrap) return;
  let msg = document.getElementById('mob-pub-cal-range-msg');
  if (!msg) {
    msg = document.createElement('div');
    msg.id = 'mob-pub-cal-range-msg';
    msg.style.cssText = 'margin-bottom:.75rem;padding:.6rem .85rem;background:rgba(255,179,71,.12);border:1px solid rgba(255,179,71,.4);border-radius:6px;color:#ffb347;font-family:"Space Mono",monospace;font-size:.65rem;letter-spacing:.04em;text-align:center;line-height:1.45;';
    wrap.insertBefore(msg, wrap.firstChild);
  }
  const win = (mobPubBs && mobPubBs.mob_booking_window) || 24;
  const label = win < 12 ? `${win} Month${win > 1 ? 's' : ''}` : `${win/12} Year${win/12 > 1 ? 's' : ''}`;
  const who = (mobPubDjData && mobPubDjData.name) || 'This DJ';
  msg.textContent = `${who} only accepts bookings up to ${label} in advance.`;
  msg.style.display = 'block';
  clearTimeout(window._mobPubRangeMsgT);
  window._mobPubRangeMsgT = setTimeout(() => { msg.style.display = 'none'; }, 4000);
}

// Populate the month + year dropdowns based on the DJ's booking window
function mobPubPopulateDropdowns() {
  const monthSel = document.getElementById('mob-pub-cal-month-select');
  const yearSel = document.getElementById('mob-pub-cal-year-select');
  if (!monthSel || !yearSel) return;
  monthSel.innerHTML = PUB_CAL_MONTHS.map((n, i) => `<option value="${i}">${n}</option>`).join('');
  const today = new Date();
  const maxYM = mobPubMaxYM();
  const curY = today.getFullYear();
  let opts = '';
  for (let y = curY; y <= maxYM.year; y++) opts += `<option value="${y}">${y}</option>`;
  yearSel.innerHTML = opts;
  monthSel.value = mobPubCalMonth;
  yearSel.value = mobPubCalYear;
}

// Handler when user picks from month/year dropdowns
function mobPubCalJumpSplit() {
  const m = parseInt(document.getElementById('mob-pub-cal-month-select').value);
  const y = parseInt(document.getElementById('mob-pub-cal-year-select').value);
  let targetY = y, targetM = m;
  if (!mobPubInRange(targetY, targetM)) {
    mobPubShowOutOfRangeMsg();
    const min = mobPubMinYM(), max = mobPubMaxYM();
    const v = targetY * 12 + targetM;
    const minV = min.year * 12 + min.month;
    const maxV = max.year * 12 + max.month;
    const clamped = Math.max(minV, Math.min(maxV, v));
    targetY = Math.floor(clamped / 12); targetM = clamped % 12;
  }
  mobPubCalMonth = targetM;
  mobPubCalYear = targetY;
  drawMobPubCal();
}

function drawMobPubCal() {
  const y = mobPubCalYear, m = mobPubCalMonth;
  const bs = mobPubBs;
  const bookingDays = bs.mob_booking_days || {};
  const windowMonths = bs.mob_booking_window || 24;
  const defaultPerDay = bs.mob_bookings_per_day || 1;
  const today = new Date();
  const maxDate = new Date(today.getFullYear(), today.getMonth() + windowMonths, today.getDate());
  const label = document.getElementById('mob-pub-cal-label');
  if (label) label.textContent = PUB_CAL_MONTHS[m] + ' ' + y;
  // Sync dropdowns to current month/year
  const mSel = document.getElementById('mob-pub-cal-month-select');
  const ySel = document.getElementById('mob-pub-cal-year-select');
  if (mSel) mSel.value = m;
  if (ySel) ySel.value = y;
  // Dim/disable prev/next at bounds
  const prevBtn = document.getElementById('mob-pub-cal-prev');
  const nextBtn = document.getElementById('mob-pub-cal-next');
  if (prevBtn || nextBtn) {
    const min = mobPubMinYM(), max = mobPubMaxYM();
    const cur = y * 12 + m;
    const atMin = cur <= (min.year * 12 + min.month);
    const atMax = cur >= (max.year * 12 + max.month);
    if (prevBtn) {
      prevBtn.disabled = atMin;
      prevBtn.style.opacity = atMin ? '0.3' : '1';
      prevBtn.style.cursor = atMin ? 'not-allowed' : 'pointer';
    }
    if (nextBtn) {
      nextBtn.disabled = atMax;
      nextBtn.style.opacity = atMax ? '0.3' : '1';
      nextBtn.style.cursor = atMax ? 'not-allowed' : 'pointer';
    }
  }

  const grid = document.getElementById('mob-pub-cal-grid');
  if (!grid) return;

  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  let html = `<div style="display:grid;grid-template-columns:repeat(7,1fr);border-left:1px solid var(--border);border-top:1px solid var(--border);border-radius:8px 8px 0 0;overflow:hidden;">`;
  dayNames.forEach((name,i) => {
    html += `<div style="background:rgba(255,255,255,.04);border-right:1px solid var(--border);border-bottom:1px solid var(--border);${i===0?'border-radius:8px 0 0 0;':''}${i===6?'border-radius:0 8px 0 0;':''}padding:.5rem 0;text-align:center;font-family:'Space Mono',monospace;font-size:.55rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);">${name}</div>`;
  });
  html += `</div><div style="display:grid;grid-template-columns:repeat(7,1fr);border-left:1px solid var(--border);border-radius:0 0 8px 8px;overflow:hidden;">`;

  for (let i = 0; i < firstDay; i++) {
    html += `<div style="border-right:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06);min-height:70px;background:rgba(255,255,255,.01);"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayData = bookingDays[key] || {};
    const dateObj = new Date(y, m, d);
    const isPast = dateObj < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const isBeyond = dateObj > maxDate;
    const isBooked = dayData.booked;
    const isUnavail = dayData.unavailable;
    const isToday = y===today.getFullYear() && m===today.getMonth() && d===today.getDate();
    const bookingsLeft = dayData.bookings_available != null ? dayData.bookings_available : defaultPerDay;
    const isFull = !isBooked && !isUnavail && bookingsLeft <= 0;
    const isSelected = mobPubSelectedDate === key;
    const isAvail = !isPast && !isBeyond && !isBooked && !isUnavail && !isFull;

    let bg = 'transparent';
    if (isSelected) bg = 'rgba(255,179,71,.2)';
    else if (isBooked) bg = 'rgba(255,60,60,.2)';
    else if (isUnavail || isFull) bg = 'rgba(90,90,120,.15)';
    else if (isToday) bg = 'rgba(0,245,196,.15)';
    else if (isAvail) bg = 'rgba(0,245,196,.08)';

    let numColor = isPast||isBeyond ? 'var(--muted)' : isBooked ? '#ff5f5f' : isUnavail||isFull ? 'var(--muted)' : isSelected ? 'var(--amber)' : isToday ? 'var(--neon)' : 'var(--white)';

    let badge = '';
    if (mobPubIsOwner && !isPast) {
      // Owner sees ✕/✓ quick-mark and ✏️ edit controls at bottom of cell
      badge = `
        ${!isBooked ? `<button type="button" onclick="mobPubQuickMark('${key}')" title="${isUnavail ? 'Mark available' : 'Mark unavailable'}"
          style="position:absolute;bottom:4px;left:4px;background:transparent;border:none;color:${isUnavail ? 'var(--neon)' : 'rgba(255,255,255,.3)'};cursor:pointer;font-size:.8rem;padding:0;line-height:1;font-weight:700;">${isUnavail ? '✓' : '✕'}</button>` : ''}
        <button type="button" onclick="mobPubOwnerEdit('${key}')" title="Edit day"
          style="position:absolute;bottom:4px;right:4px;background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:.75rem;padding:0;line-height:1;">✏️</button>`;
    } else if (!mobPubIsOwner && isAvail) {
      // mobPubBookDayGated handles signed-out (showBookingGate), unverified
      // (requireVerifiedEmail alert + banner flash), and verified (open form).
      const action = `mobPubBookDayGated('${key}')`;
      badge = `<div style="font-family:'Space Mono',monospace;font-size:.6rem;padding:2px 5px;border-radius:3px;background:rgba(0,245,196,.18);color:var(--neon);border:1px solid rgba(0,245,196,.2);cursor:pointer;margin-top:2px;" onclick="${action}">Book</div>`;
    } else if (!mobPubIsOwner && isBooked && dayData.eventName && dayData.location !== 'Private') {
      badge = `<div style="font-size:clamp(.42rem,.9vw,.55rem);color:#ff7070;line-height:1.2;text-align:center;margin-top:2px;">${dayData.eventName}</div>`;
    }

    const isLastRow = Math.floor((firstDay+d-1)/7) === Math.floor((firstDay+daysInMonth-1)/7);
    html += `<div style="position:relative;border-right:1px solid var(--border);border-bottom:1px solid var(--border);${isLastRow?'border-bottom:none;':''}min-height:70px;padding:.35rem .15rem .25rem;background:${bg};${isToday?'outline:2px solid var(--neon);outline-offset:-1px;':''}${isSelected?'outline:2px solid var(--amber);outline-offset:-1px;':''}display:flex;flex-direction:column;align-items:center;overflow:hidden;">
      <div style="font-size:clamp(.75rem,1.5vw,.95rem);color:${numColor};line-height:1;">${d}</div>
      ${badge}
    </div>`;
  }

  const remainder = (firstDay + daysInMonth) % 7;
  if (remainder !== 0) for (let i = remainder; i < 7; i++) html += `<div style="border-right:1px solid var(--border);min-height:70px;background:rgba(255,255,255,.01);"></div>`;
  html += `</div>`;
  grid.innerHTML = html;
}

function mobPubCalNav(dir) {
  let newM = mobPubCalMonth + dir;
  let newY = mobPubCalYear;
  if (newM > 11) { newM = 0; newY++; }
  if (newM < 0) { newM = 11; newY--; }
  // Don't navigate past the booking window or before the current month.
  // Show the friendly toast only when going forward past the window.
  if (!mobPubInRange(newY, newM)) {
    if (dir > 0) mobPubShowOutOfRangeMsg();
    return;
  }
  mobPubCalMonth = newM;
  mobPubCalYear = newY;
  drawMobPubCal();
}

async function mobPubQuickMark(key) {
  const cu = JSON.parse(sessionStorage.getItem('currentUser')||localStorage.getItem('currentUser')||'null');
  if (!cu) return;
  const days = mobPubBs.mob_booking_days || {};
  if (days[key] && days[key].booked) return;
  if (days[key] && days[key].unavailable) delete days[key];
  else days[key] = { unavailable: true };
  mobPubBs.mob_booking_days = days;
  drawMobPubCal();
  await mobPubOwnerSaveDays(cu.id, days);
}

async function mobPubOwnerSaveDays(userId, days) {
  try {
    const { data: current } = await db.from('users').select('booking_settings').eq('id', userId).single();
    const bs = current?.booking_settings ? (typeof current.booking_settings === 'string' ? JSON.parse(current.booking_settings) : current.booking_settings) : {};
    bs.mob_booking_days = days;
    await db.from('users').update({ booking_settings: JSON.stringify(bs) }).eq('id', userId);
  } catch(e) { console.error('mobPubOwnerSaveDays error:', e); }
}

function mobPubOwnerEdit(key) {
  const cu = JSON.parse(sessionStorage.getItem('currentUser')||localStorage.getItem('currentUser')||'null');
  if (!cu) return;
  const days = mobPubBs.mob_booking_days || {};
  const d = days[key] || {};
  const defaultPerDay = mobPubBs.mob_bookings_per_day || 1;
  const [y, m, day] = key.split('-').map(Number);
  const dateLabel = new Date(y, m-1, day).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const currentPerDay = d.bookings_available != null ? d.bookings_available : defaultPerDay;

  const existing = document.getElementById('mob-pub-owner-day-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'mob-pub-owner-day-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:1.5rem;';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.75rem;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
        <div style="font-family:'Space Mono',monospace;font-size:.72rem;letter-spacing:.06em;color:var(--neon);">${dateLabel}</div>
        <button type="button" onclick="document.getElementById('mob-pub-owner-day-modal').remove()" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:1.2rem;">✕</button>
      </div>

      <div style="margin-bottom:1rem;display:flex;flex-direction:column;gap:.5rem;">
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;">
          <input type="radio" name="mob-pub-day-status" value="available" ${!d.booked && !d.unavailable ? 'checked' : ''} style="accent-color:var(--neon);" onchange="mobPubOwnerToggleStatus()">
          <span style="font-size:.85rem;color:var(--white);">Available</span>
        </label>
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;">
          <input type="radio" name="mob-pub-day-status" value="unavailable" ${d.unavailable ? 'checked' : ''} style="accent-color:var(--muted);" onchange="mobPubOwnerToggleStatus()">
          <span style="font-size:.85rem;color:var(--muted);">Unavailable</span>
        </label>
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;">
          <input type="radio" name="mob-pub-day-status" value="booked" ${d.booked ? 'checked' : ''} style="accent-color:#ff5f5f;" onchange="mobPubOwnerToggleStatus()">
          <span style="font-size:.85rem;color:#ff5f5f;">Booked</span>
        </label>
      </div>

      <div id="mob-pub-avail-fields" style="${!d.booked && !d.unavailable ? '' : 'display:none;'}margin-bottom:.75rem;">
        <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--neon);display:block;margin-bottom:.35rem;">Bookings available this day</label>
        <input type="number" id="mob-pub-day-bookings" min="0" max="99" value="${currentPerDay}" style="width:80px;background:var(--deep);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-family:'Space Mono',monospace;font-size:.8rem;text-align:center;">
        <span style="font-size:.75rem;color:var(--muted);margin-left:.5rem;">Set to 0 to block day</span>
      </div>

      <div id="mob-pub-booked-fields" style="${d.booked ? '' : 'display:none;'}">
        <div style="margin-bottom:.75rem;">
          <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.35rem;">Event Name</label>
          <input type="text" id="mob-pub-event-name" placeholder="Wedding Reception..." value="${d.eventName||''}" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
        </div>
        <div style="margin-bottom:.75rem;">
          <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;margin-bottom:.35rem;">
            <input type="checkbox" id="mob-pub-private" ${d.location==='Private'?'checked':''} style="accent-color:var(--neon);">
            <span style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);">Private Location</span>
          </label>
          <input type="text" id="mob-pub-location" placeholder="Location" value="${d.location!=='Private'?(d.location||''):''}" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
        </div>
        <div style="display:flex;gap:.75rem;">
          <div style="flex:1;">
            <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.35rem;">Start Time</label>
            <input type="time" id="mob-pub-start" value="${d.startTime||''}" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
          </div>
          <div style="flex:1;">
            <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.35rem;">End Time</label>
            <input type="time" id="mob-pub-end" value="${d.endTime||''}" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:5px;padding:.5rem .75rem;color:var(--white);font-size:.85rem;font-family:'DM Sans',sans-serif;">
          </div>
        </div>
      </div>

      <div style="display:flex;gap:.75rem;margin-top:1.25rem;">
        <button type="button" onclick="document.getElementById('mob-pub-owner-day-modal').remove()" style="flex:1;padding:.75rem;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--muted);font-family:'Space Mono',monospace;font-size:.62rem;cursor:pointer;">Cancel</button>
        <button type="button" onclick="mobPubOwnerSaveDay('${key}','${cu.id}')" style="flex:1;padding:.75rem;background:var(--neon);border:none;border-radius:6px;color:var(--black);font-family:'Space Mono',monospace;font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;">Save Day</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function mobPubOwnerToggleStatus() {
  const val = document.querySelector('input[name="mob-pub-day-status"]:checked')?.value;
  document.getElementById('mob-pub-avail-fields').style.display = val === 'available' ? '' : 'none';
  document.getElementById('mob-pub-booked-fields').style.display = val === 'booked' ? '' : 'none';
}

async function mobPubOwnerSaveDay(key, userId) {
  const statusVal = document.querySelector('input[name="mob-pub-day-status"]:checked')?.value;
  const defaultPerDay = mobPubBs.mob_bookings_per_day || 1;
  const days = mobPubBs.mob_booking_days || {};

  if (statusVal === 'unavailable') {
    days[key] = { unavailable: true };
  } else if (statusVal === 'booked') {
    const isPrivate = document.getElementById('mob-pub-private').checked;
    days[key] = {
      booked: true,
      eventName: document.getElementById('mob-pub-event-name').value.trim(),
      location: isPrivate ? 'Private' : document.getElementById('mob-pub-location').value.trim(),
      startTime: document.getElementById('mob-pub-start').value,
      endTime: document.getElementById('mob-pub-end').value,
    };
  } else {
    const perDay = parseInt(document.getElementById('mob-pub-day-bookings')?.value || defaultPerDay);
    if (perDay <= 0) days[key] = { unavailable: true };
    else if (perDay !== defaultPerDay) days[key] = { bookings_available: perDay };
    else delete days[key];
  }

  mobPubBs.mob_booking_days = days;
  document.getElementById('mob-pub-owner-day-modal').remove();
  drawMobPubCal();
  await mobPubOwnerSaveDays(userId, days);
}

// Phone format helper: formats a phone input value as the user types based on country code.
// Supports common countries; falls back to a generic grouped format for others.
const MPF_PHONE_FORMATS = {
  'US': { pattern: [3,3,4], placeholder: '(555) 555-5555', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 3) return '(' + d;
    if (d.length <= 6) return '(' + d.slice(0,3) + ') ' + d.slice(3);
    return '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6,10);
  }},
  'CA': { pattern: [3,3,4], placeholder: '(555) 555-5555', render: d => MPF_PHONE_FORMATS.US.render(d) },
  'GB': { placeholder: '07123 456789', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 5) return d;
    return d.slice(0,5) + ' ' + d.slice(5,11);
  }},
  'AU': { placeholder: '0412 345 678', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 4) return d;
    if (d.length <= 7) return d.slice(0,4) + ' ' + d.slice(4);
    return d.slice(0,4) + ' ' + d.slice(4,7) + ' ' + d.slice(7,10);
  }},
  'DE': { placeholder: '0151 12345678', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 4) return d;
    return d.slice(0,4) + ' ' + d.slice(4,12);
  }},
  'FR': { placeholder: '01 23 45 67 89', render: d => {
    if (d.length === 0) return '';
    const parts = [];
    for (let i = 0; i < d.length && i < 10; i += 2) parts.push(d.slice(i, i+2));
    return parts.join(' ');
  }},
  'ES': { placeholder: '612 34 56 78', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 3) return d;
    if (d.length <= 5) return d.slice(0,3) + ' ' + d.slice(3);
    if (d.length <= 7) return d.slice(0,3) + ' ' + d.slice(3,5) + ' ' + d.slice(5);
    return d.slice(0,3) + ' ' + d.slice(3,5) + ' ' + d.slice(5,7) + ' ' + d.slice(7,9);
  }},
  'IT': { placeholder: '312 345 6789', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0,3) + ' ' + d.slice(3);
    return d.slice(0,3) + ' ' + d.slice(3,6) + ' ' + d.slice(6,10);
  }},
  'NL': { placeholder: '06 12345678', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 2) return d;
    return d.slice(0,2) + ' ' + d.slice(2,10);
  }},
  'MX': { placeholder: '55 1234 5678', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 2) return d;
    if (d.length <= 6) return d.slice(0,2) + ' ' + d.slice(2);
    return d.slice(0,2) + ' ' + d.slice(2,6) + ' ' + d.slice(6,10);
  }},
  'BR': { placeholder: '(11) 91234-5678', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 2) return '(' + d;
    if (d.length <= 7) return '(' + d.slice(0,2) + ') ' + d.slice(2);
    return '(' + d.slice(0,2) + ') ' + d.slice(2,7) + '-' + d.slice(7,11);
  }},
  'JP': { placeholder: '090-1234-5678', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 3) return d;
    if (d.length <= 7) return d.slice(0,3) + '-' + d.slice(3);
    return d.slice(0,3) + '-' + d.slice(3,7) + '-' + d.slice(7,11);
  }},
  'IN': { placeholder: '98765 43210', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 5) return d;
    return d.slice(0,5) + ' ' + d.slice(5,10);
  }},
  'IE': { placeholder: '085 123 4567', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0,3) + ' ' + d.slice(3);
    return d.slice(0,3) + ' ' + d.slice(3,6) + ' ' + d.slice(6,10);
  }},
  'NZ': { placeholder: '021 123 4567', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0,3) + ' ' + d.slice(3);
    return d.slice(0,3) + ' ' + d.slice(3,6) + ' ' + d.slice(6,10);
  }},
  'ZA': { placeholder: '082 123 4567', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0,3) + ' ' + d.slice(3);
    return d.slice(0,3) + ' ' + d.slice(3,6) + ' ' + d.slice(6,10);
  }},
  'AE': { placeholder: '050 123 4567', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0,3) + ' ' + d.slice(3);
    return d.slice(0,3) + ' ' + d.slice(3,6) + ' ' + d.slice(6,10);
  }},
  'SG': { placeholder: '9123 4567', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 4) return d;
    return d.slice(0,4) + ' ' + d.slice(4,8);
  }},
  'CH': { placeholder: '079 123 45 67', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0,3) + ' ' + d.slice(3);
    if (d.length <= 8) return d.slice(0,3) + ' ' + d.slice(3,6) + ' ' + d.slice(6);
    return d.slice(0,3) + ' ' + d.slice(3,6) + ' ' + d.slice(6,8) + ' ' + d.slice(8,10);
  }},
  'SE': { placeholder: '070 123 45 67', render: d => MPF_PHONE_FORMATS.CH.render(d) },
  'NO': { placeholder: '412 34 567', render: d => {
    if (d.length === 0) return '';
    if (d.length <= 3) return d;
    if (d.length <= 5) return d.slice(0,3) + ' ' + d.slice(3);
    return d.slice(0,3) + ' ' + d.slice(3,5) + ' ' + d.slice(5,8);
  }},
  'DK': { placeholder: '12 34 56 78', render: d => MPF_PHONE_FORMATS.FR.render(d) }
};

function mpf_getCountryCode() {
  const cu = JSON.parse(sessionStorage.getItem('currentUser')||localStorage.getItem('currentUser')||'null');
  if (!cu || !cu.country) return 'US';
  const map = {'United States':'US','United Kingdom':'GB','Canada':'CA','Australia':'AU','Germany':'DE','France':'FR','Spain':'ES','Italy':'IT','Netherlands':'NL','Sweden':'SE','Norway':'NO','Denmark':'DK','New Zealand':'NZ','Singapore':'SG','South Africa':'ZA','UAE':'AE','India':'IN','Japan':'JP','Mexico':'MX','Brazil':'BR','Switzerland':'CH','Ireland':'IE'};
  return map[cu.country] || 'US';
}

function mpf_formatPhone(raw, countryCode) {
  const digits = String(raw||'').replace(/\D/g,'');
  const fmt = MPF_PHONE_FORMATS[countryCode] || MPF_PHONE_FORMATS.US;
  return fmt.render(digits);
}

function mpf_initPhoneField() {
  const el = document.getElementById('mpf-phone');
  if (!el) return;
  const code = mpf_getCountryCode();
  const fmt = MPF_PHONE_FORMATS[code] || MPF_PHONE_FORMATS.US;
  el.placeholder = fmt.placeholder;
  el.addEventListener('input', () => {
    el.value = mpf_formatPhone(el.value, code);
  });
}

// Rolling 12-month grid view for mobile DJ profiles. Shown when the user
// clicks "Book Now" — gives them the same compressed all-year overview the
// club/bar DJs get via pubCalShowRolling/drawRolling12Months. Capped at the
// DJ's mob_booking_window setting (defaults 24mo for mobile DJs).
function mobPubShowRolling() {
  if (!mobPubRollingActive) mobPubToggleView();
}

function mobPubToggleView() {
  mobPubRollingActive = !mobPubRollingActive;
  const single = document.getElementById('mob-pub-cal-single-wrap');
  const rolling = document.getElementById('mob-pub-cal-rolling-wrap');
  const toggle = document.getElementById('mob-pub-cal-view-toggle');
  if (!single || !rolling) return;
  if (mobPubRollingActive) {
    single.style.display = 'none';
    rolling.style.display = 'block';
    if (toggle) {
      toggle.textContent = '← Month View';
      toggle.style.borderColor = 'var(--neon)';
      toggle.style.color = 'var(--neon)';
    }
    mobPubDrawRolling();
  } else {
    single.style.display = '';
    rolling.style.display = 'none';
    if (toggle) {
      toggle.textContent = '12 Months';
      toggle.style.borderColor = 'var(--white)';
      toggle.style.color = 'var(--white)';
    }
  }
}

function mobPubDrawRolling() {
  const rolling = document.getElementById('mob-pub-cal-rolling-wrap');
  if (!rolling || !mobPubBs) return;
  const windowMonths = mobPubBs.mob_booking_window || 12;
  const bookingDays = mobPubBs.mob_booking_days || {};
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const dayLabels = ['S','M','T','W','T','F','S'];

  // 3-up grid on desktop, single column on mobile (≤600px). Inline styles can't
  // hold media queries, so we stamp a small <style> block alongside the grid.
  let html = `<style>
    .mob-pub-rolling-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:.75rem; }
    @media(max-width:600px) { .mob-pub-rolling-grid { grid-template-columns:1fr; } }
  </style>
  <div class="mob-pub-rolling-grid">`;

  for (let i = 0; i < windowMonths; i++) {
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
      const dayData = bookingDays[key] || {};
      const isPast = key < todayKey;
      const isBooked = dayData.booked;
      const isUnavail = dayData.unavailable;
      const isToday = key === todayKey;
      const isAvail = !isPast && !isBooked && !isUnavail;

      let bg = 'transparent';
      let color = 'var(--muted)';
      if (isPast) { bg = 'transparent'; color = '#3a3a4e'; }
      else if (isBooked) { bg = 'rgba(255,95,95,.12)'; color = '#ff5f5f'; }
      else if (isUnavail) { bg = 'rgba(107,107,136,.12)'; color = 'var(--muted)'; }
      else if (isAvail) { bg = 'rgba(0,245,196,.1)'; color = 'var(--neon)'; }

      const cellAttrs = (!mobPubIsOwner && isAvail)
        ? `cursor:pointer;" onclick="mobPubBookDayGated('${key}')`
        : `cursor:default;`;
      const todayOutline = isToday ? 'outline:1px solid var(--neon);outline-offset:-1px;' : '';

      html += `<div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-family:'Space Mono',monospace;font-size:.5rem;background:${bg};color:${color};border-radius:2px;${todayOutline}${cellAttrs}">${d}</div>`;
    }

    html += `</div></div>`;
  }
  html += `</div>`;
  rolling.innerHTML = html;
}

function mobPubBookDayGated(key) {
  const cu = (window.GDJAuth && window.GDJAuth.user && window.GDJAuth.user()) || null;
  if (!cu) { showBookingGate(); return; }
  if (window.GDJAuth && !window.GDJAuth.requireVerifiedEmail('book a DJ')) return;
  mobPubSelectDate(key);
}

function mobPubSelectDate(key) {
  mobPubSelectedDate = key;
  mobPubSelectedPkg = null;
  drawMobPubCal();
  renderMobPubForm(key);
  document.getElementById('mob-pub-booking-form').scrollIntoView({ behavior:'smooth', block:'start' });
}

function renderMobPubForm(dateKey) {
  const formEl = document.getElementById('mob-pub-booking-form');
  if (!formEl) return;
  const bs = mobPubBs;
  const djData = mobPubDjData;
  const [y,m,d] = dateKey.split('-').map(Number);
  const dateLabel = new Date(y, m-1, d).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const eventTypes = (djData.event_types||'').split(',').map(s=>s.trim()).filter(Boolean);
  const packages = bs.mob_packages || {};
  const depositPct = bs.mob_deposit_pct || 0;
  const timeOpts = MOB_TIME_OPTIONS.map(o=>`<option value="${o.val}">${o.label}</option>`).join('');
  const cocktailTimeOpts = MOB_TIME_OPTIONS.map(o=>`<option value="${o.val}">${o.label}</option>`).join('');

  const eventTypeOptions = Object.entries(MOB_EVENT_TYPE_LABELS).map(([val, lbl]) => {
    if (!eventTypes.includes(val)) return '';
    return `<option value="${val}">${lbl}</option>`;
  }).filter(Boolean).join('');

  formEl.style.display = 'block';
  formEl.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.5rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:.06em;color:var(--white);">Request Booking</div>
        <div style="font-family:'Space Mono',monospace;font-size:.62rem;color:var(--neon);">${dateLabel}</div>
      </div>
      <div id="mob-pub-form-alert" style="margin-bottom:.75rem;"></div>

      <!-- Phone -->
      <div style="margin-bottom:1rem;">
        <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.4rem;">Phone Number</label>
        <input type="tel" id="mpf-phone" placeholder="(555) 555-5555" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.6rem .85rem;color:var(--white);font-size:.9rem;font-family:'DM Sans',sans-serif;outline:none;">
      </div>

      <!-- Event Type -->
      <div style="margin-bottom:1rem;">
        <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.4rem;">Type of Event</label>
        <select id="mpf-event-type" onchange="mobPubEventTypeChange()" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.6rem .85rem;color:var(--white);font-size:.9rem;font-family:'DM Sans',sans-serif;outline:none;">
          <option value="">Select event type...</option>
          ${eventTypeOptions}
        </select>
        <input type="text" id="mpf-event-type-other" placeholder="Describe your event..." style="display:none;margin-top:.4rem;width:100%;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.6rem .85rem;color:var(--white);font-size:.9rem;font-family:'DM Sans',sans-serif;outline:none;">
      </div>

      <!-- Venue -->
      <div style="margin-bottom:1rem;">
        <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.4rem;">Venue Name</label>
        <input type="text" id="mpf-venue-name" placeholder="The Grand Ballroom" oninput="mobPubRenderPackages()" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.6rem .85rem;color:var(--white);font-size:.9rem;font-family:'DM Sans',sans-serif;outline:none;">
      </div>

      <!-- Address -->
      <div style="margin-bottom:1rem;position:relative;">
        <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.4rem;">Venue Address</label>
        <input type="text" id="mpf-venue-address" placeholder="123 Main St, City, State" autocomplete="off" oninput="mobPubAddressAuto(this);mobPubRenderPackages();" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.6rem .85rem;color:var(--white);font-size:.9rem;font-family:'DM Sans',sans-serif;outline:none;">
        <div id="mpf-addr-suggestions" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:200;background:var(--card);border:1px solid var(--border);border-radius:6px;max-height:160px;overflow-y:auto;"></div>
      </div>

      <!-- Room Details -->
      <div style="margin-bottom:1rem;">
        <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.4rem;">Room Details <span style="color:var(--muted);font-size:.55rem;text-transform:none;letter-spacing:0;">(optional)</span></label>
        <input type="text" id="mpf-room" placeholder="e.g. Grand Ballroom, 3rd Floor Terrace" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.6rem .85rem;color:var(--white);font-size:.9rem;font-family:'DM Sans',sans-serif;outline:none;">
      </div>

      <!-- Guest Count -->
      <div style="margin-bottom:1rem;">
        <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.4rem;">Estimated Number of Guests</label>
        <input type="number" id="mpf-guests" min="1" placeholder="150" style="width:120px;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.6rem .85rem;color:var(--white);font-size:.9rem;font-family:'DM Sans',sans-serif;outline:none;">
      </div>

      <!-- Times -->
      <div style="font-family:'Space Mono',monospace;font-size:.62rem;letter-spacing:.06em;text-transform:uppercase;color:var(--neon);margin-bottom:.6rem;">${dateLabel}</div>
      <div style="display:flex;gap:.75rem;margin-bottom:1rem;flex-wrap:wrap;">
        <div style="flex:1;min-width:140px;">
          <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.4rem;" id="mpf-start-label">Event Start Time</label>
          <select id="mpf-start-time" onchange="mobPubRenderPackages();mobPubCalcPrice();mobPubCheckCocktailTime();" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.6rem .75rem;color:var(--white);font-size:.88rem;font-family:'DM Sans',sans-serif;outline:none;">
            <option value="">Select time...</option>${timeOpts}
          </select>
        </div>
        <div style="flex:1;min-width:140px;">
          <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.4rem;" id="mpf-end-label">Event End Time</label>
          <select id="mpf-end-time" onchange="mobPubRenderPackages();mobPubCalcPrice();" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.6rem .75rem;color:var(--white);font-size:.88rem;font-family:'DM Sans',sans-serif;outline:none;">
            <option value="">Select time...</option>${timeOpts}
          </select>
        </div>
      </div>

      <!-- Wedding cocktail section -->
      <div id="mpf-wedding-fields" style="display:none;background:rgba(0,245,196,.04);border:1px solid rgba(0,245,196,.12);border-radius:8px;padding:1rem;margin-bottom:1rem;">
        <div style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--neon);margin-bottom:.75rem;">Cocktail Hour</div>
        <div style="font-size:.88rem;color:var(--white);margin-bottom:.6rem;">Is music needed for cocktail hour?</div>
        <div style="display:flex;gap:.75rem;margin-bottom:.75rem;">
          <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;padding:.5rem .85rem;border-radius:6px;border:1px solid var(--border);background:var(--deep);flex:1;justify-content:center;" id="mpf-cocktail-yes-label">
            <input type="radio" name="mpf-cocktail-yn" value="yes" id="mpf-cocktail-yes" onchange="mobPubCocktailChange()" style="accent-color:var(--neon);">
            <span style="font-family:'Space Mono',monospace;font-size:.65rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);">Yes</span>
          </label>
          <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;padding:.5rem .85rem;border-radius:6px;border:1px solid var(--border);background:var(--deep);flex:1;justify-content:center;" id="mpf-cocktail-no-label">
            <input type="radio" name="mpf-cocktail-yn" value="no" id="mpf-cocktail-no" onchange="mobPubCocktailChange()" style="accent-color:var(--neon);">
            <span style="font-family:'Space Mono',monospace;font-size:.65rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);">No</span>
          </label>
        </div>
        <div id="mpf-cocktail-fields" style="display:none;">
          <div style="margin-bottom:.6rem;">
            <label style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.3rem;">Cocktail Start Time</label>
            <select id="mpf-cocktail-start" onchange="mobPubCheckCocktailTime()" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.5rem .75rem;color:var(--white);font-size:.88rem;font-family:'DM Sans',sans-serif;outline:none;">
              <option value="">Select time...</option>${cocktailTimeOpts}
            </select>
            <div id="mpf-cocktail-time-warn" style="display:none;margin-top:.4rem;font-size:.78rem;color:var(--amber);">⚠ Cocktail hour must start before the reception. Please select an earlier time.</div>
          </div>
          <div style="font-size:.85rem;color:var(--white);margin-bottom:.5rem;">Is the cocktail hour in the same room as the reception?</div>
          <div style="display:flex;gap:.75rem;">
            <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;padding:.5rem .85rem;border-radius:6px;border:1px solid var(--border);background:var(--deep);flex:1;justify-content:center;">
              <input type="radio" name="mpf-cocktail-room" value="yes" id="mpf-cocktail-same-room" style="accent-color:var(--neon);">
              <span style="font-family:'Space Mono',monospace;font-size:.65rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);">Yes</span>
            </label>
            <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;padding:.5rem .85rem;border-radius:6px;border:1px solid var(--border);background:var(--deep);flex:1;justify-content:center;">
              <input type="radio" name="mpf-cocktail-room" value="no" style="accent-color:var(--neon);">
              <span style="font-family:'Space Mono',monospace;font-size:.65rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);">No</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Package selection -->
      <div id="mpf-packages-wrap" style="margin-bottom:1rem;">
        <div id="mpf-packages-placeholder" style="padding:.85rem 1rem;background:rgba(107,107,136,.06);border:1px solid rgba(107,107,136,.2);border-radius:8px;font-family:'Space Mono',monospace;font-size:.62rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:center;line-height:1.6;">
          Available packages will appear once we have all the information about your event.
        </div>
      </div>

      <!-- Price display -->
      <div id="mpf-price-display" style="display:none;text-align:center;padding:1rem 0;margin-bottom:1rem;">
        <div style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.35rem;">Estimated Price</div>
        <div id="mpf-price-value" style="font-family:'Bebas Neue',sans-serif;font-size:3rem;color:var(--neon);letter-spacing:.04em;"></div>
        <div id="mpf-deposit-display" style="font-size:.78rem;color:var(--muted);margin-top:.25rem;"></div>
        <div id="mpf-overtime-note" style="display:none;font-size:.72rem;color:var(--amber);margin-top:.35rem;"></div>
      </div>

      <!-- Message -->
      <div style="margin-bottom:1.25rem;">
        <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.4rem;">Message <span style="color:var(--muted);font-size:.55rem;text-transform:none;letter-spacing:0;">(optional)</span></label>
        <textarea id="mpf-message" placeholder="Tell the DJ about your event..." rows="3" style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.6rem .85rem;color:var(--white);font-size:.9rem;font-family:'DM Sans',sans-serif;outline:none;resize:vertical;"></textarea>
      </div>

      <button type="button" id="mpf-submit-btn" onclick="mobPubSubmit('${dateKey}')" style="width:100%;padding:.9rem;background:var(--neon);border:none;border-radius:6px;color:var(--black);font-family:'Space Mono',monospace;font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;">Request Booking</button>
    </div>`;

  // Render packages for any already-selected event type (none yet)
  mobPubRenderPackages();
  // Initialize phone formatter based on booker's country
  mpf_initPhoneField();
}

function mobPubEventTypeChange() {
  const sel = document.getElementById('mpf-event-type');
  const val = sel ? sel.value : '';
  const otherInput = document.getElementById('mpf-event-type-other');
  if (otherInput) otherInput.style.display = val === 'other' ? '' : 'none';

  // Toggle wedding fields
  const weddingFields = document.getElementById('mpf-wedding-fields');
  if (weddingFields) weddingFields.style.display = val === 'weddings' ? '' : 'none';
  const startLabel = document.getElementById('mpf-start-label');
  const endLabel = document.getElementById('mpf-end-label');
  if (startLabel) startLabel.textContent = val === 'weddings' ? 'Reception Start Time' : 'Event Start Time';
  if (endLabel) endLabel.textContent = val === 'weddings' ? 'Reception End Time' : 'Event End Time';

  mobPubSelectedPkg = null;
  mobPubRenderPackages();
  mobPubCalcPrice();
}

function mobPubCocktailChange() {
  const yes = document.getElementById('mpf-cocktail-yes');
  const fields = document.getElementById('mpf-cocktail-fields');
  if (fields) fields.style.display = yes && yes.checked ? '' : 'none';
}

function mobPubCheckCocktailTime() {
  const cocktailVal = document.getElementById('mpf-cocktail-start')?.value;
  const receptionVal = document.getElementById('mpf-start-time')?.value;
  const warn = document.getElementById('mpf-cocktail-time-warn');
  if (!warn) return;
  if (cocktailVal && receptionVal && cocktailVal >= receptionVal) {
    warn.style.display = '';
  } else {
    warn.style.display = 'none';
  }
}

function mobPubViewPhoto(e, url) {
  e.preventDefault();
  const existing = document.getElementById('mobpub-photo-lightbox');
  if (existing) existing.remove();
  const lb = document.createElement('div');
  lb.id = 'mobpub-photo-lightbox';
  lb.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:1.5rem;';
  lb.onclick = () => lb.remove();
  lb.innerHTML = `
    <div style="position:relative;max-width:90vw;max-height:85vh;">
      <img src="${url}" style="max-width:100%;max-height:85vh;object-fit:contain;border-radius:8px;border:1px solid var(--border);">
      <button style="position:absolute;top:-12px;right:-12px;background:var(--card);border:1px solid var(--border);border-radius:50%;width:28px;height:28px;color:var(--white);cursor:pointer;font-size:.85rem;display:flex;align-items:center;justify-content:center;" onclick="document.getElementById('mobpub-photo-lightbox').remove()">✕</button>
    </div>`;
  document.body.appendChild(lb);
}

function mobPubGetCategory(eventType) {
  if (eventType === 'weddings') return 'wedding';
  if (eventType === 'mitzvah') return 'mitzvah';
  return 'general';
}

function mobPubFormReady() {
  const eventType = document.getElementById('mpf-event-type')?.value;
  const venueName = document.getElementById('mpf-venue-name')?.value.trim();
  const venueAddress = document.getElementById('mpf-venue-address')?.value.trim();
  const startTime = document.getElementById('mpf-start-time')?.value;
  const endTime = document.getElementById('mpf-end-time')?.value;
  return !!(eventType && venueName && venueAddress && startTime && endTime);
}

function mobPubRenderPackages() {
  const wrap = document.getElementById('mpf-packages-wrap');
  if (!wrap) return;

  // Gate: all required fields must be filled
  if (!mobPubFormReady()) {
    wrap.innerHTML = `<div id="mpf-packages-placeholder" style="padding:.85rem 1rem;background:rgba(107,107,136,.06);border:1px solid rgba(107,107,136,.2);border-radius:8px;font-family:'Space Mono',monospace;font-size:.62rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:center;line-height:1.6;">Available packages will appear once we have all the information about your event.</div>`;
    document.getElementById('mpf-price-display').style.display = 'none';
    return;
  }

  const sel = document.getElementById('mpf-event-type');
  const eventType = sel ? sel.value : '';
  if (!eventType) { wrap.innerHTML = ''; return; }

  const cat = mobPubGetCategory(eventType);
  const bs = mobPubBs;
  const pkgs = (bs.mob_packages || {})[cat] || [];

  if (pkgs.length === 0) {
    wrap.innerHTML = `<div style="background:rgba(107,107,136,.08);border:1px solid rgba(107,107,136,.2);border-radius:8px;padding:1rem;font-size:.85rem;color:var(--muted);">No packages available for this event type. <a href="#" onclick="openContactModal();return false;" style="color:var(--neon);">Message the DJ</a> to discuss your event.</div>`;
    mobPubSelectedPkg = null;
    return;
  }

  wrap.innerHTML = `<div style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);margin-bottom:.6rem;">Select a Package</div>
    <div id="mpf-pkg-list" class="mpf-pkg-grid"></div>`;

  const list = document.getElementById('mpf-pkg-list');
  const generalPkgs = (bs.mob_packages || {})['general'] || [];
  pkgs.forEach((pkg, idx) => {
    if (!pkg) return;
    // Fall back to general package for shared fields if this category's are empty
    const fallback = generalPkgs[idx] || {};
    const title = pkg.title?.trim() || fallback.title?.trim();
    const details = pkg.details || fallback.details;
    const photo = pkg.photo || fallback.photo;
    if (!title) return;
    const card = document.createElement('div');
    const isSelected = mobPubSelectedPkg === idx;
    card.style.cssText = `position:relative;background:var(--deep);border:1px solid ${isSelected?'var(--white)':'var(--border)'};border-radius:10px;cursor:pointer;transition:border-color .15s;overflow:hidden;display:flex;flex-direction:column;`;
    card.onmouseenter = () => { if (!isSelected) card.style.borderColor = 'rgba(255,255,255,.35)'; };
    card.onmouseleave = () => { if (!isSelected) card.style.borderColor = 'var(--border)'; };
    card.onclick = () => { mobPubSelectedPkg = idx; mobPubRenderPackages(); mobPubCalcPrice(); };

    // Price preview
    let priceHtml = '';
    if (pkg.reqAll) {
      priceHtml = `<div style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--neon-dark);white-space:nowrap;font-weight:700;">Price on request</div>`;
    } else {
      const has4 = pkg.price4, has5 = pkg.price5, has6 = pkg.price6;
      if (has4||has5||has6) {
        const price = has4?pkg.price4:has5?pkg.price5:pkg.price6;
        priceHtml = `<div style="text-align:right;line-height:1;white-space:nowrap;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:2rem;letter-spacing:.04em;color:var(--neon-dark);">$${Number(price).toLocaleString()}</div>
        </div>`;
      }
    }

    // Render details as-is (preserves whatever formatting the DJ chose: plain bullets,
    // numbered list, or the gdj-check-list variant, all styled via CSS)
    let detailsHtml = '';
    if (details) {
      detailsHtml = `<div class="mpf-pkg-details-body" style="font-size:.82rem;color:var(--white);line-height:1.5;">${details}</div>`;
    }

    // Photo thumbnail if present
    const thumbId = `pkg-thumb-${mobPubDjData.id || 'x'}-${idx}`;
    const thumbHtml = photo ? `
      <div style="flex-shrink:0;width:88px;height:88px;border-radius:6px;overflow:hidden;background:var(--card);border:1px solid var(--border);position:relative;cursor:zoom-in;" id="${thumbId}">
        <img src="${photo}" style="width:100%;height:100%;object-fit:cover;display:block;">
        <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.5),transparent 50%);pointer-events:none;"></div>
        <div style="position:absolute;bottom:3px;left:0;right:0;text-align:center;font-family:'Space Mono',monospace;font-size:.48rem;letter-spacing:.06em;text-transform:uppercase;color:var(--white);pointer-events:none;">Sample</div>
      </div>` : '';

    // Selected check badge — bottom-right so it doesn't overlap title or price
    const checkBadge = isSelected ? `
      <div style="position:absolute;bottom:.6rem;right:.6rem;width:22px;height:22px;border-radius:50%;background:var(--white);display:flex;align-items:center;justify-content:center;z-index:2;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#050507" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>
      </div>` : '';

    card.innerHTML = `
      ${checkBadge}
      <div style="padding:.75rem .9rem;display:flex;align-items:center;justify-content:center;gap:.75rem;border-bottom:${details||photo?'1px solid var(--border)':'none'};background:var(--white);position:relative;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:1.35rem;letter-spacing:.03em;color:var(--black);line-height:1.1;text-align:center;">${title}</div>
        ${priceHtml ? `<div style="position:absolute;right:.9rem;top:50%;transform:translateY(-50%);">${priceHtml}</div>` : ''}
      </div>
      ${(details || photo) ? `<div style="padding:.75rem .9rem ${isSelected?'2.3rem':'.75rem'};display:flex;gap:.75rem;align-items:flex-start;flex:1;">
        <div style="flex:1;min-width:0;">${detailsHtml || '<div style="font-size:.78rem;color:var(--muted);font-style:italic;">Details available on request</div>'}</div>
        ${thumbHtml}
      </div>` : (isSelected ? '<div style="height:2rem;"></div>' : '')}`;

    // Wire the thumbnail click separately so it doesn't also trigger card select
    if (photo) {
      setTimeout(() => {
        const thumb = document.getElementById(thumbId);
        if (thumb) thumb.onclick = (e) => { e.stopPropagation(); mobPubViewPhoto(e, photo); };
      }, 0);
    }
    list.appendChild(card);
  });
}

function mobPubCalcPrice() {
  const priceDisplay = document.getElementById('mpf-price-display');
  const priceVal = document.getElementById('mpf-price-value');
  const depositDisplay = document.getElementById('mpf-deposit-display');
  const overtimeNote = document.getElementById('mpf-overtime-note');
  const submitBtn = document.getElementById('mpf-submit-btn');
  if (!priceDisplay) return;

  if (!mobPubFormReady()) { priceDisplay.style.display='none'; return; }

  const sel = document.getElementById('mpf-event-type');
  const eventType = sel ? sel.value : '';
  if (!eventType || mobPubSelectedPkg === null) { priceDisplay.style.display='none'; return; }

  const cat = mobPubGetCategory(eventType);
  const bs = mobPubBs;
  const pkg = ((bs.mob_packages||{})[cat]||[])[mobPubSelectedPkg];
  if (!pkg) { priceDisplay.style.display='none'; return; }

  const startSel = document.getElementById('mpf-start-time');
  const endSel = document.getElementById('mpf-end-time');
  const startVal = startSel ? startSel.value : '';
  const endVal = endSel ? endSel.value : '';

  let totalHours = 0;
  if (startVal && endVal) {
    const [sh,sm] = startVal.split(':').map(Number);
    let [eh,em] = endVal.split(':').map(Number);
    let mins = (eh*60+em)-(sh*60+sm);
    if (mins <= 0) mins += 1440;
    totalHours = mins / 60;
  }

  const depositPct = bs.mob_deposit_pct || 0;
  let price = null;
  let isQuote = false;
  let overtimeHours = 0;

  // If package requires price request, always quote
  if (pkg.reqAll) {
    isQuote = true;
  } else if (totalHours > 0) {
    const hrs = Math.ceil(totalHours);
    if (hrs <= 4) {
      if (pkg.price4) price = Number(pkg.price4); else isQuote = true;
    } else if (hrs <= 5) {
      if (pkg.price5) price = Number(pkg.price5);
      else if (pkg.price4 && pkg.overtime) { price = Number(pkg.price4) + (hrs-4)*Number(pkg.overtime); overtimeHours = hrs-4; }
      else isQuote = true;
    } else if (hrs <= 6) {
      if (pkg.price6) price = Number(pkg.price6);
      else if (pkg.price5 && pkg.overtime) { price = Number(pkg.price5) + (hrs-5)*Number(pkg.overtime); overtimeHours = hrs-5; }
      else if (pkg.price4 && pkg.overtime) { price = Number(pkg.price4) + (hrs-4)*Number(pkg.overtime); overtimeHours = hrs-4; }
      else isQuote = true;
    } else {
      const basePrice = pkg.price6||pkg.price5||pkg.price4;
      const baseHrs = pkg.price6?6:pkg.price5?5:4;
      if (basePrice && pkg.overtime) { price = Number(basePrice) + (hrs-baseHrs)*Number(pkg.overtime); overtimeHours = hrs-baseHrs; }
      else isQuote = true;
    }
  } else {
    if (pkg.price4||pkg.price5||pkg.price6) price = Number(pkg.price4||pkg.price5||pkg.price6);
    else isQuote = true;
  }

  priceDisplay.style.display = '';
  if (isQuote || price === null) {
    priceVal.textContent = 'Price on Request';
    priceVal.style.color = 'var(--muted)';
    priceVal.style.fontSize = '1.2rem';
    if (depositDisplay) depositDisplay.textContent = '';
    if (overtimeNote) overtimeNote.style.display = 'none';
    if (submitBtn) { submitBtn.textContent = 'Request Quote'; submitBtn.style.background = 'var(--neon)'; }
  } else {
    priceVal.textContent = `$${price.toLocaleString()}`;
    priceVal.style.color = 'var(--neon)';
    priceVal.style.fontSize = '3rem';
    if (depositPct > 0) {
      const dep = (price * depositPct / 100).toFixed(2);
      if (depositDisplay) depositDisplay.textContent = `Deposit required: $${Number(dep).toLocaleString()} (${depositPct}%)`;
    } else {
      if (depositDisplay) depositDisplay.textContent = 'No deposit required';
    }
    if (overtimeNote) {
      if (overtimeHours > 0 && pkg.overtime) {
        overtimeNote.style.display = '';
        overtimeNote.textContent = `Includes ${overtimeHours}hr overtime at $${pkg.overtime}/hr`;
      } else {
        overtimeNote.style.display = 'none';
      }
    }
    if (submitBtn) { submitBtn.textContent = 'Request Booking'; submitBtn.style.background = 'var(--neon)'; }
  }
}

let mobPubAddrTimeout = null;
let mobPubVenueCoords = null; // {lat, lon} of last picked address (for distance check)
function mobPubAddressAuto(input) {
  clearTimeout(mobPubAddrTimeout);
  const val = input.value.trim();
  const suggestions = document.getElementById('mpf-addr-suggestions');
  if (!suggestions) return;
  if (val.length < 3) { suggestions.style.display='none'; return; }
  // User is typing — invalidate any previously captured coords until they pick a new suggestion
  mobPubVenueCoords = null;
  mobPubAddrTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=5&addressdetails=1`);
      const results = await res.json();
      if (!results.length) { suggestions.style.display='none'; return; }
      suggestions.style.display = '';
      suggestions.innerHTML = results.map(r => {
        const parts = r.display_name.split(',');
        const clean = parts.filter(p => !/county/i.test(p)).join(',').trim();
        return `<div style="padding:.6rem .85rem;cursor:pointer;font-size:.85rem;border-bottom:1px solid var(--border);" onmouseover="this.style.background='rgba(0,245,196,.08)'" onmouseout="this.style.background=''" onclick="mobPubPickAddr('${clean.replace(/'/g,'\\\'')}', ${r.lat||'null'}, ${r.lon||'null'})">${clean}</div>`;
      }).join('');
    } catch(e) { suggestions.style.display='none'; }
  }, 350);
}

function mobPubPickAddr(addr, lat, lon) {
  const input = document.getElementById('mpf-venue-address');
  if (input) input.value = addr;
  const suggestions = document.getElementById('mpf-addr-suggestions');
  if (suggestions) suggestions.style.display = 'none';
  // Store coords for the distance-check at submit time
  if (lat != null && lon != null) {
    mobPubVenueCoords = { lat: parseFloat(lat), lon: parseFloat(lon) };
  } else {
    mobPubVenueCoords = null;
  }
}

async function mobPubSubmit(dateKey) {
  const cu = JSON.parse(sessionStorage.getItem('currentUser')||localStorage.getItem('currentUser')||'null');
  if (!cu) { showBookingGate(); return; }

  // Gate: require verified email to book a DJ
  if (window.GDJAuth && !window.GDJAuth.requireVerifiedEmail('book a DJ')) {
    return;
  }

  const alertEl = document.getElementById('mob-pub-form-alert');
  const submitBtn = document.getElementById('mpf-submit-btn');
  const bs = mobPubBs;
  const djData = mobPubDjData;

  const showErr = (msg) => {
    if (alertEl) alertEl.innerHTML = `<div style="padding:.75rem 1rem;background:rgba(255,95,95,.12);border:1px solid rgba(255,95,95,.35);border-radius:6px;color:#ff5f5f;font-size:.85rem;margin-bottom:.5rem;">${msg}</div>`;
    else alert(msg);
  };
  const showOk = (msg) => {
    if (alertEl) alertEl.innerHTML = `<div style="padding:.75rem 1rem;background:rgba(61,220,132,.12);border:1px solid rgba(61,220,132,.35);border-radius:6px;color:#3ddc84;font-size:.85rem;margin-bottom:.5rem;">${msg}</div>`;
  };

  const phone = document.getElementById('mpf-phone')?.value.trim();
  const eventType = document.getElementById('mpf-event-type')?.value;
  const eventTypeOther = document.getElementById('mpf-event-type-other')?.value.trim();
  const venueName = document.getElementById('mpf-venue-name')?.value.trim();
  const venueAddress = document.getElementById('mpf-venue-address')?.value.trim();
  const room = document.getElementById('mpf-room')?.value.trim();
  const guests = document.getElementById('mpf-guests')?.value;
  const startTime = document.getElementById('mpf-start-time')?.value;
  const endTime = document.getElementById('mpf-end-time')?.value;
  const message = document.getElementById('mpf-message')?.value.trim();
  const cocktailNeeded = document.getElementById('mpf-cocktail-yes')?.checked || false;
  const cocktailStart = document.getElementById('mpf-cocktail-start')?.value;
  const cocktailSameRoom = document.querySelector('input[name="mpf-cocktail-room"]:checked')?.value === 'yes' || false;
  const isWedding = eventType === 'weddings';

  if (!phone) { showErr('Please enter your phone number.'); return; }
  if (!eventType) { showErr('Please select an event type.'); return; }
  if (!venueName) { showErr('Please enter the venue name.'); return; }
  if (!venueAddress) { showErr('Please enter the venue address.'); return; }
  if (!startTime) { showErr('Please select a start time.'); return; }
  if (cocktailNeeded && cocktailStart && cocktailStart >= startTime) { showErr('Cocktail hour start time must be before the reception start time.'); return; }
  if (mobPubSelectedPkg === null) { showErr('Please select a package.'); return; }

  const cat = mobPubGetCategory(eventType);
  const pkg = ((bs.mob_packages||{})[cat]||[])[mobPubSelectedPkg];
  if (!pkg) { showErr('Invalid package selected.'); return; }

  // ── Distance check ──────────────────────────────────────────
  // If the DJ has a finite travel limit and the venue is further than that,
  // warn the host before submitting. Skip if DJ travels worldwide, if no DJ
  // zip is set, or if the host typed an address freehand without picking a suggestion.
  const travelDist = djData.travel_distance;
  const travelIsFinite = travelDist != null && travelDist !== '' && String(travelDist).toLowerCase() !== 'worldwide' && !isNaN(Number(travelDist));
  if (travelIsFinite && djData.zip && mobPubVenueCoords) {
    const djCoords = await mobPubGetDjCoords(djData.zip);
    if (djCoords) {
      const miles = mobPubHaversineMiles(djCoords.lat, djCoords.lon, mobPubVenueCoords.lat, mobPubVenueCoords.lon);
      const limit = Number(travelDist);
      if (miles > limit) {
        // Wait for host's confirmation before continuing
        const proceed = await mobPubConfirmDistance(Math.round(miles), limit, djData.name || 'this DJ');
        if (!proceed) { return; }
      }
    }
  }
  // ─────────────────────────────────────────────────────────────

  // Determine price / quote
  let totalPrice = null, isQuote = false, depositAmount = null;
  const depositPct = bs.mob_deposit_pct || 0;

  if (pkg.reqAll) {
    isQuote = true;
  } else if (startTime && endTime) {
    const [sh,sm] = startTime.split(':').map(Number);
    let [eh,em] = endTime.split(':').map(Number);
    let mins = (eh*60+em)-(sh*60+sm);
    if (mins<=0) mins+=1440;
    const hrs = Math.ceil(mins/60);
    if (hrs<=4) { if(!pkg.price4) isQuote=true; else totalPrice=Number(pkg.price4); }
    else if (hrs<=5) { if(pkg.price5) totalPrice=Number(pkg.price5); else if(pkg.price4&&pkg.overtime) totalPrice=Number(pkg.price4)+(hrs-4)*Number(pkg.overtime); else isQuote=true; }
    else if (hrs<=6) { if(pkg.price6) totalPrice=Number(pkg.price6); else if(pkg.price5&&pkg.overtime) totalPrice=Number(pkg.price5)+(hrs-5)*Number(pkg.overtime); else if(pkg.price4&&pkg.overtime) totalPrice=Number(pkg.price4)+(hrs-4)*Number(pkg.overtime); else isQuote=true; }
    else { const bp=pkg.price6||pkg.price5||pkg.price4; const bh=pkg.price6?6:pkg.price5?5:4; if(bp&&pkg.overtime) totalPrice=Number(bp)+(hrs-bh)*Number(pkg.overtime); else isQuote=true; }
  } else { isQuote=true; }

  if (totalPrice && depositPct>0) depositAmount = (totalPrice*depositPct/100).toFixed(2);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  try {
    const insertPayload = {
      dj_id: djData.id,
      requester_id: cu.id,
      dj_slug: djData.slug,
      booking_type: 'mobile',
      event_date: dateKey,
      event_type: eventType === 'other' ? (eventTypeOther||'other') : eventType,
      venue_name: venueName,
      venue_address: venueAddress,
      room_details: room||null,
      guest_count: guests ? parseInt(guests) : null,
      start_time: startTime,
      end_time: endTime||null,
      phone: phone,
      cocktail_needed: isWedding ? cocktailNeeded : null,
      cocktail_start_time: isWedding&&cocktailNeeded ? cocktailStart : null,
      cocktail_same_room: isWedding&&cocktailNeeded ? cocktailSameRoom : null,
      package_title: pkg.title,
      package_category: cat,
      package_index: mobPubSelectedPkg,
      quoted_rate: totalPrice||null,
      deposit_pct: depositPct||null,
      deposit_amount: depositAmount||null,
      is_quote: isQuote,
      notes: message||null,
      status: 'pending',
    };
    const { error } = await db.from('bookings').insert(insertPayload);
    if (error) throw error;

    // Email to DJ — server will resolve email from auth.users by djUserId
    try {
      await fetch('/.netlify/functions/send-email', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          type: 'mob_booking_request',
          djUserId: djData.id,
          djName: djData.name,
          requesterName: cu.name,
          eventDate: dateKey, eventType: MOB_EVENT_TYPE_LABELS[eventType]||(eventTypeOther||eventType),
          venueName, venueAddress, roomDetails:room,
          guestCount: guests||null,
          packageTitle: pkg.title, packageCategory: cat,
          startTime, endTime,
          cocktailNeeded: isWedding&&cocktailNeeded,
          cocktailStartTime: cocktailStart,
          cocktailSameRoom,
          totalPrice, depositAmount, depositPct,
          notes: message, isQuote,
          djZip: djData.zip||null, venueZip: null,
        })
      });
    } catch(e) { console.warn('DJ email failed:', e); }

    // Confirmation email to booker — server resolves email from auth.users by requesterUserId
    try {
      await fetch('/.netlify/functions/send-email', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          type: 'mob_booking_confirm',
          requesterUserId: cu.id,
          requesterName: cu.name,
          djName: djData.name, eventDate: dateKey,
          packageTitle: pkg.title, totalPrice, depositAmount, depositPct, isQuote,
        })
      });
    } catch(e) { console.warn('Booker confirm email failed:', e); }

    const djName = mobPubDjData?.name || 'The DJ';
    const formEl = document.getElementById('mob-pub-booking-form');
    if (formEl) {
      formEl.innerHTML = `<div style="background:var(--card);border:1px solid rgba(61,220,132,.3);border-radius:12px;padding:2rem 1.5rem;text-align:center;">
        <div style="font-size:1.6rem;margin-bottom:.75rem;">✓</div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:1.5rem;letter-spacing:.06em;color:#3ddc84;margin-bottom:.5rem;">${isQuote ? 'Quote Request Sent' : 'Booking Request Sent'}</div>
        <div style="font-size:.88rem;color:var(--muted);line-height:1.6;">${djName} will be in touch shortly.</div>
      </div>`;
    }
  } catch(e) {
    console.error('Mobile booking submit error:', e);
    showErr(`Error: ${e.message}`);
    submitBtn.disabled = false;
    submitBtn.textContent = isQuote ? 'Request Quote' : 'Request Booking';
  }
}


// ═══════════════════════════════════════════════════════════════
// Inline Club/Bar Booking Form (ported from book.html)
// Prefix: ib_  /  DOM ids: ib-*
// Uses the existing module-level `db` client. No draft support.

