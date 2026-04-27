'use client';

// GeneralTab — first tab of /update-dj-profile.
// Faithful port of update-dj-profile.html lines 47-304.
//
// Deferred to later sessions:
//   - Avatar upload + crop modal (the avatar circle on top of the tab)
//   - Slug availability check (live debounced check via API + fallback suggestions)
//   - Zip → city/state lookup (Nominatim or zippopotam.us)
//
// Everything else is here: name, slug input (no live check yet), private
// profile toggle, mobile event-types or club-genres (depending on dj_type),
// country, zip, travel distance, dj start year, bio, phone.

import styles from './updateDjProfile.module.css';
import {
  MOBILE_EVENT_TYPES,
  CLUB_GENRES,
  COUNTRIES,
  TRAVEL_DISTANCES,
  DJ_START_YEARS,
} from './constants';
import type { GeneralFormState } from './UpdateDjProfileClient';

interface Props {
  state: GeneralFormState;
  onChange: <K extends keyof GeneralFormState>(field: K, value: GeneralFormState[K]) => void;
  djType: 'club' | 'mobile' | null;
  email: string;
  slug: string | null;
  // Site URL is used for the private-profile share link preview. SSR-safe
  // way is to pass it down rather than reading window.location.origin.
  siteUrl: string;
}

export default function GeneralTab({ state, onChange, djType, email, slug, siteUrl }: Props) {
  const slugDisplay = slug || 'your-url';

  return (
    <div>
      {/* Avatar — placeholder for now (upload+crop deferred) */}
      <div
        className={styles.formGroup}
        style={{ textAlign: 'center', marginBottom: '1.5rem' }}
      >
        <div
          style={{
            width: '120px',
            height: '120px',
            margin: '0 auto',
            borderRadius: '50%',
            background: 'rgba(0,245,196,.06)',
            border: '1px solid rgba(0,245,196,.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--muted)',
            fontFamily: "'Space Mono', monospace",
            fontSize: '.55rem',
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            lineHeight: 1.5,
            padding: '0 .5rem',
          }}
        >
          Avatar upload<br />coming soon
        </div>
      </div>

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
                <label key={t.val} className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
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
                <label key={g.val} className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
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
