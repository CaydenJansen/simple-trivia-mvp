export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type QuestionOrigin = 'platform' | 'user'
export type QuestionStatus = 'draft' | 'needs_review' | 'active' | 'archived'
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
          prompt: string
          correct_answer: Json
          accepted_answers: Json
          options: Json | null
          category: string | null
          difficulty: string | null
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
          prompt: string
          correct_answer: Json
          accepted_answers?: Json
          options?: Json | null
          category?: string | null
          difficulty?: string | null
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
          prompt?: string
          correct_answer?: Json
          accepted_answers?: Json
          options?: Json | null
          category?: string | null
          difficulty?: string | null
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
      games: {
        Row: {
          id: string
          code: string
          title: string
          status: string
          current_screen: string
          created_at: string
          answer_phase: string
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
    }
    Views: Record<string, never>
    Functions: {
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
