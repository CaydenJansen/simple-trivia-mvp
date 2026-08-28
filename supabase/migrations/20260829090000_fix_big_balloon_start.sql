begin;

create or replace function public.start_big_balloon(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  eligible jsonb;
begin
  select game_show_games.* into result from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id and game_show_games.game_type = 'big-balloon'
    and game_show_games.status = 'ready' and quizzes.owner_id = auth.uid()
  for update of game_show_games;
  if result.id is null then raise exception 'Big Balloon not found, already started, or not owned by current host'; end if;

  eligible := result.settings->'eligible_team_ids';
  if eligible is null or jsonb_typeof(eligible) <> 'array' or jsonb_array_length(eligible) = 0 then
    select jsonb_agg(teams.id order by teams.created_at) into eligible
    from public.teams where teams.game_id = result.game_id
      and teams.last_seen_at > clock_timestamp() - interval '5 minutes';
  end if;
  if eligible is null or jsonb_array_length(eligible) = 0 then raise exception 'Big Balloon needs at least one active team'; end if;

  delete from public.game_show_game_balloons where game_show_game_id = result.id;
  delete from public.game_show_game_balloon_private where game_show_game_id = result.id;
  insert into public.game_show_game_balloons (game_show_game_id, game_id, team_id)
  select result.id, result.game_id, value::uuid from jsonb_array_elements_text(eligible) value;
  insert into public.game_show_game_balloon_private (game_show_game_id, team_id, pop_at_units)
  select result.id, value::uuid, 6500000 + floor(random() * 3500001)::bigint
  from jsonb_array_elements_text(eligible) value;

  update public.game_show_games
  set status = 'open', started_at = clock_timestamp(), explode_at = clock_timestamp() + interval '18 seconds',
      exploded_at = null, winner_team_id = null, reward_points_awarded = 0,
      settings = settings || jsonb_build_object('eligible_team_ids', eligible)
  where id = result.id returning * into result;
  return result;
end;
$$;

revoke all on function public.start_big_balloon(uuid) from public;
grant execute on function public.start_big_balloon(uuid) to authenticated;

comment on function public.start_big_balloon(uuid) is
  'Starts Big Balloon with active teams when no frozen eligible-team list was supplied.';

commit;
