'use client';

// GeneralTab — first tab of /update-dj-profile.
// Faithful port of update-dj-profile.html lines 47-304.
//
// Deferred to later sessions:
//   - Slug availability check (live debounced check via API + fallback suggestions)
//   - Zip → city/state lookup (Nominatim or zippopotam.us)
//
// Everything else is here: name, slug input (no live check yet), private
// profile toggle, mobile event-types or club-genres (depending on dj_type),
// country, zip, travel distance, dj start year, bio, phone. Avatar upload
// + crop is also here (AvatarCrop modal mounts on file select).

import { useEffect, useRef, useState } from 'react';
import styles from './updateDjProfile.module.css';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/ConfirmModal';
import { updateMyEmailAction } from '@/lib/actions/updateMyEmail';
import {
  MOBILE_EVENT_TYPES,
  MOB_CAT_GENERAL_TYPES,
  MOB_CAT_WEDDING_TYPES,
  MOB_CAT_MITZVAH_TYPES,
  CLUB_GENRES,
  TRAVEL_DISTANCES,
} from './constants';
import type { GeneralFormState } from './UpdateDjProfileClient';
import AvatarCrop from './AvatarCrop';
import BusinessLogoSection from './BusinessLogoSection';
import BlockedUsersSection from './BlockedUsersSection';
import { SlugInput } from '@/app/(simple)/signup/SlugInput';
import { generateDjAlternatives } from '@/app/(simple)/signup/helpers';
import ProfileQrCode from './ProfileQrCode';

// ── Business-address autocomplete ────────────────────────────────────────
// One line. As the DJ types (5+ chars, debounced) we query Nominatim and show
// up to 10 real addresses; picking one fills street + city + state + zip in a
// single tap — those three are never typed. The country sits as a compact
// flag + code chip to the RIGHT of the box and biases the search.

interface AddrSuggestion {
  display: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

// Name → { 2-letter display code, flag emoji, Nominatim country code }. The
// chip shows "🇺🇸 US"; the cc biases the address lookup.
const COUNTRY_CHIPS: { name: string; code: string; flag: string; cc: string }[] = [
  { name: 'United States', code: 'US', flag: '🇺🇸', cc: 'us' },
  { name: 'United Kingdom', code: 'UK', flag: '🇬🇧', cc: 'gb' },
  { name: 'Canada', code: 'CA', flag: '🇨🇦', cc: 'ca' },
  { name: 'Australia', code: 'AU', flag: '🇦🇺', cc: 'au' },
  { name: 'Germany', code: 'DE', flag: '🇩🇪', cc: 'de' },
  { name: 'France', code: 'FR', flag: '🇫🇷', cc: 'fr' },
  { name: 'Netherlands', code: 'NL', flag: '🇳🇱', cc: 'nl' },
  { name: 'Spain', code: 'ES', flag: '🇪🇸', cc: 'es' },
  { name: 'Italy', code: 'IT', flag: '🇮🇹', cc: 'it' },
  { name: 'Brazil', code: 'BR', flag: '🇧🇷', cc: 'br' },
  { name: 'Mexico', code: 'MX', flag: '🇲🇽', cc: 'mx' },
  { name: 'Japan', code: 'JP', flag: '🇯🇵', cc: 'jp' },
  { name: 'South Africa', code: 'ZA', flag: '🇿🇦', cc: 'za' },
  { name: 'New Zealand', code: 'NZ', flag: '🇳🇿', cc: 'nz' },
  { name: 'Ireland', code: 'IE', flag: '🇮🇪', cc: 'ie' },
  { name: 'Sweden', code: 'SE', flag: '🇸🇪', cc: 'se' },
  { name: 'Norway', code: 'NO', flag: '🇳🇴', cc: 'no' },
  { name: 'Denmark', code: 'DK', flag: '🇩🇰', cc: 'dk' },
  { name: 'Belgium', code: 'BE', flag: '🇧🇪', cc: 'be' },
  { name: 'Switzerland', code: 'CH', flag: '🇨🇭', cc: 'ch' },
  { name: 'Portugal', code: 'PT', flag: '🇵🇹', cc: 'pt' },
  { name: 'Other', code: '🌐', flag: '', cc: '' },
];

// limit=10 per request; addressdetails=1 to break out city/state/zip. Same
// parse the booking form and account-settings use.
async function searchAddresses10(query: string, country: string): Promise<AddrSuggestion[]> {
  if (query.trim().length < 5) return [];
  const cc = COUNTRY_CHIPS.find((c) => c.name === country)?.cc || '';
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}${cc ? '&countrycodes=' + cc : ''}&format=json&limit=10&addressdetails=1`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((r: { display_name?: string; address?: Record<string, string> }) => {
      const a = r.address || {};
      const street = (a.house_number ? a.house_number + ' ' : '') + (a.road || '');
      return {
        display: r.display_name || '',
        street,
        city: a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || '',
        state: a.state || a.region || '',
        zip: a.postcode || '',
      };
    });
  } catch {
    return [];
  }
}

function AddressField({
  address, country, city, state, zip, onChange,
}: {
  address: string;
  country: string;
  city: string;
  state: string;
  zip: string;
  onChange: (patch: { address?: string; city?: string; state?: string; zip?: string; country?: string }) => void;
}) {
  const [suggestions, setSuggestions] = useState<AddrSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function handleType(v: string) {
    // Free text is saved even without a pick, so a manual address still works.
    onChange({ address: v });
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 5) { setSuggestions([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      const results = await searchAddresses10(v, country);
      setSuggestions(results);
      setOpen(results.length > 0);
    }, 300);
  }

  function pick(s: AddrSuggestion) {
    onChange({ address: s.street || s.display, city: s.city, state: s.state, zip: s.zip });
    setOpen(false);
    setSuggestions([]);
  }

  return (
    <div className={styles.formGroup} ref={wrapRef} style={{ position: 'relative' }}>
      <label htmlFor="ud-address">Business Address</label>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'stretch' }}>
        <input
          type="text"
          id="ud-address"
          autoComplete="off"
          placeholder="Start typing your address…"
          value={address}
          onChange={(e) => handleType(e.target.value)}
          className={styles.input}
          style={{ flex: 1 }}
        />
        {/* Country as a compact flag + code chip to the right of the box. */}
        <select
          aria-label="Country"
          value={country}
          onChange={(e) => onChange({ country: e.target.value })}
          className={styles.select}
          style={{ width: 'auto', flex: '0 0 auto' }}
        >
          {COUNTRY_CHIPS.map((c) => (
            <option key={c.name} value={c.name}>{c.flag} {c.code}</option>
          ))}
        </select>
      </div>

      {open && suggestions.length > 0 && (
        <ul
          style={{
            position: 'absolute', zIndex: 50, left: 0, right: 0, top: '100%',
            margin: '.25rem 0 0', padding: 0, listStyle: 'none',
            background: 'var(--card,#111)', border: '1px solid var(--border,#333)',
            borderRadius: 8, maxHeight: 340, overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,.5)',
          }}
        >
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => pick(s)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '.55rem .75rem', background: 'none', border: 'none',
                  color: 'var(--white,#fff)', fontSize: '.82rem', cursor: 'pointer',
                  borderBottom: '1px solid var(--border,#222)', lineHeight: 1.35,
                }}
              >
                {s.display}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.fieldHint}>
        {city && state
          ? `${city}, ${state}${zip ? ' ' + zip : ''}`
          : 'Pick from the list to fill your city, state and ZIP.'}
      </p>
    </div>
  );
}

interface Props {
  state: GeneralFormState;
  onChange: <K extends keyof GeneralFormState>(field: K, value: GeneralFormState[K]) => void;
  djType: 'club' | 'mobile' | null;
  email: string;
  slug: string | null;
  // Site URL is used for the private-profile share link preview. SSR-safe
  // way is to pass it down rather than reading window.location.origin.
  siteUrl: string;
  // Auth user ID — needed by AvatarCrop to write to `${userId}/avatar.png`
  // in Supabase storage.
  userId: string;
  // Persist the slug immediately to the DB and clear ONLY its dirty flag, so
  // the unsaved-changes guard doesn't fire for a URL we've already saved.
  onSlugSaved: (slug: string) => void;
}

export default function GeneralTab({ state, onChange, djType, email, slug, siteUrl, userId, onSlugSaved }: Props) {
  const slugDisplay = slug || 'your-url';
  const { confirm, confirmDialog } = useConfirm();

  // Mobile party types split into two groups for display:
  //   General Events  — everything that maps to the "general" package cat
  //   Specialty Events — Weddings + Bar/Bat Mitzvahs (their own package cats)
  // Grouping uses the same category constants that drive the Booking tab
  // package categories, so the two lists stay in sync automatically.
  const generalEventTypes = MOBILE_EVENT_TYPES.filter((t) =>
    MOB_CAT_GENERAL_TYPES.includes(t.val)
  );
  const specialtyEventTypes = MOBILE_EVENT_TYPES.filter(
    (t) => MOB_CAT_WEDDING_TYPES.includes(t.val) || MOB_CAT_MITZVAH_TYPES.includes(t.val)
  );
  const renderEventType = (t: { val: string; label: string }) => (
    <label
      key={t.val}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '.45rem .7rem',
        background: 'transparent',
        border: '1px solid rgba(30, 30, 48, .5)',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: '.8rem',
        color: 'var(--white)',
      }}
    >
      <input
        type="checkbox"
        style={{
          width: 15,
          height: 15,
          marginRight: 10,
          flexShrink: 0,
          accentColor: 'var(--neon)',
          cursor: 'pointer',
        }}
        checked={state.mobileEvents.includes(t.val)}
        onChange={(e) => {
          const next = e.target.checked
            ? [...state.mobileEvents, t.val]
            : state.mobileEvents.filter((v) => v !== t.val);
          onChange('mobileEvents', next);
        }}
      />
      {t.label}
    </label>
  );

  // ── Avatar state ─────────────────────────────────────────────────
  // `pickedFile` is non-null while the AvatarCrop modal is open.
  // After successful upload, parent's onChange persists the new URL into
  // state.avatarUrl which feeds the circle preview.
  // Errors are shown inside the AvatarCrop modal — no parent state needed.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [avatarStatus, setAvatarStatus] = useState<'idle' | 'updated'>('idle');

  // First letter of the DJ name — used for the placeholder circle when
  // no avatar exists yet. Vanilla shows '?'; we go with the first
  // initial which is friendlier for new accounts.
  const initials = (state.name || '').trim().charAt(0).toUpperCase() || '?';

  function onAvatarClick() {
    fileInputRef.current?.click();
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPickedFile(file);
    setAvatarStatus('idle');
  }

  function onCropClose() {
    setPickedFile(null);
    // Reset the file input so the same file can be reselected later
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function onCropSuccess(publicUrl: string) {
    onChange('avatarUrl', publicUrl);
    setPickedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setAvatarStatus('updated');
    // Clear status after 3s
    setTimeout(() => setAvatarStatus('idle'), 3000);
  }

  async function onAvatarDelete(e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await confirm({
      title: 'Remove profile photo?',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    // Vanilla parity: clear the form field. The image stays in storage
    // but the users.avatar_url column will be set to null on next save.
    onChange('avatarUrl', '');
  }

  return (
    <div>
      {confirmDialog}
      {/* Avatar — click to upload, opens AvatarCrop modal */}
      <div
        className={styles.avatarTop}
        onClick={onAvatarClick}
        title="Click to change photo"
      >
        {/* Wrapper is relatively positioned so the delete button can be
            absolutely positioned over the avatar without being clipped
            by .avatarCircle's overflow:hidden (which would chop the X). */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div className={styles.avatarCircle}>
            {state.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={state.avatarUrl}
                alt="Profile"
                className={styles.avatarCircleImg}
              />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          {state.avatarUrl && (
            <button
              type="button"
              onClick={onAvatarDelete}
              className={styles.avatarDeleteBtn}
              title="Remove photo"
            >
              ✕
            </button>
          )}
        </div>
        <div
          className={`${styles.avatarTopInfo}${
            avatarStatus === 'updated' ? ' ' + styles.avatarTopInfoUpdated : ''
          }`}
        >
          <strong>Profile Photo</strong>
          <span>
            {avatarStatus === 'updated'
              ? '✓ Photo updated'
              : state.avatarUrl
              ? 'Click to change'
              : 'Click to upload & crop'}
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onFilePicked}
          style={{ display: 'none' }}
        />
      </div>

      {/* Crop modal — mounts only when a file is picked */}
      <AvatarCrop
        file={pickedFile}
        userId={userId}
        onClose={onCropClose}
        onSuccess={onCropSuccess}
      />

      {/* Business logo — the shared brand logo (planner, contracts, everywhere). */}
      <BusinessLogoSection />

      {/* Private profile toggle */}
      <div className={styles.privateRow}>
        <input
          type="checkbox"
          id="profile-private"
          checked={state.profilePrivate}
          onChange={(e) => onChange('profilePrivate', e.target.checked)}
        />
        <div>
          <label htmlFor="profile-private" className={styles.privateLabel}>
            Private Profile
          </label>
          <div className={styles.privateHint}>
            Hidden from search &amp; directory. Share your link:{' '}
            <span className={styles.privateUrl}>
              {siteUrl}/{slugDisplay}
            </span>
          </div>
        </div>
      </div>

      {/* Email — inline edit form. Click "Change" to reveal new-email +
          current-password fields. Server action does the swap with
          email_confirm: true so no verification email is sent. */}
      <EmailChangeBlock currentEmail={email} />

      {/* Password — inline edit form. Same pattern as email. */}
      <PasswordChangeBlock />

      {/* Name + Custom URL — grouped together since the URL derives from
          and lives under the name on signup. Label adapts to dj_type:
          mobile DJs are typically a company brand ("DJ Nova Productions")
          while club DJs go by a single stage name ("DJ Nova"). */}
      <div className={styles.formGroup}>
        <label htmlFor="ud-name">
          {djType === 'club' ? 'DJ Name' : 'DJ / Company Name'}
        </label>
        <input
          type="text"
          id="ud-name"
          placeholder={djType === 'club' ? 'e.g. DJ Nova' : 'e.g. DJ Nova Productions'}
          value={state.name}
          onChange={(e) => onChange('name', e.target.value)}
          className={styles.input}
        />

        {/* Nested URL field — keeps the slug input visually grouped under
            the name field. Border-left/indent removed so the input box
            aligns flush with the other fields above and below. */}
        <div style={{ marginTop: '.85rem' }}>
          <SlugChangeGate
            email={email}
            userId={userId}
            currentUrl={`${siteUrl}/${state.slug || 'your-url'}`}
            currentSlug={state.slug}
            onSaved={onSlugSaved}
            renderInput={({ value, onChange: setDraft, onStatusChange }) => (
              <SlugInput
                value={value}
                onChange={setDraft}
                onStatusChange={onStatusChange}
                generateAlternatives={generateDjAlternatives}
                placeholder="e.g. dj-nova"
                excludeUserId={userId}
                originalSlug={slug || ''}
              />
            )}
          />

          {/* Premium: downloadable QR code for the public profile, sitting
              right under the URL it points at. Encodes the permanent profile
              ID (never breaks on a slug change); shows the live slug as caption. */}
          <ProfileQrCode slug={state.slug} djName={state.name} profileId={userId} />
        </div>
      </div>

      {/* Mobile event types — only for mobile DJs */}
      {djType === 'mobile' && (
        <div className={styles.formGroup}>
          <label>Mobile Party Types (select all that apply)</label>
          <div className={styles.specBox}>
            <div className={styles.partyGroupLabel}>General Events</div>
            <div className={styles.checkboxGrid}>
              {generalEventTypes.map(renderEventType)}
            </div>
            <div className={`${styles.partyGroupLabel} ${styles.partyGroupLabelLater}`}>
              Specialty Events
            </div>
            <div className={styles.checkboxGrid}>
              {specialtyEventTypes.map(renderEventType)}
            </div>
          </div>
        </div>
      )}

      {/* Club genres — only for club DJs */}
      {djType === 'club' && (
        <div className={styles.formGroup}>
          <label>Music Genres (select all that apply)</label>
          <div className={styles.specBox}>
            <div className={styles.checkboxGrid}>
              {CLUB_GENRES.map((g) => (
                <label
                  key={g.val}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '.45rem .7rem',
                    background: 'transparent',
                    border: '1px solid rgba(30, 30, 48, .5)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: '.8rem',
                    color: 'var(--white)',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{
                      width: 15,
                      height: 15,
                      marginRight: 10,
                      flexShrink: 0,
                      accentColor: 'var(--neon)',
                      cursor: 'pointer',
                    }}
                    checked={state.clubGenres.includes(g.val)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...state.clubGenres, g.val]
                        : state.clubGenres.filter((v) => v !== g.val);
                      onChange('clubGenres', next);
                    }}
                  />
                  {g.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Business Address — one-line autocomplete with the country chip to its
          right. Picking a suggestion fills city/state/zip. Public: goes on the
          standard contract and the planner header, and pre-fills a mailing
          address for check payments. */}
      <AddressField
        address={state.address}
        country={state.country}
        city={state.city}
        state={state.state}
        zip={state.zip}
        onChange={(patch) => {
          if (patch.address !== undefined) onChange('address', patch.address);
          if (patch.city !== undefined) onChange('city', patch.city);
          if (patch.state !== undefined) onChange('state', patch.state);
          if (patch.zip !== undefined) onChange('zip', patch.zip);
          if (patch.country !== undefined) onChange('country', patch.country);
        }}
      />

      {/* Contact Phone — ABOVE Distance, per request. Public/business number,
          kept distinct from the sign-in number and the text-notification
          number, which live elsewhere. */}
      <div className={styles.formGroup}>
        <label htmlFor="ud-phone">Contact Phone</label>
        <input
          type="text"
          id="ud-phone"
          placeholder="e.g. +1 917-555-1234"
          value={state.phone}
          onChange={(e) => onChange('phone', e.target.value)}
          className={styles.input}
        />
        <p className={styles.fieldHint}>
          Shown to clients on your profile and contracts. Separate from your
          login number and your text-notification number.
        </p>
      </div>

      {/* Travel distance */}
      <div className={styles.formGroup}>
        <label htmlFor="ud-travel">Distance Willing to Travel</label>
        <select
          id="ud-travel"
          value={state.travelDistance}
          onChange={(e) => onChange('travelDistance', e.target.value)}
          className={styles.select}
        >
          {TRAVEL_DISTANCES.map((d) => (
            <option key={d.val || 'empty'} value={d.val}>{d.label}</option>
          ))}
        </select>
      </div>

      {/* DJ start year field removed — years-of-experience is no longer
          shown on profiles, so the input is no longer needed. */}

      {/* Blocked Users — at the bottom of the tab. Moved here from the old
          account-settings page, which DJs no longer see. */}
      <BlockedUsersSection />

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// EmailChangeBlock — inline form to change the account's email address.
// Click "Change" to expand the form. Server action does the actual swap
// with email_confirm: true (no verification email sent).
// ─────────────────────────────────────────────────────────────────────────
function EmailChangeBlock({ currentEmail }: { currentEmail: string }) {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [shownEmail, setShownEmail] = useState(currentEmail);

  async function save(e?: React.MouseEvent) {
    // Stop the click from bubbling up to the surrounding <form> in
    // UpdateDjProfileClient. Without this, certain browsers/autofill
    // managers can swallow the first click as a focus shift, requiring
    // a second click to actually trigger the save.
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setFeedback(null);
    if (!newEmail.trim() || !pw) {
      setFeedback({ msg: 'Please fill in both fields.', ok: false });
      return;
    }
    setBusy(true);
    try {
      const result = await updateMyEmailAction({
        newEmail: newEmail.trim(),
        currentPassword: pw,
      });
      if (!result.success) {
        setFeedback({ msg: result.error || 'Failed', ok: false });
      } else {
        setFeedback({ msg: '✓ Email changed.', ok: true });
        setShownEmail(result.newEmail || newEmail.trim());
        setNewEmail('');
        setPw('');
        // Collapse the form after a moment so the success state is visible.
        setTimeout(() => {
          setOpen(false);
          setFeedback(null);
        }, 1500);
      }
    } catch (e) {
      setFeedback({ msg: e instanceof Error ? e.message : 'Failed', ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.formGroup}>
      <label>Email Address</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <input
          type="email"
          value={shownEmail}
          readOnly
          className={styles.input}
          style={{ flex: 1, opacity: 0.7 }}
        />
        {!open && (
          <button
            type="button"
            onClick={() => { setOpen(true); setFeedback(null); }}
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '.62rem',
              letterSpacing: '.07em',
              textTransform: 'uppercase',
              padding: '.6rem 1rem',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--muted)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Change
          </button>
        )}
      </div>

      {open && (
        <div style={{
          marginTop: '.75rem',
          padding: '1rem',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '.65rem',
        }}>
          <input
            type="email"
            placeholder="New email address"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => {
              // Trap Enter so it triggers the inline save instead of the
              // outer <form>'s submit (which would save the whole profile).
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                save();
              }
            }}
            className={styles.input}
            autoComplete="email"
          />
          <input
            type="password"
            placeholder="Current password (to confirm)"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                save();
              }
            }}
            className={styles.input}
            autoComplete="current-password"
          />
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={(e) => save(e)}
              disabled={busy}
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '.62rem',
                letterSpacing: '.07em',
                textTransform: 'uppercase',
                padding: '.55rem 1rem',
                borderRadius: '6px',
                border: '1px solid var(--neon)',
                background: 'var(--neon-dim)',
                color: 'var(--neon)',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.5 : 1,
              }}
            >
              {busy ? 'Saving…' : 'Update Email'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setNewEmail(''); setPw(''); setFeedback(null); }}
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '.62rem',
                letterSpacing: '.07em',
                textTransform: 'uppercase',
                padding: '.55rem 1rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--muted)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            {feedback && (
              <span style={{
                fontSize: '.78rem',
                color: feedback.ok ? 'var(--success)' : 'var(--error)',
              }}>
                {feedback.msg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PasswordChangeBlock — inline form to change the account's password.
// ─────────────────────────────────────────────────────────────────────────
// SlugChangeGate — the profile URL is a public identity, so we don't let it
// be edited casually. It stays LOCKED (read-only) until the DJ re-confirms
// their current password (same signInWithPassword re-auth used by the
// password/email blocks). Once unlocked, they edit a DRAFT and click Save
// (next to the field). Save writes the slug DIRECTLY to the DB — like the
// email/password blocks — and reports up via onSaved so the parent clears
// just the slug's dirty flag (no false "unsaved changes" warning).
// ─────────────────────────────────────────────────────────────────────────
type GateStatus = 'idle' | 'checking' | 'available' | 'taken';

function SlugChangeGate({
  email,
  userId,
  currentUrl,
  currentSlug,
  onSaved,
  renderInput,
}: {
  email: string;
  userId: string;
  currentUrl: string;
  currentSlug: string;
  onSaved: (slug: string) => void;
  renderInput: (p: {
    value: string;
    onChange: (v: string) => void;
    onStatusChange: (s: GateStatus) => void;
  }) => React.ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [draft, setDraft] = useState(currentSlug || '');
  const [status, setStatus] = useState<GateStatus>('idle');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const changed = (draft || '').trim() !== (currentSlug || '').trim();
  const canSave = changed && status === 'available' && !saving;

  async function verify(e?: React.MouseEvent) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    setErr(null);
    if (!pw) { setErr('Enter your password to continue.'); return; }
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const addr = user?.email || email;
      if (!addr) throw new Error('Not signed in.');
      const { error } = await supabase.auth.signInWithPassword({ email: addr, password: pw });
      if (error) throw new Error('Incorrect password.');
      setUnlocked(true);
      setOpen(false);
      setPw('');
      setDraft(currentSlug || '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not verify.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const next = (draft || '').trim();
    if (!next || next === (currentSlug || '').trim() || status !== 'available') return;
    setSaving(true);
    setErr(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('users').update({ slug: next } as unknown as never).eq('id', userId);
      if (error) { setErr('That URL was just taken — try another.'); return; }
      onSaved(next);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save your URL.');
    } finally {
      setSaving(false);
    }
  }

  const btn = (variant: 'ghost' | 'primary', enabled = true): React.CSSProperties => ({
    fontFamily: "'Space Mono', monospace",
    fontSize: '.62rem',
    letterSpacing: '.07em',
    textTransform: 'uppercase',
    padding: '.6rem 1.1rem',
    borderRadius: 6,
    border: variant === 'primary' ? 'none' : '1px solid var(--border)',
    background: variant === 'primary' ? 'var(--neon)' : 'transparent',
    color: variant === 'primary' ? 'var(--black)' : 'var(--muted)',
    fontWeight: variant === 'primary' ? 700 : 400,
    whiteSpace: 'nowrap',
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.45,
  });

  // ── Unlocked: edit a draft + Save (writes straight to the DB) ──
  if (unlocked) {
    return (
      <div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {renderInput({
              value: draft,
              onChange: (v) => { setDraft(v); setSaved(false); },
              onStatusChange: setStatus,
            })}
          </div>
          <button type="button" disabled={!canSave} onClick={save} style={btn('primary', canSave)}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {err && <p style={{ margin: '.5rem 0 0', color: '#ff6b6b', fontSize: '.72rem' }}>{err}</p>}
        {!err && saved && !changed ? (
          <p style={{ margin: '.5rem 0 0', fontSize: '.72rem', color: 'var(--success)' }}>
            ✓ URL saved.
          </p>
        ) : !err ? (
          <p style={{ margin: '.5rem 0 0', fontSize: '.7rem', color: 'var(--muted)' }}>
            Enter a new URL, then click Save to apply it.
          </p>
        ) : null}
      </div>
    );
  }

  // ── Locked: read-only URL + password to unlock ──
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <input type="text" value={currentUrl} readOnly className={styles.input} style={{ flex: 1, opacity: 0.7 }} />
        {!open && (
          <button type="button" onClick={() => { setOpen(true); setErr(null); }} style={btn('ghost')}>
            🔒 Change
          </button>
        )}
      </div>

      {open && (
        <div style={{
          marginTop: '.75rem',
          padding: '1rem',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: '.65rem',
        }}>
          <p style={{ margin: 0, fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.4 }}>
            For your security, confirm your password to change your profile URL.
          </p>
          <input
            type="password"
            placeholder="Current password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); verify(); } }}
            className={styles.input}
            autoComplete="current-password"
          />
          {err && <div style={{ color: '#ff6b6b', fontSize: '.75rem' }}>{err}</div>}
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button type="button" onClick={verify} disabled={busy} style={btn('primary', !busy)}>
              {busy ? 'Verifying…' : 'Unlock'}
            </button>
            <button type="button" onClick={() => { setOpen(false); setPw(''); setErr(null); }} style={btn('ghost')}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Uses Supabase auth.updateUser directly after re-authenticating with
// the current password. No server action needed since password updates
// don't have the verification-email problem that email changes do.
// ─────────────────────────────────────────────────────────────────────────
function PasswordChangeBlock() {
  const [open, setOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  async function save(e?: React.MouseEvent) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setFeedback(null);
    if (!currentPw || !newPw || !confirmPw) {
      setFeedback({ msg: 'Please fill in all fields.', ok: false });
      return;
    }
    if (newPw.length < 8) {
      setFeedback({ msg: 'New password must be at least 8 characters.', ok: false });
      return;
    }
    if (newPw !== confirmPw) {
      setFeedback({ msg: 'New passwords do not match.', ok: false });
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      // Re-auth with current password first
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !user.email) throw new Error('Not signed in.');
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPw,
      });
      if (authErr) throw new Error('Current password is incorrect.');
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      setFeedback({ msg: '✓ Password updated.', ok: true });
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setTimeout(() => {
        setOpen(false);
        setFeedback(null);
      }, 1500);
    } catch (e) {
      setFeedback({ msg: e instanceof Error ? e.message : 'Failed', ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.formGroup}>
      <label>Password</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <input
          type="password"
          value="••••••••••"
          readOnly
          className={styles.input}
          style={{ flex: 1, opacity: 0.7 }}
        />
        {!open && (
          <button
            type="button"
            onClick={() => { setOpen(true); setFeedback(null); }}
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '.62rem',
              letterSpacing: '.07em',
              textTransform: 'uppercase',
              padding: '.6rem 1rem',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--muted)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Change
          </button>
        )}
      </div>

      {open && (
        <div style={{
          marginTop: '.75rem',
          padding: '1rem',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '.65rem',
        }}>
          <input
            type="password"
            placeholder="Current password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                save();
              }
            }}
            className={styles.input}
            autoComplete="current-password"
          />
          <input
            type="password"
            placeholder="New password (min 8 chars)"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                save();
              }
            }}
            className={styles.input}
            autoComplete="new-password"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                save();
              }
            }}
            className={styles.input}
            autoComplete="new-password"
          />
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={(e) => save(e)}
              disabled={busy}
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '.62rem',
                letterSpacing: '.07em',
                textTransform: 'uppercase',
                padding: '.55rem 1rem',
                borderRadius: '6px',
                border: '1px solid var(--neon)',
                background: 'var(--neon-dim)',
                color: 'var(--neon)',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.5 : 1,
              }}
            >
              {busy ? 'Saving…' : 'Update Password'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCurrentPw(''); setNewPw(''); setConfirmPw('');
                setFeedback(null);
              }}
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '.62rem',
                letterSpacing: '.07em',
                textTransform: 'uppercase',
                padding: '.55rem 1rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--muted)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            {feedback && (
              <span style={{
                fontSize: '.78rem',
                color: feedback.ok ? 'var(--success)' : 'var(--error)',
              }}>
                {feedback.msg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
