export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type QuestionOrigin = 'platform' | 'user'
export type QuestionStatus = 'draft' | 'needs_review' | 'active' | 'archived'
export type QuestionMechanic = 'single-answer' | 'multiple-choice' | 'multi-answer' | 'multi-part' | 'ranking'
export type ScoringMode = 'fixed' | 'per-item' | 'all-or-nothing'
export type FactualStability = 'stable' | 'review_periodically' | 'volatile'
export type AudienceSuitability = 'family' | 'general' | 'adult'
export type AudienceFit = 'broad' | 'kids' | 'young_adults' | 'older_adults'
export type AudienceScope = 'global' | 'country_specific'
export type ContentFlag =
  | 'sexual_health'
  | 'sexual_content'
  | 'alcohol'
  | 'drugs'
  | 'violence'
  | 'death'
  | 'profanity'
  | 'gambling'
export type CategoryRole = 'primary' | 'secondary'
export type MediaKind = 'image' | 'audio' | 'video'
export type QuestionType =
  | 'single-answer'
  | 'image-question'
  | 'multiple-choice'
  | 'multi-answer'
  | 'multi-part'
  | 'ranking'

export type Database = {
  public: {
    Tables: {
      categories: ControlledCategoryTable
      prompt_patterns: ControlledLookupTable
      answer_types: ControlledLookupTable
      tags: ControlledTagTable
      tag_aliases: TagAliasTable
      media_assets: MediaAssetTable
      quizzes: {
        Row: {
          id: string
          owner_id: string | null
          title: string
          status: string
          round_count: number
          question_count: number
          estimated_minutes: number
          seed_key: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id?: string | null
          title: string
          status?: string
          round_count?: number
          question_count?: number
          estimated_minutes?: number
          seed_key?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string | null
          title?: string
          status?: string
          round_count?: number
          question_count?: number
          estimated_minutes?: number
          seed_key?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [{
          foreignKeyName: 'quizzes_owner_id_fkey'
          columns: ['owner_id']
          isOneToOne: false
          referencedRelation: 'users'
          referencedColumns: ['id']
        }]
      }
      source_questions: {
        Row: {
          id: string
          origin: QuestionOrigin
          owner_id: string | null
          question_type: QuestionType
          mechanic: QuestionMechanic
          prompt: string
          correct_answer: Json
          accepted_answers: Json
          options: Json | null
          category: string | null
          difficulty: string | null
          editorial_difficulty: number | null
          scoring_mode: ScoringMode
          prompt_pattern_id: string | null
          answer_type_id: string | null
          stability: FactualStability
          audience_suitability: AudienceSuitability
          audience_fit: AudienceFit
          adult_content: boolean
          audience_scope: AudienceScope
          audience_locale: string | null
          content_flags: ContentFlag[]
          as_of_date: string | null
          review_due_at: string | null
          valid_from: string | null
          expires_at: string | null
          media_asset_id: string | null
          prompt_signature: string | null
          tags: string[]
          image_url: string | null
          notes: string | null
          source_name: string | null
          source_url: string | null
          source_checked_date: string | null
          status: QuestionStatus
          is_verified: boolean
          verified_at: string | null
          verified_by: string | null
          last_reviewed_at: string | null
          revision: number
          import_key: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          origin: QuestionOrigin
          owner_id?: string | null
          question_type: QuestionType
          mechanic?: QuestionMechanic
          prompt: string
          correct_answer: Json
          accepted_answers?: Json
          options?: Json | null
          category?: string | null
          difficulty?: string | null
          editorial_difficulty?: number | null
          scoring_mode?: ScoringMode
          prompt_pattern_id?: string | null
          answer_type_id?: string | null
          stability?: FactualStability
          audience_suitability?: AudienceSuitability
          audience_fit?: AudienceFit
          adult_content?: boolean
          audience_scope?: AudienceScope
          audience_locale?: string | null
          content_flags?: ContentFlag[]
          as_of_date?: string | null
          review_due_at?: string | null
          valid_from?: string | null
          expires_at?: string | null
          media_asset_id?: string | null
          prompt_signature?: string | null
          tags?: string[]
          image_url?: string | null
          notes?: string | null
          source_name?: string | null
          source_url?: string | null
          source_checked_date?: string | null
          status?: QuestionStatus
          is_verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
          last_reviewed_at?: string | null
          revision?: number
          import_key?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          origin?: QuestionOrigin
          owner_id?: string | null
          question_type?: QuestionType
          mechanic?: QuestionMechanic
          prompt?: string
          correct_answer?: Json
          accepted_answers?: Json
          options?: Json | null
          category?: string | null
          difficulty?: string | null
          editorial_difficulty?: number | null
          scoring_mode?: ScoringMode
          prompt_pattern_id?: string | null
          answer_type_id?: string | null
          stability?: FactualStability
          audience_suitability?: AudienceSuitability
          audience_fit?: AudienceFit
          adult_content?: boolean
          audience_scope?: AudienceScope
          audience_locale?: string | null
          content_flags?: ContentFlag[]
          as_of_date?: string | null
          review_due_at?: string | null
          valid_from?: string | null
          expires_at?: string | null
          media_asset_id?: string | null
          prompt_signature?: string | null
          tags?: string[]
          image_url?: string | null
          notes?: string | null
          source_name?: string | null
          source_url?: string | null
          source_checked_date?: string | null
          status?: QuestionStatus
          is_verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
          last_reviewed_at?: string | null
          revision?: number
          import_key?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'source_questions_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'source_questions_verified_by_fkey'
            columns: ['verified_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'source_questions_prompt_pattern_id_fkey'
            columns: ['prompt_pattern_id']
            isOneToOne: false
            referencedRelation: 'prompt_patterns'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'source_questions_answer_type_id_fkey'
            columns: ['answer_type_id']
            isOneToOne: false
            referencedRelation: 'answer_types'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'source_questions_media_asset_id_fkey'
            columns: ['media_asset_id']
            isOneToOne: false
            referencedRelation: 'media_assets'
            referencedColumns: ['id']
          },
        ]
      }
      source_question_categories: SourceQuestionCategoryTable
      source_question_tags: SourceQuestionTagTable
      source_question_parts: SourceQuestionPartTable
      source_question_part_categories: SourceQuestionPartCategoryTable
      source_question_part_tags: SourceQuestionPartTagTable
      source_question_bonuses: SourceQuestionBonusTable
      source_question_bonus_categories: SourceQuestionBonusCategoryTable
      source_question_bonus_tags: SourceQuestionBonusTagTable
      question_library_import_batches: QuestionLibraryImportBatchTable
      proposed_question_tags: ProposedQuestionTagTable
      proposed_question_tag_assignments: ProposedQuestionTagAssignmentTable
      source_tiebreakers: {
        Row: {
          id: string
          prompt: string
          correct_value: number
          answer_unit: string | null
          notes: string | null
          status: QuestionStatus
          is_verified: boolean
          last_reviewed_at: string | null
          import_key: string | null
          source_name: string | null
          source_url: string | null
          source_checked_date: string | null
          primary_category_id: string | null
          editorial_difficulty: number | null
          audience_fit: AudienceFit
          adult_content: boolean
          audience_scope: AudienceScope
          audience_locale: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          prompt: string
          correct_value: number
          answer_unit?: string | null
          notes?: string | null
          status?: QuestionStatus
          is_verified?: boolean
          last_reviewed_at?: string | null
          import_key?: string | null
          source_name?: string | null
          source_url?: string | null
          source_checked_date?: string | null
          primary_category_id?: string | null
          editorial_difficulty?: number | null
          audience_fit?: AudienceFit
          adult_content?: boolean
          audience_scope?: AudienceScope
          audience_locale?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          prompt?: string
          correct_value?: number
          answer_unit?: string | null
          notes?: string | null
          status?: QuestionStatus
          is_verified?: boolean
          last_reviewed_at?: string | null
          import_key?: string | null
          source_name?: string | null
          source_url?: string | null
          source_checked_date?: string | null
          primary_category_id?: string | null
          editorial_difficulty?: number | null
          audience_fit?: AudienceFit
          adult_content?: boolean
          audience_scope?: AudienceScope
          audience_locale?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'source_tiebreakers_primary_category_id_fkey'
            columns: ['primary_category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          },
        ]
      }
      quiz_questions: {
        Row: QuestionRow & {
          quiz_id: string
          updated_at: string
          source_question_id: string | null
          source_revision: number | null
        }
        Insert: QuestionInsert & {
          quiz_id: string
          updated_at?: string
          source_question_id?: string | null
          source_revision?: number | null
        }
        Update: QuestionUpdate & {
          quiz_id?: string
          updated_at?: string
          source_question_id?: string | null
          source_revision?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'quiz_questions_quiz_id_fkey'
            columns: ['quiz_id']
            isOneToOne: false
            referencedRelation: 'quizzes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quiz_questions_source_question_id_fkey'
            columns: ['source_question_id']
            isOneToOne: false
            referencedRelation: 'source_questions'
            referencedColumns: ['id']
          },
        ]
      }
      quiz_content_screens: {
        Row: ContentScreenRow & { quiz_id: string; updated_at: string }
        Insert: ContentScreenInsert & { quiz_id: string; updated_at?: string }
        Update: Partial<ContentScreenInsert> & { quiz_id?: string; updated_at?: string }
        Relationships: [{
          foreignKeyName: 'quiz_content_screens_quiz_id_fkey'
          columns: ['quiz_id']
          isOneToOne: false
          referencedRelation: 'quizzes'
          referencedColumns: ['id']
        }]
      }
      quiz_show_games: {
        Row: ShowGameRow & { quiz_id: string; updated_at: string }
        Insert: ShowGameInsert & { quiz_id: string; updated_at?: string }
        Update: Partial<ShowGameInsert> & { quiz_id?: string; updated_at?: string }
        Relationships: []
      }
      quiz_tiebreakers: {
        Row: TiebreakerRow & { quiz_id: string; updated_at: string }
        Insert: TiebreakerInsert & { quiz_id: string; updated_at?: string }
        Update: Partial<TiebreakerInsert> & { quiz_id?: string; updated_at?: string }
        Relationships: [{
          foreignKeyName: 'quiz_tiebreakers_quiz_id_fkey'
          columns: ['quiz_id']
          isOneToOne: false
          referencedRelation: 'quizzes'
          referencedColumns: ['id']
        }]
      }
      games: {
        Row: {
          id: string
          code: string
          title: string
          status: string
          current_screen: string
          created_at: string
          answer_phase: string
          answer_editing_allowed: boolean
          question_stage: string
          current_question_key: string | null
          current_content_screen_key: string | null
          current_show_game_key: string | null
          current_tiebreaker_attempt_id: string | null
          round_scores_finalized: boolean
          quiz_id: string | null
          settings: Json
        }
        Insert: {
          id?: string
          code: string
          title: string
          status?: string
          current_screen?: string
          created_at?: string
          answer_phase?: string
          answer_editing_allowed?: boolean
          question_stage?: string
          current_question_key?: string | null
          current_content_screen_key?: string | null
          current_show_game_key?: string | null
          current_tiebreaker_attempt_id?: string | null
          round_scores_finalized?: boolean
          quiz_id?: string | null
          settings?: Json
        }
        Update: {
          id?: string
          code?: string
          title?: string
          status?: string
          current_screen?: string
          created_at?: string
          answer_phase?: string
          answer_editing_allowed?: boolean
          question_stage?: string
          current_question_key?: string | null
          current_content_screen_key?: string | null
          current_show_game_key?: string | null
          current_tiebreaker_attempt_id?: string | null
          round_scores_finalized?: boolean
          quiz_id?: string | null
          settings?: Json
        }
        Relationships: [{
          foreignKeyName: 'games_quiz_id_fkey'
          columns: ['quiz_id']
          isOneToOne: false
          referencedRelation: 'quizzes'
          referencedColumns: ['id']
        }]
      }
      host_preferences: {
        Row: {
          user_id: string
          game_settings: Json
          ui_hints: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          game_settings?: Json
          ui_hints?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          game_settings?: Json
          ui_hints?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      game_questions: {
        Row: QuestionRow & { game_id: string }
        Insert: QuestionInsert & { game_id: string }
        Update: QuestionUpdate & { game_id?: string }
        Relationships: [{
          foreignKeyName: 'game_questions_game_id_fkey'
          columns: ['game_id']
          isOneToOne: false
          referencedRelation: 'games'
          referencedColumns: ['id']
        }]
      }
      game_content_screens: {
        Row: ContentScreenRow & { game_id: string }
        Insert: ContentScreenInsert & { game_id: string }
        Update: Partial<ContentScreenInsert> & { game_id?: string }
        Relationships: [{
          foreignKeyName: 'game_content_screens_game_id_fkey'
          columns: ['game_id']
          isOneToOne: false
          referencedRelation: 'games'
          referencedColumns: ['id']
        }]
      }
      game_show_games: {
        Row: LiveShowGameRow
        Insert: Omit<LiveShowGameRow, 'id'> & { id?: string }
        Update: Partial<LiveShowGameRow>
        Relationships: []
      }
      game_show_game_presses: {
        Row: { id: string; game_show_game_id: string; game_id: string; team_id: string; pressed_at: string }
        Insert: { id?: string; game_show_game_id: string; game_id: string; team_id: string; pressed_at?: string }
        Update: Partial<{ id: string; game_show_game_id: string; game_id: string; team_id: string; pressed_at: string }>
        Relationships: []
      }
      game_show_game_choices: {
        Row: { id: string; game_show_game_id: string; game_id: string; team_id: string; round_number: number; choice: 'heads' | 'tails' | '0' | '1' | '2'; submitted_at: string }
        Insert: { id?: string; game_show_game_id: string; game_id: string; team_id: string; round_number: number; choice: 'heads' | 'tails' | '0' | '1' | '2'; submitted_at?: string }
        Update: Partial<{ id: string; game_show_game_id: string; game_id: string; team_id: string; round_number: number; choice: 'heads' | 'tails' | '0' | '1' | '2'; submitted_at: string }>
        Relationships: []
      }
      game_show_game_audience_private: {
        Row: { game_show_game_id: string; correct_number: number | null }
        Insert: { game_show_game_id: string; correct_number?: number | null }
        Update: Partial<{ game_show_game_id: string; correct_number: number | null }>
        Relationships: []
      }
      game_show_game_responses: {
        Row: { id: string; game_show_game_id: string; game_id: string; team_id: string; response_text: string; numeric_response: number | null; distance_from_correct: number | null; is_winner: boolean; submitted_at: string }
        Insert: { id?: string; game_show_game_id: string; game_id: string; team_id: string; response_text: string; numeric_response?: number | null; distance_from_correct?: number | null; is_winner?: boolean; submitted_at?: string }
        Update: Partial<{ id: string; game_show_game_id: string; game_id: string; team_id: string; response_text: string; numeric_response: number | null; distance_from_correct: number | null; is_winner: boolean; submitted_at: string }>
        Relationships: []
      }
      game_show_game_response_votes: {
        Row: { response_id: string; game_show_game_id: string; game_id: string; voter_team_id: string; created_at: string }
        Insert: { response_id: string; game_show_game_id: string; game_id: string; voter_team_id: string; created_at?: string }
        Update: Partial<{ response_id: string; game_show_game_id: string; game_id: string; voter_team_id: string; created_at: string }>
        Relationships: []
      }
      game_show_game_balloons: {
        Row: { id: string; game_show_game_id: string; game_id: string; team_id: string; size_units: number; status: 'ready' | 'inflating' | 'locked' | 'popped'; last_inflated_at: string | null; locked_at: string | null; popped_at: string | null; created_at: string }
        Insert: { id?: string; game_show_game_id: string; game_id: string; team_id: string; size_units?: number; status?: 'ready' | 'inflating' | 'locked' | 'popped'; last_inflated_at?: string | null; locked_at?: string | null; popped_at?: string | null; created_at?: string }
        Update: Partial<{ size_units: number; status: 'ready' | 'inflating' | 'locked' | 'popped'; last_inflated_at: string | null; locked_at: string | null; popped_at: string | null }>
        Relationships: []
      }
      game_show_game_treasure: {
        Row: { id: string; game_show_game_id: string; game_id: string; team_id: string; banked_units: number; current_units: number; is_stealing: boolean; stealing_started_at: string | null; caught_count: number; updated_at: string }
        Insert: { id?: string; game_show_game_id: string; game_id: string; team_id: string; banked_units?: number; current_units?: number; is_stealing?: boolean; stealing_started_at?: string | null; caught_count?: number; updated_at?: string }
        Update: Partial<{ banked_units: number; current_units: number; is_stealing: boolean; stealing_started_at: string | null; caught_count: number; updated_at: string }>
        Relationships: []
      }
      game_tiebreakers: {
        Row: TiebreakerRow & { game_id: string }
        Insert: TiebreakerInsert & { game_id: string }
        Update: Partial<TiebreakerInsert> & { game_id?: string }
        Relationships: [{
          foreignKeyName: 'game_tiebreakers_game_id_fkey'
          columns: ['game_id']
          isOneToOne: false
          referencedRelation: 'games'
          referencedColumns: ['id']
        }]
      }
      game_tie_resolutions: {
        Row: {
          id: string
          game_id: string
          tied_score: number
          team_ids: string[]
          status: 'pending' | 'resolved'
          resolution_method: 'tiebreaker' | 'allowed_tie' | 'manual' | 'show_game' | null
          ordered_team_ids: string[] | null
          created_at: string
          resolved_at: string | null
        }
        Insert: {
          id?: string
          game_id: string
          tied_score: number
          team_ids: string[]
          status?: 'pending' | 'resolved'
          resolution_method?: 'tiebreaker' | 'allowed_tie' | 'manual' | 'show_game' | null
          ordered_team_ids?: string[] | null
          created_at?: string
          resolved_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['game_tie_resolutions']['Insert']>
        Relationships: [{
          foreignKeyName: 'game_tie_resolutions_game_id_fkey'
          columns: ['game_id']
          isOneToOne: false
          referencedRelation: 'games'
          referencedColumns: ['id']
        }]
      }
      game_tiebreaker_attempts: {
        Row: {
          id: string
          game_id: string
          resolution_id: string
          game_tiebreaker_id: string
          team_ids: string[]
          status: 'open' | 'closed' | 'resolved' | 'tied'
          created_at: string
          closed_at: string | null
          revealed_at: string | null
        }
        Insert: {
          id?: string
          game_id: string
          resolution_id: string
          game_tiebreaker_id: string
          team_ids: string[]
          status?: 'open' | 'closed' | 'resolved' | 'tied'
          created_at?: string
          closed_at?: string | null
          revealed_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['game_tiebreaker_attempts']['Insert']>
        Relationships: []
      }
      game_tiebreaker_submissions: {
        Row: {
          id: string
          game_id: string
          attempt_id: string
          team_id: string
          numeric_answer: number
          distance: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          game_id: string
          attempt_id: string
          team_id: string
          numeric_answer: number
          distance?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['game_tiebreaker_submissions']['Insert']>
        Relationships: []
      }
      team_profiles: {
        Row: {
          id: string
          display_name: string
          name_key: string
          pin_digest: string
          created_at: string
          updated_at: string
          last_joined_at: string
        }
        Insert: {
          id?: string
          display_name: string
          name_key: string
          pin_digest: string
          created_at?: string
          updated_at?: string
          last_joined_at?: string
        }
        Update: Partial<Database['public']['Tables']['team_profiles']['Insert']>
        Relationships: []
      }
      team_join_requests: {
        Row: {
          id: string
          request_token: string
          game_id: string
          team_profile_id: string | null
          requested_name: string
          name_key: string
          status: 'pending' | 'approved' | 'denied'
          team_id: string | null
          created_at: string
          decided_at: string | null
        }
        Insert: {
          id?: string
          request_token?: string
          game_id: string
          team_profile_id?: string | null
          requested_name: string
          name_key: string
          status?: 'pending' | 'approved' | 'denied'
          team_id?: string | null
          created_at?: string
          decided_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['team_join_requests']['Insert']>
        Relationships: []
      }
      teams: {
        Row: {
          id: string
          game_id: string
          team_profile_id: string | null
          name: string
          score: number
          prize_awards: Json
          final_placement: number | null
          final_bottom_placement: number | null
          final_sort_order: number | null
          created_at: string
          last_seen_at: string
        }
        Insert: {
          id?: string
          game_id: string
          team_profile_id?: string | null
          name: string
          score?: number
          prize_awards?: Json
          final_placement?: number | null
          final_bottom_placement?: number | null
          final_sort_order?: number | null
          created_at?: string
          last_seen_at?: string
        }
        Update: {
          id?: string
          game_id?: string
          team_profile_id?: string | null
          name?: string
          score?: number
          prize_awards?: Json
          final_placement?: number | null
          final_bottom_placement?: number | null
          final_sort_order?: number | null
          created_at?: string
          last_seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'teams_game_id_fkey'
            columns: ['game_id']
            isOneToOne: false
            referencedRelation: 'games'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'teams_team_profile_id_fkey'
            columns: ['team_profile_id']
            isOneToOne: false
            referencedRelation: 'team_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      game_reactions: {
        Row: {
          id: string
          game_id: string
          team_id: string
          team_name: string
          reaction: '👍' | '❤️' | '🥰' | '😂' | '😮' | '😢' | '😡'
          created_at: string
        }
        Insert: {
          id?: string
          game_id: string
          team_id: string
          team_name: string
          reaction: '👍' | '❤️' | '🥰' | '😂' | '😮' | '😢' | '😡'
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['game_reactions']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'game_reactions_game_id_fkey'
            columns: ['game_id']
            isOneToOne: false
            referencedRelation: 'games'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'game_reactions_team_id_fkey'
            columns: ['team_id']
            isOneToOne: false
            referencedRelation: 'teams'
            referencedColumns: ['id']
          },
        ]
      }
      submissions: {
        Row: {
          id: string
          game_id: string
          team_id: string
          question_key: string
          answer_text: string
          is_correct: boolean | null
          points_awarded: number
          grading_json: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          game_id: string
          team_id: string
          question_key: string
          answer_text: string
          is_correct?: boolean | null
          points_awarded?: number
          grading_json?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          game_id?: string
          team_id?: string
          question_key?: string
          answer_text?: string
          is_correct?: boolean | null
          points_awarded?: number
          grading_json?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'submissions_game_id_fkey'
            columns: ['game_id']
            isOneToOne: false
            referencedRelation: 'games'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'submissions_team_id_fkey'
            columns: ['team_id']
            isOneToOne: false
            referencedRelation: 'teams'
            referencedColumns: ['id']
          },
        ]
      }
      bonus_submissions: {
        Row: {
          id: string
          game_id: string
          team_id: string
          question_key: string
          answer_text: string
          is_correct: boolean | null
          points_awarded: number
          grading_json: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          game_id: string
          team_id: string
          question_key: string
          answer_text: string
          is_correct?: boolean | null
          points_awarded?: number
          grading_json?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          game_id?: string
          team_id?: string
          question_key?: string
          answer_text?: string
          is_correct?: boolean | null
          points_awarded?: number
          grading_json?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'bonus_submissions_game_id_fkey'
            columns: ['game_id']
            isOneToOne: false
            referencedRelation: 'games'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'bonus_submissions_team_id_fkey'
            columns: ['team_id']
            isOneToOne: false
            referencedRelation: 'teams'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      source_question_catalog: {
        Row: SourceQuestionCatalogRow
        Relationships: []
      }
      question_library_proposed_tag_review: {
        Row: {
          id: string | null
          display_phrase: string | null
          normalized_phrase: string | null
          status: 'pending' | 'mapped' | 'created' | 'ignored' | null
          resolved_tag_id: string | null
          assignment_count: number | null
          question_count: number | null
          first_seen_at: string | null
          last_seen_at: string | null
          resolved_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      start_live_game: {
        Args: { p_game_id: string; p_answer_editing_allowed?: boolean }
        Returns: Database['public']['Tables']['games']['Row']
      }
      prepare_tie_show_game: {
        Args: { p_resolution_id: string; p_game_type: string; p_prompt?: string | null; p_correct_number?: number | null }
        Returns: Database['public']['Tables']['game_show_games']['Row']
      }
      start_tie_show_game: {
        Args: { p_game_show_game_id: string }
        Returns: Database['public']['Tables']['game_show_games']['Row']
      }
      complete_tie_show_game: {
        Args: { p_game_show_game_id: string }
        Returns: Database['public']['Tables']['game_tie_resolutions']['Row']
      }
      start_audience_question: {
        Args: { p_game_show_game_id: string }
        Returns: Database['public']['Tables']['game_show_games']['Row']
      }
      submit_audience_question_response: {
        Args: { p_game_show_game_id: string; p_request_id: string; p_request_token: string; p_response: string }
        Returns: Database['public']['Tables']['game_show_game_responses']['Row']
      }
      get_own_audience_question_response: {
        Args: { p_game_show_game_id: string; p_request_id: string; p_request_token: string }
        Returns: Database['public']['Tables']['game_show_game_responses']['Row']
      }
      get_audience_question_responses: {
        Args: { p_game_show_game_id: string; p_request_id: string; p_request_token: string }
        Returns: Array<{ response_id: string; team_id: string; team_name: string; response_text: string; numeric_response: number | null; submitted_at: string; vote_count: number; viewer_has_voted: boolean }>
      }
      toggle_audience_question_response_vote: {
        Args: { p_game_show_game_id: string; p_response_id: string; p_request_id: string; p_request_token: string }
        Returns: Array<{ response_id: string; liked: boolean; vote_count: number }>
      }
      resolve_audience_question: {
        Args: { p_game_show_game_id: string; p_winner_team_ids?: string[] | null }
        Returns: Database['public']['Tables']['game_show_games']['Row']
      }
      start_big_balloon: {
        Args: { p_game_show_game_id: string }
        Returns: Database['public']['Tables']['game_show_games']['Row']
      }
      pulse_big_balloon: {
        Args: { p_game_show_game_id: string; p_request_id: string; p_request_token: string }
        Returns: Database['public']['Tables']['game_show_game_balloons']['Row']
      }
      lock_big_balloon: {
        Args: { p_game_show_game_id: string; p_request_id: string; p_request_token: string }
        Returns: Database['public']['Tables']['game_show_game_balloons']['Row']
      }
      resolve_big_balloon: {
        Args: { p_game_show_game_id: string }
        Returns: Database['public']['Tables']['game_show_games']['Row']
      }
      start_steal_the_treasure: {
        Args: { p_game_show_game_id: string }
        Returns: Database['public']['Tables']['game_show_games']['Row']
      }
      set_steal_the_treasure_holding: {
        Args: { p_game_show_game_id: string; p_request_id: string; p_request_token: string; p_holding: boolean }
        Returns: Database['public']['Tables']['game_show_game_treasure']['Row']
      }
      advance_steal_the_treasure: {
        Args: { p_game_show_game_id: string }
        Returns: Database['public']['Tables']['game_show_games']['Row']
      }
      resolve_steal_the_treasure: {
        Args: { p_game_show_game_id: string }
        Returns: Database['public']['Tables']['game_show_games']['Row']
      }
      cancel_host_game: {
        Args: {
          p_game_code: string
        }
        Returns: string
      }
      get_player_game_question: {
        Args: {
          p_game_id: string
          p_question_key: string
        }
        Returns: {
          question_key: string
          position: number
          round_number: number
          round_position: number
          round_question_count: number
          round_title: string
          prompt: string
          category: string | null
          difficulty: string | null
          question_type: string
          correct_answer: Json | null
          options: Json | null
          image_url: string | null
          points_max: number
          notes: string | null
          has_bonus: boolean
          bonus: Json | null
        }[]
      }
      join_live_game: {
        Args: {
          p_game_id: string
          p_team_name: string
          p_team_pin?: string | null
          p_pin_mode?: 'none' | 'have' | 'create'
        }
        Returns: {
          request_id: string
          request_token: string
          name: string
          admission_status: 'pending' | 'approved' | 'denied'
          team_id: string | null
        }[]
      }
      get_team_join_request: {
        Args: {
          p_request_id: string
          p_request_token: string
        }
        Returns: {
          admission_status: 'pending' | 'approved' | 'denied'
          team_id: string | null
          name: string
          game_status: string
        }[]
      }
      decide_team_join_request: {
        Args: {
          p_request_id: string
          p_decision: 'approved' | 'denied'
        }
        Returns: {
          request_id: string
          admission_status: 'approved' | 'denied'
          team_id: string | null
          name: string
        }[]
      }
      withdraw_team_join_request: {
        Args: { p_request_id: string; p_request_token: string }
        Returns: boolean
      }
      remove_team_from_game: {
        Args: { p_team_id: string }
        Returns: string
      }
      touch_team_presence: {
        Args: { p_request_id: string; p_request_token: string }
        Returns: string
      }
      send_game_reaction: {
        Args: { p_request_id: string; p_request_token: string; p_reaction: '👍' | '❤️' | '🥰' | '😂' | '😮' | '😢' | '😡' }
        Returns: Database['public']['Tables']['game_reactions']['Row']
      }
      submit_player_answer: {
        Args: {
          p_game_id: string
          p_team_id: string
          p_answer_text: string
        }
        Returns: string
      }
      submit_player_bonus_answer: {
        Args: {
          p_game_id: string
          p_team_id: string
          p_answer_text: string
        }
        Returns: string
      }
      get_player_bonus_submission: {
        Args: {
          p_game_id: string
          p_team_id: string
          p_question_key: string
        }
        Returns: {
          id: string
          answer_text: string
          is_correct: boolean | null
          points_awarded: number
          grading_json: Json | null
        }[]
      }
      create_game_from_quiz: {
        Args: {
          p_quiz_id: string
          p_settings?: Json
        }
        Returns: {
          game_id: string
          game_code: string
          game_title: string
        }[]
      }
      create_game_from_quiz_with_show_games: {
        Args: { p_quiz_id: string; p_settings?: Json }
        Returns: { game_id: string; game_code: string; game_title: string }[]
      }
      start_beat_the_bomb: {
        Args: { p_game_show_game_id: string }
        Returns: LiveShowGameRow
      }
      press_beat_the_bomb: {
        Args: { p_game_show_game_id: string; p_team_id: string }
        Returns: LiveShowGameRow
      }
      resolve_beat_the_bomb: {
        Args: { p_game_show_game_id: string }
        Returns: LiveShowGameRow
      }
      start_spin_the_wheel: {
        Args: { p_game_show_game_id: string }
        Returns: LiveShowGameRow
      }
      resolve_spin_the_wheel: {
        Args: { p_game_show_game_id: string }
        Returns: LiveShowGameRow
      }
      start_elimination_show_game: {
        Args: { p_game_show_game_id: string }
        Returns: LiveShowGameRow
      }
      submit_elimination_show_game_choice: {
        Args: { p_game_show_game_id: string; p_request_id: string; p_request_token: string; p_choice: 'heads' | 'tails' | '0' | '1' | '2' }
        Returns: LiveShowGameRow
      }
      resolve_elimination_show_game: {
        Args: { p_game_show_game_id: string }
        Returns: LiveShowGameRow
      }
      advance_elimination_show_game: {
        Args: { p_game_show_game_id: string }
        Returns: LiveShowGameRow
      }
      finalize_question_scoring: {
        Args: {
          p_game_id: string
          p_question_key: string
          p_results: Json
          p_reveal?: boolean
        }
        Returns: number
      }
      finalize_question_and_bonus_scoring: {
        Args: {
          p_game_id: string
          p_question_key: string
          p_results: Json
          p_bonus_results?: Json
          p_reveal?: boolean
        }
        Returns: number
      }
      finalize_auto_run_question_scoring: {
        Args: {
          p_game_id: string
          p_question_key: string
          p_results?: Json
          p_bonus_results?: Json
          p_reveal?: boolean
        }
        Returns: number
      }
      finalize_auto_run_round: {
        Args: {
          p_game_id: string
          p_round_number: number
          p_mark_pending_incorrect?: boolean
        }
        Returns: number
      }
      finalize_game_with_prizes: {
        Args: {
          p_game_id: string
        }
        Returns: number
      }
      apply_latest_in_show_tiebreaker: {
        Args: { p_game_id: string }
        Returns: number
      }
      start_game_tiebreaker: {
        Args: { p_resolution_id: string }
        Returns: string
      }
      close_game_tiebreaker: {
        Args: { p_attempt_id: string }
        Returns: undefined
      }
      reveal_game_tiebreaker: {
        Args: { p_attempt_id: string }
        Returns: boolean
      }
      allow_game_tie: {
        Args: { p_resolution_id: string }
        Returns: undefined
      }
      manually_resolve_game_tie: {
        Args: { p_resolution_id: string; p_ordered_team_ids: string[] }
        Returns: undefined
      }
      submit_player_tiebreaker: {
        Args: { p_game_id: string; p_team_id: string; p_numeric_answer: number }
        Returns: string
      }
      get_player_tiebreaker_state: {
        Args: { p_game_id: string; p_team_id: string }
        Returns: {
          attempt_id: string
          prompt: string | null
          answer_unit: string | null
          attempt_status: 'open' | 'closed' | 'resolved' | 'tied'
          is_participant: boolean
          numeric_answer: number | null
          distance: number | null
          correct_value: number | null
          is_winner: boolean | null
          submitted_count: number
          participant_count: number
        }[]
      }
      reveal_and_score_question: {
        Args: {
          p_game_id: string
          p_question_key: string
          p_results: Json
        }
        Returns: number
      }
      save_quiz_with_questions: {
        Args: {
          p_quiz_id: string | null
          p_title: string
          p_status: string
          p_estimated_minutes: number
          p_questions: Json
          p_content_screens?: Json
          p_tiebreakers?: Json
        }
        Returns: string
      }
      save_quiz_with_bonus_snapshots: {
        Args: {
          p_quiz_id: string | null
          p_title: string
          p_status: string
          p_estimated_minutes: number
          p_questions: Json
          p_content_screens?: Json
          p_tiebreakers?: Json
        }
        Returns: string
      }
      save_quiz_with_show_games: {
        Args: {
          p_quiz_id: string | null
          p_title: string
          p_status: string
          p_estimated_minutes: number
          p_questions: Json
          p_content_screens?: Json
          p_tiebreakers?: Json
          p_show_games?: Json
        }
        Returns: string
      }
      save_my_question_with_metadata: {
        Args: {
          p_question_id: string | null
          p_question: Json
          p_primary_category_id?: string | null
          p_secondary_category_ids?: string[]
          p_tag_ids?: string[]
          p_bonus?: Json | null
        }
        Returns: string
      }
      save_my_question_with_inherited_metadata: {
        Args: {
          p_question_id: string | null
          p_question: Json
          p_primary_category_id?: string | null
          p_secondary_category_ids?: string[]
          p_tag_ids?: string[]
          p_bonus?: Json | null
        }
        Returns: string
      }
      import_question_library_batch: {
        Args: {
          p_file_name: string
          p_file_sha256: string
          p_payload: Json
        }
        Returns: Json
      }
      replace_question_library_batch: {
        Args: {
          p_file_name: string
          p_file_sha256: string
          p_payload: Json
          p_activate?: boolean
        }
        Returns: Json
      }
      get_host_team_stats: {
        Args: Record<PropertyKey, never>
        Returns: {
          team_profile_id: string
          display_name: string
          games_played: number
          average_placement: number | null
          best_placement: number | null
          wins: number
          correct_points: number
          possible_points: number
          correct_rate: number | null
          total_points: number
          recent_game_title: string | null
          recent_game_at: string | null
        }[]
      }
      get_host_game_count: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      resolve_question_library_proposed_tag: {
        Args: {
          p_proposed_tag_id: string
          p_action: string
          p_tag_slug?: string | null
          p_tag_name?: string | null
          p_remember_alias?: boolean
        }
        Returns: string | null
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type QuestionRow = {
  id: string
  question_key: string
  position: number
  item_position: number
  round_number: number
  round_position: number
  round_question_count: number
  round_title: string
  prompt: string
  category: string | null
  difficulty: string | null
  question_type: QuestionType
  correct_answer: Json
  accepted_answers: Json
  options: Json | null
  tags: string[]
  image_url: string | null
  points_max: number
  bonus: Json | null
  metadata_snapshot: Json
  notes: string | null
  created_at: string
}

type QuestionInsert = {
  id?: string
  question_key: string
  position: number
  item_position: number
  round_number: number
  round_position: number
  round_question_count: number
  round_title: string
  prompt: string
  category?: string | null
  difficulty?: string | null
  question_type: QuestionType
  correct_answer: Json
  accepted_answers?: Json
  options?: Json | null
  tags?: string[]
  image_url?: string | null
  points_max?: number
  bonus?: Json | null
  metadata_snapshot?: Json
  notes?: string | null
  created_at?: string
}

type QuestionUpdate = Partial<QuestionInsert>

type ContentScreenRow = {
  id: string
  screen_key: string
  item_position: number
  round_number: number
  round_title: string
  title: string
  body: string | null
  image_url: string | null
  created_at: string
}

type ContentScreenInsert = {
  id?: string
  screen_key: string
  item_position: number
  round_number: number
  round_title: string
  title: string
  body?: string | null
  image_url?: string | null
  created_at?: string
}

type ShowGameRow = {
  id: string
  show_game_key: string
  item_position: number
  round_number: number
  round_title: string
  game_type: 'beat-the-bomb' | 'spin-the-wheel' | 'heads-or-tails' | 'dodge-the-rock' | 'big-balloon' | 'steal-the-treasure' | 'audience-question' | 'in-show-tiebreaker'
  title: string
  settings: Json
  created_at: string
}

type ShowGameInsert = {
  id?: string
  show_game_key: string
  item_position: number
  round_number: number
  round_title: string
  game_type: 'beat-the-bomb' | 'spin-the-wheel' | 'heads-or-tails' | 'dodge-the-rock' | 'big-balloon' | 'steal-the-treasure' | 'audience-question' | 'in-show-tiebreaker'
  title: string
  settings?: Json
  created_at?: string
}

type LiveShowGameRow = ShowGameRow & {
  game_id: string
  quiz_show_game_id: string | null
  status: 'ready' | 'open' | 'exploded' | 'cancelled'
  started_at: string | null
  explode_at: string | null
  exploded_at: string | null
  winner_team_id: string | null
  reward_points_awarded: number
}

type TiebreakerRow = {
  id: string
  tiebreaker_key: string
  position: number
  prompt: string
  correct_value: number
  answer_unit: string | null
  notes: string | null
  created_at: string
}

type TiebreakerInsert = {
  id?: string
  tiebreaker_key: string
  position: number
  prompt: string
  correct_value: number
  answer_unit?: string | null
  notes?: string | null
  created_at?: string
}

type SourceQuestionCatalogRow = {
  id: string
  origin: QuestionOrigin
  owner_id: string | null
  question_type: QuestionType
  mechanic: QuestionMechanic
  prompt: string
  correct_answer: Json
  accepted_answers: Json
  options: Json | null
  category: string | null
  difficulty: string | null
  editorial_difficulty: number | null
  scoring_mode: ScoringMode
  prompt_pattern_id: string | null
  answer_type_id: string | null
  stability: FactualStability
  audience_suitability: AudienceSuitability
  audience_fit: AudienceFit
  adult_content: boolean
  audience_scope: AudienceScope
  audience_locale: string | null
  content_flags: ContentFlag[]
  as_of_date: string | null
  review_due_at: string | null
  valid_from: string | null
  expires_at: string | null
  media_asset_id: string | null
  prompt_signature: string | null
  tags: string[]
  image_url: string | null
  notes: string | null
  source_name: string | null
  source_url: string | null
  source_checked_date: string | null
  status: QuestionStatus
  is_verified: boolean
  verified_at: string | null
  verified_by: string | null
  last_reviewed_at: string | null
  revision: number
  import_key: string | null
  created_at: string
  updated_at: string
  category_ids: string[]
  secondary_category_ids: string[]
  primary_category_id: string | null
  primary_category_name: string | null
  category_names: string[]
  tag_ids: string[]
  tag_names: string[]
  bonus: Json | null
  search_text: string
}

type ControlledLookupTable = {
  Row: {
    id: string
    slug: string
    name: string
    is_active: boolean
    created_at: string
    updated_at: string
  }
  Insert: {
    id?: string
    slug: string
    name: string
    is_active?: boolean
    created_at?: string
    updated_at?: string
  }
  Update: Partial<ControlledLookupTable['Insert']>
  Relationships: []
}

type ControlledCategoryTable = {
  Row: ControlledLookupTable['Row'] & { sort_order: number }
  Insert: ControlledLookupTable['Insert'] & { sort_order?: number }
  Update: Partial<ControlledCategoryTable['Insert']>
  Relationships: []
}

type ControlledTagTable = {
  Row: {
    id: string
    slug: string
    name: string
    parent_tag_id: string | null
    specificity: number
    diversity_weight: number
    is_active: boolean
    created_at: string
    updated_at: string
  }
  Insert: {
    id?: string
    slug: string
    name: string
    parent_tag_id?: string | null
    specificity?: number
    diversity_weight?: number
    is_active?: boolean
    created_at?: string
    updated_at?: string
  }
  Update: Partial<ControlledTagTable['Insert']>
  Relationships: [{
    foreignKeyName: 'tags_parent_tag_id_fkey'
    columns: ['parent_tag_id']
    isOneToOne: false
    referencedRelation: 'tags'
    referencedColumns: ['id']
  }]
}

type TagAliasTable = {
  Row: {
    id: string
    tag_id: string
    alias: string
    normalized_alias: string
    created_at: string
  }
  Insert: {
    id?: string
    tag_id: string
    alias: string
    normalized_alias: string
    created_at?: string
  }
  Update: Partial<TagAliasTable['Insert']>
  Relationships: [{
    foreignKeyName: 'tag_aliases_tag_id_fkey'
    columns: ['tag_id']
    isOneToOne: false
    referencedRelation: 'tags'
    referencedColumns: ['id']
  }]
}

type MediaAssetTable = {
  Row: {
    id: string
    origin: QuestionOrigin
    owner_id: string | null
    kind: MediaKind
    url: string
    alt_text: string | null
    caption: string | null
    credit: string | null
    import_key: string | null
    created_at: string
    updated_at: string
  }
  Insert: {
    id?: string
    origin: QuestionOrigin
    owner_id?: string | null
    kind?: MediaKind
    url: string
    alt_text?: string | null
    caption?: string | null
    credit?: string | null
    import_key?: string | null
    created_at?: string
    updated_at?: string
  }
  Update: Partial<MediaAssetTable['Insert']>
  Relationships: [{
    foreignKeyName: 'media_assets_owner_id_fkey'
    columns: ['owner_id']
    isOneToOne: false
    referencedRelation: 'users'
    referencedColumns: ['id']
  }]
}

type SourceQuestionCategoryTable = {
  Row: {
    source_question_id: string
    category_id: string
    role: CategoryRole
    created_at: string
  }
  Insert: {
    source_question_id: string
    category_id: string
    role?: CategoryRole
    created_at?: string
  }
  Update: Partial<SourceQuestionCategoryTable['Insert']>
  Relationships: [
    {
      foreignKeyName: 'source_question_categories_source_question_id_fkey'
      columns: ['source_question_id']
      isOneToOne: false
      referencedRelation: 'source_questions'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'source_question_categories_category_id_fkey'
      columns: ['category_id']
      isOneToOne: false
      referencedRelation: 'categories'
      referencedColumns: ['id']
    },
  ]
}

type SourceQuestionTagTable = {
  Row: {
    source_question_id: string
    tag_id: string
    created_at: string
  }
  Insert: {
    source_question_id: string
    tag_id: string
    created_at?: string
  }
  Update: Partial<SourceQuestionTagTable['Insert']>
  Relationships: [
    {
      foreignKeyName: 'source_question_tags_source_question_id_fkey'
      columns: ['source_question_id']
      isOneToOne: false
      referencedRelation: 'source_questions'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'source_question_tags_tag_id_fkey'
      columns: ['tag_id']
      isOneToOne: false
      referencedRelation: 'tags'
      referencedColumns: ['id']
    },
  ]
}

type SourceQuestionPartTable = {
  Row: {
    id: string
    source_question_id: string
    position: number
    label: string
    prompt: string
    correct_answer: Json
    accepted_answers: Json
    prompt_pattern_id: string | null
    answer_type_id: string | null
    editorial_difficulty: number | null
    stability: FactualStability | null
    audience_suitability: AudienceSuitability | null
    audience_fit: AudienceFit | null
    adult_content: boolean | null
    audience_scope: AudienceScope | null
    audience_locale: string | null
    content_flags: ContentFlag[] | null
    as_of_date: string | null
    review_due_at: string | null
    valid_from: string | null
    expires_at: string | null
    media_asset_id: string | null
    created_at: string
    updated_at: string
  }
  Insert: {
    id?: string
    source_question_id: string
    position: number
    label: string
    prompt: string
    correct_answer: Json
    accepted_answers?: Json
    prompt_pattern_id?: string | null
    answer_type_id?: string | null
    editorial_difficulty?: number | null
    stability?: FactualStability | null
    audience_suitability?: AudienceSuitability | null
    audience_fit?: AudienceFit | null
    adult_content?: boolean | null
    audience_scope?: AudienceScope | null
    audience_locale?: string | null
    content_flags?: ContentFlag[] | null
    as_of_date?: string | null
    review_due_at?: string | null
    valid_from?: string | null
    expires_at?: string | null
    media_asset_id?: string | null
    created_at?: string
    updated_at?: string
  }
  Update: Partial<SourceQuestionPartTable['Insert']>
  Relationships: [
    {
      foreignKeyName: 'source_question_parts_source_question_id_fkey'
      columns: ['source_question_id']
      isOneToOne: false
      referencedRelation: 'source_questions'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'source_question_parts_prompt_pattern_id_fkey'
      columns: ['prompt_pattern_id']
      isOneToOne: false
      referencedRelation: 'prompt_patterns'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'source_question_parts_answer_type_id_fkey'
      columns: ['answer_type_id']
      isOneToOne: false
      referencedRelation: 'answer_types'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'source_question_parts_media_asset_id_fkey'
      columns: ['media_asset_id']
      isOneToOne: false
      referencedRelation: 'media_assets'
      referencedColumns: ['id']
    },
  ]
}

type SourceQuestionPartCategoryTable = {
  Row: {
    source_question_part_id: string
    category_id: string
    role: CategoryRole
    created_at: string
  }
  Insert: {
    source_question_part_id: string
    category_id: string
    role?: CategoryRole
    created_at?: string
  }
  Update: Partial<SourceQuestionPartCategoryTable['Insert']>
  Relationships: [
    {
      foreignKeyName: 'source_question_part_categories_source_question_part_id_fkey'
      columns: ['source_question_part_id']
      isOneToOne: false
      referencedRelation: 'source_question_parts'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'source_question_part_categories_category_id_fkey'
      columns: ['category_id']
      isOneToOne: false
      referencedRelation: 'categories'
      referencedColumns: ['id']
    },
  ]
}

type SourceQuestionPartTagTable = {
  Row: {
    source_question_part_id: string
    tag_id: string
    created_at: string
  }
  Insert: {
    source_question_part_id: string
    tag_id: string
    created_at?: string
  }
  Update: Partial<SourceQuestionPartTagTable['Insert']>
  Relationships: [
    {
      foreignKeyName: 'source_question_part_tags_source_question_part_id_fkey'
      columns: ['source_question_part_id']
      isOneToOne: false
      referencedRelation: 'source_question_parts'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'source_question_part_tags_tag_id_fkey'
      columns: ['tag_id']
      isOneToOne: false
      referencedRelation: 'tags'
      referencedColumns: ['id']
    },
  ]
}

type SourceQuestionBonusTable = {
  Row: {
    id: string
    source_question_id: string
    prompt: string
    correct_answer: Json
    accepted_answers: Json
    points: number
    image_url: string | null
    prompt_pattern_id: string | null
    answer_type_id: string | null
    editorial_difficulty: number | null
    stability: FactualStability | null
    audience_suitability: AudienceSuitability | null
    audience_fit: AudienceFit | null
    adult_content: boolean | null
    tag_mode: 'inherit' | 'replace'
    audience_scope: AudienceScope | null
    audience_locale: string | null
    content_flags: ContentFlag[] | null
    as_of_date: string | null
    review_due_at: string | null
    valid_from: string | null
    expires_at: string | null
    media_asset_id: string | null
    notes: string | null
    source_name: string | null
    source_url: string | null
    source_checked_date: string | null
    created_at: string
    updated_at: string
  }
  Insert: {
    id?: string
    source_question_id: string
    prompt: string
    correct_answer: Json
    accepted_answers?: Json
    points?: number
    image_url?: string | null
    prompt_pattern_id?: string | null
    answer_type_id?: string | null
    editorial_difficulty?: number | null
    stability?: FactualStability | null
    audience_suitability?: AudienceSuitability | null
    audience_fit?: AudienceFit | null
    adult_content?: boolean | null
    tag_mode?: 'inherit' | 'replace'
    audience_scope?: AudienceScope | null
    audience_locale?: string | null
    content_flags?: ContentFlag[] | null
    as_of_date?: string | null
    review_due_at?: string | null
    valid_from?: string | null
    expires_at?: string | null
    media_asset_id?: string | null
    notes?: string | null
    source_name?: string | null
    source_url?: string | null
    source_checked_date?: string | null
    created_at?: string
    updated_at?: string
  }
  Update: Partial<SourceQuestionBonusTable['Insert']>
  Relationships: [
    {
      foreignKeyName: 'source_question_bonuses_source_question_id_fkey'
      columns: ['source_question_id']
      isOneToOne: true
      referencedRelation: 'source_questions'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'source_question_bonuses_prompt_pattern_id_fkey'
      columns: ['prompt_pattern_id']
      isOneToOne: false
      referencedRelation: 'prompt_patterns'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'source_question_bonuses_answer_type_id_fkey'
      columns: ['answer_type_id']
      isOneToOne: false
      referencedRelation: 'answer_types'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'source_question_bonuses_media_asset_id_fkey'
      columns: ['media_asset_id']
      isOneToOne: false
      referencedRelation: 'media_assets'
      referencedColumns: ['id']
    },
  ]
}

type QuestionLibraryImportBatchTable = {
  Row: {
    id: string
    file_name: string
    file_sha256: string
    format_version: number
    normalized_payload: Json
    counts: Json
    imported_at: string
  }
  Insert: {
    id?: string
    file_name: string
    file_sha256: string
    format_version: number
    normalized_payload: Json
    counts: Json
    imported_at?: string
  }
  Update: Partial<QuestionLibraryImportBatchTable['Insert']>
  Relationships: []
}

type ProposedQuestionTagTable = {
  Row: {
    id: string
    normalized_phrase: string
    display_phrase: string
    status: 'pending' | 'mapped' | 'created' | 'ignored'
    resolved_tag_id: string | null
    first_seen_at: string
    last_seen_at: string
    resolved_at: string | null
  }
  Insert: {
    id?: string
    normalized_phrase: string
    display_phrase: string
    status?: 'pending' | 'mapped' | 'created' | 'ignored'
    resolved_tag_id?: string | null
    first_seen_at?: string
    last_seen_at?: string
    resolved_at?: string | null
  }
  Update: Partial<ProposedQuestionTagTable['Insert']>
  Relationships: [
    {
      foreignKeyName: 'proposed_question_tags_resolved_tag_id_fkey'
      columns: ['resolved_tag_id']
      isOneToOne: false
      referencedRelation: 'tags'
      referencedColumns: ['id']
    },
  ]
}

type ProposedQuestionTagAssignmentTable = {
  Row: {
    id: string
    proposed_tag_id: string
    import_batch_id: string | null
    source_question_id: string
    source_question_part_id: string | null
    source_question_bonus_id: string | null
    raw_phrase: string
    created_at: string
    resolved_at: string | null
  }
  Insert: {
    id?: string
    proposed_tag_id: string
    import_batch_id?: string | null
    source_question_id: string
    source_question_part_id?: string | null
    source_question_bonus_id?: string | null
    raw_phrase: string
    created_at?: string
    resolved_at?: string | null
  }
  Update: Partial<ProposedQuestionTagAssignmentTable['Insert']>
  Relationships: [
    {
      foreignKeyName: 'proposed_question_tag_assignments_proposed_tag_id_fkey'
      columns: ['proposed_tag_id']
      isOneToOne: false
      referencedRelation: 'proposed_question_tags'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'proposed_question_tag_assignments_import_batch_id_fkey'
      columns: ['import_batch_id']
      isOneToOne: false
      referencedRelation: 'question_library_import_batches'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'proposed_question_tag_assignments_source_question_id_fkey'
      columns: ['source_question_id']
      isOneToOne: false
      referencedRelation: 'source_questions'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'proposed_question_tag_assignments_source_question_part_id_fkey'
      columns: ['source_question_part_id']
      isOneToOne: false
      referencedRelation: 'source_question_parts'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'proposed_question_tag_assignments_source_question_bonus_id_fkey'
      columns: ['source_question_bonus_id']
      isOneToOne: false
      referencedRelation: 'source_question_bonuses'
      referencedColumns: ['id']
    },
  ]
}

type SourceQuestionBonusCategoryTable = {
  Row: {
    source_question_bonus_id: string
    category_id: string
    role: CategoryRole
    created_at: string
  }
  Insert: {
    source_question_bonus_id: string
    category_id: string
    role?: CategoryRole
    created_at?: string
  }
  Update: Partial<SourceQuestionBonusCategoryTable['Insert']>
  Relationships: [
    {
      foreignKeyName: 'source_question_bonus_categories_source_question_bonus_id_fkey'
      columns: ['source_question_bonus_id']
      isOneToOne: false
      referencedRelation: 'source_question_bonuses'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'source_question_bonus_categories_category_id_fkey'
      columns: ['category_id']
      isOneToOne: false
      referencedRelation: 'categories'
      referencedColumns: ['id']
    },
  ]
}

type SourceQuestionBonusTagTable = {
  Row: {
    source_question_bonus_id: string
    tag_id: string
    created_at: string
  }
  Insert: {
    source_question_bonus_id: string
    tag_id: string
    created_at?: string
  }
  Update: Partial<SourceQuestionBonusTagTable['Insert']>
  Relationships: [
    {
      foreignKeyName: 'source_question_bonus_tags_source_question_bonus_id_fkey'
      columns: ['source_question_bonus_id']
      isOneToOne: false
      referencedRelation: 'source_question_bonuses'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'source_question_bonus_tags_tag_id_fkey'
      columns: ['tag_id']
      isOneToOne: false
      referencedRelation: 'tags'
      referencedColumns: ['id']
    },
  ]
}
