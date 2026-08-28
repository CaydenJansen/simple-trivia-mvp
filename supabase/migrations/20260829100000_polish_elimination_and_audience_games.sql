begin;

create or replace function public.submit_audience_question_response(
  p_game_show_game_id uuid, p_request_id uuid, p_request_token uuid, p_response text
)
returns public.game_show_game_responses
language plpgsql security definer set search_path = public
as $$
declare
  request_row public.team_join_requests%rowtype;
  show_game public.game_show_games%rowtype;
  result public.game_show_game_responses%rowtype;
  parsed_number numeric;
  correct_value numeric;
begin
  select * into request_row from public.team_join_requests
  where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;

  select * into show_game from public.game_show_games
  where id = p_game_show_game_id and game_id = request_row.game_id for update;
  if show_game.id is null or show_game.game_type <> 'audience-question' or show_game.status <> 'open' then
    raise exception 'RESPONSES_CLOSED';
  end if;
  if not (show_game.settings->'eligible_team_ids' ? request_row.team_id::text) then raise exception 'TEAM_NOT_ELIGIBLE'; end if;
  if length(btrim(p_response)) not between 1 and 1000 then raise exception 'RESPONSE_INVALID'; end if;

  if show_game.settings->>'audience_question_mode' = 'closest-number' then
    begin parsed_number := btrim(p_response)::numeric;
    exception when invalid_text_representation then raise exception 'NUMBER_REQUIRED'; end;
    select correct_number into correct_value
    from public.game_show_game_audience_private
    where game_show_game_id = show_game.id;
    if correct_value is null then raise exception 'Closest Guess needs a correct number'; end if;
  end if;

  insert into public.game_show_game_responses (
    game_show_game_id, game_id, team_id, response_text, numeric_response, distance_from_correct
  ) values (
    show_game.id, show_game.game_id, request_row.team_id, btrim(p_response), parsed_number,
    case when parsed_number is null then null else abs(parsed_number - correct_value) end
  ) returning * into result;
  return result;
end;
$$;

create or replace function public.get_audience_question_responses(
  p_game_show_game_id uuid, p_request_id uuid, p_request_token uuid
)
returns table (team_id uuid, team_name text, response_text text, numeric_response numeric, submitted_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
declare request_row public.team_join_requests%rowtype; show_game public.game_show_games%rowtype;
begin
  select * into request_row from public.team_join_requests
  where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;
  select * into show_game from public.game_show_games
  where id = p_game_show_game_id and game_id = request_row.game_id and game_type = 'audience-question';
  if show_game.id is null then raise exception 'SHOW_GAME_INVALID'; end if;
  if show_game.settings->>'audience_question_mode' = 'closest-number' then
    raise exception 'NUMERIC_RESPONSES_ARE_HOST_ONLY';
  end if;
  if show_game.status <> 'exploded' and not exists (
    select 1 from public.game_show_game_responses own_response
    where own_response.game_show_game_id = show_game.id and own_response.team_id = request_row.team_id
  ) then raise exception 'SUBMIT_BEFORE_VIEWING'; end if;
  return query
  select responses.team_id, teams.name, responses.response_text, responses.numeric_response, responses.submitted_at
  from public.game_show_game_responses responses
  join public.teams on teams.id = responses.team_id
  where responses.game_show_game_id = show_game.id order by responses.submitted_at;
end;
$$;

create or replace function public.start_elimination_show_game(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  eligible_team_ids jsonb;
  initial_positions jsonb;
  only_team_id uuid;
  reward_points integer;
begin
  select jsonb_agg(teams.id order by teams.created_at), jsonb_object_agg(teams.id::text, 1)
  into eligible_team_ids, initial_positions
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  join public.teams on teams.game_id = games.id and teams.last_seen_at > clock_timestamp() - interval '5 minutes'
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type in ('heads-or-tails', 'dodge-the-rock')
    and game_show_games.status = 'ready' and quizzes.owner_id = auth.uid();
  if eligible_team_ids is null or jsonb_array_length(eligible_team_ids) = 0 then raise exception 'This game needs at least one active team'; end if;

  update public.game_show_games
  set status = 'open', started_at = clock_timestamp(), explode_at = clock_timestamp() + interval '10 seconds',
      exploded_at = null, winner_team_id = null, reward_points_awarded = 0,
      settings = settings || jsonb_build_object(
        'eligible_team_ids', eligible_team_ids, 'alive_team_ids', eligible_team_ids,
        'eliminated_team_ids', '[]'::jsonb, 'round_eliminated_team_ids', '[]'::jsonb,
        'round_number', 1, 'round_phase', 'choosing', 'round_outcome', null,
        'positions', coalesce(initial_positions, '{}'::jsonb)
      )
  where id = p_game_show_game_id returning * into result;
  if result.id is null then raise exception 'Show game not found, already started, or not owned by current host'; end if;

  if jsonb_array_length(eligible_team_ids) = 1 then
    only_team_id := (eligible_team_ids->>0)::uuid;
    reward_points := public.beat_the_bomb_reward_points(result.settings);
    update public.teams set score = score + reward_points where id = only_team_id;
    update public.game_show_games set status = 'exploded', exploded_at = clock_timestamp(), explode_at = clock_timestamp(),
      winner_team_id = only_team_id, reward_points_awarded = reward_points
    where id = result.id returning * into result;
  end if;
  return result;
end;
$$;

create or replace function public.advance_elimination_show_game(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare result public.game_show_games%rowtype;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type in ('heads-or-tails', 'dodge-the-rock')
    and quizzes.owner_id = auth.uid() for update of game_show_games;
  if result.id is null then raise exception 'Show game not found or not owned by current host'; end if;
  if result.status <> 'open' or result.settings->>'round_phase' <> 'reveal' then return result; end if;
  if clock_timestamp() < result.explode_at then return result; end if;
  update public.game_show_games
  set settings = settings || jsonb_build_object(
        'round_number', (settings->>'round_number')::integer + 1,
        'round_phase', 'choosing', 'round_outcome', null, 'round_eliminated_team_ids', '[]'::jsonb
      ),
      explode_at = clock_timestamp() + interval '10 seconds'
  where id = result.id returning * into result;
  return result;
end;
$$;

revoke all on function public.submit_audience_question_response(uuid, uuid, uuid, text), public.get_audience_question_responses(uuid, uuid, uuid), public.start_elimination_show_game(uuid), public.advance_elimination_show_game(uuid) from public;
grant execute on function public.submit_audience_question_response(uuid, uuid, uuid, text), public.get_audience_question_responses(uuid, uuid, uuid) to anon, authenticated;
grant execute on function public.start_elimination_show_game(uuid), public.advance_elimination_show_game(uuid) to authenticated;

comment on function public.get_audience_question_responses(uuid, uuid, uuid) is
  'Lets players share favourite-answer responses after submitting; numerical guesses remain host-only.';

commit;
