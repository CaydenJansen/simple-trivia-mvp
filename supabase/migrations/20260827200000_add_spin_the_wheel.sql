begin;

update public.games
set settings = settings || '{"team_approval_required":false}'::jsonb
where not (settings ? 'team_approval_required');

alter table public.quiz_show_games drop constraint if exists quiz_show_games_game_type_check;
alter table public.quiz_show_games add constraint quiz_show_games_game_type_check
  check (game_type in ('beat-the-bomb', 'spin-the-wheel'));

alter table public.game_show_games drop constraint if exists game_show_games_game_type_check;
alter table public.game_show_games add constraint game_show_games_game_type_check
  check (game_type in ('beat-the-bomb', 'spin-the-wheel'));

create or replace function public.start_spin_the_wheel(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.game_show_games%rowtype;
  eligible_team_ids jsonb;
begin
  select jsonb_agg(teams.id order by teams.created_at)
  into eligible_team_ids
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  join public.teams on teams.game_id = games.id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type = 'spin-the-wheel'
    and game_show_games.status = 'ready'
    and quizzes.owner_id = auth.uid();

  if eligible_team_ids is null or jsonb_array_length(eligible_team_ids) = 0 then
    raise exception 'Spin the Wheel needs at least one team';
  end if;

  update public.game_show_games
  set status = 'open',
      started_at = clock_timestamp(),
      explode_at = clock_timestamp() + interval '5 seconds',
      exploded_at = null,
      winner_team_id = null,
      reward_points_awarded = 0,
      settings = settings || jsonb_build_object('eligible_team_ids', eligible_team_ids)
  where id = p_game_show_game_id
  returning * into result;

  if result.id is null then raise exception 'Show game not found, already started, or not owned by current host'; end if;
  return result;
end;
$$;

create or replace function public.resolve_spin_the_wheel(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.game_show_games%rowtype;
  selected_team_id uuid;
  reward_points integer;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type = 'spin-the-wheel'
    and quizzes.owner_id = auth.uid()
  for update of game_show_games;

  if result.id is null then raise exception 'Show game not found or not owned by current host'; end if;

  if result.status = 'open' and clock_timestamp() >= result.explode_at then
    select teams.id into selected_team_id
    from public.teams
    where teams.game_id = result.game_id
      and result.settings->'eligible_team_ids' ? teams.id::text
    order by random()
    limit 1;

    if selected_team_id is null then raise exception 'Spin the Wheel has no eligible teams'; end if;
    reward_points := public.beat_the_bomb_reward_points(result.settings);
    update public.teams set score = score + reward_points where id = selected_team_id;
    update public.game_show_games
    set status = 'exploded', exploded_at = clock_timestamp(), winner_team_id = selected_team_id,
        reward_points_awarded = reward_points
    where id = result.id returning * into result;
  end if;

  return result;
end;
$$;

revoke all on function public.start_spin_the_wheel(uuid) from public;
revoke all on function public.resolve_spin_the_wheel(uuid) from public;
grant execute on function public.start_spin_the_wheel(uuid) to authenticated;
grant execute on function public.resolve_spin_the_wheel(uuid) to authenticated;

comment on function public.start_spin_the_wheel(uuid) is
'Freezes the currently joined teams into show-game settings and starts a five-second random draw.';

commit;
