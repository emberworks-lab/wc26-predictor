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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bracket_predictions: {
        Row: {
          aet_pens: boolean | null
          away_score: number | null
          away_team_id: number | null
          entry_id: string
          generation: number
          home_score: number | null
          home_team_id: number | null
          id: number
          slot: number
          updated_at: string
          winner_team_id: number
        }
        Insert: {
          aet_pens?: boolean | null
          away_score?: number | null
          away_team_id?: number | null
          entry_id: string
          generation?: number
          home_score?: number | null
          home_team_id?: number | null
          id?: never
          slot: number
          updated_at?: string
          winner_team_id: number
        }
        Update: {
          aet_pens?: boolean | null
          away_score?: number | null
          away_team_id?: number | null
          entry_id?: string
          generation?: number
          home_score?: number | null
          home_team_id?: number | null
          id?: never
          slot?: number
          updated_at?: string
          winner_team_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "bracket_predictions_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bracket_predictions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "challenge_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bracket_predictions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_entry_rows"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "bracket_predictions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_totals"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "bracket_predictions_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bracket_predictions_winner_team_id_fkey"
            columns: ["winner_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_entries: {
        Row: {
          challenge_id: number
          created_at: string
          hardcore: boolean
          id: string
          user_id: string
        }
        Insert: {
          challenge_id: number
          created_at?: string
          hardcore?: boolean
          id?: string
          user_id: string
        }
        Update: {
          challenge_id?: number
          created_at?: string
          hardcore?: boolean
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_entries_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          created_at: string
          id: number
          kind: Database["public"]["Enums"]["challenge_kind"]
          locks_at: string | null
          manual_override: string | null
          opens_at: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          kind: Database["public"]["Enums"]["challenge_kind"]
          locks_at?: string | null
          manual_override?: string | null
          opens_at?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          kind?: Database["public"]["Enums"]["challenge_kind"]
          locks_at?: string | null
          manual_override?: string | null
          opens_at?: string | null
        }
        Relationships: []
      }
      entry_stats: {
        Row: {
          computed_at: string
          correct_ko_picks: number
          correct_outcomes: number
          correct_qualifiers: number
          entry_id: string
        }
        Insert: {
          computed_at?: string
          correct_ko_picks?: number
          correct_outcomes?: number
          correct_qualifiers?: number
          entry_id: string
        }
        Update: {
          computed_at?: string
          correct_ko_picks?: number
          correct_outcomes?: number
          correct_qualifiers?: number
          entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entry_stats_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "challenge_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_stats_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "leaderboard_entry_rows"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "entry_stats_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "leaderboard_totals"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      fun_answers: {
        Row: {
          bool_answer: boolean | null
          entry_id: string
          id: number
          numeric_answer: number | null
          question_id: number
          text_answer: string | null
          updated_at: string
        }
        Insert: {
          bool_answer?: boolean | null
          entry_id: string
          id?: never
          numeric_answer?: number | null
          question_id: number
          text_answer?: string | null
          updated_at?: string
        }
        Update: {
          bool_answer?: boolean | null
          entry_id?: string
          id?: never
          numeric_answer?: number | null
          question_id?: number
          text_answer?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fun_answers_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "challenge_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fun_answers_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_entry_rows"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "fun_answers_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_totals"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "fun_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "fun_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      fun_questions: {
        Row: {
          correct_bool: boolean | null
          correct_numeric: number | null
          correct_text: string | null
          id: number
          key: string
          max_pts: number
          qtype: Database["public"]["Enums"]["fun_question_type"]
          sort_order: number
          tolerance: number | null
        }
        Insert: {
          correct_bool?: boolean | null
          correct_numeric?: number | null
          correct_text?: string | null
          id?: never
          key: string
          max_pts: number
          qtype: Database["public"]["Enums"]["fun_question_type"]
          sort_order?: number
          tolerance?: number | null
        }
        Update: {
          correct_bool?: boolean | null
          correct_numeric?: number | null
          correct_text?: string | null
          id?: never
          key?: string
          max_pts?: number
          qtype?: Database["public"]["Enums"]["fun_question_type"]
          sort_order?: number
          tolerance?: number | null
        }
        Relationships: []
      }
      leaderboard_snapshots: {
        Row: {
          board: string
          challenge_id: number | null
          id: number
          matchday_date: string
          points: number
          rank: number
          taken_at: string
          user_id: string
        }
        Insert: {
          board: string
          challenge_id?: number | null
          id?: never
          matchday_date: string
          points: number
          rank: number
          taken_at?: string
          user_id: string
        }
        Update: {
          board?: string
          challenge_id?: number | null
          id?: never
          matchday_date?: string
          points?: number
          rank?: number
          taken_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_snapshots_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboard_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_predictions: {
        Row: {
          away_score: number | null
          entry_id: string
          home_score: number | null
          id: number
          match_id: number
          outcome: Database["public"]["Enums"]["prediction_outcome"]
          updated_at: string
        }
        Insert: {
          away_score?: number | null
          entry_id: string
          home_score?: number | null
          id?: never
          match_id: number
          outcome: Database["public"]["Enums"]["prediction_outcome"]
          updated_at?: string
        }
        Update: {
          away_score?: number | null
          entry_id?: string
          home_score?: number | null
          id?: never
          match_id?: number
          outcome?: Database["public"]["Enums"]["prediction_outcome"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_predictions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "challenge_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_predictions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_entry_rows"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "match_predictions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_totals"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "match_predictions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          api_id: number
          away_pens: number | null
          away_score: number | null
          away_score_et: number | null
          away_team_id: number | null
          fifa_match_number: number | null
          group_code: string | null
          home_pens: number | null
          home_score: number | null
          home_score_et: number | null
          home_team_id: number | null
          id: number
          kickoff_utc: string
          manually_corrected: boolean
          matchday: number | null
          stage: Database["public"]["Enums"]["match_stage"]
          status: Database["public"]["Enums"]["match_status"]
          updated_at: string
          winner_team_id: number | null
        }
        Insert: {
          api_id: number
          away_pens?: number | null
          away_score?: number | null
          away_score_et?: number | null
          away_team_id?: number | null
          fifa_match_number?: number | null
          group_code?: string | null
          home_pens?: number | null
          home_score?: number | null
          home_score_et?: number | null
          home_team_id?: number | null
          id?: never
          kickoff_utc: string
          manually_corrected?: boolean
          matchday?: number | null
          stage: Database["public"]["Enums"]["match_stage"]
          status?: Database["public"]["Enums"]["match_status"]
          updated_at?: string
          winner_team_id?: number | null
        }
        Update: {
          api_id?: number
          away_pens?: number | null
          away_score?: number | null
          away_score_et?: number | null
          away_team_id?: number | null
          fifa_match_number?: number | null
          group_code?: string | null
          home_pens?: number | null
          home_score?: number | null
          home_score_et?: number | null
          home_team_id?: number | null
          id?: never
          kickoff_utc?: string
          manually_corrected?: boolean
          matchday?: number | null
          stage?: Database["public"]["Enums"]["match_stage"]
          status?: Database["public"]["Enums"]["match_status"]
          updated_at?: string
          winner_team_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_winner_team_id_fkey"
            columns: ["winner_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      points: {
        Row: {
          category: string
          computed_at: string
          entry_id: string
          hardcore: boolean
          id: number
          points: number
          ref: Json | null
        }
        Insert: {
          category: string
          computed_at?: string
          entry_id: string
          hardcore?: boolean
          id?: never
          points: number
          ref?: Json | null
        }
        Update: {
          category?: string
          computed_at?: string
          entry_id?: string
          hardcore?: boolean
          id?: never
          points?: number
          ref?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "points_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "challenge_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_entry_rows"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "points_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_totals"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      profiles: {
        Row: {
          banned_at: string | null
          created_at: string
          display_name: string
          id: string
          locale: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          banned_at?: string | null
          created_at?: string
          display_name: string
          id: string
          locale?: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          banned_at?: string | null
          created_at?: string
          display_name?: string
          id?: string
          locale?: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
      }
      redistributions: {
        Row: {
          created_at: string
          entry_id: string
          generation: number
          id: number
          multiplier: number
          stage: Database["public"]["Enums"]["match_stage"]
        }
        Insert: {
          created_at?: string
          entry_id: string
          generation: number
          id?: never
          multiplier: number
          stage: Database["public"]["Enums"]["match_stage"]
        }
        Update: {
          created_at?: string
          entry_id?: string
          generation?: number
          id?: never
          multiplier?: number
          stage?: Database["public"]["Enums"]["match_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "redistributions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "challenge_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redistributions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_entry_rows"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "redistributions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_totals"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      scorers_cache: {
        Row: {
          assists: number | null
          goals: number
          id: number
          penalties: number | null
          player_name: string
          team_id: number | null
          updated_at: string
        }
        Insert: {
          assists?: number | null
          goals?: number
          id?: never
          penalties?: number | null
          player_name: string
          team_id?: number | null
          updated_at?: string
        }
        Update: {
          assists?: number | null
          goals?: number
          id?: never
          penalties?: number | null
          player_name?: string
          team_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scorers_cache_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      standings_cache: {
        Row: {
          drawn: number
          goal_difference: number
          goals_against: number
          goals_for: number
          group_code: string
          lost: number
          played: number
          points: number
          position: number
          team_id: number
          updated_at: string
          won: number
        }
        Insert: {
          drawn?: number
          goal_difference?: number
          goals_against?: number
          goals_for?: number
          group_code: string
          lost?: number
          played?: number
          points?: number
          position: number
          team_id: number
          updated_at?: string
          won?: number
        }
        Update: {
          drawn?: number
          goal_difference?: number
          goals_against?: number
          goals_for?: number
          group_code?: string
          lost?: number
          played?: number
          points?: number
          position?: number
          team_id?: number
          updated_at?: string
          won?: number
        }
        Relationships: [
          {
            foreignKeyName: "standings_cache_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_log: {
        Row: {
          detail: Json | null
          finished_at: string | null
          id: number
          kind: string
          started_at: string
          status: string
        }
        Insert: {
          detail?: Json | null
          finished_at?: string | null
          id?: never
          kind: string
          started_at?: string
          status?: string
        }
        Update: {
          detail?: Json | null
          finished_at?: string | null
          id?: never
          kind?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          api_id: number
          fifa_code: string
          flag_emoji: string
          group_code: string | null
          id: number
          name: string
        }
        Insert: {
          api_id: number
          fifa_code: string
          flag_emoji?: string
          group_code?: string | null
          id?: never
          name: string
        }
        Update: {
          api_id?: number
          fifa_code?: string
          flag_emoji?: string
          group_code?: string | null
          id?: never
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      leaderboard_entry_rows: {
        Row: {
          challenge_id: number | null
          correct_ko_picks: number | null
          correct_outcomes: number | null
          correct_qualifiers: number | null
          display_name: string | null
          entry_id: string | null
          global_points: number | null
          hardcore: boolean | null
          hardcore_points: number | null
          registered_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "challenge_entries_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboard_overall_ranked: {
        Row: {
          board: string | null
          correct_ko_picks: number | null
          correct_outcomes: number | null
          correct_qualifiers: number | null
          display_name: string | null
          points: number | null
          rank: number | null
          registered_at: string | null
          user_id: string | null
        }
        Relationships: []
      }
      leaderboard_ranked: {
        Row: {
          board: string | null
          challenge_id: number | null
          correct_ko_picks: number | null
          correct_outcomes: number | null
          correct_qualifiers: number | null
          display_name: string | null
          entry_id: string | null
          hardcore: boolean | null
          points: number | null
          rank: number | null
          registered_at: string | null
          user_id: string | null
        }
        Relationships: []
      }
      leaderboard_totals: {
        Row: {
          challenge_id: number | null
          created_at: string | null
          entry_id: string | null
          global_points: number | null
          hardcore: boolean | null
          hardcore_points: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "challenge_entries_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_edit_bracket: { Args: { eid: string; gen: number }; Returns: boolean }
      can_edit_match_prediction: {
        Args: { eid: string; mid: number }
        Returns: boolean
      }
      challenge_is_locked: { Args: { cid: number }; Returns: boolean }
      entry_challenge_locked: { Args: { eid: string }; Returns: boolean }
      invoke_sync: { Args: { p_mode: string }; Returns: undefined }
      is_admin: { Args: never; Returns: boolean }
      is_banned: { Args: never; Returns: boolean }
      match_is_locked: { Args: { mid: number }; Returns: boolean }
      owns_entry: { Args: { eid: string }; Returns: boolean }
      replace_entry_points: {
        Args: { p_entry_id: string; p_rows: Json; p_stats: Json }
        Returns: undefined
      }
      write_leaderboard_snapshots: {
        Args: { p_matchday?: string }
        Returns: number
      }
    }
    Enums: {
      challenge_kind: "full" | "groups" | "playoff" | "fun"
      fun_question_type: "numeric" | "pick" | "yesno"
      match_stage:
        | "group"
        | "r32"
        | "r16"
        | "qf"
        | "sf"
        | "third_place"
        | "final"
      match_status:
        | "scheduled"
        | "timed"
        | "in_play"
        | "paused"
        | "finished"
        | "suspended"
        | "postponed"
        | "cancelled"
        | "awarded"
      prediction_outcome: "home" | "draw" | "away"
      user_role: "user" | "admin"
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
  public: {
    Enums: {
      challenge_kind: ["full", "groups", "playoff", "fun"],
      fun_question_type: ["numeric", "pick", "yesno"],
      match_stage: ["group", "r32", "r16", "qf", "sf", "third_place", "final"],
      match_status: [
        "scheduled",
        "timed",
        "in_play",
        "paused",
        "finished",
        "suspended",
        "postponed",
        "cancelled",
        "awarded",
      ],
      prediction_outcome: ["home", "draw", "away"],
      user_role: ["user", "admin"],
    },
  },
} as const
