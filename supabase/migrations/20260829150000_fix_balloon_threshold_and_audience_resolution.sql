begin;

-- The percentage shown in the UI is size_units / 10,000,000. Keep the
-- server-authoritative pop boundary aligned with that visible 100% value.
update public.game_show_game_balloon_private
set pop_at_units = 10000000
where pop_at_units <> 10000000;

create or replace function public.start_big_balloon(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  eligible jsonb;
begin
  select game_show_games.* into result from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id and game_show_games.game_type = 'big-balloon'
    and game_show_games.status = 'ready' and quizzes.owner_id = auth.uid()
  for update of game_show_games;
  if result.id is null then raise exception 'Big Balloon not found, already started, or not owned by current host'; end if;

  eligible := result.settings->'eligible_team_ids';
  if eligible is null or jsonb_typeof(eligible) <> 'array' or jsonb_array_length(eligible) = 0 then
    select jsonb_agg(teams.id order by teams.created_at) into eligible
    from public.teams where teams.game_id = result.game_id
      and teams.last_seen_at > clock_timestamp() - interval '5 minutes';
  end if;
  if eligible is null or jsonb_array_length(eligible) = 0 then raise exception 'Big Balloon needs at least one active team'; end if;

  delete from public.game_show_game_balloons where game_show_game_id = result.id;
  delete from public.game_show_game_balloon_private where game_show_game_id = result.id;
  insert into public.game_show_game_balloons (game_show_game_id, game_id, team_id)
  select result.id, result.game_id, value::uuid from jsonb_array_elements_text(eligible) value;
  insert into public.game_show_game_balloon_private (game_show_game_id, team_id, pop_at_units)
  select result.id, value::uuid, 10000000
  from jsonb_array_elements_text(eligible) value;

  update public.game_show_games
  set status = 'open', started_at = clock_timestamp(), explode_at = clock_timestamp() + interval '18 seconds',
      exploded_at = null, winner_team_id = null, reward_points_awarded = 0,
      settings = settings || jsonb_build_object('eligible_team_ids', eligible)
  where id = result.id returning * into result;
  return result;
end;
$$;

create or replace function public.resolve_audience_question(p_game_show_game_id uuid, p_winner_team_ids uuid[] default null)
returns public.game_show_games
language plpgsql security definer set search_path = public
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
  select game_show_games.* into result from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id and game_show_games.game_type = 'audience-question'
    and quizzes.owner_id = auth.uid() for update of game_show_games;
  if result.id is null then raise exception 'Show game not found or not owned by current host'; end if;
  if result.status <> 'open' then return result; end if;

  select count(*) into response_count from public.game_show_game_responses where game_show_game_id = result.id;
  if response_count = 0 then raise exception 'Choose after at least one team responds'; end if;

  if result.settings->>'audience_question_mode' = 'closest-number' then
    select correct_number into correct_value from public.game_show_game_audience_private where game_show_game_id = result.id;
    if correct_value is null then raise exception 'Closest Guess needs a correct number'; end if;
    update public.game_show_game_responses set distance_from_correct = abs(numeric_response - correct_value)
    where game_show_game_id = result.id;
    select min(distance_from_correct) into minimum_distance from public.game_show_game_responses where game_show_game_id = result.id;
    select array_agg(team_id order by submitted_at) into winners from public.game_show_game_responses
      where game_show_game_id = result.id and distance_from_correct = minimum_distance;
  else
    winners := coalesce(p_winner_team_ids, '{}'::uuid[]);
    if cardinality(winners) = 0 then raise exception 'Choose at least one favourite response'; end if;
    allows_many := coalesce((result.settings->>'allow_multiple_winners')::boolean, false);
    if cardinality(winners) > 1 and not allows_many then raise exception 'This game allows one winner'; end if;
    if exists (
      select 1
      from unnest(winners) as selected_winner(team_id)
      where not exists (
        select 1 from public.game_show_game_responses response
        where response.game_show_game_id = result.id
          and response.team_id = selected_winner.team_id
      )
    ) then raise exception 'Every winner must have submitted a response'; end if;
  end if;

  update public.game_show_game_responses set is_winner = team_id = any(winners) where game_show_game_id = result.id;
  reward_points := public.beat_the_bomb_reward_points(result.settings);
  if reward_points > 0 then update public.teams set score = score + reward_points where id = any(winners); end if;
  update public.game_show_games set status = 'exploded', exploded_at = clock_timestamp(), explode_at = clock_timestamp(),
    winner_team_id = winners[1], reward_points_awarded = reward_points,
    settings = settings || jsonb_build_object('winner_team_ids', to_jsonb(winners), 'correct_number', correct_value)
  where id = result.id returning * into result;
  return result;
end;
$$;

revoke all on function public.start_big_balloon(uuid), public.resolve_audience_question(uuid, uuid[]) from public;
grant execute on function public.start_big_balloon(uuid), public.resolve_audience_question(uuid, uuid[]) to authenticated;

comment on function public.start_big_balloon(uuid) is
  'Starts Big Balloon with one visible and server-authoritative 100 percent pop boundary for every team.';
comment on function public.resolve_audience_question(uuid, uuid[]) is
  'Resolves closest or host-selected Audience Question winners idempotently and applies configured rewards once.';

commit;
