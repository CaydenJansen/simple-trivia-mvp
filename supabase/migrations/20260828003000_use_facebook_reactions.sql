begin;

alter table public.game_reactions
  drop constraint if exists game_reactions_reaction_check;

alter table public.game_reactions
  add constraint game_reactions_reaction_check
  check (reaction in ('👍', '❤️', '🥰', '😂', '😮', '😢', '😡'));

create or replace function public.send_game_reaction(
  p_request_id uuid,
  p_request_token uuid,
  p_reaction text
)
returns public.game_reactions
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.team_join_requests%rowtype;
  team_row public.teams%rowtype;
  created public.game_reactions%rowtype;
begin
  if p_reaction not in ('👍', '❤️', '🥰', '😂', '😮', '😢', '😡') then raise exception 'REACTION_INVALID'; end if;

  select * into request_row
  from public.team_join_requests
  where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;

  select * into team_row from public.teams where id = request_row.team_id and game_id = request_row.game_id;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;

  if exists (
    select 1 from public.game_reactions
    where game_reactions.team_id = team_row.id
      and game_reactions.created_at > clock_timestamp() - interval '400 milliseconds'
  ) then raise exception 'REACTION_RATE_LIMITED'; end if;

  delete from public.game_reactions where created_at < clock_timestamp() - interval '10 minutes';
  insert into public.game_reactions (game_id, team_id, team_name, reaction)
  values (team_row.game_id, team_row.id, team_row.name, p_reaction)
  returning * into created;
  return created;
end;
$$;

revoke all on function public.send_game_reaction(uuid, uuid, text) from public;
grant execute on function public.send_game_reaction(uuid, uuid, text) to anon, authenticated;

commit;
