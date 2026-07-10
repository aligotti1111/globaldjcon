export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      booking_drafts: {
        Row: {
          created_at: string | null
          data: Json | null
          dj_id: string
          dj_slug: string | null
          id: string
          requester_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          dj_id: string
          dj_slug?: string | null
          id?: string
          requester_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          dj_id?: string
          dj_slug?: string | null
          id?: string
          requester_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      booking_notes: {
        Row: {
          author_id: string
          booking_id: string
          content: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          booking_id: string
          content: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          booking_id?: string
          content?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_notes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          created_at: string
          dj_id: string
          docuseal_template_id: string | null
          id: string
          is_standard: boolean
          logo_url: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dj_id: string
          docuseal_template_id?: string | null
          id?: string
          is_standard?: boolean
          logo_url?: string | null
          name?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dj_id?: string
          docuseal_template_id?: string | null
          id?: string
          is_standard?: boolean
          logo_url?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_dj_id_fkey"
            columns: ["dj_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          contract_id: string | null
          booking_type: string | null
          cocktail_included: boolean | null
          cocktail_needed: boolean | null
          cocktail_price: number | null
          cocktail_same_room: boolean | null
          cocktail_start_time: string | null
          counter_message: string | null
          counter_rate: number | null
          country: string | null
          created_at: string | null
          currency: string | null
          deposit_amount: number | null
          deposit_pct: number | null
          dj_email: string | null
          dj_id: string | null
          dj_name: string | null
          dj_slug: string | null
          dj_type: string | null
          end_time: string | null
          equipment: string | null
          equipment_needed: string | null
          event_date: string | null
          event_details: string | null
          event_type: string | null
          flyer_url: string | null
          guest_count: number | null
          host_email: string | null
          host_email_sent_at: string | null
          id: string
          is_manual: boolean
          is_quote: boolean | null
          link_label: string | null
          link_url: string | null
          negotiation_log: Json | null
          notes: string | null
          offer_amount: number | null
          overtime_rate: number | null
          package_category: string | null
          package_details: string | null
          package_index: number | null
          package_photos: string | null
          package_title: string | null
          phone: string | null
          quote_sent_at: string | null
          quoted_rate: number | null
          rate: number | null
          requester_id: string
          requester_name: string | null
          room_details: string | null
          set_type: string | null
          setup_hours: string | null
          start_time: string | null
          status: string | null
          tier_stamp: number | null
          updated_at: string | null
          venue_address: string | null
          venue_decks: string | null
          venue_equip_detail: string | null
          venue_lat: number | null
          venue_lon: number | null
          venue_name: string | null
          venue_type: string | null
        }
        Insert: {
          contract_id?: string | null
          booking_type?: string | null
          cocktail_included?: boolean | null
          cocktail_needed?: boolean | null
          cocktail_price?: number | null
          cocktail_same_room?: boolean | null
          cocktail_start_time?: string | null
          counter_message?: string | null
          counter_rate?: number | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          deposit_amount?: number | null
          deposit_pct?: number | null
          dj_email?: string | null
          dj_id?: string | null
          dj_name?: string | null
          dj_slug?: string | null
          dj_type?: string | null
          end_time?: string | null
          equipment?: string | null
          equipment_needed?: string | null
          event_date?: string | null
          event_details?: string | null
          event_type?: string | null
          flyer_url?: string | null
          guest_count?: number | null
          host_email?: string | null
          host_email_sent_at?: string | null
          id?: string
          is_manual?: boolean
          is_quote?: boolean | null
          link_label?: string | null
          link_url?: string | null
          negotiation_log?: Json | null
          notes?: string | null
          offer_amount?: number | null
          overtime_rate?: number | null
          package_category?: string | null
          package_details?: string | null
          package_index?: number | null
          package_photos?: string | null
          package_title?: string | null
          phone?: string | null
          quote_sent_at?: string | null
          quoted_rate?: number | null
          rate?: number | null
          requester_id: string
          requester_name?: string | null
          room_details?: string | null
          set_type?: string | null
          setup_hours?: string | null
          start_time?: string | null
          status?: string | null
          tier_stamp?: number | null
          updated_at?: string | null
          venue_address?: string | null
          venue_decks?: string | null
          venue_equip_detail?: string | null
          venue_lat?: number | null
          venue_lon?: number | null
          venue_name?: string | null
          venue_type?: string | null
        }
        Update: {
          contract_id?: string | null
          booking_type?: string | null
          cocktail_included?: boolean | null
          cocktail_needed?: boolean | null
          cocktail_price?: number | null
          cocktail_same_room?: boolean | null
          cocktail_start_time?: string | null
          counter_message?: string | null
          counter_rate?: number | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          deposit_amount?: number | null
          deposit_pct?: number | null
          dj_email?: string | null
          dj_id?: string | null
          dj_name?: string | null
          dj_slug?: string | null
          dj_type?: string | null
          end_time?: string | null
          equipment?: string | null
          equipment_needed?: string | null
          event_date?: string | null
          event_details?: string | null
          event_type?: string | null
          flyer_url?: string | null
          guest_count?: number | null
          host_email?: string | null
          host_email_sent_at?: string | null
          id?: string
          is_manual?: boolean
          is_quote?: boolean | null
          link_label?: string | null
          link_url?: string | null
          negotiation_log?: Json | null
          notes?: string | null
          offer_amount?: number | null
          overtime_rate?: number | null
          package_category?: string | null
          package_details?: string | null
          package_index?: number | null
          package_photos?: string | null
          package_title?: string | null
          phone?: string | null
          quote_sent_at?: string | null
          quoted_rate?: number | null
          rate?: number | null
          requester_id?: string
          requester_name?: string | null
          room_details?: string | null
          set_type?: string | null
          setup_hours?: string | null
          start_time?: string | null
          status?: string | null
          tier_stamp?: number | null
          updated_at?: string | null
          venue_address?: string | null
          venue_decks?: string | null
          venue_equip_detail?: string | null
          venue_lat?: number | null
          venue_lon?: number | null
          venue_name?: string | null
          venue_type?: string | null
        }
        Relationships: []
      }
      email_verification_tokens: {
        Row: {
          booking_redirect: string | null
          email: string
          expires_at: string
          token: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          booking_redirect?: string | null
          email: string
          expires_at: string
          token: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          booking_redirect?: string | null
          email?: string
          expires_at?: string
          token?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          created_at: string | null
          deleted_by_recipient: boolean
          deleted_by_sender: boolean
          from_email: string | null
          from_name: string | null
          from_user_id: string | null
          id: string
          message: string | null
          parent_id: string | null
          read: boolean | null
          subject: string | null
          to_dj_slug: string | null
          to_user_id: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_by_recipient?: boolean
          deleted_by_sender?: boolean
          from_email?: string | null
          from_name?: string | null
          from_user_id?: string | null
          id?: string
          message?: string | null
          parent_id?: string | null
          read?: boolean | null
          subject?: string | null
          to_dj_slug?: string | null
          to_user_id?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_by_recipient?: boolean
          deleted_by_sender?: boolean
          from_email?: string | null
          from_name?: string | null
          from_user_id?: string | null
          id?: string
          message?: string | null
          parent_id?: string | null
          read?: boolean | null
          subject?: string | null
          to_dj_slug?: string | null
          to_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      password_setup_tokens: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          token: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at: string
          token: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          token?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profile_claims: {
        Row: {
          claimant_email: string
          claimant_name: string
          created_at: string
          id: string
          reviewed_at: string | null
          reviewed_notes: string | null
          status: string
          target_biz_name: string
          target_slug: string
          target_user_id: string | null
          updated_at: string
          verify_msg: string | null
        }
        Insert: {
          claimant_email: string
          claimant_name: string
          created_at?: string
          id?: string
          reviewed_at?: string | null
          reviewed_notes?: string | null
          status?: string
          target_biz_name: string
          target_slug: string
          target_user_id?: string | null
          updated_at?: string
          verify_msg?: string | null
        }
        Update: {
          claimant_email?: string
          claimant_name?: string
          created_at?: string
          id?: string
          reviewed_at?: string | null
          reviewed_notes?: string | null
          status?: string
          target_biz_name?: string
          target_slug?: string
          target_user_id?: string | null
          updated_at?: string
          verify_msg?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_claims_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          address: string | null
          availability: string | null
          avatar_position: string | null
          avatar_url: string | null
          banner_position: string | null
          banner_position_mobile: string | null
          banner_url: string | null
          bio: string | null
          blocked_users: string[] | null
          booking_settings: Json | null
          city: string | null
          claimed: boolean
          club_genres: string[] | null
          comp_expires_at: string | null
          comp_source: string | null
          comp_tier: number | null
          company: string | null
          contact_email: string | null
          country: string | null
          created_at: string | null
          dj_start_year: number | null
          dj_type: string | null
          email_notify_booking_request: boolean
          email_notify_booking_status: boolean
          email_notify_inbox_message: boolean
          email_verified: boolean
          email_verified_at: string | null
          event_types: string | null
          facebook: string | null
          gallery_img_1: string | null
          gallery_img_2: string | null
          gallery_img_3: string | null
          gallery_img_4: string | null
          genres: string[] | null
          home_lat: number | null
          home_lon: number | null
          id: string
          instagram: string | null
          mix_url_1: string | null
          mix_url_2: string | null
          mix_url_3: string | null
          name: string | null
          phone: string | null
          profile_private: boolean | null
          rate: string | null
          real_name: string | null
          role: string
          slug: string | null
          sms_enabled: boolean
          sms_notify_booking_request: boolean
          sms_notify_booking_status: boolean
          sms_notify_inbox_message: boolean
          sms_phone: string | null
          soundcloud: string | null
          state: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          sub_period_end: string | null
          sub_status: string
          sub_tier: number
          tab_visibility: Json | null
          testimonials: string | null
          tiktok: string | null
          travel_distance: string | null
          twitch: string | null
          updated_at: string | null
          venue_name: string | null
          video_desc_1: string | null
          video_desc_2: string | null
          video_desc_3: string | null
          video_title_1: string | null
          video_title_2: string | null
          video_title_3: string | null
          video_url_1: string | null
          video_url_2: string | null
          video_url_3: string | null
          website: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          availability?: string | null
          avatar_position?: string | null
          avatar_url?: string | null
          banner_position?: string | null
          banner_position_mobile?: string | null
          banner_url?: string | null
          bio?: string | null
          blocked_users?: string[] | null
          booking_settings?: Json | null
          city?: string | null
          claimed?: boolean
          club_genres?: string[] | null
          comp_expires_at?: string | null
          comp_source?: string | null
          comp_tier?: number | null
          company?: string | null
          contact_email?: string | null
          country?: string | null
          created_at?: string | null
          dj_start_year?: number | null
          dj_type?: string | null
          email_notify_booking_request?: boolean
          email_notify_booking_status?: boolean
          email_notify_inbox_message?: boolean
          email_verified?: boolean
          email_verified_at?: string | null
          event_types?: string | null
          facebook?: string | null
          gallery_img_1?: string | null
          gallery_img_2?: string | null
          gallery_img_3?: string | null
          gallery_img_4?: string | null
          genres?: string[] | null
          home_lat?: number | null
          home_lon?: number | null
          id: string
          instagram?: string | null
          mix_url_1?: string | null
          mix_url_2?: string | null
          mix_url_3?: string | null
          name?: string | null
          phone?: string | null
          profile_private?: boolean | null
          rate?: string | null
          real_name?: string | null
          role: string
          slug?: string | null
          sms_enabled?: boolean
          sms_notify_booking_request?: boolean
          sms_notify_booking_status?: boolean
          sms_notify_inbox_message?: boolean
          sms_phone?: string | null
          soundcloud?: string | null
          state?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          sub_period_end?: string | null
          sub_status?: string
          sub_tier?: number
          tab_visibility?: Json | null
          testimonials?: string | null
          tiktok?: string | null
          travel_distance?: string | null
          twitch?: string | null
          updated_at?: string | null
          venue_name?: string | null
          video_desc_1?: string | null
          video_desc_2?: string | null
          video_desc_3?: string | null
          video_title_1?: string | null
          video_title_2?: string | null
          video_title_3?: string | null
          video_url_1?: string | null
          video_url_2?: string | null
          video_url_3?: string | null
          website?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          availability?: string | null
          avatar_position?: string | null
          avatar_url?: string | null
          banner_position?: string | null
          banner_position_mobile?: string | null
          banner_url?: string | null
          bio?: string | null
          blocked_users?: string[] | null
          booking_settings?: Json | null
          city?: string | null
          claimed?: boolean
          club_genres?: string[] | null
          comp_expires_at?: string | null
          comp_source?: string | null
          comp_tier?: number | null
          company?: string | null
          contact_email?: string | null
          country?: string | null
          created_at?: string | null
          dj_start_year?: number | null
          dj_type?: string | null
          email_notify_booking_request?: boolean
          email_notify_booking_status?: boolean
          email_notify_inbox_message?: boolean
          email_verified?: boolean
          email_verified_at?: string | null
          event_types?: string | null
          facebook?: string | null
          gallery_img_1?: string | null
          gallery_img_2?: string | null
          gallery_img_3?: string | null
          gallery_img_4?: string | null
          genres?: string[] | null
          home_lat?: number | null
          home_lon?: number | null
          id?: string
          instagram?: string | null
          mix_url_1?: string | null
          mix_url_2?: string | null
          mix_url_3?: string | null
          name?: string | null
          phone?: string | null
          profile_private?: boolean | null
          rate?: string | null
          real_name?: string | null
          role?: string
          slug?: string | null
          sms_enabled?: boolean
          sms_notify_booking_request?: boolean
          sms_notify_booking_status?: boolean
          sms_notify_inbox_message?: boolean
          sms_phone?: string | null
          soundcloud?: string | null
          state?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          sub_period_end?: string | null
          sub_status?: string
          sub_tier?: number
          tab_visibility?: Json | null
          testimonials?: string | null
          tiktok?: string | null
          travel_distance?: string | null
          twitch?: string | null
          updated_at?: string | null
          venue_name?: string | null
          video_desc_1?: string | null
          video_desc_2?: string | null
          video_desc_3?: string | null
          video_title_1?: string | null
          video_title_2?: string | null
          video_title_3?: string | null
          video_url_1?: string | null
          video_url_2?: string | null
          video_url_3?: string | null
          website?: string | null
          zip?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      clear_email_confirmation: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      dj_effective_tier: { Args: { dj: string }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
