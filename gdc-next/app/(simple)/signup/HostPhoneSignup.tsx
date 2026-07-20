'use client';

// The phone half of host signup: number → 6-digit code → account.
//
// WHY THIS IS ITS OWN FILE
// signup/page.tsx already carries three forms and a type switcher. Folding a
// second signup mechanism into HostForm would have meant one component with two
// unrelated flows sharing a submit handler, which is how the DJ and Venue forms
// end up broken by a change that had nothing to do with them. This is imported
// by HostForm and renders in place of the email fields when the host picks
// Phone — nothing else on the page knows it exists.
//
// Supabase does the code itself: generation, hashing, expiry and attempt limits
// are its problem, not ours. We only ask for it and check the answer.

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
  /** Collected by the parent before this component is reached. */
  name: string;
  /** Null — host signup no longer asks. Kept so the column stays writable. */
  country: string | null;
  /** Where to send them once they're in. */
  destination: string;
}

export default function HostPhoneSignup({ name, country, destination }: Props) {
  const supabase = createClient();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode() {
    setError(null);
    if (!name.trim()) { setError('Please enter your name first.'); return; }
    const e164 = toE164(phone);
    if (!e164) { setError('Enter a valid phone number.'); return; }

    setSubmitting(true);
    try {
      // shouldCreateUser:true — this IS the signup. The metadata rides along so
      // the row we write after verification has something to write.
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        phone: e164,
        options: {
          shouldCreateUser: true,
          data: { role: 'host', name, country },
        },
      });
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
    const e164 = toE164(phone) as string;
    try {
      const { data, error: vErr } = await supabase.auth.verifyOtp({
        phone: e164,
        token: code.trim(),
        type: 'sms',
      });
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
      // no session — you get bounced back out, freshly signed up and
      // apparently logged out. The email path never hit this because it stops
      // on a success screen instead of navigating.
      //
      // Poll rather than guess at a delay: it leaves as soon as the session is
      // readable, and gives up after ~3s rather than hanging forever.
      let ready = false;
      for (let i = 0; i < 30; i++) {
        const { data: s } = await supabase.auth.getSession();
        if (s?.session) { ready = true; break; }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!ready) {
        throw new Error('Your account was created, but signing you in timed out. Please log in with your number.');
      }

      // The profile row, written AFTER the session exists — RLS policies check
      // auth.uid(), so an upsert sent before the session is live is rejected
      // and the account ends up with no users row at all.
      //
      // `email_verified` stays false: they haven't given us an email yet.
      // They'll be asked at their first booking and it lands in contact_email.
      //
      // sms_phone is prefilled from the number they just proved they own, so
      // notifications work without asking twice. It's a preference, not the
      // credential — the credential lives in auth.
      const { error: rowErr } = await supabase.from('users').upsert({
        id: data.user.id,
        role: 'host',
        name,
        country,
        email_verified: false,
        phone_verified: true,
        signup_method: 'phone',
        sms_phone: e164,
      } as unknown as never, { onConflict: 'id' });
      // Don't strand them on a blank error if only the profile write failed —
      // they ARE signed in, and the row can be repaired later. But say so,
      // rather than pretending everything worked.
      if (rowErr) console.error('[signup] profile row failed:', rowErr);

      // Phone signup ends signed in — there's no "check your email" step to
      // wait on, so go straight where they were headed.
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
          <strong style={{ color: 'var(--white,#fff)' }}>{phone}</strong>.
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
            Change number
          </button>
        </div>
      </form>
    );
  }

  // ── Number entry ──────────────────────────────────────────────────
  return (
    <>
      {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}

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
        <small style={{ display: 'block', marginTop: '.35rem', color: 'var(--muted)', fontSize: '.7rem' }}>
          We&apos;ll text you a code. No password needed.
        </small>
      </div>

      <button
        type="button"
        onClick={sendCode}
        className={styles.submitBtn}
        disabled={submitting}
      >
        {submitting ? 'Sending…' : 'Text Me a Code'}
      </button>
    </>
  );
}
