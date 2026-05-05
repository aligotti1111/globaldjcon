// Word-level HTML diff utility for tracking package edits in counter offers.
//
// PROBLEM
// When a DJ counters a booking, they edit the package details (HTML
// fragment containing lists, paragraphs, etc.). The host needs to see
// EXACTLY what changed — not just "the DJ edited this", but which words
// were removed and which were added.
//
// APPROACH
// We do a TOKEN-LEVEL diff on the HTML string. Tokens are either:
//   - HTML tags/comments (preserved as-is, treated as opaque atoms)
//   - Whitespace runs (preserved as-is)
//   - Words (compared for equality)
//
// Then we run a classic Longest-Common-Subsequence (LCS) algorithm to
// find what's shared between original and edited, and emit a merged
// HTML string with:
//   - <ins>added text</ins>      for tokens only in edited
//   - <s>removed text</s>        for tokens only in original
//   - tokens unchanged           for tokens in both
//
// The output gets prefixed with <!--GDJ_EDITED--> so consumers know
// to render the diff styling. The legacy <!--GDJ_REMOVED--> footer
// convention is no longer used — diff is now inline.
//
// EDGE CASES
// - Empty original (no prior package): returns the edited HTML wrapped
//   entirely in <ins>...</ins> so the host sees everything as new.
// - Identical content: returns the edited HTML unchanged with NO marker
//   (counter has no real package edits → don't pollute the display).
// - Tags that wrap changed content (e.g. <strong>old</strong> →
//   <strong>new</strong>): tags are kept stable when possible; only
//   the inner text is diffed.

const EDITED_MARKER = '<!--GDJ_EDITED-->';

// Tokenize HTML into atoms: tags, whitespace, words, punctuation.
// Each token is preserved EXACTLY so reassembling produces valid HTML.
function tokenize(html: string): string[] {
  if (!html) return [];
  const tokens: string[] = [];
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    // HTML tag or comment — consume up to the matching '>'
    if (ch === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) {
        // Malformed HTML — bail by treating remainder as one token
        tokens.push(html.slice(i));
        break;
      }
      tokens.push(html.slice(i, close + 1));
      i = close + 1;
      continue;
    }
    // Whitespace run
    if (/\s/.test(ch)) {
      let j = i;
      while (j < html.length && /\s/.test(html[j])) j++;
      tokens.push(html.slice(i, j));
      i = j;
      continue;
    }
    // Word run (letters, digits, apostrophes, hyphens inside the run)
    if (/[\w'’-]/.test(ch)) {
      let j = i;
      while (j < html.length && /[\w'’-]/.test(html[j])) j++;
      tokens.push(html.slice(i, j));
      i = j;
      continue;
    }
    // Single punctuation character (period, comma, etc.) treated as its
    // own token — keeps diff alignment cleaner around punctuation.
    tokens.push(ch);
    i++;
  }
  return tokens;
}

// Determine if a token is a structural HTML tag/comment (i.e. should NOT
// participate in word-level comparison — tags carry no semantic content
// for the diff). Comparing tags as words causes tag-content alignment to
// drift and produces nonsense diffs.
function isTag(tok: string): boolean {
  return tok.startsWith('<');
}

// Determine if a token is pure whitespace.
function isWhitespace(tok: string): boolean {
  return /^\s+$/.test(tok);
}

// Standard LCS table — O(n*m) time and space. Practical for package
// details (< 5000 tokens); not appropriate for larger documents.
function buildLcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

type Op = { kind: 'same' | 'add' | 'remove'; tok: string };

// Walk the LCS table from bottom-right to top-left, emitting the
// minimal set of edits to transform `a` (original) into `b` (edited).
function lcsToOps(a: string[], b: string[], dp: number[][]): Op[] {
  const ops: Op[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ kind: 'same', tok: a[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ kind: 'remove', tok: a[i - 1] });
      i--;
    } else {
      ops.push({ kind: 'add', tok: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ kind: 'remove', tok: a[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.push({ kind: 'add', tok: b[j - 1] });
    j--;
  }
  return ops.reverse();
}

// Render the op stream back into HTML, wrapping removed/added runs in
// <s> and <ins>. We batch consecutive ops of the same kind to avoid
// emitting <s>X</s><s>Y</s> when one <s>XY</s> reads cleaner.
//
// Tags that ONLY appear in one side are intentionally NOT wrapped —
// e.g. if the DJ added a new <li>...</li>, the <li> tags are emitted
// as raw markup outside the <ins>, but the inner text gets wrapped.
// This keeps the diff valid HTML and avoids cases like <ins><li></ins>
// that browsers misrender. Whitespace inside a removed/added run also
// stays inside the wrapper so the visual span is tight.
function opsToHtml(ops: Op[]): string {
  let out = '';
  let buffer: Op[] = [];

  function flush() {
    if (buffer.length === 0) return;
    const kind = buffer[0].kind;
    if (kind === 'same') {
      out += buffer.map((b) => b.tok).join('');
    } else {
      // Pull leading and trailing tags OUT of the wrapper. Tags inside
      // a wrapper can produce invalid nesting (e.g. <s><ul><li></s>).
      let lead = '';
      let trail = '';
      let body = buffer.slice();
      while (body.length > 0 && (isTag(body[0].tok) || isWhitespace(body[0].tok))) {
        lead += body[0].tok;
        body = body.slice(1);
      }
      while (body.length > 0 && (isTag(body[body.length - 1].tok) || isWhitespace(body[body.length - 1].tok))) {
        trail = body[body.length - 1].tok + trail;
        body = body.slice(0, -1);
      }
      const inner = body.map((b) => b.tok).join('');
      const tag = kind === 'add' ? 'ins' : 's';
      // Empty inner can happen if buffer was all tags/whitespace —
      // in that case skip the wrapper entirely.
      const wrapped = inner ? `<${tag} class="gdj-diff-${kind}">${inner}</${tag}>` : '';
      out += lead + wrapped + trail;
    }
    buffer = [];
  }

  for (const op of ops) {
    if (buffer.length === 0 || buffer[0].kind === op.kind) {
      buffer.push(op);
    } else {
      flush();
      buffer.push(op);
    }
  }
  flush();
  return out;
}

/**
 * Public API. Returns an HTML string with inline diff markers (<s>, <ins>)
 * representing the edit from `original` to `edited`, prefixed with the
 * GDJ_EDITED marker so consumers know to apply diff styling.
 *
 * If `original` and `edited` are identical (after normalization), returns
 * `edited` unchanged with NO marker — the booking has no real edits.
 *
 * If `original` is empty/missing, the entire `edited` content is wrapped
 * in <ins>...</ins> as net-new.
 */
export function diffPackageHtml(original: string, edited: string): string {
  const origTrim = (original || '').trim();
  const editTrim = (edited || '').trim();

  // No change → return as-is, no marker.
  if (origTrim === editTrim) return edited || '';

  // No prior content → everything is new.
  if (!origTrim) {
    return `${EDITED_MARKER}<ins class="gdj-diff-add">${edited}</ins>`;
  }

  const a = tokenize(original);
  const b = tokenize(edited);
  const dp = buildLcsTable(a, b);
  const ops = lcsToOps(a, b, dp);
  const merged = opsToHtml(ops);
  return `${EDITED_MARKER}${merged}`;
}

/**
 * Strip the GDJ_EDITED marker and unwrap any <s> / <ins> tags, returning
 * just the plain edited content (i.e. accept all edits, drop the diff
 * styling). Used when we need to read the "current" content of a package
 * without the diff visualization — e.g. when the host accepts the counter
 * offer and the package becomes the official booking.
 */
export function acceptDiff(html: string): string {
  if (!html) return '';
  let h = html.replace(EDITED_MARKER, '');
  // Drop <s> blocks entirely (they represent removed content).
  h = h.replace(/<s class="gdj-diff-remove">[\s\S]*?<\/s>/g, '');
  // Unwrap <ins> blocks (keep their inner content).
  h = h.replace(/<ins class="gdj-diff-add">([\s\S]*?)<\/ins>/g, '$1');
  return h;
}

/**
 * Detect whether an HTML fragment carries the GDJ_EDITED marker.
 * Used to decide if the host should see a "DJ edited this package" badge.
 */
export function isPackageEdited(html: string | null | undefined): boolean {
  return !!html && html.includes(EDITED_MARKER);
}
