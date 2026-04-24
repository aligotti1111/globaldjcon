// IMAGES: crop modal + avatar/gallery upload
// Extracted from update-dj-profile.html

// ── IMAGE UPLOAD & CROP ─────────────────────────────────
const BUCKET = 'avatars';
const STORAGE_URL = SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/';
const PUBLIC_URL  = SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/';

// ── CROP LOGIC ───────────────────────────────────────────
let cropImage = null, cropX = 0, cropY = 0, cropScale = 1;
let cropDragging = false, cropLastX = 0, cropLastY = 0;

function openCropModal(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      cropImage = img;
      cropScale = 1;
      document.getElementById('crop-zoom').value = 1;
      // Show modal FIRST so offsetWidth is valid
      document.getElementById('crop-modal').classList.add('active');
      // Then draw on next frame
      requestAnimationFrame(() => {
        const wrap = document.getElementById('crop-wrap');
        const size = wrap.offsetWidth;
        cropX = (size - img.width) / 2;
        cropY = (size - img.height) / 2;
        // Scale image to fill the crop circle on open
        const minFit = (size * 0.8) / Math.min(img.width, img.height);
        if (minFit > 1) {
          cropScale = minFit;
          document.getElementById('crop-zoom').value = Math.min(minFit, 3);
          cropX = (size - img.width * cropScale) / 2;
          cropY = (size - img.height * cropScale) / 2;
        }
        cropDraw();
      });
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function cropDraw() {
  const wrap = document.getElementById('crop-wrap');
  const canvas = document.getElementById('crop-canvas');
  const size = wrap.offsetWidth;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  if (!cropImage) return;
  const s = cropScale;
  const w = cropImage.width * s, h = cropImage.height * s;
  ctx.drawImage(cropImage, cropX, cropY, w, h);
}

function cropDragStart(e) {
  cropDragging = true;
  cropLastX = e.clientX; cropLastY = e.clientY;
}
function cropDragMove(e) {
  if (!cropDragging) return;
  cropX += e.clientX - cropLastX;
  cropY += e.clientY - cropLastY;
  cropLastX = e.clientX; cropLastY = e.clientY;
  cropDraw();
}
function cropDragEnd() { cropDragging = false; }
function cropTouchStart(e) { e.preventDefault(); const t = e.touches[0]; cropDragging = true; cropLastX = t.clientX; cropLastY = t.clientY; }
function cropTouchMove(e) { e.preventDefault(); const t = e.touches[0]; cropX += t.clientX - cropLastX; cropY += t.clientY - cropLastY; cropLastX = t.clientX; cropLastY = t.clientY; cropDraw(); }

document.getElementById('crop-zoom').addEventListener('input', function() {
  const wrap = document.getElementById('crop-wrap');
  const size = wrap.offsetWidth;
  const centerX = size / 2;
  const centerY = size / 2;
  const oldScale = cropScale;
  const newScale = parseFloat(this.value);
  // Adjust position so zoom anchors to canvas center
  cropX = centerX - (centerX - cropX) * (newScale / oldScale);
  cropY = centerY - (centerY - cropY) * (newScale / oldScale);
  cropScale = newScale;
  cropDraw();
});

function closeCropModal() {
  document.getElementById('crop-modal').classList.remove('active');
  document.getElementById('avatar-file').value = '';
}

async function applyCrop() {
  const wrap = document.getElementById('crop-wrap');
  const size = wrap.offsetWidth;
  // Export circle crop: 80% of canvas size
  const cropSize = size * 0.8;
  const offset = size * 0.1;
  const out = document.createElement('canvas');
  out.width = 400; out.height = 400;
  const ctx = out.getContext('2d');
  // Clip to circle
  ctx.beginPath();
  ctx.arc(200, 200, 200, 0, Math.PI * 2);
  ctx.clip();
  // Scale source from crop-wrap coords to 400x400 output
  const scale = 400 / cropSize;
  ctx.drawImage(
    document.getElementById('crop-canvas'),
    offset, offset, cropSize, cropSize,
    0, 0, 400, 400
  );

  document.getElementById('crop-modal').classList.remove('active');

  // Show uploading state
  const topInfo = document.getElementById('avatar-top-info');
  topInfo.innerHTML = '<strong>Profile Photo</strong><span class="uploading-txt" style="color:#ffb347;">Uploading...</span>';

  out.toBlob(async blob => {
    try {
      const path = currentUser.id + '/avatar.png';
      const res = await fetch(STORAGE_URL + path, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'apikey': SUPABASE_KEY,
          'Content-Type': 'image/png',
          'x-upsert': 'true'
        },
        body: blob
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Upload failed'); }
      const publicUrl = PUBLIC_URL + path + '?t=' + Date.now();
      document.getElementById('avatar_url').value = publicUrl;
      // Programmatic .value sets don't fire change events, so flag dirty manually.
      formDirty = true;
      // Show in circle
      const img = document.getElementById('avatar-img');
      img.src = publicUrl;
      img.style.display = 'block';
      document.getElementById('avatar-initials').style.display = 'none';
      document.getElementById('avatar-circle').classList.add('has-photo');
      topInfo.innerHTML = '<strong>Profile Photo</strong><span style="color:#3ddc84;">✓ Photo updated</span>';
      setTimeout(() => {
        topInfo.innerHTML = '<strong>Profile Photo</strong><span>Click to change</span>';
      }, 3000);
    } catch(err) {
      topInfo.innerHTML = '<strong>Profile Photo</strong><span style="color:#ff5f5f;">✗ ' + err.message + '</span>';
    }
  }, 'image/png');
}

// ── GALLERY UPLOAD ───────────────────────────────────────
async function handleUpload(input, filename, hiddenId, previewId, statusId) {
  const file = input.files[0];
  if (!file) return;
  if (!currentUser) return;
  // Gallery uploads require a verified email. Profile-pic upload (openCropModal)
  // is intentionally not gated so users can personalize while their email is
  // pending verification.
  if (window.GDJAuth && !window.GDJAuth.requireVerifiedEmail('upload gallery photos')) {
    input.value = ''; // clear the file input so the chooser reopens cleanly next time
    return;
  }
  const ext = file.name.split('.').pop().toLowerCase();
  const path = currentUser.id + '/' + filename + '.' + ext;
  const statusEl = document.getElementById(statusId);
  const previewEl = document.getElementById(previewId);
  statusEl.textContent = 'Uploading...';
  statusEl.className = 'upload-status uploading';
  try {
    const res = await fetch(STORAGE_URL + path, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'apikey': SUPABASE_KEY,
        'Content-Type': file.type,
        'x-upsert': 'true'
      },
      body: file
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Upload failed'); }
    const publicUrl = PUBLIC_URL + path + '?t=' + Date.now();
    document.getElementById(hiddenId).value = publicUrl;
    // Programmatic .value sets don't fire change events, so flag dirty manually.
    formDirty = true;
    const img = previewEl.querySelector('img');
    img.src = publicUrl;
    previewEl.classList.add('visible');
    previewEl.closest('.upload-box').classList.add('has-image');
    const placeholder = previewEl.closest('.upload-box').querySelector('.upload-placeholder');
    if (placeholder) placeholder.style.display = 'none';
    statusEl.textContent = '✓ Uploaded';
    statusEl.className = 'upload-status done';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  } catch (err) {
    statusEl.textContent = '✗ ' + err.message;
    statusEl.className = 'upload-status error';
  }
}

function loadExistingImage(url, previewId, hiddenId) {
  if (!url) return;
  document.getElementById(hiddenId).value = url;
  const previewEl = document.getElementById(previewId);
  const img = previewEl.querySelector('img');
  img.src = url;
  previewEl.classList.add('visible');
  previewEl.closest('.upload-box').classList.add('has-image');
  const placeholder = previewEl.closest('.upload-box').querySelector('.upload-placeholder');
  if (placeholder) placeholder.style.display = 'none';
}

function loadAvatarPreview(url) {
  if (!url) return;
  document.getElementById('avatar_url').value = url;
  const img = document.getElementById('avatar-img');
  img.onload = function() {
    img.style.display = 'block';
    document.getElementById('avatar-initials').style.display = 'none';
  };
  img.src = url;
  // Also set immediately in case already cached
  if (img.complete && img.naturalWidth > 0) {
    img.style.display = 'block';
    document.getElementById('avatar-initials').style.display = 'none';
  }
  document.getElementById('avatar-top-info').innerHTML = '<strong>Profile Photo</strong><span>Click to change</span>';
}
// Wait for auth.js to resolve the session before deciding where to send the user.
// auth.js may be hydrating window.currentUser from a Supabase Auth session that

