-- Give the host live closest-answer feedback without exposing distance or
-- outcome to player clients before reveal.
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
  correct_number numeric;
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

  select tiebreakers.correct_value into correct_number
  from public.game_tiebreakers tiebreakers
  where tiebreakers.id = selected_attempt.game_tiebreaker_id;

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

  insert into public.game_tiebreaker_submissions (
    game_id,
    attempt_id,
    team_id,
    numeric_answer,
    distance
  )
  values (
    p_game_id,
    selected_attempt.id,
    p_team_id,
    p_numeric_answer,
    abs(p_numeric_answer - correct_number)
  )
  returning id into submission_id;

  return submission_id;
end;
$$;

revoke all on function public.submit_player_tiebreaker(uuid, uuid, numeric) from public;
grant execute on function public.submit_player_tiebreaker(uuid, uuid, numeric) to anon, authenticated;

drop function public.get_player_tiebreaker_state(uuid, uuid);

create function public.get_player_tiebreaker_state(p_game_id uuid, p_team_id uuid)
returns table (
  attempt_id uuid,
  prompt text,
  answer_unit text,
  attempt_status text,
  is_participant boolean,
  numeric_answer numeric,
  distance numeric,
  correct_value numeric,
  is_winner boolean,
  submitted_count integer,
  participant_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    attempts.id,
    case when p_team_id = any(attempts.team_ids) then tiebreakers.prompt else null end,
    case when p_team_id = any(attempts.team_ids) then tiebreakers.answer_unit else null end,
    attempts.status,
    p_team_id = any(attempts.team_ids),
    submissions.numeric_answer,
    case when attempts.status in ('resolved', 'tied') then submissions.distance else null end,
    case when attempts.status in ('resolved', 'tied') then tiebreakers.correct_value else null end,
    case
      when attempts.status = 'resolved' then resolutions.ordered_team_ids[1] = p_team_id
      else null
    end,
    (select count(*)::integer from public.game_tiebreaker_submissions all_submissions where all_submissions.attempt_id = attempts.id),
    cardinality(attempts.team_ids)
  from public.games
  join public.game_tiebreaker_attempts attempts on attempts.id = games.current_tiebreaker_attempt_id
  join public.game_tiebreakers tiebreakers on tiebreakers.id = attempts.game_tiebreaker_id
  join public.game_tie_resolutions resolutions on resolutions.id = attempts.resolution_id
  join public.teams team on team.id = p_team_id and team.game_id = games.id
  left join public.game_tiebreaker_submissions submissions
    on submissions.attempt_id = attempts.id and submissions.team_id = p_team_id
  where games.id = p_game_id;
$$;

revoke all on function public.get_player_tiebreaker_state(uuid, uuid) from public;
grant execute on function public.get_player_tiebreaker_state(uuid, uuid) to anon, authenticated;

comment on function public.get_player_tiebreaker_state(uuid, uuid)
is 'Returns participant state while masking distance, correct value, and outcome until reveal.';

comment on table public.game_tiebreaker_submissions
is 'Numeric tied-team responses with host-visible absolute distances calculated at submission time.';
