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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useUnsavedChanges } from '@/components/UnsavedChangesProvider';
import styles from './updateDjProfile.module.css';
import GeneralTab from './GeneralTab';
import BookingTab from './BookingTab';
import ClubBookingTab from './ClubBookingTab';
// Removed imports for SocialsTab, MixesTab, PhotosTab, VideoTab, TestimonialsTab —
// those tabs were removed from this page; their content is now managed
// inline on the public profile page.
import {
  type BookingSettings,
  parseBookingSettings,
} from '@/app/(main)/[slug]/bookingSettings';

type TabKey = 'general' | 'booking';

// All fields the General tab edits. Stored as state so each input is controlled.
// All non-booking fields tracked by the form. Despite the name (kept for
// backwards compat with existing imports), this includes Socials, Mixes,
// Photos, Video, and Testimonials state — not just the General tab fields.
export interface GeneralFormState {
  // General tab
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
  avatarUrl: string;
  // Socials tab
  website: string;
  soundcloud: string;
  instagram: string;
  tiktok: string;
  facebook: string;
  twitch: string;
  // Mixes tab — 3 fixed slots
  mixUrl1: string;
  mixUrl2: string;
  mixUrl3: string;
  // Photos tab — 4 fixed slots, public URLs to Supabase storage
  galleryImg1: string;
  galleryImg2: string;
  galleryImg3: string;
  galleryImg4: string;
  // Video tab — 3 fixed slots
  videoUrl1: string;
  videoUrl2: string;
  videoUrl3: string;
  // Testimonials — array of {name, date, blurb}, max 5
  testimonials: TestimonialItem[];
}

export interface TestimonialItem {
  name: string;
  date: string;
  blurb: string;
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
  // Socials
  website?: string | null;
  soundcloud?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  facebook?: string | null;
  twitch?: string | null;
  // Mixes
  mix_url_1?: string | null;
  mix_url_2?: string | null;
  mix_url_3?: string | null;
  // Photos
  gallery_img_1?: string | null;
  gallery_img_2?: string | null;
  gallery_img_3?: string | null;
  gallery_img_4?: string | null;
  // Videos
  video_url_1?: string | null;
  video_url_2?: string | null;
  video_url_3?: string | null;
  // Testimonials — JSON-stringified array
  testimonials?: string | null;
}

interface Props {
  initialProfile: InitialProfile;
  authEmail: string;
}

export default function UpdateDjProfileClient({ initialProfile, authEmail }: Props) {
  // Active tab — defaults to 'general'. Can be deep-linked via ?tab=
  // (used by the public profile owner-view "+ Add" buttons that route
  // here). Validates the value against known tab keys before applying.
  const searchParams = useSearchParams();
  const tabFromUrl = (() => {
    const t = searchParams?.get('tab') || '';
    const valid: TabKey[] = ['general', 'booking'];
    return (valid as string[]).includes(t) ? (t as TabKey) : null;
  })();
  const [activeTab, setActiveTab] = useState<TabKey>(tabFromUrl || 'general');

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

    // Parse testimonials JSON (stored as a stringified array on users.testimonials).
    // Bad JSON or missing field → empty array.
    let initialTestimonials: TestimonialItem[] = [];
    if (initialProfile.testimonials) {
      try {
        const parsed = JSON.parse(initialProfile.testimonials);
        if (Array.isArray(parsed)) {
          initialTestimonials = parsed
            .filter((t) => t && typeof t === 'object')
            .map((t) => ({
              name: String((t as { name?: unknown }).name || ''),
              date: String((t as { date?: unknown }).date || ''),
              blurb: String((t as { blurb?: unknown }).blurb || ''),
            }));
        }
      } catch {
        // Bad JSON — leave as empty array
      }
    }

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
      website: initialProfile.website || '',
      soundcloud: initialProfile.soundcloud || '',
      instagram: initialProfile.instagram || '',
      tiktok: initialProfile.tiktok || '',
      facebook: initialProfile.facebook || '',
      twitch: initialProfile.twitch || '',
      mixUrl1: initialProfile.mix_url_1 || '',
      mixUrl2: initialProfile.mix_url_2 || '',
      mixUrl3: initialProfile.mix_url_3 || '',
      galleryImg1: initialProfile.gallery_img_1 || '',
      galleryImg2: initialProfile.gallery_img_2 || '',
      galleryImg3: initialProfile.gallery_img_3 || '',
      galleryImg4: initialProfile.gallery_img_4 || '',
      videoUrl1: initialProfile.video_url_1 || '',
      videoUrl2: initialProfile.video_url_2 || '',
      videoUrl3: initialProfile.video_url_3 || '',
      testimonials: initialTestimonials,
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
          // Cast as never — same situation as the manual save below: the
          // UserProfile type in db.ts doesn't list every column on the
          // actual users table, so the type system needs the escape hatch.
          .update({ booking_settings: JSON.stringify(bookingSettings) } as unknown as never)
          .eq('id', initialProfile.id);
        if (error) throw error;
        setAutosaveStatus('saved');
        setTimeout(() => setAutosaveStatus('idle'), 5000);
      } catch {
        setAutosaveStatus('error');
      }
    }, 600);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [bookingSettings, initialProfile.id]);

  // ── Unsaved changes warning ─────────────────────────────────────
  // Snapshot of `general` at mount time. When the live `general` differs
  // from this snapshot, the General/Socials/Mixes/Photos/Video/Testimonials
  // tabs have unsaved changes (those tabs save via the bottom Save button).
  // After a successful submit, this snapshot updates so the dirty flag
  // clears.
  const initialGeneralRef = useRef<string>(JSON.stringify(general));
  // Bumped after a successful save so the `isGeneralDirty` memo below
  // re-evaluates against the freshly-updated snapshot ref. Mutating a
  // ref alone won't trigger memo recomputation — React only re-runs the
  // memo when its dep array changes, so we add this counter to the deps.
  const [savedVersion, setSavedVersion] = useState(0);

  // BookingTab tells us when ANY of its package cards has draft edits
  // not yet committed via per-card Save / master Save All. We don't know
  // the count, just true/false.
  const [hasDirtyPackages, setHasDirtyPackages] = useState(false);

  // ClubBookingTab reports when the Rates section has unsaved drafts.
  // (Equipment + calendar autosave; rates are manual save.)
  const [hasDirtyClubRates, setHasDirtyClubRates] = useState(false);

  // ClubBookingTab also reports when the booking toggle is on but no
  // equipment option has been picked. In that state booking won't be
  // live publicly until they pick equipment, so we want to warn on
  // navigation away just like for unsaved changes.
  const [clubBookingActivationIncomplete, setClubBookingActivationIncomplete] = useState(false);

  // Master save trigger — a counter that bumps when the user clicks the
  // page-level Save All button at the bottom. Both BookingTab (for
  // packages) and ClubBookingTab (for rates) listen via prop and try
  // to save themselves.
  const [masterSaveTrigger, setMasterSaveTrigger] = useState(0);
  function triggerMasterSave() {
    setMasterSaveTrigger((n) => n + 1);
  }

  // Are general fields different from snapshot?
  const isGeneralDirty = useMemo(
    () => JSON.stringify(general) !== initialGeneralRef.current,
    [general, savedVersion]
  );

  const isPageDirty = isGeneralDirty || hasDirtyPackages || hasDirtyClubRates;
  // beforeunload should also fire when the booking toggle is on but no
  // equipment is selected — this isn't "dirty data", but leaving the
  // page in that state means booking won't actually be live publicly,
  // which the DJ should be warned about.
  const needsLeaveWarn = isPageDirty || clubBookingActivationIncomplete;

  // Register this page's dirty state with the global UnsavedChangesProvider.
  // The provider handles:
  //   - beforeunload (tab close / refresh / external nav)
  //   - intercepting in-app <a> clicks (burger menu, header logo, back link)
  //   - browser back button via popstate
  // …and prompts the user via ConfirmModal before letting them leave.
  const { setDirty: setGlobalDirty } = useUnsavedChanges();
  useEffect(() => {
    setGlobalDirty(needsLeaveWarn);
    // Clear on unmount so we don't leave the guard armed after navigation.
    return () => setGlobalDirty(false);
  }, [needsLeaveWarn, setGlobalDirty]);

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

      // Testimonials: filter out empty entries, then stringify. Vanilla
      // collectTestimonials() drops cards with no name AND no blurb.
      const filledTestimonials = general.testimonials.filter(
        (t) => t.name.trim() || t.blurb.trim()
      );
      const testimonialsJson = filledTestimonials.length > 0
        ? JSON.stringify(filledTestimonials)
        : null;

      // ── Geocode the zip when it changes ─────────────────────────────
      // We store the resolved lat/lon on the profile row so the homepage's
      // "Find DJs Near Me" can sort by distance instantly without per-DJ
      // Nominatim calls. Only re-geocode when zip actually changed since
      // the last save — saves a network call on every other field edit.
      const zipTrimmed = general.zip.trim();
      const zipChanged = zipTrimmed !== (initialProfile.zip || '');
      let homeLat: number | null = null;
      let homeLon: number | null = null;
      let updateHomeCoords = false;
      if (zipChanged) {
        updateHomeCoords = true;
        if (zipTrimmed) {
          // Country-code biased Nominatim postcode lookup. Falls back to
          // null when the lookup fails — we don't block save on this.
          const COUNTRY_CC: Record<string, string> = {
            'United States': 'us', 'United Kingdom': 'gb', 'Canada': 'ca',
            'Australia': 'au', 'Germany': 'de', 'France': 'fr', 'Netherlands': 'nl',
            'Spain': 'es', 'Italy': 'it', 'Brazil': 'br', 'Mexico': 'mx',
            'Japan': 'jp', 'South Africa': 'za', 'New Zealand': 'nz',
            'Ireland': 'ie', 'Sweden': 'se', 'Norway': 'no', 'Denmark': 'dk',
            'Belgium': 'be', 'Switzerland': 'ch', 'Portugal': 'pt',
          };
          const cc = COUNTRY_CC[general.country || ''] || '';
          try {
            const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zipTrimmed)}${cc ? '&countrycodes=' + cc : ''}&format=json&limit=1`;
            const res = await fetch(url);
            const data = await res.json();
            if (data && data[0]) {
              homeLat = parseFloat(data[0].lat);
              homeLon = parseFloat(data[0].lon);
            }
          } catch {
            // Non-fatal — leave home_lat/home_lon null and save anyway.
          }
        }
      }

      const payload = {
        name: general.name.trim(),
        slug: finalSlug,
        bio: general.bio.trim() || null,
        phone: general.phone.trim() || null,
        zip: zipTrimmed || null,
        country: general.country || null,
        travel_distance: general.travelDistance || null,
        dj_start_year: general.djStartYear || null,
        event_types: eventTypes,
        club_genres: clubGenres,
        profile_private: general.profilePrivate,
        avatar_url: general.avatarUrl || null,
        // Socials
        website: general.website.trim() || null,
        soundcloud: general.soundcloud.trim() || null,
        instagram: general.instagram.trim() || null,
        tiktok: general.tiktok.trim() || null,
        facebook: general.facebook.trim() || null,
        twitch: general.twitch.trim() || null,
        // Mixes
        mix_url_1: general.mixUrl1.trim() || null,
        mix_url_2: general.mixUrl2.trim() || null,
        mix_url_3: general.mixUrl3.trim() || null,
        // Photos
        gallery_img_1: general.galleryImg1 || null,
        gallery_img_2: general.galleryImg2 || null,
        gallery_img_3: general.galleryImg3 || null,
        gallery_img_4: general.galleryImg4 || null,
        // Videos
        video_url_1: general.videoUrl1.trim() || null,
        video_url_2: general.videoUrl2.trim() || null,
        video_url_3: general.videoUrl3.trim() || null,
        // Testimonials
        testimonials: testimonialsJson,
        // Booking
        booking_settings: JSON.stringify(bookingSettings),
        // Pre-resolved home coordinates — only included when zip changed.
        // When zip is cleared, both go to null. When unchanged, we don't
        // touch them (existing values preserved).
        ...(updateHomeCoords ? { home_lat: homeLat, home_lon: homeLon } : {}),
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
      // Reset the general dirty snapshot so the unsaved-changes warning
      // clears (until the user makes new edits). Bumping savedVersion is
      // what actually causes the isGeneralDirty memo to re-evaluate — the
      // ref mutation alone wouldn't trigger React.
      initialGeneralRef.current = JSON.stringify(general);
      setSavedVersion((n) => n + 1);
    } catch (e) {
      // Detect Supabase/Postgres unique-violation on slug. The DB rejects
      // duplicates with code '23505' (Postgres unique_violation) and the
      // PostgREST layer surfaces it as HTTP 409. Show a slug-specific
      // message + nudge the user back to General tab so they can fix it.
      let msg: string;
      const errAny = e as { code?: string; status?: number; message?: string };
      const isSlugDup =
        errAny?.code === '23505' ||
        errAny?.status === 409 ||
        (errAny?.message?.includes('users_slug') ?? false) ||
        (errAny?.message?.toLowerCase().includes('duplicate') ?? false);
      if (isSlugDup) {
        msg = 'That Custom Profile URL is already taken — please pick another.';
        setActiveTab('general');
      } else {
        msg = e instanceof Error ? e.message : 'Save failed';
      }
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
          {/* Tab navigation — Socials/Mixes/Photos/Video/Testimonials
              were removed; those are now managed inline on the public
              profile page. */}
          <div className={styles.tabsBar}>
            <button type="button" className={tabClass('general')} onClick={() => setActiveTab('general')}>General</button>
            <button type="button" className={tabClass('booking')} onClick={() => setActiveTab('booking')}>Booking</button>
          </div>

          {/* Panes */}
          {activeTab === 'general' && (
            <GeneralTab
              state={general}
              onChange={updateGeneral}
              djType={initialProfile.dj_type}
              email={authEmail}
              slug={initialProfile.slug}
              siteUrl={siteUrl}
              userId={initialProfile.id}
            />
          )}

          {/* BookingTab is mounted ALWAYS (just hidden via display:none
              when inactive) so per-package drafts survive tab switches.
              Other tabs unmount because they have no local-only state —
              everything's in `general`/`bookingSettings` already. */}
          <div style={{ display: activeTab === 'booking' ? 'block' : 'none' }}>
            {initialProfile.dj_type === 'club' ? (
              <ClubBookingTab
                bookingSettings={bookingSettings}
                onChange={setBookingSettings}
                autosaveStatus={autosaveStatus}
                djSlug={general.slug}
                onDirtyChange={setHasDirtyClubRates}
                masterSaveTrigger={masterSaveTrigger}
                onActivationIncompleteChange={setClubBookingActivationIncomplete}
              />
            ) : (
              <BookingTab
                djType={initialProfile.dj_type}
                djSlug={general.slug}
                selectedEventTypes={general.mobileEvents}
                bookingSettings={bookingSettings}
                onChange={setBookingSettings}
                userId={initialProfile.id}
                onGoToGeneral={() => setActiveTab('general')}
                autosaveStatus={autosaveStatus}
                onDirtyChange={setHasDirtyPackages}
                externalMasterSaveTrigger={masterSaveTrigger}
              />
            )}
          </div>

          {/* Page-level Save All — saves any pending edits across the
              entire form. Disabled when nothing is dirty so the user
              knows they're up to date. Submit type triggers the form
              handler which saves the General fields directly; the
              masterSaveTrigger bump fires synchronously to commit any
              package / club-rate drafts back to bookingSettings, and the
              autosave effect picks those up ~600ms later. */}
          <button
            type="submit"
            disabled={saving || !isPageDirty}
            onClick={() => triggerMasterSave()}
            className={styles.submitBtn}
            style={{
              opacity: (saving || !isPageDirty) ? 0.55 : 1,
              cursor: (saving || !isPageDirty) ? 'not-allowed' : 'pointer',
            }}
          >
            {saving
              ? 'Saving…'
              : isPageDirty
              ? 'Save All Changes'
              : '✓ All Changes Saved'}
          </button>
        </form>
      </div>
    </div>
  );
}
