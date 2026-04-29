// /embed-calendar layout — bypasses the (main) site chrome.
// Used by hosts who paste an <iframe src="/embed-calendar?slug=X"> on their
// own website. The iframe should:
//   - NOT show our header/footer/mobile-menu
//   - have a transparent body so the host's page color shows through
//   - load fast (this is rendered on third-party sites)
//
// Embed-specific styling lives inline in the layout so this page doesn't
// need to load the full site's index.css. We keep the global font links
// from root layout — those carry through automatically.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'DJ Calendar',
  // Don't index embeds — they're meant to be iframed, not landed-on
  robots: { index: false, follow: false },
};

export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Reset + transparent body so embed inherits host page color */}
      <style>{`
        html, body {
          background: transparent !important;
          color: var(--white);
          font-family: 'DM Sans', sans-serif;
          overflow-x: hidden;
        }
        body {
          padding: 12px;
          margin: 0;
        }
        /* Kill the global noise overlay added by index.css — looks bad on
           a transparent embed background since the dots float over the
           host page rather than blending into our card surface. */
        body::before { display: none !important; }
        @media (max-width: 480px) {
          body { padding: 8px; }
        }
      `}</style>
      {children}
    </>
  );
}
