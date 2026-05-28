'use client';

// Login page.
// Mirrors vanilla login.html behavior:
//   - Already-signed-in users get redirected to / (or ?return / ?redirect)
//   - URL hash with access_token OR ?confirmed=1 → handle email confirmation
//   - Hardcoded admin login for admin@globaldjconnect.com
//   - Otherwise: signInWithPassword via Supabase Auth
//   - On success: full page navigation to ?return / ?redirect / homepage
//
// The form is wrapped in Suspense because useSearchParams() requires it
// in Next.js 15's App Router for client components.

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/AuthProvider';
import styles from './login.module.css';

// Hardcoded admin credentials match vanilla login.html exactly.
// NOTE: matched 1:1 with the vanilla site as agreed. The maintenance dev
// should migrate this to Supabase Auth (with admin role) post-launch.
const ADMIN_EMAIL = 'admin@globaldjconnect.com';

function LoginForm() {
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Determine the destination after login. Support both ?redirect= (set by
  // our middleware when it bounces unauth'd users) and ?return= (legacy from
  // vanilla site links). Default to homepage.
  //
  // SECURITY: only allow relative, same-origin paths. Without this, a
  // crafted ?redirect=https://evil.com (or //evil.com) would send the user
  // to an external site after login — a classic open-redirect usable for
  // phishing. We require a leading "/" that is NOT "//" (protocol-relative)
  // and contains no scheme. Anything else falls back to the homepage.
  function sanitizeRedirect(raw: string | null): string {
    if (!raw) return '/';
    // Must be a relative path beginning with a single slash.
    if (!raw.startsWith('/')) return '/';
    if (raw.startsWith('//')) return '/';          // protocol-relative → external
    if (raw.startsWith('/\\')) return '/';         // backslash trick
    // Reject anything that smuggles a scheme/host (e.g. "/\t/evil", encoded).
    try {
      // Resolve against a dummy origin; if the resulting origin changes,
      // it wasn't actually relative.
      const u = new URL(raw, 'https://gdc.local');
      if (u.origin !== 'https://gdc.local') return '/';
      return u.pathname + u.search + u.hash;
    } catch {
      return '/';
    }
  }
  const destination = sanitizeRedirect(
    searchParams.get('redirect') || searchParams.get('return')
  );

  // ── Already-signed-in redirect ──────────────────────────────────────────
  // If the user is already logged in, redirect them to the destination —
  // UNLESS we just came here from email verification (we want them to see
  // the confirmation banner first, then redirect after a short delay).
  // EXCEPTION: don't auto-redirect to /admin unless the user IS the admin.
  // Otherwise we'd send a non-admin DJ/host to /admin → /admin server check
  // bounces back to /login → loop forever.
  useEffect(() => {
    if (authLoading) return;
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const hasAccessToken = hash.includes('access_token');
    const isConfirmed = searchParams.get('confirmed') === '1';
    const isEmailVerified = searchParams.get('emailverified') === '1';
    if (user && !hasAccessToken && !isConfirmed && !isEmailVerified) {
      // Avoid the redirect loop: if the destination is /admin but the user
      // isn't the admin, send them to / instead.
      const isAdminDest = destination === '/admin' || destination.startsWith('/admin?') || destination.startsWith('/admin/');
      const userIsAdmin = (user.email || '').toLowerCase() === 'admin@globaldjconnect.com';
      const safeDest = (isAdminDest && !userIsAdmin) ? '/' : destination;
      window.location.replace(safeDest);
    }
  }, [user, authLoading, searchParams, destination]);

  // ── Post-email-confirmation handling ────────────────────────────────────
  // Two URL patterns can land here from a verification flow:
  //   1) ?emailverified=1 — our own /api/verify-email redirected here after
  //      flipping email_verified=true. Show a green success banner. If they
  //      already have a session, redirect home after a moment so the banner
  //      shows briefly. Otherwise let them sign in.
  //   2) #access_token=... or ?confirmed=1 — legacy Supabase-confirmation flow.
  //      Same treatment.
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const hasAccessToken = hash.includes('access_token');
    const isConfirmed = searchParams.get('confirmed') === '1';
    const isEmailVerified = searchParams.get('emailverified') === '1';
    if (!hasAccessToken && !isConfirmed && !isEmailVerified) return;

    // Show the success banner immediately
    setSuccess('✓ Your email is verified! You can now access all features.');

    const timer = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Already logged in — send them home so they can keep using the site
        window.location.href = '/';
        return;
      }
      // No session — leave the banner showing so they can log in
    }, 1500);

    if (typeof window !== 'undefined' && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    const trimmedEmail = email.toLowerCase().trim();

    try {
      // NOTE: vanilla had a hardcoded admin-email + password check here that
      // set sessionStorage. The new admin panel uses real Supabase auth — the
      // admin user is `admin@globaldjconnect.com` with their own password
      // stored in Supabase auth.users like any other user. No special path.
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (authError) {
        if (/invalid login credentials/i.test(authError.message)) {
          throw new Error('Invalid email or password.');
        }
        throw authError;
      }
      if (!data?.session) {
        throw new Error('Login failed. Please try again.');
      }

      // Where to go after login: respect ?redirect, fall back to home for
      // regular users, send the admin to /admin specifically.
      const isAdminUser = trimmedEmail === ADMIN_EMAIL;
      // Honor an explicit ?redirect= unless it's empty/'/'; otherwise pick
      // /admin for admin user, '/' for everyone else.
      const explicitDest = (destination && destination !== '/') ? destination : null;
      const finalDest = explicitDest || (isAdminUser ? '/admin' : '/');
      window.location.href = finalDest;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.body}>
      <div className={styles.container}>
        <div className={styles.logo}>
          <Link href="/">
            <h1>GLOBAL DJ CONNECT</h1>
          </Link>
          <p className={styles.tagline}>Directory &amp; Booking</p>
        </div>

        <div className={styles.tabs}>
          <button className={`${styles.tab} ${styles.active}`} type="button">
            Login
          </button>
          <Link href="/signup" className={styles.tab}>
            Sign Up
          </Link>
        </div>

        {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}
        {success && <div className={`${styles.alert} ${styles.alertSuccess}`}>{success}</div>}

        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className={styles.submitBtn} disabled={submitting}>
            {submitting ? 'Logging In...' : 'Log In'}
          </button>
        </form>

        <div className={styles.links}>
          <Link href="/forgot-password">Forgot Password?</Link>
        </div>

        <div className={styles.divider}>
          Don&apos;t have an account? <Link href="/signup">Sign up</Link>
        </div>

        <div className={styles.contactLink}>
          <Link href="/contact">Contact Us</Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
