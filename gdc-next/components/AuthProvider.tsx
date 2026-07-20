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
// NOTE ON ACCOUNTS WITH NO EMAIL: hosts can sign up with a phone number, so
// `authUser.email` is legitimately null for some real, fully-authenticated
// users. This used to gate setUser() and silently logged those people out —
// valid session, correct code typed, header showing "Sign In". Email is a
// display and delivery field, never proof of who someone is.
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
  // Delivery address for a host who signed up by phone — collected at their
  // first booking. Not a credential.
  contact_email?: string | null;
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
  /** Merge fields into the cached current user in place (e.g. after the DJ
   *  saves a new slug) so header links update without a full reload. */
  patchUser: (partial: Partial<CurrentUserWithVerified>) => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  justVerified: false,
  acknowledgeVerification: () => {},
  signOut: async () => {},
  patchUser: () => {},
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

// localStorage key where AuthProvider stashes the result of a successful
// booking claim so BookingClaimedBanner can show a one-time confirmation
// message. Includes the booking summary + direction (host vs dj) so the
// banner can link to the right page.
const BOOKING_CLAIMED_RESULT_KEY = 'gdc_booking_claimed_result';

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
      // Merge: this is the SINGLE place we combine auth email + profile.
      //
      // Gated on `profile` ONLY. It used to also require authUser.email, which
      // meant a phone-signup host — no email, valid session — was treated as
      // logged out on every single page load.
      if (profile) {
        setUser({
          ...profile,
          email: authUser.email || profile.contact_email || '',
        });
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
  // localStorage. Hit the server-side claim API to link the booking to
  // this user. Server validates host_email match before granting the
  // claim (avoids needing a permissive RLS policy on the client side).
  //
  // Still requires an email, and correctly so — the claim is matched against
  // the booking's host_email. A phone-only account has nothing to match on
  // yet, so this simply doesn't fire for them.
  useEffect(() => {
    if (!user || !user.email || !user.id) return;
    if (typeof window === 'undefined') return;
    let bookingId: string | null = null;
    try {
      bookingId = window.localStorage.getItem(PENDING_BOOKING_CLAIM_KEY);
    } catch { return; }
    if (!bookingId) return;
    // Best-effort claim. Clear the key after the request finishes either way
    // so a stale claim doesn't loop on every page load.
    (async () => {
      try {
        const res = await fetch('/api/claim-booking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId }),
        });
        if (res.ok) {
          // Success — stash the booking summary so BookingClaimedBanner
          // can show a one-time confirmation toast. Banner clears the key
          // after it displays so it doesn't loop on refresh.
          try {
            const data = await res.json();
            if (data?.ok && data.booking) {
              window.localStorage.setItem(
                BOOKING_CLAIMED_RESULT_KEY,
                JSON.stringify({
                  direction: data.direction,
                  booking: data.booking,
                  at: Date.now(),
                }),
              );
              // Notify the banner component (which lives in the same tab)
              // that something fresh is available — same-tab storage events
              // don't fire automatically, so dispatch a custom one.
              window.dispatchEvent(new CustomEvent('gdc-booking-claimed'));
            }
          } catch { /* parse failure non-fatal */ }
        } else {
          const data = await res.json().catch(() => ({}));
          console.warn('[booking-claim] api error (non-fatal)', data);
        }
      } catch (e) {
        console.warn('[booking-claim] fetch failed (non-fatal)', e);
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

  const patchUser = (partial: Partial<CurrentUserWithVerified>) => {
    setUser(prev => (prev ? { ...prev, ...partial } : prev));
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, justVerified, acknowledgeVerification, signOut, patchUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
