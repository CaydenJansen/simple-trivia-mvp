begin;

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
  if show_game.status <> 'exploded' and not exists (
    select 1 from public.game_show_game_responses own_response
    where own_response.game_show_game_id = show_game.id and own_response.team_id = request_row.team_id
  ) then raise exception 'SUBMIT_BEFORE_VIEWING'; end if;

  return query
  select responses.team_id, teams.name, responses.response_text, responses.numeric_response, responses.submitted_at
  from public.game_show_game_responses responses
  join public.teams on teams.id = responses.team_id
  where responses.game_show_game_id = show_game.id
  order by responses.submitted_at;
end;
$$;

create or replace function public.resolve_elimination_show_game(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  alive_ids uuid[];
  survivor_ids uuid[] := '{}'::uuid[];
  eliminated_ids uuid[] := '{}'::uuid[];
  current_round integer;
  outcome text;
  rock_lane integer;
  previous_rock_lane integer;
  reward_points integer;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type in ('heads-or-tails', 'dodge-the-rock')
    and quizzes.owner_id = auth.uid()
  for update of game_show_games;

  if result.id is null then raise exception 'Show game not found or not owned by current host'; end if;
  if result.status <> 'open' or result.settings->>'round_phase' <> 'choosing' then return result; end if;
  if clock_timestamp() < result.explode_at then return result; end if;

  select coalesce(array_agg(value::uuid), '{}'::uuid[]) into alive_ids
  from jsonb_array_elements_text(result.settings->'alive_team_ids') as value;
  current_round := (result.settings->>'round_number')::integer;

  if result.game_type = 'heads-or-tails' then
    outcome := case when random() < 0.5 then 'heads' else 'tails' end;
    select coalesce(array_agg(choices.team_id), '{}'::uuid[]) into survivor_ids
    from public.game_show_game_choices choices
    where choices.game_show_game_id = result.id
      and choices.round_number = current_round
      and choices.team_id = any(alive_ids)
      and choices.choice = outcome;
    if cardinality(survivor_ids) = 0 then survivor_ids := alive_ids; end if;
  else
    begin previous_rock_lane := nullif(result.settings->>'last_rock_lane', '')::integer;
    exception when invalid_text_representation then previous_rock_lane := null; end;

    select lane into rock_lane
    from generate_series(0, 2) as lane
    where (
      select count(*) from unnest(alive_ids) as team_id
      where coalesce((result.settings->'positions'->>team_id::text)::integer, 1) = lane
    ) < cardinality(alive_ids)
    order by case when lane = previous_rock_lane then 1 else 0 end, random()
    limit 1;

    outcome := rock_lane::text;
    select coalesce(array_agg(team_id), '{}'::uuid[]) into survivor_ids
    from unnest(alive_ids) as team_id
    where coalesce((result.settings->'positions'->>team_id::text)::integer, 1) <> rock_lane;
  end if;

  select coalesce(array_agg(team_id), '{}'::uuid[]) into eliminated_ids
  from unnest(alive_ids) as team_id where not (team_id = any(survivor_ids));

  update public.game_show_games
  set settings = settings || jsonb_build_object(
        'alive_team_ids', to_jsonb(survivor_ids),
        'eliminated_team_ids', coalesce(settings->'eliminated_team_ids', '[]'::jsonb) || to_jsonb(eliminated_ids),
        'round_eliminated_team_ids', to_jsonb(eliminated_ids),
        'round_phase', 'reveal',
        'round_outcome', outcome
      ) || case when result.game_type = 'dodge-the-rock'
        then jsonb_build_object('last_rock_lane', rock_lane)
        else '{}'::jsonb end,
      explode_at = clock_timestamp() + interval '4 seconds'
  where id = result.id returning * into result;

  if cardinality(survivor_ids) = 1 then
    reward_points := public.beat_the_bomb_reward_points(result.settings);
    update public.teams set score = score + reward_points where id = survivor_ids[1];
    update public.game_show_games
    set status = 'exploded', exploded_at = clock_timestamp(), winner_team_id = survivor_ids[1],
        reward_points_awarded = reward_points
    where id = result.id returning * into result;
  end if;

  return result;
end;
$$;

revoke all on function public.get_audience_question_responses(uuid, uuid, uuid) from public;
grant execute on function public.get_audience_question_responses(uuid, uuid, uuid) to anon, authenticated;

comment on function public.get_audience_question_responses(uuid, uuid, uuid) is
  'Lets an admitted player who has locked a response view the room responses before the host awards the Audience Question.';

commit;
