begin;

-- Keep quick accidental taps scoreless, but make deliberate holds begin
-- accruing after 300ms instead of 500ms.
create or replace function public.set_steal_the_treasure_holding(
  p_game_show_game_id uuid,
  p_request_id uuid,
  p_request_token uuid,
  p_holding boolean
) returns public.game_show_game_treasure
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.team_join_requests%rowtype;
  show_game public.game_show_games%rowtype;
  result public.game_show_game_treasure%rowtype;
  guard_awake boolean;
  earned bigint;
begin
  select * into request_row
  from public.team_join_requests
  where id = p_request_id
    and request_token = p_request_token
    and status = 'approved';

  if not found or request_row.team_id is null then
    raise exception 'JOIN_REQUEST_INVALID';
  end if;

  select * into show_game
  from public.game_show_games
  where id = p_game_show_game_id
    and game_id = request_row.game_id
    and game_type = 'steal-the-treasure'
  for update;

  if show_game.id is null or show_game.status <> 'open' or clock_timestamp() >= show_game.explode_at then
    raise exception 'TREASURE_CLOSED';
  end if;

  select * into result
  from public.game_show_game_treasure
  where game_show_game_id = show_game.id
    and team_id = request_row.team_id
  for update;

  if result.id is null then raise exception 'TEAM_NOT_ELIGIBLE'; end if;

  guard_awake := coalesce((show_game.settings->>'guard_awake')::boolean, false);
  if p_holding then
    if guard_awake then raise exception 'GUARD_AWAKE'; end if;
    if not result.is_stealing then
      update public.game_show_game_treasure
      set is_stealing = true,
          stealing_started_at = clock_timestamp(),
          current_units = 0,
          updated_at = clock_timestamp()
      where id = result.id
      returning * into result;
    end if;
  else
    if result.is_stealing and not guard_awake then
      earned := greatest(
        0,
        floor((extract(epoch from (clock_timestamp() - result.stealing_started_at)) - 0.3) * 1000)::bigint
      );
      update public.game_show_game_treasure
      set banked_units = banked_units + earned,
          current_units = 0,
          is_stealing = false,
          stealing_started_at = null,
          updated_at = clock_timestamp()
      where id = result.id
      returning * into result;
    else
      update public.game_show_game_treasure
      set current_units = 0,
          is_stealing = false,
          stealing_started_at = null,
          updated_at = clock_timestamp()
      where id = result.id
      returning * into result;
    end if;
  end if;

  return result;
end;
$$;

-- Apply the same warm-up when the round ends while a safe hold is active.
create or replace function public.resolve_steal_the_treasure(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  winner_id uuid;
  reward_points integer;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type = 'steal-the-treasure'
    and quizzes.owner_id = auth.uid()
  for update of game_show_games;

  if result.id is null then raise exception 'Steal the Treasure not found or not owned by current host'; end if;
  if result.status <> 'open' then return result; end if;

  if not coalesce((result.settings->>'guard_awake')::boolean, false) then
    update public.game_show_game_treasure
    set banked_units = banked_units + greatest(
          0,
          floor((extract(epoch from (clock_timestamp() - stealing_started_at)) - 0.3) * 1000)::bigint
        ),
        is_stealing = false,
        stealing_started_at = null,
        current_units = 0,
        updated_at = clock_timestamp()
    where game_show_game_id = result.id and is_stealing;
  else
    update public.game_show_game_treasure
    set is_stealing = false,
        stealing_started_at = null,
        current_units = 0,
        updated_at = clock_timestamp()
    where game_show_game_id = result.id and is_stealing;
  end if;

  select team_id into winner_id
  from public.game_show_game_treasure
  where game_show_game_id = result.id
  order by banked_units desc, caught_count, team_id
  limit 1;

  reward_points := public.beat_the_bomb_reward_points(result.settings);
  if reward_points > 0 then
    update public.teams set score = score + reward_points where id = winner_id;
  end if;

  update public.game_show_games
  set status = 'exploded',
      exploded_at = clock_timestamp(),
      explode_at = clock_timestamp(),
      winner_team_id = winner_id,
      reward_points_awarded = reward_points
  where id = result.id
  returning * into result;

  return result;
end;
$$;

revoke all on function public.set_steal_the_treasure_holding(uuid, uuid, uuid, boolean) from public;
revoke all on function public.resolve_steal_the_treasure(uuid) from public;
grant execute on function public.set_steal_the_treasure_holding(uuid, uuid, uuid, boolean) to anon, authenticated;
grant execute on function public.resolve_steal_the_treasure(uuid) to authenticated;

comment on function public.set_steal_the_treasure_holding(uuid, uuid, uuid, boolean) is
  'Starts or banks a player treasure attempt, with a server-enforced 300ms warm-up before treasure accrues.';

notify pgrst, 'reload schema';

commit;
