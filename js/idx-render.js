// RENDER: renderPublic, cardHTML, listRowHTML, showSignupPrompt, renderAdmin
// Extracted from index.html

async function renderPublic(reload=false){
  if(reload || !DJS.length) DJS = await loadDJs();
  let list=DJS.filter(dj=>{
    const t = activeFilters.size === 0 || activeFilters.has(dj.dj_type) || (activeFilters.size === 2);
    const q=searchTerm.toLowerCase();
    const looksLikeLocation = /\d/.test(q);
    const s=!q||looksLikeLocation||[dj.name,dj.zip].some(v=>(v||'').toLowerCase().includes(q));
    // Filter by country
    const countryMatch = !dj.country || dj.country === activeCountry;
    return t&&s&&countryMatch;
  });

  // Geocode + distance filter whenever we have a user location
  if(userLocation){
    const promises=list.map(async dj=>{
      if(!dj._coords){
        const geoTarget = dj.zip || dj.city;
        const djCC = COUNTRY_CODES[dj.country] || '';
        if (geoTarget) {
          const coords = await geocodeCity(geoTarget, djCC);
          if (coords) dj._coords = coords; // only cache on success
        }
      }
      if(dj._coords){
        dj._distance=calcDistance(userLocation.lat,userLocation.lng,dj._coords.lat,dj._coords.lng);
      } else {
        dj._distance=9999;
      }
      return dj;
    });
    await Promise.all(promises);

    // Filter out DJs who don't travel far enough to reach the user
    // Only apply when searching by zip (looksLikeLocation)
    const searchedByZip = /\d/.test(searchTerm.trim());
    if (searchedByZip) {
      list=list.filter(dj=>{
        if(!dj.travel_distance) return true; // no limit set — show them
        if(dj.travel_distance==='worldwide') return true;
        const maxMiles=parseInt(dj.travel_distance);
        if(isNaN(maxMiles)) return true;
        return (dj._distance||0) <= maxMiles + 10; // 10 mile extension
      });
    }
  }

  // Sort
  if(sortMode==='nearest'&&userLocation){
    // Distances already calculated above, just sort
    list.sort((a,b)=>(a._distance||9999)-(b._distance||9999));
  } else if(sortMode==='name'){
    list.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  } else if(sortMode==='location'){
    list.sort((a,b)=>(a.city||'zzz').localeCompare(b.city||'zzz'));
  } else if(sortMode==='rating'){
    list.sort((a,b)=>(b.rating||0)-(a.rating||0));
  } else if(sortMode==='availability'){
    const order={available:0,busy:1,offline:2};
    list.sort((a,b)=>(order[a.avail]??1)-(order[b.avail]??1));
  }

  document.getElementById('showing-count').textContent=list.length;
  const grid=document.getElementById('dj-grid');
  if(!DJS.length){ grid.innerHTML=`<div class="empty-state"><div class="empty-icon">🎧</div><div class="empty-title">No DJs Listed Yet</div><div class="empty-sub">Check back soon.</div></div>`; return; }
  if(!list.length){ grid.innerHTML=`<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">No Results</div><div class="empty-sub">Try different keywords or adjust the filters.</div></div>`; return; }

  if(viewMode === 'list') {
    grid.innerHTML = `<div class="dj-list">${list.map(dj => listRowHTML(dj)).join('')}</div>`;
    return;
  }

  // Grid view
  let html='';
  let lastCity='';
  list.forEach((dj,i)=>{
    if(sortMode==='location'){
      const cityKey=(dj.city||'No Location Set').split(',')[0].trim();
      if(cityKey!==lastCity){
        html+=`<div class="location-group-header">${dj.city||'No Location Set'}</div>`;
        lastCity=cityKey;
      }
    }
    html+=cardHTML(dj,i);
  });
  grid.innerHTML=html;
}

function cardHTML(dj,i){
  const typeClass=dj.dj_type||'mobile';
  const typeBadge=dj.dj_type?`<div class="type-badge">${dj.dj_type==='club'?'🎧 Club/Bar':'🎵 Mobile'}</div>`:'';
  const slug=djSlug(dj);
  return `
  <div class="dj-card ${typeClass}" style="animation-delay:${i*.03}s;cursor:pointer;" onclick="window.location.href=djProfileURL('${slug}')">
    <div class="card-glow"></div>
    <div class="card-top">
      <div class="avatar" style="${avatarStyle(dj.dj_type)}">${dj.avatar_url ? `<img src="${dj.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">` : initials(dj.name)}</div>
      ${typeBadge}
    </div>
    <div class="dj-name">${dj.name||'Unknown DJ'}</div>
    ${dj.city||dj.state?`<div class="dj-city">📍 ${[dj.city,dj.state].filter(Boolean).join(', ')}${dj._distance&&dj._distance<9999?` <span style="color:var(--neon);font-weight:500">(${Math.round(dj._distance)} mi away)</span>`:''}</div>`:''}
    ${dj.rating?`<div class="card-meta"><div>${starsHTML(dj.rating)}</div></div>`:''}
    <div class="card-footer">
      ${dj.rate?`<div class="rate">${dj.rate}</div>`:''}
    </div>
  </div>`;
}

function listRowHTML(dj) {
  const typeLabel = dj.dj_type === 'club' ? '🎧 Club/Bar' : dj.dj_type === 'mobile' ? '🎵 Mobile' : '—';
  const typeClass = dj.dj_type || 'none';
  const location = [dj.city, dj.state].filter(Boolean).join(', ') || '—';
  const slug = djSlug(dj);
  const currentUser = window.currentUser || null;
  const isClaimed = true; // New auth system: presence in public.users means confirmed account

  // Check if booking is enabled for this DJ (Club/Bar DJs only)
  let bookingEnabled = false;
  try {
    const isClub = dj.dj_type === 'club';
    if (isClub && dj.booking_settings) {
      const bs = typeof dj.booking_settings === 'string' ? JSON.parse(dj.booking_settings) : dj.booking_settings;
      bookingEnabled = !!(bs && bs.booking_enabled);
    }
  } catch(e) {}

  const bookBtn = bookingEnabled
    ? `<button class="dll-contact-btn" onclick="event.stopPropagation();${!currentUser ? 'showSignupPrompt()' : `window.location.href='/${slug}'`}" style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;padding:.3rem .5rem;border-radius:3px;border:none;background:var(--neon);color:var(--black);font-weight:700;cursor:pointer;white-space:nowrap;">Book</button>`
    : '';

  let contactBtn;
  if (!currentUser) {
    contactBtn = `<button class="dll-contact-btn" onclick="event.stopPropagation();showSignupPrompt()" style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;padding:.3rem .5rem;border-radius:3px;border:1px solid var(--neon);color:var(--neon);background:transparent;cursor:pointer;white-space:nowrap;">Contact</button>`;
  } else if (isClaimed) {
    contactBtn = `<button class="dll-contact-btn" onclick="event.stopPropagation();window.location.href=djProfileURL('${slug}')" style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;padding:.3rem .5rem;border-radius:3px;border:1px solid var(--neon);color:var(--neon);background:transparent;cursor:pointer;white-space:nowrap;">Contact</button>`;
  } else if (dj.email) {
    contactBtn = `<button class="dll-contact-btn" onclick="event.stopPropagation();window.open('mailto:${dj.email}','_blank')" style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;padding:.3rem .5rem;border-radius:3px;border:1px solid var(--neon);color:var(--neon);background:transparent;cursor:pointer;white-space:nowrap;">Contact</button>`;
  } else {
    contactBtn = `<button class="dll-contact-btn" onclick="event.stopPropagation();window.location.href=djProfileURL('${slug}')" style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;padding:.3rem .5rem;border-radius:3px;border:1px solid var(--neon);color:var(--neon);background:transparent;cursor:pointer;white-space:nowrap;">Contact</button>`;
  }

  return `
  <div class="dj-list-row ${dj.dj_type||''}" style="cursor:pointer;" onclick="window.location.href=djProfileURL('${slug}')">
    <div class="dll-avatar" style="${avatarStyle(dj.dj_type)}">${dj.avatar_url ? `<img src="${dj.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">` : initials(dj.name)}</div>
    <div class="dll-name-wrap">
      <div class="dll-name">${dj.name||'Unknown DJ'}</div>
      <div class="dll-location">📍 ${location}${dj._distance&&dj._distance<9999?` <span style="color:var(--neon)">(${Math.round(dj._distance)}mi)</span>`:''}</div>
    </div>
    <span class="dll-type ${typeClass}">${typeLabel}</span>
    <div style="display:flex;gap:.3rem;align-items:center;">${bookBtn}${contactBtn}</div>
  </div>`;
}

function showSignupPrompt() {
  // Show a subtle modal prompting signup
  const existing = document.getElementById('signup-prompt-modal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'signup-prompt-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:2rem;max-width:360px;width:90%;text-align:center;">
      <p style="font-family:'Bebas Neue',sans-serif;font-size:1.8rem;color:var(--white);margin-bottom:.5rem;">Want to Contact DJs?</p>
      <p style="color:var(--muted);font-size:.88rem;margin-bottom:1.5rem;line-height:1.6;">Create a free account to message DJs directly and manage your bookings.</p>
      <a href="/signup.html" style="display:block;background:var(--neon);color:var(--black);font-family:'Space Mono',monospace;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:.85rem;border-radius:6px;text-decoration:none;margin-bottom:.75rem;">Create Free Account</a>
      <a href="/login.html" style="display:block;color:var(--neon);font-family:'Space Mono',monospace;font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;opacity:.7;">Already have an account? Sign In</a>
      <button onclick="document.getElementById('signup-prompt-modal').remove()" style="margin-top:1rem;background:none;border:none;color:var(--muted);font-size:.8rem;cursor:pointer;">✕ Close</button>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

// ─── ADMIN RENDER ─────────────────────────────────────
function renderAdmin(){ updateStats(); renderAdminList(); }

function renderAdminList(){
  const list=document.getElementById('admin-list');
  if(!list) return;
  if(!DJS.length){ list.innerHTML=`<div class="empty-admin">No DJs yet — use the <strong>Add DJ Manually</strong> or <strong>Import CSV</strong> tabs to get started.</div>`; return; }
  list.innerHTML=`<div class="admin-list">${DJS.map(dj=>{
    const hasAccount = dj.email && dj.password && dj.password.length > 0;
    const accountBadge = hasAccount 
      ? `<span style="display:inline-block;padding:3px 8px;background:rgba(61,220,132,0.12);color:var(--success);border:1px solid rgba(61,220,132,0.35);border-radius:4px;font-size:10px;font-weight:700;margin-left:8px;">✓ HAS ACCOUNT</span>`
      : `<span style="display:inline-block;padding:3px 8px;background:rgba(255,95,95,0.12);color:var(--error);border:1px solid rgba(255,95,95,0.35);border-radius:4px;font-size:10px;font-weight:700;margin-left:8px;">⚠ NO ACCOUNT</span>`;
    
    return `
    <div class="admin-row">
      <span class="ar-type ${dj.dj_type||'mobile'}">${dj.dj_type==='club'?'club/bar':dj.dj_type||'—'}</span>
      <span class="ar-name">${dj.name||'<em style="color:var(--muted);font-family:DM Sans">Unnamed</em>'}${dj.real?` <span style="font-family:'DM Sans';font-size:.73rem;color:var(--muted);font-weight:400;font-style:italic">(${dj.real})</span>`:''} ${accountBadge}</span>
      <span class="ar-city">${dj.city||'—'}</span>
      <span class="ar-contact">${dj.email||dj.phone||'No contact info'}</span>
      <span class="ar-avail ${dj.avail}">${dj.avail}</span>
      <button class="edit-btn" onclick="editDJ(${dj.id})" title="Edit" style="background:var(--neon-dim);border-color:var(--neon);color:var(--neon);padding:.4rem .8rem;margin-right:.5rem;">✎</button>
      <button class="del-btn" onclick="deleteDJ(${dj.id})" title="Delete">✕</button>
    </div>`
  }).join('')}</div>`;
}

