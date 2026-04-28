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

import { useRef, useState } from 'react';
import styles from './updateDjProfile.module.css';
import {
  MOBILE_EVENT_TYPES,
  CLUB_GENRES,
  COUNTRIES,
  TRAVEL_DISTANCES,
  DJ_START_YEARS,
} from './constants';
import type { GeneralFormState } from './UpdateDjProfileClient';
import AvatarCrop from './AvatarCrop';

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
}

export default function GeneralTab({ state, onChange, djType, email, slug, siteUrl, userId }: Props) {
  const slugDisplay = slug || 'your-url';

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

  function onAvatarDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Remove profile photo?')) return;
    // Vanilla parity: clear the form field. The image stays in storage
    // but the users.avatar_url column will be set to null on next save.
    onChange('avatarUrl', '');
  }

  return (
    <div>
      {/* Avatar — click to upload, opens AvatarCrop modal */}
      <div
        className={styles.avatarTop}
        onClick={onAvatarClick}
        title="Click to change photo"
      >
        <div className={styles.avatarCircle}>
          {state.avatarUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.avatarUrl}
                alt="Profile"
                className={styles.avatarCircleImg}
              />
              <button
                type="button"
                onClick={onAvatarDelete}
                className={styles.avatarDeleteBtn}
                title="Remove photo"
              >
                ✕
              </button>
            </>
          ) : (
            <span>{initials}</span>
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

      {/* Email (readonly) */}
      <div className={styles.formGroup}>
        <label htmlFor="ud-email">Email Address</label>
        <input
          type="email"
          id="ud-email"
          value={email}
          readOnly
          className={styles.input}
        />
        <p className={styles.fieldHint}>Email cannot be changed</p>
      </div>

      {/* Password — change deferred (separate flow) */}
      <div className={styles.formGroup}>
        <label htmlFor="ud-password">Password</label>
        <input
          type="password"
          id="ud-password"
          placeholder="Password change coming soon"
          disabled
          className={styles.input}
          style={{ opacity: 0.4 }}
        />
      </div>

      {/* Name */}
      <div className={styles.formGroup}>
        <label htmlFor="ud-name">DJ / Company Name</label>
        <input
          type="text"
          id="ud-name"
          placeholder="e.g. DJ Nova"
          value={state.name}
          onChange={(e) => onChange('name', e.target.value)}
          className={styles.input}
        />
      </div>

      {/* Slug */}
      <div className={styles.formGroup}>
        <label htmlFor="ud-slug">Custom Profile URL</label>
        <input
          type="text"
          id="ud-slug"
          placeholder="e.g. dj-nova"
          autoComplete="off"
          value={state.slug}
          onChange={(e) => onChange('slug', e.target.value)}
          className={styles.input}
          style={{ fontFamily: "'Space Mono', monospace", fontSize: '.85rem' }}
        />
        <p className={styles.fieldHint}>
          {siteUrl}/<strong>{slugDisplay}</strong>
        </p>
      </div>

      {/* Mobile event types — only for mobile DJs */}
      {djType === 'mobile' && (
        <div className={styles.formGroup}>
          <label>Mobile Party Types (select all that apply)</label>
          <div className={styles.specBox}>
            <div className={styles.checkboxGrid}>
              {MOBILE_EVENT_TYPES.map((t) => (
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
              ))}
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

      {/* Country */}
      <div className={styles.formGroup}>
        <label htmlFor="ud-country">Country</label>
        <select
          id="ud-country"
          value={state.country}
          onChange={(e) => onChange('country', e.target.value)}
          className={styles.select}
        >
          {COUNTRIES.map((c) => (
            <option key={c.val || 'empty'} value={c.val}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* Zip */}
      <div className={styles.formGroup}>
        <label htmlFor="ud-zip">Zip / Postal Code</label>
        <input
          type="text"
          id="ud-zip"
          placeholder="e.g. 10001"
          value={state.zip}
          onChange={(e) => onChange('zip', e.target.value)}
          className={styles.input}
        />
        <p className={styles.fieldHint}>
          Zip-to-city/state lookup coming in a later session
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

      {/* DJ start year */}
      <div className={styles.formGroup}>
        <label htmlFor="ud-start-year">The Year I Started DJing</label>
        <select
          id="ud-start-year"
          value={state.djStartYear}
          onChange={(e) => onChange('djStartYear', e.target.value)}
          className={styles.select}
        >
          {DJ_START_YEARS.map((y) => (
            <option key={y.val || 'empty'} value={y.val}>{y.label}</option>
          ))}
        </select>
        <p className={styles.fieldHint}>
          Used to calculate years of experience on your profile
        </p>
      </div>

      {/* Bio */}
      <div className={styles.formGroup}>
        <label htmlFor="ud-bio">About / Bio</label>
        <textarea
          id="ud-bio"
          rows={5}
          placeholder="Tell people about yourself, your style, experience..."
          value={state.bio}
          onChange={(e) => onChange('bio', e.target.value)}
          className={styles.textarea}
        />
      </div>

      {/* Phone */}
      <div className={styles.formGroup}>
        <label htmlFor="ud-phone">Phone</label>
        <input
          type="text"
          id="ud-phone"
          placeholder="e.g. +1 917-555-1234"
          value={state.phone}
          onChange={(e) => onChange('phone', e.target.value)}
          className={styles.input}
        />
      </div>
    </div>
  );
}
