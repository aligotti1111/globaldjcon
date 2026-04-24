// MOBILE FLOW: renderMobileCard, mob status updates, quote modal
// Extracted from booking-requests.html

const MOB_EVENT_LABELS = {weddings:'Wedding',birthday:'Birthday Party',corporate:'Corporate Event',anniversary:'Anniversary',graduation:'Graduation',sweet16:'Sweet 16 / Quinceañera',mitzvah:'Bar/Bat Mitzvah',reunion:'Reunion',holiday:'Holiday Party',school:'School Event',community:'Community Event',other:'Other'};

function renderMobileCard(b, isIncoming, orderNum) {
  const isQuote = b.is_quote;
  const statusClass = 'status-' + (b.status || 'pending');
  const cardClass = 'request-card ' + (b.status || 'pending');
  const statusLabel = isQuote && b.status === 'pending' ? 'Quote Requested' : b.status || 'pending';
  const orderBadge = orderNum ? `<span style="font-family:'Space Mono',monospace;font-size:.48rem;background:rgba(255,179,71,.15);color:var(--amber);border:1px solid rgba(255,179,71,.3);border-radius:3px;padding:1px 5px;margin-right:.4rem;">#${orderNum}</span>` : '';
  const eventLabel = MOB_EVENT_LABELS[b.event_type] || b.event_type || '—';

  // Duration calculation
  let durationLabel = '';
  if (b.start_time && b.end_time) {
    const [sh,sm] = b.start_time.split(':').map(Number);
    let [eh,em] = b.end_time.split(':').map(Number);
    let mins = (eh*60+em)-(sh*60+sm);
    if (mins<=0) mins+=1440;
    const hrs = Math.floor(mins/60);
    const rem = mins%60;
    durationLabel = hrs > 0 ? `${hrs} hr${hrs>1?'s':''}${rem>0?' '+rem+'m':''}` : `${rem}m`;

    // For weddings with cocktail hour, append + X hr(s) cocktail
    if (b.event_type === 'weddings' && b.cocktail_needed && b.cocktail_start_time) {
      const [ch,cm] = b.cocktail_start_time.split(':').map(Number);
      let cockMins = (sh*60+sm)-(ch*60+cm);
      if (cockMins<=0) cockMins+=1440;
      const cHrs = Math.floor(cockMins/60);
      const cRem = cockMins%60;
      const cockLabel = cHrs > 0 ? `${cHrs} hr${cHrs>1?'s':''}${cRem>0?' '+cRem+'m':''}` : `${cRem}m`;
      durationLabel += ` + ${cockLabel} cocktail`;
    }
  }

  // Cocktail pill
  const cocktailPill = b.cocktail_needed ? `
    <div style="width:1px;height:28px;background:rgba(0,245,196,.3);flex-shrink:0;"></div>
    <div style="display:inline-flex;align-items:center;gap:5px;font-size:.65rem;padding:3px 9px;border-radius:20px;background:rgba(0,245,196,.1);color:var(--neon);border:1px solid rgba(0,245,196,.25);white-space:nowrap;">
      🍸 Cocktail ${b.cocktail_start_time ? formatTime(b.cocktail_start_time) : 'TBD'}${b.cocktail_same_room ? ' · Same room' : ' · Separate room'}
    </div>` : '';

  // Unified package + price block — everything in one frame, price on top
  const unifiedPkgPriceBlock = (() => {
    const hasPrice = !!b.quoted_rate;
    const hasPkg = !!b.package_title;
    if (!hasPrice && !hasPkg && !isQuote) return '';

    const isApproved = b.status === 'approved';
    const hasCounter = !!b.counter_rate && !isApproved;
    const borderColor = hasPrice ? (isApproved ? 'var(--neon)' : 'var(--amber)') : 'var(--border)';
    // When a counter exists, the big price = counter (amber), label = NEW OFFER
    const labelColor = hasCounter ? 'var(--amber)' : (hasPrice ? (isApproved ? 'var(--neon)' : 'var(--amber)') : 'var(--muted)');
    const labelText = hasCounter ? 'New Offer' : (hasPrice ? (isApproved ? 'Agreed Price' : isQuote ? 'Quoted Price' : 'Package Price') : '');
    const bigPriceVal = hasCounter ? b.counter_rate : b.quoted_rate;
    const bigPriceColor = hasCounter ? 'var(--amber)' : 'var(--white)';

    // Price section — price on left, duration on right (centered block)
    const priceSection = hasPrice ? `
      <div style="padding:1rem;display:flex;justify-content:center;align-items:flex-start;gap:2rem;flex-wrap:wrap;">
        <div style="text-align:center;">
          <div style="font-family:'Space Mono',monospace;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:${labelColor};margin-bottom:.35rem;">${labelText}</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:2.6rem;letter-spacing:.05em;color:${bigPriceColor};line-height:1;">$${Number(bigPriceVal).toLocaleString()}</div>
          ${hasCounter ? `<div style="margin-top:.45rem;font-family:'Space Mono',monospace;font-size:.55rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);">Initial Offer: <span style="color:var(--white);">$${Number(b.quoted_rate).toLocaleString()}</span></div>` : ''}
          ${!hasCounter && b.deposit_amount ? `<div style="font-size:.72rem;color:var(--muted);margin-top:.35rem;">Deposit (${b.deposit_pct}%): $${Number(b.deposit_amount).toLocaleString()}</div>` : ''}
        </div>
        ${durationLabel ? `
        <div style="text-align:center;">
          <div style="font-family:'Space Mono',monospace;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.35rem;">Duration</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:2.6rem;letter-spacing:.05em;color:var(--neon);line-height:1;">${durationLabel}</div>
        </div>` : ''}
      </div>` : (isQuote ? `
      <div style="padding:.85rem 1rem;text-align:center;font-family:'Space Mono',monospace;font-size:.65rem;color:var(--amber);">Awaiting price from DJ</div>` : '');

    // Package section — parse the edited/removed split structure so it renders cleanly in the card
    let pkgActiveHtml = '';
    let pkgRemovedItems = [];
    let pkgEdited = false;
    if (b.package_details) {
      let pd = String(b.package_details);
      if (pd.includes('<!--GDJ_EDITED-->')) { pkgEdited = true; pd = pd.replace('<!--GDJ_EDITED-->', ''); }
      const idx = pd.indexOf('<!--GDJ_REMOVED-->');
      if (idx === -1) {
        pkgActiveHtml = pd;
      } else {
        pkgActiveHtml = pd.slice(0, idx);
        const remHtml = pd.slice(idx + '<!--GDJ_REMOVED-->'.length);
        const tmp = document.createElement('div');
        tmp.innerHTML = remHtml;
        pkgRemovedItems = Array.from(tmp.querySelectorAll('li')).map(li => li.textContent.trim()).filter(Boolean);
      }
    }
    const editedTag = pkgEdited ? `<div style="text-align:right;margin-top:.35rem;font-family:'Space Mono',monospace;font-size:.55rem;letter-spacing:.08em;text-transform:uppercase;color:var(--amber);">Edited</div>` : '';
    const removedBox = pkgRemovedItems.length ? `
      <div style="border-top:1px solid var(--amber);background:rgba(255,179,71,.06);">
        <div style="padding:.35rem .9rem;font-family:'Space Mono',monospace;font-size:.55rem;letter-spacing:.1em;text-transform:uppercase;color:var(--amber);">Removed</div>
        <div style="padding:0 .9rem .55rem 1.85rem;font-size:.78rem;color:var(--amber);line-height:1.6;">
          <ul style="margin:0;padding-left:1rem;">${pkgRemovedItems.map(i => `<li>${i.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</li>`).join('')}</ul>
        </div>
      </div>` : '';

    const pkgSection = hasPkg ? `
      <div id="pkg-block-${b.id}">
        <div style="padding:.75rem .9rem;background:rgba(255,255,255,.03);font-family:'Bebas Neue',sans-serif;font-size:1.5rem;letter-spacing:.04em;color:var(--white);line-height:1;">${b.package_title}</div>
        <div id="pkg-details-${b.id}" style="padding:.6rem .9rem .6rem 1.85rem;font-size:.8rem;color:var(--white);line-height:1.6;border-top:1px solid var(--border);display:${(pkgActiveHtml || pkgEdited) ? '' : 'none'};">${pkgActiveHtml}${editedTag}</div>
        ${removedBox}
      </div>` : '';

    // Cocktail footer
    const cocktailFooter = b.cocktail_needed ? `
      <div style="font-size:.72rem;padding:.45rem .9rem;border-top:1px solid var(--border);color:${b.cocktail_included ? 'var(--neon)' : b.cocktail_price ? 'var(--muted)' : 'var(--amber)'};background:rgba(0,0,0,.15);">
        ${b.cocktail_included ? 'Cocktail hour included in package' : b.cocktail_price ? `Cocktail add-on: $${Number(b.cocktail_price).toLocaleString()}` : 'Cocktail hour pricing TBD'}
      </div>` : '';

    return `<div style="border-radius:8px;overflow:hidden;margin-bottom:.75rem;">
      ${pkgSection}
      ${cocktailFooter}
      ${priceSection ? `<div style="border-top:1px solid var(--border);">${priceSection}</div>` : ''}
    </div>`;
  })();

  // Legacy variables kept as empty strings so existing template references don't break
  const priceBlock = '';
  const pkgBlock = '';

  const targetId = isIncoming ? b.requester_id : b.dj_id;
  const targetName = isIncoming ? (b.requester_name||'this user') : (b.dj_name||'this DJ');
  const isBlocked = blockedUsers.includes(targetId);

  const incomingActions = isIncoming && b.status === 'pending' ? `
    <button class="btn btn-primary btn-sm" onclick="mobUpdateStatus('${b.id}','approved')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ${isQuote ? 'Send Quote' : 'Approve'}
    </button>
    <button class="btn btn-danger btn-sm" onclick="mobUpdateStatus('${b.id}','denied')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Deny
    </button>
    ${isQuote ? `<button class="btn btn-amber btn-sm" onclick="openMobQuoteModal('${b.id}','${b.package_title||''}',${b.deposit_pct||0})">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg> Send Price
    </button>` : `<button class="btn btn-amber btn-sm" onclick="openCounter('${b.id}','USD','in',${b.counter_rate||'null'},null,${b.quoted_rate||'null'})">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg> Counter
    </button>`}` : '';

  const outgoingActions = !isIncoming && (b.status === 'pending' || b.status === 'counter') ? `
    <button class="btn btn-danger btn-sm" onclick="cancelOffer('${b.id}')">Cancel</button>
    ${b.status === 'counter' ? `
      <button class="btn btn-primary btn-sm" onclick="requesterUpdateStatus('${b.id}','approved')">Accept</button>
      <button class="btn btn-danger btn-sm" onclick="requesterUpdateStatus('${b.id}','denied')">Decline</button>` : ''}
  ` : '';

  const quoteOutgoingActions = !isIncoming && isQuote && b.quoted_rate && b.status === 'pending' ? `
    <button class="btn btn-primary btn-sm" onclick="requesterUpdateStatus('${b.id}','approved')">Accept Quote</button>
    <button class="btn btn-danger btn-sm" onclick="requesterUpdateStatus('${b.id}','denied')">Decline Quote</button>
  ` : '';

  const distId = `dist-${b.id}`;
  const cleanAddress = b.venue_address ? b.venue_address.replace(/,\s*[^,]+ County/i,'') : '';

  // Status accent (replaces heavy left border — now a subtle top strip)
  const statusAccent = {
    pending: 'var(--amber)',
    approved: 'var(--success)',
    denied: 'var(--error)',
    counter: 'var(--neon)',
    cancelled: 'var(--muted)'
  }[b.status || 'pending'] || 'var(--amber)';

  const html = `<div class="${cardClass}" id="card-${b.id}" style="padding:0;overflow:hidden;border-radius:12px;border-left:1px solid var(--border);position:relative;">

    <!-- Status accent strip (top) -->
    <div style="height:3px;background:${statusAccent};"></div>

    <!-- Status badge: top-right corner only -->
    <div style="position:absolute;top:14px;right:14px;z-index:5;">
      <span class="${statusClass} status-badge">${statusLabel}</span>
    </div>

    <!-- SECTION 1: Header — fully stacked, left-aligned -->
    <div style="padding:1rem 1.1rem .9rem;">
      ${orderBadge ? `<div style="margin-bottom:.5rem;">${orderBadge}</div>` : ''}
      <div>
        <div style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.25rem;">Event</div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:1.75rem;letter-spacing:.04em;color:var(--white);line-height:1;">${eventLabel}</div>
      </div>
    </div>

    <!-- SECTION: Date & Time -->
    <div style="padding:.9rem 1.1rem .25rem;">
      <div style="position:relative;border:1px solid var(--white);border-radius:8px;padding:1.35rem .9rem .9rem;margin-bottom:1rem;"><div style="position:absolute;top:-.6rem;left:50%;transform:translateX(-50%);background:var(--neon);color:var(--black);padding:.2rem .75rem;border-radius:4px;white-space:nowrap;font-family:'Space Mono',monospace;font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Date & Time</div>
      <div style="margin-bottom:1rem;">
        <div style="font-size:.95rem;color:var(--muted);display:flex;align-items:center;gap:.4rem;margin-bottom:.8rem;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span style="color:var(--white);">${b.event_date ? new Date(b.event_date + 'T12:00:00').toLocaleDateString('en-US', {weekday:'long',month:'long',day:'numeric',year:'numeric'}) : '—'}</span>
        </div>
        ${b.cocktail_needed && b.event_type === 'weddings' ? `
        <div style="margin-bottom:.7rem;">
          <div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.2rem;">Cocktail Hour</div>
          <div style="font-size:.85rem;color:var(--neon);">${b.cocktail_start_time ? formatTime(b.cocktail_start_time) : 'TBD'}${b.cocktail_same_room ? ' · Same room' : ' · Separate room'}</div>
        </div>` : ''}
        <div style="margin-bottom:.7rem;">
          <div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.2rem;">${b.event_type === 'weddings' ? 'Reception Start' : 'Event Start'}</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:1.4rem;color:var(--neon);letter-spacing:.03em;line-height:1;">${b.start_time ? formatTime(b.start_time) : '—'}</div>
        </div>
        <div style="margin-bottom:.7rem;">
          <div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.2rem;">${b.event_type === 'weddings' ? 'Reception End' : 'Event End'}</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:1.4rem;color:var(--neon);letter-spacing:.03em;line-height:1;">${b.end_time ? formatTime(b.end_time) : '—'}</div>
        </div>
        ${durationLabel ? `
        <div>
          <div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.2rem;">Duration</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:1.4rem;color:var(--neon);letter-spacing:.03em;line-height:1;">${durationLabel}</div>
        </div>` : ''}
        ${b.cocktail_needed && b.event_type !== 'weddings' ? `
        <div style="margin-top:.7rem;">
          <div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.2rem;">Cocktail Hour</div>
          <div style="font-size:.85rem;color:var(--neon);">${b.cocktail_start_time ? formatTime(b.cocktail_start_time) : 'TBD'}${b.cocktail_same_room ? ' · Same room' : ' · Separate room'}</div>
        </div>` : ''}
      </div>
    </div></div>

    <!-- SECTION: Event Info -->
    <div style="padding:.9rem 1.1rem .25rem;">
      <div style="position:relative;border:1px solid var(--white);border-radius:8px;padding:1.35rem .9rem .9rem;margin-bottom:1rem;"><div style="position:absolute;top:-.6rem;left:50%;transform:translateX(-50%);background:var(--neon);color:var(--black);padding:.2rem .75rem;border-radius:4px;white-space:nowrap;font-family:'Space Mono',monospace;font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Event Info</div>
      ${b.venue_name ? `
      <div style="margin-bottom:.85rem;">
        <div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem;">Venue</div>
        <div style="font-size:1rem;color:var(--white);font-weight:600;line-height:1.3;margin-bottom:.3rem;">${b.venue_name}</div>
        ${cleanAddress ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.venue_address)}" target="_blank" style="font-size:.82rem;color:var(--muted);text-decoration:underline;text-underline-offset:3px;line-height:1.4;display:inline-flex;align-items:center;gap:.3rem;">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${cleanAddress}
        </a>
        <div id="${distId}" style="font-size:.75rem;color:var(--muted);margin-top:.35rem;"></div>` : ''}
      </div>` : ''}

      ${b.room_details && b.room_details !== 'None' ? `
      <div style="margin-bottom:.85rem;">
        <div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem;">Room</div>
        <div style="font-size:.88rem;color:var(--white);">${b.room_details}</div>
      </div>` : ''}

      ${b.guest_count ? `
      <div style="margin-bottom:.85rem;">
        <div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem;">Guests</div>
        <div style="font-size:1rem;color:var(--white);font-weight:600;">${b.guest_count}</div>
      </div>` : ''}
    </div></div>

    <!-- SECTION: Contact Info -->
    <div style="padding:.9rem 1.1rem .25rem;">
      <div style="position:relative;border:1px solid var(--white);border-radius:8px;padding:1.35rem .9rem .9rem;margin-bottom:1rem;"><div style="position:absolute;top:-.6rem;left:50%;transform:translateX(-50%);background:var(--neon);color:var(--black);padding:.2rem .75rem;border-radius:4px;white-space:nowrap;font-family:'Space Mono',monospace;font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Contact Info</div>
      <div style="margin-bottom:.85rem;">
        <div style="font-size:.82rem;color:var(--muted);">
          ${isIncoming ? 'Host Name' : 'To'}: <span style="color:var(--white);font-weight:500;">${isIncoming ? (b.requester_name||'Unknown') : (b.dj_name||'DJ')}</span>
        </div>
        ${b.phone ? `<div style="font-size:.82rem;color:var(--muted);margin-top:.3rem;">
          Phone: <a href="tel:${b.phone}" style="color:var(--white);font-weight:500;text-decoration:none;">${b.phone}</a>
        </div>` : ''}
      </div>
      <button class="btn btn-outline btn-sm" onclick="openMsg('${b.id}','${targetId}')" style="font-size:.6rem;padding:.4rem .75rem;border-color:var(--neon);color:var(--neon);">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Message ${isIncoming ? (b.requester_name || 'Booker') : (b.dj_name || 'DJ')}
      </button>
    </div></div>

    ${b.notes ? `
    <!-- SECTION: Message -->
    <div style="padding:.9rem 1.1rem .25rem;">
      <div style="position:relative;border:1px solid var(--white);border-radius:8px;padding:1.35rem .9rem .9rem;margin-bottom:1rem;"><div style="position:absolute;top:-.6rem;left:50%;transform:translateX(-50%);background:var(--neon);color:var(--black);padding:.2rem .75rem;border-radius:4px;white-space:nowrap;font-family:'Space Mono',monospace;font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Message From Booker</div>
      <div style="background:rgba(255,255,255,.02);border-left:2px solid var(--neon);padding:.7rem .9rem;border-radius:0 6px 6px 0;">
        <div style="font-size:.85rem;color:var(--white);line-height:1.55;font-style:italic;">"${b.notes}"</div>
      </div>
    </div></div>` : ''}

    ${unifiedPkgPriceBlock ? `
    <!-- SECTION: Package & Price -->
    <div style="padding:.9rem 1.1rem .25rem;">
      <div style="position:relative;border:1px solid var(--white);border-radius:8px;padding:1.35rem .9rem .9rem;margin-bottom:1rem;"><div style="position:absolute;top:-.6rem;left:50%;transform:translateX(-50%);background:var(--neon);color:var(--black);padding:.2rem .75rem;border-radius:4px;white-space:nowrap;font-family:'Space Mono',monospace;font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Package & Price</div>
      ${unifiedPkgPriceBlock}
    </div></div>` : ''}

    <!-- SECTION: Actions — Approve/Deny/Counter/Message on left, Requested date + Block button on right -->
    <div style="margin-top:.75rem;padding:.85rem 1.1rem;background:rgba(0,0,0,.25);border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;flex-wrap:wrap;">
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
        ${incomingActions}
        ${outgoingActions}
        ${quoteOutgoingActions}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.4rem;">
        <div style="font-family:'Space Mono',monospace;font-size:.52rem;color:var(--muted);letter-spacing:.06em;">Requested ${new Date(b.created_at).toLocaleDateString()}</div>
        ${isBlocked
          ? `<button class="btn btn-sm" style="font-size:.5rem;padding:.2rem .5rem;background:transparent;border:1px solid var(--muted);color:var(--muted);" onclick="unblockUserInline('${targetId}')">Unblock</button>`
          : `<button class="btn btn-sm" style="font-size:.5rem;padding:.2rem .5rem;background:var(--error);border-color:var(--error);color:var(--white);" onclick="blockUser('${targetId}','${targetName}')">Block</button>`}
      </div>
    </div>

  </div>`;

  // Trigger async tasks after render
  setTimeout(() => {
    // Distance calculation
    if (b.venue_address && djZip) {
      fetchVenueDistance(djZip + ', United States', b.venue_address, distId);
    }
    // Package details lookup — only needed for legacy rows where details weren't saved on the row
    if (b.package_title && !b.package_details) {
      loadMobPkgDetails(b);
    }
  }, 50);

  return html;
}

async function loadMobPkgDetails(b) {
  try {
    const djId = b.dj_id || currentUser.id;
    const { data: djRow } = await db.from('users').select('booking_settings').eq('id', djId).single();
    const bs = djRow?.booking_settings ? (typeof djRow.booking_settings === 'string' ? JSON.parse(djRow.booking_settings) : djRow.booking_settings) : {};
    const catMap = { weddings:'wedding', mitzvah:'mitzvah', bar_mitzvah:'mitzvah' };
    const cat = catMap[b.event_type] || 'general';
    // Try matched category first, fall back to general
    const catPkgs = (bs.mob_packages || {})[cat] || [];
    const genPkgs = (bs.mob_packages || {})['general'] || [];
    const findPkg = (pkgs) => pkgs.find(p => p.title?.trim() && p.title.trim() === b.package_title?.trim());
    const pkg = findPkg(catPkgs) || findPkg(genPkgs) || catPkgs[0] || genPkgs[0];
    if (!pkg) return;
    // Details may be on the category-specific pkg or the general one
    const genPkg = findPkg(genPkgs) || genPkgs[catPkgs.indexOf(pkg)];
    const details = pkg.details || genPkg?.details || '';
    const detailsEl = document.getElementById(`pkg-details-${b.id}`);
    if (!detailsEl || !details) return;
    detailsEl.innerHTML = details;
    detailsEl.style.display = '';
  } catch(e) { /* non-fatal */ }
}

// Mobile booking status update
async function mobUpdateStatus(bookingId, status) {
  const label = status === 'approved' ? 'Approve' : 'Deny';
  const style = status === 'approved' ? 'btn-primary' : 'btn-danger';
  showConfirm(status === 'approved' ? 'Approve this booking?' : 'Deny this booking?', label, style, () => _doMobUpdateStatus(bookingId, status));
}

async function _doMobUpdateStatus(bookingId, status) {
  try {
    const { error } = await db.from('bookings').update({ status, updated_at: new Date().toISOString() }).eq('id', bookingId).eq('dj_id', currentUser.id);
    if (error) throw error;
    const b = incomingBookings.find(x => x.id === bookingId);
    if (b) b.status = status;

    // If approved, decrement bookings_available on mob_booking_days
    if (status === 'approved' && b && b.event_date) {
      try {
        const { data: djRow } = await db.from('users').select('booking_settings').eq('id', currentUser.id).single();
        const bs = djRow?.booking_settings ? (typeof djRow.booking_settings === 'string' ? JSON.parse(djRow.booking_settings) : djRow.booking_settings) : {};
        const defaultPerDay = bs.mob_bookings_per_day || 1;
        if (!bs.mob_booking_days) bs.mob_booking_days = {};
        const dayData = bs.mob_booking_days[b.event_date] || {};
        const current = dayData.bookings_available != null ? dayData.bookings_available : defaultPerDay;
        const newCount = Math.max(0, current - 1);
        if (newCount <= 0) {
          bs.mob_booking_days[b.event_date] = { ...dayData, bookings_available: 0 };
        } else {
          bs.mob_booking_days[b.event_date] = { ...dayData, bookings_available: newCount };
        }
        await db.from('users').update({ booking_settings: JSON.stringify(bs) }).eq('id', currentUser.id);
      } catch(calErr) { console.error('Mobile calendar update failed:', calErr); }
    }

    // Email both parties — server resolves emails from auth.users
    if (b) {
      const { data: requester } = await db.from('users').select('name').eq('id', b.requester_id).single();
      fetch('/.netlify/functions/send-email', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          type: 'mob_booking_status',
          requesterUserId: b.requester_id,
          requesterName: requester?.name || '',
          djUserId: currentUser.id,
          djName: currentUser.name,
          status, eventDate: b.event_date, packageTitle: b.package_title,
        })
      }).catch(e => console.warn('Mobile status email failed:', e));
    }

    const activeInBtn = document.querySelector('#incoming-section .tab-btn.active');
    if (activeInBtn) { const f = activeInBtn.id.replace('in-tab-',''); renderList('in', f); updateTabCounts(); }
  } catch(e) { alert('Error: ' + e.message); }
}

// Quote response modal
let activeQuoteBookingId = null;
let activeQuoteDepositPct = 0;

async function openMobQuoteModal(bookingId, packageTitle, depositPct) {
  activeQuoteBookingId = bookingId;
  activeQuoteDepositPct = depositPct || 0;
  const existing = document.getElementById('mob-quote-modal');
  if (existing) existing.remove();

  // Get booking details
  const b = incomingBookings.find(x => x.id === bookingId);
  let eventHours = null;
  if (b && b.start_time && b.end_time) {
    const [sh,sm] = b.start_time.split(':').map(Number);
    let [eh,em] = b.end_time.split(':').map(Number);
    let mins = (eh*60+em)-(sh*60+sm);
    if (mins<=0) mins+=1440;
    eventHours = Math.ceil(mins/60);
  }
  const hoursLabel = eventHours ? `${eventHours} Hour Event Price` : 'Event Price';

  // Look up package cocktail settings from DJ's booking_settings
  let pkgCocktailIncluded = true;
  let pkgCocktailPrice = '';
  const hasCocktail = !!(b && b.cocktail_needed);
  if (hasCocktail && b) {
    try {
      const { data: djRow } = await db.from('users').select('booking_settings').eq('id', currentUser.id).single();
      const bs = djRow?.booking_settings ? (typeof djRow.booking_settings === 'string' ? JSON.parse(djRow.booking_settings) : djRow.booking_settings) : {};
      // Map event_type to package category key
      const catMap = { wedding: 'wedding', mitzvah: 'mitzvah', bar_mitzvah: 'mitzvah', bat_mitzvah: 'mitzvah' };
      const cat = catMap[b.event_type] || 'general';
      const pkgs = bs.packages?.[cat] || [];
      const matched = pkgs.find(p => p.title && packageTitle && p.title.trim() === packageTitle.trim()) || pkgs[0];
      if (matched) {
        pkgCocktailIncluded = matched.cocktailIncluded !== false;
        pkgCocktailPrice = matched.cocktailPrice || '';
      }
    } catch(e) { /* non-fatal */ }
  }

  // Build cocktail section HTML if booking includes cocktail hour
  const cocktailSection = hasCocktail ? `
    <div style="margin-bottom:1rem;padding:1rem;background:rgba(0,245,196,.04);border:1px solid rgba(0,245,196,.18);border-radius:8px;">
      <div style="font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:.08em;text-transform:uppercase;color:var(--neon);margin-bottom:.75rem;">🍸 Cocktail Hour Pricing</div>
      <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;margin-bottom:.6rem;">
        <input type="checkbox" id="mob-quote-cocktail-included" ${pkgCocktailIncluded ? 'checked' : ''} onchange="document.getElementById('mob-quote-cocktail-price-wrap').style.display=this.checked?'none':'flex'" style="accent-color:var(--neon);width:15px;height:15px;flex-shrink:0;">
        <span style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.05em;text-transform:uppercase;color:var(--white);">Included in package price</span>
      </label>
      <div id="mob-quote-cocktail-price-wrap" style="display:${pkgCocktailIncluded ? 'none' : 'flex'};align-items:center;gap:.5rem;">
        <span style="color:var(--muted);font-size:1rem;">$</span>
        <input type="number" id="mob-quote-cocktail-price" min="0" placeholder="0" value="${pkgCocktailPrice}" style="flex:1;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.6rem .85rem;color:var(--white);font-size:1rem;font-family:'DM Sans',sans-serif;outline:none;">
        <span style="font-family:'Space Mono',monospace;font-size:.58rem;color:var(--muted);white-space:nowrap;">Add-on</span>
      </div>
    </div>` : '';

  const modal = document.createElement('div');
  modal.id = 'mob-quote-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:1.5rem;';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.75rem;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:.05em;color:var(--white);">Send Price</div>
        <button type="button" onclick="document.getElementById('mob-quote-modal').remove()" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:1.2rem;">✕</button>
      </div>
      ${packageTitle ? `<div style="font-size:.82rem;color:var(--muted);margin-bottom:1rem;">Package: <strong style="color:var(--white);">${packageTitle}</strong></div>` : ''}
      <div style="margin-bottom:1rem;">
        <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.4rem;">${hoursLabel}</label>
        <div style="display:flex;align-items:center;gap:.5rem;">
          <span style="color:var(--muted);font-size:1rem;">$</span>
          <input type="number" id="mob-quote-price" min="0" placeholder="0" oninput="updateMobQuoteDeposit()" style="flex:1;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.6rem .85rem;color:var(--white);font-size:1rem;font-family:'DM Sans',sans-serif;outline:none;">
        </div>
        ${depositPct > 0 ? `<div id="mob-quote-deposit-preview" style="font-size:.75rem;color:var(--muted);margin-top:.4rem;">Deposit (${depositPct}%): —</div>` : ''}
      </div>
      ${cocktailSection}
      <div style="margin-bottom:1rem;">
        <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.4rem;">Hourly Overtime Rate</label>
        <div style="display:flex;align-items:center;gap:.5rem;">
          <span style="color:var(--muted);font-size:1rem;">$</span>
          <input type="number" id="mob-quote-overtime" min="0" placeholder="0" style="flex:1;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.6rem .85rem;color:var(--white);font-size:1rem;font-family:'DM Sans',sans-serif;outline:none;">
          <span style="font-family:'Space Mono',monospace;font-size:.6rem;color:var(--neon);white-space:nowrap;">Per Hour</span>
        </div>
      </div>
      <div style="margin-bottom:1.25rem;">
        <label style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--white);display:block;margin-bottom:.4rem;">Message <span style="color:var(--muted);font-size:.55rem;text-transform:none;">(optional)</span></label>
        <textarea id="mob-quote-msg" rows="3" placeholder="Any details about this price..." style="width:100%;background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:.6rem .85rem;color:var(--white);font-size:.88rem;font-family:'DM Sans',sans-serif;outline:none;resize:vertical;"></textarea>
      </div>
      <div id="mob-quote-alert" style="margin-bottom:.75rem;"></div>
      <div style="display:flex;gap:.75rem;">
        <button type="button" onclick="document.getElementById('mob-quote-modal').remove()" style="flex:1;padding:.75rem;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--muted);font-family:'Space Mono',monospace;font-size:.62rem;cursor:pointer;">Cancel</button>
        <button type="button" onclick="sendMobQuote(${eventHours||'null'},${hasCocktail})" style="flex:1;padding:.75rem;background:var(--neon);border:none;border-radius:6px;color:var(--black);font-family:'Space Mono',monospace;font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;">Send Price</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function updateMobQuoteDeposit() {
  const price = parseFloat(document.getElementById('mob-quote-price')?.value || 0);
  const preview = document.getElementById('mob-quote-deposit-preview');
  if (!preview || !activeQuoteDepositPct) return;
  if (price > 0) {
    const dep = (price * activeQuoteDepositPct / 100).toFixed(2);
    preview.textContent = `Deposit (${activeQuoteDepositPct}%): $${Number(dep).toLocaleString()}`;
  } else {
    preview.textContent = `Deposit (${activeQuoteDepositPct}%): —`;
  }
}

async function sendMobQuote(eventHours, hasCocktail) {
  const price = parseFloat(document.getElementById('mob-quote-price')?.value);
  const overtime = parseFloat(document.getElementById('mob-quote-overtime')?.value) || null;
  const msg = document.getElementById('mob-quote-msg')?.value.trim();
  const alertEl = document.getElementById('mob-quote-alert');
  if (!price || isNaN(price) || price <= 0) {
    alertEl.innerHTML = '<div style="color:#ff5f5f;font-size:.8rem;">Please enter a price.</div>';
    return;
  }

  // Cocktail pricing
  let cocktailIncluded = null;
  let cocktailPrice = null;
  if (hasCocktail) {
    cocktailIncluded = document.getElementById('mob-quote-cocktail-included')?.checked ?? true;
    if (!cocktailIncluded) {
      const cp = parseFloat(document.getElementById('mob-quote-cocktail-price')?.value);
      cocktailPrice = (!isNaN(cp) && cp > 0) ? cp : null;
    }
  }

  const depositAmount = activeQuoteDepositPct > 0 ? (price * activeQuoteDepositPct / 100).toFixed(2) : null;
  try {
    const { error } = await db.from('bookings').update({
      quoted_rate: price,
      deposit_amount: depositAmount || null,
      counter_message: msg || null,
      counter_rate: overtime || null,
      cocktail_price: cocktailPrice,
      cocktail_included: cocktailIncluded,
      status: 'pending',
      updated_at: new Date().toISOString()
    }).eq('id', activeQuoteBookingId).eq('dj_id', currentUser.id);
    if (error) throw error;

    const b = incomingBookings.find(x => x.id === activeQuoteBookingId);
    if (b) {
      b.quoted_rate = price;
      b.deposit_amount = depositAmount;
      b.counter_rate = overtime;
      if (hasCocktail) { b.cocktail_price = cocktailPrice; b.cocktail_included = cocktailIncluded; }
    }

    // Email booker — server resolves email from auth.users by requesterUserId
    if (b) {
      const { data: requester } = await db.from('users').select('name').eq('id', b.requester_id).single();
      fetch('/.netlify/functions/send-email', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          type: 'mob_quote_response',
          requesterUserId: b.requester_id,
          requesterName: requester?.name || '',
          djName: currentUser.name, eventDate: b.event_date,
          packageTitle: b.package_title, quotedPrice: price,
          overtimeRate: overtime, eventHours,
          depositAmount, depositPct: activeQuoteDepositPct,
          djMessage: msg,
          cocktailIncluded, cocktailPrice,
        })
      }).catch(e => console.warn('Quote response email failed:', e));
    }

    document.getElementById('mob-quote-modal').remove();
    const activeInBtn = document.querySelector('#incoming-section .tab-btn.active');
    if (activeInBtn) { const f = activeInBtn.id.replace('in-tab-',''); renderList('in', f); updateTabCounts(); }
  } catch(e) {
    alertEl.innerHTML = `<div style="color:#ff5f5f;font-size:.8rem;">Error: ${e.message}</div>`;
  }
}

