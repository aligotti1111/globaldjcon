// DJ SLUG: makeSlug, alternatives, slug-availability, name input listener
// Extracted from signup.html

function makeSlug(name) {
  return (name || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || null;
}

let slugCheckTimeout = null;
let currentSlug = null;
let chosenSlug = null;
let slugAvailable = false;

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
        document.getElementById('slug-edit').value = chosenSlug;
        document.getElementById('slug-edit').style.borderColor = 'var(--success)';
        document.getElementById('url-status').textContent = 'Available ✓';
        document.getElementById('url-status').className = 'url-status available';
      });
    }
  }
}

document.getElementById('name').addEventListener('input', function() {
  const slug = makeSlug(this.value);
  const preview = document.getElementById('url-preview');
  const altsContainer = document.getElementById('slug-alternatives');
  if (!slug) {
    preview.classList.remove('visible'); altsContainer.classList.remove('visible');
    currentSlug = null; chosenSlug = null; slugAvailable = false; return;
  }
  preview.classList.add('visible');
  // Auto-fill slug edit field from name (only if user hasn't manually edited it)
  const editField = document.getElementById('slug-edit');
  if (!editField.dataset.manualEdit) editField.value = slug;
  checkDJSlug(editField.value || slug);
});

function checkDJSlug(slug) {
  const statusEl = document.getElementById('url-status');
  const altsContainer = document.getElementById('slug-alternatives');
  const editField = document.getElementById('slug-edit');
  if (!slug) { statusEl.textContent = ''; slugAvailable = false; return; }
  currentSlug = slug; chosenSlug = slug;
  altsContainer.classList.remove('visible');
  statusEl.textContent = 'Checking...';
  statusEl.className = 'url-status checking';
  slugAvailable = false;
  clearTimeout(slugCheckTimeout);
  slugCheckTimeout = setTimeout(async () => {
    const { data } = await db.from('users').select('id').eq('slug', slug).limit(1);
    if (data && data.length > 0) {
      statusEl.textContent = 'Taken'; statusEl.className = 'url-status taken';
      editField.style.borderColor = 'var(--error)';
      chosenSlug = null; slugAvailable = false;
      checkAndRenderAlternatives(slug);
    } else {
      statusEl.textContent = 'Available ✓'; statusEl.className = 'url-status available';
      editField.style.borderColor = 'var(--success)';
      chosenSlug = slug; slugAvailable = true;
      altsContainer.classList.remove('visible');
    }
  }, 500);
}

function onSlugEditInput(val) {
  document.getElementById('slug-edit').dataset.manualEdit = '1';
  checkDJSlug(makeSlug(val));
}

