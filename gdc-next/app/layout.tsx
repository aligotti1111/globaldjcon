// Root layout — minimal shell that wraps EVERY page in the app.
// Only contains things that truly belong on every page:
//   - <html>/<body> structure
//   - Google Fonts
//   - Global CSS
//   - AuthProvider (so useAuth() works everywhere, including simple pages
//     like contact that need the current user to pre-fill the form)
//
// The site header/footer/mobile-menu live in (main)/layout.tsx — that
// layout only wraps pages inside the (main) route group.
// Pages inside (simple) get a stripped-down layout instead.

import type { Metadata } from 'next';
import { AuthProvider } from '@/components/AuthProvider';
import './styles/index.css';

export const metadata: Metadata = {
  title: 'Global DJ Connect',
  description: 'Find and book DJs worldwide.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Google Fonts — same fonts the vanilla site uses */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;700&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
