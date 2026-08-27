begin;

alter table public.game_show_games
add column if not exists reward_points_awarded integer not null default 0
check (reward_points_awarded between 0 and 100);

create or replace function public.beat_the_bomb_reward_points(p_settings jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_settings->>'reward_type' = 'points'
      and coalesce(p_settings->>'reward_points', '') ~ '^[0-9]+$'
      then least(100, greatest(1, (p_settings->>'reward_points')::integer))
    else 0
  end;
$$;

revoke all on function public.beat_the_bomb_reward_points(jsonb) from public;

-- Existing reusable games predate reward controls. Give them the new, visible
-- one-point default so the player copy and eventual score award stay aligned.
update public.quiz_show_games
set settings = settings || '{"reward_type":"points","reward_points":1}'::jsonb
where not (settings ? 'reward_type');

update public.game_show_games
set settings = settings || '{"reward_type":"points","reward_points":1}'::jsonb
where status in ('ready', 'open') and not (settings ? 'reward_type');

create or replace function public.start_beat_the_bomb(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.game_show_games%rowtype;
begin
  if not exists (
    select 1 from public.game_show_games
    join public.games on games.id = game_show_games.game_id
    join public.quizzes on quizzes.id = games.quiz_id
    where game_show_games.id = p_game_show_game_id
      and game_show_games.game_type = 'beat-the-bomb'
      and game_show_games.status = 'ready'
      and quizzes.owner_id = auth.uid()
  ) then raise exception 'Show game not found, already started, or not owned by current host'; end if;

  delete from public.game_show_game_presses where game_show_game_id = p_game_show_game_id;

  update public.game_show_games
  set status = 'open',
      started_at = clock_timestamp(),
      explode_at = clock_timestamp() + make_interval(secs => 10 + floor(random() * 21)::integer),
      exploded_at = null,
      winner_team_id = null,
      reward_points_awarded = 0
  where id = p_game_show_game_id
  returning * into result;

  return result;
end;
$$;

create or replace function public.press_beat_the_bomb(p_game_show_game_id uuid, p_team_id uuid)
returns public.game_show_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.game_show_games%rowtype;
  active_team_count integer;
  press_count integer;
  latest_team_id uuid;
  reward_points integer;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.teams on teams.game_id = games.id and teams.id = p_team_id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type = 'beat-the-bomb'
    and game_show_games.status = 'open'
    and games.status = 'live'
  for update of game_show_games;

  if result.id is null then raise exception 'Beat the Bomb is not accepting presses'; end if;

  if clock_timestamp() >= result.explode_at then
    select team_id into latest_team_id
    from public.game_show_game_presses
    where game_show_game_id = result.id
    order by pressed_at desc, id desc limit 1;

    if latest_team_id is not null then
      reward_points := public.beat_the_bomb_reward_points(result.settings);
      update public.teams set score = score + reward_points where id = latest_team_id;
      update public.game_show_games
      set status = 'exploded', exploded_at = clock_timestamp(), winner_team_id = latest_team_id,
          reward_points_awarded = reward_points
      where id = result.id returning * into result;
      return result;
    end if;
  end if;

  insert into public.game_show_game_presses (game_show_game_id, game_id, team_id)
  values (result.id, result.game_id, p_team_id)
  on conflict (game_show_game_id, team_id) do nothing;

  if not found then raise exception 'This team has already pressed'; end if;

  select count(*) into active_team_count from public.teams where teams.game_id = result.game_id;
  select count(*) into press_count from public.game_show_game_presses where game_show_game_id = result.id;

  if press_count >= active_team_count or clock_timestamp() >= result.explode_at then
    select team_id into latest_team_id
    from public.game_show_game_presses
    where game_show_game_id = result.id
    order by pressed_at desc, id desc limit 1;

    reward_points := public.beat_the_bomb_reward_points(result.settings);
    update public.teams set score = score + reward_points where id = latest_team_id;
    update public.game_show_games
    set status = 'exploded', exploded_at = clock_timestamp(), winner_team_id = latest_team_id,
        reward_points_awarded = reward_points
    where id = result.id returning * into result;
  else
    select * into result from public.game_show_games where id = result.id;
  end if;

  return result;
end;
$$;

create or replace function public.resolve_beat_the_bomb(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.game_show_games%rowtype;
  latest_team_id uuid;
  reward_points integer;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id and quizzes.owner_id = auth.uid()
  for update of game_show_games;

  if result.id is null then raise exception 'Show game not found or not owned by current host'; end if;

  if result.status = 'open' and clock_timestamp() >= result.explode_at then
    select team_id into latest_team_id from public.game_show_game_presses
    where game_show_game_id = result.id order by pressed_at desc, id desc limit 1;

    if latest_team_id is not null then
      reward_points := public.beat_the_bomb_reward_points(result.settings);
      update public.teams set score = score + reward_points where id = latest_team_id;
      update public.game_show_games
      set status = 'exploded', exploded_at = clock_timestamp(), winner_team_id = latest_team_id,
          reward_points_awarded = reward_points
      where id = result.id returning * into result;
    end if;
  end if;

  return result;
end;
$$;

comment on column public.game_show_games.reward_points_awarded is
'Frozen audit value for the points actually awarded when this show game resolved; custom rewards remain zero.';

commit;
