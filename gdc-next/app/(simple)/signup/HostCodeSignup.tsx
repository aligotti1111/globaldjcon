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
import { ConsentCheckbox } from './SignupFlow';
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
  /**
   * Whether the person has accepted the Terms & Privacy Policy. Sending the
   * code IS the account creation, so it's gated on this being true. The consent
   * checkbox itself lives in the parent, at the top of the form; when consent
   * is missing we call onConsentError so the parent can flag it there.
   */
  agreed?: boolean;
  onAgreedChange?: (v: boolean) => void;
  onConsentError?: () => void;
  /** When true (submitted without accepting), highlight the consent in red. */
  consentError?: boolean;
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
  method, name, country, agreed, onAgreedChange, onConsentError, consentError, prefillEmail, lockedEmail, destination, onNameError,
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
  // True once we detect the identifier already had an account and Supabase
  // signed them in rather than creating a new one — shows a 'welcome back' notice.
  const [welcomeBack, setWelcomeBack] = useState(false);

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
    // Consent is required before the account is created (the code IS the
    // signup). The checkbox is at the top of the form; ask the parent to flag
    // the miss there rather than surfacing it down here.
    if (agreed === false) {
      onConsentError?.();
      return;
    }
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

    // DUPLICATE-ACCOUNT GUARD. DJ and Venue signup check this before creating;
    // host signup didn't, so a host who already has an account under this exact
    // identifier (same phone login, or same email) could start a second one.
    // lookup-identifier now only reports an account for a REAL sign-in identity
    // — an auth email/phone — never a number merely saved for notifications or
    // typed on a booking, so this can't misfire on a first-time number. Best
    // effort: a failed/slow check falls through to signInWithOtp, which still
    // signs an existing user in rather than duplicating (handled after verify).
    try {
      const identifier = isPhone ? (to as { phone: string }).phone : (to as { email: string }).email;
      const res = await fetch('/api/auth/lookup-identifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      if (res.ok) {
        const info = (await res.json().catch(() => ({}))) as { found?: boolean };
        if (info?.found) {
          setError(
            isPhone
              ? 'This number already has an account — log in instead (we’ll text you a code).'
              : 'This email already has an account — log in instead.',
          );
          setSubmitting(false);
          return;
        }
      }
    } catch { /* network hiccup — let signInWithOtp handle the existing-user case */ }

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
      // 60, NOT 30. Supabase refuses a second code inside 60 seconds of the
      // first. At 30 the button lit up while the server was still saying no,
      // so the eager tap got an error instead of a code — and the rate-limit
      // branch below phrases it as "Too many attempts", which is a frightening
      // thing to read when you have asked exactly twice. Matching the server
      // turns a failure into a button that simply isn't ready yet.
      setResendIn(60);
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

      // THE "ALREADY EXISTS" CHECK — and why a bare row-existence test is wrong.
      //
      // signInWithOtp with shouldCreateUser does NOT fail when the identifier
      // already belongs to somebody — it just signs that person in. So a DJ who
      // wandered onto host signup and typed their own email got a code, got
      // logged in, and then an upsert rewrote their row with role: 'host',
      // silently demoting their DJ account. That must never happen.
      //
      // But "a users row exists" does NOT mean "a pre-existing account." A DB
      // trigger (on_auth_user_created → handle_new_user) writes a users row the
      // instant the auth user is created — i.e. when the code is SENT, before
      // this verify. So a brand-new, first-time host ALWAYS has a row by the
      // time we look, and a bare existence test flags every single phone signup
      // as "already exists", skips setting phone_verified/sms_phone, and tells a
      // first-time user they already have an account.
      //
      // The real distinction: a fresh trigger-made SHELL (nothing verified, no
      // notification number) belongs to THIS signup and must be completed; an
      // established account (already verified, or created well before now) is a
      // genuine returning user and must be left untouched.
      const { data: existingRow } = await supabase
        .from('users')
        .select('id, role, name, country, phone_verified, email_verified, sms_phone')
        .eq('id', data.user.id)
        .maybeSingle<{ id: string; role: string | null; name: string | null; country: string | null; phone_verified: boolean | null; email_verified: boolean | null; sms_phone: string | null }>();

      // A fresh trigger shell: nothing proven yet, no saved number. A COMPLETED
      // account always carries at least one verified flag (or a saved number),
      // so the shell test alone separates "this signup's own row" from a real
      // returning account — no fragile timestamp window needed.
      const isTriggerShell = !!existingRow
        && !existingRow.phone_verified
        && !existingRow.email_verified
        && !existingRow.sms_phone;
      // Never let the host form touch an account that already has a non-host
      // role — a DJ or venue who landed here must be left completely alone.
      // (The trigger seeds role from signup metadata, so a genuine host shell
      // reads 'host' here.)
      const hasOtherRole = !!existingRow?.role && existingRow.role !== 'host';
      // Pre-existing when there's a non-host-role account, OR a row that is not a
      // fresh shell. Everything else is this signup's own (trigger-made) row.
      const isReturningAccount = hasOtherRole || (!!existingRow && !isTriggerShell);

      // Embedded in the booking modal, onDone closes it and lets the form open;
      // a full page load would throw away everything the visitor already typed.
      const finishUp = () => {
        if (onDone) { onDone(); return; }
        window.location.href = destination || '/';
      };

      if (isReturningAccount) {
        // A real existing account — Supabase signed them into it rather than
        // creating a duplicate. Say so, then continue, and leave their row alone
        // (this is what protects a DJ who landed on host signup).
        setWelcomeBack(true);
        setTimeout(finishUp, 2000);
        return;
      }

      // This signup's own account — complete the profile AFTER the session exists
      // (RLS checks auth.uid(), so a write before the session is live is
      // rejected). The handle_new_user trigger already seeded id/role/name/country
      // from the signup metadata, so we only ADD proof of ownership: the verified
      // flag for the channel they just confirmed, plus (phone) their notification
      // number. We never overwrite role, nor the OTHER channel's flag — so even a
      // legacy all-null row that merely LOOKS like a shell cannot be clobbered.
      // name/country are filled only when the trigger left them empty.
      const e164 = isPhone ? (toE164(phone) as string) : null;
      const verifyPatch: Record<string, unknown> = { signup_method: method };
      if (isPhone) {
        verifyPatch.phone_verified = true;
        if (e164) verifyPatch.sms_phone = e164;
      } else {
        verifyPatch.email_verified = true;
      }
      let rowErr: { message?: string } | null = null;
      if (existingRow) {
        if (!existingRow.name && cleanName) verifyPatch.name = cleanName;
        if (!existingRow.country && country) verifyPatch.country = country;
        ({ error: rowErr } = await supabase
          .from('users')
          .update(verifyPatch as unknown as never)
          .eq('id', data.user.id));
      } else {
        // The trigger didn't create a row (shouldn't happen) — write the full one.
        ({ error: rowErr } = await supabase.from('users').insert({
          id: data.user.id,
          role: 'host',
          name: cleanName,
          country,
          email_verified: !isPhone,
          phone_verified: isPhone,
          signup_method: method,
          ...(e164 ? { sms_phone: e164 } : {}),
        } as unknown as never));
      }
      if (rowErr) console.error('[signup] profile row failed:', rowErr);

      finishUp();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
      setSubmitting(false);
    }
  }

  // ── Already-registered notice ─────────────────────────────────────
  // Shown for a beat when the identifier turned out to belong to an existing
  // account, so being signed in doesn't look like nothing happened.
  if (welcomeBack) {
    return (
      <div
        style={{
          textAlign: 'center', padding: '1.4rem 1.1rem',
          border: '1px solid var(--neon,#00e0a4)', borderRadius: 10,
          background: 'rgba(0,224,164,.06)',
        }}
      >
        <div style={{ fontWeight: 800, color: 'var(--white,#fff)', fontSize: '1rem', marginBottom: '.4rem' }}>
          You already have an account
        </div>
        <p style={{ color: 'var(--muted)', fontSize: '.85rem', margin: 0, lineHeight: 1.5 }}>
          This {isPhone ? 'number' : 'email address'} is already registered, so we&apos;ve signed you
          in instead of creating a new account. One moment&hellip;
        </p>
      </div>
    );
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

      {onAgreedChange && (
        <ConsentCheckbox id="host-agree" checked={!!agreed} onChange={onAgreedChange} error={!!consentError} />
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
