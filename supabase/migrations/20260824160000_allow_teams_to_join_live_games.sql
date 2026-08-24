create or replace function public.join_live_game(
  p_game_id uuid,
  p_team_name text
)
returns table (
  id uuid,
  name text,
  score integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := btrim(p_team_name);
begin
  if normalized_name = '' then
    raise exception 'Team name is required';
  end if;

  if not exists (
    select 1
    from public.games
    where games.id = p_game_id
      and games.status in ('lobby', 'live')
  ) then
    raise exception 'Game is not accepting new teams';
  end if;

  return query
  insert into public.teams (game_id, name, score)
  values (p_game_id, normalized_name, 0)
  returning teams.id, teams.name, teams.score;
end;
$$;

revoke all on function public.join_live_game(uuid, text) from public;
grant execute on function public.join_live_game(uuid, text) to anon, authenticated;

comment on function public.join_live_game(uuid, text) is
  'Creates a zero-score team while its game is in the lobby or actively running.';
