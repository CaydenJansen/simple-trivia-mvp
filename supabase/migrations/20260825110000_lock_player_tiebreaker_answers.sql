-- Tiebreaker answers follow the same one-submission lock as ordinary questions.
-- The unique constraint remains the final concurrency guard; the explicit check
-- provides a useful error when a client retries after a successful submission.
create or replace function public.submit_player_tiebreaker(
  p_game_id uuid,
  p_team_id uuid,
  p_numeric_answer numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_attempt public.game_tiebreaker_attempts%rowtype;
  submission_id uuid;
begin
  select attempts.* into selected_attempt
  from public.games
  join public.game_tiebreaker_attempts attempts on attempts.id = games.current_tiebreaker_attempt_id
  where games.id = p_game_id and games.current_screen = 'tiebreaker'
    and games.answer_phase = 'open' and attempts.status = 'open'
  for update of attempts;

  if selected_attempt.id is null then
    raise exception 'Tiebreaker answers are not open';
  end if;

  if not (p_team_id = any(selected_attempt.team_ids))
    or not exists (select 1 from public.teams where id = p_team_id and game_id = p_game_id) then
    raise exception 'Team is not participating in this tiebreaker';
  end if;

  if exists (
    select 1
    from public.game_tiebreaker_submissions submissions
    where submissions.attempt_id = selected_attempt.id
      and submissions.team_id = p_team_id
  ) then
    raise exception 'Tiebreaker answer is already locked';
  end if;

  insert into public.game_tiebreaker_submissions (game_id, attempt_id, team_id, numeric_answer)
  values (p_game_id, selected_attempt.id, p_team_id, p_numeric_answer)
  returning id into submission_id;

  return submission_id;
end;
$$;

revoke all on function public.submit_player_tiebreaker(uuid, uuid, numeric) from public;
grant execute on function public.submit_player_tiebreaker(uuid, uuid, numeric) to anon, authenticated;

comment on function public.submit_player_tiebreaker(uuid, uuid, numeric)
is 'Stores one immutable numeric answer per tied team while the tiebreaker is open.';
