create or replace function public.withdraw_team_join_request(
  p_request_id uuid,
  p_request_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.team_join_requests
  where team_join_requests.id = p_request_id
    and team_join_requests.request_token = p_request_token
    and team_join_requests.status = 'pending';

  return found;
end;
$$;

create or replace function public.remove_team_from_game(p_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  delete from public.teams
  using public.games, public.quizzes
  where teams.id = p_team_id
    and games.id = teams.game_id
    and quizzes.id = games.quiz_id
    and quizzes.owner_id = auth.uid()
    and games.status in ('lobby', 'live')
  returning teams.id into removed_team_id;

  if removed_team_id is null then raise exception 'Team not found or game is no longer active'; end if;
  return removed_team_id;
end;
$$;

revoke all on function public.withdraw_team_join_request(uuid, uuid) from public;
revoke all on function public.remove_team_from_game(uuid) from public;
grant execute on function public.withdraw_team_join_request(uuid, uuid) to anon, authenticated;
grant execute on function public.remove_team_from_game(uuid) to authenticated;

comment on function public.withdraw_team_join_request(uuid, uuid) is
  'Lets a player withdraw only their own still-pending admission request using its capability token.';
comment on function public.remove_team_from_game(uuid) is
  'Lets the owning host remove a joined team from an active lobby or live game.';
