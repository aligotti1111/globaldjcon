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

import { useState } from 'react';
import type { CSSProperties } from 'react';
import styles from './updateDjProfile.module.css';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/ConfirmModal';
import {
  MOBILE_EVENT_TYPES,
  MOB_CAT_GENERAL_TYPES,
  MOB_CAT_WEDDING_TYPES,
  MOB_CAT_MITZVAH_TYPES,
  CLUB_GENRES,
  TRAVEL_DISTANCES,
} from './constants';
import type { GeneralFormState } from './UpdateDjProfileClient';
import { makeCustomEventKey } from '@/lib/constants';
import BusinessLogoSection from './BusinessLogoSection';
import BlockedUsersSection from './BlockedUsersSection';
import { SlugInput } from '@/app/(simple)/signup/SlugInput';
import { generateDjAlternatives } from '@/app/(simple)/signup/helpers';
import ProfileQrCode from './ProfileQrCode';
import AddressField from './AddressField';
import { NameChangeBlock, EmailChangeBlock, SlugChangeGate, PasswordChangeBlock } from './AccountChangeBlocks';

// The account-settings page is laid out like Booking Settings: a top tab bar
// swaps between sections. GeneralTab renders the first four; Team + Your
// Timezone are their own tabs owned by the parent (UpdateDjProfileClient).
export type AccountTab = 'account' | 'eventTypes' | 'location' | 'blocked' | 'team' | 'timezone';

interface Props {
  state: GeneralFormState;
  onChange: <K extends keyof GeneralFormState>(field: K, value: GeneralFormState[K]) => void;
  // Which tab is active. GeneralTab keeps all four of its sections mounted and
  // shows only the active one (display toggle), so in-progress edits and the
  // per-section dirty state survive tab switches.
  activeTab: AccountTab;
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
  // Called after a custom event type is deleted + persisted, so the parent can
  // sync its dirty snapshot and the Save button / leave-warning don't fire for
  // a change that's already saved.
  onEventTypesSaved?: (
    nextCustom: GeneralFormState['customEventTypes'],
    nextMobile: string[],
    nextSpecialty: string[],
  ) => void;
  // Called after the Location & Contact section saves itself, so the parent
  // clears the dirty flag for those fields.
  onContactSaved?: (
    address: string, city: string, stateRegion: string, zip: string,
    country: string, phone: string, travelDistance: string,
  ) => void;
  // Called after the upper-area basics (name + private) save themselves, and
  // after club genres save, so the parent clears the dirty flag for them.
  onBasicsSaved?: (name: string, profilePrivate: boolean) => void;
  onGenresSaved?: (clubGenres: string[]) => void;
  // Paid/comped access. The Profile QR code is a premium feature, so it only
  // renders when this is true. Defaults to false (free account) if not passed.
  isPaid?: boolean;
}

export default function GeneralTab({ state, onChange, activeTab, djType, email, slug, siteUrl, userId, onSlugSaved, onEventTypesSaved, onContactSaved, onBasicsSaved, onGenresSaved, isPaid = false }: Props) {
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
  const [newTypeLabel, setNewTypeLabel] = useState('');
  function addCustomType() {
    const label = newTypeLabel.trim();
    if (!label) return;
    const key = makeCustomEventKey(label);
    const dup = state.customEventTypes.some(
      (c) => c.key === key || c.label.toLowerCase() === label.toLowerCase(),
    );
    if (!dup) {
      onChange('customEventTypes', [...state.customEventTypes, { key, label }]);
      onChange('mobileEvents', [...state.mobileEvents, key]); // auto-select the new type
    }
    setNewTypeLabel('');
  }
  async function removeCustomType(key: string) {
    // A custom event type is one the DJ typed in themselves — deleting it drops
    // it (and any pricing tied to it) for good, so confirm first.
    const label = state.customEventTypes.find((c) => c.key === key)?.label || 'this event type';
    const ok = await confirm({
      title: `Delete ${label}?`,
      message: `${label} will be removed from the event types you offer, along with any pricing you set for it. Any bookings already made for ${label} are not affected — they keep their event type, price, and details exactly as booked. This can't be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    // Compute the new lists once so we can update the UI AND persist the same
    // values immediately.
    const nextCustom = state.customEventTypes.filter((c) => c.key !== key);
    const nextMobile = state.mobileEvents.filter((v) => v !== key);
    const nextSpecialty = state.specialtyTypes.filter((k) => k !== key);
    onChange('customEventTypes', nextCustom);
    onChange('mobileEvents', nextMobile);
    onChange('specialtyTypes', nextSpecialty);

    // Persist RIGHT NOW — no separate "Save changes" needed for a delete. Only
    // the three event-type columns are written, so it doesn't disturb any other
    // unsaved edits on the profile. Existing bookings store their own event_type
    // string, so none of this touches them.
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('users')
          .update({
            mob_custom_event_types: nextCustom.length > 0 ? nextCustom : null,
            event_types: nextMobile.length > 0 ? nextMobile.join(',') : null,
            mob_specialty_types: nextSpecialty,
          } as unknown as never)
          .eq('id', user.id);
        // Tell the parent it's saved so the dirty snapshot updates and the
        // bottom "Save Changes" button / leave-warning don't fire for it. Also
        // reset this section's own baseline so its Save button doesn't light up.
        onEventTypesSaved?.(nextCustom, nextMobile, nextSpecialty);
        setEventTypesBaseline(JSON.stringify({
          mobileEvents: nextMobile, customEventTypes: nextCustom, specialtyTypes: nextSpecialty,
        }));
      }
    } catch {
      // Non-fatal — the change is in the form, so the Save button still persists it.
    }
  }

  // ── Location & Contact — its own Save, independent of the bottom one ──
  // Business address (+ city/state/zip/country), contact phone, and travel
  // distance live in their own section that saves on its own. Snapshot the
  // fields at mount; the Save button lights up only while they differ.
  function contactSnapshot(): string {
    return JSON.stringify({
      address: state.address, city: state.city, stateRegion: state.state,
      zip: state.zip, country: state.country, phone: state.phone,
      travelDistance: state.travelDistance,
    });
  }
  const [contactBaseline, setContactBaseline] = useState<string>(() => contactSnapshot());
  const [contactSaving, setContactSaving] = useState(false);
  const [contactMsg, setContactMsg] = useState<string | null>(null);
  const contactDirty = contactSnapshot() !== contactBaseline;

  async function saveContact() {
    if (contactSaving || !contactDirty) return;
    setContactSaving(true);
    setContactMsg(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('not signed in');
      const update: Record<string, unknown> = {
        address: state.address.trim() || null,
        city: state.city.trim() || null,
        state: state.state.trim() || null,
        zip: state.zip.trim() || null,
        country: state.country || null,
        phone: state.phone.trim() || null,
        travel_distance: state.travelDistance || null,
      };
      // Re-geocode home_lat/home_lon only when the zip changed since last save —
      // the homepage's "DJs near me" sort reads those. Mirrors the bottom Save.
      let baseZip = '';
      try { baseZip = (JSON.parse(contactBaseline) as { zip?: string }).zip || ''; } catch { /* ignore */ }
      if (state.zip.trim() !== baseZip) {
        update.home_lat = null;
        update.home_lon = null;
        if (state.zip.trim()) {
          const COUNTRY_CC: Record<string, string> = {
            'United States': 'us', 'United Kingdom': 'gb', 'Canada': 'ca', 'Australia': 'au',
            'Germany': 'de', 'France': 'fr', 'Netherlands': 'nl', 'Spain': 'es', 'Italy': 'it',
            'Brazil': 'br', 'Mexico': 'mx', 'Japan': 'jp', 'South Africa': 'za', 'New Zealand': 'nz',
            'Ireland': 'ie', 'Sweden': 'se', 'Norway': 'no', 'Denmark': 'dk', 'Belgium': 'be',
            'Switzerland': 'ch', 'Portugal': 'pt',
          };
          const cc = COUNTRY_CC[state.country || ''] || '';
          try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(state.zip.trim())}${cc ? '&countrycodes=' + cc : ''}&format=json&limit=1`);
            const data = await res.json();
            if (data && data[0]) { update.home_lat = parseFloat(data[0].lat); update.home_lon = parseFloat(data[0].lon); }
          } catch { /* non-fatal — leave coords null */ }
        }
      }
      const { error } = await supabase.from('users').update(update as unknown as never).eq('id', user.id);
      if (error) throw error;
      setContactBaseline(contactSnapshot());
      setContactMsg('✓ Saved.');
      setTimeout(() => setContactMsg(null), 2500);
      // Clear these fields' dirty flag on the parent so the bottom Save button
      // and the leave-warning don't fire for something already saved.
      onContactSaved?.(state.address, state.city, state.state, state.zip, state.country, state.phone, state.travelDistance);
    } catch {
      setContactMsg('Could not save — try again.');
    } finally {
      setContactSaving(false);
    }
  }

  // ── Mobile Party Types — its own Save (add / move / toggle) ──────────
  // Selecting types, adding a custom one, or dragging between General and
  // Specialty edits event_types / mob_custom_event_types / mob_specialty_types.
  // This section saves those three columns on its own; the button lights up as
  // soon as any of them differs from what's saved.
  function eventTypesSnapshot(): string {
    return JSON.stringify({
      mobileEvents: state.mobileEvents,
      customEventTypes: state.customEventTypes,
      specialtyTypes: state.specialtyTypes,
    });
  }
  const [eventTypesBaseline, setEventTypesBaseline] = useState<string>(() => eventTypesSnapshot());
  const [eventTypesSaving, setEventTypesSaving] = useState(false);
  const [eventTypesMsg, setEventTypesMsg] = useState<string | null>(null);
  const eventTypesDirty = eventTypesSnapshot() !== eventTypesBaseline;

  async function saveEventTypes() {
    if (eventTypesSaving || !eventTypesDirty) return;
    setEventTypesSaving(true);
    setEventTypesMsg(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('not signed in');
      const { error } = await supabase
        .from('users')
        .update({
          event_types: state.mobileEvents.length > 0 ? state.mobileEvents.join(',') : null,
          mob_custom_event_types: state.customEventTypes.length > 0 ? state.customEventTypes : null,
          mob_specialty_types: state.specialtyTypes,
        } as unknown as never)
        .eq('id', user.id);
      if (error) throw error;
      setEventTypesBaseline(eventTypesSnapshot());
      setEventTypesMsg('✓ Saved.');
      setTimeout(() => setEventTypesMsg(null), 2500);
      onEventTypesSaved?.(state.customEventTypes, state.mobileEvents, state.specialtyTypes);
    } catch {
      setEventTypesMsg('Could not save — try again.');
    } finally {
      setEventTypesSaving(false);
    }
  }

  // ── Private Profile toggle — auto-saves the moment it's flipped. ──
  const [privateSaving, setPrivateSaving] = useState(false);
  async function setPrivate(next: boolean) {
    onChange('profilePrivate', next); // reflect immediately in the UI
    setPrivateSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('users').update({ profile_private: next } as unknown as never).eq('id', user.id);
        // Keep both upper-area fields' dirty snapshot in sync on the parent.
        onBasicsSaved?.(state.name, next);
      }
    } catch {
      /* non-fatal — the toggle still reflects locally */
    } finally {
      setPrivateSaving(false);
    }
  }

  // ── Club Music Genres — its own Save (club DJs only). ──
  const [genresBaseline, setGenresBaseline] = useState<string>(() => JSON.stringify(state.clubGenres));
  const [genresSaving, setGenresSaving] = useState(false);
  const [genresMsg, setGenresMsg] = useState<string | null>(null);
  const genresDirty = JSON.stringify(state.clubGenres) !== genresBaseline;

  async function saveGenres() {
    if (genresSaving || !genresDirty) return;
    setGenresSaving(true);
    setGenresMsg(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('not signed in');
      const { error } = await supabase
        .from('users')
        .update({ club_genres: state.clubGenres.length > 0 ? state.clubGenres : null } as unknown as never)
        .eq('id', user.id);
      if (error) throw error;
      setGenresBaseline(JSON.stringify(state.clubGenres));
      setGenresMsg('✓ Saved.');
      setTimeout(() => setGenresMsg(null), 2500);
      onGenresSaved?.(state.clubGenres);
    } catch {
      setGenresMsg('Could not save — try again.');
    } finally {
      setGenresSaving(false);
    }
  }

  // ── Drag-to-group (General <-> Specialty) ────────────────────────
  const isCustomKey = (k: string) => state.customEventTypes.some((c) => c.key === k);
  const allEventOptions: { val: string; label: string }[] = [
    ...MOBILE_EVENT_TYPES,
    ...state.customEventTypes.map((c) => ({ val: c.key, label: c.label })),
  ];
  const generalGroup = allEventOptions.filter((o) => !state.specialtyTypes.includes(o.val));
  const specialtyGroup = allEventOptions.filter((o) => state.specialtyTypes.includes(o.val));
  function moveToGroup(key: string, group: 'general' | 'specialty') {
    const inSpec = state.specialtyTypes.includes(key);
    if (group === 'specialty' && !inSpec) onChange('specialtyTypes', [...state.specialtyTypes, key]);
    if (group === 'general' && inSpec) onChange('specialtyTypes', state.specialtyTypes.filter((k) => k !== key));
  }
  function toggleSelected(key: string, checked: boolean) {
    onChange('mobileEvents', checked ? [...state.mobileEvents, key] : state.mobileEvents.filter((v) => v !== key));
  }
  const tileBase: CSSProperties = {
    display: 'flex', alignItems: 'center', padding: '.45rem .7rem', background: 'transparent',
    border: '1px solid rgba(30, 30, 48, .5)', borderRadius: 6, cursor: 'grab', fontSize: '.8rem', color: 'var(--white)',
  };
  const renderDraggableTile = (o: { val: string; label: string }) => (
    <label
      key={o.val}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', o.val); e.dataTransfer.effectAllowed = 'move'; }}
      style={tileBase}
    >
      <span aria-hidden="true" title="Drag to move between groups" style={{ color: 'var(--muted)', marginRight: 8, fontSize: '.9rem', lineHeight: 1 }}>&#x2630;</span>
      <input
        type="checkbox"
        style={{ width: 15, height: 15, marginRight: 10, flexShrink: 0, accentColor: 'var(--neon)', cursor: 'pointer' }}
        checked={state.mobileEvents.includes(o.val)}
        onChange={(e) => toggleSelected(o.val, e.target.checked)}
      />
      <span style={{ flex: 1 }}>{o.label}</span>
      {isCustomKey(o.val) && (
        <span
          role="button"
          aria-label={`Remove ${o.label}`}
          title="Remove"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void removeCustomType(o.val); }}
          style={{ color: '#ff8f8f', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 .2rem' }}
        >&times;</span>
      )}
    </label>
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

  return (
    <div>
      {confirmDialog}
      {/* ── ACCOUNT tab ── logo, private toggle, email, password, name + URL + QR */}
      <div style={{ display: activeTab === 'account' ? undefined : 'none' }}>
      {/* Business logo — the shared brand logo (planner, contracts, everywhere). */}
      <BusinessLogoSection />

      {/* Private profile toggle */}
      <div className={styles.privateRow}>
        <input
          type="checkbox"
          id="profile-private"
          checked={state.profilePrivate}
          disabled={privateSaving}
          onChange={(e) => void setPrivate(e.target.checked)}
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
          and lives under the name on signup. The NAME is password-gated (it's
          a public identity that flows onto contracts and every booking), so it
          changes through NameChangeBlock and saves itself. No separate Save. */}
      <div className={styles.formGroup}>
        <NameChangeBlock
          djType={djType}
          currentName={state.name}
          onSaved={(n) => { onChange('name', n); onBasicsSaved?.(n, state.profilePrivate); }}
        />
        {/* Nested URL field — keeps the slug input visually grouped under
            the name field. */}
        <div style={{ marginTop: '.85rem' }}>
          <SlugChangeGate
            email={email}
            userId={userId}
            currentUrl={`${siteUrl}/${state.slug || 'your-url'}`}
            currentSlug={state.slug}
            onSaved={onSlugSaved}
            renderInput={({ value, onChange: setDraft, onStatusChange, footer }) => (
              <SlugInput
                value={value}
                onChange={setDraft}
                onStatusChange={onStatusChange}
                generateAlternatives={generateDjAlternatives}
                placeholder="e.g. dj-nova"
                excludeUserId={userId}
                originalSlug={slug || ''}
                footer={footer}
              />
            )}
          />

          {/* Premium: downloadable QR code for the public profile, sitting
              right under the URL it points at. Encodes the permanent profile
              ID (never breaks on a slug change); shows the live slug as caption.
              Free accounts still SEE it, but locked (blurred + upgrade CTA). */}
          <ProfileQrCode slug={state.slug} djName={state.name} profileId={userId} locked={!isPaid} />
        </div>
      </div>
      </div>{/* end ACCOUNT tab */}

      {/* ── EVENT TYPES tab ── mobile party types (mobile) or genres (club) */}
      <div style={{ display: activeTab === 'eventTypes' ? undefined : 'none' }}>
      {/* Mobile event types — only for mobile DJs */}
      {djType === 'mobile' && (
        <div className={styles.formGroup}>
          <label>Mobile Party Types (select all that apply)</label>
          <p style={{ margin: '.15rem 0 .5rem', color: 'var(--muted)', fontSize: '.68rem', lineHeight: 1.5 }}>
            Drag an event between General and Specialty. Specialty events get their own price in your package builder.
          </p>
          <div className={styles.specBox}>
            <div className={styles.partyGroupLabel}>General Events</div>
            <div
              className={styles.checkboxGrid}
              style={{ minHeight: 44 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const k = e.dataTransfer.getData('text/plain'); if (k) moveToGroup(k, 'general'); }}
            >
              {generalGroup.map(renderDraggableTile)}
              {/* Inline "add your event" box */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '.45rem .7rem', background: 'rgba(0,240,255,.04)', border: '1px dashed var(--neon)', borderRadius: 6, fontSize: '.8rem' }}>
                <span aria-hidden="true" style={{ color: 'var(--neon)', marginRight: 10, fontSize: '1rem', lineHeight: 1 }}>+</span>
                <input
                  value={newTypeLabel}
                  onChange={(e) => setNewTypeLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomType(); } }}
                  onBlur={() => { if (newTypeLabel.trim()) addCustomType(); }}
                  placeholder="Add event type"
                  aria-label="Add event type"
                  style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: '.8rem', outline: 'none' }}
                />
              </div>
            </div>
            <div className={`${styles.partyGroupLabel} ${styles.partyGroupLabelLater}`}>
              Specialty Events / Custom Pricing
            </div>
            <div
              className={styles.checkboxGrid}
              style={{ minHeight: 44 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const k = e.dataTransfer.getData('text/plain'); if (k) moveToGroup(k, 'specialty'); }}
            >
              {specialtyGroup.length > 0
                ? specialtyGroup.map(renderDraggableTile)
                : <span style={{ color: 'var(--muted)', fontSize: '.72rem', padding: '.4rem .2rem' }}>Drag events here to price them on their own.</span>}
            </div>
            {/* Its own Save, INSIDE the box — lights up when you add, move, or
                toggle a type. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '.8rem', marginTop: '.75rem' }}>
              {eventTypesMsg && <span style={{ fontSize: '.8rem', color: '#8a8aa0' }}>{eventTypesMsg}</span>}
              <button
                type="button"
                disabled={!eventTypesDirty || eventTypesSaving}
                onClick={() => void saveEventTypes()}
                style={{
                  fontFamily: "'Space Mono', monospace", fontSize: '.62rem', letterSpacing: '.07em',
                  textTransform: 'uppercase', padding: '.6rem 1.2rem', borderRadius: 6, fontWeight: 700, whiteSpace: 'nowrap',
                  // Grey + not-allowed until a change is made; neon + clickable once dirty.
                  border: eventTypesDirty && !eventTypesSaving ? 'none' : '1px solid var(--border)',
                  background: eventTypesDirty && !eventTypesSaving ? 'var(--neon)' : 'rgba(255,255,255,.06)',
                  color: eventTypesDirty && !eventTypesSaving ? 'var(--black)' : 'var(--muted)',
                  cursor: eventTypesDirty && !eventTypesSaving ? 'pointer' : 'not-allowed',
                }}
              >
                {eventTypesSaving ? 'Saving…' : 'Save'}
              </button>
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '.8rem', marginTop: '.75rem' }}>
              {genresMsg && <span style={{ fontSize: '.8rem', color: '#8a8aa0' }}>{genresMsg}</span>}
              <button
                type="button"
                disabled={!genresDirty || genresSaving}
                onClick={() => void saveGenres()}
                style={{
                  fontFamily: "'Space Mono', monospace", fontSize: '.62rem', letterSpacing: '.07em',
                  textTransform: 'uppercase', padding: '.6rem 1.2rem', borderRadius: 6, fontWeight: 700, whiteSpace: 'nowrap',
                  border: genresDirty && !genresSaving ? 'none' : '1px solid var(--border)',
                  background: genresDirty && !genresSaving ? 'var(--neon)' : 'rgba(255,255,255,.06)',
                  color: genresDirty && !genresSaving ? 'var(--black)' : 'var(--muted)',
                  cursor: genresDirty && !genresSaving ? 'pointer' : 'not-allowed',
                }}
              >
                {genresSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>{/* end EVENT TYPES tab */}

      {/* ── LOCATION & CONTACT tab ── */}
      <div style={{ display: activeTab === 'location' ? undefined : 'none' }}>
      {/* Location & Contact — its own section with its own Save. Business
          address, contact phone, and travel distance save independently of the
          bottom "Save Changes" button. */}
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Location &amp; Contact</div>
        </div>
        <div className={styles.sectionBody}>
          {/* Business Address — one-line autocomplete with the country chip to
              its right. Picking a suggestion fills city/state/zip. Public: goes
              on the standard contract and the planner header, and pre-fills a
              mailing address for check payments. */}
          <AddressField
            address={state.address}
            country={state.country}
            onChange={(patch) => {
              if (patch.address !== undefined) onChange('address', patch.address);
              if (patch.city !== undefined) onChange('city', patch.city);
              if (patch.state !== undefined) onChange('state', patch.state);
              if (patch.zip !== undefined) onChange('zip', patch.zip);
              if (patch.country !== undefined) onChange('country', patch.country);
            }}
          />

          {/* Contact Phone — public/business number, kept distinct from the
              sign-in number and the text-notification number. */}
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

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '.8rem', marginTop: '.4rem' }}>
            {contactMsg && <span style={{ fontSize: '.8rem', color: '#8a8aa0' }}>{contactMsg}</span>}
            <button
              type="button"
              disabled={!contactDirty || contactSaving}
              onClick={() => void saveContact()}
              style={{
                fontFamily: "'Space Mono', monospace", fontSize: '.62rem', letterSpacing: '.07em',
                textTransform: 'uppercase', padding: '.6rem 1.2rem', borderRadius: 6, fontWeight: 700, whiteSpace: 'nowrap',
                border: contactDirty && !contactSaving ? 'none' : '1px solid var(--border)',
                background: contactDirty && !contactSaving ? 'var(--neon)' : 'rgba(255,255,255,.06)',
                color: contactDirty && !contactSaving ? 'var(--black)' : 'var(--muted)',
                cursor: contactDirty && !contactSaving ? 'pointer' : 'not-allowed',
              }}
            >
              {contactSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
      </div>{/* end LOCATION & CONTACT tab */}

      {/* DJ start year field removed — years-of-experience is no longer
          shown on profiles, so the input is no longer needed. */}

      {/* ── BLOCKED tab ── */}
      <div style={{ display: activeTab === 'blocked' ? undefined : 'none' }}>
      {/* Blocked Users — its own section. Self-saving (unblock writes straight
          to the DB), so no Save button needed here. */}
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Blocked Users</div>
        </div>
        <div className={styles.sectionBody}>
          <BlockedUsersSection hideLabel />
        </div>
      </div>
      </div>{/* end BLOCKED tab */}

    </div>
  );
}
