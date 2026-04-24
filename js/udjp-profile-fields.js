// PROFILE FIELDS: zip lookup + slug logic
// Extracted from update-dj-profile.html

// ── ZIP LOOKUP ───────────────────────────────────────────
let zipTimeout = null;
function updateZipPlaceholder(country) {
  const map = {
    'United States': 'e.g. 10001',
    'United Kingdom': 'e.g. SW1A 1AA',
    'Canada': 'e.g. M5V 3A8',
    'Australia': 'e.g. 2000',
    'Germany': 'e.g. 10115',
    'France': 'e.g. 75001',
    'Netherlands': 'e.g. 1011 AB',
    'Spain': 'e.g. 28001',
    'Italy': 'e.g. 00100',
    'Brazil': 'e.g. 01310-100',
    'Mexico': 'e.g. 06600',
    'Japan': 'e.g. 100-0001',
    'South Africa': 'e.g. 8001',
    'New Zealand': 'e.g. 1010',
    'Ireland': 'e.g. D01 F5P2',
    'Sweden': 'e.g. 111 21',
    'Norway': 'e.g. 0150',
    'Denmark': 'e.g. 1050',
    'Belgium': 'e.g. 1000',
    'Switzerland': 'e.g. 8001',
    'Portugal': 'e.g. 1100-001',
  };
  const input = document.getElementById('zip');
  if (input) input.placeholder = map[country] || 'Zip / Postal Code';
}

function lookupZip(zip) {
  const resultEl = document.getElementById('zip-lookup-result');
  clearTimeout(zipTimeout);
  if (!zip || zip.length < 4) { resultEl.textContent = ''; return; }
  zipTimeout = setTimeout(async () => {
    resultEl.textContent = 'Looking up...';
    try {
      const countrySelect = document.getElementById('country-select');
      const selectedOption = countrySelect ? countrySelect.options[countrySelect.selectedIndex] : null;
      const countryCode = selectedOption ? selectedOption.dataset.code : '';
      const countryName = selectedOption ? selectedOption.value : '';
      const url = countryCode
        ? `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&countrycodes=${countryCode}&format=json&limit=1&addressdetails=1`
        : `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&format=json&limit=1&addressdetails=1`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data[0]) {
        const addr = data[0].address;
        const displayName = data[0].display_name || '';
        // For NYC boroughs, Nominatim often only has county — extract borough from display_name
        const nycBoroughs = ['Staten Island','Brooklyn','Queens','The Bronx','Manhattan'];
        const boroughMatch = nycBoroughs.find(b => displayName.includes(b));
        const city = boroughMatch
          || addr.city_district
          || (addr.suburb && addr.city && addr.suburb !== addr.city ? addr.suburb : null)
          || addr.town
          || addr.city
          || addr.municipality
          || addr.village
          || addr.hamlet
          || '';
        const state = addr.state || '';
        const country = countryName || addr.country || '';
        document.getElementById('city').value = city;
        document.getElementById('state').value = state;
        document.getElementById('country').value = country;
        resultEl.style.color = 'var(--neon)';
        resultEl.textContent = [city, state].filter(Boolean).join(', ');
      } else {
        resultEl.style.color = 'var(--muted)';
        resultEl.textContent = 'Zip not found — location will not display';
      }
    } catch(e) {
      resultEl.textContent = '';
    }
  }, 600);
}


const BASE_URL = 'globaldjconnect.com/';
let slugCheckTimeout = null;
let chosenSlug = null;
let slugAvailable = false;
let originalSlug = null; // loaded from DB — skip availability check if unchanged

function makeSlug(val) {
  return (val || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || null;
}

function generateAlternatives(slug) {
  const parts = slug.split('-');
  return [...new Set([
    parts.join('_'), parts.join(''), parts.join('.'),
    slug.startsWith('dj-') ? slug : 'dj-' + slug,
    slug + '-official', slug + '-music', slug + '-mixes'
  ])].filter(s => s !== slug && s.length > 0).slice(0, 6);
}

async function checkAndRenderAlternatives(slug) {
  const altsContainer = document.getElementById('slug-alternatives');
  const altsEl = document.getElementById('slug-alt-options');
  const candidates = generateAlternatives(slug);
  altsEl.innerHTML = candidates.map(s =>
    `<button type="button" class="slug-alt-btn checking" data-slug="${s}">${BASE_URL}${s}</button>`
  ).join('');
  altsContainer.classList.add('visible');
  for (const candidate of candidates) {
    const btn = altsEl.querySelector(`[data-slug="${candidate}"]`);
    const { data } = await db.from('users').select('id').eq('slug', candidate).limit(1);
    if (data && data.length > 0) {
      btn.classList.remove('checking'); btn.classList.add('taken'); btn.disabled = true;
    } else {
      btn.classList.remove('checking');
      btn.addEventListener('click', function() {
        altsEl.querySelectorAll('.slug-alt-btn').forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
        chosenSlug = this.dataset.slug;
        slugAvailable = true;
        document.getElementById('slug-input').value = chosenSlug;
        document.getElementById('preview-url').textContent = BASE_URL + chosenSlug;
        document.getElementById('preview-url').className = 'url available';
        document.getElementById('url-status').textContent = 'Available ✓';
        document.getElementById('url-status').className = 'url-status available';
        document.getElementById('slug-hint').textContent = chosenSlug;
      });
    }
  }
}

document.getElementById('slug-input').addEventListener('input', function() {
  const raw = this.value;
  const slug = makeSlug(raw);
  const preview = document.getElementById('url-preview');
  const previewUrl = document.getElementById('preview-url');
  const statusEl = document.getElementById('url-status');
  const altsContainer = document.getElementById('slug-alternatives');
  const hintEl = document.getElementById('slug-hint');

  if (!slug) {
    preview.classList.remove('visible');
    altsContainer.classList.remove('visible');
    chosenSlug = null; slugAvailable = false;
    hintEl.textContent = 'your-url';
    return;
  }

  chosenSlug = slug;
  hintEl.textContent = slug;
  preview.classList.add('visible');
  altsContainer.classList.remove('visible');
  previewUrl.textContent = BASE_URL + slug;
  previewUrl.className = 'url';

  // If slug hasn't changed from what's in the DB, mark as available immediately
  if (slug === originalSlug) {
    statusEl.textContent = 'Current URL ✓';
    statusEl.className = 'url-status available';
    slugAvailable = true;
    return;
  }

  statusEl.textContent = 'Checking...';
  statusEl.className = 'url-status checking';
  slugAvailable = false;

  clearTimeout(slugCheckTimeout);
  slugCheckTimeout = setTimeout(async () => {
    const { data } = await db.from('users').select('id').eq('slug', slug).limit(1);
    if (data && data.length > 0) {
      previewUrl.className = 'url taken';
      statusEl.textContent = 'Taken';
      statusEl.className = 'url-status taken';
      chosenSlug = null; slugAvailable = false;
      checkAndRenderAlternatives(slug);
    } else {
      previewUrl.className = 'url available';
      statusEl.textContent = 'Available ✓';
      statusEl.className = 'url-status available';
      chosenSlug = slug; slugAvailable = true;
      altsContainer.classList.remove('visible');
    }
  }, 500);
});





// Open Format exclusivity & max 7 genres

