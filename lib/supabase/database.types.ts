export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      quizzes: {
        Row: {
          id: string
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
          title?: string
          status?: string
          round_count?: number
          question_count?: number
          estimated_minutes?: number
          seed_key?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      quiz_questions: {
        Row: QuestionRow & { quiz_id: string; updated_at: string }
        Insert: QuestionInsert & { quiz_id: string; updated_at?: string }
        Update: QuestionUpdate & { quiz_id?: string; updated_at?: string }
        Relationships: [{
          foreignKeyName: 'quiz_questions_quiz_id_fkey'
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
      teams: {
        Row: {
          id: string
          game_id: string
          name: string
          score: number
          created_at: string
        }
        Insert: {
          id?: string
          game_id: string
          name: string
          score?: number
          created_at?: string
        }
        Update: {
          id?: string
          game_id?: string
          name?: string
          score?: number
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
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type QuestionRow = {
  id: string
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
  correct_answer: Json
  options: Json | null
  image_url: string | null
  points_max: number
  notes: string | null
  created_at: string
}

type QuestionInsert = {
  id?: string
  question_key: string
  position: number
  round_number: number
  round_position: number
  round_question_count: number
  round_title: string
  prompt: string
  category?: string | null
  difficulty?: string | null
  question_type: string
  correct_answer: Json
  options?: Json | null
  image_url?: string | null
  points_max?: number
  notes?: string | null
  created_at?: string
}

type QuestionUpdate = Partial<QuestionInsert>
