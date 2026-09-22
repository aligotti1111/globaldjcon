// Shared types for the public DJ profile components.

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
  avatar_hidden: boolean | null;
  banner_url: string | null;
  banner_position: string | null;
  banner_position_mobile: string | null;
  // Owner-chosen hero name color (hex like #rrggbb). Null → default white.
  profile_name_color?: string | null;
  // Location text color, independent of the name. Null → falls back to the name
  // color so existing profiles are unchanged.
  profile_location_color?: string | null;
  // Optional semi-transparent color band behind the name / location (hex; null =
  // no band). Rendered at ~50% opacity behind just the text.
  profile_name_bg?: string | null;
  profile_location_bg?: string | null;
  tab_visibility: string | null;
  // Owner-chosen tab order — a JSON array of tab keys (the Booking tab is
  // always pinned first and is not part of this list). Null → default order.
  tab_order?: string | null;
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
  faqs: string | null;              // JSON-stringified — mobile DJs only
  about_stats: string | null;       // JSON-stringified — mobile DJs only
  booking_settings: string | null;  // JSON-stringified — see bookingSettings.ts
  mix_url_1: string | null;
  mix_url_2: string | null;
  mix_url_3: string | null;
  gallery_img_1: string | null;
  gallery_img_2: string | null;
  gallery_img_3: string | null;
  gallery_img_4: string | null;
  // New array-based gallery: all photos (URLs, newest appended last).
  gallery_photos?: string[] | null;
  // Photo albums grouping a subset of gallery_photos. jsonb — parse with
  // parseAlbums() from lib/albums.ts. Premium Pro + Enterprise create these.
  gallery_albums?: unknown[] | null;
  // Per-photo captions: a jsonb object mapping a gallery photo URL → caption
  // text. Shown as a band at the bottom of the photo in the lightbox.
  gallery_captions?: Record<string, string> | null;
  video_url_1: string | null;
  video_url_2: string | null;
  video_url_3: string | null;
  // Optional title + description per video, set by DJ in the inline
  // add form on the profile. Render in a frame around each video.
  video_title_1: string | null;
  video_title_2: string | null;
  video_title_3: string | null;
  video_desc_1: string | null;
  video_desc_2: string | null;
  video_desc_3: string | null;
}

export interface Testimonial {
  blurb?: string;
  name?: string;
  date?: string;
}

export interface Faq {
  question?: string;
  answer?: string;
}

// About-tab highlight cards (mobile DJs only). Each card the owner must
// activate (`on`) before it shows to visitors. Travel is auto-filled from
// travel_distance, so it carries only the `on` flag.
export interface AboutStats {
  travel?: { on?: boolean };
  established?: { on?: boolean; year?: number };
  events?: { on?: boolean; tier?: string };
  insured?: { on?: boolean };
  deposit?: { on?: boolean; value?: string };
  destination?: { on?: boolean };
  backup?: { on?: boolean };
  eventsTotal?: { on?: boolean; count?: string };
  depositRequired?: { on?: boolean; answer?: 'Yes' | 'No' };
}

export type TabKey = 'booking' | 'about' | 'mixes' | 'images' | 'video' | 'testimonials' | 'faq';
