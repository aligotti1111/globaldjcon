// DjSearchBar — a compact "find a DJ" search box for the marketing pages
// (About, FAQ). Mirrors the homepage search: submitting sends the visitor to
// the DJ directory at /djs?q=<term>. It's a plain GET form, so it works with no
// JavaScript and needs no client bundle.
//
// Rendered just under the site Header on pages that aren't the landing page
// (the landing page has its own full-width search row).

export default function DjSearchBar() {
  return (
    <div
      style={{
        borderBottom: '1px solid var(--border, rgba(255,255,255,.1))',
        background: '#000',
      }}
    >
      <form
        action="/djs"
        method="get"
        role="search"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          maxWidth: 760,
          margin: '0 auto',
          padding: '12px 2rem',
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--muted, #8a8aa0)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ width: 18, height: 18, flexShrink: 0 }}
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          name="q"
          placeholder="Search by zip or DJ name…"
          aria-label="Search by zip or DJ name"
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#fff',
            fontSize: '.95rem',
            padding: '6px 2px',
          }}
        />
        <button
          type="submit"
          style={{
            flexShrink: 0,
            background: 'var(--neon, #00e0a4)',
            color: '#05120d',
            border: 'none',
            borderRadius: 999,
            fontFamily: "'Space Mono', monospace",
            fontSize: '.72rem',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            fontWeight: 700,
            padding: '.5rem 1.1rem',
            cursor: 'pointer',
          }}
        >
          Find a DJ
        </button>
      </form>
    </div>
  );
}
