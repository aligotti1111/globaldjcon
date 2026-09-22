// Allowlist sanitizer for the DJ "About" rich-text bio.
//
// The bio editor lets the owner apply bold / italic / underline / color /
// size / font to their own text. That produces a small set of inline HTML
// (b, i, u, span with a style attr). Because the result is rendered on the
// public profile, we strip everything outside a strict allowlist so a
// malicious owner can't inject <script>, event handlers, or javascript:
// URLs that would run in a visitor's browser.
//
// Runs in both the browser (before save) and on the server (at render),
// so it is pure string processing — no DOM APIs.

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'SPAN', 'BR', 'P', 'DIV', 'A']);
const ALLOWED_STYLE_PROPS = [
  'color',
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-align',
];

export function sanitizeBioHtml(html: string | null | undefined): string {
  if (!html) return '';

  // Drop comments and any inherently dangerous elements outright.
  let out = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(?:script|style|iframe|object|embed|link|meta|svg|math)\b[^>]*>/gi, '');

  // Walk every tag; keep only allowlisted ones with a sanitized attr set.
  out = out.replace(/<(\/?)([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (_m, slash: string, tag: string, attrs: string) => {
    const upper = tag.toUpperCase();
    if (!ALLOWED_TAGS.has(upper)) return '';
    if (slash) return `</${tag.toLowerCase()}>`;

    let safeAttrs = '';

    // style="" — keep only allowlisted, url()/expression-free declarations.
    const styleMatch = attrs.match(/style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i);
    if (styleMatch) {
      const raw = styleMatch[1] ?? styleMatch[2] ?? '';
      const decls = raw
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .filter((d) => {
          const idx = d.indexOf(':');
          if (idx === -1) return false;
          const prop = d.slice(0, idx).trim().toLowerCase();
          const val = d.slice(idx + 1).trim().toLowerCase();
          if (!ALLOWED_STYLE_PROPS.includes(prop)) return false;
          if (/url\s*\(|expression|javascript:|@import/i.test(val)) return false;
          return true;
        });
      if (decls.length) safeAttrs += ` style="${decls.join('; ')}"`;
    }

    // href="" on <a> — only http/https/mailto.
    if (upper === 'A') {
      const hrefMatch = attrs.match(/href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i);
      if (hrefMatch) {
        const href = (hrefMatch[1] ?? hrefMatch[2] ?? '').trim();
        if (/^(https?:|mailto:)/i.test(href)) {
          safeAttrs += ` href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer"`;
        }
      }
    }

    return `<${tag.toLowerCase()}${safeAttrs}>`;
  });

  return out;
}
