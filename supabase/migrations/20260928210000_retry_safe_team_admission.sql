begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create table public.team_join_operations (
  operation_id uuid primary key,
  request_id uuid not null references public.team_join_requests(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.team_join_operations enable row level security;
revoke all on public.team_join_operations from public,anon,authenticated;

create or replace function public.join_live_game_once(
  p_operation_id uuid,p_game_id uuid,p_team_name text,p_team_pin text default null,p_pin_mode text default 'none'
)
returns table(request_id uuid,request_token uuid,name text,admission_status text,team_id uuid)
language plpgsql security definer set search_path='' as $$
declare joined record; prior public.team_join_requests%rowtype;
begin
  if p_operation_id is null then raise exception 'Join operation is required'; end if;
  -- The random operation ID is a browser-held recovery capability. It is never
  -- listed publicly and stores no team PIN or PIN digest.
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select r.* into prior from public.team_join_operations o join public.team_join_requests r on r.id=o.request_id
  where o.operation_id=p_operation_id;
  if found then
    if prior.game_id<>p_game_id or prior.name_key<>lower(regexp_replace(btrim(p_team_name),'\s+',' ','g')) then
      raise exception 'JOIN_OPERATION_CONFLICT';
    end if;
    return query select prior.id,prior.request_token,prior.requested_name,prior.status,prior.team_id;
    return;
  end if;
  select * into joined from public.join_live_game(p_game_id,p_team_name,p_team_pin,p_pin_mode);
  insert into public.team_join_operations(operation_id,request_id) values(p_operation_id,joined.request_id);
  return query select joined.request_id,joined.request_token,joined.name,joined.admission_status,joined.team_id;
end;
$$;
revoke all on function public.join_live_game_once(uuid,uuid,text,text,text) from public;
grant execute on function public.join_live_game_once(uuid,uuid,text,text,text) to anon,authenticated;
commit;
