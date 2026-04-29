// Root layout — minimal shell that wraps EVERY page in the app.
// Only contains things that truly belong on every page:
//   - <html>/<body> structure
//   - Google Fonts
//   - Global CSS
//   - AuthProvider (so useAuth() works everywhere, including simple pages
//     like contact that need the current user to pre-fill the form)
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
import { AuthProvider } from '@/components/AuthProvider';
import { createClient } from '@/lib/supabase/server';
import type { CurrentUser, UserProfile } from '@/types/db';
import './styles/index.css';

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
        <AuthProvider initialUser={initialUser}>{children}</AuthProvider>
      </body>
    </html>
  );
}
