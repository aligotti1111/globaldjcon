'use client';

// Change the phone number a host signs in with.
//
// WHY THIS IS VERIFIED WHEN THE EMAIL ISN'T
// On this same page a host edits their email freely — no password, no code —
// because that email is a delivery address. Get it wrong and a contract goes
// to the wrong inbox, which is annoying and fixable.
//
// The phone is different: for a host it IS the credential. There's no password
// to fall back on. If we let them save an unverified number, a single typo
// would lock them out of their own account permanently, with their bookings
// inside it.
//
// So the code goes to the NEW number and the switch only happens after they
// enter it. If the text never arrives, nothing changed and the old number
// still works. That property is the whole point of the flow.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './accountSettings.module.css';

/** Same E.164 shape used by the SMS helper, signup and the login lookup. */
function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** "+19175551234" → "(917) 555-1234". Strips the country code FIRST — with
 *  11 digits a naive formatter shifts every group left and prints a
 *  plausible-looking wrong number. */
function pretty(raw: string | null): string {
  const d = (raw || '').replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length !== 10) return raw || '';
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

export default function HostPhoneCard({
  userId,
  currentPhone,
  currentSmsPhone,
}: {
  userId: string;
  /** The auth phone — what they log in with. Empty for email-signup hosts. */
  currentPhone: string;
  /** users.sms_phone — the notification number, managed on /notifications. */
  currentSmsPhone: string;
}) {
  const supabase = createClient();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode() {
    setAlert(null);
    const e164 = toE164(phone);
    if (!e164) {
      setAlert({ type: 'error', msg: 'Enter a valid phone number.' });
      return;
    }
    if (currentPhone && toE164(currentPhone) === e164) {
      setAlert({ type: 'error', msg: 'That’s already your sign-in number.' });
      return;
    }
    setBusy(true);
    try {
      // Supabase sends the code to the NEW number and leaves the account on
      // the old one until it's verified below.
      const { error } = await supabase.auth.updateUser({ phone: e164 });
      if (error) throw error;
      setSent(true);
      setResendIn(30);
      setAlert(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not send the code.';
      setAlert({
        type: 'error',
        msg: /already|registered|exists/i.test(msg)
          ? 'That number already signs in to another account.'
          : msg,
      });
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setAlert(null);
    const e164 = toE164(phone) as string;
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: e164,
        token: code.trim(),
        type: 'phone_change',
      });
      if (error) {
        throw new Error(
          /expired/i.test(error.message)
            ? 'That code has expired — send a new one.'
            : 'That code doesn’t match. Check it and try again.',
        );
      }

      // If their notification number was the old sign-in number, move it too.
      // Otherwise texts keep going to a phone they no longer have — and they'd
      // have no way to know, because the failure is silent. A number they
      // deliberately set to something else is left alone.
      const oldE164 = toE164(currentPhone);
      const smsE164 = toE164(currentSmsPhone);
      if (smsE164 && oldE164 && smsE164 === oldE164) {
        await supabase
          .from('users')
          .update({ sms_phone: e164 } as unknown as never)
          .eq('id', userId);
      }

      setAlert({ type: 'success', msg: `✓ You'll now sign in with ${pretty(e164)}.` });
      setSent(false);
      setCode('');
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setAlert({ type: 'error', msg: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.card}>
      <h2>Phone Number</h2>
      {alert && (
        <div
          className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}
        >
          {alert.msg}
        </div>
      )}

      {currentPhone ? (
        <p style={{ color: 'var(--muted)', fontSize: '.8rem', marginBottom: '1rem' }}>
          You sign in with <strong style={{ color: 'var(--white,#fff)' }}>{pretty(currentPhone)}</strong>.
        </p>
      ) : (
        <p style={{ color: 'var(--muted)', fontSize: '.8rem', marginBottom: '1rem' }}>
          Add a phone number so you can sign in with a text code.
        </p>
      )}

      {!sent ? (
        <>
          <div className={styles.formGroup}>
            <label>{currentPhone ? 'New Phone Number' : 'Phone Number'}</label>
            <input
              type="tel"
              inputMode="tel"
              placeholder="(555) 555-5555"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setAlert(null); }}
            />
            <small style={{ display: 'block', marginTop: '.4rem', color: 'var(--muted)', fontSize: '.72rem', lineHeight: 1.4 }}>
              We&apos;ll text a code to the new number. Nothing changes until you enter it.
            </small>
          </div>
          <button type="button" className={styles.saveBtn} disabled={busy} onClick={sendCode}>
            {busy ? 'Sending…' : 'Send Code'}
          </button>
        </>
      ) : (
        <>
          <div className={styles.formGroup}>
            <label>Enter the code sent to {pretty(toE164(phone))}</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={8}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              autoFocus
              style={{ letterSpacing: '.3em', textAlign: 'center' }}
            />
          </div>
          <button type="button" className={styles.saveBtn} disabled={busy || code.length < 6} onClick={verify}>
            {busy ? 'Checking…' : 'Confirm New Number'}
          </button>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.6rem', fontSize: '.76rem' }}>
            <button
              type="button"
              onClick={sendCode}
              disabled={busy || resendIn > 0}
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
              onClick={() => { setSent(false); setCode(''); setAlert(null); }}
              style={{ background: 'none', border: 'none', padding: 0, color: 'var(--muted)', fontWeight: 700, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
