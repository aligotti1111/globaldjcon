'use client';

// AuthProvider — the React replacement for auth.js + the sessionStorage dance.
// Every component that needs the current user calls useAuth() — no more
// `JSON.parse(sessionStorage.getItem('currentUser') || ...)`.
//
// CRITICAL: this is the ONE place email gets merged from auth.users into the
// profile object. The bug we hit before (cu.email being null) cannot happen
// here because TypeScript will refuse to compile if you try to read .email
// off a UserProfile (which doesn't have it) — you must use CurrentUser.

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    let mounted = true;

    async function loadUser() {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser || !mounted) {
        setUser(null);
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

    loadUser();

    // Re-run on auth state change (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      loadUser();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
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
