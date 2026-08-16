// Root layout — minimal shell that wraps EVERY page in the app.
// Only contains things that truly belong on every page:
//   - <html>/<body> structure
//   - Google Fonts (loaded via next/font for zero render-blocking)
//   - Global CSS
//   - AuthProvider (so useAuth() works everywhere, including simple pages
//     like contact that need the current user to pre-fill the form)
//
// FONT LOADING:
// Fonts are loaded at RUNTIME via a <link> to fonts.googleapis.com rather than
// next/font/google. next/font downloads the font files at BUILD time, and when
// fonts.gstatic.com is briefly unreachable from the CI builder the whole build
// fails ("Failed to fetch `DM Sans` from Google Fonts"). Moving the fetch to
// the browser removes that build-time dependency entirely — the site builds
// even when Google is having a moment, and the browser loads the fonts on first
// paint with font-display: swap (system fallback first, real font when ready).
//
// CSS variable hookup: we define --font-bebas / --font-dm-sans / etc. as inline
// custom properties on <html>, pointing at the family names the Google
// stylesheet registers. Every selector using `font-family: var(--font-bebas)`
// or `font-family: 'Bebas Neue'` keeps working unchanged.
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
import type { CSSProperties } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { createClient } from '@/lib/supabase/server';
import type { CurrentUser, UserProfile } from '@/types/db';
import './styles/index.css';

// One Google Fonts stylesheet for all four families + the exact weights used:
//   Bebas Neue 400 · DM Sans 300/400/500/700 · Space Mono 400/700 ·
//   Inter 400/500/600/700. display=swap paints a system fallback first.
const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;700&family=Inter:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap';

// The CSS variables the rest of the app references, mapped to the family names
// the Google stylesheet registers. (custom properties aren't in the CSSProperties
// type, hence the cast.)
const FONT_VARS = {
  '--font-bebas': "'Bebas Neue', sans-serif",
  '--font-dm-sans': "'DM Sans', sans-serif",
  '--font-space-mono': "'Space Mono', monospace",
  '--font-inter': "'Inter', sans-serif",
} as unknown as CSSProperties;

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

  return (
    <html lang="en" style={FONT_VARS}>
      <head>
        {/* Warm up the font connections, then load the families at runtime. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
      </head>
      <body>
        <AuthProvider initialUser={initialUser}>{children}</AuthProvider>
      </body>
    </html>
  );
}
