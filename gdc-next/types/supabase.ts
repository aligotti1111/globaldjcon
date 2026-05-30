// Database types for Global DJ Connect.
//
// HAND-WRITTEN to mirror the format `supabase gen types typescript` produces.
// When you eventually run that command, it'll overwrite this file with the
// authoritative version pulled from the live schema. Until then, this is
// the source of truth for the typed Supabase clients.
//
// Regenerate with:
//   npx supabase gen types typescript --project-id hwqvzuusquruhwguqole > types/supabase.ts
//
// HOW TO USE:
//   import type { Database } from '@/types/supabase';
//   const supabase = createBrowserClient<Database>(...);
//   const { data } = await supabase.from('users').select('id,name'); // typed!
//
// Pattern: every table has Row / Insert / Update variants:
//   - Row    = the shape returned from .select()
//   - Insert = required fields when calling .insert() (server defaults can be null)
//   - Update = all fields are optional, partial updates allowed

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      // ── public.users ────────────────────────────────────────────
      // Mirror of auth.users at the application level. Email LIVES IN
      // auth.users only — it is NOT replicated here. To get email for
      // a user id, use the admin client (lib/supabase/admin.ts).
      users: {
        Row: {
          id: string;
          name: string;
          role: 'dj' | 'venue' | 'host' | 'admin';
          slug: string | null;
          dj_type: 'mobile' | 'club' | null;
          // Address fields used for distance + display
          zip: string | null;
          city: string | null;
          state: string | null;
          country: string | null;
          address: string | null;
          // Pre-computed home coords — saves a Nominatim round-trip on
          // every distance check
          home_lat: number | null;
          home_lon: number | null;
          // DJ-specific fields
          phone: string | null;
          bio: string | null;
          start_year: number | null;
          travel_distance: string | null; // string because vanilla allows 'any'
          avatar_url: string | null;
          genres: string[] | null;
          event_types: string | null; // comma-joined list
          mixes: Json | null;
          videos: Json | null;
          photos: Json | null;
          socials: Json | null;
          testimonials: Json | null;
          // Venue-specific
          venue_name: string | null;
          // Booking config — stringified JSON (see bookingSettings.ts)
          booking_settings: string | null;
          // Privacy
          profile_private: boolean | null;
          email_verified: boolean;
          claimed: boolean | null;
          blocked_users: string[] | null;
          // Timestamps
          created_at: string;
          updated_at: string | null;
        };
        Insert: {
          id: string; // matches auth.users.id — never auto-generated
          name: string;
          role: 'dj' | 'venue' | 'host' | 'admin';
          slug?: string | null;
          dj_type?: 'mobile' | 'club' | null;
          zip?: string | null;
          city?: string | null;
          state?: string | null;
          country?: string | null;
          address?: string | null;
          home_lat?: number | null;
          home_lon?: number | null;
          phone?: string | null;
          bio?: string | null;
          start_year?: number | null;
          travel_distance?: string | null;
          avatar_url?: string | null;
          genres?: string[] | null;
          event_types?: string | null;
          mixes?: Json | null;
          videos?: Json | null;
          photos?: Json | null;
          socials?: Json | null;
          testimonials?: Json | null;
          venue_name?: string | null;
          booking_settings?: string | null;
          profile_private?: boolean | null;
          email_verified?: boolean;
          claimed?: boolean | null;
          blocked_users?: string[] | null;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          role?: 'dj' | 'venue' | 'host' | 'admin';
          slug?: string | null;
          dj_type?: 'mobile' | 'club' | null;
          zip?: string | null;
          city?: string | null;
          state?: string | null;
          country?: string | null;
          address?: string | null;
          home_lat?: number | null;
          home_lon?: number | null;
          phone?: string | null;
          bio?: string | null;
          start_year?: number | null;
          travel_distance?: string | null;
          avatar_url?: string | null;
          genres?: string[] | null;
          event_types?: string | null;
          mixes?: Json | null;
          videos?: Json | null;
          photos?: Json | null;
          socials?: Json | null;
          testimonials?: Json | null;
          venue_name?: string | null;
          booking_settings?: string | null;
          profile_private?: boolean | null;
          email_verified?: boolean;
          claimed?: boolean | null;
          blocked_users?: string[] | null;
          created_at?: string;
          updated_at?: string | null;
        };
      };

      // ── public.bookings ─────────────────────────────────────────
      // One row per booking request. Mobile + club bookings share this
      // table; differentiate via booking_type. Mobile-only fields
      // (cocktail_*, package_*, deposit_*) are NULL for club bookings.
      // Club-only fields (venue_type, set_type, equipment, offer_amount)
      // are NULL for mobile.
      bookings: {
        Row: {
          id: string;
          dj_id: string;
          requester_id: string;
          dj_slug: string | null;
          booking_type: 'mobile' | 'club' | null;
          // Event basics
          event_date: string | null; // YYYY-MM-DD
          event_type: string | null; // mobile only
          venue_name: string | null;
          venue_address: string | null;
          venue_lat: number | null;
          venue_lon: number | null;
          country: string | null;
          // Times
          start_time: string | null; // HH:MM (24h)
          end_time: string | null;
          // Mobile-specific
          room_details: string | null;
          guest_count: number | null;
          phone: string | null;
          cocktail_needed: boolean | null;
          cocktail_start_time: string | null;
          cocktail_same_room: boolean | null;
          cocktail_price: number | null;
          cocktail_included: boolean | null;
          package_title: string | null;
          package_category: string | null;
          package_index: number | null;
          package_details: string | null;
          // Club-specific
          venue_type: 'bar' | 'club' | null;
          set_type: string | null;
          equipment: 'sound_system' | 'decks_only' | 'venue_provides' | null;
          venue_equip_detail: string | null;
          offer_amount: number | null;
          // Pricing
          quoted_rate: number | null;
          counter_rate: number | null;
          overtime_rate: number | null;
          counter_message: string | null;
          deposit_pct: number | null;
          deposit_amount: number | null;
          currency: string | null;
          is_quote: boolean | null;
          // ISO timestamp set when DJ explicitly sends a drafted quote.
          // Null means rate may be drafted (quoted_rate set) but not yet
          // visible to booker. Club quote-mode flow only.
          quote_sent_at: string | null;
          // Negotiation history (JSON array of { from, amount, message, created_at })
          negotiation_log: Json | null;
          notes: string | null;
          status: 'pending' | 'approved' | 'denied' | 'counter' | 'cancelled' | null;
          created_at: string;
          updated_at: string | null;
        };
        Insert: {
          id?: string; // gen_random_uuid() default
          dj_id: string;
          requester_id: string;
          dj_slug?: string | null;
          booking_type?: 'mobile' | 'club' | null;
          event_date?: string | null;
          event_type?: string | null;
          venue_name?: string | null;
          venue_address?: string | null;
          venue_lat?: number | null;
          venue_lon?: number | null;
          country?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          room_details?: string | null;
          guest_count?: number | null;
          phone?: string | null;
          cocktail_needed?: boolean | null;
          cocktail_start_time?: string | null;
          cocktail_same_room?: boolean | null;
          cocktail_price?: number | null;
          cocktail_included?: boolean | null;
          package_title?: string | null;
          package_category?: string | null;
          package_index?: number | null;
          package_details?: string | null;
          venue_type?: 'bar' | 'club' | null;
          set_type?: string | null;
          equipment?: 'sound_system' | 'decks_only' | 'venue_provides' | null;
          venue_equip_detail?: string | null;
          offer_amount?: number | null;
          quoted_rate?: number | null;
          counter_rate?: number | null;
          overtime_rate?: number | null;
          counter_message?: string | null;
          deposit_pct?: number | null;
          deposit_amount?: number | null;
          currency?: string | null;
          is_quote?: boolean | null;
          quote_sent_at?: string | null;
          negotiation_log?: Json | null;
          notes?: string | null;
          status?: 'pending' | 'approved' | 'denied' | 'counter' | 'cancelled' | null;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          dj_id?: string;
          requester_id?: string;
          dj_slug?: string | null;
          booking_type?: 'mobile' | 'club' | null;
          event_date?: string | null;
          event_type?: string | null;
          venue_name?: string | null;
          venue_address?: string | null;
          venue_lat?: number | null;
          venue_lon?: number | null;
          country?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          room_details?: string | null;
          guest_count?: number | null;
          phone?: string | null;
          cocktail_needed?: boolean | null;
          cocktail_start_time?: string | null;
          cocktail_same_room?: boolean | null;
          cocktail_price?: number | null;
          cocktail_included?: boolean | null;
          package_title?: string | null;
          package_category?: string | null;
          package_index?: number | null;
          package_details?: string | null;
          venue_type?: 'bar' | 'club' | null;
          set_type?: string | null;
          equipment?: 'sound_system' | 'decks_only' | 'venue_provides' | null;
          venue_equip_detail?: string | null;
          offer_amount?: number | null;
          quoted_rate?: number | null;
          counter_rate?: number | null;
          overtime_rate?: number | null;
          counter_message?: string | null;
          deposit_pct?: number | null;
          deposit_amount?: number | null;
          currency?: string | null;
          is_quote?: boolean | null;
          quote_sent_at?: string | null;
          negotiation_log?: Json | null;
          notes?: string | null;
          status?: 'pending' | 'approved' | 'denied' | 'counter' | 'cancelled' | null;
          created_at?: string;
          updated_at?: string | null;
        };
      };

      // ── public.messages ─────────────────────────────────────────
      // Inbox messages between users. Top-level messages have
      // parent_id = null; replies set parent_id to the parent's id.
      messages: {
        Row: {
          id: string;
          parent_id: string | null;
          from_user_id: string | null;
          from_name: string | null;
          from_email: string | null;
          to_user_id: string;
          to_dj_slug: string | null;
          subject: string;
          message: string;
          read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          parent_id?: string | null;
          from_user_id?: string | null;
          from_name?: string | null;
          from_email?: string | null;
          to_user_id: string;
          to_dj_slug?: string | null;
          subject: string;
          message: string;
          read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          parent_id?: string | null;
          from_user_id?: string | null;
          from_name?: string | null;
          from_email?: string | null;
          to_user_id?: string;
          to_dj_slug?: string | null;
          subject?: string;
          message?: string;
          read?: boolean;
          created_at?: string;
        };
      };

      // ── public.profile_claims ───────────────────────────────────
      // Profile claim requests submitted from /claim. Admin reviews
      // them in the admin panel and approves → triggers a set-password
      // email so the claimant can take over the profile.
      profile_claims: {
        Row: {
          id: string;
          target_user_id: string | null;
          target_slug: string | null;
          target_biz_name: string;
          claimant_name: string;
          claimant_email: string;
          verify_msg: string | null;
          status: 'pending' | 'approved' | 'rejected';
          created_at: string;
          reviewed_at: string | null;
          reviewed_notes: string | null;
        };
        Insert: {
          id?: string;
          target_user_id?: string | null;
          target_slug?: string | null;
          target_biz_name: string;
          claimant_name: string;
          claimant_email: string;
          verify_msg?: string | null;
          status?: 'pending' | 'approved' | 'rejected';
          created_at?: string;
          reviewed_at?: string | null;
          reviewed_notes?: string | null;
        };
        Update: {
          id?: string;
          target_user_id?: string | null;
          target_slug?: string | null;
          target_biz_name?: string;
          claimant_name?: string;
          claimant_email?: string;
          verify_msg?: string | null;
          status?: 'pending' | 'approved' | 'rejected';
          created_at?: string;
          reviewed_at?: string | null;
          reviewed_notes?: string | null;
        };
      };

      // ── public.password_setup_tokens ────────────────────────────
      // One-time tokens emailed to claimants after admin approval.
      // User clicks link → submits new password → token marked used.
      password_setup_tokens: {
        Row: {
          token: string;
          user_id: string;
          created_at: string;
          expires_at: string;
          used_at: string | null;
        };
        Insert: {
          token: string;
          user_id: string;
          created_at?: string;
          expires_at: string;
          used_at?: string | null;
        };
        Update: {
          token?: string;
          user_id?: string;
          created_at?: string;
          expires_at?: string;
          used_at?: string | null;
        };
      };

      // ── public.email_verification_tokens ────────────────────────
      // Sent on signup. User clicks link → users.email_verified=true.
      email_verification_tokens: {
        Row: {
          token: string;
          user_id: string;
          email: string;
          created_at: string;
          expires_at: string;
          used_at: string | null;
        };
        Insert: {
          token: string;
          user_id: string;
          email: string;
          created_at?: string;
          expires_at: string;
          used_at?: string | null;
        };
        Update: {
          token?: string;
          user_id?: string;
          email?: string;
          created_at?: string;
          expires_at?: string;
          used_at?: string | null;
        };
      };

      // ── public.avatars ──────────────────────────────────────────
      // Tracks avatar image uploads (the actual binary lives in Storage).
      avatars: {
        Row: {
          user_id: string;
          path: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          path: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          path?: string;
          updated_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

// Helper type aliases that map closer to how the codebase already uses
// them. Code can import `Tables<'users'>` instead of writing the long
// path. Mirrors the helpers Supabase's CLI ships.
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
