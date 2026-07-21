'use client';

// InlineLoginForm — the sign-in flow, minus the page.
//
// The /login page owns things a modal must NOT: reading ?redirect, bouncing an
// already-signed-in visitor, the post-verification banner, the admin
// destination. Those are page concerns. What's left — identify → password or
// code → done — is the actual login, and that's what lives here so the header
// modal can reuse it without dragging a page's worth of routing behaviour into
// a popup.
//
// WHAT IS AND ISN'T DUPLICATED
// The security-critical question — "whose account is this identifier?" — is
// NOT reimplemented here. It's answered by /api/auth/lookup-identifier, the
// same server route the login page calls, so the part that must never drift
// has exactly one copy. What this file repeats is the thin client
// orchestration around it (call lookup, then signInWithPassword /
// signInWithOtp / verifyOtp), which is small and calls shared endpoints.
//
// onDone fires only after a real session exists. The caller decides what that
// means — the modal closes itself and refreshes; a page could navigate.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import formStyles from '@/app/(simple)/signup/signup.module.css';

type Step = 'identify' | 'password' | 'code';

interface Lookup {
  kind: 'email' | 'phone';
  found: boolean;
  canPassword: boolean;
  canCode: boolean;
  linkOnVerify?: boolean;
}

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

export default function InlineLoginForm({ onDone }: { onDone: () => void }) {
  const supabase = createClient();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>('identify');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const isEmail = looksLikeEmail(identifier.trim());

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function handleContinue(intent: 'password' | 'code') {
    setError(null);
    const raw = identifier.trim();
    if (!raw) { setError('Enter your email address or phone number.'); return; }
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
        // Never offer to create an account from here — someone who signed up
        // by email and is now typing their phone would take that offer and
        // end up with two accounts. They switch to the Create Account tab
        // deliberately or not at all.
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

  async function sendCode(found: Lookup) {
    setError(null);
    setSubmitting(true);
    try {
      const raw = identifier.trim();
      // shouldCreateUser:false — even if the lookup were wrong, Supabase must
      // never mint a new account from a sign-in.
      const payload = found.kind === 'email'
        ? { email: raw.toLowerCase(), options: { shouldCreateUser: false } }
        : { phone: toE164(raw) as string, options: { shouldCreateUser: false } };
      const { error: otpErr } = await supabase.auth.signInWithOtp(payload);
      if (otpErr) throw otpErr;
      setStep('code');
      setResendIn(60); // Supabase refuses a second code within 60s; match it.
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
      onDone();
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
      onDone();
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

  // ── IDENTIFY ────────────────────────────────────────────────────────
  if (step === 'identify') {
    return (
      <form onSubmit={(e) => { e.preventDefault(); handleContinue('code'); }}>
        {error && <div className={`${formStyles.alert} ${formStyles.alertError}`}>{error}</div>}
        <div className={formStyles.formGroup}>
          <label htmlFor="im-identifier">Email or Phone Number</label>
          <input
            id="im-identifier"
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
        <button type="submit" className={formStyles.submitBtn} disabled={submitting}>
          {submitting ? 'Sending…' : 'Send Me a Code'}
        </button>
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
    );
  }

  // ── PASSWORD ────────────────────────────────────────────────────────
  if (step === 'password') {
    return (
      <form onSubmit={handlePasswordSubmit}>
        {error && <div className={`${formStyles.alert} ${formStyles.alertError}`}>{error}</div>}
        <div className={formStyles.formGroup}>
          <label htmlFor="im-password">Password</label>
          <input
            id="im-password"
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
            required
            autoFocus
            autoComplete="current-password"
          />
        </div>
        <button type="submit" className={formStyles.submitBtn} disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>
        <button
          type="button"
          onClick={reset}
          style={{
            display: 'block', width: '100%', marginTop: '.6rem',
            background: 'none', border: 'none', padding: '.4rem',
            color: 'var(--muted)', fontWeight: 700, fontSize: '.78rem', cursor: 'pointer',
          }}
        >
          Back
        </button>
      </form>
    );
  }

  // ── CODE ────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleCodeSubmit}>
      {error && <div className={`${formStyles.alert} ${formStyles.alertError}`}>{error}</div>}
      <div className={formStyles.formGroup}>
        <label htmlFor="im-code">Verification Code</label>
        <input
          id="im-code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          required
          autoFocus
          autoComplete="one-time-code"
          style={{ letterSpacing: '.4em', fontSize: '1.1rem', textAlign: 'center' }}
        />
      </div>
      <button type="submit" className={formStyles.submitBtn} disabled={submitting || code.length < 6}>
        {submitting ? 'Checking…' : 'Sign In'}
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.75rem', fontSize: '.78rem' }}>
        <button
          type="button"
          onClick={() => lookup && sendCode(lookup)}
          disabled={submitting || resendIn > 0}
          style={{
            background: 'none', border: 'none', padding: 0,
            color: resendIn > 0 ? 'var(--muted)' : 'var(--neon)',
            fontWeight: 700, cursor: resendIn > 0 ? 'default' : 'pointer',
          }}
        >
          {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
        </button>
        <button
          type="button"
          onClick={reset}
          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--muted)', fontWeight: 700, cursor: 'pointer' }}
        >
          Start over
        </button>
      </div>
    </form>
  );
}
