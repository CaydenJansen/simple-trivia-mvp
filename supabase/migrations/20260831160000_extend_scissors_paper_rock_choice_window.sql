begin;

-- Give Scissors Paper Rock teams ten seconds for both the opening round and
-- every subsequent round. Other elimination games retain their existing
-- timing semantics.
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
      explode_at = clock_timestamp() + interval '10 seconds',
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
      explode_at = clock_timestamp() + case when game_type = 'scissors-paper-rock' then interval '10 seconds' else interval '15 seconds' end
  where id = result.id returning * into result;
  return result;
end;
$$;

revoke all on function public.start_elimination_show_game(uuid) from public;
revoke all on function public.advance_elimination_show_game(uuid) from public;
grant execute on function public.start_elimination_show_game(uuid), public.advance_elimination_show_game(uuid) to authenticated;

comment on function public.start_elimination_show_game(uuid) is
  'Starts a server-authoritative elimination game; Scissors Paper Rock rounds use a ten-second choice window.';

notify pgrst, 'reload schema';

commit;
