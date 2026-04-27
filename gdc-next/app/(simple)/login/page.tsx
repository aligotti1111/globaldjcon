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
const ADMIN_PASSWORD = 'spinlist2025';

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
  const destination =
    searchParams.get('redirect') || searchParams.get('return') || '/';

  // ── Already-signed-in redirect ──────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const hasAccessToken = hash.includes('access_token');
    const isConfirmed = searchParams.get('confirmed') === '1';
    if (user && !hasAccessToken && !isConfirmed) {
      window.location.replace(destination);
    }
  }, [user, authLoading, searchParams, destination]);

  // ── Post-email-confirmation handling ────────────────────────────────────
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const hasAccessToken = hash.includes('access_token');
    const isConfirmed = searchParams.get('confirmed') === '1';
    if (!hasAccessToken && !isConfirmed) return;

    const timer = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        window.location.href = '/account-settings?emailverified=1';
        return;
      }
      setSuccess('✓ Your email is verified. Please log in to continue.');
    }, 600);

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
      // Hardcoded admin path — same as vanilla
      if (trimmedEmail === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
        sessionStorage.setItem('adminUser', '1');
        window.location.href = '/admin';
        return;
      }

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

      // Full page navigation so the AuthProvider re-reads cookies and any
      // server-rendered pages get the new session immediately.
      window.location.href = destination;
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
