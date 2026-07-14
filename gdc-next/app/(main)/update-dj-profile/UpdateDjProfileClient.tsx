'use client';

// UpdateDjProfileClient — top-level client component for /update-dj-profile
// (presented to DJs as "Settings"). Manages the General/profile form + save.
//
// Booking configuration used to be a second tab here; it now lives on its own
// page (/booking-settings) with its own state + autosave. This page no longer
// touches booking_settings at all.
//
// State strategy:
//   - General fields are kept in a single `general` object (one update per
//     change). On submit, the whole thing is written to the users row.
//   - Manual "Save Changes" button at the bottom saves those fields and shows
//     a success/error alert at the top of the card.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useUnsavedChanges } from '@/components/UnsavedChangesProvider';
import { useAuth } from '@/components/AuthProvider';
import styles from './updateDjProfile.module.css';
import GeneralTab from './GeneralTab';
// Booking configuration moved to its own page (/booking-settings); the
// BookingTab / ClubBookingTab components live in this folder still but are
// mounted there now. Socials/Mixes/Photos/Video/Testimonials are managed
// inline on the public profile page.

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

  // Save state — alert at top, button disabled while saving
  const [saving, setSaving] = useState(false);
  const [alertMsg, setAlertMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Supabase client for the manual General save below. (Booking settings and
  // their autosave moved to /booking-settings.)
  const supabaseRef = useRef(createClient());

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

  // Are general fields different from snapshot?
  const isGeneralDirty = useMemo(
    () => JSON.stringify(general) !== initialGeneralRef.current,
    [general, savedVersion]
  );

  const isPageDirty = isGeneralDirty;
  const needsLeaveWarn = isPageDirty;

  // Register this page's dirty state with the global UnsavedChangesProvider.
  // The provider handles:
  //   - beforeunload (tab close / refresh / external nav)
  //   - intercepting in-app <a> clicks (burger menu, header logo, back link)
  //   - browser back button via popstate
  // …and prompts the user via ConfirmModal before letting them leave.
  const { setDirty: setGlobalDirty } = useUnsavedChanges();
  const { patchUser } = useAuth();
  useEffect(() => {
    setGlobalDirty(needsLeaveWarn);
    // Clear on unmount so we don't leave the guard armed after navigation.
    return () => setGlobalDirty(false);
  }, [needsLeaveWarn, setGlobalDirty]);

  // ── Generic helpers ─────────────────────────────────────────────
  function updateGeneral<K extends keyof GeneralFormState>(field: K, val: GeneralFormState[K]) {
    setGeneral(prev => ({ ...prev, [field]: val }));
  }

  // Called by the URL field's own Save (SlugChangeGate) AFTER it has written
  // the new slug straight to the DB. We (1) mirror it into form state so the
  // QR + preview update, (2) overwrite ONLY the slug in the dirty snapshot so
  // the leave-warning doesn't fire for an already-saved URL, and (3) patch the
  // cached auth user so header links ("View My Profile") point at the new slug
  // immediately instead of the stale one.
  function handleSlugSaved(newSlug: string) {
    setGeneral(prev => ({ ...prev, slug: newSlug }));
    try {
      const base = JSON.parse(initialGeneralRef.current) as GeneralFormState;
      base.slug = newSlug;
      initialGeneralRef.current = JSON.stringify(base);
    } catch {
      /* snapshot stays as-is; worst case a harmless dirty flag */
    }
    setSavedVersion(v => v + 1);
    patchUser({ slug: newSlug });
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
      } else {
        msg = e instanceof Error ? e.message : 'Save failed';
      }
      setAlertMsg({ kind: 'error', text: msg });
    }
    setSaving(false);
  }

  // ── Site URL for the slug preview ───────────────────────────────
  // ALWAYS production — even on staging the share link should point at
  // globaldjconnect.com, never a Netlify preview URL.
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
      </div>

      <div className={styles.header}>
        <h1>Settings</h1>
        <p>Manage Your Profile</p>
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
          <GeneralTab
            state={general}
            onChange={updateGeneral}
            djType={initialProfile.dj_type}
            email={authEmail}
            slug={initialProfile.slug}
            siteUrl={siteUrl}
            userId={initialProfile.id}
            onSlugSaved={handleSlugSaved}
          />

          {/* Save — persists the General/profile fields. Booking config has
              moved to its own page (/booking-settings) and saves there. */}
          <button
            type="submit"
            disabled={saving || !isPageDirty}
            className={styles.submitBtn}
            style={{
              opacity: (saving || !isPageDirty) ? 0.55 : 1,
              cursor: (saving || !isPageDirty) ? 'not-allowed' : 'pointer',
            }}
          >
            {saving
              ? 'Saving…'
              : isPageDirty
              ? 'Save Changes'
              : '✓ All Changes Saved'}
          </button>
        </form>
      </div>
    </div>
  );
}
