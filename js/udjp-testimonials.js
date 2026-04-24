// TESTIMONIALS
// Extracted from update-dj-profile.html

// ── TESTIMONIALS ──────────────────────────────────────────
let testimonialCount = 0;
function addTestimonialField(data = {}) {
  const list = document.getElementById('testimonials-list');
  const current = list.querySelectorAll('.testimonial-card').length;
  if (current >= 5) {
    document.getElementById('add-testimonial-btn').style.display = 'none';
    return;
  }
  const id = 'tc-' + (++testimonialCount);
  const card = document.createElement('div');
  card.className = 'testimonial-card';
  card.id = id;
  card.innerHTML = `
    <button type="button" class="remove-btn" onclick="removeTestimonial('${id}')">✕</button>
    <label>Client Name</label>
    <input type="text" class="t-name" placeholder="Jane Smith" value="${data.name||''}">
    <label>Date of Event</label>
    <input type="text" class="t-date" placeholder="e.g. June 2024" value="${data.date||''}">
    <label>Testimonial</label>
    <textarea class="t-blurb" placeholder="Write what the client said...">${data.blurb||''}</textarea>`;
  list.appendChild(card);
  const count = list.querySelectorAll('.testimonial-card').length;
  document.getElementById('add-testimonial-btn').style.display = count >= 5 ? 'none' : '';
  formDirty = true;
}
function removeTestimonial(id) {
  document.getElementById(id).remove();
  document.getElementById('add-testimonial-btn').style.display = '';
  formDirty = true;
}
function collectTestimonials() {
  const cards = document.querySelectorAll('.testimonial-card');
  if (!cards.length) return null;
  const list = Array.from(cards).map(c => ({
    name: c.querySelector('.t-name').value.trim(),
    date: c.querySelector('.t-date').value.trim(),
    blurb: c.querySelector('.t-blurb').value.trim()
  })).filter(t => t.name || t.blurb);
  return list.length ? JSON.stringify(list) : null;
}

