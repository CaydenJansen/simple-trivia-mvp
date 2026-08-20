-- Simple Trivia deployed-schema baseline captured 2026-08-20.
--
-- This records the six public tables and integrity constraints used by the
-- current application. It is a baseline definition, not a pending redesign.
-- Existing deployed RLS policies and Realtime publication membership are
-- managed by Supabase and are not modified by this file.

create extension if not exists pgcrypto;

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'draft',
  round_count integer not null default 0,
  question_count integer not null default 0,
  estimated_minutes integer not null default 0,
  seed_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  question_key text not null,
  position integer not null,
  round_number integer not null,
  round_position integer not null,
  round_question_count integer not null,
  round_title text not null,
  prompt text not null,
  category text,
  difficulty text,
  question_type text not null,
  correct_answer jsonb not null,
  options jsonb,
  image_url text,
  points_max integer not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quiz_id, question_key),
  unique (quiz_id, position)
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  status text not null default 'lobby',
  current_screen text not null default 'lobby',
  created_at timestamptz not null default now(),
  answer_phase text not null default 'open',
  current_question_key text,
  quiz_id uuid references public.quizzes(id) on delete set null,
  settings jsonb not null default '{}'::jsonb
);

create table if not exists public.game_questions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  question_key text not null,
  position integer not null,
  round_number integer not null,
  round_position integer not null,
  round_question_count integer not null,
  round_title text not null,
  prompt text not null,
  category text,
  difficulty text,
  question_type text not null,
  correct_answer jsonb not null,
  options jsonb,
  image_url text,
  points_max integer not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  unique (game_id, question_key),
  unique (game_id, position)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  name text not null,
  score integer not null default 0,
  created_at timestamptz not null default now(),
  unique (game_id, name)
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  question_key text not null,
  answer_text text not null,
  is_correct boolean,
  points_awarded integer not null default 0,
  grading_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, team_id, question_key)
);

create index if not exists quiz_questions_quiz_order_idx
  on public.quiz_questions (quiz_id, position);

create index if not exists game_questions_game_order_idx
  on public.game_questions (game_id, position);

create index if not exists teams_game_score_idx
  on public.teams (game_id, score desc);

create index if not exists submissions_game_question_idx
  on public.submissions (game_id, question_key);
