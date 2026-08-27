begin;

alter table public.teams
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists teams_game_last_seen_idx
  on public.teams (game_id, last_seen_at desc);

create table if not exists public.game_reactions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  team_name text not null check (length(btrim(team_name)) > 0),
  reaction text not null check (reaction in ('👍', '👎', '❤️')),
  created_at timestamptz not null default now()
);

create index if not exists game_reactions_game_created_idx
  on public.game_reactions (game_id, created_at desc);

alter table public.game_reactions enable row level security;

drop policy if exists "Live game reactions are readable" on public.game_reactions;
create policy "Live game reactions are readable"
  on public.game_reactions for select
  using (exists (
    select 1 from public.games
    where games.id = game_reactions.game_id
      and games.status in ('lobby', 'live')
  ));

grant select on public.game_reactions to anon, authenticated;

create or replace function public.touch_team_presence(p_request_id uuid, p_request_token uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  touched_at timestamptz;
begin
  update public.teams
  set last_seen_at = clock_timestamp()
  where teams.id = (
    select team_join_requests.team_id
    from public.team_join_requests
    where team_join_requests.id = p_request_id
      and team_join_requests.request_token = p_request_token
      and team_join_requests.status = 'approved'
      and team_join_requests.team_id is not null
  )
  returning teams.last_seen_at into touched_at;

  if touched_at is null then raise exception 'TEAM_SESSION_INVALID'; end if;
  return touched_at;
end;
$$;

create or replace function public.send_game_reaction(
  p_request_id uuid,
  p_request_token uuid,
  p_reaction text
)
returns public.game_reactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  team_row public.teams%rowtype;
  created public.game_reactions%rowtype;
begin
  if p_reaction not in ('👍', '👎', '❤️') then raise exception 'REACTION_INVALID'; end if;

  select teams.* into team_row
  from public.team_join_requests
  join public.teams on teams.id = team_join_requests.team_id
  join public.games on games.id = teams.game_id
  where team_join_requests.id = p_request_id
    and team_join_requests.request_token = p_request_token
    and team_join_requests.status = 'approved'
    and games.status in ('lobby', 'live');

  if team_row.id is null then raise exception 'TEAM_SESSION_INVALID'; end if;
  if exists (
    select 1 from public.game_reactions
    where game_reactions.team_id = team_row.id
      and game_reactions.created_at > clock_timestamp() - interval '400 milliseconds'
  ) then raise exception 'REACTION_TOO_FAST'; end if;

  update public.teams set last_seen_at = clock_timestamp() where id = team_row.id;
  delete from public.game_reactions where created_at < clock_timestamp() - interval '10 minutes';

  insert into public.game_reactions (game_id, team_id, team_name, reaction)
  values (team_row.game_id, team_row.id, team_row.name, p_reaction)
  returning * into created;
  return created;
end;
$$;

revoke all on function public.touch_team_presence(uuid, uuid), public.send_game_reaction(uuid, uuid, text) from public;
grant execute on function public.touch_team_presence(uuid, uuid), public.send_game_reaction(uuid, uuid, text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_reactions'
    ) then
    alter publication supabase_realtime add table public.game_reactions;
  end if;
end $$;

-- Freeze only awake teams into a show game. A sleeping team that reconnects
-- becomes active for subsequent questions and games, but not one already spun.
create or replace function public.start_spin_the_wheel(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = ''
as $$
declare
  result public.game_show_games%rowtype;
  eligible_team_ids jsonb;
begin
  select jsonb_agg(teams.id order by teams.created_at) into eligible_team_ids
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  join public.teams on teams.game_id = games.id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type = 'spin-the-wheel'
    and game_show_games.status = 'ready'
    and quizzes.owner_id = auth.uid()
    and teams.last_seen_at > clock_timestamp() - interval '5 minutes';

  if eligible_team_ids is null or jsonb_array_length(eligible_team_ids) = 0 then
    raise exception 'Spin the Wheel needs at least one active team';
  end if;

  update public.game_show_games
  set status = 'open', started_at = clock_timestamp(),
      explode_at = clock_timestamp() + interval '5 seconds', exploded_at = null,
      winner_team_id = null, reward_points_awarded = 0,
      settings = settings || jsonb_build_object('eligible_team_ids', eligible_team_ids)
  where id = p_game_show_game_id returning * into result;
  if result.id is null then raise exception 'Show game not found, already started, or not owned by current host'; end if;
  return result;
end;
$$;

create or replace function public.start_beat_the_bomb(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = ''
as $$
declare
  result public.game_show_games%rowtype;
  eligible_team_ids jsonb;
begin
  select jsonb_agg(teams.id order by teams.created_at) into eligible_team_ids
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  join public.teams on teams.game_id = games.id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type = 'beat-the-bomb'
    and game_show_games.status = 'ready'
    and quizzes.owner_id = auth.uid()
    and teams.last_seen_at > clock_timestamp() - interval '5 minutes';

  if eligible_team_ids is null or jsonb_array_length(eligible_team_ids) = 0 then
    raise exception 'Beat the Bomb needs at least one active team';
  end if;
  delete from public.game_show_game_presses where game_show_game_id = p_game_show_game_id;
  update public.game_show_games
  set status = 'open', started_at = clock_timestamp(),
      explode_at = clock_timestamp() + make_interval(secs => 10 + floor(random() * 21)::integer),
      exploded_at = null, winner_team_id = null, reward_points_awarded = 0,
      settings = settings || jsonb_build_object('eligible_team_ids', eligible_team_ids)
  where id = p_game_show_game_id returning * into result;
  return result;
end;
$$;

create or replace function public.press_beat_the_bomb(p_game_show_game_id uuid, p_team_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = ''
as $$
declare
  result public.game_show_games%rowtype;
  active_team_count integer;
  press_count integer;
  latest_team_id uuid;
  reward_points integer;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.teams on teams.game_id = games.id and teams.id = p_team_id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type = 'beat-the-bomb'
    and game_show_games.status = 'open'
    and games.status = 'live'
    and game_show_games.settings->'eligible_team_ids' ? p_team_id::text
  for update of game_show_games;
  if result.id is null then raise exception 'Beat the Bomb is not accepting presses'; end if;

  if clock_timestamp() >= result.explode_at then
    select team_id into latest_team_id from public.game_show_game_presses
    where game_show_game_id = result.id order by pressed_at desc, id desc limit 1;
    if latest_team_id is not null then
      reward_points := public.beat_the_bomb_reward_points(result.settings);
      update public.teams set score = score + reward_points where id = latest_team_id;
      update public.game_show_games set status = 'exploded', exploded_at = clock_timestamp(), winner_team_id = latest_team_id, reward_points_awarded = reward_points
      where id = result.id returning * into result;
      return result;
    end if;
  end if;

  insert into public.game_show_game_presses (game_show_game_id, game_id, team_id)
  values (result.id, result.game_id, p_team_id) on conflict (game_show_game_id, team_id) do nothing;
  if not found then raise exception 'This team has already pressed'; end if;

  active_team_count := jsonb_array_length(result.settings->'eligible_team_ids');
  select count(*) into press_count from public.game_show_game_presses where game_show_game_id = result.id;
  if press_count >= active_team_count or clock_timestamp() >= result.explode_at then
    select team_id into latest_team_id from public.game_show_game_presses
    where game_show_game_id = result.id order by pressed_at desc, id desc limit 1;
    reward_points := public.beat_the_bomb_reward_points(result.settings);
    update public.teams set score = score + reward_points where id = latest_team_id;
    update public.game_show_games set status = 'exploded', exploded_at = clock_timestamp(), winner_team_id = latest_team_id, reward_points_awarded = reward_points
    where id = result.id returning * into result;
  else
    select * into result from public.game_show_games where id = result.id;
  end if;
  return result;
end;
$$;

commit;
