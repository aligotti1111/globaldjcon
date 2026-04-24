// ZIP: country placeholder + zip lookup
// Extracted from signup.html

// ── ZIP LOOKUP (SIGNUP) ──────────────────────────────────
let signupZipTimeout = null;
// ── ZIP PLACEHOLDER BY COUNTRY ──────────────────────────
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
  const input = document.getElementById('dj-zip');
  if (input) input.placeholder = map[country] || 'Zip / Postal Code';
}

// ── ZIP LOOKUP ──────────────────────────────────────────
function lookupSignupZip(zip) {
  const resultEl = document.getElementById('signup-zip-result');
  clearTimeout(signupZipTimeout);
  if (!zip || zip.length < 4) { resultEl.textContent = ''; return; }
  signupZipTimeout = setTimeout(async () => {
    resultEl.textContent = 'Looking up...';
    try {
      const countrySelect = document.getElementById('dj-country-select');
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
        document.getElementById('dj-city').value = city;
        document.getElementById('dj-state').value = state;
        document.getElementById('dj-country').value = country;
        resultEl.style.color = '#3ddc84';
        resultEl.textContent = [city, state, country].filter(Boolean).join(', ');
      } else {
        resultEl.style.color = '#6b6b88';
        resultEl.textContent = 'Zip not found';
      }
    } catch(e) { resultEl.textContent = ''; }
  }, 600);
}

