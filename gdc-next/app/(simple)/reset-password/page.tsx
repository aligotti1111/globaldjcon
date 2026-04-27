'use client';

// Reset Password page.
// Mirrors vanilla reset-password.html behavior — uses the IMPLICIT flow
// (token in URL hash) to match what vanilla does, since vanilla works in
// production. We use a dedicated @supabase/supabase-js client configured
// for implicit flow rather than the @supabase/ssr default (which is PKCE).
//
// PKCE was attempted first but failed: it requires a code_verifier in
// localStorage that gets lost between the forgot-password page and the
// recovery email link, even within the same browser. Implicit flow has
// no such dependency.
//
// Flow:
//   1. User clicks reset link in their email
//   2. Supabase redirects them here with #access_token=... in the hash
//   3. detectSessionInUrl auto-processes the hash → session established
//   4. User enters new password (with strength requirements)
//   5. updateUser({ password }) updates the password
//   6. Success screen with role-aware CTA

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import styles from '../forgot-password/forgot-password.module.css';

type Phase = 'verifying' | 'ready' | 'updating' | 'success' | 'error';

function ResetPasswordForm() {
  // Single client instance for this page, configured for implicit flow.
  // useMemo keeps it stable across re-renders (creating Supabase clients
  // multiple times can cause auth state weirdness).
  const supabase: SupabaseClient = useMemo(
    () => createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          flowType: 'implicit',
          detectSessionInUrl: true, // process #access_token in the URL hash
          persistSession: true,     // so updateUser has the session
          autoRefreshToken: true,
        },
      }
    ),
    []
  );

  const [phase, setPhase] = useState<Phase>('verifying');
  const [errorMsg, setErrorMsg] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successCta, setSuccessCta] = useState<{ href: string; label: string }>({
    href: '/',
    label: 'Continue',
  });

  // Strength flags — exposed for inline display
  const lenOk = password.length >= 8;
  const upperOk = /[A-Z]/.test(password);
  const numOk = /[0-9]/.test(password);
  const allMet = lenOk && upperOk && numOk;

  // ── Verify the recovery token from the URL hash ─────────────────────────
  // The implicit-flow client auto-detects the access_token from the hash;
  // we just need to wait briefly then check if a session was established.
  useEffect(() => {
    let cancelled = false;

    async function verify() {
      try {
        const hash = window.location.hash || '';
        const hasAccessToken = hash.includes('access_token');
        const hasRecovery = hash.includes('type=recovery');

        if (!hasAccessToken && !hasRecovery) {
          if (!cancelled) {
            setErrorMsg('No reset token found in this link. Please request a new one.');
            setPhase('error');
          }
          return;
        }

        // Wait briefly for the SDK to detect + establish the session from hash
        await new Promise(r => setTimeout(r, 500));
        if (cancelled) return;

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setErrorMsg('This reset link is invalid or has expired. Please request a new one.');
          setPhase('error');
          return;
        }
        setPhase('ready');
        // Clean the URL so a refresh doesn't re-trigger anything
        if (window.history.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[reset-password] verify exception', e);
          setErrorMsg('An error occurred verifying your reset link. Please try again.');
          setPhase('error');
        }
      }
    }

    verify();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!allMet) {
      setSubmitError('Password does not meet all requirements.');
      return;
    }
    if (password !== confirm) {
      setSubmitError('Passwords do not match.');
      return;
    }

    setPhase('updating');
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // Look up role + slug to tailor the post-success CTA
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) {
          const { data: profile } = await supabase
            .from('users')
            .select('role, slug')
            .eq('id', user.id)
            .single();
          if (profile?.role === 'dj' && profile.slug) {
            setSuccessCta({ href: `/${profile.slug}`, label: 'View My Profile' });
          }
        }
      } catch { /* non-fatal */ }

      setPhase('success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update password';
      setSubmitError(`Error: ${msg}`);
      setPhase('ready');
    }
  }

  // ── Render based on phase ───────────────────────────────────────────────

  if (phase === 'verifying') {
    return (
      <div className={styles.body}>
        <div className={styles.container}>
          <div className={styles.logo}>
            <h1>Reset Password</h1>
          </div>
          <div className={styles.loadingState}>Verifying reset link...</div>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={styles.body}>
        <div className={styles.container}>
          <div className={styles.successView}>
            <div className={styles.errorIcon}>⚠️</div>
            <h2 className={styles.successTitle} style={{ color: 'var(--error)' }}>Invalid Link</h2>
            <p className={styles.successText}>{errorMsg}</p>
            <Link
              href="/forgot-password"
              className={styles.backToLoginBtn}
              style={{ marginTop: '20px' }}
            >
              Request New Reset Link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'success') {
    return (
      <div className={styles.body}>
        <div className={styles.container}>
          <div className={styles.successView}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✓</div>
            <h2 className={styles.successTitle}>Password Updated</h2>
            <p className={styles.successText}>
              Your password has been changed and you&apos;re already signed in.
            </p>
            <Link href={successCta.href} className={styles.backToLoginBtn} style={{ marginTop: '20px' }}>
              {successCta.label}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // phase === 'ready' or 'updating'
  return (
    <div className={styles.body}>
      <div className={styles.container}>
        <div className={styles.logo}>
          <h1>Reset Password</h1>
        </div>
        <p className={styles.subtitle}>Choose a new password for your account.</p>

        {submitError && <div className={`${styles.alert} ${styles.alertError}`}>{submitError}</div>}

        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label htmlFor="new-password">New Password</label>
            <input
              id="new-password"
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <ul className={styles.reqList}>
              <li className={lenOk ? styles.reqMet : ''}>At least 8 characters</li>
              <li className={upperOk ? styles.reqMet : ''}>At least one uppercase letter</li>
              <li className={numOk ? styles.reqMet : ''}>At least one number</li>
            </ul>
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="confirm-password">Confirm New Password</label>
            <input
              id="confirm-password"
              type="password"
              placeholder="Repeat your new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={!allMet || phase === 'updating'}
          >
            {phase === 'updating' ? 'Updating...' : 'Set New Password'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <Link href="/login" className={styles.backLink}>
            ← Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
