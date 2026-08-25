-- Restore the two-stage bonus flow: ordinary answers close before the bonus
-- opens, and ordinary submissions cannot be changed during the bonus stage.

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

revoke all on function public.submit_player_answer(uuid, uuid, text) from public;
grant execute on function public.submit_player_answer(uuid, uuid, text) to anon, authenticated;

comment on function public.submit_player_answer(uuid, uuid, text) is
  'Creates or replaces an ordinary response only while the separate core-answer stage is open.';
