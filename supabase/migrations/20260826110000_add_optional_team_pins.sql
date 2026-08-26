-- Optional, account-free team identity. A PIN links the same named team across
-- games; it is not used for scoring and is never exposed through table reads.
create table if not exists public.team_profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) > 0),
  name_key text not null check (length(btrim(name_key)) > 0),
  pin_digest text not null check (pin_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_joined_at timestamptz not null default now(),
  unique (name_key, pin_digest)
);

alter table public.team_profiles enable row level security;
revoke all on table public.team_profiles from anon, authenticated;

alter table public.teams
  add column if not exists team_profile_id uuid
    references public.team_profiles(id) on delete set null;

create index if not exists teams_team_profile_history_idx
  on public.teams (team_profile_id, created_at desc)
  where team_profile_id is not null;

create unique index if not exists teams_one_profile_per_game_idx
  on public.teams (game_id, team_profile_id)
  where team_profile_id is not null;

drop function if exists public.join_live_game(uuid, text);

create function public.join_live_game(
  p_game_id uuid,
  p_team_name text,
  p_team_pin text default null,
  p_pin_mode text default 'none'
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
    select 1
    from public.games
    where games.id = p_game_id
      and games.status in ('lobby', 'live')
  ) then
    raise exception 'Game is not accepting new teams';
  end if;

  if requested_pin_mode <> 'none' then
    if normalized_pin !~ '^[0-9]{4}$' then
      raise exception 'TEAM_PIN_INVALID';
    end if;

    normalized_name_key := lower(regexp_replace(normalized_name, '\s+', ' ', 'g'));
    requested_pin_digest := encode(
      extensions.digest(normalized_name_key || ':' || normalized_pin, 'sha256'),
      'hex'
    );

    if requested_pin_mode = 'have' then
      select team_profiles.id
        into linked_profile_id
      from public.team_profiles
      where team_profiles.name_key = normalized_name_key
        and team_profiles.pin_digest = requested_pin_digest;

      if linked_profile_id is null then
        raise exception 'TEAM_PIN_NOT_FOUND';
      end if;

      if exists (
        select 1
        from public.teams
        where teams.game_id = p_game_id
          and teams.team_profile_id = linked_profile_id
      ) then
        raise exception 'TEAM_ALREADY_JOINED';
      end if;

      update public.team_profiles
      set
        display_name = normalized_name,
        updated_at = now(),
        last_joined_at = now()
      where team_profiles.id = linked_profile_id;
    else
      if exists (
        select 1
        from public.team_profiles
        where team_profiles.name_key = normalized_name_key
          and team_profiles.pin_digest = requested_pin_digest
      ) then
        raise exception 'TEAM_PIN_ALREADY_EXISTS';
      end if;

      insert into public.team_profiles (display_name, name_key, pin_digest)
      values (normalized_name, normalized_name_key, requested_pin_digest)
      returning team_profiles.id into linked_profile_id;
    end if;
  end if;

  return query
  insert into public.teams (game_id, name, score, team_profile_id)
  values (p_game_id, normalized_name, 0, linked_profile_id)
  returning teams.id, teams.name, teams.score;
end;
$$;

revoke all on function public.join_live_game(uuid, text, text, text) from public;
grant execute on function public.join_live_game(uuid, text, text, text) to anon, authenticated;

comment on table public.team_profiles is
  'Account-free team identities linked across games by a team-name-and-PIN credential.';

comment on column public.team_profiles.pin_digest is
  'SHA-256 digest of the normalized team name and optional four-digit PIN; the raw PIN is never stored.';

comment on column public.teams.team_profile_id is
  'Optional persistent identity link. A game team and its score remain game-scoped.';

comment on function public.join_live_game(uuid, text, text, text) is
  'Creates a zero-score team in a lobby/live game and optionally creates or links an account-free team PIN profile.';
