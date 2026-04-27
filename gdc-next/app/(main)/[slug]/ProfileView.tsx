'use client';

// ProfileView — Client Component for the interactive parts of a DJ profile:
//   - Tab switching (About / Mixes / Photos / Video / Testimonials)
//   - Lightbox open/close for gallery images and avatar
// Server Component (page.tsx) does the data fetch and passes everything in.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './profile.module.css';
import { EVENT_TYPE_LABELS, GENRE_LABELS, initials } from './constants';
import { buildMixEmbed, buildVideoEmbed } from './embeds';
import { parseBookingSettings } from './bookingSettings';
import PublicCalendar from './PublicCalendar';
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
  dj_type: 'mobile' | 'club' | null;
  bio: string | null;
  avatar_url: string | null;
  avatar_position: string | null;
  rate: string | null;
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
}

export default function ProfileView({ data, effectiveSlug, isLoggedIn }: Props) {
  // ── Booking settings parsing & "show calendar tab" decision ──────────
  // Vanilla shows the Availability tab (and makes it the default) ONLY for
  // CLUB DJs whose booking_settings has booking_enabled=true. Mobile DJs
  // also show a booking tab in vanilla but with a totally different widget
  // (mobile booking flow, deferred to a later session). For now we treat
  // mobile-DJ booking as "tab not yet enabled" and show their About tab
  // by default — same UX as a club DJ without booking enabled.
  const bookingSettings = parseBookingSettings(data.booking_settings);
  const isClubDJ = data.dj_type === 'club';
  const showAvailabilityTab = !!(
    isClubDJ &&
    bookingSettings &&
    bookingSettings.booking_enabled
  );

  const [activeTab, setActiveTab] = useState<TabKey>(
    showAvailabilityTab ? 'booking' : 'about'
  );
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
            <HeroActions data={data} effectiveSlug={effectiveSlug} isLoggedIn={isLoggedIn} />
          </div>
        </div>

        {/* BODY */}
        <div className={styles.body}>
          {/* Tab nav */}
          <nav className={styles.tabsNav}>
            {showAvailabilityTab && (
              <button
                className={tabClass('booking')}
                onClick={() => setActiveTab('booking')}
                type="button"
              >
                Availability
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

          {/* Availability tab — public booking calendar */}
          {showAvailabilityTab && (
            <div className={paneClass('booking')}>
              <PublicCalendar
                bookingDays={bookingSettings!.booking_days || {}}
                bookingWindowMonths={bookingSettings!.booking_window_months || 12}
                djSlug={effectiveSlug}
                djName={data.name || ''}
                isLoggedIn={isLoggedIn}
              />
            </div>
          )}

          {/* About tab */}
          <div className={paneClass('about')}>
            {data.bio ? (
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
              <p className={styles.tabEmpty}>Coming Soon</p>
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
              <p className={styles.tabEmpty}>Coming Soon</p>
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
              <p className={styles.tabEmpty}>Coming Soon</p>
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
}: {
  data: DjProfileData;
  effectiveSlug: string;
  isLoggedIn: boolean;
}) {
  const [copied, setCopied] = useState(false);

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
          href={`https://instagram.com/${data.instagram.replace('@', '')}`}
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
          href={`https://tiktok.com/@${data.tiktok.replace('@', '')}`}
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

      {/* Note: Message Me + Book Now buttons would go here in vanilla.
          Both depend on systems we haven't built yet (contact modal,
          booking calendar) — adding them in Sessions 2 + 3.
          The CalendarIcon / MessageIcon imports stay so we can add them
          back without re-importing. */}
      <span style={{ display: 'none' }}>
        <CalendarIcon />
        <MessageIcon />
      </span>
    </div>
  );
}
