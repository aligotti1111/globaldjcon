'use client';

import { useState } from 'react';
import HostCodeSignup from '@/app/(simple)/signup/HostCodeSignup';
import InlineLoginForm from '@/components/InlineLoginForm';
import styles from './bookingLoginGate.module.css';
import formStyles from '@/app/(simple)/signup/signup.module.css';

interface Props {
  djName: string;
  djSlug: string;
  dateKey: string;
  onClose: () => void;
  onAuthed?: (dateKey: string) => void;
}

function formatNiceDate(dKey: string): string {
  const [y, m, d] = dKey.split('-').map(Number);
  if (!y || !m || !d) return dKey;
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  return dt.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

export default function BookingLoginGate({
  djName, djSlug, dateKey, onClose, onAuthed,
}: Props) {
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [method, setMethod] = useState<'email' | 'phone'>('phone');

  const redirectTarget = `/${encodeURIComponent(djSlug)}?date=${encodeURIComponent(dateKey)}&book=1`;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.box}
        onClick={(e) => e.stopPropagation()}
        style={{
          textAlign: 'left',
          maxHeight: 'calc(100vh - 3rem)',
          overflowY: 'auto',
          background: 'var(--black,#000)',
        }}
      >
        <button type="button" onClick={onClose} className={styles.closeBtn} aria-label="Close">✕</button>

        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
          <span className="logo" style={{ fontSize: '2.3rem' }}>Global DJ Connect</span>
        </div>

        <p className={styles.body}>
          {mode === 'signup' ? (
            <>To book <strong>{djName}</strong> for{' '}
            <strong>{formatNiceDate(dateKey)}</strong> create a free account below.</>
          ) : (
            <>Sign in to book <strong>{djName}</strong> for{' '}
            <strong>{formatNiceDate(dateKey)}</strong>.</>
          )}
        </p>

        {mode === 'signup' ? (
          <>
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
              onDone={() => { if (onAuthed) onAuthed(dateKey); else onClose(); }}
            />

            <p className={styles.body} style={{ marginTop: '1rem', fontSize: '.78rem' }}>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => setMode('login')}
                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--neon)', fontWeight: 700, fontSize: 'inherit', cursor: 'pointer' }}
              >
                Log in
              </button>
            </p>
          </>
        ) : (
          <>
            <InlineLoginForm onDone={() => { if (onAuthed) onAuthed(dateKey); else onClose(); }} />

            <p className={styles.body} style={{ marginTop: '1rem', fontSize: '.78rem' }}>
              Need an account?{' '}
              <button
                type="button"
                onClick={() => setMode('signup')}
                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--neon)', fontWeight: 700, fontSize: 'inherit', cursor: 'pointer' }}
              >
                Create one
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
