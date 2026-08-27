-- A host can choose whether a submitted answer stays editable while the
-- current answer stage remains open. First submissions are always accepted;
-- replacements require answer_editing_allowed to be true.

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
  editing_allowed boolean;
  submission_id uuid;
begin
  select games.current_question_key, games.answer_editing_allowed
    into active_question_key, editing_allowed
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

  if not editing_allowed and exists (
    select 1 from public.submissions
    where submissions.game_id = p_game_id
      and submissions.team_id = p_team_id
      and submissions.question_key = active_question_key
  ) then
    raise exception 'Answer is already locked';
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
  editing_allowed boolean;
  submission_id uuid;
begin
  if length(btrim(p_answer_text)) = 0 then
    raise exception 'Bonus answer is required';
  end if;

  select games.current_question_key, games.answer_editing_allowed
    into active_question_key, editing_allowed
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

  if not editing_allowed and exists (
    select 1 from public.bonus_submissions
    where bonus_submissions.game_id = p_game_id
      and bonus_submissions.team_id = p_team_id
      and bonus_submissions.question_key = active_question_key
  ) then
    raise exception 'Bonus answer is already locked';
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

revoke all on function public.submit_player_answer(uuid, uuid, text) from public;
revoke all on function public.submit_player_bonus_answer(uuid, uuid, text) from public;
grant execute on function public.submit_player_answer(uuid, uuid, text) to anon, authenticated;
grant execute on function public.submit_player_bonus_answer(uuid, uuid, text) to anon, authenticated;

comment on function public.submit_player_answer(uuid, uuid, text) is
  'Creates a response while core answers are open; replacement requires host-enabled answer editing.';
comment on function public.submit_player_bonus_answer(uuid, uuid, text) is
  'Creates a response while bonus answers are open; replacement requires host-enabled answer editing.';
