create table if not exists public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  request_token uuid not null default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  team_profile_id uuid references public.team_profiles(id) on delete set null,
  requested_name text not null check (length(btrim(requested_name)) > 0),
  name_key text not null check (length(btrim(name_key)) > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  team_id uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (request_token)
);

create unique index if not exists team_join_requests_one_pending_name_idx
  on public.team_join_requests (game_id, name_key)
  where status = 'pending';

create unique index if not exists team_join_requests_one_pending_profile_idx
  on public.team_join_requests (game_id, team_profile_id)
  where status = 'pending' and team_profile_id is not null;

create index if not exists team_join_requests_host_queue_idx
  on public.team_join_requests (game_id, status, created_at);

alter table public.team_join_requests enable row level security;

create policy "Hosts read join requests for owned games"
on public.team_join_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = team_join_requests.game_id
      and quizzes.owner_id = auth.uid()
  )
);

grant select on table public.team_join_requests to authenticated;
revoke all on table public.team_join_requests from anon;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'team_join_requests'
  ) then
    alter publication supabase_realtime add table public.team_join_requests;
  end if;
end $$;

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
  admission_status text
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
begin
  if normalized_name = '' then
    raise exception 'Team name is required';
  end if;

  if requested_pin_mode not in ('none', 'have', 'create') then
    raise exception 'TEAM_PIN_INVALID';
  end if;

  if not exists (
    select 1 from public.games
    where games.id = p_game_id and games.status in ('lobby', 'live')
  ) then
    raise exception 'Game is not accepting new teams';
  end if;

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
    if normalized_pin !~ '^[0-9]{4}$' then
      raise exception 'TEAM_PIN_INVALID';
    end if;

    requested_pin_digest := encode(
      extensions.digest(normalized_name_key || ':' || normalized_pin, 'sha256'),
      'hex'
    );

    if requested_pin_mode = 'have' then
      select team_profiles.id into linked_profile_id
      from public.team_profiles
      where team_profiles.name_key = normalized_name_key
        and team_profiles.pin_digest = requested_pin_digest;

      if linked_profile_id is null then
        raise exception 'TEAM_PIN_NOT_FOUND';
      end if;

      if exists (
        select 1 from public.teams
        where teams.game_id = p_game_id and teams.team_profile_id = linked_profile_id
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
        and not exists (
          select 1 from public.teams where teams.team_profile_id = team_profiles.id
        );

      if linked_profile_id is not null then
        update public.team_profiles
        set display_name = normalized_name, updated_at = now(), last_joined_at = now()
        where team_profiles.id = linked_profile_id;
      elsif exists (
        select 1 from public.team_profiles
        where team_profiles.name_key = normalized_name_key
          and team_profiles.pin_digest = requested_pin_digest
      ) then
        raise exception 'TEAM_PIN_ALREADY_EXISTS';
      else
        insert into public.team_profiles (display_name, name_key, pin_digest)
        values (normalized_name, normalized_name_key, requested_pin_digest)
        returning team_profiles.id into linked_profile_id;
      end if;
    end if;
  end if;

  return query
  insert into public.team_join_requests (
    game_id, team_profile_id, requested_name, name_key
  ) values (
    p_game_id, linked_profile_id, normalized_name, normalized_name_key
  )
  returning
    team_join_requests.id,
    team_join_requests.request_token,
    team_join_requests.requested_name,
    team_join_requests.status;
end;
$$;

create function public.get_team_join_request(
  p_request_id uuid,
  p_request_token uuid
)
returns table (
  admission_status text,
  team_id uuid,
  name text,
  game_status text
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    requests.status,
    requests.team_id,
    requests.requested_name,
    games.status
  from public.team_join_requests requests
  join public.games on games.id = requests.game_id
  where requests.id = p_request_id
    and requests.request_token = p_request_token;
$$;

create function public.decide_team_join_request(
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

revoke all on function public.join_live_game(uuid, text, text, text) from public;
revoke all on function public.get_team_join_request(uuid, uuid) from public;
revoke all on function public.decide_team_join_request(uuid, text) from public;

grant execute on function public.join_live_game(uuid, text, text, text) to anon, authenticated;
grant execute on function public.get_team_join_request(uuid, uuid) to anon, authenticated;
grant execute on function public.decide_team_join_request(uuid, text) to authenticated;

comment on table public.team_join_requests is
  'Host-moderated admission queue. Only approved requests become game teams.';

comment on function public.join_live_game(uuid, text, text, text) is
  'Requests host approval to join a lobby/live game and optionally creates or links an account-free team PIN profile.';

comment on function public.get_team_join_request(uuid, uuid) is
  'Returns one player admission result when both capability identifiers match.';

comment on function public.decide_team_join_request(uuid, text) is
  'Lets the owning host approve or deny a pending team; approval atomically creates the game team.';
