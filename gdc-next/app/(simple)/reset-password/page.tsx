'use client';

// Reset Password page.
// Mirrors vanilla reset-password.html behavior, with one important addition:
// we handle BOTH the implicit flow (token in URL hash, what vanilla uses)
// AND the PKCE flow (code in URL query param). Supabase Auth can be
// configured either way at the project level — handling both means this
// page works regardless of how the project is set up.
//
// Flow:
//   1. User clicks reset link in their email
//   2. Supabase redirects them here with either #access_token=... or ?code=...
//   3. We process either to establish a recovery session
//   4. User enters new password (with strength requirements)
//   5. supabase.auth.updateUser({ password }) updates the password
//   6. Success screen with role-aware CTA

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from '../forgot-password/forgot-password.module.css';

type Phase = 'verifying' | 'ready' | 'updating' | 'success' | 'error';

function ResetPasswordForm() {
  const supabase = createClient();
  const searchParams = useSearchParams();

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

  // ── Verify the recovery token from the URL ──────────────────────────────
  // This runs once on mount. We try BOTH:
  //   (a) PKCE flow: ?code=... → exchangeCodeForSession
  //   (b) Implicit flow: #access_token=... — the SDK auto-processes it,
  //       we just wait briefly then check getSession()
  useEffect(() => {
    let cancelled = false;

    async function verify() {
      try {
        // PKCE flow first
        const code = searchParams.get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!cancelled) {
            if (error) {
              setErrorMsg('This reset link is invalid or has expired. Please request a new one.');
              setPhase('error');
              return;
            }
            setPhase('ready');
            // Clean the URL
            if (window.history.replaceState) {
              window.history.replaceState({}, document.title, window.location.pathname);
            }
            return;
          }
        }

        // Implicit flow: SDK processes hash automatically. Give it a moment.
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
        // Clean the URL
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
