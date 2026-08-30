begin;

-- The Big Balloon clock is a deadline to begin, not a forced ending for an
-- attempt that was already underway. Ready teams cannot start after zero,
-- while inflating teams may finish naturally by locking or popping.
create or replace function public.pulse_big_balloon(p_game_show_game_id uuid, p_request_id uuid, p_request_token uuid)
returns public.game_show_game_balloons
language plpgsql security definer set search_path = public
as $$
declare
  request_row public.team_join_requests%rowtype;
  show_game public.game_show_games%rowtype;
  balloon public.game_show_game_balloons%rowtype;
  threshold bigint;
  elapsed_units bigint;
  next_size bigint;
  other_intact integer;
  inflating_remaining boolean;
begin
  select * into request_row from public.team_join_requests
  where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;

  select * into show_game from public.game_show_games
  where id = p_game_show_game_id and game_id = request_row.game_id and game_type = 'big-balloon'
  for update;
  if show_game.id is null or show_game.status <> 'open' then raise exception 'BALLOON_CLOSED'; end if;

  select * into balloon from public.game_show_game_balloons
  where game_show_game_id = show_game.id and team_id = request_row.team_id for update;
  if balloon.id is null or balloon.status in ('locked', 'popped') then raise exception 'BALLOON_LOCKED'; end if;
  if balloon.status = 'ready' and clock_timestamp() >= show_game.explode_at then raise exception 'BALLOON_CLOSED'; end if;

  select pop_at_units into threshold from public.game_show_game_balloon_private
  where game_show_game_id = show_game.id and team_id = request_row.team_id;

  if balloon.status = 'ready' then
    update public.game_show_game_balloons
    set status = 'inflating', size_units = 25000, last_inflated_at = clock_timestamp()
    where id = balloon.id returning * into balloon;
    return balloon;
  end if;

  elapsed_units := greatest(1000, least(350000, floor(extract(epoch from (clock_timestamp() - balloon.last_inflated_at)) * 1000000)::bigint));
  next_size := balloon.size_units + elapsed_units;
  if next_size >= threshold then
    select count(*) into other_intact from public.game_show_game_balloons
    where game_show_game_id = show_game.id and team_id <> balloon.team_id and status <> 'popped';
    if other_intact = 0 then
      update public.game_show_game_balloons set size_units = threshold - 1, status = 'locked', locked_at = clock_timestamp(), last_inflated_at = null
      where id = balloon.id returning * into balloon;
    else
      update public.game_show_game_balloons set size_units = threshold, status = 'popped', popped_at = clock_timestamp(), last_inflated_at = null
      where id = balloon.id returning * into balloon;
    end if;
  else
    update public.game_show_game_balloons set size_units = next_size, last_inflated_at = clock_timestamp()
    where id = balloon.id returning * into balloon;
  end if;

  select exists(select 1 from public.game_show_game_balloons where game_show_game_id = show_game.id and status = 'inflating') into inflating_remaining;
  perform public.finish_big_balloon_if_ready(show_game.id, clock_timestamp() >= show_game.explode_at and not inflating_remaining);
  return balloon;
end;
$$;

create or replace function public.lock_big_balloon(p_game_show_game_id uuid, p_request_id uuid, p_request_token uuid)
returns public.game_show_game_balloons
language plpgsql security definer set search_path = public
as $$
declare
  request_row public.team_join_requests%rowtype;
  show_game public.game_show_games%rowtype;
  balloon public.game_show_game_balloons%rowtype;
  threshold bigint;
  next_size bigint;
  other_intact integer;
  inflating_remaining boolean;
begin
  select * into request_row from public.team_join_requests where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;
  select * into show_game from public.game_show_games where id = p_game_show_game_id and game_id = request_row.game_id and game_type = 'big-balloon' for update;
  if show_game.id is null or show_game.status <> 'open' then raise exception 'BALLOON_CLOSED'; end if;
  select * into balloon from public.game_show_game_balloons where game_show_game_id = show_game.id and team_id = request_row.team_id for update;
  if balloon.id is null then raise exception 'BALLOON_NOT_FOUND'; end if;
  if balloon.status in ('locked', 'popped') then return balloon; end if;
  if balloon.status = 'ready' and clock_timestamp() >= show_game.explode_at then raise exception 'BALLOON_CLOSED'; end if;

  select pop_at_units into threshold from public.game_show_game_balloon_private where game_show_game_id = show_game.id and team_id = request_row.team_id;
  next_size := balloon.size_units + case when balloon.last_inflated_at is null then 0 else greatest(0, least(350000, floor(extract(epoch from (clock_timestamp() - balloon.last_inflated_at)) * 1000000)::bigint)) end;
  if next_size >= threshold then
    select count(*) into other_intact from public.game_show_game_balloons where game_show_game_id = show_game.id and team_id <> balloon.team_id and status <> 'popped';
    if other_intact = 0 then
      update public.game_show_game_balloons set size_units = threshold - 1, status = 'locked', locked_at = clock_timestamp(), last_inflated_at = null where id = balloon.id returning * into balloon;
    else
      update public.game_show_game_balloons set size_units = threshold, status = 'popped', popped_at = clock_timestamp(), last_inflated_at = null where id = balloon.id returning * into balloon;
    end if;
  else
    update public.game_show_game_balloons set size_units = next_size, status = 'locked', locked_at = clock_timestamp(), last_inflated_at = null where id = balloon.id returning * into balloon;
  end if;

  select exists(select 1 from public.game_show_game_balloons where game_show_game_id = show_game.id and status = 'inflating') into inflating_remaining;
  perform public.finish_big_balloon_if_ready(show_game.id, clock_timestamp() >= show_game.explode_at and not inflating_remaining);
  return balloon;
end;
$$;

create or replace function public.resolve_big_balloon(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  inflating_remaining boolean;
begin
  select game_show_games.* into result from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id and game_show_games.game_type = 'big-balloon' and quizzes.owner_id = auth.uid();
  if result.id is null then raise exception 'Big Balloon not found or not owned by current host'; end if;
  if result.status <> 'open' then return result; end if;
  select exists(select 1 from public.game_show_game_balloons where game_show_game_id = result.id and status = 'inflating') into inflating_remaining;
  if clock_timestamp() >= result.explode_at and inflating_remaining and clock_timestamp() < result.explode_at + interval '30 seconds' then return result; end if;
  return public.finish_big_balloon_if_ready(result.id, clock_timestamp() >= result.explode_at);
end;
$$;

-- Frozen eligible-team settings can contain a team that was removed after the
-- lobby snapshot. Filter them against the live game before inserting rows so
-- one stale UUID cannot prevent Treasure from starting for everyone.
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
  update public.game_show_games set status='open',started_at=clock_timestamp(),explode_at=clock_timestamp()+interval '30 seconds',
    exploded_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible,'guard_awake',false,'guard_next_at',clock_timestamp()+make_interval(secs=>3+random()*3))
  where id=result.id returning * into result;
  return result;
end;
$$;

revoke all on function public.pulse_big_balloon(uuid, uuid, uuid), public.lock_big_balloon(uuid, uuid, uuid), public.resolve_big_balloon(uuid), public.start_steal_the_treasure(uuid) from public;
grant execute on function public.resolve_big_balloon(uuid), public.start_steal_the_treasure(uuid) to authenticated;
grant execute on function public.pulse_big_balloon(uuid, uuid, uuid), public.lock_big_balloon(uuid, uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
