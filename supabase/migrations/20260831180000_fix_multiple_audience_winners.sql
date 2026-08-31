begin;

-- The most recent Audience Question resolver accidentally stored the sum of
-- every winner's award in reward_points_awarded. That column represents the
-- per-winner award and is capped at 100, so a valid multi-winner selection
-- could fail its check constraint. Keep score updates multi-winner, but store
-- the configured award once.
create or replace function public.resolve_audience_question(
  p_game_show_game_id uuid,
  p_winner_team_ids uuid[] default null
)
returns public.game_show_games
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  winners uuid[];
  response_count integer;
  reward_points integer;
  correct_value numeric;
  minimum_distance numeric;
  allows_many boolean;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type in ('audience-question', 'in-show-tiebreaker')
    and quizzes.owner_id = auth.uid()
  for update of game_show_games;

  if result.id is null then raise exception 'Activity not found or not owned by current host'; end if;
  if result.status <> 'open' then return result; end if;

  select count(*) into response_count
  from public.game_show_game_responses
  where game_show_game_id = result.id;
  if response_count = 0 then raise exception 'Wait for at least one team response'; end if;

  if result.game_type = 'in-show-tiebreaker'
    or result.settings->>'audience_question_mode' = 'closest-number' then
    select correct_number into correct_value
    from public.game_show_game_audience_private
    where game_show_game_id = result.id;
    if correct_value is null then raise exception 'A correct number is required'; end if;

    update public.game_show_game_responses
    set distance_from_correct = abs(numeric_response - correct_value)
    where game_show_game_id = result.id;

    select min(distance_from_correct) into minimum_distance
    from public.game_show_game_responses
    where game_show_game_id = result.id;

    select array_agg(team_id order by submitted_at) into winners
    from public.game_show_game_responses
    where game_show_game_id = result.id
      and distance_from_correct = minimum_distance;
  else
    select array_agg(team_id order by first_position) into winners
    from (
      select selected.team_id, min(selected.position) as first_position
      from unnest(coalesce(p_winner_team_ids, '{}'::uuid[])) with ordinality as selected(team_id, position)
      group by selected.team_id
    ) deduplicated;
    winners := coalesce(winners, '{}'::uuid[]);

    if cardinality(winners) = 0 then raise exception 'Choose at least one favourite response'; end if;
    allows_many := coalesce((result.settings->>'allow_multiple_winners')::boolean, false);
    if cardinality(winners) > 1 and not allows_many then raise exception 'This game allows one winner'; end if;
    if exists (
      select 1
      from unnest(winners) selected_winner(team_id)
      where not exists (
        select 1
        from public.game_show_game_responses response
        where response.game_show_game_id = result.id
          and response.team_id = selected_winner.team_id
      )
    ) then raise exception 'Every winner must have submitted a response'; end if;
  end if;

  update public.game_show_game_responses
  set is_winner = team_id = any(winners)
  where game_show_game_id = result.id;

  reward_points := case
    when result.game_type = 'in-show-tiebreaker' then 0
    else public.beat_the_bomb_reward_points(result.settings)
  end;
  if reward_points > 0 then
    update public.teams set score = score + reward_points where id = any(winners);
  end if;

  update public.game_show_games
  set status = 'exploded',
      exploded_at = clock_timestamp(),
      explode_at = clock_timestamp(),
      winner_team_id = winners[1],
      reward_points_awarded = reward_points,
      settings = settings || jsonb_build_object(
        'winner_team_ids', to_jsonb(winners),
        'correct_number', correct_value
      )
  where id = result.id
  returning * into result;

  return result;
end;
$$;

revoke all on function public.resolve_audience_question(uuid, uuid[]) from public;
grant execute on function public.resolve_audience_question(uuid, uuid[]) to authenticated;

comment on function public.resolve_audience_question(uuid, uuid[]) is
  'Resolves closest or host-selected Audience Question winners idempotently, credits every winner, and records the per-winner reward.';

commit;
