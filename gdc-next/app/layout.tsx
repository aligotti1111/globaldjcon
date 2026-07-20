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
import { Bebas_Neue, DM_Sans, Space_Mono, Inter } from 'next/font/google';
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

// Inter — modern UI font for small form labels. Designed for legibility
// at small sizes, which monospace (Space Mono) handles poorly.
const inter = Inter({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Global DJ Connect',
  description: 'Find and book DJs worldwide.',
};

async function getInitialUser(): Promise<CurrentUser | null> {
  try {
    const supabase = await createClient();
    // Use getSession() (local cookie decode) instead of getUser() (network
    // round trip to Supabase Auth). Middleware already calls getUser() on
    // every request — it validates and refreshes the session cookie before
    // this layout runs — so the session here is already trustworthy. Calling
    // getUser() again would be a second, redundant network hop on every page
    // load. getSession() reads the same answer from the cookie in memory.
    const { data: { session } } = await supabase.auth.getSession();
    const authUser = session?.user;
    // NOT `!authUser.email`. A phone-signup host has a perfectly valid session
    // and no email address on it — gating on email here threw that session
    // away and rendered the whole site logged-out to somebody who had just
    // typed a correct code. The email was only ever a display field.
    if (!authUser) return null;
    const { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single<UserProfile>();
    if (!profile) return null;
    // Prefer the auth email; fall back to the delivery address a phone-signup
    // host gives at their first booking; otherwise empty, which is honest —
    // we genuinely don't have one yet.
    const contactEmail = (profile as { contact_email?: string | null }).contact_email;
    return {
      ...profile,
      email: authUser.email || contactEmail || '',
      // Matches AuthProvider — see the long note there. No auth email means
      // there is nothing to verify, so the verification gates (which block
      // booking) must not fire. Both places build this object, so both need
      // the rule or the first paint disagrees with everything after it.
      email_verified: authUser.email ? profile.email_verified : true,
    };
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
  const fontClasses = `${bebasNeue.variable} ${dmSans.variable} ${spaceMono.variable} ${inter.variable}`;

  return (
    <html lang="en" className={fontClasses}>
      <body>
        <AuthProvider initialUser={initialUser}>{children}</AuthProvider>
      </body>
    </html>
  );
}
