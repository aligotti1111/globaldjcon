'use client';

// BookingLoginGate — modal shown when a logged-out visitor tries to book
// a DJ. Tells them which DJ + which date they're trying to book, and gives
// Log In / Sign Up buttons that pass a redirect param so they land back
// on this profile (with the same date pre-selected) after auth.
//
// Used by MobilePublicCalendar's handleBookClick when !isLoggedIn.

import { useRouter } from 'next/navigation';
import styles from './bookingLoginGate.module.css';

interface Props {
  djName: string;
  djSlug: string;
  // YYYY-MM-DD format. We display it as a friendly "May 14, 2026".
  dateKey: string;
  onClose: () => void;
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

export default function BookingLoginGate({ djName, djSlug, dateKey, onClose }: Props) {
  const router = useRouter();

  // Where to send the user after they auth — back to this profile with
  // the date pre-selected so the booking flow continues seamlessly.
  // book=1 is a hint we'll read on the profile page to scroll/open the
  // booking form automatically.
  const redirectTarget = `/${encodeURIComponent(djSlug)}?date=${encodeURIComponent(dateKey)}&book=1`;

  function goLogin() {
    router.push(`/login?redirect=${encodeURIComponent(redirectTarget)}`);
  }

  function goSignup() {
    router.push(`/signup?redirect=${encodeURIComponent(redirectTarget)}`);
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.box} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className={styles.closeBtn}
          aria-label="Close"
        >
          ✕
        </button>

        <div className={styles.icon}>🔒</div>
        <h2 className={styles.title}>Sign in to book</h2>
        <p className={styles.body}>
          To book <strong>{djName}</strong> for{' '}
          <strong>{formatNiceDate(dateKey)}</strong>, please log in or
          create an account.
        </p>

        <div className={styles.actions}>
          <button type="button" onClick={goLogin} className={styles.btnPrimary}>
            Log In
          </button>
          <button type="button" onClick={goSignup} className={styles.btnSecondary}>
            Create Account
          </button>
        </div>

        <button type="button" onClick={onClose} className={styles.cancelLink}>
          Cancel
        </button>
      </div>
    </div>
  );
}
