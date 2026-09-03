begin;

create or replace function public.submit_player_answer(
  p_game_id uuid,
  p_team_id uuid,
  p_question_key text,
  p_answer_text text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  editing_allowed boolean;
  submission_id uuid;
begin
  if length(btrim(p_answer_text)) = 0 then
    raise exception 'ANSWER_REQUIRED';
  end if;

  select games.answer_editing_allowed
    into editing_allowed
  from public.games
  where games.id = p_game_id
    and games.status = 'live'
    and games.answer_phase = 'open'
    and games.question_stage = 'core'
    and games.current_question_key = p_question_key
    and games.current_screen in (
      'single-answer', 'image-question', 'multiple-choice',
      'multi-answer', 'multi-part', 'ranking'
    )
  for update;

  if not found then
    raise exception 'QUESTION_CHANGED';
  end if;

  if not exists (
    select 1 from public.teams
    where teams.id = p_team_id and teams.game_id = p_game_id
  ) then
    raise exception 'TEAM_NOT_IN_GAME';
  end if;

  if not editing_allowed and exists (
    select 1 from public.submissions
    where submissions.game_id = p_game_id
      and submissions.team_id = p_team_id
      and submissions.question_key = p_question_key
  ) then
    raise exception 'Answer is already locked';
  end if;

  insert into public.submissions (
    game_id, team_id, question_key, answer_text,
    is_correct, points_awarded, grading_json
  )
  values (
    p_game_id, p_team_id, p_question_key, btrim(p_answer_text),
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
  p_question_key text,
  p_answer_text text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  editing_allowed boolean;
  submission_id uuid;
begin
  if length(btrim(p_answer_text)) = 0 then
    raise exception 'ANSWER_REQUIRED';
  end if;

  select games.answer_editing_allowed
    into editing_allowed
  from public.games
  join public.game_questions
    on game_questions.game_id = games.id
   and game_questions.question_key = p_question_key
  where games.id = p_game_id
    and games.status = 'live'
    and games.answer_phase = 'open'
    and games.question_stage = 'bonus'
    and games.current_question_key = p_question_key
    and game_questions.bonus is not null
  for update of games;

  if not found then
    raise exception 'QUESTION_CHANGED';
  end if;

  if not exists (
    select 1 from public.teams
    where teams.id = p_team_id and teams.game_id = p_game_id
  ) then
    raise exception 'TEAM_NOT_IN_GAME';
  end if;

  if not editing_allowed and exists (
    select 1 from public.bonus_submissions
    where bonus_submissions.game_id = p_game_id
      and bonus_submissions.team_id = p_team_id
      and bonus_submissions.question_key = p_question_key
  ) then
    raise exception 'Bonus answer is already locked';
  end if;

  insert into public.bonus_submissions (
    game_id, team_id, question_key, answer_text,
    is_correct, points_awarded, grading_json
  )
  values (
    p_game_id, p_team_id, p_question_key, btrim(p_answer_text),
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

create or replace function public.submit_player_tiebreaker(
  p_game_id uuid,
  p_team_id uuid,
  p_attempt_id uuid,
  p_numeric_answer numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_attempt public.game_tiebreaker_attempts%rowtype;
  correct_number numeric;
  submission_id uuid;
begin
  select attempts.* into selected_attempt
  from public.games
  join public.game_tiebreaker_attempts attempts
    on attempts.id = public.games.current_tiebreaker_attempt_id
  where public.games.id = p_game_id
    and public.games.status = 'live'
    and public.games.current_screen = 'tiebreaker'
    and public.games.answer_phase = 'open'
    and attempts.id = p_attempt_id
    and attempts.status = 'open'
  for update of attempts;

  if selected_attempt.id is null then
    raise exception 'TIEBREAKER_CHANGED';
  end if;

  select tiebreakers.correct_value into correct_number
  from public.game_tiebreakers tiebreakers
  where tiebreakers.id = selected_attempt.game_tiebreaker_id;

  if not (p_team_id = any(selected_attempt.team_ids))
    or not exists (
      select 1 from public.teams
      where teams.id = p_team_id and teams.game_id = p_game_id
    ) then
    raise exception 'TEAM_NOT_PARTICIPATING';
  end if;

  if exists (
    select 1 from public.game_tiebreaker_submissions submissions
    where submissions.attempt_id = selected_attempt.id
      and submissions.team_id = p_team_id
  ) then
    raise exception 'Tiebreaker answer is already locked';
  end if;

  insert into public.game_tiebreaker_submissions (
    game_id, attempt_id, team_id, numeric_answer, distance
  ) values (
    p_game_id, selected_attempt.id, p_team_id, p_numeric_answer,
    abs(p_numeric_answer - correct_number)
  )
  returning id into submission_id;

  return submission_id;
end;
$$;

create or replace function public.submit_audience_question_response(
  p_game_show_game_id uuid,
  p_request_id uuid,
  p_request_token uuid,
  p_response text
)
returns public.game_show_game_responses
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.team_join_requests%rowtype;
  show_game public.game_show_games%rowtype;
  result public.game_show_game_responses%rowtype;
  parsed_number numeric;
  correct_value numeric;
begin
  select * into request_row
  from public.team_join_requests
  where id = p_request_id
    and request_token = p_request_token
    and status = 'approved';

  if not found or request_row.team_id is null then
    raise exception 'JOIN_REQUEST_INVALID';
  end if;

  select game_show_games.* into show_game
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_id = request_row.game_id
    and game_show_games.game_type in ('audience-question', 'tiebreaker-style-question', 'in-show-tiebreaker')
    and game_show_games.status = 'open'
    and games.status = 'live'
    and games.current_screen = 'show-game'
    and games.current_show_game_key = game_show_games.show_game_key
  for update of game_show_games;

  if not found then
    raise exception 'RESPONSES_CLOSED';
  end if;

  if not (show_game.settings->'eligible_team_ids' ? request_row.team_id::text) then
    raise exception 'TEAM_NOT_ELIGIBLE';
  end if;

  if length(btrim(p_response)) not between 1 and 1000 then
    raise exception 'RESPONSE_INVALID';
  end if;

  if show_game.game_type in ('tiebreaker-style-question', 'in-show-tiebreaker') then
    begin
      parsed_number := replace(btrim(p_response), ',', '')::numeric;
    exception when invalid_text_representation then
      raise exception 'NUMBER_REQUIRED';
    end;
    select correct_number into correct_value
    from public.game_show_game_audience_private
    where game_show_game_id = show_game.id;
    if correct_value is null then
      raise exception 'A correct number is required';
    end if;
  end if;

  insert into public.game_show_game_responses (
    game_show_game_id, game_id, team_id, response_text,
    numeric_response, distance_from_correct
  )
  values (
    show_game.id, show_game.game_id, request_row.team_id, btrim(p_response),
    parsed_number,
    case when parsed_number is null then null else abs(parsed_number - correct_value) end
  )
  on conflict (game_show_game_id, team_id) do nothing
  returning * into result;

  if result.id is null then
    select * into result
    from public.game_show_game_responses
    where game_show_game_id = show_game.id
      and team_id = request_row.team_id;
  end if;

  return result;
end;
$$;

revoke all on function public.submit_player_answer(uuid, uuid, text, text) from public;
revoke all on function public.submit_player_bonus_answer(uuid, uuid, text, text) from public;
revoke all on function public.submit_player_tiebreaker(uuid, uuid, uuid, numeric) from public;
revoke all on function public.submit_audience_question_response(uuid, uuid, uuid, text) from public;
grant execute on function public.submit_player_answer(uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.submit_player_bonus_answer(uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.submit_player_tiebreaker(uuid, uuid, uuid, numeric) to anon, authenticated;
grant execute on function public.submit_audience_question_response(uuid, uuid, uuid, text) to anon, authenticated;

comment on function public.submit_player_answer(uuid, uuid, text, text) is
  'Creates or updates a core response only while the named question is still current.';
comment on function public.submit_player_bonus_answer(uuid, uuid, text, text) is
  'Creates or updates a bonus response only while the named question is still current.';
comment on function public.submit_player_tiebreaker(uuid, uuid, uuid, numeric) is
  'Locks one numerical response only for the named current tiebreaker attempt.';
comment on function public.submit_audience_question_response(uuid, uuid, uuid, text) is
  'Locks one idempotent response for the currently active Audience Question or tiebreaker-style activity.';

commit;
