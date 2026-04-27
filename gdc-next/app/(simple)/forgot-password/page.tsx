'use client';

// Forgot Password page.
// Mirrors vanilla forgot-password.html behavior:
//   - User enters email
//   - We call resetPasswordForEmail using a dedicated implicit-flow client
//     (NOT @supabase/ssr's PKCE-flow client) so the recovery email link
//     uses #access_token (matching vanilla, no code_verifier dependency)
//   - Always show success (don't reveal whether email is registered — privacy)
//   - The reset link in the email lands on /reset-password

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '@/components/AuthProvider';
import styles from './forgot-password.module.css';

// Dedicated client for password recovery — uses implicit flow so the email
// link contains the access_token in the URL hash (matches vanilla's behavior)
// instead of the PKCE flow which requires a code_verifier in localStorage that
// gets lost in some setups.
function createImplicitFlowClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: 'implicit',
        persistSession: false, // no need — we just use this for the reset call
        autoRefreshToken: false,
      },
    }
  );
}

export default function ForgotPasswordPage() {
  const { user, loading: authLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null); // email if sent

  // Already-signed-in users shouldn't be on this page — redirect home.
  useEffect(() => {
    if (authLoading) return;
    if (user) window.location.replace('/');
  }, [user, authLoading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const emailLower = email.toLowerCase().trim();

    try {
      const client = createImplicitFlowClient();
      // Supabase generates the recovery token + sends the email.
      // We get back errors but intentionally ignore them — we don't want to
      // reveal whether an email is registered (enumeration protection).
      const { error: resetError } = await client.auth.resetPasswordForEmail(emailLower, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) {
        // Log but don't expose to user
        console.warn('[forgot-password]', resetError.message);
      }
      setSent(emailLower);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send reset link';
      setError(msg);
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className={styles.body}>
        <div className={styles.container}>
          <div className={styles.successView}>
            <div className={styles.logo}>
              <h1>GLOBAL DJ CONNECT</h1>
            </div>
            <h2 className={styles.successTitle}>✓ Check Your Email</h2>
            <p className={styles.successText}>
              We&apos;ve sent a password reset link to{' '}
              <span className={styles.successEmail}>{sent}</span>
            </p>
            <p className={styles.successHint}>
              Click the link in the email to reset your password.
            </p>
            <Link href="/login" className={styles.backToLoginBtn}>
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.body}>
      <div className={styles.container}>
        <Link href="/login" className={styles.backLink}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Login
        </Link>

        <div className={styles.logo}>
          <h1>Forgot Password</h1>
          <p className={styles.tagline}>Reset Your Password</p>
        </div>

        <p className={styles.infoText}>
          Enter your email address and we&apos;ll send you a link to reset your password.
        </p>

        {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}

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

          <button type="submit" className={styles.submitBtn} disabled={submitting}>
            {submitting ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>
      </div>
    </div>
  );
}
