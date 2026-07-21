'use client';

// AuthModal — sign in or create an account without leaving the page.
//
// The header used to link out to /login and /signup. A logged-out person
// browsing a DJ's profile who wanted an account lost the page they were on.
// Now the header buttons open this instead, and on success it closes and
// refreshes in place — they're back where they were, signed in.
//
// It reuses the same tested pieces as everywhere else: HostCodeSignup for the
// create-account side (identifier → code → account), InlineLoginForm for the
// sign-in side (which itself leans on the shared lookup route). This modal is
// only the shell and the tab switch; it invents no auth logic of its own.
//
// NOT the booking gate. BookingLoginGate stays separate because it has a DJ
// and a date behind it ("To book X for [date]") and opens the booking form
// afterwards. This one is the generic entry for people who just want in.
//
// /login and /signup remain real pages — deep links, redirects, and the
// booking gate's "Log in" link still point at them. This is an addition, not
// a replacement.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import HostCodeSignup from '@/app/(simple)/signup/HostCodeSignup';
import InlineLoginForm from './InlineLoginForm';
import formStyles from '@/app/(simple)/signup/signup.module.css';

type Mode = 'signup' | 'login';

export default function AuthModal({
  initialMode,
  onClose,
}: {
  initialMode: Mode;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);

  // Create-account state (mirrors the /signup host form).
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  // Phone-first, same reasoning as the rest of host signup — most arrive on a
  // phone and the OS autofills the SMS code. The switch link covers email.
  const [method, setMethod] = useState<'email' | 'phone'>('phone');

  // Success from either side. Close, then refresh so server-rendered parts of
  // the current page re-run with the new auth state WITHOUT a navigation —
  // they stay exactly where they were, now signed in. AuthProvider's
  // onAuthStateChange has already flipped the client header by this point;
  // the refresh is for anything the server rendered.
  function finish() {
    onClose();
    router.refresh();
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 6000,
        background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--black,#000)',
          border: '1px solid var(--border,#222)',
          borderRadius: 12,
          padding: '2rem 1.75rem 1.5rem',
          width: '100%', maxWidth: 440,
          position: 'relative',
          maxHeight: 'calc(100vh - 3rem)',
          overflowY: 'auto',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: '.7rem', right: '1rem',
            background: 'none', border: 'none', color: 'var(--muted)',
            fontSize: '1.1rem', lineHeight: 1, cursor: 'pointer', padding: '.25rem .5rem',
          }}
        >
          ✕
        </button>

        {/* Tab switch. Two buttons rather than a link so nobody leaves the
            page to get to the other mode. */}
        <div style={{ display: 'flex', gap: '.4rem', marginBottom: '1.25rem' }}>
          {(['login', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setNameError(null); }}
              style={{
                flex: 1,
                padding: '.6rem',
                borderRadius: 8,
                border: '1px solid ' + (mode === m ? 'var(--neon,#00e0a4)' : 'var(--border,#222)'),
                background: mode === m ? 'rgba(0,224,164,.1)' : 'transparent',
                color: mode === m ? 'var(--neon,#00e0a4)' : 'var(--muted)',
                fontWeight: 700, fontSize: '.8rem', cursor: 'pointer',
                fontFamily: "'Space Mono', monospace", letterSpacing: '.04em',
                textTransform: 'uppercase',
              }}
            >
              {m === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        {mode === 'login' ? (
          <InlineLoginForm onDone={finish} />
        ) : (
          <>
            <div className={formStyles.formGroup}>
              {nameError && (
                <div className={`${formStyles.alert} ${formStyles.alertError}`}>{nameError}</div>
              )}
              <label htmlFor="am-name">Your Name</label>
              <input
                id="am-name"
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
              destination="/"
              onNameError={setNameError}
              canSwitchMethod
              onSwitchMethod={() => setMethod((m) => (m === 'email' ? 'phone' : 'email'))}
              onDone={finish}
            />
          </>
        )}
      </div>
    </div>
  );
}
