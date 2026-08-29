begin;

-- Keep the final Beat the Bomb press visible for a brief beat. The existing
-- host timer resolves the winner once this shortened fuse expires.
create or replace function public.press_beat_the_bomb(p_game_show_game_id uuid, p_team_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = ''
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
    and game_show_games.settings->'eligible_team_ids' ? p_team_id::text
  for update of game_show_games;
  if result.id is null then raise exception 'Beat the Bomb is not accepting presses'; end if;

  if clock_timestamp() >= result.explode_at then
    select team_id into latest_team_id from public.game_show_game_presses
    where game_show_game_id = result.id order by pressed_at desc, id desc limit 1;
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

  active_team_count := jsonb_array_length(result.settings->'eligible_team_ids');
  select count(*) into press_count from public.game_show_game_presses where game_show_game_id = result.id;
  if press_count >= active_team_count then
    update public.game_show_games
    set explode_at = least(explode_at, clock_timestamp() + interval '500 milliseconds')
    where id = result.id returning * into result;
  else
    select * into result from public.game_show_games where id = result.id;
  end if;
  return result;
end;
$$;

-- Heads or Tails keeps a surviving team's last call unless they deliberately
-- change it during the next choosing window.
create or replace function public.advance_elimination_show_game(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  current_round integer;
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

  current_round := (result.settings->>'round_number')::integer;
  if result.game_type = 'heads-or-tails' then
    insert into public.game_show_game_choices (game_show_game_id, game_id, team_id, round_number, choice)
    select previous.game_show_game_id, previous.game_id, previous.team_id, current_round + 1, previous.choice
    from public.game_show_game_choices previous
    where previous.game_show_game_id = result.id
      and previous.round_number = current_round
      and result.settings->'alive_team_ids' ? previous.team_id::text
    on conflict (game_show_game_id, round_number, team_id) do nothing;
  end if;

  update public.game_show_games
  set settings = settings || jsonb_build_object(
        'round_number', current_round + 1,
        'round_phase', 'choosing', 'round_outcome', null, 'round_eliminated_team_ids', '[]'::jsonb
      ),
      explode_at = clock_timestamp() + interval '15 seconds'
  where id = result.id returning * into result;
  return result;
end;
$$;

revoke all on function public.press_beat_the_bomb(uuid, uuid), public.advance_elimination_show_game(uuid) from public;
grant execute on function public.press_beat_the_bomb(uuid, uuid) to anon, authenticated;
grant execute on function public.advance_elimination_show_game(uuid) to authenticated;

commit;
