// SHARED ACTIONS: requester status, block/unblock, cancel offer, message modal
// Extracted from booking-requests.html

async function requesterUpdateStatus(bookingId, status) {
  const label = status === 'approved' ? 'Accept' : 'Decline';
  const style = status === 'approved' ? 'btn-primary' : 'btn-danger';
  const msg = status === 'approved' ? 'Accept this counter offer?' : 'Decline this counter offer?';
  showConfirm(msg, label, style, () => _doRequesterUpdateStatus(bookingId, status));
}

async function _doRequesterUpdateStatus(bookingId, status) {
  try {
    const { error } = await db.from('bookings').update({ status, updated_at: new Date().toISOString() }).eq('id', bookingId).eq('requester_id', currentUser.id);
    if (error) throw error;
    const b = outgoingBookings.find(x => x.id === bookingId);
    if (b) b.status = status;
    // Email DJ
    if (b) {
      const { data: dj } = await db.from('users').select('name').eq('id', b.dj_id).single();
      fetch('/.netlify/functions/send-email', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          type: 'booking_dj_confirm', djUserId: b.dj_id, djName: dj?.name || '',
          requesterName: currentUser.name, status,
          eventDate: b.event_date, venueName: b.venue_name, venueAddress: b.venue_address,
          venueType: b.venue_type, setType: b.set_type, startTime: b.start_time,
          endTime: b.end_time, equipment: b.equipment, notes: b.notes,
          quotedRate: b.quoted_rate, offerAmount: b.offer_amount, currency: b.currency,
        })
      }).catch(() => {});
      // Email booker confirmation
      fetch('/.netlify/functions/send-email', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          type: 'booking_status', requesterUserId: currentUser.id, requesterName: currentUser.name,
          djName: dj?.name || '', status,
          eventDate: b.event_date, venueName: b.venue_name, venueAddress: b.venue_address,
          venueType: b.venue_type, setType: b.set_type, startTime: b.start_time,
          endTime: b.end_time, equipment: b.equipment, notes: b.notes,
          quotedRate: b.counter_rate || b.quoted_rate, offerAmount: b.offer_amount, currency: b.currency,
        })
      }).catch(() => {});
    }
    const activeOutBtn = document.querySelector('#outgoing-section .tab-btn.active');
    if (activeOutBtn) renderList('out', activeOutBtn.id.replace('out-tab-','')); updateTabCounts();
  } catch(e) { alert('Error: ' + e.message); }
}

async function unblockUserInline(userId) {
  try {
    const updated = blockedUsers.filter(id => id !== userId);
    await db.from('users').update({ blocked_users: updated }).eq('id', currentUser.id);
    blockedUsers = updated;
    const activeInBtn = document.querySelector('#incoming-section .tab-btn.active');
    if (activeInBtn) renderList('in', activeInBtn.id.replace('in-tab-',''));
    const activeOutBtn = document.querySelector('#outgoing-section .tab-btn.active');
    if (activeOutBtn) renderList('out', activeOutBtn.id.replace('out-tab-',''));
  } catch(e) { alert('Error: ' + e.message); }
}

async function blockUser(userId, userName) {
  showConfirm(`Block ${userName}? They will no longer be able to send you booking requests or messages.`, 'Block User', 'btn-danger', () => _doBlockUser(userId, userName));
}

async function _doBlockUser(userId, userName) {
  try {
    const updatedBlocked = [...new Set([...blockedUsers, userId])];
    const { error } = await db.from('users').update({ blocked_users: updatedBlocked }).eq('id', currentUser.id);
    if (error) throw error;
    blockedUsers = updatedBlocked;
    // Deny any pending incoming bookings from this user
    await db.from('bookings').update({ status: 'denied', updated_at: new Date().toISOString() })
      .eq('requester_id', userId).eq('dj_id', currentUser.id).eq('status', 'pending');
    incomingBookings = incomingBookings.map(b => b.requester_id === userId && b.status === 'pending' ? {...b, status: 'denied'} : b);
    const activeInBtn = document.querySelector('#incoming-section .tab-btn.active');
    if (activeInBtn) renderList('in', activeInBtn.id.replace('in-tab-','')); updateTabCounts();
    const activeOutBtn = document.querySelector('#outgoing-section .tab-btn.active');
    if (activeOutBtn) renderList('out', activeOutBtn.id.replace('out-tab-','')); updateTabCounts();
  } catch(e) { alert('Error: ' + e.message); }
}

async function cancelOffer(bookingId) {
  showConfirm('Cancel this booking request? The DJ will be notified.', 'Cancel Request', 'btn-danger', () => _doCancelOffer(bookingId));
}

async function _doCancelOffer(bookingId) {
  try {
    const { error } = await db.from('bookings').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', bookingId).eq('requester_id', currentUser.id);
    if (error) throw error;
    const b = outgoingBookings.find(x => x.id === bookingId);
    if (b) b.status = 'cancelled';
    if (b) {
      const { data: dj } = await db.from('users').select('name').eq('id', b.dj_id).single();
      const emailPayload = {
        type: 'booking_cancelled',
        requesterName: currentUser.name,
        djName: dj?.name || b.dj_name || 'DJ',
        eventDate: b.event_date,
        venueName: b.venue_name,
        venueAddress: b.venue_address,
        venueType: b.venue_type,
        setType: b.set_type,
        startTime: b.start_time,
        endTime: b.end_time,
        currency: b.currency,
      };
      fetch('/.netlify/functions/send-email', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ ...emailPayload, recipientUserId: b.dj_id, recipientName: dj?.name || '', recipientRole: 'dj' })
      }).catch(() => {});
      fetch('/.netlify/functions/send-email', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ ...emailPayload, recipientUserId: currentUser.id, recipientName: currentUser.name, recipientRole: 'requester' })
      }).catch(() => {});
    }
    const activeOutBtn = document.querySelector('#outgoing-section .tab-btn.active');
    if (activeOutBtn) renderList('out', activeOutBtn.id.replace('out-tab-','')); updateTabCounts();
  } catch(e) { alert('Error: ' + e.message); }
}

function openMsg(bookingId, userId) {
  activeMsgBookingId = bookingId;
  activeMsgUserId = userId;
  document.getElementById('msg-body').value = '';
  document.getElementById('msg-subject').value = buildMsgSubject(bookingId);
  document.getElementById('msg-alert').innerHTML = '';
  document.getElementById('msg-modal').style.display = 'flex';
}

function buildMsgSubject(bookingId) {
  const b = [...incomingBookings, ...outgoingBookings].find(x => x.id === bookingId);
  if (!b) return 'Re: Your Booking Request';
  let dateStr = '';
  if (b.event_date) {
    const d = new Date(b.event_date + 'T12:00:00');
    dateStr = d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  }
  const venue = b.venue_name || '';
  if (dateStr && venue) return `Booking: ${dateStr} @ ${venue}`;
  if (dateStr) return `Booking: ${dateStr}`;
  if (venue) return `Booking: ${venue}`;
  return 'Re: Your Booking Request';
}
function closeMsg() { document.getElementById('msg-modal').style.display = 'none'; }

async function sendMsg() {
  const body = document.getElementById('msg-body').value.trim();
  const subject = document.getElementById('msg-subject').value.trim() || buildMsgSubject(activeMsgBookingId);
  const alertEl = document.getElementById('msg-alert');
  if (!body) { alertEl.innerHTML = '<div class="alert alert-error">Enter a message.</div>'; return; }
  try {
    const { error } = await db.from('messages').insert({ from_user_id: currentUser.id, to_user_id: activeMsgUserId, from_name: currentUser.name, subject: subject, message: body, read: false });
    if (error) throw error;
    alertEl.innerHTML = '<div class="alert alert-success">✓ Message sent!</div>';
    setTimeout(() => closeMsg(), 1500);
  } catch(e) { alertEl.innerHTML = '<div class="alert alert-error">' + e.message + '</div>'; }
}

