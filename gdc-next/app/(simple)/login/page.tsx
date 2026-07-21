'use client';

// Login page.
//
// ONE FIELD. It takes an email address or a phone number and works out which.
// From there the user picks how to get in:
//   - Use password  → signInWithPassword. Unchanged from before; this is the
//                     DJ path and it behaves exactly as it always has.
//   - Send me a code → 6-digit OTP by SMS or email, then verifyOtp.
//
// WHY A LOOKUP FIRST
// Somebody who signed up with an email will one day type their PHONE number
// here, because that's what people do. That number isn't an auth identity —
// but it's sitting on the booking they made, next to their requester_id. If we
// answered "no account found" they'd sign up again and their bookings would be
// split across two accounts, silently and permanently. So the identifier is
// looked up server-side first (see /api/auth/lookup-identifier), and a number
// found on a booking still gets them into the account they already have.
//
// Everything that was here before is still here: the ?redirect / ?return
// sanitising, the already-signed-in bounce, the post-verification banner, and
// the admin destination. Those are load-bearing and untouched.
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

/** Which screen the form is showing. */
type Step = 'identify' | 'password' | 'code';

interface Lookup {
  kind: 'email' | 'phone';
  found: boolean;
  canPassword: boolean;
  canCode: boolean;
  linkOnVerify?: boolean;
}

/** Same E.164 shape the SMS helper and the lookup route use. */
function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

function looksLikeEmail(raw: string): boolean {
  return raw.includes('@');
}

/** "+15551234821" → "•••• 4821" — enough to recognise, not enough to leak. */
function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, '');
  return `•••• ${d.slice(-4)}`;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const supabase = createClient();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>('identify');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Seconds until "Resend" becomes available again. Stops someone spamming
  // the button and burning SMS credit a digit at a time.
  const [resendIn, setResendIn] = useState(0);

  const isEmail = looksLikeEmail(identifier);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

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
    if (!raw.startsWith('/')) return '/';
    if (raw.startsWith('//')) return '/';          // protocol-relative → external
    if (raw.startsWith('/\\')) return '/';         // backslash trick
    try {
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
  useEffect(() => {
    if (authLoading) return;
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const hasAccessToken = hash.includes('access_token');
    const isConfirmed = searchParams.get('confirmed') === '1';
    const isEmailVerified = searchParams.get('emailverified') === '1';
    if (user && !hasAccessToken && !isConfirmed && !isEmailVerified) {
      const isAdminDest = destination === '/admin' || destination.startsWith('/admin?') || destination.startsWith('/admin/');
      const userIsAdmin = (user.email || '').toLowerCase() === 'admin@globaldjconnect.com';
      const safeDest = (isAdminDest && !userIsAdmin) ? '/' : destination;
      window.location.replace(safeDest);
    }
  }, [user, authLoading, searchParams, destination]);

  // ── Post-email-confirmation handling ────────────────────────────────────
  // Two URL patterns can land here from a verification flow:
  //   1) ?emailverified=1 — our own /api/verify-email redirected here after
  //      flipping email_verified=true.
  //   2) #access_token=... or ?confirmed=1 — legacy Supabase-confirmation flow.
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const hasAccessToken = hash.includes('access_token');
    const isConfirmed = searchParams.get('confirmed') === '1';
    const isEmailVerified = searchParams.get('emailverified') === '1';
    if (!hasAccessToken && !isConfirmed && !isEmailVerified) return;

    setSuccess('✓ Your email is verified! You can now access all features.');

    const timer = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        window.location.href = (destination && destination !== '/') ? destination : '/';
        return;
      }
    }, 1500);

    if (typeof window !== 'undefined' && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Where to go once we have a session.
   *
   * Waits for the session to actually be readable first. Sign-in resolving
   * does not mean it has finished being written to storage and cookies, and
   * window.location.href triggers a full page load — if that fires first, the
   * server renders the next page with no session and bounces the user back
   * out, apparently still logged out despite having just typed a correct code.
   */
  async function finish(emailUsed: string | null) {
    for (let i = 0; i < 30; i++) {
      const { data: s } = await supabase.auth.getSession();
      if (s?.session) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const isAdminUser = (emailUsed || '').toLowerCase() === ADMIN_EMAIL;
    const explicitDest = (destination && destination !== '/') ? destination : null;
    window.location.href = explicitDest || (isAdminUser ? '/admin' : '/');
  }

  /** Ask the server who this identifier belongs to, then show the right step. */
  async function handleContinue(intent: 'password' | 'code') {
    setError(null);
    const raw = identifier.trim();
    if (!raw) {
      setError('Enter your email address or phone number.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/lookup-identifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: raw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Something went wrong.');
      const found = data as Lookup;
      setLookup(found);

      if (!found.found) {
        // Never offer to create an account from the login page. Somebody who
        // signed up with an email and is now typing their phone would take
        // that offer and end up with two accounts.
        setError(
          found.kind === 'phone'
            ? 'We couldn’t find an account for that number. If you signed up with an email address, try that instead.'
            : 'We couldn’t find an account for that email address.',
        );
        setSubmitting(false);
        return;
      }

      if (intent === 'password') {
        if (!found.canPassword) {
          setError('That account signs in with a code. Tap “Send me a code”.');
          setSubmitting(false);
          return;
        }
        setStep('password');
        setSubmitting(false);
        return;
      }

      await sendCode(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setSubmitting(false);
    }
  }

  /** Fire the OTP. Supabase handles generation, hashing and expiry. */
  async function sendCode(found: Lookup) {
    setError(null);
    setSubmitting(true);
    try {
      const raw = identifier.trim();
      // shouldCreateUser:false is the safety catch — even if the lookup were
      // wrong, Supabase must never mint a new account from this screen.
      const payload = found.kind === 'email'
        ? { email: raw.toLowerCase(), options: { shouldCreateUser: false } }
        : { phone: toE164(raw) as string, options: { shouldCreateUser: false } };
      const { error: otpErr } = await supabase.auth.signInWithOtp(payload);
      if (otpErr) throw otpErr;
      setStep('code');
      // 60, NOT 30. Supabase refuses a second code inside 60 seconds of the
      // first. At 30 the button lit up while the server was still saying no,
      // so the eager tap got an error instead of a code — and the rate-limit
      // branch below phrases it as "Too many attempts", which is a frightening
      // thing to read when you have asked exactly twice. Matching the server
      // turns a failure into a button that simply isn't ready yet.
      setResendIn(60);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not send the code.';
      setError(/rate|too many/i.test(msg)
        ? 'Too many attempts. Please wait a few minutes and try again.'
        : msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const trimmedEmail = identifier.toLowerCase().trim();
    try {
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
      if (!data?.session) throw new Error('Login failed. Please try again.');
      await finish(trimmedEmail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setSubmitting(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const raw = identifier.trim();
    try {
      const payload = lookup?.kind === 'email'
        ? { email: raw.toLowerCase(), token: code.trim(), type: 'email' as const }
        : { phone: toE164(raw) as string, token: code.trim(), type: 'sms' as const };
      const { data, error: vErr } = await supabase.auth.verifyOtp(payload);
      if (vErr) {
        if (/expired/i.test(vErr.message)) {
          throw new Error('That code has expired — send yourself a new one.');
        }
        throw new Error('That code doesn’t match. Check it and try again.');
      }
      if (!data?.session) throw new Error('Login failed. Please try again.');
      await finish(data.user?.email || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setSubmitting(false);
    }
  }

  function reset() {
    setStep('identify');
    setLookup(null);
    setCode('');
    setPassword('');
    setError(null);
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

        {/* ── STEP 1 — who are you ─────────────────────────────────── */}
        {step === 'identify' && (
          <form onSubmit={(e) => { e.preventDefault(); handleContinue('code'); }}>
            <div className={styles.formGroup}>
              <label htmlFor="identifier">Email or Phone Number</label>
              <input
                id="identifier"
                type="text"
                inputMode="email"
                placeholder="your@email.com or (555) 555-5555"
                value={identifier}
                onChange={(e) => { setIdentifier(e.target.value); setError(null); }}
                required
                autoComplete="username"
              />
              <small style={{ display: 'block', marginTop: '.45rem', color: 'var(--muted)', fontSize: '.72rem', lineHeight: 1.45 }}>
                Enter the email or phone you used when you created your account.
                A 6-digit login code will be sent to you.
              </small>
            </div>

            <button
              type="submit"
              className={styles.submitBtn}
              disabled={submitting}
            >
              {submitting ? 'Sending…' : 'Send Me a Code'}
            </button>

            {/* Stays a link under the button rather than becoming the primary
                action. canPassword comes back true for ANY email account,
                including hosts — who have no password at all. Promote this and
                every host who taps it lands on a password box they can't fill,
                and hosts are most of the email logins here.

                Only shown for an email. A phone account has no password unless
                the host deliberately added one. */}
            {isEmail && (
              <button
                type="button"
                onClick={() => handleContinue('password')}
                disabled={submitting}
                style={{
                  display: 'block', width: '100%', marginTop: '.75rem',
                  background: 'none', border: 'none', padding: '.4rem',
                  color: 'var(--neon, #00e0a4)', fontWeight: 700,
                  fontSize: '.82rem', cursor: 'pointer', textDecoration: 'underline',
                }}
              >
                Use my password instead
              </button>
            )}
          </form>
        )}

        {/* ── STEP 2a — password (the DJ path, unchanged) ───────────── */}
        {step === 'password' && (
          <form onSubmit={handlePasswordSubmit}>
            <div className={styles.formGroup}>
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                type="email"
                value={identifier}
                readOnly
                style={{ background: 'rgba(255,255,255,0.05)' }}
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
                autoFocus
              />
            </div>

            <button type="submit" className={styles.submitBtn} disabled={submitting}>
              {submitting ? 'Logging In...' : 'Log In'}
            </button>

            <button
              type="button"
              onClick={() => lookup && sendCode(lookup)}
              disabled={submitting}
              style={{
                display: 'block', width: '100%', marginTop: '.75rem',
                background: 'none', border: 'none', padding: '.4rem',
                color: 'var(--neon, #00e0a4)', fontWeight: 700,
                fontSize: '.82rem', cursor: 'pointer', textDecoration: 'underline',
              }}
            >
              Email me a code instead
            </button>
          </form>
        )}

        {/* ── STEP 2b — the code ───────────────────────────────────── */}
        {step === 'code' && (
          <form onSubmit={handleCodeSubmit}>
            <p style={{ color: 'var(--muted, #8a8aa0)', fontSize: '.85rem', marginBottom: '1rem' }}>
              {lookup?.linkOnVerify && (
                <>We found your account. </>
              )}
              We sent a 6-digit code to{' '}
              <strong style={{ color: 'var(--white, #fff)' }}>
                {lookup?.kind === 'email' ? identifier.trim() : maskPhone(toE164(identifier) || identifier)}
              </strong>.
            </p>

            <div className={styles.formGroup}>
              <label htmlFor="code">Verification Code</label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
                autoComplete="one-time-code"
                autoFocus
                style={{ letterSpacing: '.4em', fontSize: '1.1rem', textAlign: 'center' }}
              />
            </div>

            <button type="submit" className={styles.submitBtn} disabled={submitting || code.length < 6}>
              {submitting ? 'Checking…' : 'Log In'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.75rem', fontSize: '.78rem' }}>
              <button
                type="button"
                onClick={() => lookup && sendCode(lookup)}
                disabled={submitting || resendIn > 0}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  color: resendIn > 0 ? 'var(--muted, #8a8aa0)' : 'var(--neon, #00e0a4)',
                  fontWeight: 700, cursor: resendIn > 0 ? 'default' : 'pointer',
                }}
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </button>
              <button
                type="button"
                onClick={reset}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  color: 'var(--muted, #8a8aa0)', fontWeight: 700, cursor: 'pointer',
                }}
              >
                Use something else
              </button>
            </div>
          </form>
        )}

        {/* Forgot Password removed: the code IS the recovery path. A host has
            no password to forget; a DJ who forgot theirs taps "Send Me a Code",
            gets in, and can reset it from account settings. The link only
            duplicated that, less directly.

            "Sign up" link removed too — the Login / Sign Up tabs sit right at
            the top of this same card, so a second sign-up prompt at the bottom
            pointed at a control already on screen. */}

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
