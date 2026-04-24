// LOAD & RENDER: loadAllBookings, distance lookup, tab counts, renderList router
// Extracted from booking-requests.html

async function loadAllBookings() {
  // Fetch fresh blocked_users list and DJ zip for distance calculations
  try {
    const { data: me } = await db.from('users').select('blocked_users,zip').eq('id', currentUser.id).single();
    blockedUsers = me?.blocked_users || [];
    if (me?.zip) djZip = me.zip;
  } catch(e) {}

  // Outgoing: requests this user made (as requester)
  const { data: outData } = await db.from('bookings').select('*').eq('requester_id', currentUser.id).order('created_at', { ascending: false });
  outgoingBookings = outData || [];
  // Back-fill dj_name for older bookings that don't have it
  const missingDjNames = outgoingBookings.filter(b => !b.dj_name && b.dj_id);
  if (missingDjNames.length > 0) {
    const djIds = [...new Set(missingDjNames.map(b => b.dj_id))];
    const { data: djRows } = await db.from('users').select('id,name').in('id', djIds);
    if (djRows) {
      const djMap = Object.fromEntries(djRows.map(d => [d.id, d.name]));
      outgoingBookings = outgoingBookings.map(b => b.dj_name ? b : {...b, dj_name: djMap[b.dj_id] || 'DJ'});
    }
  }
  if (currentUser.role !== 'dj' || outgoingBookings.length > 0) {
    document.getElementById('outgoing-section').style.display = 'block';
    renderList('out', 'pending');
  }

  // Incoming: requests made to this DJ (club/bar DJs only)
  if (isClubBarDJ) {
    const { data: inData } = await db.from('bookings').select('*').eq('dj_id', currentUser.id).order('created_at', { ascending: false });
    // Filter out bookings from blocked users
    incomingBookings = (inData || []).filter(b => !blockedUsers.includes(b.requester_id));
    // Back-fill requester_name for older bookings
    const missingNames = incomingBookings.filter(b => !b.requester_name && b.requester_id);
    if (missingNames.length > 0) {
      const rIds = [...new Set(missingNames.map(b => b.requester_id))];
      const { data: rRows } = await db.from('users').select('id,name').in('id', rIds);
      if (rRows) {
        const rMap = Object.fromEntries(rRows.map(r => [r.id, r.name]));
        incomingBookings = incomingBookings.map(b => b.requester_name ? b : {...b, requester_name: rMap[b.requester_id] || 'Unknown'});
      }
    }
    renderList('in', 'pending');
  }
  updateTabCounts();
}

function timeToMins(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function bookingsOverlap(a, b) {
  if (!a.start_time || !b.start_time) return true;
  const aStart = timeToMins(a.start_time);
  const aEnd = a.end_time ? timeToMins(a.end_time) : null;
  const bStart = timeToMins(b.start_time);
  const bEnd = b.end_time ? timeToMins(b.end_time) : null;
  const aEndAdj = aEnd !== null ? (aEnd <= aStart ? aEnd + 1440 : aEnd) : aStart + 1440;
  const bEndAdj = bEnd !== null ? (bEnd <= bStart ? bEnd + 1440 : bEnd) : bStart + 1440;
  return aStart < bEndAdj && bStart < aEndAdj;
}

async function fetchVenueDistance(addr1, addr2, elementId) {
  try {
    const geo = async (addr) => {
      const r = await fetch(`/.netlify/functions/geocode?address=${encodeURIComponent(addr)}`);
      if (!r.ok) return null;
      const d = await r.json();
      return d.lat ? d : null;
    };
    const [p1, p2] = await Promise.all([geo(addr1), geo(addr2)]);
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!p1 || !p2) { el.style.display = 'none'; return; }
    const R = 3958.8;
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLon = (p2.lon - p1.lon) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(p1.lat*Math.PI/180) * Math.cos(p2.lat*Math.PI/180) * Math.sin(dLon/2)**2;
    const miles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distColor = miles < 5 ? 'var(--neon)' : miles < 15 ? 'var(--amber)' : 'var(--error)';
    el.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${distColor}" stroke-width="2" style="vertical-align:middle;margin-right:3px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg><span style="color:${distColor};">${miles.toFixed(1)} mi to venue</span>`;
  } catch(e) {
    const el = document.getElementById(elementId);
    if (el) el.style.display = 'none';
  }
}

function updateTabCounts() {
  const inCounts = { pending: 0, approved: 0, denied: 0, counter: 0, cancelled: 0 };
  incomingBookings.forEach(b => { if (inCounts[b.status] !== undefined) inCounts[b.status]++; });
  inCounts.all = inCounts.pending + inCounts.approved + inCounts.denied + inCounts.counter;
  ['pending','approved','denied','all'].forEach(f => {
    const btn = document.getElementById(`in-tab-${f}`);
    if (btn) btn.textContent = f.charAt(0).toUpperCase() + f.slice(1) + ` (${inCounts[f]})`;
  });

  const outCounts = { pending: 0, counter: 0, approved: 0, denied: 0, cancelled: 0 };
  outgoingBookings.forEach(b => { if (outCounts[b.status] !== undefined) outCounts[b.status]++; });
  // Show counter bookings under pending for the requester (awaiting their response)
  outCounts.pending += outCounts.counter;
  outCounts.counter = 0;
  outCounts.all = outCounts.pending + outCounts.approved + outCounts.denied;
  ['pending','counter','approved','denied','all'].forEach(f => {
    const btn = document.getElementById(`out-tab-${f}`);
    if (btn) btn.textContent = f.charAt(0).toUpperCase() + f.slice(1) + ` (${outCounts[f]})`;
  });
}

function renderList(group, filter) {
  const bookings = group === 'in' ? incomingBookings : outgoingBookings;
  const list = document.getElementById(`${group}-list-${filter}`);
  if (!list) return;
  const isIncoming = group === 'in';
  const items = filter === 'all' ? bookings.filter(b => b.status !== 'cancelled') :
    (!isIncoming && filter === 'pending') ? bookings.filter(b => b.status === 'pending' || b.status === 'counter') :
    bookings.filter(b => b.status === filter);

  // Same-day grouping for incoming pending only
  if (isIncoming && filter === 'pending') {
    const groups = {};
    items.forEach(b => {
      const key = b.event_date || 'no-date';
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    });
    Object.values(groups).forEach(g => g.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
    const sortedGroups = Object.values(groups).sort((a, b) => new Date(a[0].created_at) - new Date(b[0].created_at));

    list.innerHTML = sortedGroups.map(group => {
      const hasMultiple = group.length > 1;
      const hasOverlap = hasMultiple && group.some((a, i) => group.slice(i+1).some(b => bookingsOverlap(a, b)));

      // Build logistics info for multi-booking groups
      let logisticsHtml = '';
      if (hasMultiple && group.length === 2) {
        const [a, b] = group;
        // Time gap: end of first booking to start of second
        if (a.start_time && a.end_time && b.start_time) {
          const aStartMins = timeToMins(a.start_time);
          let aEndMins = timeToMins(a.end_time);
          const bStartMins = timeToMins(b.start_time);
          if (aEndMins < aStartMins) aEndMins += 1440;
          const gapMins = bStartMins - aEndMins;
          if (gapMins < 0) {
            logisticsHtml += `<span style="font-family:'Space Mono',monospace;font-size:.65rem;color:var(--error);"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:3px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>SETS OVERLAP</span>`;
          } else {
            const gapHrs = Math.floor(gapMins / 60);
            const gapRemMins = gapMins % 60;
            const gapLabel = gapHrs > 0 ? `${gapHrs}h${gapRemMins > 0 ? ' ' + gapRemMins + 'm' : ''}` : `${gapRemMins}m`;
            const gapColor = gapMins < 60 ? 'var(--amber)' : 'var(--neon)';
            logisticsHtml += `<span style="font-family:'Space Mono',monospace;font-size:.65rem;color:${gapColor};"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:3px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${gapLabel} GAP BETWEEN SETS</span>`;
          }
        }
        if (a.venue_address && b.venue_address) {
          const groupId = `logistics-${a.id}-${b.id}`;
          logisticsHtml += `<span id="${groupId}" style="font-family:'Space Mono',monospace;font-size:.65rem;color:var(--muted);"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:3px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>Calculating distance...</span>`;
          setTimeout(() => fetchVenueDistance(a.venue_address, b.venue_address, groupId), 100);
        }
      }

      const logisticsBar = logisticsHtml ? `<div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;padding:.4rem .75rem;background:rgba(255,255,255,.03);border-radius:5px;margin-bottom:.5rem;">${logisticsHtml}</div>` : '';

      const groupHeader = hasMultiple ? `
        <div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .75rem;background:${hasOverlap ? 'rgba(255,179,71,.08)' : 'rgba(0,245,196,.06)'};border:1px solid ${hasOverlap ? 'rgba(255,179,71,.25)' : 'rgba(0,245,196,.2)'};border-radius:6px;margin-bottom:.5rem;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${hasOverlap ? 'var(--amber)' : 'var(--neon)'}" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span style="font-family:'Space Mono',monospace;font-size:.56rem;color:${hasOverlap ? 'var(--amber)' : 'var(--neon)'};letter-spacing:.06em;">
            ${hasOverlap
              ? `${group.length} OVERLAPPING REQUESTS FOR ${formatDate(group[0].event_date).toUpperCase()} — ORDER RECEIVED`
              : `${group.length} REQUESTS FOR ${formatDate(group[0].event_date).toUpperCase()} — TIMES DON'T OVERLAP, CAN ACCEPT BOTH`}
          </span>
        </div>` : '';

      const cards = group.map((b, idx) => renderCard(b, true, hasMultiple ? idx + 1 : null)).join('');

      return hasMultiple
        ? `<div style="border:1px solid ${hasOverlap ? 'rgba(255,179,71,.2)' : 'rgba(0,245,196,.15)'};border-radius:8px;padding:.75rem;margin-bottom:1rem;background:${hasOverlap ? 'rgba(255,179,71,.02)' : 'rgba(0,245,196,.02)'};">${groupHeader}${logisticsBar}${cards}</div>`
        : cards;
    }).join('');
    return;
  }
  list.innerHTML = items.map(b => renderCard(b, isIncoming, null)).join('');
}

