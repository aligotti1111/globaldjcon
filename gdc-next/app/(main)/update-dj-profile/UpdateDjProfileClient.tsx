'use client';

// UpdateDjProfileClient — top-level client component for /update-dj-profile
// (presented to DJs as "Settings"). Manages the General/profile form + save.
//
// Booking configuration used to be a second tab here; it now lives on its own
// page (/booking-settings) with its own state + autosave. This page no longer
// touches booking_settings at all.
//
// State strategy:
// - General fields are kept in a single `general` object (one update per
//   change). On submit, the whole thing is written to the users row.
// - Manual "Save Changes" button at the bottom saves those fields and shows
//   a success/error alert at the top of the card.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useUnsavedChanges } from '@/components/UnsavedChangesProvider';
import { useAuth } from '@/components/AuthProvider';
import styles from './updateDjProfile.module.css';
import GeneralTab, { type AccountTab } from './GeneralTab';
import { parseCustomEventTypes, type CustomEventType } from '@/lib/constants';
import TeamSection from '../account-settings/TeamSection';
import TimezoneSection from '../account-settings/TimezoneSection';
import NotificationsClient from '../notifications/NotificationsClient';
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
  // Public BUSINESS address — goes on the standard contract and (next phase)
  // the planner header, and pre-fills a mailing address for check payments.
  // Street line only; city + state are derived from the ZIP, country is its
  // own field below.
  address: string;
  // Derived from the ZIP on save (Nominatim), not typed. Stored so contracts
  // have a full mailing address without asking for them.
  city: string;
  state: string;
  zip: string;
  country: string;
  travelDistance: string;
  djStartYear: string;
  mobileEvents: string[]; // for mobile DJs
  customEventTypes: CustomEventType[]; // DJ-defined event types
  specialtyTypes: string[]; // event-type keys placed in the Specialty group
  clubGenres: string[]; // for club DJs
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
  // Optional to match how phone/bio are declared — the page casts the users
  // row in with select('*'), and an optional field can't trip a "missing
  // property" type error if the cast doesn't happen to name it.
  address?: string | null;
  country: string | null;
  dj_type: 'club' | 'mobile' | null;
  booking_settings: string | null;
  bio?: string | null;
  phone?: string | null;
  travel_distance?: string | null;
  dj_start_year?: string | null;
  event_types?: string | null;
  mob_custom_event_types?: unknown;
  mob_specialty_types?: unknown;
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

// Init for the Notifications tab (email + text preference toggles). Mirrors the
// shape NotificationsClient expects; loaded server-side off the users row.
export interface NotifyInit {
  role: string;
  sms_phone: string;
  sms_enabled: boolean;
  sms_notify_booking_request: boolean;
  sms_notify_booking_status: boolean;
  sms_notify_inbox_message: boolean;
  email_notify_booking_request: boolean;
  email_notify_booking_status: boolean;
  email_notify_inbox_message: boolean;
}

interface Props {
  initialProfile: InitialProfile;
  authEmail: string;
  // Optional so the page can be deployed/updated independently — when it's
  // absent the Notifications tab simply doesn't render (no build break).
  notifyInit?: NotifyInit;
}

// The section tab bar now includes a Notifications tab. AccountTab (from
// GeneralTab) covers the panes GeneralTab owns; 'notifications' is rendered
// separately below (like Team / Timezone), so we widen the local tab type.
type SecTab = AccountTab | 'notifications';

export default function UpdateDjProfileClient({ initialProfile, authEmail, notifyInit }: Props) {

  const [general, setGeneral] = useState<GeneralFormState>(() => {
    // Vanilla default: a Mobile DJ with no event_types saved yet (new account)
    // gets ALL 12 mobile party types pre-checked. Club DJs default to none
    // (genres are opt-in). See udjp-load-and-save.js lines 185-195.
    const savedEventTypes = (initialProfile.event_types || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const defaultMobileEvents = savedEventTypes.length > 0
      ? savedEventTypes
      : (initialProfile.dj_type === 'mobile'
        ? ['weddings','corporate','birthday','anniversary','graduation','sweet16','quinceanera','mitzvah','reunion','holiday','school','community','other']
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
      address: initialProfile.address || '',
      city: initialProfile.city || '',
      state: initialProfile.state || '',
      zip: initialProfile.zip || '',
      country: initialProfile.country || '',
      travelDistance: initialProfile.travel_distance || '',
      djStartYear: initialProfile.dj_start_year || '',
      mobileEvents: defaultMobileEvents,
      customEventTypes: parseCustomEventTypes((initialProfile as { mob_custom_event_types?: unknown }).mob_custom_event_types),
      specialtyTypes: (() => {
        const raw = (initialProfile as { mob_specialty_types?: unknown }).mob_specialty_types;
        let arr: unknown = raw;
        if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { arr = null; } }
        if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
        return ['weddings', 'mitzvah']; // built-in specialty default
      })(),
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

  // Alert at top — used by the Enter-to-save fallback (handleSubmit).
  const [alertMsg, setAlertMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Whether the Notifications tab has unsaved edits — reported up from
  // NotificationsClient so we can show the amber "unsaved" dot on that tab.
  const [notifDirty, setNotifDirty] = useState(false);

  // ── Section tabs ────────────────────────────────────────────────
  // This page is laid out like Booking Settings: a top tab bar swaps between
  // sections instead of one long scroll. GeneralTab renders the first four
  // (kept mounted, shown via display toggle); Team + Your Timezone +
  // Notifications are their own tabs rendered below.
  const [tab, setTab] = useState<SecTab>('account');
  const tabs: { id: SecTab; label: string }[] = [
    { id: 'account', label: 'Profile Settings' },
    { id: 'eventTypes', label: initialProfile.dj_type === 'club' ? 'Music Genres' : 'Event Types' },
    { id: 'location', label: 'Location & Contact' },
    { id: 'team', label: 'Team' },
    // Only surface the Notifications tab when its prefs were loaded.
    ...(notifyInit ? [{ id: 'notifications' as SecTab, label: 'Notifications' }] : []),
    { id: 'blocked', label: 'Blocked' },
    { id: 'timezone', label: 'Your Timezone' },
  ];

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

  // ── Per-section dirty tracking ──────────────────────────────────
  // Each section saves itself and syncs the snapshot (initialGeneralRef) on
  // save, so a section is "unsaved" when its fields differ from that snapshot.
  // These drive BOTH the amber tab dots and the leave-without-saving list.
  let accountDirty = false;
  let locationDirty = false;
  let eventTypesDirty = false;
  try {
    const base = JSON.parse(initialGeneralRef.current) as GeneralFormState;
    locationDirty =
      base.address !== general.address ||
      base.city !== general.city ||
      base.state !== general.state ||
      base.zip !== general.zip ||
      base.country !== general.country ||
      base.phone !== general.phone ||
      base.travelDistance !== general.travelDistance;
    // Compare selections as SETS — deselecting then reselecting reorders the
    // array but doesn't change what's chosen, so it shouldn't read as unsaved.
    const eqStrSet = (a?: string[], b?: string[]) =>
      JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
    const eqObjSet = (a?: unknown[], b?: unknown[]) =>
      JSON.stringify([...(a || [])].map((x) => JSON.stringify(x)).sort()) ===
      JSON.stringify([...(b || [])].map((x) => JSON.stringify(x)).sort());
    eventTypesDirty =
      !eqStrSet(base.mobileEvents, general.mobileEvents) ||
      !eqObjSet(base.customEventTypes, general.customEventTypes) ||
      !eqStrSet(base.specialtyTypes, general.specialtyTypes) ||
      !eqStrSet(base.clubGenres, general.clubGenres);
    // Everything else the page owns belongs to the Account pane.
    const accountFields: (keyof GeneralFormState)[] = [
      'name', 'slug', 'bio', 'djStartYear', 'profilePrivate', 'avatarUrl',
      'website', 'soundcloud', 'instagram', 'tiktok', 'facebook', 'twitch',
      'mixUrl1', 'mixUrl2', 'mixUrl3',
      'galleryImg1', 'galleryImg2', 'galleryImg3', 'galleryImg4',
      'videoUrl1', 'videoUrl2', 'videoUrl3',
    ];
    accountDirty =
      accountFields.some((f) => JSON.stringify(base[f]) !== JSON.stringify(general[f])) ||
      JSON.stringify(base.testimonials) !== JSON.stringify(general.testimonials);
  } catch {
    /* snapshot unparseable — treat as clean */
  }

  const eventTypesLabel = initialProfile.dj_type === 'club' ? 'Music Genres' : 'Event Types';
  function tabHasUnsaved(id: SecTab): boolean {
    if (id === 'location') return locationDirty;
    if (id === 'eventTypes') return eventTypesDirty;
    if (id === 'notifications') return notifDirty;
    return false;
  }

  // Labels for the leave-without-saving list (each rendered with an amber dot
  // by UnsavedChangesProvider). Account is included so profile edits still warn.
  const dirtyLabels: string[] = [];
  if (accountDirty) dirtyLabels.push('Profile Settings');
  if (eventTypesDirty) dirtyLabels.push(eventTypesLabel);
  if (locationDirty) dirtyLabels.push('Location & Contact');
  if (notifDirty) dirtyLabels.push('Notifications');
  const needsLeaveWarn = dirtyLabels.length > 0;

  // Register this page's dirty state with the global UnsavedChangesProvider.
  // The provider handles:
  // - beforeunload (tab close / refresh / external nav)
  // - intercepting in-app <a> clicks (burger menu, header logo, back link)
  // - browser back button via popstate
  // …and prompts the user via ConfirmModal (with the labelled list) before
  // letting them leave.
  const { setDirty: setGlobalDirty } = useUnsavedChanges();
  const { patchUser } = useAuth();
  const dirtyKey = dirtyLabels.join('|');
  useEffect(() => {
    setGlobalDirty(needsLeaveWarn, needsLeaveWarn ? dirtyLabels : []);
    // Clear on unmount so we don't leave the guard armed after navigation.
    return () => setGlobalDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsLeaveWarn, dirtyKey, setGlobalDirty]);

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

  // Called by GeneralTab AFTER it has written an event-type deletion straight
  // to the DB (same pattern as handleSlugSaved). Deleting a custom event type
  // persists on its own — no bottom Save needed — so we sync the three affected
  // fields into the dirty snapshot too, or the leave-warning would fire and the
  // Save button would light up for a change that's already saved.
  function handleEventTypesSaved(
    nextCustom: GeneralFormState['customEventTypes'],
    nextMobile: string[],
    nextSpecialty: string[],
  ) {
    try {
      const base = JSON.parse(initialGeneralRef.current) as GeneralFormState;
      base.customEventTypes = nextCustom;
      base.mobileEvents = nextMobile;
      base.specialtyTypes = nextSpecialty;
      initialGeneralRef.current = JSON.stringify(base);
    } catch {
      /* snapshot stays as-is; worst case a harmless dirty flag */
    }
    setSavedVersion(v => v + 1);
  }

  // Called by GeneralTab's "Location & Contact" section AFTER it saves those
  // fields to the DB itself. Same pattern as the two above — sync the snapshot
  // so the bottom Save button / leave-warning don't fire for saved fields.
  function handleContactSaved(
    address: string, city: string, stateRegion: string, zip: string,
    country: string, phone: string, travelDistance: string,
  ) {
    setGeneral(prev => ({ ...prev, address, city, state: stateRegion, zip, country, phone, travelDistance }));
    try {
      const base = JSON.parse(initialGeneralRef.current) as GeneralFormState;
      base.address = address; base.city = city; base.state = stateRegion; base.zip = zip;
      base.country = country; base.phone = phone; base.travelDistance = travelDistance;
      initialGeneralRef.current = JSON.stringify(base);
    } catch {
      /* snapshot stays as-is; worst case a harmless dirty flag */
    }
    setSavedVersion(v => v + 1);
  }

  // Called after GeneralTab saves the upper-area basics (name + private) and
  // club genres itself — sync the snapshot so the leave-warning doesn't fire.
  function handleBasicsSaved(name: string, profilePrivate: boolean) {
    setGeneral(prev => ({ ...prev, name, profilePrivate }));
    try {
      const base = JSON.parse(initialGeneralRef.current) as GeneralFormState;
      base.name = name;
      base.profilePrivate = profilePrivate;
      initialGeneralRef.current = JSON.stringify(base);
    } catch {
      /* snapshot stays as-is; worst case a harmless dirty flag */
    }
    setSavedVersion(v => v + 1);
  }
  function handleGenresSaved(clubGenres: string[]) {
    setGeneral(prev => ({ ...prev, clubGenres }));
    try {
      const base = JSON.parse(initialGeneralRef.current) as GeneralFormState;
      base.clubGenres = clubGenres;
      initialGeneralRef.current = JSON.stringify(base);
    } catch {
      /* snapshot stays as-is; worst case a harmless dirty flag */
    }
    setSavedVersion(v => v + 1);
  }

  // ── Manual save ─────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
        // Business address + the city / state / zip captured from the address
        // autocomplete pick — stored straight from the chosen address rather
        // than re-derived, so a precise pick isn't flattened to the ZIP's
        // primary town.
        address: general.address.trim() || null,
        city: general.city.trim() || null,
        state: general.state.trim() || null,
        zip: zipTrimmed || null,
        country: general.country || null,
        travel_distance: general.travelDistance || null,
        dj_start_year: general.djStartYear || null,
        event_types: eventTypes,
        mob_custom_event_types: general.customEventTypes.length > 0 ? general.customEventTypes : null,
        mob_specialty_types: general.specialtyTypes,
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
  }

  // ── Site URL for the slug preview ───────────────────────────────
  // ALWAYS production — even on staging the share link should point at
  // globaldjconnect.com, never a Netlify preview URL.
  const siteUrl = 'https://globaldjconnect.com';

  return (
    // Match the Booking Settings frame width (maxWidth 1100, centered) so the
    // two pages line up side to side.
    <div className={styles.container} style={{ maxWidth: 1100, width: '100%', marginLeft: 'auto', marginRight: 'auto' }}>
      <div className={styles.headerRow}>
        <Link href="/" className={styles.backLink}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Directory
        </Link>
      </div>

      <div className={styles.header}>
        <h1>Account Settings</h1>
        <p>Manage Your Profile</p>
      </div>

      {/* Section tab bar — same pattern as Booking Settings: a horizontal nav
          on desktop, a <select> on mobile. */}
      <nav className={styles.secTabNav} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`${styles.secTabBtn} ${tab === t.id ? styles.secTabBtnActive : ''}`}
            onClick={() => setTab(t.id)}
            title={tabHasUnsaved(t.id) ? 'Unsaved changes — save on this tab' : undefined}
          >
            {t.label}
            {tabHasUnsaved(t.id) && (
              <span
                aria-label="Unsaved changes"
                style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--amber,#f5a623)', marginLeft: 6, verticalAlign: 'middle' }}
              />
            )}
          </button>
        ))}
      </nav>
      <select
        className={styles.secTabSelect}
        value={tab}
        onChange={(e) => setTab(e.target.value as SecTab)}
        aria-label="Account settings section"
      >
        {tabs.map((t) => (
          <option key={t.id} value={t.id}>{t.label}{tabHasUnsaved(t.id) ? ' •' : ''}</option>
        ))}
      </select>

      {/* GeneralTab card — holds the Account / Event Types / Location / Blocked
          panes. Stays mounted (so per-section edit + dirty state survive tab
          switches) but is hidden when a non-GeneralTab tab is active. */}
      <div
        className={styles.card}
        style={{ display: tab === 'team' || tab === 'timezone' || tab === 'notifications' ? 'none' : undefined }}
      >
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
            activeTab={tab as AccountTab}
            djType={initialProfile.dj_type}
            email={authEmail}
            slug={initialProfile.slug}
            siteUrl={siteUrl}
            userId={initialProfile.id}
            onSlugSaved={handleSlugSaved}
            onEventTypesSaved={handleEventTypesSaved}
            onContactSaved={handleContactSaved}
            onBasicsSaved={handleBasicsSaved}
            onGenresSaved={handleGenresSaved}
          />

          {/* The single bottom "Save Changes" button is gone: every section on
              this page now saves itself (name + private, URL, party types,
              genres, location & contact, logo, email, password, blocked users).
              The form + handleSubmit stay as a harmless Enter-to-save fallback. */}
        </form>
      </div>

      {/* Notifications — its own tab. The email + text preference matrix that
          used to live at the standalone /notifications page. Self-contained;
          saves the sms_* / email_notify_* columns directly. */}
      {notifyInit && (
        <div style={{ display: tab === 'notifications' ? undefined : 'none' }}>
          <NotificationsClient userId={initialProfile.id} init={notifyInit} onDirtyChange={setNotifDirty} />
        </div>
      )}

      {/* Team seats — its own tab. DJs render THIS component (not
          AccountSettingsClient). Self-contained + Pro-gated. */}
      {tab === 'team' && <TeamSection djType={initialProfile.dj_type} />}

      {/* Your Timezone — its own tab. The clock the booking-request auto-decline
          deadline and the "Expires in N days" countdown are measured in. */}
      {tab === 'timezone' && <TimezoneSection />}
    </div>
  );
}
