// SUBMIT: DJ + host + venue form submit handlers
// Extracted from signup.html

// ── DJ FORM SUBMIT ──────────────────────────────────────
document.getElementById('form-dj').addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = document.getElementById('submit-dj');
  const alertEl = document.getElementById('alert');
  btn.disabled = true; btn.textContent = 'Creating Account...'; alertEl.innerHTML = '';

  const types = Array.from(document.querySelectorAll('.type-btn.selected')).map(b => b.dataset.value);
  if (types.length === 0) {
    alertEl.innerHTML = '<div class="alert alert-error">Please select your DJ type</div>';
    btn.disabled = false; btn.textContent = 'Create DJ Account'; return;
  }
  const djType = types[0];
  const travelRaw = document.getElementById('dj-travel').value;
  if (!travelRaw) {
    const errEl = document.getElementById('dj-travel-error');
    const selEl = document.getElementById('dj-travel');
    if (errEl) errEl.style.display = 'block';
    if (selEl) {
      selEl.style.borderColor = 'var(--error)';
      selEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      selEl.focus();
    }
    btn.disabled = false; btn.textContent = 'Create DJ Account'; return;
  }
  const name = document.getElementById('name').value;
  const slugEditVal = document.getElementById('slug-edit').value.trim();
  const finalSlug = (slugEditVal ? makeSlug(slugEditVal) : null) || chosenSlug || makeSlug(name);
  if (!slugAvailable || !finalSlug) {
    alertEl.innerHTML = '<div class="alert alert-error">Please select an available URL from the options below your name.</div>';
    btn.disabled = false; btn.textContent = 'Create DJ Account'; return;
  }
  const { data: existing } = await db.from('users').select('id').eq('slug', finalSlug).limit(1);
  if (existing && existing.length > 0) {
    alertEl.innerHTML = '<div class="alert alert-error">That URL was just taken. Please pick another.</div>';
    btn.disabled = false; btn.textContent = 'Create DJ Account'; return;
  }
  try {
    const email = document.getElementById('dj-email').value.toLowerCase();
    const { data: signUpData, error } = await db.auth.signUp({
      email,
      password: document.getElementById('dj-password').value,
      options: {
        emailRedirectTo: window.location.origin + '/account-settings.html?emailverified=1',
        data: {
          role: 'dj',
          name,
          slug: finalSlug,
          dj_type: djType,
          country: document.getElementById('dj-country').value || document.getElementById('dj-country-select').value,
          city: document.getElementById('dj-city').value,
          state: document.getElementById('dj-state').value,
          travel_distance: travelRaw,
          zip: document.getElementById('dj-zip').value
        }
      }
    });
    if (error) {
      if (/already registered|already been registered|User already/i.test(error.message)) {
        throw new Error('An account with this email already exists. Please log in instead.');
      }
      if (/duplicate key.*slug/i.test(error.message)) {
        throw new Error('That URL was just taken. Please pick another.');
      }
      throw error;
    }
    // Detect duplicate email (Supabase's enumeration protection returns empty identities)
    if (signUpData && signUpData.user && Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
      throw new Error('An account with this email already exists. Please log in instead.');
    }

    // Ensure public.users row has all the DJ fields (the auth trigger
    // doesn't carry over everything reliably). Upsert directly.
    if (signUpData && signUpData.user && signUpData.user.id) {
      try {
        // Preserve 'worldwide' string; numeric distances stored as their integer value.
        // Column is text, so either string is valid.
        const travelVal = travelRaw === 'worldwide' ? 'worldwide' : (parseInt(travelRaw, 10) || null);
        await db.from('users').upsert({
          id: signUpData.user.id,
          role: 'dj',
          name: name,
          slug: finalSlug,
          dj_type: djType,
          country: document.getElementById('dj-country').value || document.getElementById('dj-country-select').value,
          city: document.getElementById('dj-city').value,
          state: document.getElementById('dj-state').value,
          travel_distance: travelVal,
          zip: document.getElementById('dj-zip').value,
          email_verified: false
        }, { onConflict: 'id' });
      } catch (e) { console.warn('[signup] dj upsert failed (non-fatal):', e); }
    }

    // Clear auto-confirmed flag + send verification email
    if (signUpData && signUpData.user && signUpData.user.id) {
      await triggerSignupVerification(signUpData.user.id, email, 'dj', finalSlug);
    }

    showWelcomeAndRedirect(email, 'dj', finalSlug);
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    btn.disabled = false; btn.textContent = 'Create DJ Account';
  }
});

// ── HOST FORM SUBMIT ────────────────────────────────────
document.getElementById('form-host').addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = document.getElementById('submit-host');
  const alertEl = document.getElementById('alert');
  btn.disabled = true; btn.textContent = 'Creating Account...'; alertEl.innerHTML = '';
  const name = document.getElementById('host-name').value.trim();
  const email = document.getElementById('host-email').value.trim();
  const password = document.getElementById('host-password').value;
  const country = document.getElementById('host-country').value;
  if (!name || !email || !password || !country) {
    alertEl.innerHTML = '<div class="alert alert-error">Please fill in all fields.</div>';
    btn.disabled = false; btn.textContent = 'Create Host Account'; return;
  }
  if (password.length < 8) {
    alertEl.innerHTML = '<div class="alert alert-error">Password must be at least 8 characters.</div>';
    btn.disabled = false; btn.textContent = 'Create Host Account'; return;
  }
  try {
    const emailLower = email.toLowerCase();
    const { data: signUpData, error } = await db.auth.signUp({
      email: emailLower,
      password,
      options: {
        emailRedirectTo: window.location.origin + '/account-settings.html?emailverified=1',
        data: { role: 'host', name, country }
      }
    });
    if (error) {
      if (/already registered|already been registered|User already/i.test(error.message)) {
        throw new Error('An account with this email already exists. Please log in instead.');
      }
      throw error;
    }
    if (signUpData && signUpData.user && Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
      throw new Error('An account with this email already exists. Please log in instead.');
    }

    // Ensure public.users row has all the host fields (the auth trigger
    // doesn't always carry over country). Upsert directly so the settings
    // page can populate properly.
    if (signUpData && signUpData.user && signUpData.user.id) {
      try {
        await db.from('users').upsert({
          id: signUpData.user.id,
          role: 'host',
          name: name,
          country: country,
          email_verified: false
        }, { onConflict: 'id' });
      } catch (e) { console.warn('[signup] host upsert failed (non-fatal):', e); }
    }

    // Send verification email (token-based, fully under our control)
    if (signUpData && signUpData.user && signUpData.user.id) {
      await triggerSignupVerification(signUpData.user.id, emailLower, 'host', null);
    }

    showWelcomeAndRedirect(emailLower, 'host');
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    btn.disabled = false; btn.textContent = 'Create Host Account';
  }
});

// ── VENUE FORM SUBMIT ───────────────────────────────────
document.getElementById('form-venue').addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = document.getElementById('submit-venue');
  const alertEl = document.getElementById('alert');
  btn.disabled = true; btn.textContent = 'Creating Account...'; alertEl.innerHTML = '';
  const venueName = document.getElementById('venue-name').value.trim();
  const email = document.getElementById('venue-email').value.trim();
  const password = document.getElementById('venue-password').value;
  const country = document.getElementById('venue-country').value;
  const zip = document.getElementById('venue-zip').value.trim();
  if (!venueName || !email || !password || !country || !zip) {
    alertEl.innerHTML = '<div class="alert alert-error">Please fill in all fields.</div>';
    btn.disabled = false; btn.textContent = 'Create Venue Account'; return;
  }
  if (password.length < 8) {
    alertEl.innerHTML = '<div class="alert alert-error">Password must be at least 8 characters.</div>';
    btn.disabled = false; btn.textContent = 'Create Venue Account'; return;
  }
  try {
    const emailLower = email.toLowerCase();
    // Use chosen alternative slug if selected, otherwise generate from venue name
    const venueEditVal = document.getElementById('venue-slug-edit').value.trim();
    const chosenVenueSlug = (venueEditVal ? makeSlug(venueEditVal) : null) || document.getElementById('venue-name').dataset.chosenSlug;
    let baseSlug = venueName.toLowerCase().trim().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'') || 'venue-' + Date.now();
    let venueSlug = chosenVenueSlug || baseSlug; let slugSuffix = 2;
    while (true) {
      const { data: ex } = await db.from('users').select('id').eq('slug', venueSlug).limit(1);
      if (!ex || ex.length === 0) break;
      venueSlug = baseSlug + '-' + slugSuffix++;
    }
    const { data: signUpData, error } = await db.auth.signUp({
      email: emailLower,
      password,
      options: {
        emailRedirectTo: window.location.origin + '/account-settings.html?emailverified=1',
        data: {
          role: 'venue',
          name: venueName,
          venue_name: venueName,
          slug: venueSlug,
          country,
          zip
        }
      }
    });
    if (error) {
      if (/already registered|already been registered|User already/i.test(error.message)) {
        throw new Error('An account with this email already exists. Please log in instead.');
      }
      if (/duplicate key.*slug/i.test(error.message)) {
        throw new Error('That URL was just taken. Please try again.');
      }
      throw error;
    }
    if (signUpData && signUpData.user && Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
      throw new Error('An account with this email already exists. Please log in instead.');
    }

    // Ensure public.users row has all the venue fields
    if (signUpData && signUpData.user && signUpData.user.id) {
      try {
        await db.from('users').upsert({
          id: signUpData.user.id,
          role: 'venue',
          name: venueName,
          venue_name: venueName,
          slug: venueSlug,
          country: country,
          zip: zip,
          email_verified: false
        }, { onConflict: 'id' });
      } catch (e) { console.warn('[signup] venue upsert failed (non-fatal):', e); }
    }

    // Send verification email (token-based, fully under our control)
    if (signUpData && signUpData.user && signUpData.user.id) {
      await triggerSignupVerification(signUpData.user.id, emailLower, 'venue', venueSlug);
    }

    showWelcomeAndRedirect(emailLower, 'venue', venueSlug);
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    btn.disabled = false; btn.textContent = 'Create Venue Account';
  }
});

