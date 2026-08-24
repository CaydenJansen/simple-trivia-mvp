-- Simple Trivia schema definition.
--
-- The original six-table deployed baseline was captured 2026-08-20. The
-- reusable source-question foundation is defined below and versioned in
-- supabase/migrations/20260820130000_add_source_questions.sql.
-- Atomic live-game operations are versioned in
-- supabase/migrations/20260820190000_add_atomic_live_game_operations.sql.
-- Hidden end-of-round scoring support is versioned in
-- supabase/migrations/20260820200000_add_hidden_question_scoring.sql.
-- Prepared-tiebreaker authoring and game snapshots are versioned in
-- supabase/migrations/20260821170000_add_prepared_tiebreakers.sql.
-- Auto-Build source content is versioned in
-- supabase/migrations/20260821190000_add_auto_build_sources.sql.
-- The normalized Question Library metadata foundation is versioned in
-- supabase/migrations/20260821230000_add_question_library_metadata_foundation.sql.
-- The RLS-aware normalized catalog read model and atomic host-question save are
-- versioned in
-- supabase/migrations/20260821240000_add_normalized_question_catalog_api.sql.
-- The validation-first, atomic spreadsheet ingestion boundary is versioned in
-- supabase/migrations/20260824103000_add_question_library_import_pipeline.sql.
-- Existing deployed RLS policies and Realtime publication membership are
-- otherwise managed by Supabase and are not replaced by this file.

create extension if not exists pgcrypto;

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'draft',
  round_count integer not null default 0,
  question_count integer not null default 0,
  estimated_minutes integer not null default 0,
  seed_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.source_questions (
  id uuid primary key default gen_random_uuid(),
  origin text not null check (origin in ('platform', 'user')),
  owner_id uuid references auth.users(id) on delete cascade,
  question_type text not null check (question_type in (
    'single-answer', 'image-question', 'multiple-choice',
    'multi-answer', 'multi-part', 'ranking'
  )),
  prompt text not null check (length(btrim(prompt)) > 0),
  correct_answer jsonb not null,
  accepted_answers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(accepted_answers) = 'array'),
  options jsonb,
  category text,
  difficulty text,
  tags text[] not null default '{}'::text[],
  image_url text,
  notes text,
  source_name text,
  source_url text,
  source_checked_date date,
  status text not null default 'draft'
    check (status in ('draft', 'needs_review', 'active', 'archived')),
  is_verified boolean not null default false,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  last_reviewed_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  import_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (origin = 'user' and owner_id is not null)
    or (origin = 'platform' and owner_id is null)
  ),
  check (
    origin = 'platform'
    or (
      is_verified = false
      and verified_at is null
      and verified_by is null
    )
  )
);

create table if not exists public.source_tiebreakers (
  id uuid primary key default gen_random_uuid(),
  prompt text not null check (length(btrim(prompt)) > 0),
  correct_value numeric not null,
  answer_unit text,
  notes text,
  status text not null default 'draft'
    check (status in ('draft', 'needs_review', 'active', 'archived')),
  is_verified boolean not null default false,
  last_reviewed_at timestamptz,
  import_key text unique,
  source_name text,
  source_url text,
  source_checked_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  question_key text not null,
  position integer not null,
  item_position integer not null,
  round_number integer not null,
  round_position integer not null,
  round_question_count integer not null,
  round_title text not null,
  prompt text not null,
  category text,
  difficulty text,
  question_type text not null,
  correct_answer jsonb not null,
  accepted_answers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(accepted_answers) = 'array'),
  options jsonb,
  tags text[] not null default '{}'::text[],
  image_url text,
  points_max integer not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_question_id uuid references public.source_questions(id) on delete set null,
  source_revision integer check (source_revision is null or source_revision > 0),
  unique (quiz_id, question_key),
  unique (quiz_id, position)
);

create table if not exists public.quiz_content_screens (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  screen_key text not null,
  item_position integer not null check (item_position > 0),
  round_number integer not null check (round_number > 0),
  round_title text not null,
  title text not null check (length(btrim(title)) > 0),
  body text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quiz_id, screen_key),
  unique (quiz_id, item_position)
);

create table if not exists public.quiz_tiebreakers (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  tiebreaker_key text not null,
  position integer not null check (position > 0),
  prompt text not null check (length(btrim(prompt)) > 0),
  correct_value numeric not null,
  answer_unit text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quiz_id, tiebreaker_key),
  unique (quiz_id, position)
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  status text not null default 'lobby'
    constraint games_status_check
    check (status in ('lobby', 'live', 'finished', 'cancelled')),
  current_screen text not null default 'lobby',
  created_at timestamptz not null default now(),
  answer_phase text not null default 'open',
  current_question_key text,
  current_content_screen_key text,
  quiz_id uuid references public.quizzes(id) on delete set null,
  settings jsonb not null default '{}'::jsonb
);

create table if not exists public.game_questions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  question_key text not null,
  position integer not null,
  item_position integer not null,
  round_number integer not null,
  round_position integer not null,
  round_question_count integer not null,
  round_title text not null,
  prompt text not null,
  category text,
  difficulty text,
  question_type text not null,
  correct_answer jsonb not null,
  accepted_answers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(accepted_answers) = 'array'),
  options jsonb,
  tags text[] not null default '{}'::text[],
  image_url text,
  points_max integer not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  unique (game_id, question_key),
  unique (game_id, position)
);

create table if not exists public.game_content_screens (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  screen_key text not null,
  item_position integer not null check (item_position > 0),
  round_number integer not null check (round_number > 0),
  round_title text not null,
  title text not null check (length(btrim(title)) > 0),
  body text,
  image_url text,
  created_at timestamptz not null default now(),
  unique (game_id, screen_key),
  unique (game_id, item_position)
);

create table if not exists public.game_tiebreakers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  tiebreaker_key text not null,
  position integer not null check (position > 0),
  prompt text not null check (length(btrim(prompt)) > 0),
  correct_value numeric not null,
  answer_unit text,
  notes text,
  created_at timestamptz not null default now(),
  unique (game_id, tiebreaker_key),
  unique (game_id, position)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  name text not null,
  score integer not null default 0,
  prize_awards jsonb not null default '[]'::jsonb
    check (jsonb_typeof(prize_awards) = 'array'),
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

create index if not exists quiz_content_screens_quiz_order_idx
  on public.quiz_content_screens (quiz_id, item_position);

create index if not exists quiz_tiebreakers_quiz_order_idx
  on public.quiz_tiebreakers (quiz_id, position);

create index if not exists quizzes_owner_updated_idx
  on public.quizzes (owner_id, updated_at desc);

create unique index if not exists source_questions_import_key_idx
  on public.source_questions (origin, import_key)
  where import_key is not null;

create index if not exists source_questions_owner_status_idx
  on public.source_questions (owner_id, status, updated_at desc)
  where origin = 'user';

create index if not exists source_questions_library_filters_idx
  on public.source_questions (status, question_type, category, difficulty)
  where origin = 'platform';

create index if not exists source_questions_tags_idx
  on public.source_questions using gin (tags);

create index if not exists source_questions_prompt_search_idx
  on public.source_questions using gin (to_tsvector('simple', prompt));

create index if not exists source_tiebreakers_status_idx
  on public.source_tiebreakers (status, updated_at desc);

create index if not exists quiz_questions_source_question_idx
  on public.quiz_questions (source_question_id)
  where source_question_id is not null;

create index if not exists game_questions_game_order_idx
  on public.game_questions (game_id, position);

create index if not exists game_content_screens_game_order_idx
  on public.game_content_screens (game_id, item_position);

create index if not exists game_tiebreakers_game_order_idx
  on public.game_tiebreakers (game_id, position);

create index if not exists teams_game_score_idx
  on public.teams (game_id, score desc);

create index if not exists submissions_game_question_idx
  on public.submissions (game_id, question_key);

create or replace function public.join_live_game(
  p_game_id uuid,
  p_team_name text
)
returns table (id uuid, name text, score integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := btrim(p_team_name);
begin
  if normalized_name = '' then
    raise exception 'Team name is required';
  end if;

  if not exists (
    select 1
    from public.games
    where games.id = p_game_id
      and games.status = 'lobby'
      and games.current_screen = 'lobby'
  ) then
    raise exception 'Game is not accepting new teams';
  end if;

  return query
  insert into public.teams (game_id, name, score)
  values (p_game_id, normalized_name, 0)
  returning teams.id, teams.name, teams.score;
end;
$$;

create or replace function public.submit_player_answer(
  p_game_id uuid,
  p_team_id uuid,
  p_answer_text text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_question_key text;
  submission_id uuid;
begin
  select games.current_question_key
    into active_question_key
  from public.games
  where games.id = p_game_id
    and games.status = 'live'
    and games.answer_phase = 'open'
    and games.current_screen in (
      'single-answer', 'image-question', 'multiple-choice',
      'multi-answer', 'multi-part', 'ranking'
    )
  for update;

  if active_question_key is null then
    raise exception 'Answers are not open';
  end if;

  if not exists (
    select 1
    from public.teams
    where teams.id = p_team_id
      and teams.game_id = p_game_id
  ) then
    raise exception 'Team is not part of this game';
  end if;

  insert into public.submissions (
    game_id, team_id, question_key, answer_text,
    is_correct, points_awarded, grading_json
  )
  values (
    p_game_id, p_team_id, active_question_key, btrim(p_answer_text),
    null, 0, null
  )
  on conflict (game_id, team_id, question_key)
  do update set
    answer_text = excluded.answer_text,
    is_correct = null,
    points_awarded = 0,
    grading_json = null,
    updated_at = now()
  returning submissions.id into submission_id;

  return submission_id;
end;
$$;

create or replace function public.get_player_game_question(
  p_game_id uuid,
  p_question_key text
)
returns table (
  question_key text,
  "position" integer,
  round_number integer,
  round_position integer,
  round_question_count integer,
  round_title text,
  prompt text,
  category text,
  difficulty text,
  question_type text,
  correct_answer jsonb,
  options jsonb,
  image_url text,
  points_max integer,
  notes text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    game_questions.question_key,
    game_questions.position,
    game_questions.round_number,
    game_questions.round_position,
    game_questions.round_question_count,
    game_questions.round_title,
    game_questions.prompt,
    game_questions.category,
    game_questions.difficulty,
    game_questions.question_type,
    case
      when games.answer_phase = 'revealed' then game_questions.correct_answer
      else null
    end,
    game_questions.options,
    game_questions.image_url,
    game_questions.points_max,
    case
      when games.answer_phase = 'revealed' then game_questions.notes
      else null
    end
  from public.games
  join public.game_questions
    on game_questions.game_id = games.id
  where games.id = p_game_id
    and games.current_question_key = p_question_key
    and game_questions.question_key = p_question_key;
$$;

revoke all on function public.join_live_game(uuid, text) from public;
revoke all on function public.submit_player_answer(uuid, uuid, text) from public;
revoke all on function public.get_player_game_question(uuid, text) from public;

grant execute on function public.join_live_game(uuid, text) to anon, authenticated;
grant execute on function public.submit_player_answer(uuid, uuid, text) to anon, authenticated;
grant execute on function public.get_player_game_question(uuid, text) to anon, authenticated;

revoke insert on table public.teams from anon;
revoke insert, update on table public.submissions from anon;
revoke select on table public.game_questions from anon;

create or replace function public.cancel_host_game(
  p_game_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cancelled_game_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.games
  set
    status = 'cancelled',
    current_screen = 'game-ended',
    answer_phase = 'closed',
    current_content_screen_key = null
  where games.code = p_game_code
    and games.status in ('lobby', 'live')
    and exists (
      select 1
      from public.quizzes
      where quizzes.id = games.quiz_id
        and quizzes.owner_id = auth.uid()
    )
  returning games.id into cancelled_game_id;

  if cancelled_game_id is null then
    raise exception 'Active game not found or not owned by current host';
  end if;

  return cancelled_game_id;
end;
$$;

revoke all on function public.cancel_host_game(text) from public;
grant execute on function public.cancel_host_game(text) to authenticated;

comment on function public.cancel_host_game(text) is
  'Ends an owned lobby or live game without deleting its teams, submissions, scores, or snapshots.';

-- Normalized source metadata. Legacy source-question category, difficulty,
-- tags, image URL, and answer payload columns remain runtime compatibility
-- projections while the editors and snapshot pipeline migrate incrementally.
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prompt_patterns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.answer_types (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  parent_tag_id uuid references public.tags(id) on delete set null,
  specificity smallint not null default 2 check (specificity between 1 and 4),
  diversity_weight numeric(5,2) not null default 1 check (diversity_weight >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tag_aliases (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.tags(id) on delete cascade,
  alias text not null,
  normalized_alias text not null unique,
  created_at timestamptz not null default now(),
  unique (tag_id, alias)
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  origin text not null check (origin in ('platform', 'user')),
  owner_id uuid references auth.users(id) on delete cascade,
  kind text not null default 'image' check (kind in ('image', 'audio', 'video')),
  url text not null,
  alt_text text,
  caption text,
  credit text,
  import_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (origin = 'user' and owner_id is not null)
    or (origin = 'platform' and owner_id is null)
  )
);

alter table public.source_questions
  add column if not exists mechanic text,
  add column if not exists prompt_pattern_id uuid references public.prompt_patterns(id) on delete set null,
  add column if not exists answer_type_id uuid references public.answer_types(id) on delete set null,
  add column if not exists editorial_difficulty smallint,
  add column if not exists scoring_mode text,
  add column if not exists stability text not null default 'stable',
  add column if not exists as_of_date date,
  add column if not exists review_due_at timestamptz,
  add column if not exists valid_from timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists media_asset_id uuid references public.media_assets(id) on delete set null,
  add column if not exists prompt_signature text;

create table if not exists public.source_question_categories (
  source_question_id uuid not null references public.source_questions(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  role text not null default 'primary' check (role in ('primary', 'secondary')),
  created_at timestamptz not null default now(),
  primary key (source_question_id, category_id)
);

create table if not exists public.source_question_tags (
  source_question_id uuid not null references public.source_questions(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (source_question_id, tag_id)
);

create table if not exists public.source_question_parts (
  id uuid primary key default gen_random_uuid(),
  source_question_id uuid not null references public.source_questions(id) on delete cascade,
  position integer not null check (position > 0),
  label text not null,
  prompt text not null,
  correct_answer jsonb not null,
  accepted_answers jsonb not null default '[]'::jsonb,
  prompt_pattern_id uuid references public.prompt_patterns(id) on delete set null,
  answer_type_id uuid references public.answer_types(id) on delete set null,
  editorial_difficulty smallint check (editorial_difficulty is null or editorial_difficulty between 1 and 5),
  stability text not null default 'stable' check (stability in ('stable', 'review_periodically', 'volatile')),
  as_of_date date,
  review_due_at timestamptz,
  valid_from timestamptz,
  expires_at timestamptz,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_question_id, position),
  unique (source_question_id, label)
);

create table if not exists public.source_question_part_categories (
  source_question_part_id uuid not null references public.source_question_parts(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  role text not null default 'primary' check (role in ('primary', 'secondary')),
  created_at timestamptz not null default now(),
  primary key (source_question_part_id, category_id)
);

create table if not exists public.source_question_part_tags (
  source_question_part_id uuid not null references public.source_question_parts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (source_question_part_id, tag_id)
);

create table if not exists public.source_question_bonuses (
  id uuid primary key default gen_random_uuid(),
  source_question_id uuid not null unique references public.source_questions(id) on delete cascade,
  prompt text not null,
  correct_answer jsonb not null,
  accepted_answers jsonb not null default '[]'::jsonb,
  points integer not null default 1 check (points > 0),
  image_url text,
  prompt_pattern_id uuid references public.prompt_patterns(id) on delete set null,
  answer_type_id uuid references public.answer_types(id) on delete set null,
  editorial_difficulty smallint check (editorial_difficulty is null or editorial_difficulty between 1 and 5),
  stability text not null default 'stable' check (stability in ('stable', 'review_periodically', 'volatile')),
  as_of_date date,
  review_due_at timestamptz,
  valid_from timestamptz,
  expires_at timestamptz,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  notes text,
  source_name text,
  source_url text,
  source_checked_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.source_question_bonus_categories (
  source_question_bonus_id uuid not null references public.source_question_bonuses(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  role text not null default 'primary' check (role in ('primary', 'secondary')),
  created_at timestamptz not null default now(),
  primary key (source_question_bonus_id, category_id)
);

create table if not exists public.source_question_bonus_tags (
  source_question_bonus_id uuid not null references public.source_question_bonuses(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (source_question_bonus_id, tag_id)
);

create table if not exists public.question_library_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  file_sha256 text not null unique check (file_sha256 ~ '^[0-9a-f]{64}$'),
  format_version integer not null check (format_version > 0),
  normalized_payload jsonb not null check (jsonb_typeof(normalized_payload) = 'object'),
  counts jsonb not null check (jsonb_typeof(counts) = 'object'),
  imported_at timestamptz not null default now()
);

create unique index if not exists media_assets_import_key_idx
  on public.media_assets (import_key)
  where import_key is not null;

create or replace view public.source_question_catalog
with (security_invoker = true)
as
select
  source_questions.*,
  coalesce(category_metadata.category_ids, '{}'::uuid[]) as category_ids,
  coalesce(category_metadata.secondary_category_ids, '{}'::uuid[]) as secondary_category_ids,
  category_metadata.primary_category_id,
  category_metadata.primary_category_name,
  coalesce(category_metadata.category_names, '{}'::text[]) as category_names,
  coalesce(tag_metadata.tag_ids, '{}'::uuid[]) as tag_ids,
  coalesce(tag_metadata.tag_names, '{}'::text[]) as tag_names
from public.source_questions
left join lateral (
  select
    array_agg(source_question_categories.category_id order by source_question_categories.role, categories.sort_order)
      as category_ids,
    array_agg(source_question_categories.category_id order by categories.sort_order)
      filter (where source_question_categories.role = 'secondary') as secondary_category_ids,
    (array_agg(source_question_categories.category_id order by categories.sort_order)
      filter (where source_question_categories.role = 'primary'))[1] as primary_category_id,
    max(categories.name)
      filter (where source_question_categories.role = 'primary') as primary_category_name,
    array_agg(categories.name order by source_question_categories.role, categories.sort_order) as category_names
  from public.source_question_categories
  join public.categories on categories.id = source_question_categories.category_id
  where source_question_categories.source_question_id = source_questions.id
) as category_metadata on true
left join lateral (
  select
    array_agg(tags.id order by tags.name) as tag_ids,
    array_agg(tags.name order by tags.name) as tag_names
  from public.source_question_tags
  join public.tags on tags.id = source_question_tags.tag_id
  where source_question_tags.source_question_id = source_questions.id
) as tag_metadata on true;
