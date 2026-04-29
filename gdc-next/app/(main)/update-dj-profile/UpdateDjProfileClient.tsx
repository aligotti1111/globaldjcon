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
import SocialsTab from './SocialsTab';
import MixesTab from './MixesTab';
import PhotosTab from './PhotosTab';
import VideoTab from './VideoTab';
import TestimonialsTab from './TestimonialsTab';
import {
  type BookingSettings,
  parseBookingSettings,
} from '@/app/(main)/[slug]/bookingSettings';

type TabKey = 'general' | 'social' | 'mixes' | 'photos' | 'video' | 'testimonials' | 'booking';

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
          .update({ booking_settings: JSON.stringify(bookingSettings) })
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
            {/* Testimonials only for Mobile DJs — vanilla hides this tab for clubs */}
            {initialProfile.dj_type === 'mobile' && (
              <button type="button" className={tabClass('testimonials')} onClick={() => setActiveTab('testimonials')}>Testimonials</button>
            )}
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
              autosaveStatus={autosaveStatus}
            />
          )}

          {activeTab === 'social' && (
            <SocialsTab state={general} onChange={updateGeneral} />
          )}
          {activeTab === 'mixes' && (
            <MixesTab state={general} onChange={updateGeneral} />
          )}
          {activeTab === 'photos' && (
            <PhotosTab
              state={general}
              onChange={updateGeneral}
              userId={initialProfile.id}
            />
          )}
          {activeTab === 'video' && (
            <VideoTab state={general} onChange={updateGeneral} />
          )}
          {/* Testimonials tab only visible / accessible for Mobile DJs (vanilla parity).
              Tab button is also hidden in the tabsBar above for non-mobile DJs.
              The pane render is gated here too, defensively, in case a non-mobile
              DJ somehow lands on activeTab === 'testimonials'. */}
          {activeTab === 'testimonials' && initialProfile.dj_type === 'mobile' && (
            <TestimonialsTab state={general} onChange={updateGeneral} />
          )}

          <button type="submit" disabled={saving} className={styles.submitBtn}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  );
}
