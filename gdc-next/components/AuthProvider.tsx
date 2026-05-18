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
//
// justVerified: true when the user's email_verified_at is within the last
// 60 seconds AND we haven't already shown the banner for this verification.
// EmailVerifiedBanner reads this flag. The 60-second window covers the
// magic-link round trip; the localStorage de-dupe key prevents the banner
// from re-firing on subsequent page loads after the user dismisses it.

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { CurrentUser, UserProfile } from '@/types/db';

// Profile shape extended with the new email_verified_at column. Until
// types/db.ts is regenerated from the live schema, we add it locally.
type UserProfileWithVerified = UserProfile & {
  email_verified_at?: string | null;
};
type CurrentUserWithVerified = CurrentUser & {
  email_verified_at?: string | null;
};

interface AuthContextValue {
  user: CurrentUserWithVerified | null;
  loading: boolean;
  /** True if the user verified their email within the last 60s and the
   *  banner has not yet been acknowledged (localStorage flag absent). */
  justVerified: boolean;
  /** Call after the banner has been shown so it doesn't re-trigger. */
  acknowledgeVerification: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  justVerified: false,
  acknowledgeVerification: () => {},
  signOut: async () => {},
});

// localStorage key used to mark a specific verification event as "shown"
// so the banner doesn't re-fire on page navigation. Stores the user's
// email_verified_at timestamp string — when a NEW verification happens
// (newer timestamp), the key won't match and the banner fires again.
const ACK_STORAGE_KEY = 'gdc_email_verified_ack';

// localStorage key set by the signup page when a host arrives via a
// claim_booking link. Stores the booking id; we claim it on first
// authenticated load if the user's email matches the booking's host_email.
const PENDING_BOOKING_CLAIM_KEY = 'gdc_pending_booking_claim';

// Window during which a fresh email_verified_at counts as "just verified".
// 60 seconds covers the magic-link round trip with comfortable margin.
const JUST_VERIFIED_WINDOW_MS = 60_000;

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: React.ReactNode;
  initialUser?: CurrentUserWithVerified | null;
}) {
  const [user, setUser] = useState<CurrentUserWithVerified | null>(initialUser);
  const [loading, setLoading] = useState(false);
  // Tracks whether the current user's verification banner has been
  // acknowledged in this session. Initialized from localStorage on mount.
  const [ackedTimestamp, setAckedTimestamp] = useState<string | null>(null);
  const supabase = createClient();

  // Read the acknowledgement flag from localStorage on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const v = window.localStorage.getItem(ACK_STORAGE_KEY);
      if (v) setAckedTimestamp(v);
    } catch {
      // localStorage may be unavailable (private mode, etc.) — fine to ignore.
    }
  }, []);

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
        .single<UserProfileWithVerified>();
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

  // Pending-booking claim: if a user just verified after arriving via a
  // booking-invite link, the signup page stashed the booking id in
  // localStorage. Now that we're authenticated AND we have the user's
  // email, claim the booking by setting requester_id = user.id. The
  // host_email match in the WHERE clause prevents anyone from claiming
  // a booking they weren't invited to — they'd need access to both the
  // invitee's email AND the bookingId.
  useEffect(() => {
    if (!user || !user.email || !user.id) return;
    if (typeof window === 'undefined') return;
    let bookingId: string | null = null;
    try {
      bookingId = window.localStorage.getItem(PENDING_BOOKING_CLAIM_KEY);
    } catch { return; }
    if (!bookingId) return;
    // Best-effort claim. We don't surface errors — if the booking can't
    // be found or the email doesn't match, just clear the key silently.
    (async () => {
      try {
        await supabase
          .from('bookings')
          .update({
            requester_id: user.id,
            requester_name: user.name || null,
          } as unknown as never)
          .eq('id', bookingId)
          .eq('host_email', user.email)
          .eq('is_manual', true);
      } catch (e) {
        console.warn('[booking-claim] update failed (non-fatal)', e);
      }
      try {
        window.localStorage.removeItem(PENDING_BOOKING_CLAIM_KEY);
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.email]);

  // Derive justVerified from the user's timestamp. It's true when:
  //   1. user.email_verified_at exists
  //   2. it's within the last JUST_VERIFIED_WINDOW_MS
  //   3. the user hasn't acknowledged THIS specific verification yet
  //      (acked timestamp differs from the one on the user record)
  const verifiedAt = user?.email_verified_at || null;
  let justVerified = false;
  if (verifiedAt && ackedTimestamp !== verifiedAt) {
    const ts = new Date(verifiedAt).getTime();
    if (!Number.isNaN(ts) && Date.now() - ts < JUST_VERIFIED_WINDOW_MS) {
      justVerified = true;
    }
  }

  // Called by the banner once it's been shown to the user. Stores the
  // current verified_at timestamp so the banner won't re-fire for the
  // same verification event.
  function acknowledgeVerification() {
    if (!verifiedAt) return;
    setAckedTimestamp(verifiedAt);
    try {
      window.localStorage.setItem(ACK_STORAGE_KEY, verifiedAt);
    } catch {
      // Non-fatal — banner will just re-show on next load.
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, justVerified, acknowledgeVerification, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
