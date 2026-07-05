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

  // ── Free access (comp) ───────────────────────────────────────────
  // The date field pre-fills with the user's current comp expiry. Changing
  // it (and the plan) then hitting Save Changes grants/updates the comp;
  // clearing the date and saving removes it. No separate button — it's part
  // of the normal account save.
  const initialGrantTier = user?.comp_tier === 2 ? 2 : 1;
  const initialGrantDate = (() => {
    if (!user?.comp_expires_at) return '';
    const d = new Date(user.comp_expires_at);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();
  const [grantTier, setGrantTier] = useState<number>(initialGrantTier);
  const [grantDate, setGrantDate] = useState<string>(initialGrantDate);

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

      // Free access (comp) — applied as part of the save. A date present
      // grants/updates it; a cleared date removes it (only if there was one).
      const trimmedDate = grantDate.trim();
      const hadComp = !!user.comp_expires_at;
      let compRes: { success: boolean; error?: string } = { success: true };
      if (trimmedDate) {
        compRes = await grantCompAction({ user_id: user.id, tier: grantTier, expires_at: trimmedDate });
      } else if (hadComp) {
        compRes = await clearCompAction({ user_id: user.id });
      }
      if (!compRes.success) {
        setFeedback({ msg: '✗ Profile saved, but access update failed: ' + (compRes.error || ''), type: 'err' });
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

        {/* Free access (comp) — part of the normal save */}
        <div className={styles.formDivider} />
        <div className={styles.formSectionLabel}>Free Access</div>
        <p className={styles.formHint} style={{ marginTop: '-.25rem', marginBottom: '.6rem' }}>
          Paid plan: {planLabel(user.sub_tier)} · {statusLabel(user.sub_status)}
          {user.sub_period_end ? ` (ends ${new Date(user.sub_period_end).toLocaleDateString()})` : ''}
        </p>
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Plan</label>
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
            <label className={styles.formLabel}>Free access until</label>
            <input
              className={styles.formInput}
              type="date"
              value={grantDate}
              onChange={(e) => setGrantDate(e.target.value)}
            />
            <p className={styles.formHint}>
              Set a date to give free access through it. Clear the date to remove access. Applied on Save.
            </p>
          </div>
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
