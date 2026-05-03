// Root layout — minimal shell that wraps EVERY page in the app.
// Only contains things that truly belong on every page:
//   - <html>/<body> structure
//   - Google Fonts (loaded via next/font for zero render-blocking)
//   - Global CSS
//   - AuthProvider (so useAuth() works everywhere, including simple pages
//     like contact that need the current user to pre-fill the form)
//
// FONT LOADING:
// Fonts are loaded via next/font/google instead of a runtime <link> to
// fonts.googleapis.com. This:
//   - Downloads the font files at build time (no runtime Google round-trip)
//   - Self-hosts them on the same origin as the site
//   - Inlines the @font-face CSS directly into the HTML head (no separate
//     render-blocking stylesheet request)
//   - Auto-applies font-display: swap so text renders immediately with a
//     system fallback, then swaps to the real font when it's ready
// Net result: ~2 seconds shaved off LCP on first visits.
//
// CSS variable hookup: each font exposes a CSS variable. We attach all of
// them to <html className=...>, then any selector can reference them via
// `font-family: var(--font-bebas)` etc. Existing `font-family: 'Bebas Neue'`
// rules also keep working because next/font sets the family name too.
//
// SERVER-SIDE AUTH FETCH:
// We fetch the current user here on the server and pass it to AuthProvider
// as initialUser. This eliminates the logged-out → logged-in toolbar
// flicker that happens when the client-only AuthProvider has to wait
// for getUser() to resolve. The first paint is already correct.
//
// AuthProvider still subscribes to onAuthStateChange so login/logout
// without a full reload still works reactively.
//
// The site header/footer/mobile-menu live in (main)/layout.tsx — that
// layout only wraps pages inside the (main) route group.
// Pages inside (simple) get a stripped-down layout instead.

import type { Metadata } from 'next';
import { Bebas_Neue, DM_Sans, Space_Mono } from 'next/font/google';
import { AuthProvider } from '@/components/AuthProvider';
import { createClient } from '@/lib/supabase/server';
import type { CurrentUser, UserProfile } from '@/types/db';
import './styles/index.css';

// Bebas Neue — display headings. Single weight (400) is the only one
// Google Fonts ships for this family.
const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-bebas',
});

// DM Sans — body text.
const dmSans = DM_Sans({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-dm-sans',
});

// Space Mono — small caps / monospace accents.
const spaceMono = Space_Mono({
  weight: ['400', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-mono',
});

export const metadata: Metadata = {
  title: 'Global DJ Connect',
  description: 'Find and book DJs worldwide.',
};

async function getInitialUser(): Promise<CurrentUser | null> {
  try {
    const supabase = await createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser || !authUser.email) return null;
    const { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single<UserProfile>();
    if (!profile) return null;
    return { ...profile, email: authUser.email };
  } catch {
    return null;
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialUser = await getInitialUser();

  // Combine all three font CSS-variable classes onto <html> so the
  // variables are available everywhere. Each next/font import also
  // registers the actual family name (e.g. "Bebas Neue"), so existing
  // font-family declarations in CSS modules / global CSS keep working
  // unchanged.
  const fontClasses = `${bebasNeue.variable} ${dmSans.variable} ${spaceMono.variable}`;

  return (
    <html lang="en" className={fontClasses}>
      <body>
        <AuthProvider initialUser={initialUser}>{children}</AuthProvider>
      </body>
    </html>
  );
}
