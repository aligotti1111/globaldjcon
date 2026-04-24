// CREATE: lookupZip + createAccount + creds modal
// Extracted from admin.html

document.getElementById('f-slug').addEventListener('input', (e) => {
  const s = (e.target.value || '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  document.getElementById('slug-preview').textContent = s || 'your-slug';
});

// Zip lookup (Nominatim)
let zipTimeout = null;
function lookupZip(zip) {
  const result = document.getElementById('zip-result');
  clearTimeout(zipTimeout);
  if (!zip || zip.length < 4) { result.textContent = ''; return; }
  result.style.color = 'var(--amber)';
  result.textContent = 'Looking up...';
  zipTimeout = setTimeout(async () => {
    try {
      const select = document.getElementById('f-country');
      const opt = select.options[select.selectedIndex];
      const countryCode = opt ? opt.dataset.code : '';
      const url = countryCode
        ? `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&countrycodes=${countryCode}&format=json&limit=1&addressdetails=1`
        : `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&format=json&limit=1&addressdetails=1`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data[0]) {
        const addr = data[0].address;
        const city = addr.suburb || addr.city || addr.town || addr.village || addr.county || '';
        const state = addr.state || '';
        document.getElementById('f-city').value = city;
        document.getElementById('f-state').value = state;
        result.style.color = 'var(--success)';
        result.textContent = [city, state].filter(Boolean).join(', ');
      } else {
        result.style.color = 'var(--muted)';
        result.textContent = 'Zip not found';
      }
    } catch(e) { result.textContent = ''; }
  }, 600);
}

async function createAccount() {
  const btn = document.getElementById('create-btn');
  const fb = document.getElementById('create-fb');
  const name = document.getElementById('f-name').value.trim();
  const slug = document.getElementById('f-slug').value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  const country = document.getElementById('f-country').value;
  const city = document.getElementById('f-city').value.trim();
  const state = document.getElementById('f-state').value.trim();
  const zip = document.getElementById('f-zip').value.trim();
  const venue_name = document.getElementById('f-venue-name').value.trim();
  const address = document.getElementById('f-address').value.trim();

  if (!name) { fb.textContent = '⚠ Name is required'; fb.className = 'form-fb err'; return; }
  if (!country) { fb.textContent = '⚠ Country is required'; fb.className = 'form-fb err'; return; }
  if ((currentRole === 'dj' || currentRole === 'venue') && !slug) {
    fb.textContent = '⚠ Slug is required'; fb.className = 'form-fb err'; return;
  }
  if (currentRole === 'venue' && !venue_name) {
    fb.textContent = '⚠ Venue name is required'; fb.className = 'form-fb err'; return;
  }

  btn.disabled = true; btn.textContent = 'Creating...';
  fb.textContent = ''; fb.className = 'form-fb';

  const payload = {
    role: currentRole,
    name,
    slug: slug || undefined,
    dj_type: currentRole === 'dj' ? (currentType || undefined) : undefined,
    country, city, state, zip,
    phone: document.getElementById('f-phone').value.trim() || undefined,
    website: document.getElementById('f-website').value.trim() || undefined,
    instagram: document.getElementById('f-instagram').value.trim() || undefined,
    soundcloud: document.getElementById('f-soundcloud').value.trim() || undefined,
    venue_name: venue_name || undefined,
    address: address || undefined
  };

  try {
    const result = await adminPost('admin-create-user', payload);
    fb.textContent = '✓ Account created';
    fb.className = 'form-fb ok';

    // Show the creds modal
    const url = slug ? 'https://globaldjconnect.com/' + slug : '(no profile URL)';
    document.getElementById('creds-sub').textContent = name + ' — ' + currentRole.toUpperCase();
    document.getElementById('creds-id').textContent = result.user_id || '—';
    document.getElementById('creds-slug').textContent = slug || '(none)';
    document.getElementById('creds-url').textContent = url;
    document.getElementById('creds-modal').style.display = 'flex';

    resetForm();
    loadStats();
  } catch (err) {
    fb.textContent = '✗ ' + (err.message || 'Failed to create');
    fb.className = 'form-fb err';
    console.error(err);
  } finally {
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

function closeCredsModal() {
  document.getElementById('creds-modal').style.display = 'none';
}

function copyField(id) {
  const text = document.getElementById(id).textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

