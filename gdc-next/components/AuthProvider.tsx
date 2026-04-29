'use client';

// AuthProvider — the React replacement for auth.js + the sessionStorage dance.
// Every component that needs the current user calls useAuth() — no more
// `JSON.parse(sessionStorage.getItem('currentUser') || ...)`.
//
// CRITICAL: this is the ONE place email gets merged from auth.users into the
// profile object. The bug we hit before (cu.email being null) cannot happen
// here because TypeScript will refuse to compile if you try to read .email
// off a UserProfile (which doesn't have it) — you must use CurrentUser.
//
// initialUser comes from the SERVER (root layout fetches it via the server
// supabase client) so the very first paint already has the correct auth
// state. No more logged-out → logged-in toolbar flicker. The client-side
// useEffect below subscribes to onAuthStateChange so login/logout without
// a full reload still works reactively.

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { CurrentUser, UserProfile } from '@/types/db';

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: React.ReactNode;
  initialUser?: CurrentUser | null;
}) {
  const [user, setUser] = useState<CurrentUser | null>(initialUser);
  // loading is false from the start — the server already resolved auth.
  // We only flip back to "loading" semantics if a client-side reload is
  // triggered by an auth event, but even then we don't show a loading
  // state in the UI; we just keep the previous user until the new state
  // is fetched.
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    let mounted = true;

    async function loadUser() {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser || !mounted) {
        if (mounted) setUser(null);
        setLoading(false);
        return;
      }
      // Fetch profile from public.users
      const { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single<UserProfile>();
      if (!mounted) return;
      if (profile && authUser.email) {
        // Merge: this is the SINGLE place we combine auth email + profile.
        setUser({ ...profile, email: authUser.email });
      } else {
        setUser(null);
      }
      setLoading(false);
    }

    // Re-run on auth state change (login, logout, token refresh).
    // We DON'T eagerly call loadUser() on mount — initialUser is already
    // populated from the server, so a redundant fetch would just cost
    // extra latency without changing what's rendered.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      loadUser();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
