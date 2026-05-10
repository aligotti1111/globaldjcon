'use client';

// ProfileView — Client Component for the interactive parts of a DJ profile:
//   - Tab switching (About / Mixes / Photos / Video / Testimonials)
//   - Lightbox open/close for gallery images and avatar
// Server Component (page.tsx) does the data fetch and passes everything in.

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import styles from './profile.module.css';
import { useAuth } from '@/components/AuthProvider';
import { EVENT_TYPE_LABELS, GENRE_LABELS, initials } from './constants';
import { buildMixEmbed, buildVideoEmbed } from './embeds';
import { parseBookingSettings } from './bookingSettings';
import PublicCalendar from './PublicCalendar';
import MobilePublicCalendar from './MobilePublicCalendar';
import ClubBookingForm from './ClubBookingForm';
import BookingLoginGate from './BookingLoginGate';
import ComposeMessageModal from '@/components/ComposeMessageModal';
import { createClient } from '@/lib/supabase/client';
import AvatarCrop from '../update-dj-profile/AvatarCrop';
import {
  PhoneIcon, WebsiteIcon, SoundcloudIcon, InstagramIcon, TiktokIcon,
  FacebookIcon, TwitchIcon, MessageIcon, CalendarIcon, CopyIcon,
  LocationPinIcon, ClaimAlertIcon,
} from './icons';

// Loosely-typed profile shape — vanilla queries select('*') so the row has
// all the columns Supabase returns. We declare the ones we ACTUALLY USE
// here so the rest of this component is type-safe. Other columns exist on
// the row in memory; we just don't access them.
export interface DjProfileData {
  id: string;
  name: string | null;
  slug: string | null;
  role: string;
  city: string | null;
  state: string | null;
  country: string | null;
  zip: string | null;
  dj_type: 'mobile' | 'club' | null;
  bio: string | null;
  avatar_url: string | null;
  avatar_position: string | null;
  rate: string | null;
  travel_distance: string | null;  // 'worldwide' or numeric miles as string
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  twitch: string | null;
  soundcloud: string | null;
  phone: string | null;
  dj_start_year: number | null;
  event_types: string | null;       // comma-separated string in vanilla
  club_genres: string[] | string | null;  // can be array or comma-separated
  profile_private: boolean | null;
  claimed: boolean | null;
  testimonials: string | null;      // JSON-stringified
  booking_settings: string | null;  // JSON-stringified — see bookingSettings.ts
  mix_url_1: string | null;
  mix_url_2: string | null;
  mix_url_3: string | null;
  gallery_img_1: string | null;
  gallery_img_2: string | null;
  gallery_img_3: string | null;
  gallery_img_4: string | null;
  video_url_1: string | null;
  video_url_2: string | null;
  video_url_3: string | null;
}

interface Testimonial {
  blurb?: string;
  name?: string;
  date?: string;
}

type TabKey = 'booking' | 'about' | 'mixes' | 'images' | 'video' | 'testimonials';

// Parse booking settings ONCE, outside the component (it's pure data) —
// but we need profile.dj_type and booking_settings, so it has to live inside.
// Done inline via parseBookingSettings near the top of the component below.

interface Props {
  data: DjProfileData;
  effectiveSlug: string;
  isLoggedIn: boolean;
  isOwnProfile: boolean;
}

export default function ProfileView({ data, effectiveSlug, isLoggedIn, isOwnProfile }: Props) {
  // ── Booking settings parsing & "show booking tab" decision ──────────
  // Vanilla shows a booking tab (and makes it the default) when the DJ has
  // booking_enabled — but the WIDGET inside that tab differs by DJ type:
  //   - Club DJ → Availability calendar (PublicCalendar) showing event dates
  //   - Mobile DJ → Booking calendar (MobilePublicCalendar) for direct booking
  // Tab labels also differ: "Availability" for club, "Booking" for mobile,
  // matching vanilla bookingTabBtn.textContent flips at line 707 of dj-profile.html.
  const bookingSettings = parseBookingSettings(data.booking_settings);
  const isClubDJ = data.dj_type === 'club';
  const isMobileDJBooking = data.dj_type === 'mobile';
  // Club DJ booking goes live publicly only when:
  //   1. booking_enabled is true (the toggle is on), AND
  //   2. an equipment option (full / decks / none) has been picked.
  // The DJ-side ClubBookingTab shows a banner when (1) is true but (2)
  // isn't, reminding them to complete activation. Until both are true,
  // the public profile hides the Book button / Availability tab entirely.
  const clubEquipPicked = !!(
    bookingSettings &&
    (bookingSettings.equip_full || bookingSettings.equip_decks || bookingSettings.equip_none)
  );
  const clubBookingLive = !!(bookingSettings && bookingSettings.booking_enabled) && clubEquipPicked;
  const mobileBookingLive = !!(bookingSettings && bookingSettings.booking_enabled);
  const bookingEnabled = isClubDJ ? clubBookingLive : mobileBookingLive;
  const showClubAvailabilityTab = isClubDJ && bookingEnabled;
  const showMobileBookingTab = isMobileDJBooking && bookingEnabled;
  const showBookingTab = showClubAvailabilityTab || showMobileBookingTab;

  // If the URL has ?date=YYYY-MM-DD (visitor came from the embed
  // calendar) AND we have a booking tab, force-default to it so the
  // auto-select logic in MobilePublicCalendar finds the right context.
  const searchParams = useSearchParams();
  const hasDateParam = !!searchParams.get('date');

  const [activeTab, setActiveTab] = useState<TabKey>(
    showBookingTab ? 'booking' : 'about'
  );
  // Club-booking flow — selectedDate drives the form, loginGateForDate
  // shows the login gate for unauthenticated visitors. Mirror of the
  // pattern in MobilePublicCalendar (which holds these internally).
  const { user: currentUser } = useAuth();
  const [clubSelectedDate, setClubSelectedDate] = useState<string | null>(null);
  const [clubLoginGateDate, setClubLoginGateDate] = useState<string | null>(null);
  // Compose-message modal — opened by the "Message" button in HeroActions.
  // For logged-out visitors we route them to /login first.
  const [composeOpen, setComposeOpen] = useState(false);
  // Avatar upload — owner-only. fileInputRef triggers the native file
  // picker; pickedAvatarFile holds the chosen File until AvatarCrop's
  // crop modal commits or cancels. On crop success we write the new
  // public URL to users.avatar_url and reload to refresh the hero.
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const [pickedAvatarFile, setPickedAvatarFile] = useState<File | null>(null);
  // If the URL has ?date= AND this is a club DJ profile AND visitor is
  // logged in, auto-open the booking form for that date. Mirrors the
  // MobilePublicCalendar behavior so embed-calendar links land on the
  // form regardless of DJ type.
  useEffect(() => {
    const dateParam = searchParams.get('date');
    if (!dateParam) return;
    if (!showClubAvailabilityTab) return;
    if (!isLoggedIn || !currentUser) return;
    setClubSelectedDate(dateParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, showClubAvailabilityTab, isLoggedIn, currentUser?.id]);
  // If the visitor lands with ?date=, also scroll the tab area into view
  // so they don't have to hunt for the booking calendar. Only fires once
  // on mount.
  useEffect(() => {
    if (hasDateParam && showBookingTab) {
      // Allow the tabs/calendar to render first, then scroll
      const t = setTimeout(() => {
        const el = document.querySelector(`[data-booking-anchor]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Set page title to the DJ's name (matches vanilla document.title)
  useEffect(() => {
    if (data.name) {
      document.title = `${data.name} - Global DJ Connect`;
    }
  }, [data.name]);

  // Lock body scroll while lightbox open (vanilla does this)
  useEffect(() => {
    if (lightboxSrc) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [lightboxSrc]);

  // ESC key closes lightbox (vanilla behavior)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxSrc(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ── Derive view state ─────────────────────────────────────────────────
  const typeClass =
    data.dj_type === 'club'   ? styles.heroAvatarClub :
    data.dj_type === 'mobile' ? styles.heroAvatarMobile :
                                styles.heroAvatarNone;

  const location = [data.city, data.state, data.country].filter(Boolean).join(', ');
  const yearsText = data.dj_start_year
    ? (() => {
        const yrs = new Date().getFullYear() - data.dj_start_year!;
        const isMobile = data.dj_type === 'mobile';
        if (isMobile) {
          return yrs <= 1 ? '1+ Year of Experience' : `${yrs}+ Years of Experience`;
        }
        return yrs <= 1 ? '1+ Year as a DJ' : `${yrs}+ Years as a DJ`;
      })()
    : null;

  // Hero tags — event types (mobile DJs only, as a popup) vs separate tags
  const isMobileDJ = data.dj_type === 'mobile';
  const eventTypes = data.event_types
    ? data.event_types.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const genres = data.club_genres
    ? (Array.isArray(data.club_genres)
        ? data.club_genres
        : String(data.club_genres).split(',')
      ).map(s => s.trim()).filter(Boolean)
    : [];

  // Mix URLs (1-3) and Gallery (1-4) and Video URLs (1-3) — vanilla pattern
  const mixUrls = [data.mix_url_1, data.mix_url_2, data.mix_url_3].filter((u): u is string => !!u);
  const galleryUrls = [data.gallery_img_1, data.gallery_img_2, data.gallery_img_3, data.gallery_img_4]
    .filter((u): u is string => !!u);
  const videoUrls = [data.video_url_1, data.video_url_2, data.video_url_3].filter((u): u is string => !!u);

  // Testimonials (JSON-stringified, mobile DJs only)
  let testimonials: Testimonial[] = [];
  if (isMobileDJ && data.testimonials) {
    try {
      const parsed = JSON.parse(data.testimonials) as Testimonial[];
      if (Array.isArray(parsed)) testimonials = parsed;
    } catch { /* invalid JSON — silently ignore, vanilla does the same */ }
  }
  const showTestimonialsTab = isMobileDJ && testimonials.length > 0;

  // Avatar URL with object-position support
  const avatarPos = data.avatar_position || '50% 50%';

  // ── Helper: tab button class ─────────────────────────────────────────
  function tabClass(key: TabKey): string {
    return `${styles.tabBtn} ${activeTab === key ? styles.tabBtnActive : ''}`;
  }
  function paneClass(key: TabKey): string {
    return `${styles.tabPane} ${activeTab === key ? styles.tabPaneActive : ''}`;
  }

  // ── Render hero name + badges block (used in both desktop and mobile slots) ──
  // Desktop: name + badges live in heroInfo
  // Mobile: name + badges live in heroNameCol (next to avatar in heroTopRow)
  // CSS media queries handle which one is visible.
  const heroBadgesEl = data.dj_type ? (
    <div className={styles.heroBadges}>
      <span
        className={`${styles.typeBadge} ${
          data.dj_type === 'club' ? styles.typeBadgeClub : styles.typeBadgeMobile
        }`}
      >
        {data.dj_type === 'club' ? '🎧 Club / Bar DJ' : '🎵 Mobile / Event DJ'}
      </span>
    </div>
  ) : null;

  return (
    <>
      {/* Claim bar — only shown for unclaimed/imported profiles */}
      {data.claimed === false && (
        <div className={styles.claimBar}>
          <ClaimAlertIcon />
          <p>
            Is this your business?{' '}
            <Link
              href={`/claim?name=${encodeURIComponent(data.name || '')}&slug=${encodeURIComponent(effectiveSlug)}`}
            >
              Claim this profile
            </Link>{' '}
            to manage your listing.
          </p>
        </div>
      )}

      <div>
        {/* HERO */}
        <div className={styles.hero}>
          {/* Top row contains avatar; on mobile via media query, name+badges
              get displayed alongside in heroNameCol */}
          <div className={styles.heroTopRow}>
            {/* Avatar wrapper — relative-positioned so the camera
                badge can sit on top of the avatar circle without being
                clipped by .heroAvatar's overflow:hidden. */}
            <div style={isOwnProfile ? { position: 'relative', flexShrink: 0 } : undefined}>
              <div className={`${styles.heroAvatar} ${typeClass}`}>
                {data.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={data.avatar_url}
                    alt={data.name || 'DJ'}
                    style={{ objectPosition: avatarPos, cursor: 'zoom-in' }}
                    onClick={() => setLightboxSrc(data.avatar_url!)}
                  />
                ) : (
                  initials(data.name)
                )}
              </div>
              {/* Owner-only camera badge — always visible, signals
                  that the avatar can be changed. Click opens the native
                  file picker; the chosen file flows through AvatarCrop
                  modal for crop+upload, then we write the URL to users
                  and reload. Sits outside the avatar's overflow:hidden
                  clip so it always shows fully. */}
              {isOwnProfile && (
                <>
                  <button
                    type="button"
                    onClick={() => avatarFileInputRef.current?.click()}
                    title={data.avatar_url ? 'Change profile picture' : 'Add profile picture'}
                    aria-label={data.avatar_url ? 'Change profile picture' : 'Add profile picture'}
                    style={{
                      position: 'absolute',
                      bottom: 6,
                      right: 6,
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      background: 'var(--neon)',
                      border: '2px solid #000',
                      color: '#000',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      padding: 0,
                      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.6)',
                      zIndex: 2,
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                  </button>
                  <input
                    ref={avatarFileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setPickedAvatarFile(file);
                    }}
                  />
                </>
              )}
            </div>
            {/* Mobile-only column: name + badges next to avatar */}
            <div className={styles.heroNameCol}>
              <div className={styles.heroName}>{data.name || 'Unknown DJ'}</div>
              {heroBadgesEl}
            </div>
          </div>

          {/* Hero info — name and badges visible on desktop, hidden on mobile
              via the descendant selector .heroInfo .heroName / .heroInfo .heroBadges
              inside the @media (max-width:900px) block in profile.module.css */}
          <div className={styles.heroInfo}>
            <div className={styles.heroName}>{data.name || 'Unknown DJ'}</div>
            {heroBadgesEl}
            <div className={styles.heroMobileDivider} />

            {location && (
              <div className={styles.heroLocation}>
                <LocationPinIcon /> {location}
              </div>
            )}
            {yearsText && (
              <div className={styles.heroYears} style={{ display: 'inline-flex' }}>
                {yearsText}
              </div>
            )}

            {/* Event types + genres as hero tags.
                Mobile DJs get ONE "Events Serviced ▾" badge that pops a list
                on click (vanilla dj-profile.html lines 572-583). Other DJ
                types get all event types as separate inline tags. Genres
                always render as separate pink tags. */}
            {(eventTypes.length > 0 || genres.length > 0) && (
              <div className={styles.heroTags}>
                {eventTypes.length > 0 && isMobileDJ && (
                  <EventsServicedBadge events={eventTypes} />
                )}
                {eventTypes.length > 0 && !isMobileDJ && (
                  eventTypes.map(e => (
                    <span
                      key={`event-${e}`}
                      className={`${styles.tag} ${styles.tagSmall} ${styles.tagSmallNeon}`}
                    >
                      {EVENT_TYPE_LABELS[e] || e}
                    </span>
                  ))
                )}
                {genres.map(g => (
                  <span
                    key={`genre-${g}`}
                    className={`${styles.tag} ${styles.tagSmall} ${styles.tagSmallPink}`}
                  >
                    {GENRE_LABELS[g] || g}
                  </span>
                ))}
              </div>
            )}

            {/* Hero action buttons — socials, contact, copy link */}
            <HeroActions
              data={data}
              effectiveSlug={effectiveSlug}
              isLoggedIn={isLoggedIn}
              isOwnProfile={isOwnProfile}
              onClickMessage={() => {
                // Owner can't message themselves; logged-out visitors are
                // sent to /login first, returning to the same profile.
                if (isOwnProfile) return;
                if (!isLoggedIn) {
                  window.location.href =
                    `/login?redirect=${encodeURIComponent(`/${effectiveSlug}`)}`;
                  return;
                }
                setComposeOpen(true);
              }}
            />
          </div>
        </div>

        {/* BODY */}
        <div className={styles.body}>
          {/* Tab nav */}
          <nav className={styles.tabsNav}>
            {showBookingTab && (
              <button
                className={tabClass('booking')}
                onClick={() => setActiveTab('booking')}
                type="button"
              >
                {showMobileBookingTab ? 'Booking' : 'Availability'}
              </button>
            )}
            <button className={tabClass('about')} onClick={() => setActiveTab('about')} type="button">
              About
            </button>
            <button className={tabClass('mixes')} onClick={() => setActiveTab('mixes')} type="button">
              Mixes
            </button>
            <button className={tabClass('images')} onClick={() => setActiveTab('images')} type="button">
              Photos
            </button>
            <button className={tabClass('video')} onClick={() => setActiveTab('video')} type="button">
              Video
            </button>
            {showTestimonialsTab && (
              <button
                className={tabClass('testimonials')}
                onClick={() => setActiveTab('testimonials')}
                type="button"
              >
                Testimonials
              </button>
            )}
          </nav>

          {/* Booking tab — different component for club vs mobile DJs */}
          {showClubAvailabilityTab && (
            <div className={paneClass('booking')} data-booking-anchor>
              <PublicCalendar
                bookingDays={bookingSettings!.booking_days || {}}
                bookingWindowMonths={bookingSettings!.booking_window_months || 12}
                bookingSettings={bookingSettings!}
                djId={data.id}
                djSlug={effectiveSlug}
                djName={data.name || ''}
                isLoggedIn={isLoggedIn}
                isOwnProfile={isOwnProfile}
                selectedDate={clubSelectedDate}
                onBookDate={(key) => setClubSelectedDate(key)}
                onLoggedOutBookAttempt={(key) => setClubLoginGateDate(key)}
              />
              {!isOwnProfile && clubSelectedDate && currentUser && (
                <ClubBookingForm
                  key={clubSelectedDate}
                  dateKey={clubSelectedDate}
                  dj={{
                    id: data.id,
                    name: data.name,
                    slug: effectiveSlug,
                  }}
                  bookingSettings={bookingSettings!}
                  currentUser={{
                    id: currentUser.id,
                    email: currentUser.email,
                    name: currentUser.name,
                  }}
                  onClose={() => setClubSelectedDate(null)}
                />
              )}
              {clubLoginGateDate !== null && (
                <BookingLoginGate
                  djName={data.name || ''}
                  djSlug={effectiveSlug}
                  dateKey={clubLoginGateDate}
                  onClose={() => setClubLoginGateDate(null)}
                />
              )}
            </div>
          )}
          {showMobileBookingTab && (
            <div className={paneClass('booking')} data-booking-anchor>
              <MobilePublicCalendar
                djId={data.id}
                djName={data.name || ''}
                djSlug={effectiveSlug}
                djEventTypes={data.event_types}
                djZip={data.zip}
                djTravelDistance={data.travel_distance}
                bookingSettings={bookingSettings!}
                isLoggedIn={isLoggedIn}
                isOwnProfile={isOwnProfile}
              />
            </div>
          )}

          {/* About tab */}
          <div className={paneClass('about')}>
            {isOwnProfile ? (
              <OwnerEditableBio userId={data.id} initialBio={data.bio} />
            ) : data.bio ? (
              <p className={styles.bioText}>{data.bio}</p>
            ) : (
              <p className={styles.tabEmpty}>Coming Soon</p>
            )}
            {data.rate && (
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <label>Rate</label>
                  <span>{data.rate}</span>
                </div>
              </div>
            )}
          </div>

          {/* Mixes tab */}
          <div className={paneClass('mixes')}>
            {mixUrls.length > 0 ? (
              <div className={styles.mediaList}>
                {mixUrls.map((url, i) => {
                  const embed = buildMixEmbed(url);
                  if (!embed) return null;
                  return (
                    <div key={i} className={styles.mediaEmbedWrap}>
                      <iframe
                        width="100%"
                        height={embed.height}
                        scrolling="no"
                        frameBorder="0"
                        allow="autoplay"
                        src={embed.src}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.tabEmpty}>
                {isOwnProfile ? (
                  <OwnerAddButton href="/update-dj-profile?tab=mixes" label="Add a mix" big />
                ) : 'Coming Soon'}
              </div>
            )}
          </div>

          {/* Photos tab */}
          <div className={paneClass('images')}>
            {galleryUrls.length > 0 ? (
              <div className={styles.imageGrid}>
                {galleryUrls.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={url}
                    alt="Gallery photo"
                    loading="lazy"
                    onClick={() => setLightboxSrc(url)}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.tabEmpty}>
                {isOwnProfile ? (
                  <OwnerAddButton href="/update-dj-profile?tab=photos" label="Add photos" big />
                ) : 'Coming Soon'}
              </div>
            )}
          </div>

          {/* Video tab */}
          <div className={paneClass('video')}>
            {videoUrls.length > 0 ? (
              <div className={styles.videoList}>
                {videoUrls.map((url, i) => {
                  const embed = buildVideoEmbed(url);
                  if (!embed) return null;
                  return (
                    <div key={i} className={styles.videoWrap}>
                      <iframe
                        src={embed.src}
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.tabEmpty}>
                {isOwnProfile ? (
                  <OwnerAddButton href="/update-dj-profile?tab=video" label="Add a video" big />
                ) : 'Coming Soon'}
              </div>
            )}
          </div>

          {/* Testimonials tab — mobile DJs only */}
          {showTestimonialsTab && (
            <div className={paneClass('testimonials')}>
              {testimonials.map((t, i) => (
                <div key={i} className={styles.testimonialItem}>
                  <div className={styles.testimonialBlurb}>{t.blurb || ''}</div>
                  <div className={styles.testimonialMeta}>
                    <span className={styles.testimonialName}>{t.name || ''}</span>
                    {t.date && (
                      <span className={styles.testimonialDate}>· {t.date}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox — full-screen image overlay */}
      <div
        className={`${styles.lightbox} ${lightboxSrc ? styles.lightboxActive : ''}`}
        onClick={() => setLightboxSrc(null)}
      >
        <button
          className={styles.lightboxClose}
          onClick={(e) => { e.stopPropagation(); setLightboxSrc(null); }}
          type="button"
          aria-label="Close"
        >
          ×
        </button>
        {lightboxSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lightboxSrc} alt="" onClick={(e) => e.stopPropagation()} />
        )}
      </div>

      {/* Compose-message modal — opened by the Message button in HeroActions.
          Only renders for logged-in non-owner visitors (see onClickMessage). */}
      {composeOpen && currentUser && !isOwnProfile && (
        <ComposeMessageModal
          sender={{
            id: currentUser.id,
            name: currentUser.name || 'A user',
            email: currentUser.email || null,
          }}
          recipientUserId={data.id}
          recipientName={data.name || 'this DJ'}
          onClose={() => setComposeOpen(false)}
        />
      )}

      {/* Avatar upload + crop modal — owner-only. Opens once the user
          has picked a file via the camera badge. AvatarCrop handles the
          crop UI + Supabase Storage upload at ${userId}/avatar.png and
          calls onSuccess with the public URL. We then write that URL
          to users.avatar_url and reload so the hero shows the new pic. */}
      {pickedAvatarFile && isOwnProfile && (
        <AvatarCrop
          file={pickedAvatarFile}
          userId={data.id}
          onClose={() => {
            setPickedAvatarFile(null);
            // Reset the input so picking the same file again still fires
            // onChange (browsers skip duplicate file selections).
            if (avatarFileInputRef.current) avatarFileInputRef.current.value = '';
          }}
          onSuccess={async (publicUrl) => {
            try {
              const supabase = createClient();
              await supabase
                .from('users')
                .update({ avatar_url: publicUrl } as unknown as never)
                .eq('id', data.id);
            } catch {
              // Non-blocking; the upload succeeded even if the row update
              // failed. User can retry.
            }
            setPickedAvatarFile(null);
            if (avatarFileInputRef.current) avatarFileInputRef.current.value = '';
            window.location.reload();
          }}
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// EventsServicedBadge — mobile DJs only.
// One clickable tag pill ("Events Serviced ▾") that toggles a popup listing
// the actual event types. Faithful port of vanilla dj-profile.html lines
// 572-583 (markup) + 2327-2337 (toggle + outside-click logic).
// ──────────────────────────────────────────────────────────────────────────

function EventsServicedBadge({ events }: { events: string[] }) {
  const [open, setOpen] = useState(false);

  // Click anywhere outside the badge → close. Vanilla attaches a global
  // document listener; we do the same with a capture-phase check on whether
  // the click target is inside our badge wrapper.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Allow clicks inside the badge to bubble through the badge's own
      // onClick (which toggles); only close if the click was outside.
      if (!target.closest('[data-events-serviced-badge]')) {
        setOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  return (
    <span
      data-events-serviced-badge
      className={`${styles.tag} ${styles.tagSmall} ${styles.tagSmallNeon} ${styles.eventsBadge}`}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(o => !o);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen(o => !o);
        }
      }}
    >
      Events Serviced ▾
      {open && (
        <div className={styles.eventsPopup}>
          {events.map(ev => (
            <div key={ev} className={styles.eventsPopupItem}>
              {EVENT_TYPE_LABELS[ev] || ev}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// HeroActions — buttons row in the hero (socials + Copy Link).
// Logged-out users see the phone button as a "View Phone" gate placeholder
// to match vanilla — the actual gate modal is wired up in a later session.
// For Session 1 it's just disabled with a tooltip.
// ──────────────────────────────────────────────────────────────────────────

function HeroActions({
  data,
  effectiveSlug,
  isLoggedIn,
  isOwnProfile,
  onClickMessage,
}: {
  data: DjProfileData;
  effectiveSlug: string;
  isLoggedIn: boolean;
  isOwnProfile: boolean;
  onClickMessage: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // Tracks which SocialAddButton (if any) is expanded. Lifted here so
  // opening one auto-closes any other that was open — only one inline
  // social-add input can be active at a time across the row.
  const [openSocialField, setOpenSocialField] = useState<string | null>(null);

  // Build the canonical share URL. Vanilla uses window.location.origin + '/' + slug.
  // We do that on click since it needs the runtime origin.
  function copyShareUrl() {
    const url = `${window.location.origin}/${effectiveSlug}`;
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        /* clipboard write failed — silently ignore */
      },
    );
  }

  // Normalize social URLs the way vanilla does (handle "@username" inputs)
  function normalizedWebsite(s: string): string {
    return s.startsWith('http') ? s : 'https://' + s.replace('@', '');
  }
  function normalizedSoundcloud(s: string): string {
    return s.startsWith('http') ? s : 'https://soundcloud.com/' + s.replace('@', '');
  }
  function normalizedFacebook(s: string): string {
    return s.startsWith('http') ? s : 'https://facebook.com/' + s.replace('@', '');
  }
  function normalizedTwitch(s: string): string {
    return s.startsWith('http') ? s : 'https://twitch.tv/' + s.replace('@', '');
  }
  // Instagram + TikTok previously assumed the field was always a bare
  // username and always prepended the domain — a DJ pasting a full
  // URL would end up with "https://instagram.com/https://..." which
  // doesn't work. These now check for an existing http prefix first
  // and only build the URL when given a bare handle.
  function normalizedInstagram(s: string): string {
    return s.startsWith('http') ? s : 'https://instagram.com/' + s.replace('@', '');
  }
  function normalizedTiktok(s: string): string {
    return s.startsWith('http') ? s : 'https://tiktok.com/@' + s.replace('@', '');
  }

  return (
    <div className={styles.heroActions}>
      {/* Phone — different behavior for logged-in vs logged-out (vanilla parity).
          Logged-out users see a button that would open a gate modal (TBD next session) */}
      {data.phone && (
        isLoggedIn ? (
          <a
            href={`tel:${data.phone}`}
            className={`${styles.actionBtn} ${styles.actionBtnPhone}`}
            title={data.phone}
          >
            <PhoneIcon />
          </a>
        ) : (
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionBtnPhone}`}
            title="View Phone"
            disabled
          >
            <PhoneIcon />
          </button>
        )
      )}

      {/* Social platforms — filled links render FIRST in declared
          platform order. After all filled links, the owner-only "+"
          add-buttons for missing platforms render to the right so the
          hero reads "active socials | quick-adds" instead of mixed. */}
      {data.website && (
        <a
          href={normalizedWebsite(data.website)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.actionBtn} ${styles.actionBtnWebsite}`}
          title="Website"
        >
          <WebsiteIcon />
        </a>
      )}
      {data.soundcloud && (
        <a
          href={normalizedSoundcloud(data.soundcloud)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.actionBtn} ${styles.actionBtnSoundcloud}`}
          title="SoundCloud"
        >
          <SoundcloudIcon />
        </a>
      )}
      {data.instagram && (
        <a
          href={normalizedInstagram(data.instagram)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.actionBtn} ${styles.actionBtnInstagram}`}
          title="Instagram"
        >
          <InstagramIcon />
        </a>
      )}
      {data.tiktok && (
        <a
          href={normalizedTiktok(data.tiktok)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.actionBtn} ${styles.actionBtnTiktok}`}
          title="TikTok"
        >
          <TiktokIcon />
        </a>
      )}
      {data.facebook && (
        <a
          href={normalizedFacebook(data.facebook)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.actionBtn} ${styles.actionBtnFacebook}`}
          title="Facebook"
        >
          <FacebookIcon />
        </a>
      )}
      {data.twitch && (
        <a
          href={normalizedTwitch(data.twitch)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.actionBtn} ${styles.actionBtnTwitch}`}
          title="Twitch"
        >
          <TwitchIcon />
        </a>
      )}

      {/* Owner-only quick-add buttons for platforms not yet filled. */}
      {isOwnProfile && !data.website && (
        <SocialAddButton
          userId={data.id}
          field="website"
          label="Website"
          placeholder="https://yoursite.com"
          icon={<WebsiteIcon />}
          colorClass={styles.actionBtnWebsite}
        openField={openSocialField}
        setOpenField={setOpenSocialField}
        />
      )}
      {isOwnProfile && !data.soundcloud && (
        <SocialAddButton
          userId={data.id}
          field="soundcloud"
          label="SoundCloud"
          placeholder="https://soundcloud.com/yourname"
          icon={<SoundcloudIcon />}
          colorClass={styles.actionBtnSoundcloud}
        openField={openSocialField}
        setOpenField={setOpenSocialField}
        />
      )}
      {isOwnProfile && !data.instagram && (
        <SocialAddButton
          userId={data.id}
          field="instagram"
          label="Instagram"
          placeholder="@djyourname"
          icon={<InstagramIcon />}
          colorClass={styles.actionBtnInstagram}
        openField={openSocialField}
        setOpenField={setOpenSocialField}
        />
      )}
      {isOwnProfile && !data.tiktok && (
        <SocialAddButton
          userId={data.id}
          field="tiktok"
          label="TikTok"
          placeholder="@djyourname"
          icon={<TiktokIcon />}
          colorClass={styles.actionBtnTiktok}
        openField={openSocialField}
        setOpenField={setOpenSocialField}
        />
      )}
      {isOwnProfile && !data.facebook && (
        <SocialAddButton
          userId={data.id}
          field="facebook"
          label="Facebook"
          placeholder="https://facebook.com/yourpage"
          icon={<FacebookIcon />}
          colorClass={styles.actionBtnFacebook}
        openField={openSocialField}
        setOpenField={setOpenSocialField}
        />
      )}
      {isOwnProfile && !data.twitch && (
        <SocialAddButton
          userId={data.id}
          field="twitch"
          label="Twitch"
          placeholder="https://twitch.tv/yourname"
          icon={<TwitchIcon />}
          colorClass={styles.actionBtnTwitch}
        openField={openSocialField}
        setOpenField={setOpenSocialField}
        />
      )}

      {data.rate && (
        <span
          className={`${styles.actionBtn} ${styles.actionBtnRate}`}
        >
          💰 {data.rate}
        </span>
      )}

      {/* Copy Link button — vanilla-style ghost button */}
      <button
        type="button"
        className={`${styles.actionBtn} ${styles.actionBtnGhost}`}
        title={copied ? 'Copied!' : 'Copy Link'}
        onClick={copyShareUrl}
      >
        <CopyIcon />
      </button>

      {/* Message button — opens ComposeMessageModal. Hidden on the owner's
          own profile (you can't message yourself). For logged-out visitors,
          the parent's onClickMessage handler routes them to /login first. */}
      {!isOwnProfile && (
        <button
          type="button"
          className={styles.actionBtn}
          onClick={onClickMessage}
          title={`Message ${data.name || 'this DJ'}`}
        >
          <MessageIcon />
        </button>
      )}

      {/* Calendar icon kept hidden for now — the booking calendar lives in
          the tabs below, not in the hero. Keeping the import wired so we
          can add it back later without re-importing. */}
      <span style={{ display: 'none' }}>
        <CalendarIcon />
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// OwnerAddButton — quick-add link shown to the profile owner inside the
// Mixes / Photos / Video tabs when the tab is empty. Big centered "+"
// in the middle of the tab area. Routes to update-dj-profile?tab=… so
// they can add new media. Once any media exists the button disappears
// (owner manages additions from update-dj-profile).
// ─────────────────────────────────────────────────────────────────────────
function OwnerAddButton({ href, label, big }: { href: string; label: string; big?: boolean }) {
  // Only the big variant is used now — kept the prop signature so the
  // call sites don't need to change. label is used as the title/aria.
  void big;
  return (
    <a
      href={href}
      title={label}
      aria-label={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 96,
        height: 96,
        margin: '2.5rem auto',
        background: 'rgba(0, 245, 196, .08)',
        border: '2px solid var(--neon)',
        borderRadius: '50%',
        color: 'var(--neon)',
        textDecoration: 'none',
        fontSize: '3rem',
        lineHeight: 1,
        fontWeight: 300,
        transition: 'transform .15s ease, background .15s ease',
      }}
    >
      +
    </a>
  );
}


// ─────────────────────────────────────────────────────────────────────────
// SocialAddButton — owner-only quick add for a single social platform.
// Renders in the same hero action slot a normal social link would, but
// in placeholder form: the platform's icon with a subtle dashed border
// and a small "+" badge. Click expands an inline input row right after
// the button; DJ pastes their URL or handle, hits Add, save writes to
// public.users for that one field. On success we reload so the placeholder
// is replaced by the real link button (with the colored hover state).
//
// Handle vs. URL paste is handled downstream by the existing normalized*
// functions in HeroActions — we just save what the DJ types.
// ─────────────────────────────────────────────────────────────────────────
function SocialAddButton({
  userId,
  field,
  label,
  placeholder,
  icon,
  colorClass,
  openField,
  setOpenField,
}: {
  userId: string;
  field: 'website' | 'soundcloud' | 'instagram' | 'tiktok' | 'facebook' | 'twitch';
  label: string;
  placeholder: string;
  icon: React.ReactNode;
  colorClass: string;
  // Lifted state — only one SocialAddButton can be expanded at a time.
  // Each button reads openField to know if IT is the open one, and
  // calls setOpenField(field) on click / setOpenField(null) on close.
  openField: string | null;
  setOpenField: (field: string | null) => void;
}) {
  const expanded = openField === field;
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the parent closes us (because another button got opened), reset
  // local input state so we don't show stale text on next open.
  useEffect(() => {
    if (!expanded) {
      setValue('');
      setError(null);
    }
  }, [expanded]);

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Enter something first.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: dbError } = await supabase
        .from('users')
        .update({ [field]: trimmed } as unknown as never)
        .eq('id', userId);
      if (dbError) throw dbError;
      // Reload so HeroActions re-renders with the live link button in
      // place of this add button. Server-loaded props don't update
      // otherwise.
      window.location.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save.';
      setError(msg);
      setSaving(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      setOpenField(null);
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setOpenField(field)}
        title={`Add ${label}`}
        aria-label={`Add ${label}`}
        className={`${styles.actionBtn} ${colorClass}`}
        style={{
          // Faded + dashed-border look so it reads as "add me", not "active link".
          opacity: 0.55,
          borderStyle: 'dashed',
          position: 'relative',
        }}
      >
        {icon}
        {/* Tiny "+" badge in the corner so the affordance reads as add. */}
        <span style={{
          position: 'absolute',
          top: -4,
          right: -4,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: 'var(--neon)',
          color: '#000',
          fontSize: '0.7rem',
          fontWeight: 700,
          lineHeight: '16px',
          textAlign: 'center',
          pointerEvents: 'none',
        }}>+</span>
      </button>
    );
  }

  return (
    // Outer wrapper — owns the line break behavior. flex-basis: 100%
    // forces this child to wrap onto its own row inside the heroActions
    // flex container. The actual styled panel lives inside, constrained
    // and left-aligned, so it doesn't sprawl across the whole hero.
    <div style={{
      flexBasis: '100%',
      order: 999,
      marginTop: '.5rem',
    }}>
      <div style={{
        maxWidth: 460,
        display: 'flex',
        alignItems: 'center',
        gap: '.5rem',
        padding: '.5rem .6rem',
        background: 'rgba(0, 245, 196, .08)',
        border: '1px solid var(--neon)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0, 245, 196, .12)',
      }}>
      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
        onKeyDown={handleKey}
        placeholder={placeholder}
        disabled={saving}
        style={{
          flex: 1,
          minWidth: 0,
          padding: '.5rem .7rem',
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid var(--border, rgba(255,255,255,0.15))',
          borderRadius: 4,
          color: 'var(--white, #fff)',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: '.78rem',
        }}
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        title={`Add ${label}`}
        style={{
          padding: '.35rem .65rem',
          background: 'var(--neon)',
          border: 'none',
          borderRadius: 4,
          color: '#000',
          fontFamily: "'Space Mono', monospace",
          fontSize: '.65rem',
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          fontWeight: 700,
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? '…' : 'Add'}
      </button>
      <button
        type="button"
        onClick={() => setOpenField(null)}
        disabled={saving}
        title="Cancel"
        aria-label="Cancel"
        style={{
          padding: '.25rem .4rem',
          background: 'transparent',
          border: 'none',
          color: 'var(--muted, #888)',
          cursor: saving ? 'not-allowed' : 'pointer',
          fontSize: '1rem',
          lineHeight: 1,
        }}
      >
        ✕
      </button>
      {error && (
        <span style={{
          color: '#ff5f5f',
          fontSize: '.7rem',
          fontFamily: 'DM Sans, sans-serif',
          marginLeft: '.25rem',
        }}>
          {error}
        </span>
      )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// OwnerEditableBio — inline About editor shown on the profile owner's
// own profile. Default state: shows the bio text (or a "Click to add"
// hint if empty). Click → switches to a textarea with Save / Cancel.
// Save writes to public.users.bio and updates local state so the new
// text shows immediately. No reload needed.
// ─────────────────────────────────────────────────────────────────────────
function OwnerEditableBio({ userId, initialBio }: { userId: string; initialBio: string | null }) {
  const [bio, setBio] = useState<string>(initialBio || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(initialBio || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraft(bio);
    setError(null);
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setError(null);
  }
  async function save() {
    setError(null);
    setSaving(true);
    try {
      const supabase = createClient();
      const trimmed = draft.trim();
      const { error: dbError } = await supabase
        .from('users')
        .update({ bio: trimmed || null } as unknown as never)
        .eq('id', userId);
      if (dbError) throw dbError;
      setBio(trimmed);
      setEditing(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tell people about yourself, your sound, your style…"
          disabled={saving}
          rows={6}
          style={{
            width: '100%',
            padding: '.75rem',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid var(--neon)',
            borderRadius: 6,
            color: 'var(--white, #fff)',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: '.95rem',
            lineHeight: 1.6,
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem' }}>
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            style={{
              padding: '.5rem .9rem',
              background: 'transparent',
              border: '1px solid var(--border, rgba(255,255,255,0.2))',
              borderRadius: 6,
              color: 'var(--muted, #888)',
              fontFamily: "'Space Mono', monospace",
              fontSize: '.7rem',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{
              padding: '.5rem 1rem',
              background: 'var(--neon)',
              border: 'none',
              borderRadius: 6,
              color: '#000',
              fontFamily: "'Space Mono', monospace",
              fontSize: '.7rem',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {error && (
          <div style={{
            padding: '.5rem .7rem',
            background: 'rgba(255, 95, 95, .08)',
            border: '1px solid rgba(255, 95, 95, .35)',
            borderRadius: 6,
            color: '#ff5f5f',
            fontSize: '.78rem',
          }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // View mode — clickable surface that switches to edit on click. When
  // empty, shows a small centered text cue. When populated, shows the
  // bio text with a small "Click to edit" hint underneath.
  return (
    <div
      onClick={startEdit}
      style={{
        cursor: 'pointer',
        padding: 0,
        borderRadius: 6,
      }}
    >
      {bio ? (
        <>
          <p style={{
            margin: 0,
            color: 'var(--white, #fff)',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: '.95rem',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}>
            {bio}
          </p>
          <div style={{
            marginTop: '.5rem',
            color: 'var(--neon)',
            fontFamily: "'Space Mono', monospace",
            fontSize: '.65rem',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            opacity: 0.7,
          }}>
            ✏ Click to edit
          </div>
        </>
      ) : (
        <div style={{
          textAlign: 'center',
          padding: '.5rem 0',
        }}>
          <span style={{
            display: 'inline-block',
            color: 'var(--neon)',
            fontFamily: "'Space Mono', monospace",
            fontSize: '.7rem',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            padding: '.4rem .8rem',
            border: '1px dashed var(--neon)',
            borderRadius: 6,
          }}>
            + Click to add your bio
          </span>
        </div>
      )}
    </div>
  );
}
