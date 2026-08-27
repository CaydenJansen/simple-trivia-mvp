alter table public.games
  add column if not exists answer_editing_allowed boolean not null default false;

drop function if exists public.join_live_game(uuid, text, text, text);

create function public.join_live_game(
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
  where games.id = p_game_id and games.status in ('lobby', 'live');

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

grant execute on function public.join_live_game(uuid, text, text, text) to anon, authenticated;
