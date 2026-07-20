'use client';

// Host signup, both paths: identifier → 6-digit code → account.
//
// WAS HostPhoneSignup. Email now works the same way, so the phone-specific
// name stopped being true. Hosts have no password at all — the code IS the
// proof, on either channel.
//
// WHY HOSTS AND NOT DJs
// A host signs in rarely: they book, then come back weeks later for the
// planner. A password they invented once and never used again is a password
// they've forgotten, and "forgot password" is four screens and an email. A
// code is one screen and the same email. DJs live in the app daily and their
// browser remembers a password, so DJ and Venue signup keep theirs.
//
// email_verified is set TRUE here on the email path. They typed a code we
// mailed to that address thirty seconds ago — that's the same proof the old
// link flow was after, arrived at more directly.
//
// SUPABASE TEMPLATE DEPENDENCY: email OTP sends a magic LINK by default. The
// Magic Link template has to include {{ .Token }} or the code box has nothing
// to type into. Dashboard → Authentication → Email Templates.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './signup.module.css';

/** Same E.164 shape the SMS helper and the lookup route use. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

interface Props {
  method: 'phone' | 'email';
  /** Collected by the parent before this component is reached. */
  name: string;
  /** Null — host signup no longer asks. Kept so the column stays writable. */
  country: string | null;
  /** Prefilled + locked when they arrived from a claim_booking invite. */
  prefillEmail?: string;
  lockedEmail?: boolean;
  /** Where to send them once they're in. */
  destination: string;
}

export default function HostCodeSignup({
  method, name, country, prefillEmail, lockedEmail, destination,
}: Props) {
  const supabase = createClient();
  const isPhone = method === 'phone';

  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(prefillEmail || '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  // Switching between phone and email mid-signup shouldn't strand the user on
  // a code screen for the channel they just abandoned.
  useEffect(() => {
    setSent(false);
    setCode('');
    setError(null);
  }, [method]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  /** What we're sending to, in the shape Supabase wants. */
  function target(): { phone: string } | { email: string } | null {
    if (isPhone) {
      const e164 = toE164(phone);
      return e164 ? { phone: e164 } : null;
    }
    const e = email.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? { email: e } : null;
  }

  async function sendCode() {
    setError(null);
    if (!name.trim()) { setError('Please enter your name first.'); return; }
    const to = target();
    if (!to) {
      setError(isPhone ? 'Enter a valid phone number.' : 'Enter a valid email address.');
      return;
    }

    setSubmitting(true);
    try {
      // shouldCreateUser:true — this IS the signup. The metadata rides along
      // so the row we write after verification has something to write.
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        ...to,
        options: {
          shouldCreateUser: true,
          data: { role: 'host', name, country },
        },
      } as Parameters<typeof supabase.auth.signInWithOtp>[0]);
      if (otpErr) throw otpErr;
      setSent(true);
      setResendIn(30);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not send the code.';
      setError(
        /rate|too many/i.test(msg)
          ? 'Too many attempts. Please wait a few minutes and try again.'
          : msg,
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const to = target();
    if (!to) { setError('Something went wrong — start again.'); setSubmitting(false); return; }
    try {
      const { data, error: vErr } = await supabase.auth.verifyOtp({
        ...to,
        token: code.trim(),
        type: isPhone ? 'sms' : 'email',
      } as Parameters<typeof supabase.auth.verifyOtp>[0]);
      if (vErr) {
        throw new Error(
          /expired/i.test(vErr.message)
            ? 'That code has expired — send yourself a new one.'
            : 'That code doesn’t match. Check it and try again.',
        );
      }
      if (!data?.user?.id) throw new Error('Sign up failed. Please try again.');

      // WAIT FOR THE SESSION TO ACTUALLY LAND BEFORE GOING ANYWHERE.
      //
      // verifyOtp resolving does not mean the session has finished being
      // written to storage and cookies. window.location.href triggers a full
      // page load, and if it fires first the server renders the next page with
      // no session — freshly signed up and apparently logged out.
      let ready = false;
      for (let i = 0; i < 30; i++) {
        const { data: s } = await supabase.auth.getSession();
        if (s?.session) { ready = true; break; }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!ready) {
        throw new Error(
          'Your account was created, but signing you in timed out. Please log in.',
        );
      }

      // Written AFTER the session exists — RLS policies check auth.uid(), so
      // an upsert sent before the session is live is rejected and the account
      // ends up with no users row at all.
      const e164 = isPhone ? (toE164(phone) as string) : null;
      const { error: rowErr } = await supabase.from('users').upsert({
        id: data.user.id,
        role: 'host',
        name,
        country,
        // Email path: they just typed a code sent to that address, which is
        // exactly what the old verification link was proving. Phone path: no
        // email yet — they're asked at their first booking.
        email_verified: !isPhone,
        phone_verified: isPhone,
        signup_method: method,
        // Prefilled from the number they proved they own so notifications work
        // without asking twice. A preference, not the credential.
        ...(e164 ? { sms_phone: e164 } : {}),
      } as unknown as never, { onConflict: 'id' });
      if (rowErr) console.error('[signup] profile row failed:', rowErr);

      // Ends signed in — no "check your email" step to wait on.
      window.location.href = destination || '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
      setSubmitting(false);
    }
  }

  // ── Code entry ────────────────────────────────────────────────────
  if (sent) {
    return (
      <form onSubmit={verify}>
        {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}

        <p style={{ color: 'var(--muted)', fontSize: '.85rem', marginBottom: '1rem' }}>
          We sent a 6-digit code to{' '}
          <strong style={{ color: 'var(--white,#fff)' }}>
            {isPhone ? phone : email.trim()}
          </strong>.
        </p>

        <div className={styles.formGroup}>
          <label htmlFor="host-code">Verification Code</label>
          <input
            id="host-code"
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
          {submitting ? 'Checking…' : 'Create My Account'}
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.75rem', fontSize: '.78rem' }}>
          <button
            type="button"
            onClick={sendCode}
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
            onClick={() => { setSent(false); setCode(''); setError(null); }}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: 'var(--muted)', fontWeight: 700, cursor: 'pointer',
            }}
          >
            {isPhone ? 'Change number' : 'Change email'}
          </button>
        </div>
      </form>
    );
  }

  // ── Identifier entry ──────────────────────────────────────────────
  return (
    <>
      {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}

      {isPhone ? (
        <div className={styles.formGroup}>
          <label htmlFor="host-phone">Mobile Number</label>
          <input
            id="host-phone"
            type="tel"
            inputMode="tel"
            placeholder="(555) 555-5555"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setError(null); }}
            required
            autoComplete="tel"
          />
        </div>
      ) : (
        <div className={styles.formGroup}>
          <label htmlFor="host-email">Email Address</label>
          <input
            id="host-email"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(null); }}
            required
            readOnly={!!lockedEmail}
            autoComplete="email"
            style={lockedEmail ? { background: 'rgba(255,255,255,0.05)', cursor: 'not-allowed' } : undefined}
          />
          {lockedEmail && (
            <small style={{ display: 'block', marginTop: '.35rem', color: 'var(--muted)', fontSize: '.7rem' }}>
              Email is locked to match your booking invitation.
            </small>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={sendCode}
        className={styles.submitBtn}
        disabled={submitting}
      >
        {submitting ? 'Sending…' : isPhone ? 'Text Me a Code' : 'Email Me a Code'}
      </button>

      <p style={{ marginTop: '.6rem', color: 'var(--muted)', fontSize: '.7rem', textAlign: 'center' }}>
        No password needed.
      </p>
    </>
  );
}
