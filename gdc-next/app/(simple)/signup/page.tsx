'use client';

// Signup page.
// Mirrors vanilla signup.html flow:
//   1. Account type selector (DJ / Host / Venue)
//   2. Type-specific form with:
//      - Real-time slug availability check + alternative suggestions (DJ + Venue)
//      - ZIP-code → city/state autofill via Nominatim (DJ + Venue)
//   3. Success screen ("Check your email") with token-based verification email

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  COUNTRIES,
  TRAVEL_DISTANCES,
  generateDjAlternatives,
  generateVenueAlternatives,
  makeSlug,
  type AccountType,
  type DjType,
} from './helpers';
import { SlugInput, type SlugStatus } from './SlugInput';
import { ZipLookup } from './ZipLookup';
import styles from './signup.module.css';

type Screen = 'type-select' | 'dj' | 'host' | 'venue' | 'success';

interface SuccessInfo {
  email: string;
  role: AccountType;
  slug: string | null;
  userId: string | null;
}

export default function SignupPage() {
  const [screen, setScreen] = useState<Screen>('type-select');
  const [success, setSuccess] = useState<SuccessInfo | null>(null);

  return (
    <div className={styles.body}>
      <div className={styles.container}>
        <div className={styles.logo}>
          <Link href="/">
            <h1>GLOBAL DJ CONNECT</h1>
          </Link>
          <p className={styles.tagline}>Directory &amp; Booking</p>
        </div>

        {screen !== 'success' && (
          <div className={styles.tabs}>
            <Link href="/login" className={styles.tab}>Login</Link>
            <button className={`${styles.tab} ${styles.active}`} type="button">Sign Up</button>
          </div>
        )}

        {screen === 'type-select' && <TypeSelect onSelect={setScreen} />}
        {screen === 'dj' && (
          <DjForm
            onBack={() => setScreen('type-select')}
            onSuccess={(info) => { setSuccess(info); setScreen('success'); }}
          />
        )}
        {screen === 'host' && (
          <HostForm
            onBack={() => setScreen('type-select')}
            onSuccess={(info) => { setSuccess(info); setScreen('success'); }}
          />
        )}
        {screen === 'venue' && (
          <VenueForm
            onBack={() => setScreen('type-select')}
            onSuccess={(info) => { setSuccess(info); setScreen('success'); }}
          />
        )}
        {screen === 'success' && success && <SuccessScreen info={success} />}

        {screen !== 'success' && (
          <>
            <div className={styles.divider}>
              Already have an account? <Link href="/login">Log in</Link>
            </div>
            <div className={styles.contactLink}>
              <Link href="/contact">Contact Us</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// TYPE SELECT SCREEN
// ──────────────────────────────────────────────────────────────────────────

function TypeSelect({ onSelect }: { onSelect: (s: Screen) => void }) {
  return (
    <>
      <div className={styles.acctTypeQuestion}>What kind of account?</div>
      <div className={styles.acctTypeList}>
        <button
          type="button"
          className={styles.acctTypeBtn}
          onClick={() => onSelect('dj')}
        >
          <div className={styles.acctTypeIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div className={styles.acctTypeInfo}>
            <div className={styles.acctTypeName}>DJ</div>
            <div className={styles.acctTypeDesc}>Get listed in the directory &amp; accept bookings</div>
          </div>
          <svg className={styles.acctTypeArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        <button
          type="button"
          className={styles.acctTypeBtn}
          onClick={() => onSelect('host')}
        >
          <div className={styles.acctTypeIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div className={styles.acctTypeInfo}>
            <div className={styles.acctTypeName}>Party Host</div>
            <div className={styles.acctTypeDesc}>Find &amp; book DJs for your events</div>
          </div>
          <svg className={styles.acctTypeArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        <button
          type="button"
          className={styles.acctTypeBtn}
          onClick={() => onSelect('venue')}
        >
          <div className={styles.acctTypeIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <div className={styles.acctTypeInfo}>
            <div className={styles.acctTypeName}>Venue</div>
            <div className={styles.acctTypeDesc}>Add your venue, list opening spots, &amp; book DJs</div>
          </div>
          <svg className={styles.acctTypeArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    </>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={styles.formBack} onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      Back
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: trigger token-based verification email after a successful signUp.
// Calls our /api/signup-send-verification route which generates a token,
// stores it in email_verification_tokens, and emails the user a link.
// ──────────────────────────────────────────────────────────────────────────
async function triggerSignupVerification(
  userId: string,
  email: string,
  role: AccountType,
  slug: string | null
) {
  try {
    const res = await fetch('/api/signup-send-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, email, role, slug }),
    });
    if (!res.ok) {
      console.warn('[signup] verification email request failed:', res.status);
    }
  } catch (e) {
    console.warn('[signup] verification email exception:', e);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// DJ FORM
// ──────────────────────────────────────────────────────────────────────────

function DjForm({ onBack, onSuccess }: {
  onBack: () => void;
  onSuccess: (info: SuccessInfo) => void;
}) {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [djType, setDjType] = useState<DjType | null>(null);
  const [name, setName] = useState('');
  // The slug shown in the URL input. Auto-derived from `name` until the user
  // either edits it directly or picks an alternative.
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle');

  const [country, setCountry] = useState('United States');
  const [zip, setZip] = useState('');
  const [city, setCity] = useState('');
  const [stateRegion, setStateRegion] = useState('');
  const [travel, setTravel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Sync slug from name unless the user has manually edited it
  function handleNameChange(newName: string) {
    setName(newName);
    if (!slugManuallyEdited) {
      const derived = makeSlug(newName);
      // eslint-disable-next-line no-console
      console.log('[signup] handleNameChange', { newName, derived, slugManuallyEdited });
      setSlug(derived);
    }
  }
  function handleSlugChange(newSlug: string) {
    setSlugManuallyEdited(true);
    setSlug(newSlug);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!djType) {
      setError('Please select your DJ type');
      return;
    }
    if (!travel) {
      setError("Please select how far you're willing to travel");
      return;
    }
    if (!name.trim() || !email.trim() || !password) {
      setError('Please fill in all required fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!zip.trim()) {
      setError('Please enter your ZIP / postal code.');
      return;
    }
    if (!slug) {
      setError('Please enter a name so we can create your profile URL.');
      return;
    }
    if (slugStatus === 'taken') {
      setError('That URL is taken. Please pick an available alternative.');
      return;
    }
    if (slugStatus === 'checking') {
      setError('Still checking URL availability — please wait a moment.');
      return;
    }

    setSubmitting(true);
    try {
      const emailLower = email.toLowerCase().trim();
      const travelVal = travel === 'worldwide' ? 'worldwide' : (parseInt(travel, 10) || null);

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: emailLower,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/account-settings?emailverified=1`,
          data: {
            role: 'dj',
            name,
            slug,
            dj_type: djType,
            country,
            city,
            state: stateRegion,
            travel_distance: travel,
            zip,
          },
        },
      });

      if (signUpError) {
        if (/already registered|already been registered|User already/i.test(signUpError.message)) {
          throw new Error('An account with this email already exists. Please log in instead.');
        }
        if (/duplicate key.*slug/i.test(signUpError.message)) {
          throw new Error('That URL was just taken. Please pick another.');
        }
        throw signUpError;
      }
      if (signUpData?.user?.identities && signUpData.user.identities.length === 0) {
        throw new Error('An account with this email already exists. Please log in instead.');
      }

      if (signUpData?.user?.id) {
        await supabase.from('users').upsert({
          id: signUpData.user.id,
          role: 'dj',
          name,
          slug,
          dj_type: djType,
          country,
          city,
          state: stateRegion,
          travel_distance: travelVal,
          zip,
          email_verified: false,
        }, { onConflict: 'id' });

        // Fire-and-forget the verification email — we don't block the
        // success screen on this so the user gets immediate feedback.
        triggerSignupVerification(signUpData.user.id, emailLower, 'dj', slug);
      }

      onSuccess({ email: emailLower, role: 'dj', slug, userId: signUpData?.user?.id ?? null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Signup failed';
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <BackButton onClick={onBack} />
      <div className={styles.formTypeLabel}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        DJ Account
      </div>

      {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}

      <div className={styles.formGroup}>
        <label htmlFor="dj-email">Email Address</label>
        <input
          id="dj-email"
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="dj-password">Password</label>
        <input
          id="dj-password"
          type="password"
          placeholder="Minimum 8 characters"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
        />
      </div>

      <div className={styles.formGroup}>
        <label>Type</label>
        <div className={styles.typeBtnGroup}>
          <button
            type="button"
            className={`${styles.typeBtn} ${djType === 'mobile' ? styles.typeBtnSelected : ''}`}
            onClick={() => setDjType('mobile')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            Mobile DJ
          </button>
          <button
            type="button"
            className={`${styles.typeBtn} ${djType === 'club' ? styles.typeBtnSelected : ''}`}
            onClick={() => setDjType('club')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Club / Bar DJ
          </button>
        </div>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="dj-name">
          {djType === 'mobile' ? 'Company Name' : djType === 'club' ? 'DJ Name' : 'DJ / Company Name'}
        </label>
        <input
          id="dj-name"
          type="text"
          placeholder={
            djType === 'mobile' ? 'Premier Events LLC' :
            djType === 'club' ? 'DJ Nova' :
            'DJ Nova or Premier Events LLC'
          }
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          required
        />
        {/* SlugInput is now always rendered so it's obvious when the
            field is empty (was: gated on `slug` truthy, which hid the
            field entirely if derivation produced an empty result). */}
        <SlugInput
          value={slug}
          onChange={handleSlugChange}
          onStatusChange={setSlugStatus}
          generateAlternatives={generateDjAlternatives}
          placeholder="your-url"
        />
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="dj-country">Country</label>
        <select
          id="dj-country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          required
        >
          {COUNTRIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="dj-zip">Zip / Postal Code</label>
        <ZipLookup
          inputId="dj-zip"
          zip={zip}
          country={country}
          onZipChange={setZip}
          onLocationResolved={(c, s) => { setCity(c); setStateRegion(s); }}
          required
        />
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="dj-travel">Distance Willing to Travel</label>
        <select
          id="dj-travel"
          value={travel}
          onChange={(e) => setTravel(e.target.value)}
          required
        >
          <option value="">Select distance...</option>
          {TRAVEL_DISTANCES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <button type="submit" className={styles.submitBtn} disabled={submitting}>
        {submitting ? 'Creating Account...' : 'Create DJ Account'}
      </button>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// HOST FORM
// ──────────────────────────────────────────────────────────────────────────

function HostForm({ onBack, onSuccess }: {
  onBack: () => void;
  onSuccess: (info: SuccessInfo) => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('United States');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !email.trim() || !password || !country) {
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const emailLower = email.toLowerCase().trim();
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: emailLower,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/account-settings?emailverified=1`,
          data: { role: 'host', name, country },
        },
      });
      if (signUpError) {
        if (/already registered|already been registered|User already/i.test(signUpError.message)) {
          throw new Error('An account with this email already exists. Please log in instead.');
        }
        throw signUpError;
      }
      if (signUpData?.user?.identities && signUpData.user.identities.length === 0) {
        throw new Error('An account with this email already exists. Please log in instead.');
      }

      if (signUpData?.user?.id) {
        await supabase.from('users').upsert({
          id: signUpData.user.id,
          role: 'host',
          name,
          country,
          email_verified: false,
        }, { onConflict: 'id' });

        triggerSignupVerification(signUpData.user.id, emailLower, 'host', null);
      }

      onSuccess({ email: emailLower, role: 'host', slug: null, userId: signUpData?.user?.id ?? null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Signup failed';
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <BackButton onClick={onBack} />
      <div className={`${styles.formTypeLabel} ${styles.formTypeLabelHost}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
        </svg>
        Party Host Account
      </div>

      {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}

      <div className={styles.formGroup}>
        <label htmlFor="host-name">Your Name</label>
        <input
          id="host-name"
          type="text"
          placeholder="Jane Smith"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className={styles.formGroup}>
        <label htmlFor="host-email">Email Address</label>
        <input
          id="host-email"
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </div>
      <div className={styles.formGroup}>
        <label htmlFor="host-password">Password</label>
        <input
          id="host-password"
          type="password"
          placeholder="Minimum 8 characters"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
        />
      </div>
      <div className={styles.formGroup}>
        <label htmlFor="host-country">Country</label>
        <select
          id="host-country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          required
        >
          {COUNTRIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
      </div>

      <button type="submit" className={styles.submitBtn} disabled={submitting}>
        {submitting ? 'Creating Account...' : 'Create Host Account'}
      </button>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// VENUE FORM
// ──────────────────────────────────────────────────────────────────────────

function VenueForm({ onBack, onSuccess }: {
  onBack: () => void;
  onSuccess: (info: SuccessInfo) => void;
}) {
  const supabase = createClient();
  const [venueName, setVenueName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('United States');
  const [zip, setZip] = useState('');
  const [city, setCity] = useState('');
  const [stateRegion, setStateRegion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleVenueNameChange(newName: string) {
    setVenueName(newName);
    if (!slugManuallyEdited) {
      setSlug(makeSlug(newName));
    }
  }
  function handleSlugChange(newSlug: string) {
    setSlugManuallyEdited(true);
    setSlug(newSlug);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!venueName.trim() || !email.trim() || !password || !country || !zip.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!slug) {
      setError('Please enter a venue name so we can create your profile URL.');
      return;
    }
    if (slugStatus === 'taken') {
      setError('That URL is taken. Please pick an available alternative.');
      return;
    }
    if (slugStatus === 'checking') {
      setError('Still checking URL availability — please wait a moment.');
      return;
    }

    setSubmitting(true);
    try {
      const emailLower = email.toLowerCase().trim();
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: emailLower,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/account-settings?emailverified=1`,
          data: {
            role: 'venue',
            name: venueName,
            venue_name: venueName,
            slug,
            country,
            city,
            state: stateRegion,
            zip,
          },
        },
      });
      if (signUpError) {
        if (/already registered|already been registered|User already/i.test(signUpError.message)) {
          throw new Error('An account with this email already exists. Please log in instead.');
        }
        if (/duplicate key.*slug/i.test(signUpError.message)) {
          throw new Error('That URL was just taken. Please try again.');
        }
        throw signUpError;
      }
      if (signUpData?.user?.identities && signUpData.user.identities.length === 0) {
        throw new Error('An account with this email already exists. Please log in instead.');
      }

      if (signUpData?.user?.id) {
        await supabase.from('users').upsert({
          id: signUpData.user.id,
          role: 'venue',
          name: venueName,
          venue_name: venueName,
          slug,
          country,
          city,
          state: stateRegion,
          zip,
          email_verified: false,
        }, { onConflict: 'id' });

        triggerSignupVerification(signUpData.user.id, emailLower, 'venue', slug);
      }

      onSuccess({ email: emailLower, role: 'venue', slug, userId: signUpData?.user?.id ?? null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Signup failed';
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <BackButton onClick={onBack} />
      <div className={`${styles.formTypeLabel} ${styles.formTypeLabelVenue}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
        Venue Account
      </div>

      {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}

      <div className={styles.formGroup}>
        <label htmlFor="venue-name">Venue Name</label>
        <input
          id="venue-name"
          type="text"
          placeholder="The Grand Ballroom"
          value={venueName}
          onChange={(e) => handleVenueNameChange(e.target.value)}
          required
        />
        {slug && (
          <SlugInput
            value={slug}
            onChange={handleSlugChange}
            onStatusChange={setSlugStatus}
            generateAlternatives={generateVenueAlternatives}
            placeholder="your-venue-url"
          />
        )}
      </div>
      <div className={styles.formGroup}>
        <label htmlFor="venue-email">Email Address</label>
        <input
          id="venue-email"
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </div>
      <div className={styles.formGroup}>
        <label htmlFor="venue-password">Password</label>
        <input
          id="venue-password"
          type="password"
          placeholder="Minimum 8 characters"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
        />
      </div>
      <div className={styles.formGroup}>
        <label htmlFor="venue-country">Country</label>
        <select
          id="venue-country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          required
        >
          {COUNTRIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
      </div>
      <div className={styles.formGroup}>
        <label htmlFor="venue-zip">Zip Code</label>
        <ZipLookup
          inputId="venue-zip"
          zip={zip}
          country={country}
          onZipChange={setZip}
          onLocationResolved={(c, s) => { setCity(c); setStateRegion(s); }}
          required
        />
      </div>

      <button type="submit" className={styles.submitBtn} disabled={submitting}>
        {submitting ? 'Creating Account...' : 'Create Venue Account'}
      </button>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SUCCESS SCREEN — "Check Your Email"
// ──────────────────────────────────────────────────────────────────────────

function SuccessScreen({ info }: { info: SuccessInfo }) {
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendMsg, setResendMsg] = useState('');

  async function handleResend() {
    setResendStatus('sending');
    try {
      // Hit our own endpoint. We pass user_id when we have it (always do
      // here since the success screen comes right after a successful signUp);
      // the API route also supports lookup-by-email as a fallback.
      const res = await fetch('/api/signup-send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: info.userId,
          email: info.email,
          role: info.role,
          slug: info.slug,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to resend');
      }
      setResendStatus('sent');
      setResendMsg('✓ Sent — check your inbox');
      setTimeout(() => { setResendStatus('idle'); setResendMsg(''); }, 5000);
    } catch (err) {
      setResendStatus('error');
      setResendMsg('✗ ' + (err instanceof Error ? err.message : 'Failed to resend'));
      setTimeout(() => { setResendStatus('idle'); setResendMsg(''); }, 4000);
    }
  }

  return (
    <div className={styles.successWrap}>
      <div className={styles.successIconCircle}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--neon)" strokeWidth="2">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      </div>
      <h2 className={styles.successTitle}>Check Your Email</h2>
      <p className={styles.successSubLine}>We sent a confirmation link to</p>
      <p className={styles.successEmail}>{info.email}</p>
      <p className={styles.successHint}>
        Click the link in that email to activate your account. The link expires in 24 hours.
      </p>
      <p className={styles.resendLine}>
        Didn&apos;t get it? Check your spam folder, or{' '}
        {resendStatus === 'idle' || resendStatus === 'sending' ? (
          <button
            type="button"
            className={styles.resendLink}
            onClick={handleResend}
            disabled={resendStatus === 'sending'}
          >
            {resendStatus === 'sending' ? 'Sending...' : 'resend the email'}
          </button>
        ) : (
          <span style={{ color: resendStatus === 'sent' ? '#3ddc84' : 'var(--error)' }}>
            {resendMsg}
          </span>
        )}
        .
      </p>

      {info.role === 'dj' && (
        <div className={styles.djBuildBlock}>
          <p className={styles.djBuildTitle}>Begin Building Your Profile</p>
          <p className={styles.djBuildDesc}>
            Add your mixes, photos, equipment, rates, and availability now — you can still edit anytime.
          </p>
          <Link href="/update-dj-profile" className={styles.djBuildBtn}>
            Edit My Profile →
          </Link>
        </div>
      )}
    </div>
  );
}
