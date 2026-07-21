'use client';

// BookingLoginGate — what a logged-out visitor sees when they pick a date.
//
// IT USED TO BE A DEAD END DRESSED AS A MODAL. It said "log in or create an
// account" and both buttons navigated away, carrying ?date=&book=1 so the
// profile could rebuild itself afterwards. Every one of those visitors had
// just expressed the strongest intent they can express on the site — picking
// a date on a specific DJ — and we answered by sending them to a different
// page. The ones who came back came back to a page they had to re-read.
//
// So the account now gets created HERE, in the box, and the booking form
// opens behind it the moment the session lands. Nobody leaves the profile.
//
// The whole signup is HostCodeSignup, unchanged — the same component the
// /signup page uses. It's identifier → code → account, and it now takes an
// onDone callback so it hands control back instead of navigating. Two copies
// of a signup flow would be one copy plus a copy that drifts.
//
// LOGGING IN IS STILL A LINK OUT, deliberately. Inline login means rebuilding
// the single-field lookup and the password path for DJs inside a modal, and
// the person who already has an account is not the person this box exists
// for. They get a link that preserves the existing redirect behaviour exactly.
//
// Used by MobilePublicCalendar (mobile DJs) and ProfileView (clubs/venues).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import HostCodeSignup from '@/app/(simple)/signup/HostCodeSignup';
// The two-word name rule is NOT imported here on purpose — HostCodeSignup
// enforces it and reports back through onNameError below. A second copy of the
// check in this file would be a second place for it to drift.
import styles from './bookingLoginGate.module.css';
// The signup form's own field styling, so the name box in here is the same
// control as the one on /signup rather than a lookalike.
import formStyles from '@/app/(simple)/signup/signup.module.css';

interface Props {
  djName: string;
  djSlug: string;
  // YYYY-MM-DD format. We display it as a friendly "May 14, 2026".
  dateKey: string;
  onClose: () => void;
  /**
   * Fired once the account exists and the session is live. The parent closes
   * this and opens the booking form for the date they originally picked.
   *
   * Optional so the component still renders if a caller hasn't wired it up —
   * it just falls back to closing, and they tap the date again.
   */
  onAuthed?: (dateKey: string) => void;
}

function formatNiceDate(dKey: string): string {
  // Parse without TZ shifts: YYYY-MM-DD → local Date at noon
  const [y, m, d] = dKey.split('-').map(Number);
  if (!y || !m || !d) return dKey;
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  return dt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function BookingLoginGate({
  djName, djSlug, dateKey, onClose, onAuthed,
}: Props) {
  const router = useRouter();

  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  // Phone by default HERE, unlike /signup which defaults to email. This box
  // is reached almost entirely from a phone, tapping a date on a DJ's profile,
  // and the OS autofills the SMS code. The usual reason email leads — that
  // every later message needs it — doesn't bite here, because the booking
  // form on the very next screen collects the email regardless. So signing up
  // by phone is the easier tap and costs nothing downstream. Standalone signup
  // keeps email; the switch link covers anyone who wants the other channel.
  const [method, setMethod] = useState<'email' | 'phone'>('phone');

  // Where an existing user lands after logging in — back here, with the date
  // pre-selected. Unchanged from before; the login path still works exactly
  // as it did.
  const redirectTarget = `/${encodeURIComponent(djSlug)}?date=${encodeURIComponent(dateKey)}&book=1`;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.box}
        onClick={(e) => e.stopPropagation()}
        style={{
          // The box was built for a title and two buttons. It is now a form,
          // and both of its defaults are wrong for one:
          //
          // text-align: center would centre every label and hint, which reads
          // as a poster rather than something to fill in.
          //
          // No max-height meant that on a short phone — the exact device most
          // of these visitors are on — a form taller than the viewport would
          // be clipped at BOTH ends, because the backdrop centres it. There'd
          // be no way to scroll to the button. Capping the height and letting
          // it scroll internally is what makes it usable at 667px tall.
          textAlign: 'left',
          maxHeight: 'calc(100vh - 3rem)',
          overflowY: 'auto',
          // The shared .box uses var(--card), a lifted grey meant to separate
          // a panel from the page behind it. Here the page behind it is
          // already dimmed by the backdrop, so the grey just read as a
          // different shade of nothing. Black matches the site.
          background: 'var(--black,#000)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className={styles.closeBtn}
          aria-label="Close"
        >
          ✕
        </button>

        <h2 className={styles.title}>Create your account</h2>
        {/* Names the DJ and the date so the box reads as a continuation of
            what they just clicked, not an interruption of it. */}
        <p className={styles.body}>
          To book <strong>{djName}</strong> for{' '}
          <strong>{formatNiceDate(dateKey)}</strong> create a free account
          below.
        </p>

        <div className={formStyles.formGroup}>
          {nameError && (
            <div className={`${formStyles.alert} ${formStyles.alertError}`}>{nameError}</div>
          )}
          <label htmlFor="gate-name">Your Name</label>
          <input
            id="gate-name"
            type="text"
            placeholder="Jane Smith"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(null); }}
            required
            style={nameError ? { borderColor: 'var(--error)' } : undefined}
          />
          <small style={{ display: 'block', marginTop: '.35rem', color: 'var(--muted)', fontSize: '.7rem' }}>
            First and last name.
          </small>
        </div>

        <HostCodeSignup
          method={method}
          name={name}
          country={null}
          destination={redirectTarget}
          onNameError={setNameError}
          canSwitchMethod
          onSwitchMethod={() => setMethod((m) => (m === 'email' ? 'phone' : 'email'))}
          // The reason this component exists inline. Without it HostCodeSignup
          // would navigate, and the booking form behind this modal — along with
          // anything already typed into it — would be gone.
          onDone={() => {
            if (onAuthed) onAuthed(dateKey);
            else onClose();
          }}
        />

        <p className={styles.body} style={{ marginTop: '1rem', fontSize: '.78rem' }}>
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => router.push(`/login?redirect=${encodeURIComponent(redirectTarget)}`)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--neon)',
              fontWeight: 700,
              fontSize: 'inherit',
              cursor: 'pointer',
            }}
          >
            Log in
          </button>
        </p>
      </div>
    </div>
  );
}
