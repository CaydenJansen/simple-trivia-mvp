alter table public.games
  add column if not exists round_scores_finalized boolean not null default false;

comment on column public.games.round_scores_finalized is
  'True only after the host explicitly finalizes the current round checkpoint.';

create or replace function public.finalize_auto_run_question_scoring(
  p_game_id uuid,
  p_question_key text,
  p_results jsonb default '[]'::jsonb,
  p_bonus_results jsonb default '[]'::jsonb,
  p_reveal boolean default true
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result_item jsonb;
  result_submission_id uuid;
  submission_team_id uuid;
  submission_points_max integer;
  awarded_points integer;
  total_awarded integer := 0;
  affected integer;
begin
  if jsonb_typeof(p_results) <> 'array' or jsonb_typeof(p_bonus_results) <> 'array' then
    raise exception 'Scoring results must be JSON arrays';
  end if;

  for result_item in select value from jsonb_array_elements(p_results)
  loop
    result_submission_id := nullif(result_item->>'submission_id', '')::uuid;
    awarded_points := (result_item->>'points_awarded')::integer;
    if result_submission_id is null or awarded_points is null or awarded_points < 0
      or jsonb_typeof(result_item->'is_correct') <> 'boolean'
      or jsonb_typeof(result_item->'grading_json') <> 'object' then
      raise exception 'Invalid main scoring result';
    end if;

    select submissions.team_id, greatest(1, game_questions.points_max)
      into submission_team_id, submission_points_max
    from public.submissions
    join public.game_questions on game_questions.game_id = submissions.game_id
      and game_questions.question_key = submissions.question_key
    where submissions.id = result_submission_id
      and submissions.game_id = p_game_id
      and submissions.question_key = p_question_key
      and submissions.is_correct is null
    for update;

    if submission_team_id is null then raise exception 'Main submission is missing, already scored, or duplicated'; end if;
    if awarded_points > submission_points_max then raise exception 'Main points exceed the frozen question maximum'; end if;

    update public.submissions
    set is_correct = (result_item->>'is_correct')::boolean,
        points_awarded = awarded_points,
        grading_json = result_item->'grading_json',
        updated_at = now()
    where id = result_submission_id and is_correct is null;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'Main submission could not be scored'; end if;

    if awarded_points > 0 then
      update public.teams set score = score + awarded_points
      where id = submission_team_id and game_id = p_game_id;
    end if;
    total_awarded := total_awarded + awarded_points;
  end loop;

  for result_item in select value from jsonb_array_elements(p_bonus_results)
  loop
    result_submission_id := nullif(result_item->>'submission_id', '')::uuid;
    awarded_points := (result_item->>'points_awarded')::integer;
    if result_submission_id is null or awarded_points is null or awarded_points < 0
      or jsonb_typeof(result_item->'is_correct') <> 'boolean'
      or jsonb_typeof(result_item->'grading_json') <> 'object' then
      raise exception 'Invalid bonus scoring result';
    end if;

    select bonus_submissions.team_id, greatest(1, coalesce((game_questions.bonus->>'points')::integer, 1))
      into submission_team_id, submission_points_max
    from public.bonus_submissions
    join public.game_questions on game_questions.game_id = bonus_submissions.game_id
      and game_questions.question_key = bonus_submissions.question_key
    where bonus_submissions.id = result_submission_id
      and bonus_submissions.game_id = p_game_id
      and bonus_submissions.question_key = p_question_key
      and bonus_submissions.is_correct is null
    for update;

    if submission_team_id is null then raise exception 'Bonus submission is missing, already scored, or duplicated'; end if;
    if awarded_points > submission_points_max then raise exception 'Bonus points exceed the frozen question maximum'; end if;

    update public.bonus_submissions
    set is_correct = (result_item->>'is_correct')::boolean,
        points_awarded = awarded_points,
        grading_json = result_item->'grading_json',
        updated_at = now()
    where id = result_submission_id and is_correct is null;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'Bonus submission could not be scored'; end if;

    if awarded_points > 0 then
      update public.teams set score = score + awarded_points
      where id = submission_team_id and game_id = p_game_id;
    end if;
    total_awarded := total_awarded + awarded_points;
  end loop;

  update public.games
  set answer_phase = case when p_reveal then 'revealed' else answer_phase end,
      round_scores_finalized = false
  where id = p_game_id;

  return total_awarded;
end;
$$;

create or replace function public.finalize_auto_run_round(
  p_game_id uuid,
  p_round_number integer,
  p_mark_pending_incorrect boolean default false
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pending_count integer;
begin
  if p_mark_pending_incorrect then
    update public.submissions
    set is_correct = false, points_awarded = 0, updated_at = now()
    where game_id = p_game_id and is_correct is null
      and question_key in (
        select question_key from public.game_questions
        where game_id = p_game_id and round_number = p_round_number
      );

    update public.bonus_submissions
    set is_correct = false, points_awarded = 0, updated_at = now()
    where game_id = p_game_id and is_correct is null
      and question_key in (
        select question_key from public.game_questions
        where game_id = p_game_id and round_number = p_round_number
      );
  end if;

  select count(*) into pending_count from (
    select submissions.id from public.submissions
    join public.game_questions on game_questions.game_id = submissions.game_id
      and game_questions.question_key = submissions.question_key
    where submissions.game_id = p_game_id and game_questions.round_number = p_round_number
      and submissions.is_correct is null
    union all
    select bonus_submissions.id from public.bonus_submissions
    join public.game_questions on game_questions.game_id = bonus_submissions.game_id
      and game_questions.question_key = bonus_submissions.question_key
    where bonus_submissions.game_id = p_game_id and game_questions.round_number = p_round_number
      and bonus_submissions.is_correct is null
  ) pending;

  if pending_count > 0 then
    raise exception '% answers are still awaiting review', pending_count;
  end if;

  update public.games set round_scores_finalized = true where id = p_game_id;
  return pending_count;
end;
$$;

revoke all on function public.finalize_auto_run_question_scoring(uuid, text, jsonb, jsonb, boolean) from public;
revoke all on function public.finalize_auto_run_round(uuid, integer, boolean) from public;
grant execute on function public.finalize_auto_run_question_scoring(uuid, text, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.finalize_auto_run_round(uuid, integer, boolean) to authenticated;
