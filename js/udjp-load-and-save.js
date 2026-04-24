// LOAD & SAVE: loadProfile, saveHandler, image deletes, dirty tracking
// Extracted from update-dj-profile.html

const clubGenres = document.querySelectorAll('input[name="club-genres"]');
clubGenres.forEach(cb => {
  cb.addEventListener('change', function() {
    if (this.value === 'open-format' && this.checked) {
      clubGenres.forEach(other => {
        if (other !== this) {
          other.checked = false;
          other.disabled = true;
        }
      });
    } else if (this.value === 'open-format' && !this.checked) {
      clubGenres.forEach(other => other.disabled = false);
    } else {
      const checked = Array.from(clubGenres).filter(c => c.checked && c.value !== 'open-format').length;
      if (checked > 7) {
        this.checked = false;
        alert('Maximum 7 genres allowed');
      }
    }
  });
});


(async function() {
  // Wait for auth.js to resolve the session before loading profile data
  if (typeof GDJAuth !== 'undefined' && GDJAuth.waitUntilReady) {
    const cu = await GDJAuth.waitUntilReady();
    if (cu) currentUser = cu;
  }
  if (!currentUser) {
    // authGate above will redirect; just stop here
    return;
  }

  // Show email verified banner if arrived from email confirmation link
  const isEmailVerifyReturn = new URLSearchParams(window.location.search).get('emailverified') === '1';
  if (isEmailVerifyReturn) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:rgba(61,220,132,.12);border:1px solid rgba(61,220,132,.4);color:#3ddc84;padding:.85rem 1.2rem;margin:0 0 1.5rem;border-radius:8px;font-family:\'Space Mono\',monospace;font-size:.78rem;letter-spacing:.03em;text-align:center;transition:opacity .5s;';
    banner.textContent = '✓ Your account is now verified, all account features are now activated.';
    const target = document.querySelector('.container') || document.querySelector('main') || document.body;
    if (target) target.insertBefore(banner, target.firstChild);
    setTimeout(() => { banner.style.opacity = '0'; }, 30000);
    setTimeout(() => banner.remove(), 31000);
    if (window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    // Force auth.js to re-read public.users so email_verified updates and the
    // orange "verify your email" banner disappears immediately.
    if (window.GDJAuth && window.GDJAuth.refreshProfile) {
      try { window.GDJAuth.refreshProfile(); } catch(e){}
    }
  }

  try {
    // Use raw fetch with the access token from auth.js — the SDK's internal session
    // state can race with this initial load, so we go direct.
    const session = (typeof GDJAuth !== 'undefined' && GDJAuth.session) ? GDJAuth.session() : null;
    const accessToken = session && session.access_token;
    const SUPABASE_URL_LOCAL = 'https://hwqvzuusquruhwguqole.supabase.co';
    const SUPABASE_KEY_LOCAL = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3cXZ6dXVzcXVydWh3Z3Vxb2xlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjkxNjUsImV4cCI6MjA4NzE0NTE2NX0.TKoNk-u5bEKgVy-pXRrCYv8Iui8SzIa5ExiVUyEJ6UE';
    const profileRes = await fetch(
      SUPABASE_URL_LOCAL + '/rest/v1/users?select=*&id=eq.' + encodeURIComponent(currentUser.id) + '&limit=1',
      {
        headers: {
          apikey: SUPABASE_KEY_LOCAL,
          Authorization: 'Bearer ' + (accessToken || SUPABASE_KEY_LOCAL)
        }
      }
    );
    if (!profileRes.ok) {
      const errText = await profileRes.text();
      throw new Error('Profile fetch failed: ' + profileRes.status + ' ' + errText);
    }
    const profileRows = await profileRes.json();
    const data = profileRows && profileRows[0];
    if (!data) throw new Error('Profile not found');
    // Email lives on auth.users now, not public.users — use the one from currentUser (auth.js merges it in)
    if (!data.email) data.email = currentUser.email;
    
    document.getElementById('email').value = data.email;
    document.getElementById('name').value = data.name || '';
    // Set View My Profile link
    if (data.slug) {
      const vpBtn = document.getElementById('upd-view-profile-btn');
      if (vpBtn) { vpBtn.href = '/' + data.slug; vpBtn.style.display = 'inline-flex'; }
      const urlHint = document.getElementById('private-profile-url');
      if (urlHint) urlHint.textContent = window.location.origin + '/' + data.slug;
    }
    if (data.profile_private) document.getElementById('profile-private').checked = true;
    // Set avatar initials fallback (only if no photo loaded yet)
    if (data.name) {
      const initials = data.name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0,2);
      if (!data.avatar_url) document.getElementById('avatar-initials').textContent = initials;
    }

    // Load slug
    if (data.slug) {
      originalSlug = data.slug;
      chosenSlug = data.slug;
      slugAvailable = true;
      document.getElementById('slug-input').value = data.slug;
      document.getElementById('slug-hint').textContent = data.slug;
      document.getElementById('preview-url').textContent = BASE_URL + data.slug;
      document.getElementById('preview-url').className = 'url available';
      document.getElementById('url-status').textContent = 'Current URL ✓';
      document.getElementById('url-status').className = 'url-status available';
      const previewEl = document.getElementById('url-preview');
      previewEl.style.display = 'flex';
      previewEl.classList.add('visible');
    }
    document.getElementById('country').value = data.country || '';
    document.getElementById('city').value = data.city || '';
    document.getElementById('state').value = data.state || '';
    document.getElementById('zip').value = data.zip || '';
    // Pre-select country dropdown
    if (data.country) {
      const countrySelect = document.getElementById('country-select');
      for (let i = 0; i < countrySelect.options.length; i++) {
        if (countrySelect.options[i].value === data.country) {
          countrySelect.selectedIndex = i;
          break;
        }
      }
      updateZipPlaceholder(data.country);
    }
    // Populate hidden city/state/country from DB, show as lookup result
    document.getElementById('city').value = data.city || '';
    document.getElementById('state').value = data.state || '';
    document.getElementById('country').value = data.country || '';
    if (data.city || data.state) {
      document.getElementById('zip-lookup-result').textContent = [data.city, data.state, data.country].filter(Boolean).join(', ');
    } else if (data.zip) {
      lookupZip(data.zip);
    }
    document.getElementById('travel_distance').value = data.travel_distance || '';
    document.getElementById('dj_start_year').value = data.dj_start_year || '';
    document.getElementById('bio').value = data.bio || '';
    if (document.getElementById('rate')) document.getElementById('rate').value = data.rate || '';
    document.getElementById('phone').value = data.phone || '';
    document.getElementById('website').value = data.website || '';
    document.getElementById('soundcloud').value = data.soundcloud || '';
    document.getElementById('instagram').value = data.instagram || '';
    document.getElementById('tiktok').value = data.tiktok || '';
    document.getElementById('facebook').value = data.facebook || '';
    document.getElementById('twitch').value = data.twitch || '';
    loadAvatarPreview(data.avatar_url);
  if (data.avatar_url) document.getElementById('avatar-circle').classList.add('has-photo');
    document.getElementById('mix_url_1').value = data.mix_url_1 || '';
    document.getElementById('mix_url_2').value = data.mix_url_2 || '';
    document.getElementById('mix_url_3').value = data.mix_url_3 || '';
    loadExistingImage(data.gallery_img_1, 'gallery1-preview', 'gallery_img_1');
    loadExistingImage(data.gallery_img_2, 'gallery2-preview', 'gallery_img_2');
    loadExistingImage(data.gallery_img_3, 'gallery3-preview', 'gallery_img_3');
    loadExistingImage(data.gallery_img_4, 'gallery4-preview', 'gallery_img_4');
    document.getElementById('video_url_1').value = data.video_url_1 || '';
    document.getElementById('video_url_2').value = data.video_url_2 || '';
    document.getElementById('video_url_3').value = data.video_url_3 || '';

    // Determine DJ type — single canonical source of truth, immutable on this page
    userDjType = data.dj_type || null;
    const isMobile = userDjType === 'mobile';
    const isClub = userDjType === 'club';

    // Show the relevant sub-section
    if (isMobile) document.getElementById('mobile-spec').style.display = 'block';
    if (isClub) document.getElementById('club-spec').style.display = 'block';

    updateNameLabel();

    // Show testimonials tab for Mobile DJs
    if (isMobile) {
      document.getElementById('tab-btn-testimonials').style.display = '';
      if (data.testimonials) {
        try {
          const tList = JSON.parse(data.testimonials);
          tList.forEach(t => addTestimonialField(t));
        } catch(e) {}
      }
    }

    // Load mobile party types from event_types.
    // For Mobile DJs with NO event_types saved yet (e.g., new account), default to ALL checked.
    if (data.event_types) {
      data.event_types.split(',').map(s => s.trim()).forEach(partyType => {
        const checkbox = document.querySelector(`input[name="mobile-events"][value="${partyType}"]`);
        if (checkbox) checkbox.checked = true;
      });
    } else if (isMobile) {
      // New Mobile DJ — pre-check every event type as a sensible default
      document.querySelectorAll('input[name="mobile-events"]').forEach(cb => { cb.checked = true; });
    }
    
    // Load club genres (text[] column — comes back as a real array)
    if (data.club_genres && data.club_genres.length) {
      const genreArr = Array.isArray(data.club_genres) ? data.club_genres : String(data.club_genres).split(',');
      genreArr.forEach(genre => {
        const cb = document.querySelector(`input[name="club-genres"][value="${genre}"]`);
        if (cb) {
          cb.checked = true;
          if (genre === 'open-format') {
            clubGenres.forEach(other => {
              if (other.value !== 'open-format') other.disabled = true;
            });
          }
        }
      });
    }

    // Now that type checkboxes are set from loaded data, refresh which tabs are visible
    if (typeof checkShowBookingTab === 'function') checkShowBookingTab();

    // Initial load may have flagged the form dirty (e.g. addTestimonialField sets
    // it for each existing testimonial). Reset so the leave-site warning only
    // fires after genuine user edits.
    formDirty = false;

  } catch (error) {
    console.error('[update-dj-profile] Load error:', error);
    document.getElementById('alert').innerHTML = '<div class="alert alert-error">Failed to load profile: ' + (error.message || 'Unknown error') + '</div>';
  }
})();

// Form submission
document.getElementById('profile-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  
  const btn = document.getElementById('save-btn');
  const alertBox = document.getElementById('alert');
  
  btn.disabled = true;
  btn.textContent = 'Saving...';
  alertBox.innerHTML = '';
  
  try {
    // Slug validation
    const rawSlug = document.getElementById('slug-input').value.trim();
    const finalSlug = makeSlug(rawSlug) || originalSlug;
    if (rawSlug && !slugAvailable && finalSlug !== originalSlug) {
      alertBox.innerHTML = '<div class="alert alert-error">That URL is taken or invalid. Please choose an available URL.</div>';
      btn.disabled = false; btn.textContent = 'Save Changes'; return;
    }

    
    let clubGenresData = null;
    if (userDjType === 'club') {
      const genres = Array.from(document.querySelectorAll('input[name="club-genres"]:checked')).map(cb => cb.value);
      if (genres.length > 0) clubGenresData = genres;  // text[] column — send array, not joined string
    }

    // Combine mobile party types + event type tags into one field
    const mobileParties = Array.from(document.querySelectorAll('input[name="mobile-events"]:checked')).map(cb => cb.value);
    const allEventTypes = mobileParties;

    const updateData = {
      name: document.getElementById('name').value,
      slug: finalSlug || undefined,
      city: document.getElementById('city').value,
      state: document.getElementById('state').value,
      country: document.getElementById('country').value,
      zip: document.getElementById('zip').value,
      travel_distance: document.getElementById('travel_distance').value || null,
      dj_start_year: document.getElementById('dj_start_year').value || null,
      bio: document.getElementById('bio').value,
      phone: document.getElementById('phone').value,
      website: document.getElementById('website').value,
      soundcloud: document.getElementById('soundcloud').value,
      instagram: document.getElementById('instagram').value,
      tiktok: document.getElementById('tiktok').value,
      facebook: document.getElementById('facebook').value,
      twitch: document.getElementById('twitch').value,
      avatar_url: document.getElementById('avatar_url').value,
      event_types: allEventTypes.length > 0 ? allEventTypes.join(',') : null,
      club_genres: clubGenresData,
      mix_url_1: document.getElementById('mix_url_1').value,
      mix_url_2: document.getElementById('mix_url_2').value,
      mix_url_3: document.getElementById('mix_url_3').value,
      gallery_img_1: document.getElementById('gallery_img_1').value,
      gallery_img_2: document.getElementById('gallery_img_2').value,
      gallery_img_3: document.getElementById('gallery_img_3').value,
      gallery_img_4: document.getElementById('gallery_img_4').value,
      video_url_1: document.getElementById('video_url_1').value,
      video_url_2: document.getElementById('video_url_2').value,
      video_url_3: document.getElementById('video_url_3').value,
      testimonials: collectTestimonials(),
      profile_private: document.getElementById('profile-private').checked,
    };

    // password column was removed during Supabase Auth migration; ignore any
    // password field on this form (password changes happen via account-settings).

    // Use raw fetch with explicit auth token — the SDK can silently no-op on writes
    const session = (typeof GDJAuth !== 'undefined' && GDJAuth.session) ? GDJAuth.session() : null;
    const accessToken = session && session.access_token;
    if (!accessToken) throw new Error('Not authenticated. Please refresh and sign in again.');
    const SUPABASE_URL_LOCAL = 'https://hwqvzuusquruhwguqole.supabase.co';
    const SUPABASE_KEY_LOCAL = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3cXZ6dXVzcXVydWh3Z3Vxb2xlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjkxNjUsImV4cCI6MjA4NzE0NTE2NX0.TKoNk-u5bEKgVy-pXRrCYv8Iui8SzIa5ExiVUyEJ6UE';
    const saveRes = await fetch(
      SUPABASE_URL_LOCAL + '/rest/v1/users?id=eq.' + encodeURIComponent(currentUser.id),
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY_LOCAL,
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify(updateData)
      }
    );
    if (!saveRes.ok) {
      const errText = await saveRes.text();
      throw new Error('Save failed (' + saveRes.status + '): ' + errText);
    }
    const saved = await saveRes.json();
    if (!saved || saved.length === 0) {
      throw new Error('Save returned no rows — your update may have been blocked by permissions.');
    }

    alertBox.innerHTML = '<div class="alert alert-success">Profile updated successfully!</div>';
    formDirty = false;
    formSaved = true;
    if (finalSlug) originalSlug = finalSlug;
    setTimeout(() => alertBox.innerHTML = '', 3000);
    
  } catch (error) {
    alertBox.innerHTML = '<div class="alert alert-error">Error: ' + error.message + '</div>';
  }
  
  btn.disabled = false;
  btn.textContent = 'Save Changes';
});

// ── IMAGE DELETE ─────────────────────────────────────────
function deleteAvatar(e) {
  e.stopPropagation();
  if (!confirm('Remove profile photo?')) return;
  document.getElementById('avatar_url').value = '';
  const img = document.getElementById('avatar-img');
  img.src = ''; img.style.display = 'none';
  document.getElementById('avatar-initials').style.display = '';
  document.getElementById('avatar-circle').classList.remove('has-photo');
  document.getElementById('avatar-top-info').innerHTML = '<strong>Profile Photo</strong><span>Click to upload &amp; crop</span>';
  formDirty = true;
}

function deleteGalleryImg(e, num) {
  e.stopPropagation();
  if (!confirm('Remove this photo?')) return;
  document.getElementById('gallery_img_' + num).value = '';
  const previewEl = document.getElementById('gallery' + num + '-preview');
  const img = document.getElementById('gallery' + num + '-img');
  img.src = '';
  previewEl.classList.remove('visible');
  previewEl.closest('.upload-box').classList.remove('has-image');
  const placeholder = previewEl.closest('.upload-box').querySelector('.upload-placeholder');
  if (placeholder) placeholder.style.display = '';
  formDirty = true;
}

// ── UNSAVED CHANGES WARNING ──────────────────────────────
let formDirty = false;
let formSaved = false;
// Only count input/change events as "dirty" once the user has actually
// interacted with the page — this avoids false positives from programmatic
// value sets, browser autofill, and bubbled events during initial load.
let userInteracted = false;
['pointerdown','keydown','touchstart'].forEach(evt => {
  window.addEventListener(evt, () => { userInteracted = true; }, { once: true, capture: true });
});

// Mark form dirty on any input change (only after real user interaction)
document.getElementById('profile-form').addEventListener('change', (e) => { if (userInteracted && !e.target.closest('#club-booking-section') && !e.target.closest('#mobile-booking-section') && e.target.id !== 'booking-enabled') formDirty = true; });
document.getElementById('profile-form').addEventListener('input', (e) => { if (userInteracted && !e.target.closest('#club-booking-section') && !e.target.closest('#mobile-booking-section') && e.target.id !== 'booking-enabled') formDirty = true; });

// Mark saved on successful submit
const originalSubmit = document.getElementById('profile-form').onsubmit;
document.getElementById('profile-form').addEventListener('submit', () => {
  setTimeout(() => { formSaved = true; formDirty = false; }, 100);
});

// Warn before leaving if dirty
window.addEventListener('beforeunload', function(e) {
  if (formDirty && !formSaved) {
    e.preventDefault();
    e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
    return e.returnValue;
  }
});


