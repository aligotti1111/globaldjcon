// CLUB FLOW: renderCard, confirm modal, updateStatus, package edit, counter modal
// Extracted from booking-requests.html

function renderCard(b, isIncoming, orderNum) {
  // Mobile bookings get their own card
  if (b.booking_type === 'mobile') return renderMobileCard(b, isIncoming, orderNum);

    const sym = currencySymbols[b.currency || 'USD'] || '$';
    const isCounterOutgoing = !isIncoming && b.status === 'counter';
    const statusClass = isCounterOutgoing ? 'status-pending' : 'status-' + (b.status || 'pending');
    const cardClass = 'request-card ' + (isCounterOutgoing ? 'pending' : (b.status || 'pending'));
    const statusLabel = isCounterOutgoing ? 'Awaiting Response' : (b.status || 'pending');
    const agreedRate = b.counter_rate || b.quoted_rate || b.offer_amount;
    const isApproved = b.status === 'approved';
    const orderBadge = orderNum ? `<span style="font-family:'Space Mono',monospace;font-size:.48rem;background:rgba(255,179,71,.15);color:var(--amber);border:1px solid rgba(255,179,71,.3);border-radius:3px;padding:1px 5px;margin-right:.4rem;">#${orderNum}</span>` : '';

    // Status accent strip color (matches mobile card)
    const statusAccent = {
      pending: 'var(--amber)',
      approved: 'var(--success)',
      denied: 'var(--error)',
      counter: 'var(--neon)',
      cancelled: 'var(--muted)'
    }[b.status || 'pending'] || 'var(--amber)';

    const targetId = isIncoming ? b.requester_id : b.dj_id;
    const targetName = isIncoming ? (b.requester_name||'this user') : (b.dj_name||'this DJ');
    const isBlocked = blockedUsers.includes(targetId);

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
    }

    const cleanAddress = b.venue_address ? b.venue_address.replace(/,\s*[^,]+ County/i,'') : '';

    // Negotiation log entries — use negotiation_log array if available, fall back to legacy fields
    const logEntries = [];
    if (b.negotiation_log && b.negotiation_log.length > 0) {
      // Always show the initial offer/quoted rate first
      if (b.offer_amount) logEntries.push(`<div style="display:flex;justify-content:space-between;align-items:center;padding:.35rem 0;border-bottom:1px solid var(--border);font-size:.75rem;"><span style="color:var(--muted);font-family:'Space Mono',monospace;font-size:.55rem;text-transform:uppercase;letter-spacing:.06em;">Initial Offer <span style="color:var(--white);">(${isIncoming ? 'Booker' : 'You'})</span></span><span style="color:var(--white);font-weight:600;">${sym}${Number(b.offer_amount).toLocaleString()} ${b.currency||'USD'}</span></div>`);
      else if (b.quoted_rate) logEntries.push(`<div style="display:flex;justify-content:space-between;align-items:center;padding:.35rem 0;border-bottom:1px solid var(--border);font-size:.75rem;"><span style="color:var(--muted);font-family:'Space Mono',monospace;font-size:.55rem;text-transform:uppercase;letter-spacing:.06em;">Quoted Rate <span style="color:var(--white);">(${isIncoming ? 'Booker' : 'You'})</span></span><span style="color:var(--white);font-weight:600;">${sym}${Number(b.quoted_rate).toLocaleString()} ${b.currency||'USD'}</span></div>`);
      b.negotiation_log.forEach((entry, i) => {
        const isLast = i === b.negotiation_log.length - 1;
        const fromLabel = entry.from === 'dj' ? 'DJ' : 'Booker';
        const color = entry.from === 'dj' ? 'var(--neon)' : 'var(--amber)';
        logEntries.push(`<div style="display:flex;justify-content:space-between;align-items:center;padding:.35rem 0;${isLast && isApproved ? '' : 'border-bottom:1px solid var(--border);'}font-size:.75rem;">
          <span style="color:${color};font-family:'Space Mono',monospace;font-size:.55rem;text-transform:uppercase;letter-spacing:.06em;">Counter Offer <span style="color:var(--white);">(${fromLabel})</span></span>
          <span style="color:${color};font-weight:600;">${sym}${Number(entry.amount).toLocaleString()} ${b.currency||'USD'}${entry.message ? ' <span style="color:var(--muted);font-size:.7rem;font-style:italic;">"'+entry.message+'"</span>' : ''}</span>
        </div>`);
      });
    } else {
      // Legacy: single counter_rate field
      if (b.offer_amount) logEntries.push(`<div style="display:flex;justify-content:space-between;align-items:center;padding:.35rem 0;border-bottom:1px solid var(--border);font-size:.75rem;"><span style="color:var(--muted);font-family:'Space Mono',monospace;font-size:.55rem;text-transform:uppercase;letter-spacing:.06em;">Initial Offer <span style="color:var(--white);">(${isIncoming ? 'Booker' : 'You'})</span></span><span style="color:var(--white);font-weight:600;">${sym}${Number(b.offer_amount).toLocaleString()} ${b.currency||'USD'}</span></div>`);
      if (b.quoted_rate && !b.offer_amount) logEntries.push(`<div style="display:flex;justify-content:space-between;align-items:center;padding:.35rem 0;border-bottom:1px solid var(--border);font-size:.75rem;"><span style="color:var(--muted);font-family:'Space Mono',monospace;font-size:.55rem;text-transform:uppercase;letter-spacing:.06em;">Quoted Rate <span style="color:var(--white);">(${isIncoming ? 'Booker' : 'You'})</span></span><span style="color:var(--white);font-weight:600;">${sym}${Number(b.quoted_rate).toLocaleString()} ${b.currency||'USD'}</span></div>`);
      if (b.counter_rate) logEntries.push(`<div style="display:flex;justify-content:space-between;align-items:center;padding:.35rem 0;${isApproved ? '' : 'border-bottom:1px solid var(--border);'}font-size:.75rem;"><span style="color:var(--neon);font-family:'Space Mono',monospace;font-size:.55rem;text-transform:uppercase;letter-spacing:.06em;">Counter Offer <span style="color:var(--white);">(DJ)</span></span><span style="color:var(--neon);font-weight:600;">${sym}${Number(b.counter_rate).toLocaleString()} ${b.currency||'USD'}${b.counter_message ? ' <span style="color:var(--muted);font-size:.7rem;font-style:italic;">"'+b.counter_message+'"</span>' : ''}</span></div>`);
    }

    // Unified Rate block (parallel to mobile card's price block)
    const rateLabelText = isApproved ? 'Agreed Rate' : (b.counter_rate ? 'Counter Offer' : (b.quoted_rate ? 'Quoted Rate' : (b.offer_amount ? 'Your Offer' : '')));
    const rateAmountColor = isApproved ? 'var(--neon)' : 'var(--amber)';
    const unifiedRateBlock = (() => {
      if (!agreedRate && b.quoted_rate === null) {
        return `<div style="padding:.5rem;text-align:center;font-family:'Space Mono',monospace;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:var(--amber);">Open to Offers</div>`;
      }
      if (!agreedRate) return '';
      return `<div style="padding:.5rem;display:flex;justify-content:center;align-items:center;gap:2rem;flex-wrap:wrap;">
          <div style="text-align:center;">
            <div style="font-family:'Space Mono',monospace;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:${rateAmountColor};margin-bottom:.35rem;">${rateLabelText}</div>
            <div style="font-family:'Bebas Neue',sans-serif;font-size:2.6rem;letter-spacing:.05em;color:var(--white);line-height:1;">${sym}${Number(agreedRate).toLocaleString()} <span style="font-size:1.1rem;color:var(--muted);">${b.currency||'USD'}</span></div>
          </div>
          ${durationLabel ? `
          <div style="text-align:center;">
            <div style="font-family:'Space Mono',monospace;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.35rem;">Duration</div>
            <div style="font-family:'Bebas Neue',sans-serif;font-size:2.6rem;letter-spacing:.05em;color:var(--neon);line-height:1;">${durationLabel}</div>
          </div>` : ''}
        </div>`;
    })();

    // Action buttons
    const incomingActions = isIncoming && b.status === 'pending' ? `
      <button class="btn btn-primary btn-sm" onclick="updateStatus('${b.id}','approved')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Approve
      </button>
      <button class="btn btn-danger btn-sm" onclick="updateStatus('${b.id}','denied')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Deny
      </button>
      <button class="btn btn-amber btn-sm" onclick="openCounter('${b.id}','${b.currency||'USD'}','in',${b.counter_rate||'null'},${b.offer_amount||'null'},${b.quoted_rate||'null'})">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg> Counter
      </button>` : '';

    const outgoingActions = !isIncoming && (b.status === 'pending' || b.status === 'counter') && b.status !== 'counter' ? `
      <button class="btn btn-danger btn-sm" onclick="cancelOffer('${b.id}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Cancel Offer
      </button>` : '';

    const counterResponseActions = !isIncoming && b.status === 'counter' ? `
      <button class="btn btn-primary btn-sm" onclick="requesterUpdateStatus('${b.id}','approved')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Accept
      </button>
      <button class="btn btn-danger btn-sm" onclick="requesterUpdateStatus('${b.id}','denied')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Decline
      </button>
      <button class="btn btn-amber btn-sm" onclick="openCounter('${b.id}','${b.currency||'USD'}','out',${b.counter_rate||'null'},${b.offer_amount||'null'},${b.quoted_rate||'null'})">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg> Counter Back
      </button>
      <button class="btn btn-danger btn-sm" onclick="cancelOffer('${b.id}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Cancel
      </button>` : '';

    return `<div class="${cardClass}" id="card-${b.id}" style="padding:0;overflow:hidden;border-radius:12px;border-left:1px solid var(--border);position:relative;">

      <!-- Status accent strip (top) -->
      <div style="height:3px;background:${statusAccent};"></div>

      <!-- Status badge: top-right -->
      <div style="position:absolute;top:14px;right:14px;z-index:5;">
        <span class="${statusClass} status-badge">${statusLabel}</span>
      </div>

      <!-- HEADER: Venue Type + venue type label -->
      <div style="padding:1rem 1.1rem .9rem;">
        ${orderBadge ? `<div style="margin-bottom:.5rem;">${orderBadge}</div>` : ''}
        <div>
          <div style="font-family:'Space Mono',monospace;font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.25rem;">Venue Type</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:1.75rem;letter-spacing:.04em;color:var(--white);line-height:1;">${b.venue_type === 'club' ? 'Club' : 'Bar'}</div>
        </div>
      </div>

      <!-- SECTION: Date & Time -->
      <div style="padding:.9rem 1.1rem .25rem;">
        <div style="position:relative;border:1px solid var(--white);border-radius:8px;padding:1.35rem .9rem .9rem;margin-bottom:1rem;"><div style="position:absolute;top:-.6rem;left:50%;transform:translateX(-50%);background:var(--neon);color:var(--black);padding:.2rem .75rem;border-radius:4px;white-space:nowrap;font-family:'Space Mono',monospace;font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Date & Time</div>
          <div style="font-size:.95rem;color:var(--muted);display:flex;align-items:center;gap:.4rem;margin-bottom:.8rem;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span style="color:var(--white);">${b.event_date ? new Date(b.event_date + 'T12:00:00').toLocaleDateString('en-US', {weekday:'long',month:'long',day:'numeric',year:'numeric'}) : '—'}</span>
          </div>
          <div style="margin-bottom:.7rem;">
            <div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.2rem;">Set Start</div>
            <div style="font-family:'Bebas Neue',sans-serif;font-size:1.4rem;color:var(--neon);letter-spacing:.03em;line-height:1;">${b.start_time ? formatTime(b.start_time) : '—'}</div>
          </div>
          <div style="margin-bottom:.7rem;">
            <div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.2rem;">Set End</div>
            <div style="font-family:'Bebas Neue',sans-serif;font-size:1.4rem;color:var(--neon);letter-spacing:.03em;line-height:1;">${b.end_time ? formatTime(b.end_time) : '—'}</div>
          </div>
          ${durationLabel ? `
          <div>
            <div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.2rem;">Duration</div>
            <div style="font-family:'Bebas Neue',sans-serif;font-size:1.4rem;color:var(--neon);letter-spacing:.03em;line-height:1;">${durationLabel}</div>
          </div>` : ''}
        </div>
      </div>

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
            </a>` : ''}
          </div>` : ''}

          ${b.set_type ? `
          <div style="margin-bottom:.85rem;">
            <div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem;">Set Type</div>
            <div style="font-size:.95rem;color:var(--white);font-weight:600;">${setTypeLabels[b.set_type] || b.set_type}</div>
          </div>` : ''}

          ${b.equipment ? `
          <div style="margin-bottom:.25rem;">
            <div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem;">Equipment</div>
            <div style="font-size:.95rem;color:var(--white);">${equipLabels[b.equipment] || b.equipment}</div>
            ${b.venue_equip_detail ? `<div style="font-size:.78rem;color:var(--muted);margin-top:.25rem;font-style:italic;">${b.venue_equip_detail}</div>` : ''}
          </div>` : ''}
        </div>
      </div>

      <!-- SECTION: Contact Info -->
      <div style="padding:.9rem 1.1rem .25rem;">
        <div style="position:relative;border:1px solid var(--white);border-radius:8px;padding:1.35rem .9rem .9rem;margin-bottom:1rem;"><div style="position:absolute;top:-.6rem;left:50%;transform:translateX(-50%);background:var(--neon);color:var(--black);padding:.2rem .75rem;border-radius:4px;white-space:nowrap;font-family:'Space Mono',monospace;font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Contact Info</div>
          <div style="margin-bottom:.85rem;">
            <div style="font-size:.85rem;color:var(--muted);">
              ${isIncoming ? 'Booker' : 'DJ'}: <span style="color:var(--white);font-weight:500;">${isIncoming ? (b.requester_name && b.requester_name !== 'none' ? b.requester_name : 'Unknown') : (b.dj_name && b.dj_name !== 'none' ? b.dj_name : 'DJ')}</span>
            </div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="openMsg('${b.id}','${targetId}')" style="font-size:.6rem;padding:.4rem .75rem;border-color:var(--neon);color:var(--neon);">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Message ${isIncoming ? (b.requester_name && b.requester_name !== 'none' ? b.requester_name : 'Booker') : (b.dj_name && b.dj_name !== 'none' ? b.dj_name : 'DJ')}
          </button>
        </div>
      </div>

      ${b.notes ? `
      <!-- SECTION: Message From Booker -->
      <div style="padding:.9rem 1.1rem .25rem;">
        <div style="position:relative;border:1px solid var(--white);border-radius:8px;padding:1.35rem .9rem .9rem;margin-bottom:1rem;"><div style="position:absolute;top:-.6rem;left:50%;transform:translateX(-50%);background:var(--neon);color:var(--black);padding:.2rem .75rem;border-radius:4px;white-space:nowrap;font-family:'Space Mono',monospace;font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">${isIncoming ? 'Message From Booker' : 'Your Message'}</div>
          <div style="background:rgba(255,255,255,.02);border-left:2px solid var(--neon);padding:.7rem .9rem;border-radius:0 6px 6px 0;">
            <div style="font-size:.85rem;color:var(--white);line-height:1.55;font-style:italic;">"${b.notes}"</div>
          </div>
        </div>
      </div>` : ''}

      ${(b.negotiation_log?.length > 0 || b.counter_rate) && logEntries.length > 0 ? `
      <!-- SECTION: Negotiation History -->
      <div style="padding:.9rem 1.1rem .25rem;">
        <div style="position:relative;border:1px solid var(--white);border-radius:8px;padding:1.35rem .9rem .9rem;margin-bottom:1rem;"><div style="position:absolute;top:-.6rem;left:50%;transform:translateX(-50%);background:var(--neon);color:var(--black);padding:.2rem .75rem;border-radius:4px;white-space:nowrap;font-family:'Space Mono',monospace;font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Negotiation History</div>
          ${logEntries.join('')}
        </div>
      </div>` : ''}

      ${unifiedRateBlock ? `
      <!-- SECTION: Rate -->
      <div style="padding:.9rem 1.1rem .25rem;">
        <div style="position:relative;border:1px solid var(--white);border-radius:8px;padding:1.35rem .9rem .9rem;margin-bottom:1rem;"><div style="position:absolute;top:-.6rem;left:50%;transform:translateX(-50%);background:var(--neon);color:var(--black);padding:.2rem .75rem;border-radius:4px;white-space:nowrap;font-family:'Space Mono',monospace;font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Rate</div>
          ${unifiedRateBlock}
        </div>
      </div>` : ''}

      <!-- ACTIONS footer -->
      <div style="margin-top:.75rem;padding:.85rem 1.1rem;background:rgba(0,0,0,.25);border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;flex-wrap:wrap;">
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
          ${incomingActions}
          ${outgoingActions}
          ${counterResponseActions}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.4rem;">
          <div style="font-family:'Space Mono',monospace;font-size:.52rem;color:var(--muted);letter-spacing:.06em;">Requested ${new Date(b.created_at).toLocaleDateString()}</div>
          ${isBlocked
            ? `<button class="btn btn-sm" style="font-size:.5rem;padding:.2rem .5rem;background:transparent;border:1px solid var(--muted);color:var(--muted);" onclick="unblockUserInline('${targetId}')">Unblock</button>`
            : `<button class="btn btn-sm" style="font-size:.5rem;padding:.2rem .5rem;background:var(--error);border-color:var(--error);color:var(--white);" onclick="blockUser('${targetId}','${targetName}')">Block</button>`}
        </div>
      </div>

    </div>`;
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

async function updateStatus(bookingId, status) {
  const label = status === 'approved' ? 'Approve' : 'Deny';
  const style = status === 'approved' ? 'btn-primary' : 'btn-danger';
  const msg = status === 'approved' ? 'Approve this booking request?' : 'Deny this booking request?';
  showConfirm(msg, label, style, () => _doUpdateStatus(bookingId, status));
}

async function _doUpdateStatus(bookingId, status) {
  try {
    const { error } = await db.from('bookings').update({ status, updated_at: new Date().toISOString() }).eq('id', bookingId).eq('dj_id', currentUser.id);
    if (error) throw error;
    const b = incomingBookings.find(x => x.id === bookingId);
    if (b) b.status = status;

    // If approved, mark the date as booked on the DJ's calendar
    if (status === 'approved' && b && b.event_date) {
      try {
        const { data: djRow } = await db.from('users').select('booking_settings').eq('id', currentUser.id).single();
        const bs = djRow && djRow.booking_settings ? (typeof djRow.booking_settings === 'string' ? JSON.parse(djRow.booking_settings) : djRow.booking_settings) : {};
        if (!bs.booking_days) bs.booking_days = {};
        bs.booking_days[b.event_date] = {
          booked: true,
          eventName: b.venue_name || '',
          location: b.venue_address || '',
          startTime: b.start_time || '',
          endTime: b.end_time || '',
          bookingId: b.id,
        };
        await db.from('users').update({ booking_settings: JSON.stringify(bs) }).eq('id', currentUser.id);
      } catch(calErr) { console.error('Calendar update failed:', calErr); }
    }

    // Send email notifications — server resolves emails from auth.users
    if (b) {
      const { data: requester } = await db.from('users').select('name').eq('id', b.requester_id).single();

      fetch('/.netlify/functions/send-email', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          type: 'booking_status',
          requesterUserId: b.requester_id,
          requesterName: requester?.name || '',
          djName: currentUser.name,
          status,
          eventDate: b.event_date,
          venueName: b.venue_name,
          venueAddress: b.venue_address,
          venueType: b.venue_type,
          setType: b.set_type,
          startTime: b.start_time,
          endTime: b.end_time,
          equipment: b.equipment,
          notes: b.notes,
          quotedRate: b.quoted_rate,
          offerAmount: b.offer_amount,
          currency: b.currency,
        })
      }).catch(e => console.warn('Requester status email failed:', e));

      fetch('/.netlify/functions/send-email', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          type: 'booking_dj_confirm',
          djUserId: currentUser.id,
          djName: currentUser.name,
          requesterName: requester?.name || 'The requester',
          status,
          eventDate: b.event_date,
          venueName: b.venue_name,
          venueAddress: b.venue_address,
          venueType: b.venue_type,
          setType: b.set_type,
          startTime: b.start_time,
          endTime: b.end_time,
          equipment: b.equipment,
          notes: b.notes,
          quotedRate: b.quoted_rate,
          offerAmount: b.offer_amount,
          currency: b.currency,
        })
      }).catch(e => console.warn('DJ confirm email failed:', e));
    }

    // Re-render the active incoming tab
    const activeInBtn = document.querySelector('#incoming-section .tab-btn.active');
    if (activeInBtn) {
      const activeFilter = activeInBtn.id.replace('in-tab-','');
      renderList('in', activeFilter); updateTabCounts();
    }
  } catch(e) { alert('Error: ' + e.message); }
}

const PKG_REMOVED_MARKER = '<!--GDJ_REMOVED-->';

// Parse package_details HTML into { activeHtml, removedItems, hasEdits }.
// The stored HTML may be a plain <ul>...</ul> (unedited), or split by PKG_REMOVED_MARKER.
// An "edited" flag is stamped as <!--GDJ_EDITED--> at the start when edits occurred.
function parsePkgHtml(html) {
  if (!html) return { activeHtml: '', removedItems: [], hasEdits: false };
  const hasEdits = html.includes('<!--GDJ_EDITED-->');
  const cleaned = html.replace('<!--GDJ_EDITED-->', '');
  const idx = cleaned.indexOf(PKG_REMOVED_MARKER);
  if (idx === -1) return { activeHtml: cleaned, removedItems: [], hasEdits };
  const activeHtml = cleaned.slice(0, idx);
  const removedHtml = cleaned.slice(idx + PKG_REMOVED_MARKER.length);
  const tmp = document.createElement('div');
  tmp.innerHTML = removedHtml;
  const removedItems = Array.from(tmp.querySelectorAll('li')).map(li => li.textContent.trim()).filter(Boolean);
  return { activeHtml, removedItems, hasEdits };
}

// Extract the ACTIVE items (plain text) from a package_details HTML string.
function extractPkgItems(html) {
  const { activeHtml } = parsePkgHtml(html);
  if (!activeHtml) return [];
  const tmp = document.createElement('div');
  tmp.innerHTML = activeHtml;
  const lis = tmp.querySelectorAll('li');
  if (lis.length === 0) {
    const txt = tmp.textContent.trim();
    return txt ? [txt] : [];
  }
  return Array.from(lis).map(li => li.textContent.trim()).filter(Boolean);
}

function startPkgEdit() {
  const pkgDet = document.getElementById('counter-mob-pkg-details');
  const removedWrap = document.getElementById('counter-mob-pkg-removed-wrap');
  const editor = document.getElementById('counter-mob-pkg-editor');
  const textarea = document.getElementById('counter-mob-pkg-textarea');
  const items = extractPkgItems(pkgEditCurrentHtml);
  textarea.value = items.join('\n');
  pkgDet.style.display = 'none';
  if (removedWrap) removedWrap.style.display = 'none';
  editor.style.display = 'block';
  textarea.focus();
}

function cancelPkgEdit() {
  const editor = document.getElementById('counter-mob-pkg-editor');
  editor.style.display = 'none';
  // Re-render whatever we had before edit mode
  renderPkgView(pkgEditCurrentHtml);
}

// Render the package view (active list, removed box, edited pill) from a stored HTML string
function renderPkgView(html) {
  const pkgDet = document.getElementById('counter-mob-pkg-details');
  const removedWrap = document.getElementById('counter-mob-pkg-removed-wrap');
  const removedBox = document.getElementById('counter-mob-pkg-removed');
  const editedPill = document.getElementById('counter-mob-pkg-edited-pill');
  const parsed = parsePkgHtml(html);
  if (parsed.activeHtml) {
    pkgDet.innerHTML = parsed.activeHtml;
    pkgDet.style.display = 'block';
  } else {
    pkgDet.innerHTML = '';
    pkgDet.style.display = 'none';
  }
  if (parsed.removedItems.length) {
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    removedBox.innerHTML = '<ul>' + parsed.removedItems.map(i => `<li>${esc(i)}</li>`).join('') + '</ul>';
    removedWrap.style.display = 'block';
  } else {
    removedWrap.style.display = 'none';
  }
  if (editedPill) editedPill.style.display = parsed.hasEdits ? 'inline-block' : 'none';
}

function savePkgEdit() {
  const textarea = document.getElementById('counter-mob-pkg-textarea');
  const editor = document.getElementById('counter-mob-pkg-editor');
  const newItems = textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
  const origSet = new Set(pkgEditOriginalItems);
  const newSet = new Set(newItems);
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Active list — kept items plain, added items amber
  const liHtml = newItems.map(item => {
    if (origSet.has(item)) return `<li>${esc(item)}</li>`;
    return `<li style="color:#FFB347;">${esc(item)}</li>`;
  }).join('');
  const activeHtml = newItems.length ? `<ul>${liHtml}</ul>` : '';

  // Collect removed items from this save + any previously-removed items still in storage
  const prev = parsePkgHtml(pkgEditCurrentHtml);
  const removedThisSave = pkgEditOriginalItems.filter(item => !newSet.has(item));
  const allRemovedSet = new Set([...prev.removedItems, ...removedThisSave]);
  // If the DJ re-added a previously-removed item, drop it from the removed list
  for (const item of newItems) allRemovedSet.delete(item);
  const removedItems = Array.from(allRemovedSet);

  // Detect if this counter has any edits at all (additions, removals, or prior edits carried over)
  const addedCount = newItems.filter(i => !origSet.has(i)).length;
  const hasEdits = addedCount > 0 || removedItems.length > 0 || prev.hasEdits;

  // Compose final HTML
  let finalHtml = '';
  if (hasEdits) finalHtml += '<!--GDJ_EDITED-->';
  finalHtml += activeHtml;
  if (removedItems.length) {
    finalHtml += PKG_REMOVED_MARKER + '<ul>' + removedItems.map(i => `<li>${esc(i)}</li>`).join('') + '</ul>';
  }

  pkgEditCurrentHtml = finalHtml;
  pkgEditOriginalItems = newItems.slice();
  editor.style.display = 'none';
  renderPkgView(finalHtml);
}

function openCounter(bookingId, currency, group, counterRate, offerAmount, quotedRate) {
  activeCounterBookingId = bookingId;
  activeCounterGroup = group;
  const sym = currencySymbols[currency] || '$';
  document.getElementById('counter-currency-sym').textContent = sym;
  document.getElementById('counter-amount').value = '';
  document.getElementById('counter-message').value = '';
  document.getElementById('counter-alert').innerHTML = '';

  // Event details block (club/bar only)
  const detailsEl = document.getElementById('counter-event-details');
  const b = [...incomingBookings, ...outgoingBookings].find(x => x.id === bookingId);
  if (b && b.booking_type !== 'mobile' && detailsEl) {
    const dateStr = b.event_date ? new Date(b.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }) : '—';
    let timeStr = '—';
    let durStr = '—';
    if (b.start_time && b.end_time) {
      timeStr = formatTime(b.start_time) + ' – ' + formatTime(b.end_time);
      const [sh,sm] = b.start_time.split(':').map(Number);
      let [eh,em] = b.end_time.split(':').map(Number);
      let mins = (eh*60+em) - (sh*60+sm);
      if (mins < 0) mins += 24*60;
      const hrs = Math.floor(mins/60); const rem = mins % 60;
      durStr = hrs > 0 ? `${hrs} hr${hrs>1?'s':''}${rem>0?' '+rem+'m':''}` : `${rem}m`;
    } else if (b.start_time) {
      timeStr = formatTime(b.start_time);
    }
    document.getElementById('counter-event-date').textContent = dateStr;
    document.getElementById('counter-event-time').textContent = timeStr;
    document.getElementById('counter-event-duration').textContent = durStr;
    detailsEl.style.display = 'block';
  } else if (detailsEl) {
    detailsEl.style.display = 'none';
  }

  // Mobile DJ details block
  const mobEl = document.getElementById('counter-mob-details');
  if (b && b.booking_type === 'mobile' && mobEl) {
    const evLabel = MOB_EVENT_LABELS[b.event_type] || b.event_type || 'Event';
    const dateStr = b.event_date ? new Date(b.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' }) : '—';
    let timeStr = '';
    let durStr = '';
    if (b.start_time && b.end_time) {
      timeStr = formatTime(b.start_time) + ' – ' + formatTime(b.end_time);
      const [sh,sm] = b.start_time.split(':').map(Number);
      let [eh,em] = b.end_time.split(':').map(Number);
      let mins = (eh*60+em) - (sh*60+sm);
      if (mins <= 0) mins += 1440;
      const hrs = Math.floor(mins/60); const rem = mins % 60;
      durStr = hrs > 0 ? `${hrs} hr${hrs>1?'s':''}${rem>0?' '+rem+'m':''}` : `${rem}m`;
    } else if (b.start_time) {
      timeStr = formatTime(b.start_time);
    }
    document.getElementById('counter-mob-event-line').textContent = `${evLabel} · ${dateStr}`;
    document.getElementById('counter-mob-time-line').textContent = [timeStr, durStr].filter(Boolean).join(' · ') || '—';

    // Initial quote (plain, not yellow)
    const quoteWrap = document.getElementById('counter-mob-quote');
    if (b.quoted_rate) {
      document.getElementById('counter-mob-quote-val').textContent = sym + Number(b.quoted_rate).toLocaleString() + ' ' + currency;
      quoteWrap.style.display = 'flex';
    } else {
      quoteWrap.style.display = 'none';
    }

    // Cocktail (weddings only)
    const cockEl = document.getElementById('counter-mob-cocktail');
    if (b.event_type === 'weddings' && b.cocktail_needed) {
      const t = b.cocktail_start_time ? formatTime(b.cocktail_start_time) : 'TBD';
      const room = b.cocktail_same_room ? 'same room' : 'separate room';
      cockEl.textContent = `🍸 Cocktail hour ${t} · ${room}`;
      cockEl.style.display = 'block';
    } else {
      cockEl.style.display = 'none';
    }

    // Package
    const pkgWrap = document.getElementById('counter-mob-pkg');
    const pkgEditBtn = document.getElementById('counter-mob-pkg-edit-btn');
    const pkgEditor = document.getElementById('counter-mob-pkg-editor');
    if (pkgEditor) pkgEditor.style.display = 'none';
    if (b.package_title) {
      document.getElementById('counter-mob-pkg-title').textContent = b.package_title;
      pkgEditCurrentHtml = b.package_details || '';
      pkgEditOriginalItems = extractPkgItems(pkgEditCurrentHtml);
      renderPkgView(pkgEditCurrentHtml);
      // Pencil only for DJ countering mobile booking
      if (pkgEditBtn) pkgEditBtn.style.display = (group === 'in') ? 'flex' : 'none';
      pkgWrap.style.display = 'block';
    } else {
      if (pkgEditBtn) pkgEditBtn.style.display = 'none';
      pkgWrap.style.display = 'none';
    }
    mobEl.style.display = 'block';
  } else if (mobEl) {
    mobEl.style.display = 'none';
  }

  const rateEl = document.getElementById('counter-current-rate');
  const rateValEl = document.getElementById('counter-current-rate-val');
  const rateLabelEl = document.getElementById('counter-current-rate-label');
  // Only show yellow box for actual counter exchanges, not the initial quoted rate
  const currentRate = counterRate || offerAmount;
  const label = counterRate ? 'Last Counter' : 'Their Offer';
  if (currentRate && rateEl && rateValEl) {
    if (rateLabelEl) rateLabelEl.textContent = label;
    rateValEl.textContent = sym + Number(currentRate).toLocaleString() + ' ' + currency;
    rateEl.style.display = 'block';
  } else if (rateEl) {
    rateEl.style.display = 'none';
  }
  document.getElementById('counter-modal').style.display = 'flex';
}
function closeCounter() { document.getElementById('counter-modal').style.display = 'none'; }

async function submitCounter() {
  // Gate: require verified email to send counter-offers
  if (window.GDJAuth && !window.GDJAuth.requireVerifiedEmail('send counter-offers')) {
    return;
  }

  const amount = document.getElementById('counter-amount').value;
  const message = document.getElementById('counter-message').value.trim();
  const alertEl = document.getElementById('counter-alert');
  if (!amount) { alertEl.innerHTML = '<div class="alert alert-error">Enter a counter amount.</div>'; return; }
  try {
    if (activeCounterGroup === 'in') {
      // DJ countering — fetch current log, append entry
      const { data: current } = await db.from('bookings').select('negotiation_log').eq('id', activeCounterBookingId).single();
      const log = current?.negotiation_log || [];
      log.push({ from: 'dj', amount: Number(amount), message, created_at: new Date().toISOString() });
      // If DJ edited package details, include the updated HTML (with amber spans) in the update
      const updatePayload = { status: 'counter', counter_rate: amount, counter_message: message, negotiation_log: log, updated_at: new Date().toISOString() };
      const bRef = incomingBookings.find(x => x.id === activeCounterBookingId);
      const pkgChanged = bRef && bRef.booking_type === 'mobile' && pkgEditCurrentHtml !== (bRef.package_details || '');
      if (pkgChanged) updatePayload.package_details = pkgEditCurrentHtml;
      const { error } = await db.from('bookings').update(updatePayload).eq('id', activeCounterBookingId).eq('dj_id', currentUser.id);
      if (error) throw error;
      const b = incomingBookings.find(x => x.id === activeCounterBookingId);
      if (b) { b.status = 'counter'; b.counter_rate = amount; b.counter_message = message; b.negotiation_log = log; if (pkgChanged) b.package_details = pkgEditCurrentHtml; }
      if (b) {
        const { data: requester } = await db.from('users').select('name').eq('id', b.requester_id).single();
        fetch('/.netlify/functions/send-email', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ type: 'booking_counter', recipientUserId: b.requester_id, recipientName: requester?.name || '', senderName: currentUser.name, fromRole: 'dj', counterRate: amount, counterMessage: message, eventDate: b.event_date, venueName: b.venue_name, currency: b.currency, packageTitle: b.package_title, packageDetails: b.package_details })
        }).catch(() => {});
      }
      closeCounter();
      const activeInBtn = document.querySelector('#incoming-section .tab-btn.active');
      if (activeInBtn) renderList('in', activeInBtn.id.replace('in-tab-','')); updateTabCounts();
    } else {
      // Booker countering back — fetch current log, append entry
      const { data: current } = await db.from('bookings').select('negotiation_log').eq('id', activeCounterBookingId).single();
      const log = current?.negotiation_log || [];
      log.push({ from: 'booker', amount: Number(amount), message, created_at: new Date().toISOString() });
      const { error } = await db.from('bookings').update({ status: 'pending', counter_rate: amount, counter_message: message, negotiation_log: log, updated_at: new Date().toISOString() }).eq('id', activeCounterBookingId).eq('requester_id', currentUser.id);
      if (error) throw error;
      const b = outgoingBookings.find(x => x.id === activeCounterBookingId);
      if (b) { b.status = 'pending'; b.counter_rate = amount; b.counter_message = message; b.negotiation_log = log; }
      if (b) {
        const { data: dj } = await db.from('users').select('name').eq('id', b.dj_id).single();
        fetch('/.netlify/functions/send-email', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ type: 'booking_counter', recipientUserId: b.dj_id, recipientName: dj?.name || '', senderName: currentUser.name, fromRole: 'booker', counterRate: amount, counterMessage: message, eventDate: b.event_date, venueName: b.venue_name, currency: b.currency })
        }).catch(() => {});
      }
      closeCounter();
      const activeOutBtn = document.querySelector('#outgoing-section .tab-btn.active');
      if (activeOutBtn) renderList('out', activeOutBtn.id.replace('out-tab-','')); updateTabCounts();
    }
  } catch(e) { alertEl.innerHTML = '<div class="alert alert-error">' + e.message + '</div>'; }
}

