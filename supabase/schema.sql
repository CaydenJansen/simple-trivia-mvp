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
-- Consequential final-tie resolution, numeric submissions, and score-independent
-- final placements are versioned in
-- supabase/migrations/20260824150000_add_live_tiebreaker_resolution.sql.
-- Optional account-free team PIN identities are versioned in
-- supabase/migrations/20260826110000_add_optional_team_pins.sql.
-- Auto-Build source content is versioned in
-- supabase/migrations/20260821190000_add_auto_build_sources.sql.
-- The normalized Question Library metadata foundation is versioned in
-- supabase/migrations/20260821230000_add_question_library_metadata_foundation.sql.
-- The RLS-aware normalized catalog read model and atomic host-question save are
-- versioned in
-- supabase/migrations/20260821240000_add_normalized_question_catalog_api.sql.
-- The validation-first, atomic spreadsheet ingestion boundary is versioned in
-- supabase/migrations/20260824103000_add_question_library_import_pipeline.sql.
-- Audience defaults, child metadata inheritance, and snapshot metadata are
-- versioned in
-- supabase/migrations/20260824120000_add_question_audience_inheritance.sql.
-- The approved long-format workbook, controlled starter tags, non-blocking
-- proposed-tag review, Audience Fit, Adult Content, and v3 import RPC are
-- versioned in migrations 20260824140000 and 20260824141000.
-- Existing deployed RLS policies and Realtime publication membership are
-- otherwise managed by Supabase and are not replaced by this file.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

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
  audience_suitability text not null default 'general'
    check (audience_suitability in ('family', 'general', 'adult')),
  audience_fit text not null default 'broad'
    check (audience_fit in ('broad', 'kids', 'young_adults', 'older_adults')),
  adult_content boolean not null default false,
  audience_scope text not null default 'global'
    check (audience_scope in ('global', 'country_specific')),
  audience_locale text,
  content_flags text[] not null default '{}'::text[],
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
  ),
  check (
    (audience_scope = 'global' and audience_locale is null)
    or (audience_scope = 'country_specific' and length(btrim(audience_locale)) > 0)
  ),
  check (content_flags <@ array[
    'sexual_health', 'sexual_content', 'alcohol', 'drugs', 'violence',
    'death', 'profanity', 'gambling'
  ]::text[])
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
  primary_category_id uuid,
  editorial_difficulty smallint check (editorial_difficulty between 1 and 5),
  audience_fit text not null default 'broad'
    check (audience_fit in ('broad', 'kids', 'young_adults', 'older_adults')),
  adult_content boolean not null default false,
  audience_scope text not null default 'global'
    check (audience_scope in ('global', 'country_specific')),
  audience_locale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (audience_scope = 'global' and audience_locale is null)
    or (audience_scope = 'country_specific' and length(btrim(audience_locale)) > 0)
  )
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
  metadata_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata_snapshot) = 'object'),
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
  answer_editing_allowed boolean not null default false,
  current_question_key text,
  current_content_screen_key text,
  quiz_id uuid references public.quizzes(id) on delete set null,
  settings jsonb not null default '{}'::jsonb
);

create table if not exists public.host_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  game_settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(game_settings) = 'object'),
  ui_hints jsonb not null default '{}'::jsonb
    check (jsonb_typeof(ui_hints) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  metadata_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata_snapshot) = 'object'),
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

create table if not exists public.team_profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) > 0),
  name_key text not null check (length(btrim(name_key)) > 0),
  pin_digest text not null check (pin_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_joined_at timestamptz not null default now(),
  unique (name_key, pin_digest)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  team_profile_id uuid references public.team_profiles(id) on delete set null,
  name text not null,
  score integer not null default 0,
  prize_awards jsonb not null default '[]'::jsonb
    check (jsonb_typeof(prize_awards) = 'array'),
  final_placement integer,
  final_bottom_placement integer,
  final_sort_order integer,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (game_id, name)
);

create table if not exists public.game_reactions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  team_name text not null check (length(btrim(team_name)) > 0),
  reaction text not null check (reaction in ('👍', '❤️', '🥰', '😂', '😮', '😢', '😡')),
  created_at timestamptz not null default now()
);

create table if not exists public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  request_token uuid not null default gen_random_uuid() unique,
  game_id uuid not null references public.games(id) on delete cascade,
  team_profile_id uuid references public.team_profiles(id) on delete set null,
  requested_name text not null check (length(btrim(requested_name)) > 0),
  name_key text not null check (length(btrim(name_key)) > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  team_id uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create unique index if not exists team_join_requests_one_pending_name_idx
  on public.team_join_requests (game_id, name_key)
  where status = 'pending';

create unique index if not exists team_join_requests_one_pending_profile_idx
  on public.team_join_requests (game_id, team_profile_id)
  where status = 'pending' and team_profile_id is not null;

create index if not exists team_join_requests_host_queue_idx
  on public.team_join_requests (game_id, status, created_at);

create table if not exists public.game_tie_resolutions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  tied_score integer not null,
  team_ids uuid[] not null check (cardinality(team_ids) > 1),
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  resolution_method text check (resolution_method in ('tiebreaker', 'allowed_tie', 'manual')),
  ordered_team_ids uuid[],
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (game_id, tied_score)
);

create table if not exists public.game_tiebreaker_attempts (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  resolution_id uuid not null references public.game_tie_resolutions(id) on delete cascade,
  game_tiebreaker_id uuid not null references public.game_tiebreakers(id) on delete restrict,
  team_ids uuid[] not null check (cardinality(team_ids) > 1),
  status text not null default 'open' check (status in ('open', 'closed', 'resolved', 'tied')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  revealed_at timestamptz,
  unique (game_tiebreaker_id)
);

alter table public.games
  add column if not exists current_tiebreaker_attempt_id uuid references public.game_tiebreaker_attempts(id) on delete set null;

create table if not exists public.game_tiebreaker_submissions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  attempt_id uuid not null references public.game_tiebreaker_attempts(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  numeric_answer numeric not null,
  distance numeric check (distance is null or distance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, team_id)
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

create index if not exists teams_game_last_seen_idx
  on public.teams (game_id, last_seen_at desc);

create index if not exists game_reactions_game_created_idx
  on public.game_reactions (game_id, created_at desc);

create index if not exists teams_team_profile_history_idx
  on public.teams (team_profile_id, created_at desc)
  where team_profile_id is not null;

create unique index if not exists teams_one_profile_per_game_idx
  on public.teams (game_id, team_profile_id)
  where team_profile_id is not null;

create index if not exists submissions_game_question_idx
  on public.submissions (game_id, question_key);

create or replace function public.join_live_game(
  p_game_id uuid,
  p_team_name text,
  p_team_pin text default null,
  p_pin_mode text default 'none'
)
returns table (request_id uuid, request_token uuid, name text, admission_status text, team_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := btrim(p_team_name);
  normalized_name_key text;
  normalized_pin text := coalesce(btrim(p_team_pin), '');
  requested_pin_mode text := coalesce(p_pin_mode, 'none');
  requested_pin_digest text;
  linked_profile_id uuid;
  created_team_id uuid;
  approval_required boolean := true;
begin
  if normalized_name = '' then raise exception 'Team name is required'; end if;
  if requested_pin_mode not in ('none', 'have', 'create') then raise exception 'TEAM_PIN_INVALID'; end if;
  select coalesce(games.settings ->> 'team_approval_required', 'true') <> 'false'
  into approval_required
  from public.games
  where games.id = p_game_id and games.status in ('lobby', 'live');
  if not found then raise exception 'Game is not accepting new teams'; end if;

  normalized_name_key := lower(regexp_replace(normalized_name, '\s+', ' ', 'g'));
  if exists (
    select 1 from public.teams
    where teams.game_id = p_game_id
      and lower(regexp_replace(btrim(teams.name), '\s+', ' ', 'g')) = normalized_name_key
  ) or exists (
    select 1 from public.team_join_requests
    where team_join_requests.game_id = p_game_id
      and team_join_requests.name_key = normalized_name_key
      and team_join_requests.status = 'pending'
  ) then
    raise exception 'TEAM_NAME_TAKEN';
  end if;

  if requested_pin_mode <> 'none' then
    if normalized_pin !~ '^[0-9]{4}$' then raise exception 'TEAM_PIN_INVALID'; end if;
    requested_pin_digest := encode(extensions.digest(normalized_name_key || ':' || normalized_pin, 'sha256'), 'hex');

    if requested_pin_mode = 'have' then
      select team_profiles.id into linked_profile_id
      from public.team_profiles
      where team_profiles.name_key = normalized_name_key and team_profiles.pin_digest = requested_pin_digest;
      if linked_profile_id is null then raise exception 'TEAM_PIN_NOT_FOUND'; end if;
      if exists (
        select 1 from public.teams where teams.game_id = p_game_id and teams.team_profile_id = linked_profile_id
      ) or exists (
        select 1 from public.team_join_requests
        where team_join_requests.game_id = p_game_id
          and team_join_requests.team_profile_id = linked_profile_id
          and team_join_requests.status = 'pending'
      ) then
        raise exception 'TEAM_ALREADY_JOINED';
      end if;
      update public.team_profiles
      set display_name = normalized_name, updated_at = now(), last_joined_at = now()
      where team_profiles.id = linked_profile_id;
    else
      select team_profiles.id into linked_profile_id
      from public.team_profiles
      where team_profiles.name_key = normalized_name_key
        and team_profiles.pin_digest = requested_pin_digest
        and not exists (select 1 from public.teams where teams.team_profile_id = team_profiles.id);
      if linked_profile_id is not null then
        update public.team_profiles
        set display_name = normalized_name, updated_at = now(), last_joined_at = now()
        where team_profiles.id = linked_profile_id;
      elsif exists (
        select 1 from public.team_profiles
        where team_profiles.name_key = normalized_name_key and team_profiles.pin_digest = requested_pin_digest
      ) then
        raise exception 'TEAM_PIN_ALREADY_EXISTS';
      else
        insert into public.team_profiles (display_name, name_key, pin_digest)
        values (normalized_name, normalized_name_key, requested_pin_digest)
        returning team_profiles.id into linked_profile_id;
      end if;
    end if;
  end if;

  if not approval_required then
    insert into public.teams (game_id, name, score, team_profile_id)
    values (p_game_id, normalized_name, 0, linked_profile_id)
    returning teams.id into created_team_id;
  end if;

  return query
  insert into public.team_join_requests (game_id, team_profile_id, requested_name, name_key, status, team_id, decided_at)
  values (
    p_game_id, linked_profile_id, normalized_name, normalized_name_key,
    case when approval_required then 'pending' else 'approved' end,
    created_team_id,
    case when approval_required then null else now() end
  )
  returning team_join_requests.id, team_join_requests.request_token,
    team_join_requests.requested_name, team_join_requests.status, team_join_requests.team_id;
end;
$$;

create or replace function public.get_team_join_request(p_request_id uuid, p_request_token uuid)
returns table (admission_status text, team_id uuid, name text, game_status text)
language sql
security definer
set search_path = ''
stable
as $$
  select requests.status, requests.team_id, requests.requested_name, games.status
  from public.team_join_requests requests
  join public.games on games.id = requests.game_id
  where requests.id = p_request_id and requests.request_token = p_request_token;
$$;

create or replace function public.decide_team_join_request(p_request_id uuid, p_decision text)
returns table (request_id uuid, admission_status text, team_id uuid, name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.team_join_requests%rowtype;
  created_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_decision not in ('approved', 'denied') then raise exception 'Invalid admission decision'; end if;

  select requests.* into request_row
  from public.team_join_requests requests
  join public.games on games.id = requests.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where requests.id = p_request_id and quizzes.owner_id = auth.uid()
  for update of requests;

  if request_row.id is null then raise exception 'Join request not found'; end if;
  if request_row.status <> 'pending' then raise exception 'Join request has already been decided'; end if;

  if p_decision = 'approved' then
    if not exists (select 1 from public.games where games.id = request_row.game_id and games.status in ('lobby', 'live')) then
      raise exception 'Game is not accepting new teams';
    end if;
    insert into public.teams (game_id, name, score, team_profile_id)
    values (request_row.game_id, request_row.requested_name, 0, request_row.team_profile_id)
    returning teams.id into created_team_id;
  end if;

  update public.team_join_requests
  set status = p_decision, team_id = created_team_id, decided_at = now()
  where team_join_requests.id = request_row.id;

  return query select request_row.id, p_decision, created_team_id, request_row.requested_name;
end;
$$;

create or replace function public.withdraw_team_join_request(p_request_id uuid, p_request_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.team_join_requests
  where team_join_requests.id = p_request_id
    and team_join_requests.request_token = p_request_token
    and team_join_requests.status = 'pending';
  return found;
end;
$$;

create or replace function public.remove_team_from_game(p_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare removed_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  delete from public.teams
  using public.games, public.quizzes
  where teams.id = p_team_id and games.id = teams.game_id and quizzes.id = games.quiz_id
    and quizzes.owner_id = auth.uid() and games.status in ('lobby', 'live')
  returning teams.id into removed_team_id;
  if removed_team_id is null then raise exception 'Team not found or game is no longer active'; end if;
  return removed_team_id;
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

revoke all on function public.join_live_game(uuid, text, text, text) from public;
revoke all on function public.get_team_join_request(uuid, uuid) from public;
revoke all on function public.decide_team_join_request(uuid, text) from public;
revoke all on function public.withdraw_team_join_request(uuid, uuid) from public;
revoke all on function public.remove_team_from_game(uuid) from public;
revoke all on function public.submit_player_answer(uuid, uuid, text) from public;
revoke all on function public.get_player_game_question(uuid, text) from public;

grant execute on function public.join_live_game(uuid, text, text, text) to anon, authenticated;
grant execute on function public.get_team_join_request(uuid, uuid) to anon, authenticated;
grant execute on function public.decide_team_join_request(uuid, text) to authenticated;
grant execute on function public.withdraw_team_join_request(uuid, uuid) to anon, authenticated;
grant execute on function public.remove_team_from_game(uuid) to authenticated;
grant execute on function public.submit_player_answer(uuid, uuid, text) to anon, authenticated;
grant execute on function public.get_player_game_question(uuid, text) to anon, authenticated;

comment on function public.join_live_game(uuid, text, text, text) is
  'Requests host approval to join a lobby/live game and optionally creates or links an account-free team PIN profile.';

comment on function public.get_team_join_request(uuid, uuid) is
  'Returns one player admission result when both capability identifiers match.';

comment on function public.decide_team_join_request(uuid, text) is
  'Lets the owning host approve or deny a pending team; approval atomically creates the game team.';

revoke insert on table public.teams from anon;
alter table public.team_profiles enable row level security;
alter table public.team_join_requests enable row level security;
revoke all on table public.team_profiles from anon, authenticated;
revoke all on table public.team_join_requests from anon;
grant select on table public.team_join_requests to authenticated;

create policy "Hosts read join requests for owned games"
on public.team_join_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = team_join_requests.game_id
      and quizzes.owner_id = auth.uid()
  )
);
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
  stability text check (stability is null or stability in ('stable', 'review_periodically', 'volatile')),
  audience_suitability text check (audience_suitability is null or audience_suitability in ('family', 'general', 'adult')),
  audience_fit text check (audience_fit is null or audience_fit in ('broad', 'kids', 'young_adults', 'older_adults')),
  adult_content boolean,
  audience_scope text check (audience_scope is null or audience_scope in ('global', 'country_specific')),
  audience_locale text,
  content_flags text[],
  as_of_date date,
  review_due_at timestamptz,
  valid_from timestamptz,
  expires_at timestamptz,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_question_id, position),
  unique (source_question_id, label),
  check (
    (audience_scope is null and audience_locale is null)
    or (audience_scope = 'global' and audience_locale is null)
    or (audience_scope = 'country_specific' and length(btrim(audience_locale)) > 0)
  )
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
  stability text check (stability is null or stability in ('stable', 'review_periodically', 'volatile')),
  audience_suitability text check (audience_suitability is null or audience_suitability in ('family', 'general', 'adult')),
  audience_fit text check (audience_fit is null or audience_fit in ('broad', 'kids', 'young_adults', 'older_adults')),
  adult_content boolean,
  tag_mode text not null default 'inherit' check (tag_mode in ('inherit', 'replace')),
  audience_scope text check (audience_scope is null or audience_scope in ('global', 'country_specific')),
  audience_locale text,
  content_flags text[],
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
  updated_at timestamptz not null default now(),
  check (
    (audience_scope is null and audience_locale is null)
    or (audience_scope = 'global' and audience_locale is null)
    or (audience_scope = 'country_specific' and length(btrim(audience_locale)) > 0)
  )
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

create table if not exists public.proposed_question_tags (
  id uuid primary key default gen_random_uuid(),
  normalized_phrase text not null unique check (length(btrim(normalized_phrase)) > 0),
  display_phrase text not null check (length(btrim(display_phrase)) > 0),
  status text not null default 'pending' check (status in ('pending', 'mapped', 'created', 'ignored')),
  resolved_tag_id uuid references public.tags(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (
    (status = 'pending' and resolved_tag_id is null and resolved_at is null)
    or (status in ('mapped', 'created') and resolved_tag_id is not null and resolved_at is not null)
    or (status = 'ignored' and resolved_tag_id is null and resolved_at is not null)
  )
);

create table if not exists public.proposed_question_tag_assignments (
  id uuid primary key default gen_random_uuid(),
  proposed_tag_id uuid not null references public.proposed_question_tags(id) on delete cascade,
  import_batch_id uuid references public.question_library_import_batches(id) on delete set null,
  source_question_id uuid not null references public.source_questions(id) on delete cascade,
  source_question_part_id uuid references public.source_question_parts(id) on delete cascade,
  source_question_bonus_id uuid references public.source_question_bonuses(id) on delete cascade,
  raw_phrase text not null check (length(btrim(raw_phrase)) > 0),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (num_nonnulls(source_question_part_id, source_question_bonus_id) <= 1)
);

create unique index if not exists proposed_question_tag_parent_assignment_idx
  on public.proposed_question_tag_assignments (proposed_tag_id, source_question_id)
  where source_question_part_id is null and source_question_bonus_id is null;
create unique index if not exists proposed_question_tag_part_assignment_idx
  on public.proposed_question_tag_assignments (proposed_tag_id, source_question_part_id)
  where source_question_part_id is not null;
create unique index if not exists proposed_question_tag_bonus_assignment_idx
  on public.proposed_question_tag_assignments (proposed_tag_id, source_question_bonus_id)
  where source_question_bonus_id is not null;
create index if not exists proposed_question_tag_assignments_batch_idx
  on public.proposed_question_tag_assignments (import_batch_id);

alter table public.proposed_question_tags enable row level security;
alter table public.proposed_question_tag_assignments enable row level security;
revoke all on public.proposed_question_tags, public.proposed_question_tag_assignments from anon, authenticated;
grant all on public.proposed_question_tags, public.proposed_question_tag_assignments to service_role;

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
  coalesce(tag_metadata.tag_names, '{}'::text[]) as tag_names,
  bonus_metadata.bonus,
  concat_ws(
    ' ',
    source_questions.prompt,
    source_questions.correct_answer::text,
    source_questions.accepted_answers::text,
    source_questions.options::text,
    bonus_metadata.bonus::text
  ) as search_text
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
) as tag_metadata on true
left join lateral (
  select jsonb_build_object(
    'id', source_question_bonuses.id,
    'prompt', source_question_bonuses.prompt,
    'correct_answer', source_question_bonuses.correct_answer,
    'accepted_answers', source_question_bonuses.accepted_answers,
    'points', source_question_bonuses.points,
    'image_url', source_question_bonuses.image_url,
    'prompt_pattern_id', source_question_bonuses.prompt_pattern_id,
    'answer_type_id', source_question_bonuses.answer_type_id,
    'editorial_difficulty', source_question_bonuses.editorial_difficulty,
    'stability', source_question_bonuses.stability,
    'audience_suitability', source_question_bonuses.audience_suitability,
    'audience_fit', source_question_bonuses.audience_fit,
    'adult_content', source_question_bonuses.adult_content,
    'audience_scope', source_question_bonuses.audience_scope,
    'audience_locale', source_question_bonuses.audience_locale,
    'content_flags', source_question_bonuses.content_flags,
    'tag_mode', source_question_bonuses.tag_mode,
    'primary_category_id', bonus_categories.primary_category_id,
    'secondary_category_ids', coalesce(bonus_categories.secondary_category_ids, '{}'::uuid[]),
    'category_ids', coalesce(bonus_categories.category_ids, '{}'::uuid[]),
    'tag_ids', coalesce(bonus_tags.tag_ids, '{}'::uuid[])
  ) as bonus
  from public.source_question_bonuses
  left join lateral (
    select
      array_agg(source_question_bonus_categories.category_id order by source_question_bonus_categories.role, categories.sort_order)
        as category_ids,
      array_agg(source_question_bonus_categories.category_id order by categories.sort_order)
        filter (where source_question_bonus_categories.role = 'secondary') as secondary_category_ids,
      (array_agg(source_question_bonus_categories.category_id order by categories.sort_order)
        filter (where source_question_bonus_categories.role = 'primary'))[1] as primary_category_id
    from public.source_question_bonus_categories
    join public.categories on categories.id = source_question_bonus_categories.category_id
    where source_question_bonus_categories.source_question_bonus_id = source_question_bonuses.id
  ) as bonus_categories on true
  left join lateral (
    select array_agg(tags.id order by tags.name) as tag_ids
    from public.source_question_bonus_tags
    join public.tags on tags.id = source_question_bonus_tags.tag_id
    where source_question_bonus_tags.source_question_bonus_id = source_question_bonuses.id
  ) as bonus_tags on true
  where source_question_bonuses.source_question_id = source_questions.id
) as bonus_metadata on true;

create or replace view public.question_library_proposed_tag_review
with (security_invoker = true)
as
select
  proposed_question_tags.id,
  proposed_question_tags.display_phrase,
  proposed_question_tags.normalized_phrase,
  proposed_question_tags.status,
  proposed_question_tags.resolved_tag_id,
  count(proposed_question_tag_assignments.id)::integer as assignment_count,
  count(distinct proposed_question_tag_assignments.source_question_id)::integer as question_count,
  proposed_question_tags.first_seen_at,
  proposed_question_tags.last_seen_at,
  proposed_question_tags.resolved_at
from public.proposed_question_tags
left join public.proposed_question_tag_assignments
  on proposed_question_tag_assignments.proposed_tag_id = proposed_question_tags.id
group by proposed_question_tags.id;

revoke all on public.question_library_proposed_tag_review from anon, authenticated;
grant select on public.question_library_proposed_tag_review to service_role;

alter table public.game_reactions enable row level security;

drop policy if exists "Live game reactions are readable" on public.game_reactions;
create policy "Live game reactions are readable"
  on public.game_reactions for select
  using (exists (
    select 1 from public.games
    where games.id = game_reactions.game_id
      and games.status in ('lobby', 'live')
  ));

grant select on public.game_reactions to anon, authenticated;

create or replace function public.touch_team_presence(p_request_id uuid, p_request_token uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  touched_at timestamptz;
begin
  update public.teams
  set last_seen_at = clock_timestamp()
  where teams.id = (
    select team_join_requests.team_id
    from public.team_join_requests
    where team_join_requests.id = p_request_id
      and team_join_requests.request_token = p_request_token
      and team_join_requests.status = 'approved'
      and team_join_requests.team_id is not null
  )
  returning teams.last_seen_at into touched_at;
  if touched_at is null then raise exception 'TEAM_SESSION_INVALID'; end if;
  return touched_at;
end;
$$;

create or replace function public.send_game_reaction(p_request_id uuid, p_request_token uuid, p_reaction text)
returns public.game_reactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  team_row public.teams%rowtype;
  created public.game_reactions%rowtype;
begin
  if p_reaction not in ('👍', '❤️', '🥰', '😂', '😮', '😢', '😡') then raise exception 'REACTION_INVALID'; end if;
  select teams.* into team_row
  from public.team_join_requests
  join public.teams on teams.id = team_join_requests.team_id
  join public.games on games.id = teams.game_id
  where team_join_requests.id = p_request_id
    and team_join_requests.request_token = p_request_token
    and team_join_requests.status = 'approved'
    and games.status in ('lobby', 'live');
  if team_row.id is null then raise exception 'TEAM_SESSION_INVALID'; end if;
  if exists (
    select 1 from public.game_reactions
    where game_reactions.team_id = team_row.id
      and game_reactions.created_at > clock_timestamp() - interval '400 milliseconds'
  ) then raise exception 'REACTION_TOO_FAST'; end if;
  update public.teams set last_seen_at = clock_timestamp() where id = team_row.id;
  delete from public.game_reactions where created_at < clock_timestamp() - interval '10 minutes';
  insert into public.game_reactions (game_id, team_id, team_name, reaction)
  values (team_row.game_id, team_row.id, team_row.name, p_reaction)
  returning * into created;
  return created;
end;
$$;

revoke all on function public.touch_team_presence(uuid, uuid), public.send_game_reaction(uuid, uuid, text) from public;
grant execute on function public.touch_team_presence(uuid, uuid), public.send_game_reaction(uuid, uuid, text) to anon, authenticated;

create or replace function public.get_host_game_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::bigint
  from public.games
  join public.quizzes on quizzes.id = games.quiz_id
  where quizzes.owner_id = (select auth.uid());
$$;

revoke all on function public.get_host_game_count() from public, anon;
grant execute on function public.get_host_game_count() to authenticated;

create or replace function public.get_audience_question_responses(
  p_game_show_game_id uuid, p_request_id uuid, p_request_token uuid
)
returns table (team_id uuid, team_name text, response_text text, numeric_response numeric, submitted_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
declare request_row public.team_join_requests%rowtype; show_game public.game_show_games%rowtype;
begin
  select * into request_row from public.team_join_requests
  where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;
  select * into show_game from public.game_show_games
  where id = p_game_show_game_id and game_id = request_row.game_id and game_type = 'audience-question';
  if show_game.id is null then raise exception 'SHOW_GAME_INVALID'; end if;
  if show_game.status <> 'exploded' and not exists (
    select 1 from public.game_show_game_responses own_response
    where own_response.game_show_game_id = show_game.id and own_response.team_id = request_row.team_id
  ) then raise exception 'SUBMIT_BEFORE_VIEWING'; end if;
  return query
  select responses.team_id, teams.name, responses.response_text, responses.numeric_response, responses.submitted_at
  from public.game_show_game_responses responses join public.teams on teams.id = responses.team_id
  where responses.game_show_game_id = show_game.id order by responses.submitted_at;
end;
$$;

revoke all on function public.get_audience_question_responses(uuid, uuid, uuid) from public;
grant execute on function public.get_audience_question_responses(uuid, uuid, uuid) to anon, authenticated;
