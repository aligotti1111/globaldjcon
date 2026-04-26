// EMBED CODE: generate calendar embed snippet + live preview for the DJ
// Loaded on update-dj-profile.html, runs after the user's profile is loaded
// so currentUser.slug is available.

(function () {
  // Build the embed snippet for the current settings.
  // We use the direct embed-calendar.html URL (not the pretty /embed/ rewrite)
  // because Netlify's _redirects rule can drop query params when the source URL
  // already has its own. The explicit URL bypasses that ambiguity.
  function buildEmbedSnippet(slug, months, theme, height) {
    const src = `https://globaldjconnect.com/embed-calendar.html?slug=${encodeURIComponent(slug)}&theme=${theme}&months=${months}`;
    return (
      `<!-- Global DJ Connect — availability calendar -->\n` +
      `<iframe id="gdc-cal-${slug}" src="${src}" ` +
      `style="width:100%;height:${height}px;border:0;display:block;" ` +
      `loading="lazy" title="DJ Availability Calendar"></iframe>\n` +
      `<script>\n` +
      `(function(){window.addEventListener('message',function(e){` +
      `if(e.data&&e.data.type==='gdc-embed-height'&&e.data.slug==='${slug}'){` +
      `var f=document.getElementById('gdc-cal-${slug}');if(f)f.style.height=e.data.height+'px';}});` +
      `})();\n` +
      `<\/script>`
    );
  }

  // Update the textarea + live preview iframe whenever a control changes.
  window.updateEmbedCode = function () {
    const slug = (window.currentUser && window.currentUser.slug) || '';
    if (!slug) return;
    const months = 1; // Embeds always 1 month — keeps iframe height sensible
    const theme = document.getElementById('embed-theme').value;
    const height = document.getElementById('embed-height').value;
    const code = buildEmbedSnippet(slug, months, theme, height);
    const out = document.getElementById('embed-code-output');
    if (out) out.value = code;
    const preview = document.getElementById('embed-preview-iframe');
    if (preview) {
      preview.src = `/embed-calendar.html?slug=${encodeURIComponent(slug)}&theme=${theme}&months=${months}`;
      preview.style.height = height + 'px';
    }
  };

  // Copy-to-clipboard with button feedback
  window.copyEmbedCode = function () {
    const out = document.getElementById('embed-code-output');
    const btn = document.getElementById('embed-copy-btn');
    if (!out || !btn) return;
    out.select();
    try {
      navigator.clipboard.writeText(out.value).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = 'var(--success)';
        setTimeout(() => { btn.textContent = orig; btn.style.background = 'var(--neon)'; }, 1600);
      });
    } catch (e) {
      // Fallback for older browsers
      try { document.execCommand('copy'); btn.textContent = 'Copied!'; } catch (_) {}
    }
  };

  // Listen for resize messages from the live preview so it auto-fits its content
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'gdc-embed-height') {
      const preview = document.getElementById('embed-preview-iframe');
      if (preview && e.data.slug === ((window.currentUser && window.currentUser.slug) || '')) {
        preview.style.height = e.data.height + 'px';
      }
    }
  });

  // Initial population — wait for auth.js to resolve currentUser.
  // Prefer GDJAuth.ready (the official hook) over polling.
  function init() {
    if (window.currentUser && window.currentUser.slug) {
      updateEmbedCode();
    }
  }
  if (window.GDJAuth && typeof window.GDJAuth.ready === 'function') {
    window.GDJAuth.ready(init);
  } else {
    // Fallback for any environment where GDJAuth isn't loaded yet — listen
    // for the userChanged event auth.js fires whenever currentUser is set
    document.addEventListener('GDJAuth:userChanged', init);
    // And try immediately in case it's already loaded
    init();
  }
})();
