// TABS: profile tab switcher + verification gates
// Extracted from update-dj-profile.html

function switchProfileTab(name, btn) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.profile-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');

  // Booking & Photos tabs are gated behind email verification
  if (name === 'booking') applyTabVerificationGate('booking', "You'll need to verify your email before activating the booking feature.");
  if (name === 'photos') applyTabVerificationGate('photos', "You'll need to verify your email before you can upload photos to your profile.");
}

// Show a "verify your email" overlay over a tab if user is unverified.
// Hides the actual tab content and shows a clear message + resend button.
// Uses data-gdj-gate-hid="1" to mark which children WE hid, so we don't
// clobber display state set by other code (like loadBookingSettings hiding
// #booking-setup when booking_enabled is false).
function applyTabVerificationGate(tabName, messageText) {
  const pane = document.getElementById('tab-' + tabName);
  if (!pane) return;
  const isVerified = !!(window.GDJAuth && window.GDJAuth.isEmailVerified && window.GDJAuth.isEmailVerified());
  const overlayId = tabName + '-verify-overlay';
  let overlay = document.getElementById(overlayId);

  if (isVerified) {
    if (overlay) overlay.remove();
    // Only restore display on children WE hid — leave others alone so other
    // code's display:none (e.g. booking-setup when booking is off) stands.
    Array.from(pane.children).forEach(c => {
      if (c.id === overlayId) return;
      if (c.dataset && c.dataset.gdjGateHid === '1') {
        c.style.display = '';
        delete c.dataset.gdjGateHid;
      }
    });
    return;
  }

  // Not verified — hide all original children and tag them so we can restore later
  Array.from(pane.children).forEach(c => {
    if (c.id === overlayId) return;
    // Don't touch elements that are already display:none for unrelated reasons —
    // just skip them. They stay hidden, we don't tag them.
    const cs = window.getComputedStyle ? window.getComputedStyle(c) : null;
    if (cs && cs.display === 'none') return;
    c.style.display = 'none';
    c.dataset.gdjGateHid = '1';
  });
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.style.cssText = 'background:#13131e;border:1px solid rgba(255,179,71,.4);border-radius:12px;padding:48px 32px;margin:24px 0;text-align:center;';
    overlay.innerHTML = `
      <div style="width:64px;height:64px;margin:0 auto 20px;border-radius:50%;background:rgba(255,179,71,.12);border:1px solid rgba(255,179,71,.4);display:flex;align-items:center;justify-content:center;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ffb347" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      </div>
      <h3 style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:.05em;color:#ffb347;margin:0 0 12px;">Verify Your Email</h3>
      <p style="color:var(--muted);font-size:14px;line-height:1.6;margin:0 0 24px;max-width:420px;margin-left:auto;margin-right:auto;">${messageText} Check your email account for the confirmation email. Check your spam folder if not in primary inbox.</p>
      <button type="button" class="${tabName}-overlay-resend" style="background:transparent;border:1px solid #ffb347;color:#ffb347;padding:.7rem 1.5rem;border-radius:6px;font-family:'Space Mono',monospace;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;">Resend Verification Email</button>
    `;
    pane.appendChild(overlay);
    overlay.querySelector('button').addEventListener('click', async function() {
      const btn = this;
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Sending...';
      const result = await GDJAuth.resendVerificationEmail();
      if (result.ok) {
        btn.textContent = '✓ Sent — check your inbox';
      } else {
        btn.textContent = '✗ ' + (result.error || 'Failed');
      }
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 5000);
    });
  }
}

// Backwards-compat shim — older code may still call applyBookingVerificationGate.
function applyBookingVerificationGate() {
  applyTabVerificationGate('booking', "You'll need to verify your email before activating the booking feature.");
}

// Auto-switch to tab based on URL hash (e.g. #mixes, #photos, #social, #video)
(function() {
  const hash = window.location.hash.replace('#', '').toLowerCase();
  const validTabs = ['general', 'social', 'mixes', 'photos', 'video'];
  if (hash && validTabs.includes(hash)) {
    const btn = Array.from(document.querySelectorAll('.profile-tab')).find(b =>
      b.getAttribute('onclick')?.includes(`'${hash}'`)
    );
    if (btn) switchProfileTab(hash, btn);
  }
})();

// When auth resolves (or changes), if the user is currently viewing a gated
// tab, re-apply the verification gate so the overlay shows/hides accordingly.
if (window.GDJAuth && window.GDJAuth.ready) {
  window.GDJAuth.ready(function() {
    const bookingPane = document.getElementById('tab-booking');
    if (bookingPane && bookingPane.classList.contains('active')) {
      applyTabVerificationGate('booking', "You'll need to verify your email before activating the booking feature.");
    }
    const photosPane = document.getElementById('tab-photos');
    if (photosPane && photosPane.classList.contains('active')) {
      applyTabVerificationGate('photos', "You'll need to verify your email before you can upload photos to your profile.");
    }
  });
}

