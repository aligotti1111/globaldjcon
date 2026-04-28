'use client';

// UpdateDjProfileClient — top-level client component for /update-dj-profile.
// Manages: tab state, form state for General + Booking, save flow.
//
// State strategy:
//   - General tab fields are kept in a single `general` object (one update
//     per change). On submit, we POST the whole thing to the users row.
//   - Booking tab edits to booking_settings flow through `bookingSettings`
//     state. We autosave on debounce and also include in the final submit.
//
// Save paths:
//   - Manual "Save Changes" button at the bottom — saves both General fields
//     AND booking_settings in one users.update call. Shows a success/error
//     alert at the top of the card.
//   - Background autosave for booking_settings when fields change. Vanilla
//     parity: settings, packages, and the calendar all autosave silently.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from './updateDjProfile.module.css';
import GeneralTab from './GeneralTab';
import BookingTab from './BookingTab';
import {
  type BookingSettings,
  parseBookingSettings,
} from '@/app/(main)/[slug]/bookingSettings';

type TabKey = 'general' | 'social' | 'mixes' | 'photos' | 'video' | 'testimonials' | 'booking';

// All fields the General tab edits. Stored as state so each input is controlled.
export interface GeneralFormState {
  name: string;
  slug: string;
  bio: string;
  phone: string;
  zip: string;
  country: string;
  travelDistance: string;
  djStartYear: string;
  mobileEvents: string[];   // for mobile DJs
  clubGenres: string[];     // for club DJs
  profilePrivate: boolean;
  avatarUrl: string;        // current avatar URL (already uploaded to storage)
}

interface InitialProfile {
  id: string;
  name: string;
  slug: string | null;
  zip: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  dj_type: 'club' | 'mobile' | null;
  booking_settings: string | null;
  bio?: string | null;
  phone?: string | null;
  travel_distance?: string | null;
  dj_start_year?: string | null;
  event_types?: string | null;
  club_genres?: string[] | null;
  profile_private?: boolean | null;
  avatar_url?: string | null;
}

interface Props {
  initialProfile: InitialProfile;
  authEmail: string;
}

export default function UpdateDjProfileClient({ initialProfile, authEmail }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('general');

  const [general, setGeneral] = useState<GeneralFormState>(() => {
    // Vanilla default: a Mobile DJ with no event_types saved yet (new account)
    // gets ALL 12 mobile party types pre-checked. Club DJs default to none
    // (genres are opt-in). See udjp-load-and-save.js lines 185-195.
    const savedEventTypes = (initialProfile.event_types || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const defaultMobileEvents = savedEventTypes.length > 0
      ? savedEventTypes
      : (initialProfile.dj_type === 'mobile'
          ? ['weddings','corporate','birthday','anniversary','graduation','sweet16','mitzvah','reunion','holiday','school','community','other']
          : []);

    return {
      name: initialProfile.name || '',
      slug: initialProfile.slug || '',
      bio: initialProfile.bio || '',
      phone: initialProfile.phone || '',
      zip: initialProfile.zip || '',
      country: initialProfile.country || '',
      travelDistance: initialProfile.travel_distance || '',
      djStartYear: initialProfile.dj_start_year || '',
      mobileEvents: defaultMobileEvents,
      clubGenres: initialProfile.club_genres || [],
      profilePrivate: !!initialProfile.profile_private,
      avatarUrl: initialProfile.avatar_url || '',
    };
  });

  const [bookingSettings, setBookingSettings] = useState<BookingSettings>(
    parseBookingSettings(initialProfile.booking_settings) || {}
  );

  // Save state — alert at top, button disabled while saving
  const [saving, setSaving] = useState(false);
  const [alertMsg, setAlertMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // ── Autosave booking_settings (debounced) ───────────────────────
  // Vanilla autosaves on each control change. We do the same with a
  // 600ms debounce to avoid hammering the database. Only triggers AFTER
  // the user makes edits — not on initial mount.
  const supabaseRef = useRef(createClient());
  const initialBookingRef = useRef(bookingSettings);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    // Skip the first render (when state matches initial)
    if (bookingSettings === initialBookingRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      setAutosaveStatus('saving');
      try {
        const { error } = await supabaseRef.current
          .from('users')
          .update({ booking_settings: JSON.stringify(bookingSettings) })
          .eq('id', initialProfile.id);
        if (error) throw error;
        setAutosaveStatus('saved');
        setTimeout(() => setAutosaveStatus('idle'), 2000);
      } catch {
        setAutosaveStatus('error');
      }
    }, 600);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [bookingSettings, initialProfile.id]);

  // ── Generic helpers ─────────────────────────────────────────────
  function updateGeneral<K extends keyof GeneralFormState>(field: K, val: GeneralFormState[K]) {
    setGeneral(prev => ({ ...prev, [field]: val }));
  }

  // ── Manual save ─────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setAlertMsg(null);
    try {
      const supabase = supabaseRef.current;

      // Build the General payload. Slug stays unchanged when blank — falls
      // back to the existing slug to avoid dropping it on save.
      const slugTrimmed = general.slug.trim();
      const finalSlug = slugTrimmed || initialProfile.slug || null;

      // event_types: comma-joined list of mobile event values, or null.
      // Vanilla also persists club genres separately as a text[] column.
      const eventTypes = general.mobileEvents.length > 0
        ? general.mobileEvents.join(',')
        : null;
      const clubGenres = general.clubGenres.length > 0 ? general.clubGenres : null;

      const payload = {
        name: general.name.trim(),
        slug: finalSlug,
        bio: general.bio.trim() || null,
        phone: general.phone.trim() || null,
        zip: general.zip.trim() || null,
        country: general.country || null,
        travel_distance: general.travelDistance || null,
        dj_start_year: general.djStartYear || null,
        event_types: eventTypes,
        club_genres: clubGenres,
        profile_private: general.profilePrivate,
        avatar_url: general.avatarUrl || null,
        booking_settings: JSON.stringify(bookingSettings),
      };

      const { error } = await supabase
        .from('users')
        // Cast as never — UserProfile in db.ts doesn't have all these fields,
        // but the actual users table does. Same situation as the bookings
        // insert in MobileBookingForm.
        .update(payload as unknown as never)
        .eq('id', initialProfile.id);
      if (error) throw error;

      setAlertMsg({ kind: 'success', text: '✓ Profile saved.' });
      // Update the initial-booking ref so autosave doesn't immediately
      // re-trigger after a manual save.
      initialBookingRef.current = bookingSettings;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setAlertMsg({ kind: 'error', text: msg });
    }
    setSaving(false);
  }

  // ── Tab class helper ────────────────────────────────────────────
  function tabClass(t: TabKey): string {
    return `${styles.tabBtn} ${activeTab === t ? styles.tabBtnActive : ''}`;
  }

  // Site URL for the slug preview. ALWAYS production — even on staging
  // the share link should point at globaldjconnect.com, never a Netlify
  // preview URL (which would be useless to share with anyone).
  const siteUrl = 'https://globaldjconnect.com';

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <Link href="/" className={styles.backLink}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Directory
        </Link>
        {/* Autosave status — only visible during/after autosave events */}
        {autosaveStatus !== 'idle' && (
          <span
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '.6rem',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: autosaveStatus === 'error' ? '#ff5f5f'
                : autosaveStatus === 'saved' ? 'var(--neon)'
                : 'var(--muted)',
            }}
          >
            {autosaveStatus === 'saving' ? 'Saving…'
              : autosaveStatus === 'saved' ? '✓ Auto-saved'
              : '✗ Save failed'}
          </span>
        )}
      </div>

      <div className={styles.header}>
        <h1>Update Profile</h1>
        <p>Manage Your Listing</p>
      </div>

      <div className={styles.card}>
        {alertMsg && (
          <div className={`${styles.alert} ${
            alertMsg.kind === 'success' ? styles.alertSuccess : styles.alertError
          }`}>
            {alertMsg.text}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Tab navigation */}
          <div className={styles.tabsBar}>
            <button type="button" className={tabClass('general')} onClick={() => setActiveTab('general')}>General</button>
            <button type="button" className={tabClass('social')} onClick={() => setActiveTab('social')}>Socials</button>
            <button type="button" className={tabClass('mixes')} onClick={() => setActiveTab('mixes')}>Mixes</button>
            <button type="button" className={tabClass('photos')} onClick={() => setActiveTab('photos')}>Photos</button>
            <button type="button" className={tabClass('video')} onClick={() => setActiveTab('video')}>Video</button>
            <button type="button" className={tabClass('testimonials')} onClick={() => setActiveTab('testimonials')}>Testimonials</button>
            <button type="button" className={tabClass('booking')} onClick={() => setActiveTab('booking')}>Booking</button>
          </div>

          {/* Panes */}
          {activeTab === 'general' && (
            <GeneralTab
              state={general}
              onChange={updateGeneral}
              djType={initialProfile.dj_type}
              email={authEmail}
              slug={general.slug || initialProfile.slug}
              siteUrl={siteUrl}
              userId={initialProfile.id}
            />
          )}

          {activeTab === 'booking' && (
            <BookingTab
              djType={initialProfile.dj_type}
              selectedEventTypes={general.mobileEvents}
              bookingSettings={bookingSettings}
              onChange={setBookingSettings}
              userId={initialProfile.id}
              onGoToGeneral={() => setActiveTab('general')}
            />
          )}

          {/* Placeholders for tabs not yet ported */}
          {activeTab === 'social' && <DeferredPlaceholder name="Socials" />}
          {activeTab === 'mixes' && <DeferredPlaceholder name="Mixes" />}
          {activeTab === 'photos' && <DeferredPlaceholder name="Photos" />}
          {activeTab === 'video' && <DeferredPlaceholder name="Video" />}
          {activeTab === 'testimonials' && <DeferredPlaceholder name="Testimonials" />}

          <button type="submit" disabled={saving} className={styles.submitBtn}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  );
}

function DeferredPlaceholder({ name }: { name: string }) {
  return (
    <div className={styles.placeholderPane}>
      <div className={styles.placeholderTitle}>{name} tab coming soon</div>
      This tab will be ported in a later session. The vanilla site
      (globaldjconnect.com) still has full functionality for this section.
    </div>
  );
}
