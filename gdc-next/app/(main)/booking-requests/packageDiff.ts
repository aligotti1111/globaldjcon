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
        // Malformed H
