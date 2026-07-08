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
import { parseBookingSettings, packageTiers, isSaleActive } from './bookingSettings';
import PublicCalendar from './PublicCalendar';
import MobilePublicCalendar from './MobilePublicCalendar';
import ClubBookingForm from './ClubBookingForm';
import BookingLoginGate from './BookingLoginGate';
import ComposeMessageModal from '@/components/ComposeMessageModal';
import { useConfirm } from '@/components/ConfirmModal';
import { createClient } from '@/lib/supabase/client';
import AvatarCrop from '../update-dj-profile/AvatarCrop';
import {
  LocationPinIcon, ClaimAlertIcon,
} from './icons';


// Shared profile types now live in ./profileTypes. Re-export DjProfileData
// so existing importers (e.g. page.tsx) keep working unchanged.
import type { DjProfileData, Testimonial, TabKey } from './profileTypes';
export type { DjProfileData };
// Extracted sub-components (banner pills, hero actions, owner editors, modals).
import {
  BannerTypeEventsDropdown, HeroActions, OwnerEditableBio, MediaAddButton,
  VideoMetaEditor, ExpandableDesc, PhotoManagerModal, EmbedCalendarModal,
  BannerEditModal, EditTabsModal, TestimonialAddForm, ShareCalendarModal,
  UnderBannerSocials,
} from './ProfileComponents';
import { validateImageFile } from './profilePhotoUtils';

// Parse booking settings ONCE, outside the component (it's pure data) —
// but we need profile.dj_type and booking_settings, so it has to live inside.
// Done inline via parseBookingSettings near the top of the component below.

interface Props {
  data: DjProfileData;
  effectiveSlug: string;
  isLoggedIn: boolean;
  isOwnProfile: boolean;
  // Paywall: true when the DJ has an active subscription/comp (Tier 1+).
  // ANDed with the existing enabled + completeness checks below.
  hasBookingAccess: boolean;
}

export default function ProfileView({ data, effectiveSlug, isLoggedIn, isOwnProfile, hasBookingAccess }: Props) {
  // ── Booking settings parsing & "show booking tab" decision ──────────
  // Vanilla shows a booking tab (and makes it the default) when the DJ has
  // booking_enabled — but the WIDGET inside that tab differs by DJ type:
  //   - Club DJ → Availability calendar (PublicCalendar) showing event dates
  //   - Mobile DJ → Booking calendar (MobilePublicCalendar) for direct booking
  // Tab labels also differ: "Availability" for club, "Booking" for mobile,
  // matching vanilla bookingTabBtn.textContent flips at line 707 of dj-profile.html.
  const bookingSettings = parseBookingSettings(data.booking_settings);
  // Site-wide sale badge — shown on the public profile when the DJ has an
  // active sale (and booking is live for them).
  const saleActive = hasBookingAccess && isSaleActive(bookingSettings?.sale);
  const salePercent = bookingSettings?.sale?.percent;
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
  // Mobile completeness: at least one package that's actually bookable —
  // has a title and either valid price tiers or "price on request" (reqAll).
  const mobileSetupComplete = !!(
    bookingSettings &&
    bookingSettings.mob_packages &&
    Object.values(bookingSettings.mob_packages).some(
      (arr) =>
        Array.isArray(arr) &&
        arr.some(
          (pkg) =>
            !!pkg &&
            !!(pkg.title && String(pkg.title).trim()) &&
            (pkg.reqAll === true || packageTiers(pkg).length > 0)
        )
    )
  );
  const clubBookingLive = hasBookingAccess && clubEquipPicked;
  const mobileBookingLive = hasBookingAccess && mobileSetupComplete;
  const bookingEnabled = isClubDJ ? clubBookingLive : mobileBookingLive;
  const showClubAvailabilityTab = isClubDJ && bookingEnabled;
  const showMobileBookingTab = isMobileDJBooking && bookingEnabled;
  const showBookingTab = showClubAvailabilityTab || showMobileBookingTab;

  // If the URL has ?date=YYYY-MM-DD (visitor came from the embed
  // calendar) AND we have a booking tab, force-default to it so the
  // auto-select logic in MobilePublicCalendar finds the right context.
  const searchParams = useSearchParams();
  const hasDateParam = !!searchParams.get('date');

  // Active tab — defaults to booking (if visible) else about. Can be
  // deep-linked via ?tab= so a reload (e.g. after adding a mix or video
  // inline) lands back on the same tab. Validates against TabKey list.
  const tabFromUrl = (() => {
    const t = searchParams.get('tab') || '';
    const valid: TabKey[] = ['booking', 'about', 'mixes', 'images', 'video', 'testimonials'];
    return (valid as string[]).includes(t) ? (t as TabKey) : null;
  })();
  const [activeTab, setActiveTab] = useState<TabKey>(
    tabFromUrl || (showBookingTab ? 'booking' : 'about')
  );
  // Club-booking flow — selectedDate drives the form, loginGateForDate
  // shows the login gate for unauthenticated visitors. Mirror of the
  // pattern in MobilePublicCalendar (which holds these internally).
  const { user: currentUser } = useAuth();
  // Gate for actions that require a verified email (booking, messaging).
  // Returns true if the action may proceed. Logged-out users are sent to
  // login; logged-in-but-unverified users are blocked with a prompt that
  // points them at the persistent verify banner (which has Resend).
  // `redirectAfterLogin` is the path to return to after logging in.
  function requireVerified(redirectAfterLogin: string): boolean {
    if (!isLoggedIn || !currentUser) {
      window.location.href = `/login?redirect=${encodeURIComponent(redirectAfterLogin)}`;
      return false;
    }
    if (!currentUser.email_verified) {
      alert(
        'Please verify your email to continue. Use the "Resend Email" link in the banner at the top of the page, then click the link we send you.'
      );
      return false;
    }
    return true;
  }
  const [clubSelectedDate, setClubSelectedDate] = useState<string | null>(null);
  const [clubLoginGateDate, setClubLoginGateDate] = useState<string | null>(null);
  // ── Pending bookings for the logged-in viewer with THIS DJ.
  // We show "Pending" on the calendar (instead of "Book") for dates the
  // current viewer already has a pending request on — only they see this;
  // the date stays available for everyone else. Refetched whenever the
  // viewer submits a new request via clubPendingRefreshKey. ───────────
  const [clubPendingDates, setClubPendingDates] = useState<Set<string>>(new Set());
  const [clubPendingRefreshKey, setClubPendingRefreshKey] = useState(0);
  useEffect(() => {
    if (!currentUser?.id || !data.id) {
      setClubPendingDates(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: rows } = await supabase
        .from('bookings')
        .select('event_date')
        .eq('dj_id', data.id)
        .eq('requester_id', currentUser.id)
        .eq('status', 'pending');
      if (cancelled) return;
      const set = new Set<string>();
      (rows as { event_date: string | null }[] | null)?.forEach((r) => {
        if (r.event_date) set.add(r.event_date);
      });
      setClubPendingDates(set);
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id, data.id, clubPendingRefreshKey]);
  // Compose-message modal — opened by the "Message" button in HeroActions.
  // For logged-out visitors we route them to /login first.
  const [composeOpen, setComposeOpen] = useState(false);
  // Avatar upload — owner-only. fileInputRef triggers the native file
  // picker; pickedAvatarFile holds the chosen File until AvatarCrop's
  // crop modal commits or cancels. On crop success we write the new
  // public URL to users.avatar_url and reload to refresh the hero.
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const [pickedAvatarFile, setPickedAvatarFile] = useState<File | null>(null);
  // Banner edit — owner-only. Opens a dedicated modal where the DJ
  // can upload/replace the banner image and reposition it vertically.
  // All upload + position logic lives inside BannerEditModal.
  const [bannerModalOpen, setBannerModalOpen] = useState(false);
  // Edit-tabs — owner-only modal to toggle which tabs are visible to
  // the public. Booking tab is NOT toggled here (use booking settings).
  const [tabsModalOpen, setTabsModalOpen] = useState(false);
  // Share-calendar — visible to all visitors. Opens a modal with two
  // preview cards (month view + 12-month view), each with a copyable URL.
  const [shareModalOpen, setShareModalOpen] = useState(false);
  // Counter that bumps to force the PublicCalendar/MobilePublicCalendar
  // into 12-month rolling mode (used by the Book Now banner button).
  const [forceCalendar12mo, setForceCalendar12mo] = useState(0);
  // Photo manager modal — opens from the + button in the Photos tab.
  // Shows all 4 slots so DJ can upload to / remove from each independently.
  const [photoManagerOpen, setPhotoManagerOpen] = useState(false);
  // Embed-calendar modal — owner-only shortcut on the profile so the DJ
  // can grab their iframe embed snippet without leaving for update-dj-profile.
  // Triggered by the "Embed Calendar" button above the calendar in the
  // Booking/Availability tab.
  const [embedModalOpen, setEmbedModalOpen] = useState(false);

  // Confirm modal — used for owner delete-video confirmation. Returns
  // a confirm() promise + a confirmDialog JSX element to render once.
  const { confirm, confirmDialog } = useConfirm();

  // Delete a video — clears url/title/desc for the given slot and
  // reloads on the same tab. Owner-only; called from the X button on
  // each framed video card.
  async function deleteVideo(slot: 1 | 2 | 3) {
    const ok = await confirm({
      title: 'Delete this video?',
      message: 'This removes the video from your profile. You can add it back any time.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const supabase = createClient();
      await supabase
        .from('users')
        .update({
          [`video_url_${slot}`]: null,
          [`video_title_${slot}`]: null,
          [`video_desc_${slot}`]: null,
        } as unknown as never)
        .eq('id', data.id);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'video');
      window.location.href = url.toString();
    } catch {
      // Best-effort; user can retry.
    }
  }

  // Delete a photo — clears gallery_img_N for the given slot and
  // reloads on the Photos tab. Owner-only; called from X button on
  // each gallery image.
  async function deletePhoto(slot: 1 | 2 | 3 | 4) {
    const ok = await confirm({
      title: 'Delete this photo?',
      message: 'This removes the photo from your profile gallery.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const supabase = createClient();
      await supabase
        .from('users')
        .update({ [`gallery_img_${slot}`]: null } as unknown as never)
        .eq('id', data.id);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'images');
      window.location.href = url.toString();
    } catch {
      // Best-effort
    }
  }

  // Delete a mix — clears mix_url_N for the given slot and reloads on
  // the Mixes tab. Owner-only; called from X button on each mix embed.
  async function deleteMix(slot: 1 | 2 | 3) {
    const ok = await confirm({
      title: 'Delete this mix?',
      message: 'This removes the mix from your profile. You can add it back any time.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const supabase = createClient();
      await supabase
        .from('users')
        .update({ [`mix_url_${slot}`]: null } as unknown as never)
        .eq('id', data.id);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'mixes');
      window.location.href = url.toString();
    } catch {
      // Best-effort
    }
  }
  // If the URL has ?date= AND this is a club DJ profile AND visitor is
  // logged in, auto-open the booking form for that date. Mirrors the
  // MobilePublicCalendar behavior so embed-calendar links land on the
  // form regardless of DJ type.
  // When the visitor arrives with ?date= (typically from the embed
  // calendar), pre-select that date on the calendar. We do this for
  // EVERYONE (logged-in or out) so the calendar navigates to the right
  // month and the day is highlighted. The booking form itself still
  // requires being logged-in + verified, gated below at render time;
  // a logged-out visitor sees the highlighted day and clicks BOOK on
  // it to trigger the login gate.
  useEffect(() => {
    const dateParam = searchParams.get('date');
    if (!dateParam) return;
    if (!showClubAvailabilityTab) return;
    setClubSelectedDate(dateParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, showClubAvailabilityTab]);
  // Logged-OUT visitor arriving from the embed with ?date= used to have
  // the login gate auto-open here. That's been removed by design — we now
  // want them to land on the DJ's profile and see the calendar first; the
  // gate fires only when they click BOOK on the day themselves. The date
  // param is still honored: PublicCalendar reads `selectedDate` and jumps
  // the visible month to it (see the month-jump effect there).
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

  const location = (() => {
    const parts = [data.city, data.state, data.country].filter(Boolean) as string[];
    // Abbreviate verbose country names for display.
    const COUNTRY_ABBR: Record<string, string> = {
      'United States': 'USA',
      'United States of America': 'USA',
      'United Kingdom': 'UK',
    };
    return parts
      .map(p => COUNTRY_ABBR[p] || p)
      .join(', ');
  })();
  // Years-of-experience pill removed — no longer shown on profiles.

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
  // Slot-aware mix entries — needed so the owner delete X targets the
  // right mix_url_N column even after earlier slots are emptied.
  const mixEntries = [
    { slot: 1 as const, url: data.mix_url_1 },
    { slot: 2 as const, url: data.mix_url_2 },
    { slot: 3 as const, url: data.mix_url_3 },
  ].filter((m): m is { slot: 1 | 2 | 3; url: string } => !!m.url);
  const galleryUrls = [data.gallery_img_1, data.gallery_img_2, data.gallery_img_3, data.gallery_img_4]
    .filter((u): u is string => !!u);
  // Slot-aware gallery entries — needed so the owner delete X can
  // null out the correct gallery_img_N column (since galleryUrls is
  // filtered, indexes don't line up with DB slots after a deletion).
  const galleryEntries = [
    { slot: 1 as const, url: data.gallery_img_1 },
    { slot: 2 as const, url: data.gallery_img_2 },
    { slot: 3 as const, url: data.gallery_img_3 },
    { slot: 4 as const, url: data.gallery_img_4 },
  ].filter((g): g is { slot: 1 | 2 | 3 | 4; url: string } => !!g.url);
  const videoUrls = [data.video_url_1, data.video_url_2, data.video_url_3].filter((u): u is string => !!u);
  // Pair each video URL with its title + description from the matching
  // numbered columns. slot is 1/2/3 — the original DB column index — so
  // delete handlers can target the right video_url_N / video_title_N /
  // video_desc_N columns even after filtering out empty slots.
  const videoEntries = [
    { slot: 1 as const, url: data.video_url_1, title: data.video_title_1, desc: data.video_desc_1 },
    { slot: 2 as const, url: data.video_url_2, title: data.video_title_2, desc: data.video_desc_2 },
    { slot: 3 as const, url: data.video_url_3, title: data.video_title_3, desc: data.video_desc_3 },
  ].filter((v): v is { slot: 1 | 2 | 3; url: string; title: string | null; desc: string | null } => !!v.url);

  // Testimonials (JSON-stringified, mobile DJs only)
  let testimonials: Testimonial[] = [];
  if (isMobileDJ && data.testimonials) {
    try {
      const parsed = JSON.parse(data.testimonials) as Testimonial[];
      if (Array.isArray(parsed)) testimonials = parsed;
    } catch { /* invalid JSON — silently ignore, vanilla does the same */ }
  }

  // ── Tab visibility ──────────────────────────────────────────────────
  // Stored as JSONB on users.tab_visibility. Format:
  //   { about: bool, mixes: bool, images: bool, video: bool, testimonials: bool }
  // Booking tab is NOT controlled here — that's still driven by
  // booking_settings.enabled. Defaults differ by DJ type:
  //   - Club DJ: all default ON (testimonials column is irrelevant)
  //   - Mobile DJ: all default ON except testimonials (default OFF)
  // Owner can toggle via the "Edit tabs" modal.
  const tabVisibility: {
    about: boolean;
    mixes: boolean;
    images: boolean;
    video: boolean;
    testimonials: boolean;
  } = (() => {
    const defaults = {
      about: true,
      mixes: true,
      images: true,
      video: true,
      // Mobile DJs default testimonials OFF; club DJs ignored entirely.
      testimonials: !isMobileDJ,
    };
    const raw = data.tab_visibility;
    if (!raw) return defaults;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== 'object') return defaults;
      const out = { ...defaults };
      for (const k of Object.keys(defaults) as Array<keyof typeof defaults>) {
        if (typeof parsed[k] === 'boolean') out[k] = parsed[k];
      }
      return out;
    } catch {
      return defaults;
    }
  })();
  // Testimonials: only relevant for mobile DJs. Visitors only see the tab
  // when enabled AND there's at least one testimonial; owner sees it
  // whenever enabled (even empty) so they can add some.
  const showTestimonialsTab =
    isMobileDJ && tabVisibility.testimonials && (isOwnProfile || testimonials.length > 0);

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
  // The DJ type badge has been moved permanently to the top-left of the
  // hero (BannerTypeEventsDropdown for mobile DJs, static badge for club),
  // so mid-hero badges are no longer rendered. Kept as null for layout.
  const heroBadgesEl = null;

  // Auto-size the DJ name based on character length so the pill stays
  // tight and fits on one line. Tiers tuned to keep most names single-line.
  //   ≤ 10 chars → default size
  //   11–16     → medium
  //   17–22     → medium-small
  //   23–30     → small
  //   31+       → x-small
  const nameLen = (data.name || 'Unknown DJ').length;
  const nameSizeClass =
    nameLen <= 10
      ? ''
      : nameLen <= 16
        ? styles.heroNameLg
        : nameLen <= 22
          ? styles.heroNameMd
          : nameLen <= 30
            ? styles.heroNameSm
            : styles.heroNameXs;

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
        <div className={`${styles.hero} ${data.banner_url ? styles.heroHasBanner : ''}`}>
          {/* BANNER — sits behind the hero content as a background layer.
              Read-only here; all edits happen inside the BannerEditModal
              that opens from the corner button. Both desktop and mobile
              positions are passed as CSS variables and a media query in
              profile.module.css picks the right one per viewport. */}
          {(data.banner_url || isOwnProfile || data.dj_type) && (
            <div
              className={styles.banner}
              style={
                data.banner_url
                  ? ({
                      backgroundImage: `url(${data.banner_url})`,
                      ['--banner-pos' as string]: data.banner_position || '50% 50%',
                      ['--banner-pos-mobile' as string]:
                        data.banner_position_mobile || data.banner_position || '50% 50%',
                    } as React.CSSProperties)
                  : undefined
              }
            >
              {/* Top-left DJ type badge — primary display. For mobile
                  DJs, doubles as the Events Serviced dropdown (click to
                  see event types). Shown always, banner or not. */}
              {data.dj_type && (
                isMobileDJ ? (
                  <BannerTypeEventsDropdown events={eventTypes} />
                ) : (
                  <div
                    className={`${styles.bannerNameBadge} ${styles.bannerNameBadgeClub}`}
                  >
                    Club / Bar DJ
                  </div>
                )
              )}
              {isOwnProfile && (
                <button
                  type="button"
                  onClick={() => setBannerModalOpen(true)}
                  className={styles.bannerEditBtn}
                  title="Edit banner"
                  aria-label="Edit banner"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                  <span>{data.banner_url ? 'Edit banner' : 'Add banner'}</span>
                </button>
              )}
            </div>
          )}
          {/* Book Now + Message Us — visible to all visitors EXCEPT the
              profile owner. Sibling of .banner so its z-index can sit
              above hero content. Book Now scrolls to calendar in 12-month
              view; Message Us opens compose modal (sends to DJ inbox). */}
          {!isOwnProfile && (
            <div className={styles.bannerCtaRow}>
              {showBookingTab && (
                <button
                  type="button"
                  className={styles.bannerBookNowBtn}
                  onClick={() => {
                    const url = new URL(window.location.href);
                    url.searchParams.set('view', '12mo');
                    window.history.replaceState(null, '', url.toString());
                    setActiveTab('booking');
                    setForceCalendar12mo(c => c + 1);
                    requestAnimationFrame(() => {
                      const el = document.getElementById('booking-pane-anchor');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    });
                  }}
                >
                  Book Now
                </button>
              )}
              <button
                type="button"
                className={styles.bannerMessageUsBtn}
                onClick={() => {
                  if (!requireVerified(`/${effectiveSlug}`)) return;
                  setComposeOpen(true);
                }}
              >
                Message Us
              </button>
            </div>
          )}
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
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      // Reset input so picking the same file again
                      // re-triggers onChange (browsers skip identical
                      // selections otherwise).
                      e.target.value = '';
                      if (!file) return;
                      const err = await validateImageFile(file);
                      if (err) {
                        alert(err);
                        return;
                      }
                      setPickedAvatarFile(file);
                    }}
                  />
                </>
              )}
            </div>
            {/* Mobile-only column: name + badges next to avatar */}
            <div className={styles.heroNameCol}>
              <div className={`${styles.heroName} ${nameSizeClass}`}>{data.name || 'Unknown DJ'}</div>
              {saleActive && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, background: 'var(--neon,#00e0a4)', color: '#06231b', fontWeight: 800, fontSize: '.72rem', letterSpacing: '.05em', padding: '3px 10px', borderRadius: 999 }}>
                  {salePercent ? `${salePercent}% OFF` : 'SALE'} · BOOKING SALE
                </div>
              )}
              {heroBadgesEl}
            </div>
          </div>

          {/* Hero info — name and badges visible on desktop, hidden on mobile
              via the descendant selector .heroInfo .heroName / .heroInfo .heroBadges
              inside the @media (max-width:900px) block in profile.module.css */}
          <div className={styles.heroInfo}>
            <div className={`${styles.heroName} ${nameSizeClass}`}>{data.name || 'Unknown DJ'}</div>
              {saleActive && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, background: 'var(--neon,#00e0a4)', color: '#06231b', fontWeight: 800, fontSize: '.72rem', letterSpacing: '.05em', padding: '3px 10px', borderRadius: 999 }}>
                  {salePercent ? `${salePercent}% OFF` : 'SALE'} · BOOKING SALE
                </div>
              )}
            {heroBadgesEl}
            <div className={styles.heroMobileDivider} />

            {location && (
              <div className={styles.heroLocation}>
                <LocationPinIcon /> {location}
              </div>
            )}

            {/* Event types + genres as hero tags. Mobile DJs now have
                their Events Serviced list inside the type-badge dropdown
                above (DjTypeEventsDropdown), so it's omitted here. Other
                DJ types still get all event types as separate inline tags.
                Genres always render as separate pink tags. */}
            {((eventTypes.length > 0 && !isMobileDJ) || genres.length > 0) && (
              <div className={styles.heroTags}>
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
                {genres
                  .filter(g => g !== 'open-format')
                  .map(g => (
                  <span
                    key={`genre-${g}`}
                    className={`${styles.tag} ${styles.tagSmall} ${styles.tagSmallPink}`}
                  >
                    {GENRE_LABELS[g] || g}
                  </span>
                ))}
              </div>
            )}

            {/* Hero action buttons — phone, message, copy link.
                Socials are rendered separately as UnderBannerSocials. */}
            <HeroActions
              data={data}
              isLoggedIn={isLoggedIn}
              isOwnProfile={isOwnProfile}
              hideSocials={true}
              onClickMessage={() => {
                // Owner can't message themselves; logged-out visitors are
                // sent to /login first, returning to the same profile.
                if (isOwnProfile) return;
                if (!requireVerified(`/${effectiveSlug}`)) return;
                setComposeOpen(true);
              }}
            />
          </div>
        </div>
        {/* Under-banner socials strip — full-width row sitting snug
            against the bottom of the hero/banner. Centered. */}
        <UnderBannerSocials data={data} effectiveSlug={effectiveSlug} isOwnProfile={isOwnProfile} bookingEnabled={bookingEnabled} onShareClick={() => setShareModalOpen(true)} />

        {/* BODY */}
        <div className={styles.body}>
          {/* Tabs section — Edit tabs button + pill-segmented nav share a
              centered container so the button aligns to the right edge of
              the pill bar (not the page). */}
          <div className={styles.tabsSection}>
            {isOwnProfile && (
              <div className={styles.editTabsRow}>
                <button
                  type="button"
                  onClick={() => setTabsModalOpen(true)}
                  className={styles.editTabsBtn}
                  title="Choose which tabs are visible to the public"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit tabs
                </button>
              </div>
            )}
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
            {tabVisibility.about && (
              <button
                className={tabClass('about')}
                onClick={() => setActiveTab('about')}
                type="button"
              >
                About
              </button>
            )}
            {tabVisibility.mixes && (
              <button
                className={tabClass('mixes')}
                onClick={() => setActiveTab('mixes')}
                type="button"
              >
                Mixes
              </button>
            )}
            {tabVisibility.images && (
              <button
                className={tabClass('images')}
                onClick={() => setActiveTab('images')}
                type="button"
              >
                Photos
              </button>
            )}
            {tabVisibility.video && (
              <button
                className={tabClass('video')}
                onClick={() => setActiveTab('video')}
                type="button"
              >
                Video
              </button>
            )}
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
          </div>

          {/* Booking tab — different component for club vs mobile DJs */}
          {showClubAvailabilityTab && (
            <div id="booking-pane-anchor" className={paneClass('booking')} data-booking-anchor>
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
                onBookDate={(key) => {
                  if (!requireVerified(`/${effectiveSlug}?date=${key}&book=1`)) return;
                  setClubSelectedDate(key);
                }}
                onLoggedOutBookAttempt={(key) => setClubLoginGateDate(key)}
                onEmbedClick={isOwnProfile ? () => setEmbedModalOpen(true) : undefined}
                onShareClick={() => setShareModalOpen(true)}
                force12mo={forceCalendar12mo}
                pendingDates={clubPendingDates}
              />
              {!isOwnProfile && clubSelectedDate && currentUser && currentUser.email_verified && (
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
                  onClose={() => {
                    setClubSelectedDate(null);
                    // Refresh pending dates — if the booker just submitted
                    // a request, the new pending row should now show up
                    // as "Pending" on the calendar instead of "Book".
                    setClubPendingRefreshKey((k) => k + 1);
                  }}
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
            <div id="booking-pane-anchor" className={paneClass('booking')} data-booking-anchor>
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
                onEmbedClick={isOwnProfile ? () => setEmbedModalOpen(true) : undefined}
                onShareClick={() => setShareModalOpen(true)}
                force12mo={forceCalendar12mo}
                pendingDates={clubPendingDates}
                onBookingSubmitted={() => setClubPendingRefreshKey((k) => k + 1)}
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
            {mixEntries.length > 0 ? (
              <div className={styles.mediaList}>
                {mixEntries.map((m) => {
                  const embed = buildMixEmbed(m.url);
                  if (!embed) return null;
                  return (
                    <div
                      key={m.slot}
                      className={styles.mediaEmbedWrap}
                      style={isOwnProfile ? { position: 'relative' } : undefined}
                    >
                      {/* Owner-only delete X — top-right corner of the
                          mix embed. Confirms before delete. */}
                      {isOwnProfile && (
                        <button
                          type="button"
                          onClick={() => deleteMix(m.slot)}
                          title="Delete this mix"
                          aria-label="Delete this mix"
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            zIndex: 5,
                            width: 26,
                            height: 26,
                            borderRadius: '50%',
                            background: 'rgba(0, 0, 0, .8)',
                            border: '1px solid rgba(255, 95, 95, .7)',
                            color: '#ff5f5f',
                            fontSize: '.8rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            lineHeight: 1,
                          }}
                        >
                          ✕
                        </button>
                      )}
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
                {/* Owner-only inline add — appears below existing mixes
                    until all 3 slots are filled. Saves to next empty
                    mix_url_1/2/3 column. */}
                {isOwnProfile && mixEntries.length < 3 && (
                  <MediaAddButton
                    userId={data.id}
                    kind="mix"
                    existing={[data.mix_url_1, data.mix_url_2, data.mix_url_3]}
                  />
                )}
              </div>
            ) : (
              <div className={styles.tabEmpty}>
                {isOwnProfile ? (
                  <MediaAddButton
                    userId={data.id}
                    kind="mix"
                    existing={[data.mix_url_1, data.mix_url_2, data.mix_url_3]}
                    big
                  />
                ) : 'Coming Soon'}
              </div>
            )}
          </div>

          {/* Photos tab */}
          <div className={paneClass('images')}>
            {galleryEntries.length > 0 ? (
              <div className={styles.imageGrid}>
                {galleryEntries.map((g) => (
                  <div
                    key={g.slot}
                    style={isOwnProfile ? { position: 'relative' } : undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={g.url}
                      alt="Gallery photo"
                      loading="lazy"
                      onClick={() => setLightboxSrc(g.url)}
                    />
                    {isOwnProfile && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); deletePhoto(g.slot); }}
                        title="Delete this photo"
                        aria-label="Delete this photo"
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          zIndex: 5,
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          background: 'rgba(0, 0, 0, .8)',
                          border: '1px solid rgba(255, 95, 95, .7)',
                          color: '#ff5f5f',
                          fontSize: '.8rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                          lineHeight: 1,
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {/* Owner-only inline add — opens manage-photos modal
                    when there's room for more photos. */}
                {isOwnProfile && galleryEntries.length < 4 && (
                  <button
                    type="button"
                    onClick={() => setPhotoManagerOpen(true)}
                    title="Add a photo"
                    aria-label="Add a photo"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%',
                      aspectRatio: '1 / 1',
                      background: 'rgba(0, 245, 196, .05)',
                      border: '2px dashed var(--neon)',
                      borderRadius: 8,
                      color: 'var(--neon)',
                      cursor: 'pointer',
                      fontSize: '2.5rem',
                      lineHeight: 1,
                      fontWeight: 300,
                      padding: 0,
                    }}
                  >
                    +
                  </button>
                )}
              </div>
            ) : (
              <div className={styles.tabEmpty}>
                {isOwnProfile ? (
                  <button
                    type="button"
                    onClick={() => setPhotoManagerOpen(true)}
                    title="Add photos"
                    aria-label="Add photos"
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
                      cursor: 'pointer',
                      fontSize: '3rem',
                      lineHeight: 1,
                      fontWeight: 300,
                      padding: 0,
                    }}
                  >
                    +
                  </button>
                ) : 'Coming Soon'}
              </div>
            )}
          </div>

          {/* Video tab */}
          <div className={paneClass('video')}>
            {videoEntries.length > 0 ? (
              <div className={styles.videoList}>
                {videoEntries.map((v, i) => {
                  const embed = buildVideoEmbed(v.url);
                  if (!embed) return null;
                  return (
                    <div key={i} className={styles.videoCard} style={isOwnProfile ? { position: 'relative' } : undefined}>
                      {/* Owner-only delete X — top-right corner of the
                          frame, above the title. Confirms before delete
                          via useConfirm modal. */}
                      {isOwnProfile && (
                        <button
                          type="button"
                          onClick={() => deleteVideo(v.slot)}
                          title="Delete this video"
                          aria-label="Delete this video"
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            zIndex: 5,
                            width: 26,
                            height: 26,
                            borderRadius: '50%',
                            background: 'rgba(0, 0, 0, .8)',
                            border: '1px solid rgba(255, 95, 95, .7)',
                            color: '#ff5f5f',
                            fontSize: '.8rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            lineHeight: 1,
                          }}
                        >
                          ✕
                        </button>
                      )}
                      {v.title && (
                        <div className={styles.videoCardTitle}>{v.title}</div>
                      )}
                      <div className={styles.videoWrap}>
                        <iframe
                          src={embed.src}
                          width="1280"
                          height="720"
                          frameBorder="0"
                          loading="lazy"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                      {isOwnProfile ? (
                        <VideoMetaEditor
                          userId={data.id}
                          slot={v.slot}
                          initialTitle={v.title}
                          initialDesc={v.desc}
                        />
                      ) : v.desc ? (
                        <div className={styles.videoCardDesc}>
                          <ExpandableDesc text={v.desc} />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {isOwnProfile && videoEntries.length < 3 && (
                  <MediaAddButton
                    userId={data.id}
                    kind="video"
                    existing={[data.video_url_1, data.video_url_2, data.video_url_3]}
                  />
                )}
              </div>
            ) : (
              <div className={styles.tabEmpty}>
                {isOwnProfile ? (
                  <MediaAddButton
                    userId={data.id}
                    kind="video"
                    existing={[data.video_url_1, data.video_url_2, data.video_url_3]}
                    big
                  />
                ) : 'Coming Soon'}
              </div>
            )}
          </div>

          {/* Testimonials tab — mobile DJs only. Owner can add/edit/delete
              from here; visitors see the list (read-only). If no
              testimonials are saved yet, owner sees an explanatory
              message and the add form; visitors don't see the tab at
              all (see showTestimonialsTab logic above). */}
          {showTestimonialsTab && (
            <div className={paneClass('testimonials')}>
              {isOwnProfile && testimonials.length === 0 && (
                <div className={styles.testimonialOwnerNote}>
                  Visitors won&apos;t see the Testimonials tab on your profile
                  until at least one is added.
                </div>
              )}
              {testimonials.map((t, i) => (
                <div key={i} className={styles.testimonialItem}>
                  {isOwnProfile && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm('Delete this testimonial?')) return;
                        try {
                          const next = testimonials.filter((_, idx) => idx !== i);
                          const supabase = createClient();
                          const { error } = await supabase
                            .from('users')
                            .update({ testimonials: JSON.stringify(next) } as unknown as never)
                            .eq('id', data.id);
                          if (error) throw error;
                          window.location.reload();
                        } catch (err) {
                          alert(err instanceof Error ? err.message : 'Delete failed.');
                        }
                      }}
                      className={styles.testimonialDeleteBtn}
                      title="Delete testimonial"
                      aria-label="Delete testimonial"
                    >
                      ✕
                    </button>
                  )}
                  <div className={styles.testimonialMeta}>
                    <span className={styles.testimonialName}>{t.name || ''}</span>
                    {t.date && (
                      <span className={styles.testimonialDate}>· {t.date}</span>
                    )}
                  </div>
                  <div className={styles.testimonialBlurb}>{t.blurb || ''}</div>
                </div>
              ))}
              {isOwnProfile && (
                <TestimonialAddForm
                  userId={data.id}
                  existing={testimonials}
                />
              )}
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

      {/* Confirm modal — for owner delete-video. Renders only when an
          active confirm is pending. */}
      {confirmDialog}

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

      {/* Banner edit modal — owner-only. Handles upload, replace, and
          vertical reposition for desktop AND mobile views in one place. */}
      {bannerModalOpen && isOwnProfile && (
        <BannerEditModal
          userId={data.id}
          initialUrl={data.banner_url}
          initialPosition={data.banner_position}
          initialPositionMobile={data.banner_position_mobile}
          onClose={() => setBannerModalOpen(false)}
        />
      )}

      {/* Edit tabs modal — owner-only. Toggles which tabs (about, mixes,
          photos, video, testimonials) are visible to the public. */}
      {tabsModalOpen && isOwnProfile && (
        <EditTabsModal
          userId={data.id}
          initial={tabVisibility}
          isMobileDJ={isMobileDJ}
          onClose={() => setTabsModalOpen(false)}
        />
      )}

      {/* Share calendar modal — visible to all visitors. Two preview
          cards (month view + 12-month view) with copyable URLs. */}
      {shareModalOpen && (
        <ShareCalendarModal
          djSlug={effectiveSlug}
          onClose={() => setShareModalOpen(false)}
        />
      )}

      {/* Photo manager modal — owner-only. Lets the DJ upload to /
          remove from any of the 4 gallery slots independently. Opened
          from the + button in the Photos tab. */}
      {photoManagerOpen && isOwnProfile && (
        <PhotoManagerModal
          userId={data.id}
          slots={[
            { slot: 1, url: data.gallery_img_1 },
            { slot: 2, url: data.gallery_img_2 },
            { slot: 3, url: data.gallery_img_3 },
            { slot: 4, url: data.gallery_img_4 },
          ]}
          onClose={() => {
            // Reload on close so any changes the DJ made show in the
            // hero/photos tab. Cheaper than wiring up live state.
            const url = new URL(window.location.href);
            url.searchParams.set('tab', 'images');
            window.location.href = url.toString();
          }}
        />
      )}

      {/* Embed-calendar modal — owner-only. Lets the DJ generate / copy
          their iframe embed snippet from the public profile without
          having to go to update-dj-profile. Same generator UX as
          EmbedCodeSection in update-dj-profile, ported inline to keep
          this self-contained (no shared CSS module). */}
      {embedModalOpen && isOwnProfile && (
        <EmbedCalendarModal
          slug={effectiveSlug}
          onClose={() => setEmbedModalOpen(false)}
        />
      )}
    </>
  );
}
