'use client';

// Signup page.
// Mirrors vanilla signup.html flow:
//   1. Account type selector (DJ / Host / Venue)
//   2. Type-specific form
//   3. Success screen ("Check your email") with resend link
//
// Each form submits via Supabase signUp, then upserts the public.users row
// to ensure all fields land correctly (the auth trigger in Supabase doesn't
// always carry every column).
//
// Slug auto-suggestions and ZIP-to-city lookup are deferred to a follow-up
// session — for now the user types their preferred slug, and city/state
// stay empty until populated later from their profile page.

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  COUNTRIES,
  TRAVEL_DISTANCES,
  makeSlug,
  type AccountType,
  type DjType,
} from './helpers';
import styles from './signup.module.css';

type Screen = 'type-select' | 'dj' | 'host' | 'venue' | 'success';

interface SuccessInfo {
  email: string;
  role: AccountType;
  slug: string | null;
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

// Reusable Back button used by all 3 forms
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
  const [slugEdit, setSlugEdit] = useState('');
  const [country, setCountry] = useState('United States');
  const [zip, setZip] = useState('');
  const [travel, setTravel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // City and state are intentionally NOT in the form. They get populated
  // from the ZIP code via the Nominatim lookup (deferred to Session 3).
  // For now they're submitted as empty strings — the user can update them
  // later from their profile page.

  // Auto-derive slug from name unless the user typed a custom one.
  const effectiveSlug = slugEdit ? makeSlug(slugEdit) : makeSlug(name);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validation matches vanilla submit logic
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
    if (!effectiveSlug) {
      setError('Please enter a name so we can create your profile URL.');
      return;
    }

    setSubmitting(true);
    try {
      // Pre-check slug availability (best effort — race conditions handled below)
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('slug', effectiveSlug)
        .limit(1);
      if (existing && existing.length > 0) {
        throw new Error('That URL is already taken. Please pick a different name or URL.');
      }

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
            slug: effectiveSlug,
            dj_type: djType,
            country,
            city: '',
            state: '',
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
      // Supabase enumeration protection: empty identities array means existing email
      if (signUpData?.user?.identities && signUpData.user.identities.length === 0) {
        throw new Error('An account with this email already exists. Please log in instead.');
      }

      // Upsert public.users row to make sure all DJ fields land
      // (the auth trigger doesn't always carry every column over).
      // city/state are populated server-side from ZIP in Session 3;
      // for now they're empty and the user can edit later.
      if (signUpData?.user?.id) {
        await supabase.from('users').upsert({
          id: signUpData.user.id,
          role: 'dj',
          name,
          slug: effectiveSlug,
          dj_type: djType,
          country,
          city: '',
          state: '',
          travel_distance: travelVal,
          zip,
          email_verified: false,
        }, { onConflict: 'id' });
      }

      onSuccess({ email: emailLower, role: 'dj', slug: effectiveSlug });
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
        <label htmlFor="dj-name">DJ / Company Name</label>
        <input
          id="dj-name"
          type="text"
          placeholder="DJ Nova or Premier Events LLC"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {name && (
          <div className={styles.urlPreview}>
            <span className={styles.urlPreviewLabel}>Your Profile URL</span>
            <div className={styles.urlPreviewRow}>
              <span className={styles.urlPreviewPrefix}>globaldjconnect.com/</span>
              <input
                type="text"
                className={styles.urlPreviewInput}
                placeholder="your-url"
                value={slugEdit || makeSlug(name)}
                onChange={(e) => setSlugEdit(e.target.value)}
              />
            </div>
          </div>
        )}
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
        <input
          id="dj-zip"
          type="text"
          placeholder="e.g. 10001"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
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
      }

      onSuccess({ email: emailLower, role: 'host', slug: null });
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
  const [slugEdit, setSlugEdit] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('United States');
  const [zip, setZip] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const effectiveSlug = slugEdit ? makeSlug(slugEdit) : makeSlug(venueName);

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
    if (!effectiveSlug) {
      setError('Please enter a venue name so we can create your profile URL.');
      return;
    }

    setSubmitting(true);
    try {
      // Find an available slug — append -2, -3, etc. if taken
      let venueSlug = effectiveSlug;
      let suffix = 2;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data: ex } = await supabase
          .from('users')
          .select('id')
          .eq('slug', venueSlug)
          .limit(1);
        if (!ex || ex.length === 0) break;
        venueSlug = `${effectiveSlug}-${suffix++}`;
        if (suffix > 100) {
          throw new Error('Could not generate a unique URL. Please try a different venue name.');
        }
      }

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
            slug: venueSlug,
            country,
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
          slug: venueSlug,
          country,
          zip,
          email_verified: false,
        }, { onConflict: 'id' });
      }

      onSuccess({ email: emailLower, role: 'venue', slug: venueSlug });
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
          onChange={(e) => setVenueName(e.target.value)}
          required
        />
        {venueName && (
          <div className={styles.urlPreview}>
            <span className={styles.urlPreviewLabel}>Your Profile URL</span>
            <div className={styles.urlPreviewRow}>
              <span className={styles.urlPreviewPrefix}>globaldjconnect.com/</span>
              <input
                type="text"
                className={styles.urlPreviewInput}
                placeholder="your-venue-url"
                value={slugEdit || makeSlug(venueName)}
                onChange={(e) => setSlugEdit(e.target.value)}
              />
            </div>
          </div>
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
        <input
          id="venue-zip"
          type="text"
          placeholder="60601"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
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
  const supabase = createClient();
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendMsg, setResendMsg] = useState('');

  async function handleResend() {
    setResendStatus('sending');
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: info.email,
        options: {
          emailRedirectTo: `${window.location.origin}/account-settings?emailverified=1`,
        },
      });
      if (error) throw error;
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
        Click the link in that email to activate your account. The link expires in 1 hour.
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
