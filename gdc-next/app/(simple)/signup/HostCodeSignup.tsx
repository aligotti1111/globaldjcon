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
import { isFullName, normalizeName, FULL_NAME_ERROR } from '@/lib/fullName';
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
  /**
   * Report a problem with the NAME back to whoever owns that field.
   *
   * The name input lives in the parent, above this component, so an error
   * rendered down here appears below the box it's complaining about — the
   * reader has to look past the field, read the message, then look back up.
   * Handing it to the parent lets it sit directly above the input and turn
   * the box red, which is where people already look for it.
   *
   * Optional: without it this falls back to its own error line, so the
   * component still behaves standalone.
   */
  onNameError?: (msg: string | null) => void;
  /**
   * Whether the "switch to phone / email" link is offered at all. False on a
   * claim_booking invite, which is pinned to one address.
   */
  canSwitchMethod?: boolean;
  /** Flip the parent's method. The parent owns it; this just asks. */
  onSwitchMethod?: () => void;
  /**
   * Called instead of navigating, once the account exists and the session is
   * live. Supplied when this is embedded in a modal — a booking form sitting
   * behind it would lose everything typed into it if we did a full page load.
   * Without it, the standalone signup page behaviour is unchanged.
   */
  onDone?: () => void;
}

export default function HostCodeSignup({
  method, name, country, prefillEmail, lockedEmail, destination, onNameError,
  canSwitchMethod, onSwitchMethod, onDone,
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
  /** Hover/focus state for the switch link's underline. Focus is included so
   *  it reacts to a keyboard the same way it reacts to a mouse. */
  const [switchHover, setSwitchHover] = useState(false);

  /**
   * Whitespace collapsed once, here, so "Jane   Smith" doesn't reach the
   * database with the extra spaces and then get printed onto a contract.
   * Every write below uses this rather than the raw prop.
   */
  const cleanName = normalizeName(name);

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

  /**
   * Send a name problem to the field it belongs to, falling back to the local
   * error line when nobody's listening.
   */
  function failName(msg: string) {
    if (onNameError) onNameError(msg);
    else setError(msg);
  }

  async function sendCode() {
    setError(null);
    onNameError?.(null);
    // Checked HERE, before the code goes out, rather than on the screen after
    // it. A host who's already read a text and typed six digits has moved on
    // from the name field; sending them back to it then reads as the form
    // moving the goalposts. The two messages are also different problems —
    // "you left it blank" and "we need your surname too" — so they're kept
    // apart rather than folded into one vague "check your name".
    if (!cleanName) { failName('Please enter your name.'); return; }
    if (!isFullName(cleanName)) { failName(FULL_NAME_ERROR); return; }
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
          data: { role: 'host', name: cleanName, country },
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

      // THIS USED TO BE AN UPSERT, AND THAT WAS DANGEROUS.
      //
      // signInWithOtp with shouldCreateUser does NOT fail when the identifier
      // already belongs to somebody — it just signs that person in. So a DJ
      // who wandered onto host signup and typed their own email got a code,
      // got logged in, and then the upsert rewrote their row with
      // role: 'host'. Their DJ account was demoted, silently, by a form that
      // appeared to be creating a new account.
      //
      // Reachable before; much more reachable now that a signup box appears
      // in front of every visitor trying to book. So: look first, and only
      // write a profile for someone who genuinely doesn't have one. An
      // existing account is left completely alone — they've simply logged in.
      const { data: existingRow } = await supabase
        .from('users')
        .select('id')
        .eq('id', data.user.id)
        .maybeSingle<{ id: string }>();

      if (!existingRow) {
        // Written AFTER the session exists — RLS policies check auth.uid(), so
        // an insert sent before the session is live is rejected and the
        // account ends up with no users row at all.
        const e164 = isPhone ? (toE164(phone) as string) : null;
        const { error: rowErr } = await supabase.from('users').insert({
          id: data.user.id,
          role: 'host',
          name: cleanName,
          country,
          // Email path: they just typed a code sent to that address, which is
          // exactly what the old verification link was proving. Phone path: no
          // email yet — they're asked at their first booking.
          email_verified: !isPhone,
          phone_verified: isPhone,
          signup_method: method,
          // Prefilled from the number they proved they own so notifications
          // work without asking twice. A preference, not the credential.
          ...(e164 ? { sms_phone: e164 } : {}),
        } as unknown as never);
        if (rowErr) console.error('[signup] profile row failed:', rowErr);
      }

      // Ends signed in — no "check your email" step to wait on.
      //
      // Embedded in the booking modal, onDone closes it and lets the form
      // open. A full page load there would throw away everything the visitor
      // had already typed, which is the entire point of doing this inline.
      if (onDone) {
        onDone();
        return;
      }
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

  // The alternative channel, sitting on the bottom lip of the identifier box
  // rather than as a choice presented up front. Underline on hover is state
  // rather than a CSS class: it's the only element on the page that needs it,
  // and a one-off rule in a shared stylesheet is a thing nobody can later tell
  // is a one-off. Focus is wired alongside hover so a keyboard sees the same
  // feedback a mouse does.
  const switchLink = canSwitchMethod && onSwitchMethod ? (
    <button
      type="button"
      onClick={() => { onSwitchMethod(); setError(null); }}
      onMouseEnter={() => setSwitchHover(true)}
      onMouseLeave={() => setSwitchHover(false)}
      onFocus={() => setSwitchHover(true)}
      onBlur={() => setSwitchHover(false)}
      style={{
        // Pushed to the right edge of the field. The left margin under an
        // input is where descriptions sit — the locked-email note uses exactly
        // that spot — so a link there reads as a remark about the field rather
        // than something to click. Right is where escape hatches live.
        display: 'block',
        marginLeft: 'auto',
        marginTop: '.4rem',
        background: 'none',
        border: 'none',
        padding: 0,
        color: 'var(--white,#fff)',
        fontSize: '.72rem',
        fontWeight: 600,
        cursor: 'pointer',
        textDecoration: switchHover ? 'underline' : 'none',
      }}
    >
      {isPhone ? 'Switch to email' : 'Switch to phone'}
    </button>
  ) : null;

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
          {switchLink}
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
          {switchLink}
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
