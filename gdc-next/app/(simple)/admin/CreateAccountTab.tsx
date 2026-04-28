'use client';

// CreateAccountTab — admin form to create a new DJ/Host/Venue account.
// Creates a placeholder-email auth user + populated public.users row.
// The real person eventually claims the profile, swapping the email.
// Faithful port of vanilla adm-create.js + adm-tabs.js setRole/setType.

import { useState } from 'react';
import styles from './admin.module.css';
import { createUserAction } from './actions';
import type { CredsModalData } from './AdminClient';

type Role = 'dj' | 'host' | 'venue';
type DjType = 'mobile' | 'club' | '';

interface Props {
  onCreated: (creds: CredsModalData) => void;
  onUserAdded: () => void;
}

const COUNTRIES: { value: string; code: string }[] = [
  { value: 'United States', code: 'us' },
  { value: 'United Kingdom', code: 'gb' },
  { value: 'Canada', code: 'ca' },
  { value: 'Australia', code: 'au' },
  { value: 'Germany', code: 'de' },
  { value: 'France', code: 'fr' },
  { value: 'Netherlands', code: 'nl' },
  { value: 'Spain', code: 'es' },
  { value: 'Italy', code: 'it' },
  { value: 'Brazil', code: 'br' },
  { value: 'Mexico', code: 'mx' },
  { value: 'Japan', code: 'jp' },
  { value: 'South Africa', code: 'za' },
  { value: 'New Zealand', code: 'nz' },
  { value: 'Ireland', code: 'ie' },
  { value: 'Sweden', code: 'se' },
  { value: 'Norway', code: 'no' },
  { value: 'Denmark', code: 'dk' },
  { value: 'Belgium', code: 'be' },
  { value: 'Switzerland', code: 'ch' },
  { value: 'Portugal', code: 'pt' },
  { value: 'Other', code: '' },
];

export default function CreateAccountTab({ onCreated, onUserAdded }: Props) {
  const [role, setRole] = useState<Role>('dj');
  const [djType, setDjType] = useState<DjType>('');

  // Form fields
  const [name, setName] = useState('');
  const [venueName, setVenueName] = useState('');
  const [slug, setSlug] = useState('');
  const [country, setCountry] = useState('');
  const [zip, setZip] = useState('');
  const [zipResult, setZipResult] = useState<{ msg: string; type: 'looking' | 'found' | 'notfound' | '' }>({ msg: '', type: '' });
  const [city, setCity] = useState('');
  const [stateInput, setStateInput] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [instagram, setInstagram] = useState('');
  const [soundcloud, setSoundcloud] = useState('');

  // Submit feedback
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; type: 'ok' | 'err' | '' }>({ msg: '', type: '' });

  // Live slug preview
  const slugPreview = slug
    ? slug.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'your-slug'
    : 'your-slug';

  // ── Zip lookup (Nominatim) — debounced, country-aware ────────────
  let zipTimeout: ReturnType<typeof setTimeout> | null = null;
  function onZipChange(val: string) {
    setZip(val);
    if (zipTimeout) clearTimeout(zipTimeout);
    if (!val || val.length < 4) {
      setZipResult({ msg: '', type: '' });
      return;
    }
    setZipResult({ msg: 'Looking up...', type: 'looking' });
    zipTimeout = setTimeout(async () => {
      try {
        const cc = COUNTRIES.find((c) => c.value === country)?.code || '';
        const url = cc
          ? `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(val)}&countrycodes=${cc}&format=json&limit=1&addressdetails=1`
          : `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(val)}&format=json&limit=1&addressdetails=1`;
        const res = await fetch(url);
        const data = await res.json();
        if (data && data[0]) {
          const addr = data[0].address || {};
          const c = addr.suburb || addr.city || addr.town || addr.village || addr.county || '';
          const s = addr.state || '';
          setCity(c);
          setStateInput(s);
          setZipResult({ msg: [c, s].filter(Boolean).join(', '), type: 'found' });
        } else {
          setZipResult({ msg: 'Zip not found', type: 'notfound' });
        }
      } catch {
        setZipResult({ msg: '', type: '' });
      }
    }, 600);
  }

  function resetForm() {
    setName('');
    setVenueName('');
    setSlug('');
    setCountry('');
    setZip('');
    setCity('');
    setStateInput('');
    setAddress('');
    setPhone('');
    setWebsite('');
    setInstagram('');
    setSoundcloud('');
    setDjType('');
    setZipResult({ msg: '', type: '' });
    setFeedback({ msg: '', type: '' });
  }

  async function handleSubmit() {
    setFeedback({ msg: '', type: '' });

    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');

    if (!name.trim()) {
      setFeedback({ msg: '⚠ Name is required', type: 'err' });
      return;
    }
    if (!country) {
      setFeedback({ msg: '⚠ Country is required', type: 'err' });
      return;
    }
    if ((role === 'dj' || role === 'venue') && !cleanSlug) {
      setFeedback({ msg: '⚠ Slug is required', type: 'err' });
      return;
    }
    if (role === 'venue' && !venueName.trim()) {
      setFeedback({ msg: '⚠ Venue name is required', type: 'err' });
      return;
    }

    setSubmitting(true);
    try {
      const result = await createUserAction({
        role,
        name: name.trim(),
        slug: cleanSlug || undefined,
        dj_type: role === 'dj' ? (djType || undefined) : undefined,
        country,
        city: city.trim() || undefined,
        state: stateInput.trim() || undefined,
        zip: zip.trim() || undefined,
        phone: phone.trim() || undefined,
        website: website.trim() || undefined,
        instagram: instagram.trim() || undefined,
        soundcloud: soundcloud.trim() || undefined,
        venue_name: venueName.trim() || undefined,
        address: address.trim() || undefined,
      });

      if (!result.success) {
        setFeedback({ msg: '✗ ' + (result.error || 'Failed to create'), type: 'err' });
      } else {
        setFeedback({ msg: '✓ Account created', type: 'ok' });
        const url = cleanSlug ? 'https://globaldjconnect.com/' + cleanSlug : '(no profile URL)';
        onCreated({
          user_id: result.user_id || '',
          name: name.trim(),
          role,
          slug: cleanSlug || null,
          url,
        });
        resetForm();
        // Tell the parent that a user was added so it can refresh data
        onUserAdded();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setFeedback({ msg: '✗ ' + msg, type: 'err' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.formCard}>
      <div className={styles.formSectionLabel}>Account Role</div>
      <div className={styles.roleToggle}>
        {(['dj', 'host', 'venue'] as Role[]).map((r) => (
          <div
            key={r}
            className={`${styles.roleOpt} ${role === r ? styles.roleOptSelected : ''}`}
            onClick={() => setRole(r)}
          >
            {r === 'dj' ? 'DJ' : r === 'host' ? 'Party Host' : 'Venue'}
          </div>
        ))}
      </div>

      <p className={styles.formHint} style={{ marginBottom: '1.5rem' }}>
        This will create a new account with a placeholder email. Once the
        person claims their profile with their real email, you can approve
        the claim from the Pending Claims tab and they&apos;ll receive a
        &quot;Set Password&quot; link.
      </p>

      <div className={styles.formDivider} />
      <div className={styles.formSectionLabel}>
        {role === 'dj' ? 'DJ Identity' : role === 'host' ? 'Host Info' : 'Venue Info'}
      </div>
      <div className={styles.formGrid}>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Name <span className={styles.required}>*</span></label>
          <input
            className={styles.formInput}
            placeholder="DJ Nova"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {role === 'venue' && (
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Venue Name <span className={styles.required}>*</span></label>
            <input
              className={styles.formInput}
              placeholder="The Grand Ballroom"
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
            />
          </div>
        )}
        {role !== 'host' && (
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Profile URL Slug <span className={styles.required}>*</span></label>
            <input
              className={styles.formInput}
              placeholder="dj-nova"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
            <p className={styles.formHint}>
              Will be globaldjconnect.com/<span style={{ color: 'var(--admin)' }}>{slugPreview}</span>
            </p>
          </div>
        )}
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Country <span className={styles.required}>*</span></label>
          <select
            className={styles.formSelect}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            <option value="">Select country...</option>
            {COUNTRIES.map((c) => (
              <option key={c.value} value={c.value}>{c.value}</option>
            ))}
          </select>
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Zip / Postal Code</label>
          <input
            className={styles.formInput}
            placeholder="60601"
            value={zip}
            onChange={(e) => onZipChange(e.target.value)}
          />
          <div
            className={styles.formHint}
            style={{
              minHeight: '1rem',
              color: zipResult.type === 'found' ? 'var(--success)'
                : zipResult.type === 'looking' ? 'var(--amber)'
                : zipResult.type === 'notfound' ? 'var(--muted)'
                : '',
            }}
          >
            {zipResult.msg}
          </div>
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>State / Province <span className={styles.opt}>optional</span></label>
          <input
            className={styles.formInput}
            placeholder="Auto-filled by zip"
            value={stateInput}
            onChange={(e) => setStateInput(e.target.value)}
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>City <span className={styles.opt}>optional</span></label>
          <input
            className={styles.formInput}
            placeholder="Auto-filled by zip"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        </div>
        {role === 'venue' && (
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Street Address</label>
            <input
              className={styles.formInput}
              placeholder="123 Main St"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
        )}
      </div>

      {role === 'dj' && (
        <div className={styles.formGroup} style={{ marginBottom: '1rem' }}>
          <label className={styles.formLabel}>DJ Type <span className={styles.opt}>optional</span></label>
          <div className={styles.typeToggle}>
            <button
              type="button"
              onClick={() => setDjType(djType === 'mobile' ? '' : 'mobile')}
              className={`${styles.typeOpt} ${djType === 'mobile' ? styles.typeOptMobile : ''}`}
            >
              🎵 Mobile/Event
            </button>
            <button
              type="button"
              onClick={() => setDjType(djType === 'club' ? '' : 'club')}
              className={`${styles.typeOpt} ${djType === 'club' ? styles.typeOptClub : ''}`}
            >
              🎧 Club/Bar
            </button>
          </div>
        </div>
      )}

      <div className={styles.formDivider} />
      <div className={styles.formSectionLabel}>
        Contact <span style={{ color: 'var(--muted)', fontSize: '.7rem', textTransform: 'none', letterSpacing: 0 }}>
          (optional — can be filled in later)
        </span>
      </div>
      <div className={styles.formGrid}>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Phone</label>
          <input
            className={styles.formInput}
            placeholder="(312) 555-1234"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Website</label>
          <input
            className={styles.formInput}
            placeholder="djnova.com"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Instagram</label>
          <input
            className={styles.formInput}
            placeholder="@djnova"
            value={instagram}
            onChange={(e) => setInstagram(e.target.value)}
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>SoundCloud</label>
          <input
            className={styles.formInput}
            placeholder="djnova"
            value={soundcloud}
            onChange={(e) => setSoundcloud(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.formActions}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className={`${styles.btn} ${styles.btnAdmin}`}
        >
          {submitting ? 'Creating…' : '+ Create Account'}
        </button>
        <button
          type="button"
          onClick={resetForm}
          className={`${styles.btn} ${styles.btnOutline}`}
        >
          Clear Form
        </button>
        {feedback.msg && (
          <span className={`${styles.formFb} ${feedback.type === 'ok' ? styles.formFbOk : styles.formFbErr}`}>
            {feedback.msg}
          </span>
        )}
      </div>
    </div>
  );
}
