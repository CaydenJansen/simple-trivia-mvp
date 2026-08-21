alter table public.games
  add column if not exists question_stage text not null default 'core';

alter table public.games
  drop constraint if exists games_question_stage_check;

alter table public.games
  add constraint games_question_stage_check
  check (question_stage in ('core', 'bonus'));

create table if not exists public.bonus_submissions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  question_key text not null,
  answer_text text not null check (length(btrim(answer_text)) > 0),
  is_correct boolean,
  points_awarded integer not null default 0 check (points_awarded >= 0),
  grading_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, team_id, question_key)
);

create index if not exists bonus_submissions_game_question_idx
  on public.bonus_submissions (game_id, question_key);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bonus_submissions'
  ) then
    alter publication supabase_realtime add table public.bonus_submissions;
  end if;
end $$;

alter table public.bonus_submissions enable row level security;

drop policy if exists "Hosts can read owned bonus submissions" on public.bonus_submissions;
create policy "Hosts can read owned bonus submissions"
on public.bonus_submissions for select to authenticated
using (
  exists (
    select 1
    from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = bonus_submissions.game_id
      and quizzes.owner_id = auth.uid()
  )
);

drop policy if exists "Hosts can update owned bonus submissions" on public.bonus_submissions;
create policy "Hosts can update owned bonus submissions"
on public.bonus_submissions for update to authenticated
using (
  exists (
    select 1
    from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = bonus_submissions.game_id
      and quizzes.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = bonus_submissions.game_id
      and quizzes.owner_id = auth.uid()
  )
);

grant select, update on public.bonus_submissions to authenticated;

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
    and games.question_stage = 'core'
    and games.current_screen in (
      'single-answer', 'image-question', 'multiple-choice',
      'multi-answer', 'multi-part', 'ranking'
    )
  for update;

  if active_question_key is null then
    raise exception 'Main-question answers are not open';
  end if;

  if not exists (
    select 1 from public.teams
    where teams.id = p_team_id and teams.game_id = p_game_id
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

create or replace function public.submit_player_bonus_answer(
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
  if length(btrim(p_answer_text)) = 0 then
    raise exception 'Bonus answer is required';
  end if;

  select games.current_question_key
    into active_question_key
  from public.games
  join public.game_questions
    on game_questions.game_id = games.id
   and game_questions.question_key = games.current_question_key
  where games.id = p_game_id
    and games.status = 'live'
    and games.answer_phase = 'open'
    and games.question_stage = 'bonus'
    and game_questions.bonus is not null
  for update of games;

  if active_question_key is null then
    raise exception 'Bonus answers are not open';
  end if;

  if not exists (
    select 1 from public.teams
    where teams.id = p_team_id and teams.game_id = p_game_id
  ) then
    raise exception 'Team is not part of this game';
  end if;

  insert into public.bonus_submissions (
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
  returning bonus_submissions.id into submission_id;

  return submission_id;
end;
$$;

create or replace function public.get_player_bonus_submission(
  p_game_id uuid,
  p_team_id uuid,
  p_question_key text
)
returns table (
  id uuid,
  answer_text text,
  is_correct boolean,
  points_awarded integer,
  grading_json jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    bonus_submissions.id,
    bonus_submissions.answer_text,
    bonus_submissions.is_correct,
    bonus_submissions.points_awarded,
    bonus_submissions.grading_json
  from public.bonus_submissions
  where bonus_submissions.game_id = p_game_id
    and bonus_submissions.team_id = p_team_id
    and bonus_submissions.question_key = p_question_key
    and exists (
      select 1 from public.teams
      where teams.id = p_team_id and teams.game_id = p_game_id
    );
$$;

drop function if exists public.get_player_game_question(uuid, text);
create function public.get_player_game_question(
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
  notes text,
  has_bonus boolean,
  bonus jsonb
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
    case when games.answer_phase = 'revealed' then game_questions.correct_answer else null end,
    game_questions.options,
    game_questions.image_url,
    game_questions.points_max,
    case when games.answer_phase = 'revealed' then game_questions.notes else null end,
    game_questions.bonus is not null,
    case
      when games.answer_phase = 'revealed' then game_questions.bonus
      when games.question_stage = 'bonus' then game_questions.bonus - 'correct_answer' - 'accepted_answers'
      else null
    end
  from public.games
  join public.game_questions on game_questions.game_id = games.id
  where games.id = p_game_id
    and games.current_question_key = p_question_key
    and game_questions.question_key = p_question_key;
$$;

create or replace function public.finalize_question_and_bonus_scoring(
  p_game_id uuid,
  p_question_key text,
  p_results jsonb,
  p_bonus_results jsonb default '[]'::jsonb,
  p_reveal boolean default true
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  bonus_snapshot jsonb;
  bonus_points_max integer;
  unresolved_count integer;
  result_item jsonb;
  result_submission_id uuid;
  submission_team_id uuid;
  submission_is_correct boolean;
  awarded_points integer;
  total_awarded integer;
begin
  if jsonb_typeof(p_bonus_results) <> 'array' then
    raise exception 'Bonus scoring results must be a JSON array';
  end if;

  total_awarded := public.finalize_question_scoring(p_game_id, p_question_key, p_results, false);

  select game_questions.bonus
    into bonus_snapshot
  from public.game_questions
  where game_questions.game_id = p_game_id
    and game_questions.question_key = p_question_key;

  if bonus_snapshot is null then
    if jsonb_array_length(p_bonus_results) <> 0 then
      raise exception 'Question does not have a bonus';
    end if;
  else
    bonus_points_max := greatest(1, coalesce((bonus_snapshot->>'points')::integer, 1));

    select count(*) into unresolved_count
    from public.bonus_submissions
    where bonus_submissions.game_id = p_game_id
      and bonus_submissions.question_key = p_question_key
      and bonus_submissions.is_correct is null;

    if jsonb_array_length(p_bonus_results) <> unresolved_count then
      raise exception 'Bonus results must include every unresolved submission exactly once';
    end if;

    for result_item in select value from jsonb_array_elements(p_bonus_results)
    loop
      result_submission_id := nullif(result_item->>'submission_id', '')::uuid;
      awarded_points := (result_item->>'points_awarded')::integer;

      if result_submission_id is null
        or awarded_points is null
        or awarded_points < 0
        or awarded_points > bonus_points_max
        or jsonb_typeof(result_item->'is_correct') <> 'boolean'
        or jsonb_typeof(result_item->'grading_json') <> 'object' then
        raise exception 'Invalid bonus scoring result';
      end if;

      select bonus_submissions.team_id, bonus_submissions.is_correct
        into submission_team_id, submission_is_correct
      from public.bonus_submissions
      where bonus_submissions.id = result_submission_id
        and bonus_submissions.game_id = p_game_id
        and bonus_submissions.question_key = p_question_key
      for update;

      if submission_team_id is null or submission_is_correct is not null then
        raise exception 'Bonus submission is missing, already scored, or duplicated';
      end if;

      update public.bonus_submissions
      set is_correct = (result_item->>'is_correct')::boolean,
          points_awarded = awarded_points,
          grading_json = result_item->'grading_json',
          updated_at = now()
      where bonus_submissions.id = result_submission_id;

      if awarded_points > 0 then
        update public.teams
        set score = score + awarded_points
        where teams.id = submission_team_id
          and teams.game_id = p_game_id;
      end if;

      total_awarded := total_awarded + awarded_points;
    end loop;
  end if;

  if p_reveal then
    update public.games
    set answer_phase = 'revealed'
    where games.id = p_game_id;
  end if;

  return total_awarded;
end;
$$;

revoke all on function public.submit_player_bonus_answer(uuid, uuid, text) from public;
revoke all on function public.get_player_bonus_submission(uuid, uuid, text) from public;
revoke all on function public.get_player_game_question(uuid, text) from public;
revoke all on function public.finalize_question_and_bonus_scoring(uuid, text, jsonb, jsonb, boolean) from public;

grant execute on function public.submit_player_bonus_answer(uuid, uuid, text) to anon, authenticated;
grant execute on function public.get_player_bonus_submission(uuid, uuid, text) to anon, authenticated;
grant execute on function public.get_player_game_question(uuid, text) to anon, authenticated;
grant execute on function public.finalize_question_and_bonus_scoring(uuid, text, jsonb, jsonb, boolean) to authenticated;

comment on table public.bonus_submissions is
  'Team answers to the optional bonus attached to a frozen game-question snapshot. Kept separate from ordinary submissions.';

comment on column public.games.question_stage is
  'The visible answer stage for the current ordinary question: core first, then its optional bonus.';
