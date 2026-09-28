begin;

create table public.host_bonus_award_requests (
  operation_id uuid primary key,
  host_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  points integer not null check (points between 1 and 100),
  created_at timestamptz not null default now()
);
alter table public.host_bonus_award_requests enable row level security;
revoke all on public.host_bonus_award_requests from public, anon, authenticated;

create function public.award_host_bonus_points_once(p_team_id uuid, p_points integer, p_operation_id uuid)
returns public.teams language plpgsql security definer set search_path='' as $$
declare result public.teams%rowtype; prior public.host_bonus_award_requests%rowtype;
begin
  if auth.uid() is null or p_operation_id is null then raise exception 'Authentication and operation ID required'; end if;
  if p_points is null or p_points not between 1 and 100 then raise exception 'BONUS_POINTS_OUT_OF_RANGE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text,0));
  select t.* into result from public.teams t
    join public.games g on g.id=t.game_id join public.quizzes q on q.id=g.quiz_id
    where t.id=p_team_id and q.owner_id=auth.uid();
  if result.id is null then raise exception 'TEAM_NOT_FOUND'; end if;
  select * into prior from public.host_bonus_award_requests where operation_id=p_operation_id;
  if found then
    if prior.host_id<>auth.uid() or prior.team_id<>p_team_id or prior.points<>p_points then raise exception 'BONUS_OPERATION_CONFLICT'; end if;
    return result;
  end if;
  result:=public.award_host_bonus_points(p_team_id,p_points);
  insert into public.host_bonus_award_requests(operation_id,host_id,team_id,points)
    values(p_operation_id,auth.uid(),p_team_id,p_points);
  return result;
end;
$$;
revoke all on function public.award_host_bonus_points_once(uuid,integer,uuid) from public, anon;
grant execute on function public.award_host_bonus_points_once(uuid,integer,uuid) to authenticated;

commit;
