// VENUE SLUG: slug timeouts, name input, alternatives, availability
// Extracted from signup.html

// ── VENUE URL PREVIEW ────────────────────────────────────
let venueSlugCheckTimeout = null;
let venueSlugAvailableSignup = false;
function onVenueNameInput(val) {
  const slug = makeSlug(val);
  const preview = document.getElementById('venue-url-preview');
  if (!slug) { preview.classList.remove('visible'); return; }
  preview.classList.add('visible');
  const editField = document.getElementById('venue-slug-edit');
  if (!editField.dataset.manualEdit) editField.value = slug;
  checkVenueSlugEdit(editField.value || slug);
}

function checkVenueSlugEdit(slug) {
  const statusEl = document.getElementById('venue-url-status');
  const altsContainer = document.getElementById('venue-slug-alternatives');
  const editField = document.getElementById('venue-slug-edit');
  if (!slug) { statusEl.textContent = ''; venueSlugAvailableSignup = false; return; }
  altsContainer.classList.remove('visible');
  statusEl.textContent = 'Checking...';
  statusEl.className = 'url-status checking';
  venueSlugAvailableSignup = false;
  clearTimeout(venueSlugCheckTimeout);
  venueSlugCheckTimeout = setTimeout(async () => {
    const { data } = await db.from('users').select('id').eq('slug', slug).limit(1);
    if (data && data.length > 0) {
      statusEl.textContent = 'Taken'; statusEl.className = 'url-status taken';
      editField.style.borderColor = 'var(--error)';
      venueSlugAvailableSignup = false;
      checkAndRenderVenueAlternatives(slug);
    } else {
      statusEl.textContent = 'Available ✓'; statusEl.className = 'url-status available';
      editField.style.borderColor = 'var(--success)';
      venueSlugAvailableSignup = true;
      document.getElementById('venue-name').dataset.chosenSlug = slug;
      altsContainer.classList.remove('visible');
    }
  }, 500);
}

function onVenueSlugEditInput(val) {
  document.getElementById('venue-slug-edit').dataset.manualEdit = '1';
  checkVenueSlugEdit(makeSlug(val));
}

// ── VENUE URL ALTERNATIVES ───────────────────────────────
function generateVenueAlternatives(slug) {
  return [...new Set([
    slug + '-venue', slug + '-events', slug + '-official',
    slug + '-nyc', slug + '-' + new Date().getFullYear(), slug + '-club'
  ])].filter(s => s !== slug && s.length > 0).slice(0, 6);
}
async function checkAndRenderVenueAlternatives(slug) {
  const altsContainer = document.getElementById('venue-slug-alternatives');
  const altsEl = document.getElementById('venue-slug-alt-options');
  const candidates = generateVenueAlternatives(slug);
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
        venueSlugAvailableSignup = true;
        const chosen = this.dataset.slug;
        document.getElementById('venue-preview-url').textContent = BASE_URL + chosen;
        document.getElementById('venue-preview-url').className = 'url available';
        document.getElementById('venue-url-status').textContent = 'Available ✓';
        document.getElementById('venue-url-status').className = 'url-status available';
        // Store chosen slug for use at submit
        document.getElementById('venue-slug-edit').value = chosen;
        document.getElementById('venue-slug-edit').style.borderColor = 'var(--success)';
        document.getElementById('venue-name').dataset.chosenSlug = chosen;
      });
    }
  }
}

