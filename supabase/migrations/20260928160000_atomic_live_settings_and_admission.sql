begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create or replace function public.join_live_game(
  p_game_id uuid,
  p_team_name text,
  p_team_pin text default null,
  p_pin_mode text default 'none'
)
returns table (
  request_id uuid,
  request_token uuid,
  name text,
  admission_status text,
  team_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := btrim(p_team_name);
  normalized_name_key text;
  normalized_pin text := coalesce(btrim(p_team_pin), '');
  requested_pin_mode text := coalesce(p_pin_mode, 'none');
  requested_pin_digest text;
  linked_profile_id uuid;
  created_team_id uuid;
  approval_required boolean := true;
begin
  if normalized_name = '' then raise exception 'Team name is required'; end if;
  if requested_pin_mode not in ('none', 'have', 'create') then raise exception 'TEAM_PIN_INVALID'; end if;

  select
    coalesce(games.settings ->> 'team_approval_required', 'true') <> 'false'
  into approval_required
  from public.games
  where games.id = p_game_id and games.status in ('lobby', 'live') for update;

  if not found then raise exception 'Game is not accepting new teams'; end if;

  normalized_name_key := lower(regexp_replace(normalized_name, '\s+', ' ', 'g'));
  if exists (
    select 1 from public.teams
    where teams.game_id = p_game_id
      and lower(regexp_replace(btrim(teams.name), '\s+', ' ', 'g')) = normalized_name_key
  ) or exists (
    select 1 from public.team_join_requests
    where team_join_requests.game_id = p_game_id
      and team_join_requests.name_key = normalized_name_key
      and team_join_requests.status = 'pending'
  ) then
    raise exception 'TEAM_NAME_TAKEN';
  end if;

  if requested_pin_mode <> 'none' then
    if normalized_pin !~ '^[0-9]{4}$' then raise exception 'TEAM_PIN_INVALID'; end if;
    requested_pin_digest := encode(extensions.digest(normalized_name_key || ':' || normalized_pin, 'sha256'), 'hex');

    if requested_pin_mode = 'have' then
      select team_profiles.id into linked_profile_id
      from public.team_profiles
      where team_profiles.name_key = normalized_name_key and team_profiles.pin_digest = requested_pin_digest;
      if linked_profile_id is null then raise exception 'TEAM_PIN_NOT_FOUND'; end if;
      if exists (
        select 1 from public.teams where teams.game_id = p_game_id and teams.team_profile_id = linked_profile_id
      ) or exists (
        select 1 from public.team_join_requests
        where team_join_requests.game_id = p_game_id
          and team_join_requests.team_profile_id = linked_profile_id
          and team_join_requests.status = 'pending'
      ) then
        raise exception 'TEAM_ALREADY_JOINED';
      end if;
      update public.team_profiles
      set display_name = normalized_name, updated_at = now(), last_joined_at = now()
      where team_profiles.id = linked_profile_id;
    else
      select team_profiles.id into linked_profile_id
      from public.team_profiles
      where team_profiles.name_key = normalized_name_key
        and team_profiles.pin_digest = requested_pin_digest
        and not exists (select 1 from public.teams where teams.team_profile_id = team_profiles.id);
      if linked_profile_id is not null then
        update public.team_profiles
        set display_name = normalized_name, updated_at = now(), last_joined_at = now()
        where team_profiles.id = linked_profile_id;
      elsif exists (
        select 1 from public.team_profiles
        where team_profiles.name_key = normalized_name_key and team_profiles.pin_digest = requested_pin_digest
      ) then
        raise exception 'TEAM_PIN_ALREADY_EXISTS';
      else
        insert into public.team_profiles (display_name, name_key, pin_digest)
        values (normalized_name, normalized_name_key, requested_pin_digest)
        returning team_profiles.id into linked_profile_id;
      end if;
    end if;
  end if;

  if not approval_required then
    insert into public.teams (game_id, name, score, team_profile_id)
    values (p_game_id, normalized_name, 0, linked_profile_id)
    returning teams.id into created_team_id;
  end if;

  return query
  insert into public.team_join_requests (
    game_id, team_profile_id, requested_name, name_key, status, team_id, decided_at
  ) values (
    p_game_id,
    linked_profile_id,
    normalized_name,
    normalized_name_key,
    case when approval_required then 'pending' else 'approved' end,
    created_team_id,
    case when approval_required then null else now() end
  )
  returning
    team_join_requests.id,
    team_join_requests.request_token,
    team_join_requests.requested_name,
    team_join_requests.status,
    team_join_requests.team_id;
end;
$$;

create or replace function public.decide_team_join_request(
  p_request_id uuid,
  p_decision text
)
returns table (
  request_id uuid,
  admission_status text,
  team_id uuid,
  name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.team_join_requests%rowtype;
  created_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_decision not in ('approved', 'denied') then
    raise exception 'Invalid admission decision';
  end if;

  -- All admission writers lock the game before the request, including Auto-Join.
  perform 1 from public.games g join public.quizzes q on q.id=g.quiz_id
  where q.owner_id=auth.uid() and g.id=(select r.game_id from public.team_join_requests r where r.id=p_request_id)
  for update of g;
  if not found then raise exception 'Join request not found'; end if;

  select requests.* into request_row
  from public.team_join_requests requests
  join public.games on games.id = requests.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where requests.id = p_request_id
    and quizzes.owner_id = auth.uid()
  for update of requests;

  if request_row.id is null then
    raise exception 'Join request not found';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'Join request has already been decided';
  end if;

  if p_decision = 'approved' then
    if not exists (
      select 1 from public.games
      where games.id = request_row.game_id and games.status in ('lobby', 'live')
    ) then
      raise exception 'Game is not accepting new teams';
    end if;

    insert into public.teams (game_id, name, score, team_profile_id)
    values (request_row.game_id, request_row.requested_name, 0, request_row.team_profile_id)
    returning teams.id into created_team_id;
  end if;

  update public.team_join_requests
  set
    status = p_decision,
    team_id = created_team_id,
    decided_at = now()
  where team_join_requests.id = request_row.id;

  return query select request_row.id, p_decision, created_team_id, request_row.requested_name;
end;
$$;

-- Merge only changed keys under the game lock. Clock publication must never
-- replace a concurrently changed visibility/admission setting (or vice versa).
create or replace function public.patch_host_game_settings(p_game_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.games%rowtype; request record; result jsonb;
begin
  if auth.uid() is null or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'Invalid settings update';
  end if;
  select games.* into g from public.games join public.quizzes q on q.id=games.quiz_id
  where games.id=p_game_id and q.owner_id=auth.uid() for update of games;
  if not found then raise exception 'Game not found'; end if;
  if g.status not in ('lobby','live') then raise exception 'Game is no longer active'; end if;
  update public.games set settings=coalesce(settings,'{}'::jsonb)||p_patch,
    answer_editing_allowed=case when g.answer_phase='open' and p_patch ? 'submitted_answers_editable'
      then (p_patch->>'submitted_answers_editable')::boolean else answer_editing_allowed end
  where id=p_game_id returning settings into result;
  if p_patch->>'team_approval_required'='false' then
    for request in select id from public.team_join_requests
      where game_id=p_game_id and status='pending' order by id for update
    loop
      perform public.decide_team_join_request(request.id,'approved');
    end loop;
  end if;
  return result;
end;
$$;
revoke all on function public.patch_host_game_settings(uuid,jsonb) from public,anon;
grant execute on function public.patch_host_game_settings(uuid,jsonb) to authenticated;
commit;
