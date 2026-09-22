'use client';

// ProfileView — Client Component for the interactive parts of a DJ profile:
//   - Tab switching (About / Mixes / Photos / Video / Testimonials)
//   - Lightbox open/close for gallery images and avatar
// Server Component (page.tsx) does the data fetch and passes everything in.

import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './profile.module.css';
import { useAuth } from '@/components/AuthProvider';
import { EVENT_TYPE_LABELS, GENRE_LABELS, initials } from './constants';
import { buildMixEmbed, buildVideoEmbed } from './embeds';
import { parseBookingSettings, packageTiers, isSaleActive } from './bookingSettings';
import PublicCalendar from './PublicCalendar';
import MobilePublicCalendar from './MobilePublicCalendar';
import { parseCustomEventTypes } from '@/lib/constants';
import ClubBookingForm from './ClubBookingForm';
import BookingLoginGate from './BookingLoginGate';
import ComposeMessageModal from '@/components/ComposeMessageModal';
import { useConfirm } from '@/components/ConfirmModal';
import { createClient } from '@/lib/supabase/client';
import { optimizedImageUrl } from '@/lib/img';
import { parseAlbums, pruneAlbums, type Album } from '@/lib/albums';
import { effectiveTier, TIERS, type AccessFields } from '@/lib/access';
import AvatarCrop from '../update-dj-profile/AvatarCrop';
import {
  LocationPinIcon, ClaimAlertIcon,
} from './icons';


// Shared profile types now live in ./profileTypes. Re-export DjProfileData
// so existing importers (e.g. page.tsx) keep working unchanged.
import type { DjProfileData, Testimonial, Faq, AboutStats, TabKey } from './profileTypes';
import { sanitizeBioHtml } from '@/lib/sanitizeBio';
export type { DjProfileData };
// Extracted sub-components (banner pills, hero actions, owner editors, modals).
import {
  BannerTypeEventsDropdown, OwnerEditableBio, MixAddButton, VideoAddButton,
  VideoMetaEditor, ExpandableDesc, PhotoManagerModal, AddPhotosModal, CreateAlbumModal, EmbedCalendarModal,
  BannerEditModal, EditTabsModal, TestimonialAddForm, FaqAddForm, FaqAccordion,
  AboutStatsRow, ShareCalendarModal, UnderBannerSocials,
} from './ProfileComponents';
import { validateImageFile } from './profilePhotoUtils';
import { saveProfile, setProfileEditContext, profileUploadFolder } from './profileSave';

// Parse booking settings ONCE, outside the component (it's pure data) —
// but we need profile.dj_type and booking_settings, so it has to live inside.
// Done inline via parseBookingSettings near the top of the component below.

interface Props {
  data: DjProfileData;
  effectiveSlug: string;
  isLoggedIn: boolean;
  isOwnProfile: boolean;
  // True when the viewer is a team member with a profile-editing seat (not the
  // owner). Grants editing of every tab EXCEPT Booking.
  canEditProfile?: boolean;
  // Paywall: true when the DJ has an active subscription/comp (Tier 1+).
  // ANDed with the existing enabled + completeness checks below.
  hasBookingAccess: boolean;
}

// Owner-only "⋯" menu shown next to the hero name and the location. One button
// opens a small popover where the text colour and the semi-transparent colour
// band are set separately (band can also be removed). One instance per element.
function HeroColorMenu({ which, textColor, onText, band, onBand }: {
  which: 'name' | 'location';
  textColor: string;
  onText: (hex: string) => void;
  band: string | null;
  onBand: (hex: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const noun = which === 'name' ? 'Name' : 'Location';
  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '7px 4px' };
  const labelStyle: React.CSSProperties = { fontFamily: "'Space Mono', monospace", fontSize: 11, color: '#fff', textTransform: 'uppercase', letterSpacing: '.05em' };
  const swatchInput: React.CSSProperties = { width: 30, height: 22, padding: 0, border: '1px solid rgba(255,255,255,.4)', borderRadius: 5, background: 'transparent', cursor: 'pointer' };
  // Live preview band behind the "Color band" label: the chosen band colour at
  // ~50% opacity, or a subtle neutral tint when no band is set yet.
  const bandLabelBg = (() => {
    const m = band ? /^#?([0-9a-fA-F]{6})$/.exec(band) : null;
    if (!m) return 'rgba(255,255,255,.14)';
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, .5)`;
  })();

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', marginLeft: 10, transform: 'translateY(-2px)', verticalAlign: 'middle', flexShrink: 0, zIndex: open ? 3000 : undefined }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Style the ${noun.toLowerCase()}`}
        aria-label={`Style the ${noun.toLowerCase()}`}
        aria-expanded={open}
        style={{ height: 26, width: 16, padding: 0, borderRadius: 5, background: 'rgba(0,0,0,.55)', border: '1px solid var(--neon)', color: 'var(--neon)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: 0 }}
      >
        <svg width="4" height="14" viewBox="0 0 4 14" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
          <circle cx="2" cy="2" r="1.7" />
          <circle cx="2" cy="7" r="1.7" />
          <circle cx="2" cy="12" r="1.7" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          style={{ position: 'absolute', top: 30, right: 0, zIndex: 3000, minWidth: 214, background: '#14141f', border: '1px solid rgba(255,255,255,.16)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.55)', padding: '6px 10px 8px', textAlign: 'left' }}
        >
          <div style={{ ...labelStyle, fontSize: 9.5, color: 'var(--neon)', padding: '4px 4px 2px' }}>{noun} style</div>
          <div style={rowStyle}>
            <span style={labelStyle}>Text color</span>
            <input type="color" value={textColor} onChange={(e) => onText(e.target.value)} style={swatchInput} aria-label={`${noun} text color`} />
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,.1)' }} />
          <div style={rowStyle}>
            <span style={{ ...labelStyle, background: bandLabelBg, padding: '.12em .4em', borderRadius: 4 }}>Color band</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {band && (
                <button type="button" onClick={() => onBand(null)} style={{ background: 'none', border: 'none', color: 'var(--muted,#8a8aa0)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', cursor: 'pointer' }}>
                  Remove
                </button>
              )}
              <input
                type="color"
                value={band || textColor}
                onChange={(e) => onBand(e.target.value)}
                style={swatchInput}
                title={band ? 'Change band color' : 'Add a color band'}
                aria-label={`${noun} color band`}
              />
            </span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted,#8a8aa0)', lineHeight: 1.4, padding: '2px 4px 0' }}>
            The band is a semi-transparent strip behind the {noun.toLowerCase()}.
          </div>
        </div>
      )}
    </span>
  );
}

export default function ProfileView({ data, effectiveSlug, isLoggedIn, isOwnProfile, canEditProfile = false, hasBookingAccess }: Props) {
  // Who may edit the public profile (all tabs except Booking): the owner, or a
  // permitted team member. `actingAsMember` is true only for the member case —
  // their writes route through /api/profile/update instead of a direct write.
  // Whoever may edit (owner or permitted teammate). `previewPublic` lets them
  // temporarily see the page exactly as a visitor would — all edit chrome
  // hidden — without leaving the page. It's session state only: a reload always
  // returns them to owner view.
  const baseCanEdit = isOwnProfile || canEditProfile;
  const [previewPublic, setPreviewPublic] = useState(false);
  const canEdit = baseCanEdit && !previewPublic;
  const actingAsMember = canEditProfile && !isOwnProfile;
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
  const { user: currentUser } = useAuth();
  // A staff login (active team member) may NOT book a DJ — booking is for
  // owners and hosts only. Staff still SEE the availability calendar, but
  // read-only: no date-tap booking, no owner availability editing.
  const viewerIsStaff = !!currentUser?.isMember;
  // Route inline profile writes through the owner's row directly (owner) or the
  // role-gated API (team member). Keep this in sync as auth resolves.
  useEffect(() => {
    setProfileEditContext({ actingAsMember, uploaderId: currentUser?.id ?? null });
  }, [actingAsMember, currentUser?.id]);
  // Staff DO see the availability tab now — just read-only (see below).
  const showClubAvailabilityTab = isClubDJ && bookingEnabled;
  const showMobileBookingTab = isMobileDJBooking && bookingEnabled;
  const showBookingTab = showClubAvailabilityTab || showMobileBookingTab;

  // If the URL has ?date=YYYY-MM-DD (visitor came from the embed
  // calendar) AND we have a booking tab, force-default to it so the
  // auto-select logic in MobilePublicCalendar finds the right context.
  const searchParams = useSearchParams();
  const router = useRouter();
  const hasDateParam = !!searchParams.get('date');

  // Active tab — defaults to booking (if visible) else about. Can be
  // deep-linked via ?tab= so a reload (e.g. after adding a mix or video
  // inline) lands back on the same tab. Validates against TabKey list.
  const tabFromUrl = (() => {
    const t = searchParams.get('tab') || '';
    const valid: TabKey[] = ['booking', 'about', 'mixes', 'images', 'video', 'testimonials', 'faq'];
    return (valid as string[]).includes(t) ? (t as TabKey) : null;
  })();
  const [activeTab, setActiveTab] = useState<TabKey>(
    tabFromUrl || (showBookingTab ? 'booking' : 'about')
  );
  // Keep the URL's ?tab= in sync with the active tab (without a navigation or
  // scroll jump), so a refresh — including router.refresh() after adding a
  // photo/album — restores the tab the DJ is actually on, not Photos.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') !== activeTab) {
      url.searchParams.set('tab', activeTab);
      window.history.replaceState(null, '', url.toString());
    }
  }, [activeTab]);
  // Club-booking flow — selectedDate drives the form, loginGateForDate
  // shows the login gate for unauthenticated visitors. Mirror of the
  // pattern in MobilePublicCalendar (which holds these internally).
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
  // Book Now (which used to bump this) was removed from the banner; the value
  // is still passed to the calendar's force12mo prop but no longer changes.
  const [forceCalendar12mo] = useState(0);
  // Photo manager modal — opens from the + button in the Photos tab.
  // Shows all 4 slots so DJ can upload to / remove from each independently.
  const [photoManagerOpen, setPhotoManagerOpen] = useState(false);
  const [addPhotosOpen, setAddPhotosOpen] = useState(false);
  // Photos tab: which album is being viewed (null = All photos) and how many
  // of the all-photos feed are shown (paginated so a huge gallery never loads
  // at once). PHOTO_PAGE is the batch size for "Load more".
  const PHOTO_PAGE = 24;
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [photoLimit, setPhotoLimit] = useState<number>(PHOTO_PAGE);
  const [createAlbumOpen, setCreateAlbumOpen] = useState(false);
  const [editAlbumTarget, setEditAlbumTarget] = useState<Album | null>(null);
  // Embed-calendar modal — owner-only shortcut on the profile so the DJ
  // can grab their iframe embed snippet without leaving for update-dj-profile.
  // Triggered by the "Embed Calendar" button above the calendar in the
  // Booking/Availability tab.
  const [embedModalOpen, setEmbedModalOpen] = useState(false);

  // Confirm modal — used for owner delete-video confirmation. Returns
  // a confirm() promise + a confirmDialog JSX element to render once.
  const { confirm, confirmDialog } = useConfirm();

  // Delete a video — removes it from the video_urls array by index.
  async function deleteVideo(index: number) {
    const ok = await confirm({
      title: 'Delete this video?',
      message: 'This removes the video from your profile. You can add it back any time.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const next = videoList.filter((_, i) => i !== index);
      await saveProfile(data.id, { video_urls: next }, actingAsMember);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'video');
      window.location.href = url.toString();
    } catch {
      // Best-effort; user can retry.
    }
  }

  // (Photo deletion now happens inside PhotoManagerModal, which edits the
  // gallery_photos array directly.)

  // Delete a mix — removes it from the mix_urls array by index.
  async function deleteMix(index: number) {
    const ok = await confirm({
      title: 'Delete this mix?',
      message: 'This removes the mix from your profile. You can add it back any time.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const next = mixList.filter((_, i) => i !== index);
      await saveProfile(data.id, { mix_urls: next }, actingAsMember);
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
  // Lightbox zoom scale (1 = fit). Zoom in/out buttons step this.
  const [lightboxZoom, setLightboxZoom] = useState(1);
  // Per-photo owner menu (the pencil dropdown) — the URL whose menu is open.
  const [photoMenuFor, setPhotoMenuFor] = useState<string | null>(null);
  // Caption editor — the URL being captioned, plus the draft text.
  const [captionFor, setCaptionFor] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  // Live overrides so setting a cover / editing a caption updates in place
  // (no full page reload). null = fall back to the values from the server.
  const [captionOverride, setCaptionOverride] = useState<Record<string, string> | null>(null);
  const [coverOverride, setCoverOverride] = useState<Record<string, string>>({});
  // URLs deleted this session — filtered out of the gallery so a delete
  // updates in place without a full page reload.
  const [deletedUrls, setDeletedUrls] = useState<Set<string>>(new Set());

  // ── Hero name/location color ────────────────────────────────────────
  // Owner-chosen color applied to BOTH the hero name and the location line.
  // Default is white when unset so nothing changes for existing profiles.
  // Held in local state so the owner's color-picker recolors LIVE, then
  // persisted via /api/dj/profile-color.
  const [nameColor, setNameColor] = useState<string>(data.profile_name_color || '#ffffff');
  // Location now has its OWN text colour (falls back to the name colour if the
  // owner never set one, so existing profiles look unchanged). Plus an optional
  // semi-transparent band behind each of the name and the location, stored as a
  // hex colour (null = no band). All four are independently editable.
  const [locationColor, setLocationColor] = useState<string>(
    data.profile_location_color || data.profile_name_color || '#ffffff',
  );
  const [nameBg, setNameBg] = useState<string | null>(data.profile_name_bg || null);
  const [locationBg, setLocationBg] = useState<string | null>(data.profile_location_bg || null);

  // Persist one field to the DJ's row. `value` null clears it (band off). The
  // route validates and maps the field name → its column.
  async function saveColorField(field: 'name' | 'location' | 'name_bg' | 'location_bg', value: string | null) {
    try {
      await fetch('/api/dj/profile-color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, color: value }),
      });
    } catch {
      // Best-effort; the live colour still applies until reload.
    }
  }
  function handleNameColorChange(color: string) { setNameColor(color); saveColorField('name', color); }
  function handleLocationColorChange(color: string) { setLocationColor(color); saveColorField('location', color); }
  function handleNameBgChange(color: string | null) { setNameBg(color); saveColorField('name_bg', color); }
  function handleLocationBgChange(color: string | null) { setLocationBg(color); saveColorField('location_bg', color); }

  // Hex → rgba at a fixed opacity, for the semi-transparent band. Guards against
  // a bad value by falling back to a neutral dark band.
  function bandRgba(hex: string | null, alpha = 0.85): string | undefined {
    if (!hex) return undefined;
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return undefined;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  // Style for the colour band behind the hero name / location. Tuned per element:
  //
  //   name  — Bebas Neue, all-caps. An INLINE span's background is locked to the
  //           font's line box, which reserves a big block of empty descender
  //           space that gets painted no matter what padding/line-height you set —
  //           that's why the band looked oversized and wouldn't tighten. Making it
  //           `inline-block` lets the box follow line-height, so a tight
  //           line-height (.78) + small padding wraps the band snugly around the
  //           caps like a highlighter. (No box-decoration-break needed: the name
  //           is single-line; the size tiers shrink long names to fit.)
  //
  //   location — Space Mono, small mixed-case with real descenders. Left inline
  //           with clone so it can wrap, full line-height, and even generous
  //           top/bottom padding so the strip reads as a solid band.
  //
  // Both verified on the live rendered hero.
  function bandSpanStyle(hex: string | null, which: 'name' | 'location' = 'name'): React.CSSProperties {
    const bg = bandRgba(hex);
    if (!bg) return {};
    if (which === 'location') {
      return {
        background: bg,
        lineHeight: 1,
        padding: '.34em .3em',
        borderRadius: '.16em',
        boxDecorationBreak: 'clone',
        WebkitBoxDecorationBreak: 'clone',
      };
    }
    return {
      background: bg,
      display: 'inline-block',
      lineHeight: 0.78,
      // More top than bottom: at line-height .78 the caps sit low in the box, so
      // .17/.06 evens the gap above and below the letters. Verified on the hero.
      padding: '.17em .16em .06em',
      borderRadius: '.16em',
    };
  }
  // One three-dot (⋯) button per element opens a small popover where the owner
  // sets the text colour and the band colour separately. Rendered next to both
  // the name and the location.
  const nameColorControlEl = canEdit ? (
    <HeroColorMenu which="name" textColor={nameColor} onText={handleNameColorChange} band={nameBg} onBand={handleNameBgChange} />
  ) : null;
  const locationColorControlEl = canEdit ? (
    <HeroColorMenu which="location" textColor={locationColor} onText={handleLocationColorChange} band={locationBg} onBand={handleLocationBgChange} />
  ) : null;

  // Set page title to the DJ's name (matches vanilla document.title)
  useEffect(() => {
    if (data.name) {
      document.title = `${data.name} - Global DJ Connect`;
    }
  }, [data.name]);

  // Lock body scroll while lightbox open (vanilla does this). Also reset zoom
  // to fit whenever the open photo changes or the lightbox closes.
  useEffect(() => {
    setLightboxZoom(1);
    if (lightboxSrc) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [lightboxSrc]);

  // ESC closes the lightbox; ← / → step through the photos currently shown
  // (the active album, or the visible feed). Uses a ref for the list + a
  // functional state update so the handler never goes stale.
  const lightboxListRef = useRef<string[]>([]);
  useEffect(() => {
    function step(dir: 1 | -1) {
      setLightboxSrc((cur) => {
        const listL = lightboxListRef.current;
        if (!cur || listL.length === 0) return cur;
        const i = listL.indexOf(cur);
        if (i < 0) return cur;
        const j = i + dir;
        return j >= 0 && j < listL.length ? listL[j] : cur;
      });
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxSrc(null);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
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

  // Mixes — array model (mix_urls) with legacy 3-slot fallback.
  const legacyMix = [data.mix_url_1, data.mix_url_2, data.mix_url_3].filter((u): u is string => !!u);
  const mixList: string[] = (Array.isArray((data as { mix_urls?: string[] }).mix_urls)
    && (data as { mix_urls?: string[] }).mix_urls!.length > 0)
    ? (data as { mix_urls?: string[] }).mix_urls!.filter((u): u is string => !!u)
    : legacyMix;
  // Paying (or comped) accounts get UNLIMITED mixes; free accounts stay capped.
  const mixCap = hasBookingAccess ? Infinity : 4;
  // Gallery — new array model (gallery_photos) with fallback to the legacy
  // 4 fixed slots so existing photos still show until re-saved.
  const legacyGallery = [data.gallery_img_1, data.gallery_img_2, data.gallery_img_3, data.gallery_img_4]
    .filter((u): u is string => !!u);
  const galleryPhotos: string[] = ((Array.isArray((data as { gallery_photos?: string[] }).gallery_photos)
    && (data as { gallery_photos?: string[] }).gallery_photos!.length > 0)
    ? (data as { gallery_photos?: string[] }).gallery_photos!.filter((u): u is string => !!u)
    : legacyGallery)
    // Drop anything deleted this session so the grid updates without a reload.
    .filter((u) => !deletedUrls.has(u));
  // Photo cap follows the DJ's tier: Pro 100, Premium Pro 350, Enterprise 1000
  // (Starter/Free lower). Reads straight off TIERS so the plans and the gallery
  // can never disagree about the limit.
  const photoCap = TIERS[effectiveTier(data as unknown as AccessFields)].photos;
  // Albums (Premium Pro + Enterprise). Parsed from the gallery_albums jsonb.
  // An album references URLs that also live in gallery_photos, so we filter to
  // the ones that still exist. Newest-first everywhere in the gallery.
  const albums: Album[] = parseAlbums((data as { gallery_albums?: unknown[] }).gallery_albums)
    .map((a) => ({ ...a, photos: a.photos.filter((u) => galleryPhotos.includes(u)) }))
    .filter((a) => a.photos.length > 0)
    // Live cover override (set-as-cover without a reload).
    .map((a) => (coverOverride[a.id] ? { ...a, cover: coverOverride[a.id] } : a));
  const galleryNewest = [...galleryPhotos].reverse();
  const activeAlbum = selectedAlbumId ? albums.find((a) => a.id === selectedAlbumId) || null : null;
  // What the grid shows: an album's photos (newest first) if one is selected,
  // otherwise the full feed capped to photoLimit for latency.
  const shownPhotos = activeAlbum
    ? [...activeAlbum.photos].reverse()
    : galleryNewest.slice(0, photoLimit);
  const canLoadMore = !activeAlbum && photoLimit < galleryNewest.length;
  // Keep the lightbox nav list in sync with what's on screen so ← / → walk
  // exactly the photos the viewer is looking at.
  lightboxListRef.current = shownPhotos;
  // Step the lightbox to the prev/next photo (shared by the arrow buttons and
  // the keyboard handler). Functional update + ref = never stale.
  const stepLightbox = (dir: 1 | -1) => {
    setLightboxSrc((cur) => {
      const listL = lightboxListRef.current;
      if (!cur || listL.length === 0) return cur;
      const i = listL.indexOf(cur);
      if (i < 0) return cur;
      const j = i + dir;
      return j >= 0 && j < listL.length ? listL[j] : cur;
    });
  };
  // Per-photo captions (url → text). Shown as a band in the lightbox. A live
  // override (captionOverride) wins so edits show without a page reload.
  const captions: Record<string, string> = captionOverride ?? (() => {
    const raw = (data as { gallery_captions?: unknown }).gallery_captions;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) out[k] = v;
    }
    return out;
  })();

  // ── Owner per-photo actions (pencil menu) ─────────────────────────────
  // Delete removes the URL from the gallery, prunes it from every album and
  // its caption, all in place (no reload). Download fetches the image and
  // saves it. Caption opens the inline editor; saveCaption persists the map.
  async function deletePhoto(url: string) {
    const ok = await confirm({
      title: 'Delete this photo?',
      message: 'It will be removed from your gallery and any albums it is in. This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    setPhotoBusy(true);
    try {
      const nextPhotos = galleryPhotos.filter((u) => u !== url);
      const nextAlbums = pruneAlbums(albums, nextPhotos);
      const nextCaptions = { ...captions };
      delete nextCaptions[url];
      await saveProfile(data.id, {
        gallery_photos: nextPhotos,
        gallery_albums: nextAlbums,
        gallery_captions: nextCaptions,
      }, actingAsMember);
      // Remove in place — no reload. If the open lightbox was this photo, close it.
      setDeletedUrls((prev) => new Set(prev).add(url));
      setCaptionOverride(nextCaptions);
      setLightboxSrc((cur) => (cur === url ? null : cur));
      setPhotoMenuFor(null);
      setPhotoBusy(false);
    } catch {
      setPhotoBusy(false);
      alert('Could not delete the photo.');
    }
  }
  async function downloadPhoto(url: string) {
    setPhotoMenuFor(null);
    try {
      const res = await fetch(url, { mode: 'cors' });
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = (url.split('/').pop() || 'photo').split('?')[0] || 'photo';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Fallback: open in a new tab so the viewer can save manually.
      window.open(url, '_blank', 'noopener');
    }
  }
  async function setAlbumCover(albumId: string, url: string) {
    setPhotoBusy(true);
    try {
      const nextAlbums = albums.map((a) => (a.id === albumId ? { ...a, cover: url } : a));
      await saveProfile(data.id, { gallery_albums: nextAlbums }, actingAsMember);
      // Update in place — no reload.
      setCoverOverride((prev) => ({ ...prev, [albumId]: url }));
      setPhotoMenuFor(null);
      setPhotoBusy(false);
    } catch {
      setPhotoBusy(false);
      alert('Could not set the album cover.');
    }
  }
  async function saveCaption(url: string, text: string) {
    setPhotoBusy(true);
    try {
      const nextCaptions = { ...captions };
      const t = text.trim();
      if (t) nextCaptions[url] = t;
      else delete nextCaptions[url];
      await saveProfile(data.id, { gallery_captions: nextCaptions }, actingAsMember);
      // Update in place — no reload.
      setCaptionOverride(nextCaptions);
      setCaptionFor(null);
      setPhotoMenuFor(null);
      setPhotoBusy(false);
    } catch {
      setPhotoBusy(false);
      alert('Could not save the caption.');
    }
  }

  // Shared style for the per-photo dropdown menu items.
  const photoMenuItem: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
    border: 'none', color: '#fff', padding: '.5rem .7rem', fontSize: '.8rem',
    cursor: 'pointer', borderRadius: 6,
  };

  // DJ's effective tier — albums (create/assign) are Premium Pro (3) + up.
  const djTier = effectiveTier(data as unknown as AccessFields);
  // Videos — array model (video_urls: {url,title,desc}[]) with legacy fallback.
  type VideoItem = { url: string; title: string | null; desc: string | null };
  const legacyVideos: VideoItem[] = [
    { url: data.video_url_1, title: data.video_title_1, desc: data.video_desc_1 },
    { url: data.video_url_2, title: data.video_title_2, desc: data.video_desc_2 },
    { url: data.video_url_3, title: data.video_title_3, desc: data.video_desc_3 },
  ].filter((v): v is VideoItem => !!v.url);
  const rawVideoArr = (data as { video_urls?: VideoItem[] }).video_urls;
  const videoList: VideoItem[] = (Array.isArray(rawVideoArr) && rawVideoArr.length > 0)
    ? rawVideoArr.filter((v) => v && !!v.url)
    : legacyVideos;
  // Paying (or comped) accounts get UNLIMITED videos; free accounts stay capped.
  const videoCap = hasBookingAccess ? Infinity : 3;

  // Testimonials (JSON-stringified, mobile DJs only)
  let testimonials: Testimonial[] = [];
  if (isMobileDJ && data.testimonials) {
    try {
      const parsed = JSON.parse(data.testimonials) as Testimonial[];
      if (Array.isArray(parsed)) testimonials = parsed;
    } catch { /* invalid JSON — silently ignore, vanilla does the same */ }
  }

  // FAQ (JSON-stringified, mobile DJs only)
  let faqs: Faq[] = [];
  if (isMobileDJ && data.faqs) {
    try {
      const parsed = JSON.parse(data.faqs) as Faq[];
      if (Array.isArray(parsed)) faqs = parsed;
    } catch { /* invalid JSON — silently ignore */ }
  }

  // About highlight cards (JSON-stringified, mobile DJs only)
  let aboutStats: AboutStats = {};
  if (isMobileDJ && data.about_stats) {
    try {
      const parsed = JSON.parse(data.about_stats) as AboutStats;
      if (parsed && typeof parsed === 'object') aboutStats = parsed;
    } catch { /* invalid JSON — silently ignore */ }
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
    faq: boolean;
  } = (() => {
    const defaults = {
      about: true,
      mixes: true,
      images: true,
      video: true,
      // Mobile DJs default testimonials OFF; club DJs ignored entirely.
      testimonials: !isMobileDJ,
      // FAQ tab: mobile DJs only, default OFF (owner turns it on).
      faq: false,
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
    isMobileDJ && tabVisibility.testimonials && (canEdit || testimonials.length > 0);
  // FAQ: same gating as testimonials. Owner sees it whenever enabled (even
  // empty) so they can add entries; visitors only when there's ≥1 FAQ.
  const showFaqTab =
    isMobileDJ && tabVisibility.faq && (canEdit || faqs.length > 0);

  // ── Tab order ───────────────────────────────────────────────────────
  // The owner can drag tabs into any order in the Edit Tabs modal; that order
  // is stored as a JSON array of keys on users.tab_order. Booking is always
  // pinned first and never part of this list. Any tabs missing from a saved
  // order (e.g. a newer tab) fall in at the end in their default order, so an
  // old saved order never hides a tab.
  const DEFAULT_TAB_ORDER: Array<Exclude<TabKey, 'booking'>> = [
    'about', 'mixes', 'images', 'video', 'testimonials', 'faq',
  ];
  const tabOrder: Array<Exclude<TabKey, 'booking'>> = (() => {
    const raw = data.tab_order;
    let saved: string[] = [];
    if (raw) {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) saved = parsed.filter((x): x is string => typeof x === 'string');
      } catch { /* bad JSON — fall back to default */ }
    }
    const allowed = new Set<string>(DEFAULT_TAB_ORDER);
    const seen = new Set<string>();
    const out: Array<Exclude<TabKey, 'booking'>> = [];
    for (const k of saved) {
      if (allowed.has(k) && !seen.has(k)) { out.push(k as Exclude<TabKey, 'booking'>); seen.add(k); }
    }
    for (const k of DEFAULT_TAB_ORDER) {
      if (!seen.has(k)) out.push(k);
    }
    return out;
  })();
  // Button descriptors, keyed for the ordered render below.
  const tabDefs: Record<Exclude<TabKey, 'booking'>, { label: string; show: boolean }> = {
    about: { label: 'About', show: tabVisibility.about },
    mixes: { label: 'Mixes', show: tabVisibility.mixes },
    images: { label: 'Photos', show: tabVisibility.images },
    video: { label: 'Video', show: tabVisibility.video },
    testimonials: { label: 'Testimonials', show: showTestimonialsTab },
    faq: { label: 'FAQ', show: showFaqTab },
  };

  // Avatar URL with object-position support
  const avatarPos = data.avatar_position || '50% 50%';

  // ── Tab-strip overflow hint ──────────────────────────────────────────
  // On narrow screens the tab row can hold more tabs than fit. It scrolls
  // sideways, but that isn't obvious — so we show a right-edge chevron
  // whenever there's more to the right, and hide it once scrolled to the
  // end. Tapping it nudges the row along.
  const tabsNavRef = useRef<HTMLElement | null>(null);
  const [tabsMoreRight, setTabsMoreRight] = useState(false);
  const [tabsMoreLeft, setTabsMoreLeft] = useState(false);
  useEffect(() => {
    const el = tabsNavRef.current;
    if (!el) return;
    const update = () => {
      setTabsMoreRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
      setTabsMoreLeft(el.scrollLeft > 4);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [tabVisibility, showBookingTab, showTestimonialsTab, showFaqTab]);

  function scrollTabsRight() {
    tabsNavRef.current?.scrollBy({ left: 140, behavior: 'smooth' });
  }
  function scrollTabsLeft() {
    tabsNavRef.current?.scrollBy({ left: -140, behavior: 'smooth' });
  }

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

  // Owner/editor view toggle — a compact pill that names the current mode and
  // switches to a live "public view" preview (all edit chrome hidden).
  // Session-only: a reload always returns to owner view. Rendered inline in the
  // booking calendar's header, next to "Embed Calendar" (desktop only) rather
  // than as a floating overlay — see where it's passed to the calendars below.
  const ownerViewToggle = baseCanEdit ? (
    // Two fixed segments — the highlight moves to the active one (the label text
    // never changes). Click a segment to switch mode.
    <div
      role="tablist"
      aria-label="Preview mode"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)',
        borderRadius: 999, padding: 2,
      }}
    >
      {([
        { on: false, label: 'Owner view' },
        { on: true, label: 'Public view' },
      ] as const).map((seg) => {
        const active = previewPublic === seg.on;
        return (
          <button
            key={seg.label}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setPreviewPublic(seg.on)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: active ? 'var(--neon,#00e0a4)' : 'transparent',
              color: active ? '#06231b' : 'rgba(255,255,255,.7)',
              border: 'none', borderRadius: 999, padding: '.28rem .7rem',
              fontSize: '.62rem', fontWeight: 700, letterSpacing: '.03em',
              textTransform: 'uppercase', cursor: active ? 'default' : 'pointer', whiteSpace: 'nowrap',
              transition: 'background .12s, color .12s',
            }}
          >
            {seg.on ? null : <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? '#06231b' : 'var(--neon,#00e0a4)' }} />}
            {seg.label}
          </button>
        );
      })}
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
        <div className={`${styles.hero} ${data.banner_url ? styles.heroHasBanner : ''}`} style={{ position: 'relative' }}>
          {saleActive && (
            <div
              style={{
                position: 'absolute', top: 0, right: 0, zIndex: 5,
                background: 'var(--neon,#00e0a4)', color: '#06231b',
                fontWeight: 800, fontSize: '.95rem', letterSpacing: '.04em',
                textTransform: 'uppercase',
                padding: '9px 18px', borderRadius: '0 0 0 14px',
                boxShadow: '0 2px 10px rgba(0,0,0,.35)',
              }}
            >
              {salePercent ? `${salePercent}% off all bookings` : 'Sale on all bookings'}
            </div>
          )}
          {/* BANNER — sits behind the hero content as a background layer.
              Read-only here; all edits happen inside the BannerEditModal
              that opens from the corner button. Both desktop and mobile
              positions are passed as CSS variables and a media query in
              profile.module.css picks the right one per viewport. */}
          {(data.banner_url || canEdit || data.dj_type) && (
            <div
              className={styles.banner}
              style={
                data.banner_url
                  ? ({
                      backgroundImage: `url(${optimizedImageUrl(data.banner_url)})`,
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
                  <BannerTypeEventsDropdown events={eventTypes} customTypes={parseCustomEventTypes((data as { mob_custom_event_types?: unknown }).mob_custom_event_types)} />
                ) : (
                  <div
                    className={`${styles.bannerNameBadge} ${styles.bannerNameBadgeClub}`}
                  >
                    Club / Bar DJ
                  </div>
                )
              )}
              {canEdit && (
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
          {/* Book Now + Message Us removed from the banner. Message now lives
              as a mail icon in the under-banner row (next to phone + Share);
              booking happens via the Availability tab / calendar. */}
          {/* Top row contains avatar; on mobile via media query, name+badges
              get displayed alongside in heroNameCol */}
          <div className={styles.heroTopRow}>
            {/* Avatar wrapper — relative-positioned so the camera
                badge can sit on top of the avatar circle without being
                clipped by .heroAvatar's overflow:hidden.
                When the owner has HIDDEN their picture, visitors see no
                avatar at all; the owner still sees it (dimmed) so they can
                toggle it back. Visitors also see NO circle by default until an
                image is actually added — an empty initials circle is owner-only
                (so they can tap the centred camera to add one). */}
            {(canEdit || (data.avatar_url && !data.avatar_hidden)) && (
            <div style={canEdit ? { position: 'relative', flexShrink: 0 } : undefined}>
              <div
                className={`${styles.heroAvatar} ${typeClass}`}
                style={canEdit && data.avatar_hidden ? { opacity: 0.4 } : undefined}
              >
                {data.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={data.avatar_url}
                    alt={data.name || 'DJ'}
                    style={{ objectPosition: avatarPos, cursor: 'zoom-in' }}
                    onClick={() => setLightboxSrc(data.avatar_url!)}
                  />
                ) : (
                  // Owner with no photo: leave the circle empty (camera + hint
                  // fill it). Visitors never see this empty circle. Initials
                  // still show as the fallback for a hidden-but-set avatar.
                  canEdit ? null : initials(data.name)
                )}
              </div>
              {/* Owner-only "Hidden" badge so they know visitors can't see it.
                  Only when a picture actually exists — with no image the centred
                  camera owns the middle of the circle. */}
              {canEdit && data.avatar_hidden && data.avatar_url && (
                <span style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  background: 'rgba(0,0,0,.75)',
                  color: '#fff',
                  fontFamily: "'Space Mono', monospace",
                  fontSize: '.6rem',
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  padding: '4px 8px',
                  borderRadius: 6,
                  pointerEvents: 'none',
                  zIndex: 3,
                  whiteSpace: 'nowrap',
                }}>Hidden</span>
              )}
              {/* Owner-only camera badge — always visible, signals
                  that the avatar can be changed. Click opens the native
                  file picker; the chosen file flows through AvatarCrop
                  modal for crop+upload, then we write the URL to users
                  and reload. Sits outside the avatar's overflow:hidden
                  clip so it always shows fully. */}
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={() => avatarFileInputRef.current?.click()}
                    title={data.avatar_url ? 'Change profile picture' : 'Add profile picture'}
                    aria-label={data.avatar_url ? 'Change profile picture' : 'Add profile picture'}
                    style={{
                      position: 'absolute',
                      // With an image the camera is a small badge in the corner;
                      // with no image yet it sits dead-centre in the circle as the
                      // clear "add a photo" affordance.
                      ...(data.avatar_url
                        ? { bottom: 6, right: 6 }
                        : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }),
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
                  {/* No photo yet: tell the owner this circle is hidden from
                      visitors until they add one (only THEY see this circle). */}
                  {!data.avatar_url && (
                    <span
                      className={styles.avatarHint}
                      style={{
                        position: 'absolute',
                        top: '68%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: '82%',
                        textAlign: 'center',
                        color: 'rgba(255,255,255,.45)',
                        fontFamily: "'Space Mono', monospace",
                        fontSize: '.5rem',
                        lineHeight: 1.35,
                        letterSpacing: '.02em',
                        pointerEvents: 'none',
                        zIndex: 2,
                      }}
                    >
                      This circle won&rsquo;t show to visitors until you add a photo.
                    </span>
                  )}
                  {/* Remove profile picture — only when one is set. Clears
                      users.avatar_url and reloads to show the initials fallback. */}
                  {data.avatar_url && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm('Remove your profile picture?')) return;
                        try {
                          await saveProfile(data.id, { avatar_url: null }, actingAsMember);
                          window.location.reload();
                        } catch (err) {
                          alert(err instanceof Error ? err.message : 'Could not remove picture.');
                        }
                      }}
                      title="Remove profile picture"
                      aria-label="Remove profile picture"
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: '#ff5f5f',
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
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                  {/* Hide / show toggle — hides the picture from visitors
                      entirely (kept in the DB so it can be un-hidden). Only shown
                      when a picture exists; an empty circle is already public-hidden. */}
                  {data.avatar_url && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await saveProfile(data.id, { avatar_hidden: !data.avatar_hidden }, actingAsMember);
                        window.location.reload();
                      } catch (err) {
                        alert(err instanceof Error ? err.message : 'Could not update.');
                      }
                    }}
                    title={data.avatar_hidden ? 'Show profile picture on your profile' : 'Hide profile picture from your profile'}
                    aria-label={data.avatar_hidden ? 'Show profile picture' : 'Hide profile picture'}
                    style={{
                      position: 'absolute',
                      top: 6,
                      left: 6,
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: data.avatar_hidden ? 'var(--neon)' : 'rgba(0,0,0,.75)',
                      border: '2px solid #000',
                      color: data.avatar_hidden ? '#000' : '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      padding: 0,
                      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.6)',
                      zIndex: 3,
                    }}
                  >
                    {data.avatar_hidden ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <path d="M1 1l22 22" />
                      </svg>
                    )}
                  </button>
                  )}
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
            )}
            {/* Mobile-only column: name + badges next to avatar. Location sits
                directly under the name here (mobile); on desktop it lives in
                heroInfo below and this whole column is display:none. */}
            <div className={styles.heroNameCol}>
              <div className={`${styles.heroName} ${nameSizeClass}`} style={{ color: nameColor }}>
                <span style={bandSpanStyle(nameBg)}>{data.name || 'Unknown DJ'}</span>
                {nameColorControlEl}
              </div>
              {heroBadgesEl}
              {location && (
                <div className={styles.heroLocation} style={{ color: locationColor }}>
                  <span style={bandSpanStyle(locationBg, 'location')}><LocationPinIcon /> {location}</span>
                  {locationColorControlEl}
                </div>
              )}
            </div>
          </div>

          {/* Hero info — name and badges visible on desktop, hidden on mobile
              via the descendant selector .heroInfo .heroName / .heroInfo .heroBadges
              inside the @media (max-width:900px) block in profile.module.css */}
          <div className={styles.heroInfo}>
            <div className={`${styles.heroName} ${nameSizeClass}`} style={{ color: nameColor }}>
              <span style={bandSpanStyle(nameBg)}>{data.name || 'Unknown DJ'}</span>
              {nameColorControlEl}
            </div>
            {heroBadgesEl}
            <div className={styles.heroMobileDivider} />

            {location && (
              <div className={styles.heroLocation} style={{ color: locationColor }}>
                <span style={bandSpanStyle(locationBg, 'location')}><LocationPinIcon /> {location}</span>
                {locationColorControlEl}
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

            {/* Phone + message moved out of the hero into the under-banner
                row (next to Share). Nothing else lived here. */}
          </div>
        </div>
        {/* Under-banner socials strip — full-width row sitting snug
            against the bottom of the hero/banner. Centered. Hosts the
            socials, then phone + message (mail), then Share. */}
        <UnderBannerSocials
          data={data}
          effectiveSlug={effectiveSlug}
          isOwnProfile={canEdit}
          bookingEnabled={bookingEnabled}
          onShareClick={() => setShareModalOpen(true)}
          isLoggedIn={isLoggedIn}
          onMessageClick={() => {
            // Owner can't message themselves; logged-out visitors are sent to
            // /login first, returning to the same profile.
            if (isOwnProfile) return;
            if (!requireVerified(`/${effectiveSlug}`)) return;
            setComposeOpen(true);
          }}
        />

        {/* BODY */}
        <div className={styles.body}>
          {/* Tabs section — Edit tabs button + pill-segmented nav share a
              centered container so the button aligns to the right edge of
              the pill bar (not the page). */}
          <div className={styles.tabsSection}>
            {canEdit && (
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
            <div className={styles.tabsNavWrap}>
            <nav className={styles.tabsNav} ref={tabsNavRef}>
            {showBookingTab && (
              <button
                className={tabClass('booking')}
                onClick={() => setActiveTab('booking')}
                type="button"
              >
                Booking
              </button>
            )}
            {/* Non-booking tabs render in the owner's chosen order
                (users.tab_order), each still gated by its own visibility. */}
            {tabOrder.map((key) => {
              const def = tabDefs[key];
              if (!def.show) return null;
              return (
                <button
                  key={key}
                  className={tabClass(key)}
                  onClick={() => setActiveTab(key)}
                  type="button"
                >
                  {def.label}
                </button>
              );
            })}
          </nav>
            {tabsMoreLeft && (
              <button
                type="button"
                className={`${styles.tabsScrollHint} ${styles.tabsScrollHintLeft}`}
                onClick={scrollTabsLeft}
                aria-label="Scroll tabs left"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}
            {tabsMoreRight && (
              <button
                type="button"
                className={styles.tabsScrollHint}
                onClick={scrollTabsRight}
                aria-label="Scroll tabs right"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            )}
          </div>
          </div>

          {/* Booking tab — different component for club vs mobile DJs */}
          {showClubAvailabilityTab && (
            <div id="booking-pane-anchor" className={paneClass('booking')} data-booking-anchor>
              {saleActive && (
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                  <div style={{ background: 'var(--neon,#00e0a4)', color: '#06231b', fontWeight: 800, fontSize: '.8rem', letterSpacing: '.04em', textTransform: 'uppercase', padding: '7px 16px', borderRadius: 999 }}>
                    {salePercent ? `${salePercent}% off all bookings` : 'Sale on all bookings'}
                  </div>
                </div>
              )}
              <PublicCalendar
                bookingDays={bookingSettings!.booking_days || {}}
                bookingWindowMonths={bookingSettings!.booking_window_months || 12}
                bookingSettings={bookingSettings!}
                djId={data.id}
                djSlug={effectiveSlug}
                djName={data.name || ''}
                // isLoggedIn on its own is a SERVER value, fixed when the
                // page was rendered. Someone who just made an account inside
                // the booking gate is signed in, but that prop still says
                // false — so the calendar would treat their next date tap as
                // logged-out and put the signup box back in front of them,
                // with no way through it. OR-ing in the live auth context
                // fixes it here rather than in the calendar, which is only
                // wrong because of what it's being told.
                isLoggedIn={isLoggedIn || !!currentUser}
                // In "View as public" preview mode the owner should see the
                // calendar exactly as a visitor does — no ✓/✗/pencil owner
                // controls — so drop isOwnProfile while previewing.
                isOwnProfile={isOwnProfile && !previewPublic}
                readOnly={viewerIsStaff}
                selectedDate={clubSelectedDate}
                onBookDate={(key) => {
                  if (viewerIsStaff) return; // staff view the calendar, can't book
                  if (!requireVerified(`/${effectiveSlug}?date=${key}&book=1`)) return;
                  setClubSelectedDate(key);
                }}
                onLoggedOutBookAttempt={(key) => setClubLoginGateDate(key)}
                onEmbedClick={isOwnProfile && !previewPublic ? () => setEmbedModalOpen(true) : undefined}
                onShareClick={() => setShareModalOpen(true)}
                ownerToggle={ownerViewToggle}
                force12mo={forceCalendar12mo}
                pendingDates={clubPendingDates}
              />
              {!isOwnProfile && !viewerIsStaff && clubSelectedDate && currentUser && currentUser.email_verified && (
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
                  // Account is created inside the gate now, so we come out of
                  // it signed in and still on this page. Close it and open the
                  // booking form on the date they picked before signing up —
                  // otherwise they're returned to the calendar to choose the
                  // same date over again.
                  onAuthed={(key) => {
                    setClubLoginGateDate(null);
                    setClubSelectedDate(key);
                  }}
                />
              )}
            </div>
          )}
          {showMobileBookingTab && (
            <div id="booking-pane-anchor" className={paneClass('booking')} data-booking-anchor>
              {saleActive && (
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                  <div style={{ background: 'var(--neon,#00e0a4)', color: '#06231b', fontWeight: 800, fontSize: '.8rem', letterSpacing: '.04em', textTransform: 'uppercase', padding: '7px 16px', borderRadius: 999 }}>
                    {salePercent ? `${salePercent}% off all bookings` : 'Sale on all bookings'}
                  </div>
                </div>
              )}
              <MobilePublicCalendar
                djId={data.id}
                djName={data.name || ''}
                djSlug={effectiveSlug}
                djEventTypes={data.event_types}
                djCustomEventTypes={(data as { mob_custom_event_types?: unknown }).mob_custom_event_types}
                djZip={data.zip}
                djTravelDistance={data.travel_distance}
                bookingSettings={bookingSettings!}
                isLoggedIn={isLoggedIn}
                // Same as the club calendar: preview mode renders as a visitor.
                isOwnProfile={isOwnProfile && !previewPublic}
                readOnly={viewerIsStaff}
                onEmbedClick={isOwnProfile && !previewPublic ? () => setEmbedModalOpen(true) : undefined}
                onShareClick={() => setShareModalOpen(true)}
                ownerToggle={ownerViewToggle}
                force12mo={forceCalendar12mo}
                pendingDates={clubPendingDates}
                onBookingSubmitted={() => setClubPendingRefreshKey((k) => k + 1)}
              />
            </div>
          )}

          {/* About tab — two-card framework: bio on the left, Quick Facts
              (mobile DJs) on the right; stacks on mobile. */}
          <div className={paneClass('about')}>
            <div className={styles.aboutGrid}>
              <div className={styles.aboutCard}>
                <div className={styles.aboutCardHeading}>About</div>
                {canEdit ? (
                  <OwnerEditableBio userId={data.id} initialBio={data.bio} />
                ) : data.bio ? (
                  <div
                    className={isMobileDJ ? styles.bioTextMobile : styles.bioText}
                    dangerouslySetInnerHTML={{ __html: sanitizeBioHtml(data.bio) }}
                  />
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
              {isMobileDJ && (
                <AboutStatsRow
                  userId={data.id}
                  isOwnProfile={canEdit}
                  stats={aboutStats}
                  travelDistance={data.travel_distance}
                />
              )}
            </div>
          </div>

          {/* Mixes tab */}
          <div className={paneClass('mixes')}>
            {mixList.length > 0 ? (
              <div className={styles.mediaList}>
                {mixList.map((mUrl, i) => {
                  const embed = buildMixEmbed(mUrl);
                  if (!embed) return null;
                  return (
                    <div
                      key={i}
                      className={styles.mediaEmbedWrap}
                      style={canEdit ? { position: 'relative' } : undefined}
                    >
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => deleteMix(i)}
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
                {canEdit && (
                  <MixAddButton
                    userId={data.id}
                    list={mixList}
                    cap={mixCap}
                    isPaid={hasBookingAccess}
                  />
                )}
              </div>
            ) : (
              <div className={styles.tabEmpty}>
                {canEdit ? (
                  <MixAddButton
                    userId={data.id}
                    list={mixList}
                    cap={mixCap}
                    isPaid={hasBookingAccess}
                    big
                  />
                ) : 'Coming Soon'}
              </div>
            )}
          </div>

          {/* Photos tab */}
          <div className={paneClass('images')}>
            {galleryPhotos.length > 0 ? (
              <>
                {/* Albums section — a text header, then the horizontal row of
                    album covers. */}
                {(albums.length > 0 || canEdit) && (
                  <div style={{ fontSize: '.72rem', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--white,#fff)', marginBottom: '.6rem' }}>
                    Albums{albums.length > 0 && <span style={{ color: 'var(--muted,#888)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}> · {albums.length}</span>}
                  </div>
                )}

                {/* Albums row — one horizontal strip that scrolls sideways when
                    there are more albums than fit. Clicking an album filters the
                    grid below to its photos. Cover thumbnails match the photo
                    grid tile size. Shows when the DJ has albums, or for the
                    owner (so the "New album" button is always reachable).
                    Sits ABOVE the "All photos" header. */}
                {(albums.length > 0 || canEdit) && (
                  <div style={{ display: 'flex', gap: '.6rem', overflowX: 'auto', paddingBottom: '.5rem', marginBottom: '1rem' }}>
                    {albums.map((a) => (
                      <div
                        key={a.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedAlbumId(a.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedAlbumId(a.id); }}
                        title={a.name}
                        style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer' }}
                      >
                        <span style={{ position: 'relative', display: 'block', width: 150, height: 150, borderRadius: 4, overflow: 'hidden', border: `1px solid ${activeAlbum?.id === a.id ? 'var(--neon)' : 'var(--border,rgba(255,255,255,.15))'}` }}>
                          {a.cover && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={optimizedImageUrl(a.cover, 360)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          )}
                          {/* Owner-only edit pencil, on the cover itself. */}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setEditAlbumTarget(a); }}
                              title="Edit album"
                              aria-label="Edit album"
                              style={{ position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(4px)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                            </button>
                          )}
                          <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 10px 8px', background: 'linear-gradient(transparent, rgba(0,0,0,.78))', color: '#fff', fontSize: '.78rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                        </span>
                        <span style={{ fontSize: '.62rem', color: 'var(--muted,#888)' }}>{a.photos.length} photos</span>
                      </div>
                    ))}
                    {/* Owner-only: create/manage albums (opens Manage Photos). */}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setCreateAlbumOpen(true)}
                        title="New album"
                        style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 4, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                      >
                        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, width: 150, height: 150, borderRadius: 4, border: '1px dashed var(--neon)', background: 'rgba(0,245,196,.05)', color: 'var(--neon)' }}>
                          <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>+</span>
                          <span style={{ fontSize: '.6rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>New album</span>
                        </span>
                        <span style={{ fontSize: '.62rem', color: 'transparent' }}>.</span>
                      </button>
                    )}
                  </div>
                )}

                {/* All photos — a back link to the full feed. */}
                {(albums.length > 0 || canEdit) && (
                  <button
                    type="button"
                    onClick={() => setSelectedAlbumId(null)}
                    title={activeAlbum ? 'Back to all photos' : 'All photos'}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', padding: 0, marginBottom: '.85rem', cursor: 'pointer', color: activeAlbum ? 'var(--neon)' : 'var(--white,#fff)', fontSize: '.72rem', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}
                  >
                    {activeAlbum && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
                    )}
                    <span>All photos</span>
                    <span style={{ color: 'var(--muted,#888)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {galleryPhotos.length} total</span>
                  </button>
                )}

                {/* Open-album header — centered text only, name and count on
                    separate lines. */}
                {activeAlbum && (
                  <div style={{ textAlign: 'center', margin: '.5rem 0 1.25rem' }}>
                    <div style={{ fontFamily: 'var(--disp, "Bebas Neue", sans-serif)', fontSize: '2rem', lineHeight: 1.05, color: '#fff', letterSpacing: '.02em' }}>{activeAlbum.name}</div>
                    <div style={{ fontSize: '.72rem', color: 'var(--muted,#888)', marginTop: 6 }}>{activeAlbum.photos.length} photos</div>
                  </div>
                )}

                <div className={styles.imageGrid}>
                  {/* Owner-only: compact "add photo" tile in the FIRST slot.
                      Smaller than a full photo tile so it reads as an action,
                      not a photo. Opens the manager (bulk multi-select upload). */}
                  {canEdit && !activeAlbum && galleryPhotos.length < photoCap && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <button
                        type="button"
                        onClick={() => setAddPhotosOpen(true)}
                        title="Add photos"
                        aria-label="Add photos"
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, width: '55%', maxWidth: 84, aspectRatio: '1 / 1', background: 'rgba(0,245,196,.06)', border: '1.5px dashed var(--neon)', borderRadius: 10, color: 'var(--neon)', cursor: 'pointer', padding: 0 }}
                      >
                        <span style={{ fontSize: '1.5rem', lineHeight: 1, fontWeight: 300 }}>+</span>
                        <span style={{ fontSize: '.52rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>Add</span>
                      </button>
                    </div>
                  )}
                  {shownPhotos.map((url, i) => (
                    <div key={`${url}-${i}`} style={{ position: 'relative' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={optimizedImageUrl(url, 500)}
                        alt={captions[url] || 'Gallery photo'}
                        loading="lazy"
                        onClick={() => setLightboxSrc(url)}
                      />
                      {/* Owner pencil → dropdown (delete / download / caption). */}
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setPhotoMenuFor((cur) => (cur === url ? null : url)); }}
                            title="Edit photo"
                            aria-label="Edit photo"
                            style={{ position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(4px)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, zIndex: 2 }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                          </button>
                          {photoMenuFor === url && (
                            <>
                              {/* Click-away backdrop to close the menu. */}
                              <div onClick={(e) => { e.stopPropagation(); setPhotoMenuFor(null); }} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                              <div
                                onClick={(e) => e.stopPropagation()}
                                style={{ position: 'absolute', top: 36, right: 6, zIndex: 41, minWidth: 150, background: '#14141b', border: '1px solid rgba(255,255,255,.14)', borderRadius: 10, boxShadow: '0 12px 30px rgba(0,0,0,.55)', overflow: 'hidden', padding: '.25rem' }}
                              >
                                <button type="button" onClick={() => { setCaptionDraft(captions[url] || ''); setCaptionFor(url); setPhotoMenuFor(null); }} style={photoMenuItem}>
                                  {captions[url] ? 'Edit caption' : 'Add caption'}
                                </button>
                                {activeAlbum && activeAlbum.photos.includes(url) && (
                                  <button type="button" disabled={photoBusy || activeAlbum.cover === url} onClick={() => setAlbumCover(activeAlbum.id, url)} style={{ ...photoMenuItem, opacity: activeAlbum.cover === url ? 0.5 : 1 }}>
                                    {activeAlbum.cover === url ? 'Album cover ✓' : 'Set as album cover'}
                                  </button>
                                )}
                                <button type="button" onClick={() => downloadPhoto(url)} style={photoMenuItem}>Download</button>
                                <button type="button" disabled={photoBusy} onClick={() => deletePhoto(url)} style={{ ...photoMenuItem, color: '#ff6b6b' }}>Delete</button>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* Paginated feed: only ~24 load at first; "Load more" fetches
                    the next batch so a large gallery never loads all at once. */}
                {canLoadMore && (
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
                    <button
                      type="button"
                      onClick={() => setPhotoLimit((n) => n + PHOTO_PAGE)}
                      style={{ background: 'transparent', border: '1px solid var(--border,rgba(255,255,255,.2))', color: 'var(--white,#fff)', borderRadius: 8, padding: '.6rem 1.4rem', fontSize: '.8rem', cursor: 'pointer' }}
                    >
                      Load more photos
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className={styles.tabEmpty}>
                {canEdit ? (
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
            {videoList.length > 0 ? (
              <div className={styles.videoList}>
                {videoList.map((v, i) => {
                  const embed = buildVideoEmbed(v.url);
                  if (!embed) return null;
                  return (
                    <div key={i} className={styles.videoCard} style={isOwnProfile ? { position: 'relative' } : undefined}>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => deleteVideo(i)}
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
                      {canEdit ? (
                        <VideoMetaEditor
                          userId={data.id}
                          list={videoList}
                          index={i}
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
                {canEdit && (
                  <VideoAddButton
                    userId={data.id}
                    list={videoList}
                    cap={videoCap}
                    isPaid={hasBookingAccess}
                  />
                )}
              </div>
            ) : (
              <div className={styles.tabEmpty}>
                {canEdit ? (
                  <VideoAddButton
                    userId={data.id}
                    list={videoList}
                    cap={videoCap}
                    isPaid={hasBookingAccess}
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
              {canEdit && testimonials.length === 0 && (
                <div className={styles.testimonialOwnerNote}>
                  Visitors won&apos;t see the Testimonials tab on your profile
                  until at least one is added.
                </div>
              )}
              {testimonials.map((t, i) => (
                <div key={i} className={styles.testimonialItem}>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm('Delete this testimonial?')) return;
                        try {
                          const next = testimonials.filter((_, idx) => idx !== i);
                          await saveProfile(data.id, { testimonials: JSON.stringify(next) }, actingAsMember);
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
              {canEdit && (
                <TestimonialAddForm
                  userId={data.id}
                  existing={testimonials}
                />
              )}
            </div>
          )}

          {/* FAQ tab — mobile DJs only. Owner adds question/answer pairs
              (one at a time, up to 10) with suggested questions; visitors
              see them read-only. Gated by showFaqTab (enabled + owner, or
              enabled + at least one FAQ for visitors). */}
          {showFaqTab && (
            <div className={paneClass('faq')}>
              {canEdit && faqs.length === 0 && (
                <div className={styles.testimonialOwnerNote}>
                  Visitors won&apos;t see the FAQ tab on your profile until at
                  least one question is added.
                </div>
              )}
              <FaqAccordion
                faqs={faqs}
                userId={data.id}
                isOwnProfile={canEdit}
              />
              {canEdit && faqs.length < 10 && (
                <FaqAddForm
                  userId={data.id}
                  existing={faqs}
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
          /* Wrap the image so the prev/next arrows can sit at the image's own
             left/right edges (not the far screen edges). */
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => e.stopPropagation()}>
            {lightboxListRef.current.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous photo"
                  onClick={(e) => { e.stopPropagation(); stepLightbox(-1); }}
                  style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 2 }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
                </button>
                <button
                  type="button"
                  aria-label="Next photo"
                  onClick={(e) => { e.stopPropagation(); stepLightbox(1); }}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 2 }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                </button>
              </>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxSrc}
              alt={captions[lightboxSrc] || ''}
              style={{ transform: `scale(${lightboxZoom})`, transition: 'transform .15s ease', transformOrigin: 'center center' }}
            />
            {/* Caption band — transparent black strip along the bottom of the
                photo, shown when this photo has a caption. */}
            {captions[lightboxSrc] && (
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '.7rem 1rem', background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: '.9rem', lineHeight: 1.35, textAlign: 'center', borderBottomLeftRadius: 8, borderBottomRightRadius: 8, pointerEvents: 'none' }}>
                {captions[lightboxSrc]}
              </div>
            )}
          </div>
        )}
        {/* Zoom controls — bottom center. Zoom out disabled at fit (1x). */}
        {lightboxSrc && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(4px)', borderRadius: 999, padding: '.3rem .4rem', zIndex: 3 }}
          >
            <button
              type="button"
              aria-label="Zoom out"
              disabled={lightboxZoom <= 1}
              onClick={(e) => { e.stopPropagation(); setLightboxZoom((z) => Math.max(1, Math.round((z - 0.5) * 10) / 10)); }}
              style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'transparent', color: '#fff', cursor: lightboxZoom <= 1 ? 'default' : 'pointer', opacity: lightboxZoom <= 1 ? 0.4 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
            </button>
            <span style={{ color: '#fff', fontSize: '.78rem', minWidth: 38, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{Math.round(lightboxZoom * 100)}%</span>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={lightboxZoom >= 4}
              onClick={(e) => { e.stopPropagation(); setLightboxZoom((z) => Math.min(4, Math.round((z + 0.5) * 10) / 10)); }}
              style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'transparent', color: '#fff', cursor: lightboxZoom >= 4 ? 'default' : 'pointer', opacity: lightboxZoom >= 4 ? 0.4 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
            </button>
          </div>
        )}
      </div>

      {/* Caption editor — owner-only. Small modal to write/edit the caption
          shown at the bottom of the photo in the lightbox. */}
      {captionFor && canEdit && (
        <div onClick={() => setCaptionFor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100, padding: '1rem' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#14141b', border: '1px solid rgba(255,255,255,.14)', borderRadius: 12, padding: '1.25rem', width: '100%', maxWidth: 420 }}>
            <div style={{ fontSize: '.95rem', fontWeight: 600, color: '#fff', marginBottom: '.75rem' }}>Photo caption</div>
            <textarea
              value={captionDraft}
              onChange={(e) => setCaptionDraft(e.target.value)}
              maxLength={200}
              rows={3}
              autoFocus
              placeholder="Write a caption…"
              style={{ width: '100%', padding: '.6rem .8rem', borderRadius: 8, border: '1px solid rgba(255,255,255,.25)', background: '#0c0c11', color: '#fff', fontSize: '.9rem', resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '.4rem' }}>
              <span style={{ fontSize: '.7rem', color: 'var(--muted,#888)' }}>{captionDraft.length}/200</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', marginTop: '.9rem' }}>
              <button type="button" onClick={() => setCaptionFor(null)} style={{ padding: '.5rem 1rem', borderRadius: 8, border: '1px solid rgba(255,255,255,.25)', background: 'transparent', color: '#fff', fontSize: '.8rem', cursor: 'pointer' }}>Cancel</button>
              <button type="button" disabled={photoBusy} onClick={() => saveCaption(captionFor, captionDraft)} style={{ padding: '.5rem 1.1rem', borderRadius: 8, border: 'none', background: 'var(--neon)', color: '#04121a', fontWeight: 700, fontSize: '.8rem', cursor: 'pointer', opacity: photoBusy ? 0.6 : 1 }}>{photoBusy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

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
      {pickedAvatarFile && canEdit && (
        <AvatarCrop
          file={pickedAvatarFile}
          userId={data.id}
          uploadFolder={profileUploadFolder(data.id)}
          onClose={() => {
            setPickedAvatarFile(null);
            // Reset the input so picking the same file again still fires
            // onChange (browsers skip duplicate file selections).
            if (avatarFileInputRef.current) avatarFileInputRef.current.value = '';
          }}
          onSuccess={async (publicUrl) => {
            try {
              await saveProfile(data.id, { avatar_url: publicUrl }, actingAsMember);
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
      {bannerModalOpen && canEdit && (
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
      {tabsModalOpen && canEdit && (
        <EditTabsModal
          userId={data.id}
          initial={tabVisibility}
          initialOrder={tabOrder}
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
      {photoManagerOpen && canEdit && (
        <PhotoManagerModal
          userId={data.id}
          photos={galleryPhotos}
          albums={albums}
          tier={djTier}
          cap={photoCap}
          isPaid={hasBookingAccess}
          onClose={() => {
            // Close the modal and re-fetch server data in place (no full page
            // reload, so the DJ stays on the Photos tab without a flash).
            setPhotoManagerOpen(false);
            router.refresh();
          }}
        />
      )}

      {/* Add photos — the simple "+ Add" flow: choose files, then Save. */}
      {addPhotosOpen && canEdit && (
        <AddPhotosModal
          userId={data.id}
          currentCount={galleryPhotos.length}
          cap={photoCap}
          onClose={() => {
            setAddPhotosOpen(false);
            router.refresh();
          }}
        />
      )}

      {/* Create Album — owner-only. Name it, add photos from device or pick
          existing; refreshes in place on close to show it. */}
      {createAlbumOpen && canEdit && (
        <CreateAlbumModal
          userId={data.id}
          photos={galleryPhotos}
          albums={albums}
          cap={photoCap}
          onClose={() => {
            setCreateAlbumOpen(false);
            router.refresh();
          }}
        />
      )}

      {/* Edit an existing album — same modal in edit mode (rename, add/remove
          photos, delete). */}
      {editAlbumTarget && canEdit && (
        <CreateAlbumModal
          userId={data.id}
          photos={galleryPhotos}
          albums={albums}
          cap={photoCap}
          editAlbum={editAlbumTarget}
          onClose={() => {
            setEditAlbumTarget(null);
            router.refresh();
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
