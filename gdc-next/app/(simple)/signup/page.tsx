'use client';

// Signup page.
// Mirrors vanilla signup.html flow:
//   1. Account type selector (DJ / Host / Venue)
//   2. Type-specific form with:
//      - Real-time slug availability check + alternative suggestions (DJ + Venue)
//      - ZIP-code → city/state autofill via Nominatim (DJ + Venue)
//   3. Success screen ("Check your email") with token-based verification email
//
// HOSTS CAN NOW SIGN UP WITH A PHONE NUMBER. The host form gets a
// phone/email toggle; the phone half lives in HostPhoneSignup.tsx so this
// file doesn't grow a second signup mechanism inside an existing component.
// DJ and Venue signup are untouched — they still require email + password.
//
// QUERY PARAMS (booking-claim flow):
//   ?email=<addr>            — prefill the email field
//   ?claim_booking=<bookId>  — auto-route to Host signup, lock email, and stash
//                              the booking id in localStorage so AuthProvider
//                              can link the booking to the user once verified.

import { useEffect, useRef, useState } from 'react';
import type React from 'react';
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
import HostPhoneSignup from './HostPhoneSignup';
import styles from './signup.module.css';

// localStorage key used by AuthProvider to claim the booking after the
// new account verifies + logs in. Must match the key AuthProvider reads.
const PENDING_BOOKING_CLAIM_KEY = 'gdc_pending_booking_claim';

type Screen = 'type-select' | 'dj' | 'host' | 'venue' | 'success';

interface SuccessInfo {
  email: string;
  role: AccountType;
  slug: string | null;
  userId: string | null;
}

// Account-type badge that doubles as a subtle dropdown for switching to a
// different account type within signup. Shows the current type with a small
// down-arrow; clicking reveals the other two types in a tiny menu. Used
// inside each role-specific form so the user can hop between DJ / Host /
// Venue signups without going back to the choice screen.
function TypeBadge({
  current,
  onSwitch,
}: {
  current: 'dj' | 'host' | 'venue';
  onSwitch: (next: 'dj' | 'host' | 'venue') => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const labels: Record<'dj' | 'host' | 'venue', string> = {
    dj: 'DJ Account',
    host: 'Party / Event Host Account',
    venue: 'Venue Account',
  };
  const icons: Record<'dj' | 'host' | 'venue', React.ReactNode> = {
    dj: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
    host: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
      </svg>
    ),
    venue: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 21h18M5 21V7l8-4 8 4v14M9 9v.01M13 9v.01M17 9v.01M9 13v.01M13 13v.01M17 13v.01M9 17v.01M13 17v.01M17 17v.01" />
      </svg>
    ),
  };
  const variantClass =
    current === 'host' ? styles.formTypeLabelHost
    : current === 'venue' ? styles.formTypeLabelVenue
    : '';
  // Venue accounts are hidden at launch — not offered in the switcher. To
  // bring them back, drop 'venue' from HIDDEN_TYPES below (and re-add the Venue
  // button in TypeSelect). Everything else for venue signup is still wired up.
  const HIDDEN_TYPES: ReadonlyArray<'dj' | 'host' | 'venue'> = ['venue'];
  const others = (['dj', 'host', 'venue'] as const).filter(
    (t) => t !== current && !HIDDEN_TYPES.includes(t),
  );

  return (
    <div ref={wrapRef} className={styles.typeBadgeWrap}>
      <button
        type="button"
        className={`${styles.formTypeLabel} ${variantClass} ${styles.typeBadgeBtn}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {icons[current]}
        {labels[current]}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={styles.typeBadgeChev} aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className={styles.typeBadgeMenu} role="listbox">
          {others.map((t) => (
            <button
              key={t}
              type="button"
              className={styles.typeBadgeOption}
              onClick={() => { setOpen(false); onSwitch(t); }}
            >
              {icons[t]}
              <span>{labels[t]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SignupPage() {
  const [screen, setScreen] = useState<Screen>('type-select');
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  // URL-param state (read once on mount; SSR-safe because we're in 'use client').
  const [prefillEmail, setPrefillEmail] = useState<string>('');
  const [lockedEmail, setLockedEmail] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const email = params.get('email') || '';
    const claimBookingId = params.get('claim_booking') || '';
    if (email) setPrefillEmail(email);
    // If we have a claim_booking, this is the host-invite flow:
    //   - Auto-route to the host form (skip the type chooser).
    //   - Lock the email field so the host can't accidentally use a
    //     different address than the one the booking is keyed against.
    //   - Stash the booking id so the post-verify hook can claim it.
    if (claimBookingId) {
      setLockedEmail(true);
      setScreen('host');
      try {
        window.localStorage.setItem(PENDING_BOOKING_CLAIM_KEY, claimBookingId);
      } catch {
        // localStorage unavailable (private mode etc.) — fall back to losing
        // the claim. The DJ can resend the email if needed.
      }
    } else {
      // Booking-flow signup: when the user arrived from BookingLoginGate
      // (?redirect=/<slug>?date=YYYY-MM-DD&book=1), the intent is obvious —
      // they're trying to book a DJ, so they're a host. Skip the choice
      // screen and drop them straight on the host form.
      const intent = parseBookingIntent();
      if (intent.bookingDjSlug && intent.bookingDate) {
        setScreen('host');
      }
    }
  }, []);

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
            onSwitchType={(t) => setScreen(t)}
            onSuccess={(info) => { setSuccess(info); setScreen('success'); }}
          />
        )}
        {screen === 'host' && (
          <HostForm
            onBack={() => setScreen('type-select')}
            onSwitchType={(t) => setScreen(t)}
            onSuccess={(info) => { setSuccess(info); setScreen('success'); }}
            prefillEmail={prefillEmail}
            lockedEmail={lockedEmail}
          />
        )}
        {screen === 'venue' && (
          <VenueForm
            onBack={() => setScreen('type-select')}
            onSwitchType={(t) => setScreen(t)}
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
            <div className={styles.acctTypeName}>DJ <span className={styles.acctTypeFree}>FREE</span></div>
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
            <div className={styles.acctTypeName}>Party / Event Host <span className={styles.acctTypeFree}>FREE</span></div>
            <div className={styles.acctTypeDesc}>Find &amp; book DJs for your events</div>
          </div>
          <svg className={styles.acctTypeArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        {/* Venue account — HIDDEN AT LAUNCH. Venues aren't onboarding yet, so
            the option is removed from the chooser (and from the TypeBadge
            switcher above). The VenueForm and 'venue' routing below are left
            intact; restore this button and drop 'venue' from HIDDEN_TYPES to
            turn it back on.

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
            <div className={styles.acctTypeName}>Venue <span className={styles.acctTypeFree}>FREE</span></div>
            <div className={styles.acctTypeDesc}>Add your venue, list opening spots, &amp; book DJs</div>
          </div>
          <svg className={styles.acctTypeArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        */}
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
// Parses a booking intent out of the ?redirect= param, if present.
// BookingLoginGate sends users to signup with
//   ?redirect=/<slug>?date=YYYY-MM-DD&book=1
// We pull the slug + date so the confirmation email can include a
// "Continue your booking" link. Returns nulls when there's no booking
// redirect (normal signups).
function parseBookingIntent(): { bookingDjSlug: string | null; bookingDate: string | null } {
  if (typeof window === 'undefined') return { bookingDjSlug: null, bookingDate: null };
  try {
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    if (!redirect) return { bookingDjSlug: null, bookingDate: null };
    // redirect looks like "/<slug>?date=YYYY-MM-DD&book=1" (possibly encoded)
    const decoded = decodeURIComponent(redirect);
    const qIndex = decoded.indexOf('?');
    if (qIndex === -1) return { bookingDjSlug: null, bookingDate: null };
    const path = decoded.slice(0, qIndex);
    const query = new URLSearchParams(decoded.slice(qIndex + 1));
    const date = query.get('date');
    const slug = path.replace(/^\//, '').split('/')[0] || null;
    const validDate = !!date && /^\d{4}-\d{2}-\d{2}$/.test(date);
    if (!slug || !validDate) return { bookingDjSlug: null, bookingDate: null };
    return { bookingDjSlug: slug, bookingDate: date };
  } catch {
    return { bookingDjSlug: null, bookingDate: null };
  }
}

async function triggerSignupVerification(
  userId: string,
  email: string,
  role: AccountType,
  slug: string | null
) {
  const { bookingDjSlug, bookingDate } = parseBookingIntent();
  try {
    const res = await fetch('/api/signup-send-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, email, role, slug, bookingDjSlug, bookingDate }),
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

function DjForm({ onBack, onSwitchType, onSuccess }: {
  onBack: () => void;
  onSwitchType: (t: 'dj' | 'host' | 'venue') => void;
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
          signup_method: 'email',
          // Mobile DJs default to ALL 12 party types selected so they're
          // bookable for every event type out of the gate. Persisted to the
          // DB (not just a UI default) so the public booking form's event-type
          // dropdown is populated immediately. Club DJs get none (genres are
          // opt-in). Order matches the editor default in UpdateDjProfileClient.
          event_types: djType === 'mobile'
            ? 'weddings,corporate,birthday,anniversary,graduation,sweet16,quinceanera,mitzvah,reunion,holiday,school,community,other'
            : null,
        } as unknown as never, { onConflict: 'id' });

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
      <TypeBadge current="dj" onSwitch={onSwitchType} />

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
//
// The only form with two ways in. Name and Country are shared; below them the
// host picks Phone (a texted code, no password) or Email (what already
// existed). The phone half is HostPhoneSignup — kept separate so this
// component doesn't end up with two unrelated submit paths tangled together.
// ──────────────────────────────────────────────────────────────────────────

function HostForm({ onBack, onSwitchType, onSuccess, prefillEmail, lockedEmail }: {
  onBack: () => void;
  onSwitchType: (t: 'dj' | 'host' | 'venue') => void;
  onSuccess: (info: SuccessInfo) => void;
  // Email prefilled from URL (booking-invite flow). When `lockedEmail` is
  // true the email field is readOnly — used when the user arrived via a
  // claim_booking link so we don't pair the booking with a different email.
  prefillEmail?: string;
  lockedEmail?: boolean;
}) {
  const supabase = createClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(prefillEmail || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Not asked any more (see sharedFields). Written as null rather than
  // defaulted to 'United States' — a made-up country is worse than an absent
  // one, because later code can't tell the difference between a guess and a
  // fact. If something ever genuinely needs a host's country, it should ask
  // at the point it needs it.
  const country: string | null = null;

  // Email is the default: it's the path that already existed, and it's the
  // only one a locked-email invite can use.
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  // A claim_booking invite is pinned to one address. Offering phone there
  // would let someone create an account the invitation can't attach to.
  const canChooseMethod = !lockedEmail;

  // Where a phone signup lands afterwards. Phone signups finish signed in, so
  // unlike email there's no "check your inbox" screen in between.
  const destination = (() => {
    if (typeof window === 'undefined') return '/';
    const r = new URLSearchParams(window.location.search).get('redirect');
    if (!r || !r.startsWith('/') || r.startsWith('//')) return '/';
    return r;
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !email.trim() || !password) {
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
          signup_method: 'email',
        } as unknown as never, { onConflict: 'id' });

        triggerSignupVerification(signUpData.user.id, emailLower, 'host', null);
      }

      onSuccess({ email: emailLower, role: 'host', slug: null, userId: signUpData?.user?.id ?? null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Signup failed';
      setError(msg);
      setSubmitting(false);
    }
  }

  // Asked once, used by both paths — so it sits above the method choice
  // rather than being duplicated inside each branch.
  //
  // COUNTRY WAS HERE AND IS GONE. The reason given for asking was to scope the
  // venue-address autocomplete on the booking form — but that form hardcodes
  // its own country to 'us' and never reads this value, and it has its own
  // country picker sitting next to the address field. So it was a required
  // dropdown between a host and their account, collected for a job it wasn't
  // doing. (Defaulting that picker from the DJ's country is the real fix; the
  // DJ is who the event is for. That's a separate change.)
  const sharedFields = (
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
  );

  const methodToggle = canChooseMethod ? (
    <div className={styles.methodRow}>
      {(['phone', 'email'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => { setMethod(m); setError(null); }}
          className={`${styles.methodBtn} ${method === m ? styles.methodBtnActive : ''}`}
        >
          {m === 'phone' ? 'Use my phone' : 'Use my email'}
        </button>
      ))}
    </div>
  ) : null;

  // ── PHONE ────────────────────────────────────────────────────────
  if (method === 'phone') {
    return (
      <div>
        <BackButton onClick={onBack} />
        <TypeBadge current="host" onSwitch={onSwitchType} />
        {methodToggle}
        {sharedFields}
        <HostPhoneSignup name={name} country={country} destination={destination} />
      </div>
    );
  }

  // ── EMAIL — unchanged from before, plus signup_method on the row ──
  return (
    <form onSubmit={handleSubmit}>
      <BackButton onClick={onBack} />
      <TypeBadge current="host" onSwitch={onSwitchType} />
      {methodToggle}

      {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}

      {sharedFields}

      <div className={styles.formGroup}>
        <label htmlFor="host-email">Email Address</label>
        <input
          id="host-email"
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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

      <button type="submit" className={styles.submitBtn} disabled={submitting}>
        {submitting ? 'Creating Account...' : 'Create Party / Event Host Account'}
      </button>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// VENUE FORM
// ──────────────────────────────────────────────────────────────────────────

function VenueForm({ onBack, onSwitchType, onSuccess }: {
  onBack: () => void;
  onSwitchType: (t: 'dj' | 'host' | 'venue') => void;
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
          signup_method: 'email',
        } as unknown as never, { onConflict: 'id' });

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
      <TypeBadge current="venue" onSwitch={onSwitchType} />

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
      const { bookingDjSlug, bookingDate } = parseBookingIntent();
      const res = await fetch('/api/signup-send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: info.userId,
          email: info.email,
          role: info.role,
          slug: info.slug,
          bookingDjSlug,
          bookingDate,
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
