create or replace function public.finalize_question_scoring(
  p_game_id uuid,
  p_question_key text,
  p_results jsonb,
  p_reveal boolean default true
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_phase text;
  current_question_key text;
  question_points_max integer;
  unresolved_count integer;
  result_item jsonb;
  result_submission_id uuid;
  submission_team_id uuid;
  submission_is_correct boolean;
  awarded_points integer;
  total_awarded integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'Scoring results must be a JSON array';
  end if;

  select games.answer_phase, games.current_question_key
    into current_phase, current_question_key
  from public.games
  join public.quizzes on quizzes.id = games.quiz_id
  where games.id = p_game_id
    and quizzes.owner_id = auth.uid()
  for update of games;

  if current_phase is null then
    raise exception 'Game not found or not owned by current host';
  end if;

  if current_question_key is distinct from p_question_key then
    raise exception 'Question is not current for this game';
  end if;

  if current_phase = 'revealed' then
    if p_reveal then return 0; end if;
    raise exception 'A revealed question cannot be hidden again';
  end if;

  if current_phase <> 'closed' then
    raise exception 'Answers must be closed before scoring';
  end if;

  select game_questions.points_max
    into question_points_max
  from public.game_questions
  where game_questions.game_id = p_game_id
    and game_questions.question_key = p_question_key;

  if question_points_max is null then
    raise exception 'Question snapshot not found';
  end if;

  select count(*)
    into unresolved_count
  from public.submissions
  where submissions.game_id = p_game_id
    and submissions.question_key = p_question_key
    and submissions.is_correct is null;

  if jsonb_array_length(p_results) <> unresolved_count then
    raise exception 'Scoring results must include every unresolved submission exactly once';
  end if;

  for result_item in select value from jsonb_array_elements(p_results)
  loop
    result_submission_id := nullif(result_item->>'submission_id', '')::uuid;
    awarded_points := (result_item->>'points_awarded')::integer;

    if result_submission_id is null
      or awarded_points is null
      or awarded_points < 0
      or awarded_points > question_points_max
      or jsonb_typeof(result_item->'is_correct') <> 'boolean'
      or jsonb_typeof(result_item->'grading_json') <> 'object' then
      raise exception 'Invalid scoring result';
    end if;

    select submissions.team_id, submissions.is_correct
      into submission_team_id, submission_is_correct
    from public.submissions
    where submissions.id = result_submission_id
      and submissions.game_id = p_game_id
      and submissions.question_key = p_question_key
    for update;

    if submission_team_id is null or submission_is_correct is not null then
      raise exception 'Submission is missing, already scored, or duplicated';
    end if;

    update public.submissions
    set is_correct = (result_item->>'is_correct')::boolean,
        points_awarded = awarded_points,
        grading_json = result_item->'grading_json',
        updated_at = now()
    where submissions.id = result_submission_id;

    if awarded_points > 0 then
      update public.teams
      set score = score + awarded_points
      where teams.id = submission_team_id
        and teams.game_id = p_game_id;
    end if;

    total_awarded := total_awarded + awarded_points;
  end loop;

  update public.games
  set answer_phase = case when p_reveal then 'revealed' else 'closed' end
  where games.id = p_game_id;

  return total_awarded;
end;
$$;

revoke all on function public.finalize_question_scoring(uuid, text, jsonb, boolean) from public;
grant execute on function public.finalize_question_scoring(uuid, text, jsonb, boolean) to authenticated;

comment on function public.finalize_question_scoring(uuid, text, jsonb, boolean) is
  'Atomically scores one closed question exactly once, optionally revealing the result immediately.';

create or replace function public.reveal_and_score_question(
  p_game_id uuid,
  p_question_key text,
  p_results jsonb
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select public.finalize_question_scoring(p_game_id, p_question_key, p_results, true);
$$;

revoke all on function public.reveal_and_score_question(uuid, text, jsonb) from public;
grant execute on function public.reveal_and_score_question(uuid, text, jsonb) to authenticated;
