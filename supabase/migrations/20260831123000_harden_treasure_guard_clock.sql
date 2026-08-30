begin;

-- Guard transitions must not depend on the host browser keeping a timer alive.
-- Both the host and approved players call the same due-time-guarded state
-- transition. Row locking makes concurrent calls safe and idempotent.
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
      when awake then make_interval(secs => 1.4 + random() * 1.6)
      else make_interval(secs => 2.5 + random() * 3.5)
    end
  )
  where id = result.id
  returning * into result;

  return result;
end;
$$;

create or replace function public.advance_steal_the_treasure(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  permitted_id uuid;
begin
  select game_show_games.id into permitted_id
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type = 'steal-the-treasure'
    and quizzes.owner_id = auth.uid();

  if permitted_id is null then raise exception 'Steal the Treasure not found or not owned by current host'; end if;
  return public.advance_steal_the_treasure_state(permitted_id);
end;
$$;

create or replace function public.sync_steal_the_treasure_guard(
  p_game_show_game_id uuid,
  p_request_id uuid,
  p_request_token uuid
)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  request_row public.team_join_requests%rowtype;
  permitted_id uuid;
begin
  select * into request_row
  from public.team_join_requests
  where id = p_request_id
    and request_token = p_request_token
    and status = 'approved';

  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;

  select id into permitted_id
  from public.game_show_games
  where id = p_game_show_game_id
    and game_id = request_row.game_id
    and game_type = 'steal-the-treasure';

  if permitted_id is null then raise exception 'TREASURE_NOT_FOUND'; end if;
  return public.advance_steal_the_treasure_state(permitted_id);
end;
$$;

revoke all on function public.advance_steal_the_treasure_state(uuid) from public;
revoke all on function public.advance_steal_the_treasure(uuid) from public;
revoke all on function public.sync_steal_the_treasure_guard(uuid, uuid, uuid) from public;
grant execute on function public.advance_steal_the_treasure(uuid) to authenticated;
grant execute on function public.sync_steal_the_treasure_guard(uuid, uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
