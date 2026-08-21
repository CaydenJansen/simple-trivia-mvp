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
          as_of_date: string | null
          review_due_at: string | null
          valid_from: string | null
          expires_at: string | null
          media_asset_id: string | null
          prompt_signature: string | null
          tags: string[]
          image_url: string | null
          notes: string | null
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
          as_of_date?: string | null
          review_due_at?: string | null
          valid_from?: string | null
          expires_at?: string | null
          media_asset_id?: string | null
          prompt_signature?: string | null
          tags?: string[]
          image_url?: string | null
          notes?: string | null
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
          as_of_date?: string | null
          review_due_at?: string | null
          valid_from?: string | null
          expires_at?: string | null
          media_asset_id?: string | null
          prompt_signature?: string | null
          tags?: string[]
          image_url?: string | null
          notes?: string | null
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
          created_at?: string
          updated_at?: string
        }
        Relationships: []
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
          question_stage: string
          current_question_key: string | null
          current_content_screen_key: string | null
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
          question_stage?: string
          current_question_key?: string | null
          current_content_screen_key?: string | null
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
          question_stage?: string
          current_question_key?: string | null
          current_content_screen_key?: string | null
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
      teams: {
        Row: {
          id: string
          game_id: string
          name: string
          score: number
          prize_awards: Json
          created_at: string
        }
        Insert: {
          id?: string
          game_id: string
          name: string
          score?: number
          prize_awards?: Json
          created_at?: string
        }
        Update: {
          id?: string
          game_id?: string
          name?: string
          score?: number
          prize_awards?: Json
          created_at?: string
        }
        Relationships: [{
          foreignKeyName: 'teams_game_id_fkey'
          columns: ['game_id']
          isOneToOne: false
          referencedRelation: 'games'
          referencedColumns: ['id']
        }]
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
    }
    Functions: {
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
        }
        Returns: {
          id: string
          name: string
          score: number
        }[]
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
      finalize_game_with_prizes: {
        Args: {
          p_game_id: string
        }
        Returns: number
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
  as_of_date: string | null
  review_due_at: string | null
  valid_from: string | null
  expires_at: string | null
  media_asset_id: string | null
  prompt_signature: string | null
  tags: string[]
  image_url: string | null
  notes: string | null
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
    stability: FactualStability
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
    stability?: FactualStability
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
    stability: FactualStability
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
    prompt: string
    correct_answer: Json
    accepted_answers?: Json
    points?: number
    image_url?: string | null
    prompt_pattern_id?: string | null
    answer_type_id?: string | null
    editorial_difficulty?: number | null
    stability?: FactualStability
    as_of_date?: string | null
    review_due_at?: string | null
    valid_from?: string | null
    expires_at?: string | null
    media_asset_id?: string | null
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
