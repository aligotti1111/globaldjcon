'use client';

// EditUserModal — admin edits any user's full profile.
// Faithful port of vanilla adm-edit.js openEditModal + saveEdit.

import { useEffect, useState } from 'react';
import styles from './admin.module.css';
import { updateUserAction, getUserEmailAction, grantCompAction, clearCompAction } from './actions';
import type { AdminUserRow } from './page';

interface Props {
  user: AdminUserRow | null;
  email: string;
  onClose: () => void;
  onSaved: (user: AdminUserRow, newEmail: string | null) => void;
}

export default function EditUserModal({ user, email: initialEmail, onClose, onSaved }: Props) {
  // Form state — initialized from user prop, updated by inputs
  const [emailInput, setEmailInput] = useState(initialEmail);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailHint, setEmailHint] = useState({
    msg: 'New email is auto-confirmed; no verification email sent to user.',
    isError: false,
  });

  // Identity
  const [name, setName] = useState(user?.name || '');
  const [venueName, setVenueName] = useState(user?.venue_name || '');
  const [slug, setSlug] = useState(user?.slug || '');
  const [role, setRole] = useState(user?.role || 'dj');
  const [djType, setDjType] = useState(user?.dj_type || '');

  // Location
  const [country, setCountry] = useState(user?.country || '');
  const [state, setState] = useState(user?.state || '');
  const [city, setCity] = useState(user?.city || '');
  const [zip, setZip] = useState(user?.zip || '');
  const [address, setAddress] = useState(user?.address || '');
  const [travelDistance, setTravelDistance] = useState(user?.travel_distance || '');

  // Bio + contact
  const [bio, setBio] = useState(user?.bio || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [website, setWebsite] = useState(user?.website || '');
  const [instagram, setInstagram] = useState(user?.instagram || '');
  const [soundcloud, setSoundcloud] = useState(user?.soundcloud || '');
  const [tiktok, setTiktok] = useState(user?.tiktok || '');
  const [facebook, setFacebook] = useState(user?.facebook || '');
  const [twitch, setTwitch] = useState(user?.twitch || '');

  // Flags
  const [claimed, setClaimed] = useState(user?.claimed !== false);
  const [profilePrivate, setProfilePrivate] = useState(user?.profile_private === true);
  const [emailVerified, setEmailVerified] = useState(user?.email_verified === true);

  // Submit state
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; type: 'ok' | 'err' | '' }>({ msg: '', type: '' });

  // ── Subscription / comp (free access) ────────────────────────────
  // Current comp state shown live (updated after a grant/clear so the admin
  // sees the result without reopening the modal).
  const [compTierNow, setCompTierNow] = useState<number | null>(user?.comp_tier ?? null);
  const [compExpiresNow, setCompExpiresNow] = useState<string | null>(user?.comp_expires_at ?? null);
  const [compSourceNow, setCompSourceNow] = useState<string | null>(user?.comp_source ?? null);
  // Grant form inputs
  const [grantTier, setGrantTier] = useState<number>(1);
  const [grantDays, setGrantDays] = useState<string>('30');
  const [compBusy, setCompBusy] = useState(false);
  const [compFeedback, setCompFeedback] = useState<{ msg: string; type: 'ok' | 'err' | '' }>({ msg: '', type: '' });

  // Live slug preview
  const slugPreview = (slug || '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'slug';

  // Look up the email if it's missing or stale (no email passed in initialEmail)
  useEffect(() => {
    if (!user || initialEmail) return;
    setEmailLoading(true);
    getUserEmailAction(user.id).then((r) => {
      if (r.email) {
        setEmailInput(r.email);
      }
      if (r.error) {
        setEmailHint({ msg: 'Lookup error: ' + r.error, isError: true });
      }
    }).finally(() => setEmailLoading(false));
  }, [user, initialEmail]);

  if (!user) return null;

  // ── Save ─────────────────────────────────────────────────────────
  async function handleSave() {
    if (!user) return;
    setFeedback({ msg: '', type: '' });
    setSaving(true);

    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');

    // Build the updates object. Only include email if it changed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {
      name: name.trim() || null,
      venue_name: venueName.trim() || null,
      slug: cleanSlug || null,
      role,
      dj_type: djType || null,
      country: country.trim() || null,
      state: state.trim() || null,
      city: city.trim() || null,
      zip: zip.trim() || null,
      address: address.trim() || null,
      bio: bio.trim() || null,
      phone: phone.trim() || null,
      website: website.trim() || null,
      instagram: instagram.trim() || null,
      soundcloud: soundcloud.trim() || null,
      tiktok: tiktok.trim() || null,
      facebook: facebook.trim() || null,
      twitch: twitch.trim() || null,
      claimed,
      profile_private: profilePrivate,
      email_verified: emailVerified,
    };
    if (travelDistance !== '') {
      updates.travel_distance = travelDistance === 'worldwide' ? 'worldwide' : (parseInt(travelDistance, 10) || null);
    }

    // Only send email if it changed
    const newEmail = emailInput.trim().toLowerCase();
    const origEmail = (initialEmail || '').trim().toLowerCase();
    if (newEmail && newEmail !== origEmail) {
      updates.email = newEmail;
    }

    try {
      const result = await updateUserAction({ user_id: user.id, updates });
      if (!result.success) {
        setFeedback({ msg: '✗ ' + (result.error || 'Save failed'), type: 'err' });
        return;
      }
      setFeedback({ msg: '✓ Saved', type: 'ok' });
      // Brief delay so the user sees the success state before modal closes
      setTimeout(() => {
        onSaved(
          (result.user || user) as AdminUserRow,
          result.email_updated ? (result.email || null) : null
        );
      }, 700);
    } catch (e) {
      setFeedback({ msg: '✗ ' + (e as Error).message, type: 'err' });
    } finally {
      setSaving(false);
    }
  }

  function compExpiryLabel(): string {
    if (!compExpiresNow) return '';
    const d = new Date(compExpiresNow);
    if (isNaN(d.getTime())) return '';
    const active = d.getTime() > Date.now();
    return `${d.toLocaleDateString()}${active ? '' : ' (expired)'}`;
  }

  async function handleGrant() {
    if (!user) return;
    setCompFeedback({ msg: '', type: '' });
    const days = parseInt(grantDays, 10);
    if (!days || days < 1) {
      setCompFeedback({ msg: 'Enter a number of days (1 or more).', type: 'err' });
      return;
    }
    setCompBusy(true);
    try {
      const res = await grantCompAction({ user_id: user.id, tier: grantTier, days });
      if (!res.success) {
        setCompFeedback({ msg: '✗ ' + (res.error || 'Grant failed'), type: 'err' });
        return;
      }
      setCompTierNow(grantTier);
      setCompExpiresNow(res.expires_at || null);
      setCompSourceNow('admin');
      setCompFeedback({ msg: '✓ Free access granted', type: 'ok' });
    } catch (e) {
      setCompFeedback({ msg: '✗ ' + (e as Error).message, type: 'err' });
    } finally {
      setCompBusy(false);
    }
  }

  async function handleClearComp() {
    if (!user) return;
    setCompFeedback({ msg: '', type: '' });
    setCompBusy(true);
    try {
      const res = await clearCompAction({ user_id: user.id });
      if (!res.success) {
        setCompFeedback({ msg: '✗ ' + (res.error || 'Failed'), type: 'err' });
        return;
      }
      setCompTierNow(null);
      setCompExpiresNow(null);
      setCompSourceNow(null);
      setCompFeedback({ msg: '✓ Free access removed', type: 'ok' });
    } catch (e) {
      setCompFeedback({ msg: '✗ ' + (e as Error).message, type: 'err' });
    } finally {
      setCompBusy(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        className={styles.editModalBox}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle} style={{ color: 'var(--admin)' }}>Edit Account</div>
          <button onClick={onClose} className={styles.modalCloseBtn}>×</button>
        </div>
        <div className={styles.modalSub}>
          {(user.name || user.venue_name || 'Account')} • {(user.role || '').toUpperCase()}
        </div>

        {/* Identity */}
        <div className={styles.formSectionLabel}>Identity</div>
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Name</label>
            <input
              className={styles.formInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {role === 'venue' && (
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Venue Name</label>
              <input
                className={styles.formInput}
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
              />
            </div>
          )}
          <div className={styles.formGroup} style={{ gridColumn: '1/-1' }}>
            <label className={styles.formLabel}>
              Email <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
                (login email — changing this changes how the user signs in)
              </span>
            </label>
            <input
              className={styles.formInput}
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder={emailLoading ? 'Loading...' : 'No email on file'}
              disabled={emailLoading}
            />
            <p
              className={styles.formHint}
              style={{ color: emailHint.isError ? 'var(--error)' : 'var(--muted)' }}
            >
              {emailHint.msg}
            </p>
          </div>
          <div className={styles.formGroup} style={{ gridColumn: '1/-1' }}>
            <label className={styles.formLabel} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={emailVerified}
                onChange={(e) => setEmailVerified(e.target.checked)}
                style={{ width: 'auto', margin: 0, cursor: 'pointer' }}
              />
              <span>Email Verified <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(override — admin-confirmed)</span></span>
            </label>
            <p className={styles.formHint} style={{ color: 'var(--muted)' }}>
              Check to mark this account as verified without requiring the user to click an email link. Uncheck to revoke verification.
            </p>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Slug</label>
            <input
              className={styles.formInput}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
            <p className={styles.formHint}>
              globaldjconnect.com/<span>{slugPreview}</span>
            </p>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Role</label>
            <select
              className={styles.formSelect}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="dj">DJ</option>
              <option value="host">Host</option>
              <option value="venue">Venue</option>
            </select>
          </div>
          {role === 'dj' && (
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>DJ Type</label>
              <select
                className={styles.formSelect}
                value={djType}
                onChange={(e) => setDjType(e.target.value)}
              >
                <option value="">— Not set —</option>
                <option value="mobile">Mobile / Event</option>
                <option value="club">Club / Bar</option>
              </select>
            </div>
          )}
        </div>

        {/* Location */}
        <div className={styles.formDivider} />
        <div className={styles.formSectionLabel}>Location</div>
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Country</label>
            <input className={styles.formInput} value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>State / Province</label>
            <input className={styles.formInput} value={state} onChange={(e) => setState(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>City</label>
            <input className={styles.formInput} value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Zip</label>
            <input className={styles.formInput} value={zip} onChange={(e) => setZip(e.target.value)} />
          </div>
          {role === 'venue' && (
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Street Address</label>
              <input className={styles.formInput} value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          )}
          {role === 'dj' && (
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Travel Distance (mi)</label>
              <input
                className={styles.formInput}
                type="number"
                value={travelDistance}
                onChange={(e) => setTravelDistance(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Bio */}
        <div className={styles.formDivider} />
        <div className={styles.formSectionLabel}>Bio</div>
        <textarea
          className={styles.formTextarea}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          style={{ minHeight: '90px' }}
        />

        {/* Contact */}
        <div className={styles.formDivider} />
        <div className={styles.formSectionLabel}>Contact</div>
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Phone</label>
            <input className={styles.formInput} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Website</label>
            <input className={styles.formInput} value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Instagram</label>
            <input className={styles.formInput} value={instagram} onChange={(e) => setInstagram(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>SoundCloud</label>
            <input className={styles.formInput} value={soundcloud} onChange={(e) => setSoundcloud(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>TikTok</label>
            <input className={styles.formInput} value={tiktok} onChange={(e) => setTiktok(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Facebook</label>
            <input className={styles.formInput} value={facebook} onChange={(e) => setFacebook(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Twitch</label>
            <input className={styles.formInput} value={twitch} onChange={(e) => setTwitch(e.target.value)} />
          </div>
        </div>

        {/* Flags */}
        <div className={styles.formDivider} />
        <div className={styles.formSectionLabel}>Flags</div>
        <div className={styles.flagsRow}>
          <label className={styles.flagLabel}>
            <input
              type="checkbox"
              checked={claimed}
              onChange={(e) => setClaimed(e.target.checked)}
              style={{ accentColor: 'var(--admin)' }}
            />
            <span>Claimed</span>
          </label>
          <label className={styles.flagLabel}>
            <input
              type="checkbox"
              checked={profilePrivate}
              onChange={(e) => setProfilePrivate(e.target.checked)}
              style={{ accentColor: 'var(--admin)' }}
            />
            <span>Profile Private (hidden from directory)</span>
          </label>
        </div>

        {/* Subscription + free access */}
        <div className={styles.formDivider} />
        <div className={styles.formSectionLabel}>Subscription</div>
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Paid plan (Stripe)</label>
            <p className={styles.formHint} style={{ marginTop: '.25rem' }}>
              {planLabel(user.sub_tier)} · {statusLabel(user.sub_status)}
              {user.sub_period_end
                ? ` · ends ${new Date(user.sub_period_end).toLocaleDateString()}`
                : ''}
            </p>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Free access (comp)</label>
            <p className={styles.formHint} style={{ marginTop: '.25rem' }}>
              {compTierNow
                ? `${planLabel(compTierNow)}${compSourceNow ? ` (${compSourceNow})` : ''}${
                    compExpiryLabel() ? ` · until ${compExpiryLabel()}` : ''
                  }`
                : 'None'}
            </p>
          </div>
        </div>

        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Grant free access — plan</label>
            <select
              className={styles.formSelect}
              value={grantTier}
              onChange={(e) => setGrantTier(parseInt(e.target.value, 10))}
            >
              <option value={1}>Booking</option>
              <option value={2}>Pro</option>
            </select>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Days</label>
            <input
              className={styles.formInput}
              type="number"
              min={1}
              value={grantDays}
              onChange={(e) => setGrantDays(e.target.value)}
            />
            <p className={styles.formHint}>Runs from now. Granting again replaces any current grant.</p>
          </div>
        </div>
        <div className={styles.flagsRow} style={{ gap: '.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleGrant}
            disabled={compBusy}
            className={`${styles.btn} ${styles.btnAdmin}`}
          >
            {compBusy ? 'Working…' : 'Grant free access'}
          </button>
          {compTierNow && (
            <button
              type="button"
              onClick={handleClearComp}
              disabled={compBusy}
              className={`${styles.btn} ${styles.btnOutline}`}
            >
              Remove free access
            </button>
          )}
          {compFeedback.msg && (
            <span
              className={`${styles.formFb} ${
                compFeedback.type === 'ok' ? styles.formFbOk : styles.formFbErr
              }`}
            >
              {compFeedback.msg}
            </span>
          )}
        </div>

        {/* Save bar */}
        <div className={styles.editSaveBar}>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`${styles.btn} ${styles.btnAdmin}`}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`${styles.btn} ${styles.btnOutline}`}
          >
            Cancel
          </button>
          {feedback.msg && (
            <span className={`${styles.formFb} ${feedback.type === 'ok' ? styles.formFbOk : styles.formFbErr}`}>
              {feedback.msg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Display helpers ─────────────────────────────────────────────────
function planLabel(tier: number | null | undefined): string {
  if (tier === 2) return 'Pro';
  if (tier === 1) return 'Booking';
  return 'None';
}

function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'active': return 'Active';
    case 'grace': return 'Grace (payment retrying)';
    case 'lapsed': return 'Lapsed';
    default: return 'None';
  }
}
