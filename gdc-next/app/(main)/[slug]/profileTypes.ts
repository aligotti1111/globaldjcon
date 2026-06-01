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
  banner_url: string | null;
  banner_position: string | null;
  banner_position_mobile: string | null;
  tab_visibility: string | null;
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

export type TabKey = 'booking' | 'about' | 'mixes' | 'images' | 'video' | 'testimonials';
