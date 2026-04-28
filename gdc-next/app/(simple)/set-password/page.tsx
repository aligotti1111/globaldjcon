'use client';

// /set-password — entry point for users whose claim was just approved.
// They arrive via a one-time token link emailed by the admin panel
// (?token=<64-hex>). The page POSTs to /api/set-password-from-token which
// validates the token and sets their password.
//
// Faithful port of vanilla set-password.html.
//
// Flow:
//   1. Token in URL → show password form
//   2. Submit → API validates token, sets password, marks token used
//   3. Success → "Password Set" → link to sign in
//   4. Errors:
//      - 400: bad input — re-enabled
//      - 404: unknown token — full error state
//      - 410: expired/used — full error state
//      - 500: server-side fail — re-enabled, show msg

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import styles from './setPassword.module.css';

export default function SetPasswordPage() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState<string | null>(null);

  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<'loading' | 'form' | 'error' | 'success'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [alertMsg, setAlertMsg] = useState<{ msg: string; ok: boolean } | null>(null);

  // Read token from URL on mount. If no token → permanent error state.
  useEffect(() => {
    const t = searchParams.get('token') || '';
    if (!t) {
      setView('error');
      setErrorMsg('This link is missing its token. Please use the link from your approval email.');
    } else {
      setToken(t);
      setView('form');
    }
  }, [searchParams]);

  // Live requirement checks
  const reqLength = pw1.length >= 8;
  const reqMatch = pw1.length > 0 && pw1 === pw2;
  const canSubmit = reqLength && reqMatch && !submitting;

  async function submit() {
    setAlertMsg(null);
    if (!reqLength) {
      setAlertMsg({ msg: 'Password must be at least 8 characters.', ok: false });
      return;
    }
    if (!reqMatch) {
      setAlertMsg({ msg: 'Passwords don\'t match.', ok: false });
      return;
    }
    if (!token) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/set-password-from-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: pw1 }),
      });
      const data: { error?: string; success?: boolean } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAlertMsg({ msg: data.error || 'Something went wrong. Please try again.', ok: false });
        // 410/404 = dead token, surface the full error state so the user
        // doesn't keep retrying a broken link.
        if (res.status === 410 || res.status === 404) {
          setTimeout(() => {
            setView('error');
            setErrorMsg(data.error || 'Link is no longer valid.');
          }, 600);
        }
        return;
      }
      setView('success');
    } catch {
      setAlertMsg({ msg: 'Network error. Please try again.', ok: false });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.bodyWrap}>
      <div className={styles.card}>
        <div className={styles.logo}>Global DJ Connect</div>

        {view === 'loading' && (
          <div className={styles.loadingState}>Loading…</div>
        )}

        {view === 'error' && (
          <>
            <h1>Link Problem</h1>
            <div className={`${styles.alert} ${styles.alertError}`}>{errorMsg}</div>
            <Link href="/login" className={styles.backLink}>← Go to sign in</Link>
          </>
        )}

        {view === 'form' && (
          <>
            <h1>Set Your Password</h1>
            <p className={styles.subtitle}>
              Your profile claim was approved. Choose a password to finish
              activating your account.
            </p>
            {alertMsg && (
              <div className={`${styles.alert} ${alertMsg.ok ? styles.alertSuccess : styles.alertError}`}>
                {alertMsg.msg}
              </div>
            )}
            <div className={styles.formGroup}>
              <label>New Password</label>
              <input
                type="password"
                placeholder="Min 8 characters"
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
                autoComplete="new-password"
              />
              <ul className={styles.reqList}>
                <li className={reqLength ? styles.reqMet : ''}>At least 8 characters</li>
                <li className={reqMatch ? styles.reqMet : ''}>Matches confirmation below</li>
              </ul>
            </div>
            <div className={styles.formGroup}>
              <label>Confirm Password</label>
              <input
                type="password"
                placeholder="Re-enter password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
                autoComplete="new-password"
              />
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className={styles.btn}
            >
              {submitting ? 'Setting password…' : 'Set Password & Sign In'}
            </button>
          </>
        )}

        {view === 'success' && (
          <>
            <h1>✓ Password Set</h1>
            <p className={styles.subtitle}>
              Your password has been saved. You can now sign in.
            </p>
            <Link
              href="/login"
              className={styles.btn}
              style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
            >
              Go to Sign In
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
