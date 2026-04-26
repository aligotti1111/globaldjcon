// PUBLIC CALENDAR: pubCal* render and view-toggle helpers
// Extracted from dj-profile.html

// ── PUBLIC BOOKING CALENDAR ───────────────────────────────
const PUB_CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const PUB_DAY_LABELS = ['S','M','T','W','T','F','S'];
let pubCalYear, pubCalMonth, pubCalBookingDays = {}, pubCalDjSlug = '', pubCalDjName = '', pubCalWindowMonths = 12;
// Tracks the date currently selected in the inline booking form so the calendar can highlight it
let ibPubSelectedDate = null;

// Returns {year, month} of the latest month a visitor can navigate to,
// based on today + the DJ's booking window setting.
function pubCalMaxYM() {
  const t = new Date();
  const totalMonths = t.getFullYear() * 12 + t.getMonth() + (pubCalWindowMonths || 12);
  return { year: Math.floor(totalMonths / 12), month: totalMonths % 12 };
}
// Returns {year, month} of the earliest month — the current month (no past nav)
function pubCalMinYM() {
  const t = new Date();
  return { year: t.getFullYear(), month: t.getMonth() };
}
// True if (y, m) is within [min, max] inclusive
function pubCalInRange(y, m) {
  const min = pubCalMinYM(), max = pubCalMaxYM();
  const v = y * 12 + m;
  return v >= (min.year * 12 + min.month) && v <= (max.year * 12 + max.month);
}
// Brief toast message anchored above the calendar — shown when the visitor
// tries to navigate past the DJ's booking window.
function pubCalShowOutOfRangeMsg() {
  const container = document.getElementById('p-booking-calendar');
  if (!container) return;
  let msg = document.getElementById('pub-cal-range-msg');
  if (!msg) {
    msg = document.createElement('div');
    msg.id = 'pub-cal-range-msg';
    msg.style.cssText = 'margin-bottom:.75rem;padding:.6rem .85rem;background:rgba(255,179,71,.12);border:1px solid rgba(255,179,71,.4);border-radius:6px;color:#ffb347;font-family:"Space Mono",monospace;font-size:.65rem;letter-spacing:.04em;text-align:center;line-height:1.45;';
    container.insertBefore(msg, container.firstChild);
  }
  const who = pubCalDjName || pubCalDjSlug || 'This DJ';
  msg.textContent = `${who} only accepts bookings up to ${pubCalWindowLabel()} in advance.`;
  msg.style.display = 'block';
  // Auto-dismiss after 4 seconds
  clearTimeout(window._pubCalRangeMsgT);
  window._pubCalRangeMsgT = setTimeout(() => { msg.style.display = 'none'; }, 4000);
}

function renderPublicCalendar(bookingDays, djSlug, isOwner, globalAllowOffers, equipFull, equipDecks, equipNone, globalRateType, globalRateSystem, globalRateDecks, globalRateNoEquip, globalBaseRate, bookingWindowMonths, djName) {
  pubCalBookingDays = bookingDays || {};
  pubCalDjSlug = djSlug || '';
  // Optional: caller can pass DJ's display name for friendlier out-of-range message.
  // Falls back to slug if not provided.
  if (djName) pubCalDjName = djName;
  pubCalWindowMonths = bookingWindowMonths || 12;
  if (isOwner) {
    renderOwnerCalendar(bookingDays, globalAllowOffers, equipFull, equipDecks, equipNone, globalRateType, globalRateSystem, globalRateDecks, globalRateNoEquip, bookingWindowMonths || 12);
    return;
  }
  const today = new Date();
  pubCalMonth = today.getMonth();
  pubCalYear = today.getFullYear();

  const container = document.getElementById('p-booking-calendar');
  if (!container) return;

  // Build month and year dropdowns
  let monthOpts = '', yearOpts = '';
  const monthNames = PUB_CAL_MONTHS;
  monthNames.forEach((name, i) => {
    monthOpts += `<option value="${i}">${name}</option>`;
  });
  const curY = today.getFullYear();
  // Only allow years up through the booking-window cap (e.g. window=36 months
  // → can navigate up to ~3 years out; 12 months → 1 year)
  const maxYM = pubCalMaxYM();
  for (let y = curY; y <= maxYM.year; y++) {
    yearOpts += `<option value="${y}">${y}</option>`;
  }

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:1rem;flex-wrap:nowrap;">
      <button type="button" id="pub-cal-prev" onclick="pubCalNav(-1)"
        style="background:transparent;border:1px solid var(--white);color:var(--white);border-radius:5px;padding:.4rem .8rem;cursor:pointer;font-size:.9rem;transition:all .2s;"
        onmouseover="this.style.borderColor='var(--neon)';this.style.color='var(--neon)'"
        onmouseout="this.style.borderColor='var(--white)';this.style.color='var(--white)'">‹</button>
      <select id="pub-cal-month-select" onchange="pubCalJumpSplit()"
        style="flex:2;background:var(--deep);border:1px solid var(--white);border-radius:5px;padding:.4rem .75rem;color:var(--white);font-family:'Space Mono',monospace;font-size:.65rem;letter-spacing:.04em;cursor:pointer;outline:none;">
        ${monthOpts}
      </select>
      <select id="pub-cal-year-select" onchange="pubCalJumpSplit()"
        style="flex:1;background:var(--deep);border:1px solid var(--white);border-radius:5px;padding:.4rem .75rem;color:var(--white);font-family:'Space Mono',monospace;font-size:.65rem;cursor:pointer;outline:none;">
        ${yearOpts}
      </select>
      <button type="button" id="pub-cal-next" onclick="pubCalNav(1)"
        style="background:transparent;border:1px solid var(--white);color:var(--white);border-radius:5px;padding:.4rem .8rem;cursor:pointer;font-size:.9rem;transition:all .2s;"
        onmouseover="this.style.borderColor='var(--neon)';this.style.color='var(--neon)'"
        onmouseout="this.style.borderColor='var(--white)';this.style.color='var(--white)'">›</button>
      <button type="button" id="pub-cal-view-toggle" onclick="pubCalToggleView()"
        style="background:transparent;border:1px solid var(--white);color:var(--white);border-radius:5px;padding:.4rem .75rem;cursor:pointer;font-family:'Space Mono',monospace;font-size:.55rem;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;transition:all .2s;margin-left:auto;"
        onmouseover="this.style.borderColor='var(--neon)';this.style.color='var(--neon)'"
        onmouseout="if(!this.dataset.active){this.style.borderColor='var(--white)';this.style.color='var(--white)'}">${pubCalWindowLabel()}</button>
    </div>
    <div id="pub-cal-single-wrap">
      <div id="pub-cal-grid-wrap"></div>
      <div style="display:flex;gap:1rem;margin-top:.75rem;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:var(--neon);"><span style="width:10px;height:10px;border-radius:2px;background:rgba(0,245,196,.15);border:1px solid rgba(0,245,196,.3);display:inline-block;"></span>Open</div>
        <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:#ff5f5f;"><span style="width:10px;height:10px;border-radius:2px;background:rgba(255,95,95,.1);border:1px solid rgba(255,95,95,.3);display:inline-block;"></span>Booked</div>
        <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:var(--muted);"><span style="width:10px;height:10px;border-radius:2px;background:rgba(107,107,136,.1);border:1px solid rgba(107,107,136,.3);display:inline-block;"></span>Unavailable</div>
      </div>
    </div>
    <div id="pub-cal-rolling-wrap" style="display:none;"></div>`;

  drawPubCalMonth();
}

function drawPubCalMonth() {
  const wrap = document.getElementById('pub-cal-grid-wrap');
  if (!wrap) return;
  const today = new Date();
  const y = pubCalYear, m = pubCalMonth;

  const mSel = document.getElementById('pub-cal-month-select');
  const ySel = document.getElementById('pub-cal-year-select');
  if (mSel) mSel.value = m;
  if (ySel) ySel.value = y;

  // Dim/disable prev/next buttons when at the bounds of the booking window
  const prevBtn = document.getElementById('pub-cal-prev');
  const nextBtn = document.getElementById('pub-cal-next');
  if (prevBtn || nextBtn) {
    const min = pubCalMinYM(), max = pubCalMaxYM();
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

  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();

    const monthEvents = [];

  let html = `<div style="text-align:center;font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:.08em;color:var(--neon);text-shadow:0 0 18px rgba(0,245,196,.35);margin-bottom:.75rem;">${PUB_CAL_MONTHS[m]} ${y}</div>`;
  html += `<div style="display:grid;grid-template-columns:repeat(7,1fr);border-left:1px solid var(--border);border-top:1px solid var(--border);border-radius:8px 8px 0 0;overflow:hidden;width:100%;box-sizing:border-box;">`;

  // Day name headers
  dayNames.forEach((name, i) => {
    html += `<div style="
      background:rgba(255,255,255,.04);
      border-right:1px solid var(--border);
      border-bottom:1px solid var(--border);
      ${i===0?'border-radius:8px 0 0 0;':''}
      ${i===6?'border-radius:0 8px 0 0;':''}
      padding:.6rem 0;
      text-align:center;
      font-family:'Space Mono',monospace;
      font-size:.58rem;
      letter-spacing:.08em;
      text-transform:uppercase;
      color:var(--muted);">${name}</div>`;
  });

  html += `</div><div style="display:grid;grid-template-columns:repeat(7,1fr);border-left:1px solid var(--border);border-radius:0 0 8px 8px;overflow:hidden;width:100%;box-sizing:border-box;">`;

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += `<div style="border-right:1px solid rgba(255,255,255,.1);border-bottom:1px solid rgba(255,255,255,.1);min-height:90px;background:rgba(255,255,255,.01);"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayData = pubCalBookingDays[key] || {};
    const isPast = new Date(y, m, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const isBooked = dayData.booked;
    const isUnavail = dayData.unavailable;
    const isToday = y === today.getFullYear() && m === today.getMonth() && d === today.getDate();
    const isLastRow = Math.floor((firstDay + d - 1) / 7) === Math.floor((firstDay + daysInMonth - 1) / 7);
    const isLastCol = (firstDay + d - 1) % 7 === 6;

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
    const isPrivate = dayData.location === 'Private';
    if (!isPast) {
      if (isBooked) {
        const eventName = !isPrivate && dayData.eventName ? dayData.eventName : '';
        const timeStr = dayData.startTime ? formatTime12(dayData.startTime) + (dayData.endTime ? '–' + formatTime12(dayData.endTime) : '') : '';
        const ticketUrl = !isPrivate && dayData.ticketUrl ? dayData.ticketUrl : '';
        badge = `${eventName ? `<div style="font-size:clamp(.48rem,1vw,.62rem);color:var(--white);line-height:1.2;word-break:break-word;white-space:normal;max-width:100%;text-align:center;">${eventName}</div>` : ''}
          ${dayData.startTime ? `<div style="font-family:'Space Mono',monospace;font-size:clamp(.38rem,.8vw,.5rem);color:var(--muted);text-align:center;">${formatTime12(dayData.startTime)}</div>` : ''}
          ${ticketUrl ? `<a href="${ticketUrl}" target="_blank" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;color:var(--neon);flex-shrink:0;"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></a>` : ''}`;
      } else if (isUnavail) {
        badge = '';
      } else {
        const cu = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || 'null');
        const bookAction = cu
          ? `ib_openForInline('${pubCalDjSlug}','${key}')`
          : `showBookingGate()`;
        badge = `<div style="font-family:'Space Mono',monospace;font-size:.72rem;letter-spacing:.02em;padding:3px 7px;border-radius:4px;display:inline-block;white-space:nowrap;background:rgba(0,245,196,.2);color:var(--neon);border:1px solid rgba(0,245,196,.2);cursor:pointer;" class="cal-badge" onclick="${bookAction}">Book Now</div>`;
      }
    }

    // Collect public booked events for list below
    if (isBooked && dayData.eventName && dayData.location !== 'Private') {
      monthEvents.push({ key, d, dayData });
    }

    const cellClick = isBooked && !isPrivate && dayData.eventName
      ? `showBookedEventPopup(this)`
      : '';
    const dataAttrs = isBooked && !isPrivate && dayData.eventName
      ? `data-event-name="${(dayData.eventName||'').replace(/"/g,'&quot;')}" data-start="${dayData.startTime||''}" data-end="${dayData.endTime||''}" data-loc="${(dayData.location||'').replace(/"/g,'&quot;')}" data-key="${key}"`
      : '';
    const isSelected = ibPubSelectedDate === key;
    html += `<div style="
      border-right:1px solid var(--border);
      border-bottom:1px solid var(--border);
      ${isLastRow && !isLastCol ? 'border-bottom:none;' : ''}
      min-height:70px;
      padding:.35rem .15rem .25rem;
      background:${isSelected ? 'rgba(255,179,71,.2)' : bg};
      ${isSelected ? 'outline:2px solid var(--amber);outline-offset:-1px;' : isToday ? 'outline:2px solid var(--neon);outline-offset:-1px;' : ''}
      display:flex;flex-direction:column;align-items:center;
      overflow:hidden;box-sizing:border-box;${cellClick ? 'cursor:pointer;' : ''}"
      ${cellClick ? `onclick="${cellClick}"` : ''} ${dataAttrs}>
      <div style="font-size:clamp(.75rem,1.6vw,1rem);font-weight:${isToday?'700':'400'};color:${isSelected ? 'var(--amber)' : numColor};line-height:1;margin-bottom:3px;">${d}</div>
      ${badge}
    </div>`;
  }

  // Fill remaining cells in last row
  const totalCells = firstDay + daysInMonth;
  const remainder = totalCells % 7;
  if (remainder !== 0) {
    for (let i = remainder; i < 7; i++) {
      html += `<div style="border-right:1px solid var(--border);min-height:90px;background:rgba(255,255,255,.01);"></div>`;
    }
  }

  html += `</div>`;

  // Events list below calendar
  if (monthEvents.length) {
    html += `<div id="pub-cal-events-list" style="margin-top:1.25rem;border-top:1px solid var(--border);padding-top:1rem;">
      <div style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:.75rem;">Events This Month</div>
      <div style="display:flex;flex-direction:column;gap:.5rem;max-width:600px;">`;
    monthEvents.forEach(({ key, d, dayData }) => {
      const dateLabel = new Date(pubCalYear, pubCalMonth, d).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
      const timeStr = dayData.startTime ? formatTime12(dayData.startTime) : '';
      const rawLoc = dayData.location || '';
      const cleanLoc = rawLoc.replace(/,\s*[^,]+ County/i,'').replace(/,\s*(United States|USA|UK|United Kingdom|Canada|Australia|Germany|France|Spain|Italy|Netherlands|Sweden|Norway|Denmark|New Zealand|Singapore|South Africa|UAE|India|Japan|Mexico|Brazil|Switzerland|Ireland)\s*$/i,'').trim();
      html += `<div style="display:flex;align-items:center;gap:.75rem;padding:.6rem .75rem;background:rgba(255,95,95,.05);border:1px solid rgba(255,95,95,.15);border-left:3px solid rgba(255,95,95,.5);border-radius:6px;">
        <div style="font-family:'Space Mono',monospace;font-size:.58rem;color:#ff5f5f;white-space:nowrap;min-width:60px;">
          <div>${dateLabel}</div>
          ${timeStr ? `<div style="margin-top:2px;color:var(--muted);">${timeStr}</div>` : ''}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:.88rem;font-weight:600;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dayData.eventName}</div>
          ${cleanLoc ? `<div style="font-size:.75rem;color:var(--muted);margin-top:2px;">${cleanLoc}</div>` : ''}
        </div>
        ${dayData.ticketUrl ? `<a href="${dayData.ticketUrl}" target="_blank" style="flex-shrink:0;font-family:'Space Mono',monospace;font-size:.55rem;letter-spacing:.06em;text-transform:uppercase;color:var(--neon);text-decoration:none;border:1px solid rgba(0,245,196,.3);border-radius:4px;padding:4px 10px;background:rgba(0,245,196,.06);white-space:nowrap;" onmouseover="this.style.background='rgba(0,245,196,.14)'" onmouseout="this.style.background='rgba(0,245,196,.06)'">${dayData.ticketLabel || 'More Info'}</a>` : ''}
      </div>`;
    });
    html += `</div></div>`;
  }

  wrap.innerHTML = html;
}


function showBookedEventPopup(cell) {
  const ev = {
    eventName: cell.dataset.eventName,
    startTime: cell.dataset.start,
    endTime: cell.dataset.end,
    location: cell.dataset.loc,
    key: cell.dataset.key
  };
  const cleanLoc = (ev.location||'').replace(/,\s*[^,]+ County/i,'').replace(/,\s*(United States|USA|UK|United Kingdom|Canada|Australia|Germany|France|Spain|Italy|Netherlands|Sweden|Norway|Denmark|New Zealand|Singapore|South Africa|UAE|India|Japan|Mexico|Brazil|Switzerland|Ireland)\s*$/i,'').trim();
  const timeStr = ev.startTime ? formatTime12(ev.startTime) + (ev.endTime ? ' – ' + formatTime12(ev.endTime) : '') : '';
  const dateLabel = new Date(ev.key + 'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  let el = document.getElementById('booked-event-popup');
  if (!el) {
    el = document.createElement('div');
    el.id = 'booked-event-popup';
    el.style.cssText = 'display:none;position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.75);align-items:center;justify-content:center;padding:1.5rem;';
    el.innerHTML = `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.5rem;max-width:360px;width:100%;position:relative;">
      <button onclick="document.getElementById('booked-event-popup').style.display='none'" style="position:absolute;top:.75rem;right:.75rem;background:none;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer;line-height:1;">&#x2715;</button>
      <div id="bep-date" style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;color:#ff5f5f;margin-bottom:.5rem;"></div>
      <div id="bep-name" style="font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:.04em;color:var(--white);margin-bottom:.4rem;"></div>
      <div id="bep-time" style="font-family:'Space Mono',monospace;font-size:.7rem;color:var(--muted);margin-bottom:.3rem;"></div>
      <div id="bep-loc" style="font-size:.82rem;color:var(--muted);line-height:1.5;"></div>
    </div>`;
    el.addEventListener('click', e => { if (e.target === el) el.style.display = 'none'; });
    document.body.appendChild(el);
  }
  document.getElementById('bep-date').textContent = dateLabel;
  document.getElementById('bep-name').textContent = ev.eventName;
  document.getElementById('bep-time').textContent = timeStr;
  document.getElementById('bep-loc').textContent = cleanLoc;
  el.style.display = 'flex';
}

function formatTime12(t) {
  if (!t) return '';
  const [h, mi] = t.split(':').map(Number);
  const p = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return h12 + ':' + String(mi).padStart(2,'0') + ' ' + p;
}

function pubCalNav(dir) {
  let newM = pubCalMonth + dir;
  let newY = pubCalYear;
  if (newM > 11) { newM = 0; newY++; }
  if (newM < 0) { newM = 11; newY--; }
  // Don't navigate past the booking window or before the current month.
  // Only show the message when going FORWARD past the window — going past
  // "today" is silent (nothing useful to say there).
  if (!pubCalInRange(newY, newM)) {
    if (dir > 0) pubCalShowOutOfRangeMsg();
    return;
  }
  pubCalMonth = newM; pubCalYear = newY;
  drawPubCalMonth();
}

function pubCalJump(val) {
  const [y, m] = val.split('-').map(Number);
  if (!pubCalInRange(y, m)) { pubCalShowOutOfRangeMsg(); return; }
  pubCalYear = y; pubCalMonth = m;
  drawPubCalMonth();
}

function pubCalJumpSplit() {
  const m = parseInt(document.getElementById('pub-cal-month-select').value);
  const y = parseInt(document.getElementById('pub-cal-year-select').value);
  // If the user picked an out-of-range combo (e.g. window cuts off mid-year),
  // snap to the nearest in-range month and let them know why.
  let targetY = y, targetM = m;
  if (!pubCalInRange(targetY, targetM)) {
    pubCalShowOutOfRangeMsg();
    const min = pubCalMinYM(), max = pubCalMaxYM();
    const v = targetY * 12 + targetM;
    const minV = min.year * 12 + min.month;
    const maxV = max.year * 12 + max.month;
    const clamped = Math.max(minV, Math.min(maxV, v));
    targetY = Math.floor(clamped / 12); targetM = clamped % 12;
    const ms = document.getElementById('pub-cal-month-select');
    const ys = document.getElementById('pub-cal-year-select');
    if (ms) ms.value = targetM;
    if (ys) ys.value = targetY;
  }
  pubCalMonth = targetM; pubCalYear = targetY;
  drawPubCalMonth();
}

let pubCalRollingActive = false;

function pubCalToggleView() {
  pubCalRollingActive = !pubCalRollingActive;
  const toggle = document.getElementById('pub-cal-view-toggle');
  const single = document.getElementById('pub-cal-single-wrap');
  const rolling = document.getElementById('pub-cal-rolling-wrap');
  const prev = document.getElementById('pub-cal-prev');
  const next = document.getElementById('pub-cal-next');
  const mSel = document.getElementById('pub-cal-month-select');
  const ySel = document.getElementById('pub-cal-year-select');
  if (pubCalRollingActive) {
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
    drawRolling12Months();
  } else {
    single.style.display = 'block';
    rolling.style.display = 'none';
    if (prev) prev.style.display = '';
    if (next) next.style.display = '';
    if (mSel) mSel.style.display = '';
    if (ySel) ySel.style.display = '';
    toggle.textContent = pubCalWindowLabel();
    toggle.style.borderColor = 'var(--white)';
    toggle.style.color = 'var(--white)';
    delete toggle.dataset.active;
  }
}

function pubCalWindowLabel() {
  const m = pubCalWindowMonths || 12;
  if (m < 12) return m + ' Month' + (m > 1 ? 's' : '');
  const y = m / 12; return y + ' Year' + (y > 1 ? 's' : '');
}

function pubCalShowRolling() {
  if (!pubCalRollingActive) pubCalToggleView();
}

function drawRolling12Months() {
  const rolling = document.getElementById('pub-cal-rolling-wrap');
  if (!rolling) return;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const monthNames = PUB_CAL_MONTHS;
  const dayLabels = ['S','M','T','W','T','F','S'];

  let html = `<div class="cal-months-grid">`;

  // The 12-month view is exactly that — 12 months. The DJ's booking window
  // (which can be up to several years) governs nav range, not how many
  // months we render in this view.
  const monthsToRender = Math.min(pubCalWindowMonths || 12, 12);
  for (let i = 0; i < monthsToRender; i++) {
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
      const dayData = pubCalBookingDays[key] || {};
      const isPast = key < todayKey;
      const isBooked = dayData.booked;
      const isUnavail = dayData.unavailable;
      const isToday = key === todayKey;

      let bg = isPast ? 'transparent' : 'rgba(0,245,196,.1)';
      let color = isPast ? 'var(--muted)' : 'var(--white)';
      let border = isToday ? '1px solid var(--neon)' : '1px solid transparent';
      let cursor = 'default';
      let click = '';

      if (isBooked) { bg = 'rgba(255,60,60,.28)'; color = '#ff5f5f'; border = '1px solid rgba(255,95,95,.2)'; }
      else if (isUnavail) { bg = 'rgba(90,90,120,.22)'; color = 'var(--muted)'; border = '1px solid rgba(107,107,136,.2)'; }
      else if (isToday) { bg = 'rgba(0,245,196,.18)'; color = 'var(--neon)'; }
      else if (!isPast) { cursor = 'pointer'; click = `onclick="ib_openForInline('${pubCalDjSlug}','${key}')"` }

      // Selected-date highlight (amber) — overrides other styling
      if (ibPubSelectedDate === key) {
        bg = 'rgba(255,179,71,.25)';
        color = 'var(--amber)';
        border = '2px solid var(--amber)';
      }

      html += `<div style="background:${bg};border:${border};border-radius:3px;padding:.25rem .1rem;text-align:center;cursor:${cursor};aspect-ratio:1;" ${click}>
        <div style="font-family:'Space Mono',monospace;font-size:.6rem;color:${color};">${d}</div>
      </div>`;
    }

    html += `</div></div>`;
  }

  html += `</div>
  ${(()=>{ const m=pubCalWindowMonths||12; const label=m<12?m+' month'+(m>1?'s':''):(m/12)+' year'+(m/12>1?'s':''); return `<div style="text-align:center;font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.04em;color:#ffb347;margin-bottom:.65rem;">📅 This DJ is accepting bookings up to <strong>${label}</strong> in advance. Message them for dates beyond this.</div>`; })()}
  <div style="display:flex;gap:1rem;flex-wrap:wrap;justify-content:center;">
    <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:var(--neon);"><span style="width:10px;height:10px;border-radius:2px;background:rgba(0,245,196,.15);border:1px solid rgba(0,245,196,.3);display:inline-block;"></span>Open</div>
    <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:#ff5f5f;"><span style="width:10px;height:10px;border-radius:2px;background:rgba(255,95,95,.1);border:1px solid rgba(255,95,95,.3);display:inline-block;"></span>Booked</div>
    <div style="display:flex;align-items:center;gap:.4rem;font-family:'Space Mono',monospace;font-size:.58rem;color:var(--muted);"><span style="width:10px;height:10px;border-radius:2px;background:rgba(107,107,136,.1);border:1px solid rgba(107,107,136,.3);display:inline-block;"></span>Unavailable</div>
  </div>`;

  rolling.innerHTML = html;
}

