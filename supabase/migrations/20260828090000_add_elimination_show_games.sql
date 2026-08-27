begin;

alter table public.quiz_show_games drop constraint if exists quiz_show_games_game_type_check;
alter table public.quiz_show_games add constraint quiz_show_games_game_type_check
  check (game_type in ('beat-the-bomb', 'spin-the-wheel', 'heads-or-tails', 'dodge-the-rock'));

alter table public.game_show_games drop constraint if exists game_show_games_game_type_check;
alter table public.game_show_games add constraint game_show_games_game_type_check
  check (game_type in ('beat-the-bomb', 'spin-the-wheel', 'heads-or-tails', 'dodge-the-rock'));

create table public.game_show_game_choices (
  id uuid primary key default gen_random_uuid(),
  game_show_game_id uuid not null references public.game_show_games(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  choice text not null check (choice in ('heads', 'tails', '0', '1', '2')),
  submitted_at timestamptz not null default clock_timestamp(),
  unique (game_show_game_id, round_number, team_id)
);

create index game_show_game_choices_round_idx
  on public.game_show_game_choices (game_show_game_id, round_number, submitted_at);

alter table public.game_show_game_choices enable row level security;
create policy "Participants read elimination game choices"
on public.game_show_game_choices for select to anon, authenticated
using (exists (
  select 1 from public.games
  where games.id = game_show_game_choices.game_id and games.status in ('live', 'finished')
));
grant select on public.game_show_game_choices to anon, authenticated;

create or replace function public.start_elimination_show_game(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  eligible_team_ids jsonb;
  initial_positions jsonb;
  only_team_id uuid;
  reward_points integer;
begin
  select jsonb_agg(teams.id order by teams.created_at),
         jsonb_object_agg(teams.id::text, 1)
  into eligible_team_ids, initial_positions
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  join public.teams on teams.game_id = games.id
    and teams.last_seen_at > clock_timestamp() - interval '5 minutes'
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type in ('heads-or-tails', 'dodge-the-rock')
    and game_show_games.status = 'ready'
    and quizzes.owner_id = auth.uid();

  if eligible_team_ids is null or jsonb_array_length(eligible_team_ids) = 0 then
    raise exception 'This game needs at least one active team';
  end if;

  update public.game_show_games
  set status = 'open',
      started_at = clock_timestamp(),
      explode_at = clock_timestamp() + interval '5 seconds',
      exploded_at = null,
      winner_team_id = null,
      reward_points_awarded = 0,
      settings = settings || jsonb_build_object(
        'eligible_team_ids', eligible_team_ids,
        'alive_team_ids', eligible_team_ids,
        'eliminated_team_ids', '[]'::jsonb,
        'round_eliminated_team_ids', '[]'::jsonb,
        'round_number', 1,
        'round_phase', 'choosing',
        'round_outcome', null,
        'positions', coalesce(initial_positions, '{}'::jsonb)
      )
  where id = p_game_show_game_id
  returning * into result;

  if result.id is null then raise exception 'Show game not found, already started, or not owned by current host'; end if;

  if jsonb_array_length(eligible_team_ids) = 1 then
    only_team_id := (eligible_team_ids->>0)::uuid;
    reward_points := public.beat_the_bomb_reward_points(result.settings);
    update public.teams set score = score + reward_points where id = only_team_id;
    update public.game_show_games
    set status = 'exploded', exploded_at = clock_timestamp(), explode_at = clock_timestamp(),
        winner_team_id = only_team_id, reward_points_awarded = reward_points
    where id = result.id returning * into result;
  end if;

  return result;
end;
$$;

create or replace function public.submit_elimination_show_game_choice(
  p_game_show_game_id uuid,
  p_request_id uuid,
  p_request_token uuid,
  p_choice text
)
returns public.game_show_games
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.team_join_requests%rowtype;
  result public.game_show_games%rowtype;
  current_round integer;
begin
  select * into request_row from public.team_join_requests
  where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;

  select * into result from public.game_show_games
  where id = p_game_show_game_id and game_id = request_row.game_id
  for update;

  if result.id is null or result.status <> 'open' or result.settings->>'round_phase' <> 'choosing'
    or clock_timestamp() >= result.explode_at then
    raise exception 'CHOICES_CLOSED';
  end if;
  if not (result.settings->'alive_team_ids' ? request_row.team_id::text) then raise exception 'TEAM_ELIMINATED'; end if;
  if result.game_type = 'heads-or-tails' and p_choice not in ('heads', 'tails') then raise exception 'CHOICE_INVALID'; end if;
  if result.game_type = 'dodge-the-rock' and p_choice not in ('0', '1', '2') then raise exception 'CHOICE_INVALID'; end if;

  current_round := (result.settings->>'round_number')::integer;
  insert into public.game_show_game_choices (game_show_game_id, game_id, team_id, round_number, choice)
  values (result.id, result.game_id, request_row.team_id, current_round, p_choice)
  on conflict (game_show_game_id, round_number, team_id)
  do update set choice = excluded.choice, submitted_at = clock_timestamp();

  if result.game_type = 'dodge-the-rock' then
    update public.game_show_games
    set settings = jsonb_set(
      settings,
      '{positions}',
      coalesce(settings->'positions', '{}'::jsonb) || jsonb_build_object(request_row.team_id::text, p_choice::integer),
      true
    )
    where id = result.id returning * into result;
  end if;

  return result;
end;
$$;

create or replace function public.resolve_elimination_show_game(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  alive_ids uuid[];
  survivor_ids uuid[] := '{}'::uuid[];
  eliminated_ids uuid[] := '{}'::uuid[];
  current_round integer;
  outcome text;
  rock_lane integer;
  reward_points integer;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type in ('heads-or-tails', 'dodge-the-rock')
    and quizzes.owner_id = auth.uid()
  for update of game_show_games;

  if result.id is null then raise exception 'Show game not found or not owned by current host'; end if;
  if result.status <> 'open' or result.settings->>'round_phase' <> 'choosing' then return result; end if;
  if clock_timestamp() < result.explode_at then return result; end if;

  select coalesce(array_agg(value::uuid), '{}'::uuid[]) into alive_ids
  from jsonb_array_elements_text(result.settings->'alive_team_ids') as value;
  current_round := (result.settings->>'round_number')::integer;

  if result.game_type = 'heads-or-tails' then
    outcome := case when random() < 0.5 then 'heads' else 'tails' end;
    select coalesce(array_agg(choices.team_id), '{}'::uuid[]) into survivor_ids
    from public.game_show_game_choices choices
    where choices.game_show_game_id = result.id
      and choices.round_number = current_round
      and choices.team_id = any(alive_ids)
      and choices.choice = outcome;

    -- A fully empty result is a void flip: nobody is knocked out and the game continues.
    if cardinality(survivor_ids) = 0 then survivor_ids := alive_ids; end if;
  else
    select lane into rock_lane
    from generate_series(0, 2) as lane
    where (
      select count(*) from unnest(alive_ids) as team_id
      where coalesce((result.settings->'positions'->>team_id::text)::integer, 1) = lane
    ) < cardinality(alive_ids)
    order by random()
    limit 1;
    outcome := rock_lane::text;
    select coalesce(array_agg(team_id), '{}'::uuid[]) into survivor_ids
    from unnest(alive_ids) as team_id
    where coalesce((result.settings->'positions'->>team_id::text)::integer, 1) <> rock_lane;
  end if;

  select coalesce(array_agg(team_id), '{}'::uuid[]) into eliminated_ids
  from unnest(alive_ids) as team_id where not (team_id = any(survivor_ids));

  update public.game_show_games
  set settings = settings || jsonb_build_object(
        'alive_team_ids', to_jsonb(survivor_ids),
        'eliminated_team_ids', coalesce(settings->'eliminated_team_ids', '[]'::jsonb) || to_jsonb(eliminated_ids),
        'round_eliminated_team_ids', to_jsonb(eliminated_ids),
        'round_phase', 'reveal',
        'round_outcome', outcome
      ),
      explode_at = clock_timestamp() + interval '4 seconds'
  where id = result.id returning * into result;

  if cardinality(survivor_ids) = 1 then
    reward_points := public.beat_the_bomb_reward_points(result.settings);
    update public.teams set score = score + reward_points where id = survivor_ids[1];
    update public.game_show_games
    set status = 'exploded', exploded_at = clock_timestamp(), winner_team_id = survivor_ids[1],
        reward_points_awarded = reward_points
    where id = result.id returning * into result;
  end if;

  return result;
end;
$$;

create or replace function public.advance_elimination_show_game(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type in ('heads-or-tails', 'dodge-the-rock')
    and quizzes.owner_id = auth.uid()
  for update of game_show_games;

  if result.id is null then raise exception 'Show game not found or not owned by current host'; end if;
  if result.status <> 'open' or result.settings->>'round_phase' <> 'reveal' then return result; end if;
  if clock_timestamp() < result.explode_at then return result; end if;

  update public.game_show_games
  set settings = settings || jsonb_build_object(
        'round_number', (settings->>'round_number')::integer + 1,
        'round_phase', 'choosing',
        'round_outcome', null,
        'round_eliminated_team_ids', '[]'::jsonb
      ),
      explode_at = clock_timestamp() + interval '5 seconds'
  where id = result.id returning * into result;
  return result;
end;
$$;

revoke all on function public.start_elimination_show_game(uuid), public.submit_elimination_show_game_choice(uuid, uuid, uuid, text), public.resolve_elimination_show_game(uuid), public.advance_elimination_show_game(uuid) from public;
grant execute on function public.start_elimination_show_game(uuid), public.resolve_elimination_show_game(uuid), public.advance_elimination_show_game(uuid) to authenticated;
grant execute on function public.submit_elimination_show_game_choice(uuid, uuid, uuid, text) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_show_game_choices'
  ) then alter publication supabase_realtime add table public.game_show_game_choices; end if;
end $$;

comment on table public.game_show_game_choices is 'Per-round player choices for multi-step elimination show games.';
comment on function public.resolve_elimination_show_game(uuid) is 'Resolves one server-authoritative elimination round without ever eliminating every remaining Dodge the Rock team.';

commit;
