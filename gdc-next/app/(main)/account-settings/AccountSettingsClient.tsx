'use client';

// AccountSettingsClient — owns all forms + saves on /account-settings.
// Faithful port of vanilla account-settings.html JS section.
//
// Cards (top → bottom):
//   1. Venue Profile (venue role only) — name, owner name, slug, address, country
//   2. Profile Information — name + country (all roles)
//   3. Email Address — change email (re-auth + Supabase email update)
//   4. Change Password — current + new + confirm
//   5. Blocked Users — list with unblock buttons
//
// All saves write directly via the Supabase client SDK using the user's
// own session — no server actions needed because each user can only
// modify their own row by RLS.

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import styles from './accountSettings.module.css';
import { COUNTRIES, makeSlug, searchAddresses, type AddressSuggestion } from './helpers';
import { updateMyEmailAction } from '@/lib/actions/updateMyEmail';
import HostPhoneCard from './HostPhoneCard';
import { SlugInput } from '@/app/(simple)/signup/SlugInput';
import { generateVenueAlternatives } from '@/app/(simple)/signup/helpers';

interface ProfileInit {
  id: string;
  name: string;
  slug: string;
  role: string;
  country: string;
  city: string;
  state: string;
  zip: string;
  address: string;
  venueName: string;
}

interface BlockedUser {
  id: string;
  name: string;
}

interface Props {
  initialProfile: ProfileInit;
  currentEmail: string;
  initialBlocked: BlockedUser[];
  /** The auth phone — what a host signs in with. Empty when they signed up
   *  by email. Distinct from users.sms_phone, which is only a notification
   *  setting and is managed on /notifications. */
  currentPhone?: string;
  currentSmsPhone?: string;
}

// Status object that drives the alert text under each save button.
type Alert = { type: 'success' | 'error'; msg: string } | null;

export default function AccountSettingsClient({
  initialProfile, currentEmail, initialBlocked,
  currentPhone = '', currentSmsPhone = '',
}: Props) {
  const isVenue = initialProfile.role === 'venue';
  // Notification preferences (email + text) now live on their own page,
  // /notifications. Hosts and venues get a link to it below; DJs reach it
  // from the header/menu.
  const isDj = initialProfile.role === 'dj';
  /**
   * Hosts have no password.
   *
   * They sign up with a phone number or an email and a 6-digit code, so this
   * page's two password gates were describing a credential that doesn't
   * exist: the Change Password card was unusable, and — worse — the email
   * card demanded a "current password" to confirm, which meant a host who
   * mistyped their address at booking could never fix it. Every contract and
   * planner link would keep going to the wrong inbox with no way out.
   *
   * So for a host the email here is a DELIVERY ADDRESS, not a credential, and
   * it saves like any other profile field.
   */
  const isHost = initialProfile.role === 'host';

  // ── Profile (name + country) ─────────────────────────────────────
  const [name, setName] = useState(initialProfile.name);
  const [country, setCountry] = useState(initialProfile.country);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileAlert, setProfileAlert] = useState<Alert>(null);

  // ── Email ────────────────────────────────────────────────────────
  // Single editable field pre-populated with the current address. The
  // user edits it in place; the password gate below is what protects
  // against accidental changes (no save without re-authentication).
  const [newEmail, setNewEmail] = useState(currentEmail);
  const [confirmPwForEmail, setConfirmPwForEmail] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailAlert, setEmailAlert] = useState<Alert>(null);
  // Has the user actually changed the email value? Used to disable the
  // Save button until there's something to save.
  const emailChanged =
    newEmail.trim().toLowerCase() !== currentEmail.trim().toLowerCase();

  // ── Password ─────────────────────────────────────────────────────
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);  const [pwAlert, setPwAlert] = useState<Alert>(null);

  // ── Venue (only used when isVenue) ────────────────────────────────
  const [venueName, setVenueName] = useState(initialProfile.venueName);
  const [ownerName, setOwnerName] = useState(initialProfile.name); // doubles as page owner for venues
  const [slug, setSlug] = useState(initialProfile.slug);
  // Live availability status — used to disable Save when slug is taken
  // and to show the colored indicator next to the field.
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [venueCountry, setVenueCountry] = useState(initialProfile.country);
  const [addressInput, setAddressInput] = useState(
    // Combine street + city/state/zip into a single human-friendly value for the input.
    [
      initialProfile.address,
      initialProfile.city,
      [initialProfile.state, initialProfile.zip].filter(Boolean).join(' '),
    ].filter(Boolean).join(', ')
  );
  // Hidden values populated by the autocomplete pick — saved separately
  // from the visible string. If the user types freehand, these stay as
  // last-selected (matches vanilla parity).
  const [addrCity, setAddrCity] = useState(initialProfile.city);
  const [addrState, setAddrState] = useState(initialProfile.state);
  const [addrZip, setAddrZip] = useState(initialProfile.zip);
  const [addrSuggestions, setAddrSuggestions] = useState<AddressSuggestion[]>([]);
  const [showAddrSuggestions, setShowAddrSuggestions] = useState(false);
  const addrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [venueSaving, setVenueSaving] = useState(false);
  const [venueAlert, setVenueAlert] = useState<Alert>(null);

  // ── Blocked users — local state so unblock removes from list ─────
  const [blocked, setBlocked] = useState<BlockedUser[]>(initialBlocked);

  // ─────────────────────────────────────────────────────────────────
  // SAVE HANDLERS
  // ─────────────────────────────────────────────────────────────────

  async function saveProfile() {
    setProfileAlert(null);
    if (!name.trim()) {
      setProfileAlert({ type: 'error', msg: 'Please enter a name.' });
      return;
    }
    if (!country) {
      setProfileAlert({ type: 'error', msg: 'Please select a country.' });
      return;
    }
    setProfileSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('users')
        .update({ name: name.trim(), country } as unknown as never)
        .eq('id', initialProfile.id);
      if (error) throw error;
      setProfileAlert({ type: 'success', msg: '✓ Profile updated.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setProfileAlert({ type: 'error', msg });
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveEmail() {
    setEmailAlert(null);
    const trimmed = newEmail.trim().toLowerCase();

    // ── HOST: a delivery address, saved through the server ───────────
    // No password (they don't have one) and no verification link. It's where
    // their paperwork gets sent, not how they log in — so getting it wrong
    // costs them a misdirected email, not access to the account.
    //
    // BUT IT STILL HAS TO BE UNIQUE, and that used to be missed. This block
    // wrote straight to the users table from the browser, checking only the
    // SHAPE of the address. A host could therefore set their delivery address
    // to an email already registered to a DJ, and nothing objected — their
    // contracts and planner links would have gone to that DJ's inbox.
    //
    // "Is this address already taken?" can only be answered against
    // auth.users, which needs the service role, so it moved to
    // /api/account/contact-email. A guard in the browser would be decoration:
    // the browser is what it's guarding against.
    if (isHost) {
      if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        setEmailAlert({ type: 'error', msg: 'Please enter a valid email address.' });
        return;
      }
      setEmailSaving(true);
      try {
        const res = await fetch('/api/account/contact-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: trimmed }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || 'Could not save that address.');
        setEmailAlert({ type: 'success', msg: `✓ Booking emails will go to ${trimmed}.` });
      } catch (err) {
        setEmailAlert({ type: 'error', msg: err instanceof Error ? err.message : 'Unknown error' });
      } finally {
        setEmailSaving(false);
      }
      return;
    }

    if (!trimmed || !confirmPwForEmail) {
      setEmailAlert({ type: 'error', msg: 'Please fill in all fields.' });
      return;
    }
    // Guard: nothing to do if the value matches the current address.
    // Should be prevented by the disabled Save button too, but defense in
    // depth — never hit the server with a no-op.
    if (trimmed === currentEmail.trim().toLowerCase()) {
      setEmailAlert({ type: 'error', msg: 'New email is the same as your current one.' });
      return;
    }
    setEmailSaving(true);
    try {
      // Server action handles re-auth + admin-side email update with
      // email_confirm: true. No verification email is sent — change is
      // immediate.
      const result = await updateMyEmailAction({
        newEmail: trimmed,
        currentPassword: confirmPwForEmail,
      });
      if (!result.success) {
        throw new Error(result.error || 'Email update failed');
      }
      setEmailAlert({
        type: 'success',
        msg: `✓ Email changed to ${trimmed}.`,
      });
      setConfirmPwForEmail('');
      // Don't blank the email field — leave the new value visible until
      // the page reload below shows it as the persisted value.
      // Refresh so the input pre-populates with the new address.
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setEmailAlert({ type: 'error', msg });
    } finally {
      setEmailSaving(false);
    }
  }

  async function savePassword() {
    setPwAlert(null);
    if (!currentPw || !newPw || !confirmPw) {
      setPwAlert({ type: 'error', msg: 'Please fill in all fields.' });
      return;
    }
    if (newPw.length < 8) {
      setPwAlert({ type: 'error', msg: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPw !== confirmPw) {
      setPwAlert({ type: 'error', msg: 'New passwords do not match.' });
      return;
    }
    setPwSaving(true);
    try {
      const supabase = createClient();
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: currentEmail,
        password: currentPw,
      });
      if (authErr) throw new Error('Current password is incorrect.');
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      setPwAlert({ type: 'success', msg: '✓ Password updated.' });
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setPwAlert({ type: 'error', msg });
    } finally {
      setPwSaving(false);
    }
  }

  async function saveVenue() {
    setVenueAlert(null);
    if (!venueName.trim()) {
      setVenueAlert({ type: 'error', msg: 'Venue name is required.' });
      return;
    }
    const finalSlug = makeSlug(slug);
    if (!finalSlug) {
      setVenueAlert({ type: 'error', msg: 'Profile URL is required.' });
      return;
    }
    // Block save if the live check came back "taken" — saves the user a
    // failed save round-trip + a more confusing DB-conflict error.
    if (slugStatus === 'taken') {
      setVenueAlert({ type: 'error', msg: 'That profile URL is already taken — please pick another.' });
      return;
    }

    // Extract street from the combined address input. If the visible string
    // contains the city, split there; otherwise take everything before the
    // first comma. Matches vanilla saveVenueAll.
    const fullAddress = addressInput.trim();
    let address = fullAddress;
    if (addrCity && fullAddress.includes(', ' + addrCity)) {
      address = fullAddress.split(', ' + addrCity)[0].trim();
    } else if (fullAddress.includes(',')) {
      address = fullAddress.split(',')[0].trim();
    }

    setVenueSaving(true);
    try {
      const supabase = createClient();
      // Slug uniqueness — only check if it changed
      if (finalSlug !== initialProfile.slug) {
        const { data: existing } = await supabase
          .from('users')
          .select('id')
          .eq('slug', finalSlug)
          .neq('id', initialProfile.id)
          .limit(1);
        if (existing && existing.length > 0) {
          throw new Error('That profile URL is already taken.');
        }
      }

      const finalOwnerName = ownerName.trim() || venueName.trim();
      const { error } = await supabase
        .from('users')
        .update({
          venue_name: venueName.trim(),
          name: finalOwnerName,
          slug: finalSlug,
          address,
          city: addrCity,
          state: addrState,
          zip: addrZip,
          country: venueCountry,
        } as unknown as never)
        .eq('id', initialProfile.id);
      if (error) throw error;

      setVenueAlert({ type: 'success', msg: '✓ Venue profile saved.' });
      // Sync the slug into local state so a re-edit doesn't think it's
      // still the "old" slug
      setSlug(finalSlug);
      // Also sync the parallel "Profile Info" name field — vanilla writes
      // both name + venue_name together, so the Profile Info name should
      // reflect the same value.
      setName(finalOwnerName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setVenueAlert({ type: 'error', msg });
    } finally {
      setVenueSaving(false);
    }
  }

  async function unblock(userId: string) {
    if (!confirm('Unblock this user?')) return;
    try {
      const supabase = createClient();
      const updated = blocked.filter((b) => b.id !== userId).map((b) => b.id);
      const { error } = await supabase
        .from('users')
        .update({ blocked_users: updated } as unknown as never)
        .eq('id', initialProfile.id);
      if (error) throw error;
      setBlocked((prev) => prev.filter((b) => b.id !== userId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      alert('Error: ' + msg);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // ADDRESS AUTOCOMPLETE
  // ─────────────────────────────────────────────────────────────────

  function onAddressChange(val: string) {
    setAddressInput(val);
    if (addrTimerRef.current) clearTimeout(addrTimerRef.current);
    if (val.trim().length < 5) {
      setAddrSuggestions([]);
      setShowAddrSuggestions(false);
      return;
    }
    addrTimerRef.current = setTimeout(async () => {
      const results = await searchAddresses(val.trim(), venueCountry);
      setAddrSuggestions(results);
      setShowAddrSuggestions(results.length > 0);
    }, 600);
  }

  function onAddressPick(s: AddressSuggestion) {
    // Build a single human-friendly address for the visible field
    const stateZip = [s.state, s.zip].filter(Boolean).join(' ');
    const fullAddr = [s.street, s.city, stateZip].filter(Boolean).join(', ');
    setAddressInput(fullAddr);
    setAddrCity(s.city);
    setAddrState(s.state);
    setAddrZip(s.zip);
    setShowAddrSuggestions(false);
  }

  // Cleanup the debounce timer on unmount
  useEffect(() => () => {
    if (addrTimerRef.current) clearTimeout(addrTimerRef.current);
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.pageWrap}>
      <div className={styles.pageHeader}>
        <h1>Account Settings</h1>
        <p>Manage your account, profile, and security.</p>
      </div>

      {/* Venue card — only for venue role */}
      {isVenue && (
        <div className={styles.card}>
          <h2>Venue Profile</h2>
          {venueAlert && <AlertBlock alert={venueAlert} />}

          <div className={styles.formGroup}>
            <label>Venue Name</label>
            <input
              type="text"
              placeholder="The Grand Ballroom"
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Venue Page Owner</label>
            <input
              type="text"
              placeholder="Your full name"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            {/* Profile URL — uses the same SlugInput component as signup
                so the styling (red border + alternatives when taken) is
                identical to what users saw when signing up. */}
            <SlugInput
              value={slug}
              onChange={setSlug}
              onStatusChange={setSlugStatus}
              generateAlternatives={generateVenueAlternatives}
              placeholder="the-grand-ballroom"
              excludeUserId={initialProfile.id}
              originalSlug={initialProfile.slug}
            />
          </div>

          <div className={styles.formGroup} style={{ position: 'relative' }}>
            <label>Address</label>
            <input
              type="text"
              placeholder="123 Main St, City, State ZIP"
              value={addressInput}
              onChange={(e) => onAddressChange(e.target.value)}
              onBlur={() => setTimeout(() => setShowAddrSuggestions(false), 150)}
              onFocus={() => {
                if (addrSuggestions.length > 0) setShowAddrSuggestions(true);
              }}
              autoComplete="off"
            />
            {showAddrSuggestions && addrSuggestions.length > 0 && (
              <div className={styles.addrSuggestions}>
                {addrSuggestions.map((s, i) => (
                  <div
                    key={i}
                    className={styles.addrSuggestion}
                    // onMouseDown fires before input.onBlur, so we reliably
                    // capture the click before the dropdown is dismissed.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onAddressPick(s);
                    }}
                  >
                    {s.display.length > 60
                      ? s.display.substring(0, 60) + '…'
                      : s.display}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.formGroup}>
            <label>Country</label>
            <select
              value={venueCountry}
              onChange={(e) => setVenueCountry(e.target.value)}
            >
              <option value="">Select country...</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className={styles.saveBtn}
            disabled={venueSaving}
            onClick={saveVenue}
          >
            {venueSaving ? 'Saving…' : 'Save Venue Profile'}
          </button>
        </div>
      )}

      {/* Profile Information */}
      <div className={styles.card}>
        <h2>Profile Information</h2>
        {profileAlert && <AlertBlock alert={profileAlert} />}

        <div className={styles.formGroup}>
          <label>Full Name</label>
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className={styles.formGroup}>
          <label>Country</label>
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Select country...</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className={styles.saveBtn}
          disabled={profileSaving}
          onClick={saveProfile}
        >
          {profileSaving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {/* Email */}
      <div className={styles.card}>
        <h2>Email Address</h2>
        {emailAlert && <AlertBlock alert={emailAlert} />}

        {/* Single editable field. Pre-populated with the current address;
            the user edits it in place. The password field below is what
            actually authorizes the change — no save without re-auth. */}
        <div className={styles.formGroup}>
          <label>Email</label>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder={isHost ? 'your@email.com' : undefined}
          />
          {isHost && (
            <small style={{ display: 'block', marginTop: '.4rem', color: 'var(--muted)', fontSize: '.72rem', lineHeight: 1.4 }}>
              Booking details, contracts and planner links are sent here.
            </small>
          )}
        </div>

        {/* Password confirmation — not for hosts, who don't have one. */}
        {!isHost && (
          <div className={styles.formGroup}>
            <label>Current Password (to confirm)</label>
            <input
              type="password"
              placeholder="Enter your current password"
              value={confirmPwForEmail}
              onChange={(e) => setConfirmPwForEmail(e.target.value)}
            />
          </div>
        )}

        <button
          type="button"
          className={styles.saveBtn}
          disabled={emailSaving || !emailChanged}
          onClick={saveEmail}
        >
          {emailSaving ? 'Updating…' : 'Update Email'}
        </button>
      </div>

      {/* Phone — hosts only. Sits where Change Password would be, because for
          a host this IS the credential. Unlike the email card above it needs a
          code, sent to the NEW number, so a typo can't lock them out. */}
      {isHost && (
        <HostPhoneCard
          userId={initialProfile.id}
          currentPhone={currentPhone}
          currentSmsPhone={currentSmsPhone}
        />
      )}

      {/* Password — hidden for hosts. They sign in with a code, so there is
          no password to change and the card could only ever fail. */}
      {!isHost && (
      <div className={styles.card}>
        <h2>Change Password</h2>
        {pwAlert && <AlertBlock alert={pwAlert} />}

        <div className={styles.formGroup}>
          <label>Current Password</label>
          <input
            type="password"
            placeholder="Current password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
          />
        </div>

        <div className={styles.formGroup}>
          <label>New Password</label>
          <input
            type="password"
            placeholder="Minimum 8 characters"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
        </div>

        <div className={styles.formGroup}>
          <label>Confirm New Password</label>
          <input
            type="password"
            placeholder="Repeat new password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
          />
        </div>

        <button
          type="button"
          className={styles.saveBtn}
          disabled={pwSaving}
          onClick={savePassword}
        >
          {pwSaving ? 'Updating…' : 'Update Password'}
        </button>
      </div>
      )}

      {/* ── Notifications ──────────────────────────────────────────────
          Email + text preferences live on their own page now. Hosts and
          venues get here from this link; DJs use the header/menu link. */}
      {!isDj && (
        <div className={styles.card}>
          <h2>Notifications</h2>
          <p className={styles.cardHint}>
            Choose which email and text alerts you receive for bookings and
            inbox messages.
          </p>
          <Link
            href="/notifications"
            className={styles.saveBtn}
            style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
          >
            Manage Notifications
          </Link>
        </div>
      )}

      {/* Blocked Users — only shown if there are any */}
      {blocked.length > 0 && (
        <div className={styles.blockedSection}>
          <div className={styles.blockedHeader}>Blocked Users</div>
          <div>
            {blocked.map((u) => (
              <div key={u.id} className={styles.blockedRow}>
                <span>{u.name}</span>
                <button
                  type="button"
                  onClick={() => unblock(u.id)}
                  className={styles.unblockBtn}
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AlertBlock({ alert }: { alert: NonNullable<Alert> }) {
  return (
    <div
      className={`${styles.alert} ${
        alert.type === 'success' ? styles.alertSuccess : styles.alertError
      }`}
    >
      {alert.msg}
    </div>
  );
}
