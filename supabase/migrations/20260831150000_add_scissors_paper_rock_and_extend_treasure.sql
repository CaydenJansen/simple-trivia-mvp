begin;

alter table public.quiz_show_games drop constraint if exists quiz_show_games_game_type_check;
alter table public.quiz_show_games add constraint quiz_show_games_game_type_check
  check (game_type in ('beat-the-bomb', 'spin-the-wheel', 'heads-or-tails', 'dodge-the-rock', 'scissors-paper-rock', 'big-balloon', 'steal-the-treasure', 'audience-question', 'in-show-tiebreaker'));

alter table public.game_show_games drop constraint if exists game_show_games_game_type_check;
alter table public.game_show_games add constraint game_show_games_game_type_check
  check (game_type in ('beat-the-bomb', 'spin-the-wheel', 'heads-or-tails', 'dodge-the-rock', 'scissors-paper-rock', 'big-balloon', 'steal-the-treasure', 'audience-question', 'in-show-tiebreaker'));

alter table public.game_show_game_choices drop constraint if exists game_show_game_choices_choice_check;
alter table public.game_show_game_choices add constraint game_show_game_choices_choice_check
  check (choice in ('heads', 'tails', '0', '1', '2', 'scissors', 'paper', 'rock'));

create or replace function public.build_scissors_paper_rock_round(p_alive_ids uuid[])
returns jsonb
language plpgsql volatile security invoker set search_path = public
as $$
declare
  shuffled_ids uuid[];
  pairings jsonb := '[]'::jsonb;
  bye_team_id uuid;
  team_count integer;
  pair_index integer;
begin
  select coalesce(array_agg(team_id order by random()), '{}'::uuid[])
  into shuffled_ids
  from unnest(coalesce(p_alive_ids, '{}'::uuid[])) as team_id;

  team_count := cardinality(shuffled_ids);
  if mod(team_count, 2) = 1 then bye_team_id := shuffled_ids[team_count]; end if;

  if team_count >= 2 then
    for pair_index in 1..floor(team_count / 2.0)::integer loop
      pairings := pairings || jsonb_build_array(jsonb_build_object(
        'team_a', shuffled_ids[(pair_index * 2) - 1],
        'team_b', shuffled_ids[pair_index * 2]
      ));
    end loop;
  end if;

  return jsonb_build_object(
    'round_matchups', pairings,
    'round_bye_team_id', bye_team_id
  );
end;
$$;

create or replace function public.start_elimination_show_game(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  eligible_team_ids jsonb;
  eligible_ids uuid[];
  initial_positions jsonb;
  round_settings jsonb := '{}'::jsonb;
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
    and game_show_games.game_type in ('heads-or-tails', 'dodge-the-rock', 'scissors-paper-rock')
    and game_show_games.status = 'ready' and quizzes.owner_id = auth.uid();

  if eligible_team_ids is null or jsonb_array_length(eligible_team_ids) = 0 then
    raise exception 'This game needs at least one active team';
  end if;

  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into eligible_ids
  from jsonb_array_elements_text(eligible_team_ids) as value;

  select * into result from public.game_show_games where id = p_game_show_game_id;
  if result.game_type = 'scissors-paper-rock' then
    round_settings := public.build_scissors_paper_rock_round(eligible_ids);
  end if;

  update public.game_show_games
  set status = 'open', started_at = clock_timestamp(),
      explode_at = clock_timestamp() + case when game_type = 'scissors-paper-rock' then interval '5 seconds' else interval '10 seconds' end,
      exploded_at = null, winner_team_id = null, reward_points_awarded = 0,
      settings = settings || jsonb_build_object(
        'eligible_team_ids', eligible_team_ids,
        'alive_team_ids', eligible_team_ids,
        'eliminated_team_ids', '[]'::jsonb,
        'round_eliminated_team_ids', '[]'::jsonb,
        'round_number', 1,
        'round_phase', 'choosing',
        'round_outcome', null,
        'positions', coalesce(initial_positions, '{}'::jsonb)
      ) || round_settings
  where id = p_game_show_game_id
  returning * into result;

  if result.id is null then raise exception 'Show game not found, already started, or not owned by current host'; end if;

  if jsonb_array_length(eligible_team_ids) = 1 then
    only_team_id := (eligible_team_ids->>0)::uuid;
    reward_points := public.beat_the_bomb_reward_points(result.settings);
    update public.teams set score = score + reward_points where id = only_team_id;
    update public.game_show_games
    set status = 'exploded', exploded_at = clock_timestamp(), explode_at = clock_timestamp(),
        winner_team_id = only_team_id, reward_points_awarded = reward_points
    where id = result.id returning * into result;
  end if;

  return result;
end;
$$;

create or replace function public.submit_elimination_show_game_choice(
  p_game_show_game_id uuid,
  p_request_id uuid,
  p_request_token uuid,
  p_choice text
)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  request_row public.team_join_requests%rowtype;
  result public.game_show_games%rowtype;
  current_round integer;
begin
  select * into request_row from public.team_join_requests
  where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;

  select * into result from public.game_show_games
  where id = p_game_show_game_id and game_id = request_row.game_id
  for update;

  if result.id is null or result.status <> 'open' or result.settings->>'round_phase' <> 'choosing'
    or clock_timestamp() >= result.explode_at then
    raise exception 'CHOICES_CLOSED';
  end if;
  if not (result.settings->'alive_team_ids' ? request_row.team_id::text) then raise exception 'TEAM_ELIMINATED'; end if;
  if result.game_type = 'heads-or-tails' and p_choice not in ('heads', 'tails') then raise exception 'CHOICE_INVALID'; end if;
  if result.game_type = 'dodge-the-rock' and p_choice not in ('0', '1', '2') then raise exception 'CHOICE_INVALID'; end if;
  if result.game_type = 'scissors-paper-rock' and p_choice not in ('scissors', 'paper', 'rock') then raise exception 'CHOICE_INVALID'; end if;
  if result.game_type not in ('heads-or-tails', 'dodge-the-rock', 'scissors-paper-rock') then raise exception 'SHOW_GAME_INVALID'; end if;

  current_round := (result.settings->>'round_number')::integer;
  insert into public.game_show_game_choices (game_show_game_id, game_id, team_id, round_number, choice)
  values (result.id, result.game_id, request_row.team_id, current_round, p_choice)
  on conflict (game_show_game_id, round_number, team_id)
  do update set choice = excluded.choice, submitted_at = clock_timestamp();

  if result.game_type = 'dodge-the-rock' then
    update public.game_show_games
    set settings = jsonb_set(
      settings,
      '{positions}',
      coalesce(settings->'positions', '{}'::jsonb) || jsonb_build_object(request_row.team_id::text, p_choice::integer),
      true
    )
    where id = result.id returning * into result;
  end if;

  return result;
end;
$$;

create or replace function public.resolve_elimination_show_game(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
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
  matchup jsonb;
  team_a uuid;
  team_b uuid;
  choice_a text;
  choice_b text;
  bye_team_id uuid;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type in ('heads-or-tails', 'dodge-the-rock', 'scissors-paper-rock')
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
  elsif result.game_type = 'dodge-the-rock' then
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
  else
    outcome := 'matchups-resolved';
    begin bye_team_id := nullif(result.settings->>'round_bye_team_id', '')::uuid;
    exception when invalid_text_representation then bye_team_id := null; end;
    if bye_team_id is not null then survivor_ids := array_append(survivor_ids, bye_team_id); end if;

    for matchup in select value from jsonb_array_elements(coalesce(result.settings->'round_matchups', '[]'::jsonb)) as value loop
      team_a := (matchup->>'team_a')::uuid;
      team_b := (matchup->>'team_b')::uuid;
      select choice into choice_a from public.game_show_game_choices
        where game_show_game_id = result.id and round_number = current_round and team_id = team_a;
      select choice into choice_b from public.game_show_game_choices
        where game_show_game_id = result.id and round_number = current_round and team_id = team_b;

      if choice_a is null and choice_b is null then
        survivor_ids := array_append(array_append(survivor_ids, team_a), team_b);
      elsif choice_a is null then
        survivor_ids := array_append(survivor_ids, team_b);
      elsif choice_b is null then
        survivor_ids := array_append(survivor_ids, team_a);
      elsif choice_a = choice_b then
        survivor_ids := array_append(array_append(survivor_ids, team_a), team_b);
      elsif (choice_a = 'scissors' and choice_b = 'paper')
        or (choice_a = 'paper' and choice_b = 'rock')
        or (choice_a = 'rock' and choice_b = 'scissors') then
        survivor_ids := array_append(survivor_ids, team_a);
      else
        survivor_ids := array_append(survivor_ids, team_b);
      end if;
    end loop;
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

create or replace function public.advance_elimination_show_game(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  current_round integer;
  alive_ids uuid[];
  round_settings jsonb := '{}'::jsonb;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type in ('heads-or-tails', 'dodge-the-rock', 'scissors-paper-rock')
    and quizzes.owner_id = auth.uid() for update of game_show_games;

  if result.id is null then raise exception 'Show game not found or not owned by current host'; end if;
  if result.status <> 'open' or result.settings->>'round_phase' <> 'reveal' then return result; end if;
  if clock_timestamp() < result.explode_at then return result; end if;

  current_round := (result.settings->>'round_number')::integer;
  if result.game_type = 'heads-or-tails' then
    insert into public.game_show_game_choices (game_show_game_id, game_id, team_id, round_number, choice)
    select previous.game_show_game_id, previous.game_id, previous.team_id, current_round + 1, previous.choice
    from public.game_show_game_choices previous
    where previous.game_show_game_id = result.id
      and previous.round_number = current_round
      and result.settings->'alive_team_ids' ? previous.team_id::text
    on conflict (game_show_game_id, round_number, team_id) do nothing;
  elsif result.game_type = 'scissors-paper-rock' then
    select coalesce(array_agg(value::uuid), '{}'::uuid[])
    into alive_ids
    from jsonb_array_elements_text(result.settings->'alive_team_ids') as value;
    round_settings := public.build_scissors_paper_rock_round(alive_ids);
  end if;

  update public.game_show_games
  set settings = settings || jsonb_build_object(
        'round_number', current_round + 1,
        'round_phase', 'choosing',
        'round_outcome', null,
        'round_eliminated_team_ids', '[]'::jsonb
      ) || round_settings,
      explode_at = clock_timestamp() + case when game_type = 'scissors-paper-rock' then interval '5 seconds' else interval '15 seconds' end
  where id = result.id returning * into result;
  return result;
end;
$$;

-- Treasure gets a little more room to breathe, while wider server-authored
-- timing windows make the guard meaningfully less predictable.
create or replace function public.start_steal_the_treasure(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path = public
as $$
declare result public.game_show_games%rowtype; configured jsonb; eligible jsonb;
begin
  select game_show_games.* into result from public.game_show_games
  join public.games on games.id=game_show_games.game_id join public.quizzes on quizzes.id=games.quiz_id
  where game_show_games.id=p_game_show_game_id and game_show_games.game_type='steal-the-treasure'
    and game_show_games.status='ready' and quizzes.owner_id=auth.uid() for update of game_show_games;
  if result.id is null then raise exception 'Steal the Treasure not found, already started, or not owned by current host'; end if;

  configured := result.settings->'eligible_team_ids';
  select jsonb_agg(teams.id order by teams.created_at) into eligible
  from public.teams
  where teams.game_id=result.game_id
    and teams.last_seen_at>clock_timestamp()-interval '5 minutes'
    and (configured is null or jsonb_typeof(configured)<>'array' or jsonb_array_length(configured)=0 or configured ? teams.id::text);
  if eligible is null or jsonb_array_length(eligible)=0 then raise exception 'Steal the Treasure needs at least one active team'; end if;

  delete from public.game_show_game_treasure where game_show_game_id=result.id;
  insert into public.game_show_game_treasure(game_show_game_id,game_id,team_id)
    select result.id,result.game_id,entry.team_id::uuid from jsonb_array_elements_text(eligible) as entry(team_id);
  update public.game_show_games set status='open',started_at=clock_timestamp(),explode_at=clock_timestamp()+interval '40 seconds',
    exploded_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible,'guard_awake',false,'guard_next_at',clock_timestamp()+make_interval(secs=>1.5+random()*6))
  where id=result.id returning * into result;
  return result;
end;
$$;

create or replace function public.advance_steal_the_treasure_state(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  awake boolean;
  next_at timestamptz;
begin
  select * into result
  from public.game_show_games
  where id = p_game_show_game_id and game_type = 'steal-the-treasure'
  for update;

  if result.id is null then raise exception 'TREASURE_NOT_FOUND'; end if;
  if result.status <> 'open' or clock_timestamp() >= result.explode_at then return result; end if;

  next_at := (result.settings->>'guard_next_at')::timestamptz;
  if next_at is not null and clock_timestamp() < next_at then return result; end if;

  awake := not coalesce((result.settings->>'guard_awake')::boolean, false);
  if awake then
    update public.game_show_game_treasure
    set is_stealing = false,
        stealing_started_at = null,
        current_units = 0,
        caught_count = caught_count + 1,
        updated_at = clock_timestamp()
    where game_show_game_id = result.id and is_stealing;
  end if;

  update public.game_show_games
  set settings = settings || jsonb_build_object(
    'guard_awake', awake,
    'guard_next_at', clock_timestamp() + case
      when awake then make_interval(secs => 0.8 + random() * 3.0)
      else make_interval(secs => 1.2 + random() * 7.0)
    end
  )
  where id = result.id
  returning * into result;

  return result;
end;
$$;

revoke all on function public.build_scissors_paper_rock_round(uuid[]) from public;
revoke all on function public.start_elimination_show_game(uuid) from public;
revoke all on function public.submit_elimination_show_game_choice(uuid, uuid, uuid, text) from public;
revoke all on function public.resolve_elimination_show_game(uuid) from public;
revoke all on function public.advance_elimination_show_game(uuid) from public;
revoke all on function public.start_steal_the_treasure(uuid) from public;
revoke all on function public.advance_steal_the_treasure_state(uuid) from public;

grant execute on function public.start_elimination_show_game(uuid), public.resolve_elimination_show_game(uuid), public.advance_elimination_show_game(uuid), public.start_steal_the_treasure(uuid) to authenticated;
grant execute on function public.submit_elimination_show_game_choice(uuid, uuid, uuid, text) to anon, authenticated;

comment on function public.build_scissors_paper_rock_round(uuid[]) is
  'Randomly pairs surviving Scissors Paper Rock teams and assigns at most one bye.';
comment on function public.resolve_elimination_show_game(uuid) is
  'Resolves one server-authoritative Heads or Tails, Dodge the Rock, or Scissors Paper Rock elimination round.';
comment on function public.start_steal_the_treasure(uuid) is
  'Starts a 40-second server-authoritative Treasure game with variable guard timing.';

notify pgrst, 'reload schema';

commit;
