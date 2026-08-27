begin;

create table public.quiz_show_games (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  show_game_key text not null check (length(btrim(show_game_key)) > 0),
  item_position integer not null check (item_position > 0),
  round_number integer not null check (round_number > 0),
  round_title text not null,
  game_type text not null check (game_type in ('beat-the-bomb')),
  title text not null default 'Beat the Bomb' check (length(btrim(title)) > 0),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quiz_id, show_game_key)
);

create table public.game_show_games (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  quiz_show_game_id uuid references public.quiz_show_games(id) on delete set null,
  show_game_key text not null check (length(btrim(show_game_key)) > 0),
  item_position integer not null check (item_position > 0),
  round_number integer not null check (round_number > 0),
  round_title text not null,
  game_type text not null check (game_type in ('beat-the-bomb')),
  title text not null check (length(btrim(title)) > 0),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  status text not null default 'ready' check (status in ('ready', 'open', 'exploded', 'cancelled')),
  started_at timestamptz,
  explode_at timestamptz,
  exploded_at timestamptz,
  winner_team_id uuid references public.teams(id) on delete set null,
  unique (game_id, show_game_key)
);

create table public.game_show_game_presses (
  id uuid primary key default gen_random_uuid(),
  game_show_game_id uuid not null references public.game_show_games(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  pressed_at timestamptz not null default clock_timestamp(),
  unique (game_show_game_id, team_id)
);

alter table public.games add column current_show_game_key text;

create index quiz_show_games_order_idx on public.quiz_show_games (quiz_id, item_position);
create index game_show_games_order_idx on public.game_show_games (game_id, item_position);
create index game_show_game_presses_order_idx on public.game_show_game_presses (game_show_game_id, pressed_at desc);

alter table public.quiz_show_games enable row level security;
alter table public.game_show_games enable row level security;
alter table public.game_show_game_presses enable row level security;

create policy "Owners manage quiz show games"
on public.quiz_show_games for all to authenticated
using (exists (select 1 from public.quizzes where quizzes.id = quiz_show_games.quiz_id and quizzes.owner_id = auth.uid()))
with check (exists (select 1 from public.quizzes where quizzes.id = quiz_show_games.quiz_id and quizzes.owner_id = auth.uid()));

create policy "Players read live show games"
on public.game_show_games for select to anon, authenticated
using (exists (select 1 from public.games where games.id = game_show_games.game_id and games.status in ('lobby', 'live', 'finished')));

create policy "Hosts manage live show games"
on public.game_show_games for all to authenticated
using (exists (
  select 1 from public.games join public.quizzes on quizzes.id = games.quiz_id
  where games.id = game_show_games.game_id and quizzes.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.games join public.quizzes on quizzes.id = games.quiz_id
  where games.id = game_show_games.game_id and quizzes.owner_id = auth.uid()
));

create policy "Participants read show game presses"
on public.game_show_game_presses for select to anon, authenticated
using (exists (select 1 from public.games where games.id = game_show_game_presses.game_id and games.status in ('live', 'finished')));

grant select, insert, update, delete on public.quiz_show_games to authenticated;
grant select on public.game_show_games, public.game_show_game_presses to anon, authenticated;
grant insert, update, delete on public.game_show_games to authenticated;

create or replace function public.save_quiz_with_show_games(
  p_quiz_id uuid,
  p_title text,
  p_status text,
  p_estimated_minutes integer,
  p_questions jsonb,
  p_content_screens jsonb default '[]'::jsonb,
  p_tiebreakers jsonb default '[]'::jsonb,
  p_show_games jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_quiz_id uuid;
begin
  if jsonb_typeof(p_show_games) <> 'array' then
    raise exception 'Show games must be a JSON array';
  end if;

  saved_quiz_id := public.save_quiz_with_bonus_snapshots(
    p_quiz_id, p_title, p_status, p_estimated_minutes,
    p_questions, p_content_screens, p_tiebreakers
  );

  delete from public.quiz_show_games where quiz_id = saved_quiz_id;

  insert into public.quiz_show_games (
    quiz_id, show_game_key, item_position, round_number, round_title, game_type, title, settings
  )
  select
    saved_quiz_id,
    item.value->>'show_game_key',
    (item.value->>'item_position')::integer,
    (item.value->>'round_number')::integer,
    item.value->>'round_title',
    item.value->>'game_type',
    coalesce(nullif(btrim(item.value->>'title'), ''), 'Beat the Bomb'),
    coalesce(item.value->'settings', '{}'::jsonb)
  from jsonb_array_elements(p_show_games) as item(value);

  return saved_quiz_id;
end;
$$;

revoke all on function public.save_quiz_with_show_games(uuid, text, text, integer, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.save_quiz_with_show_games(uuid, text, text, integer, jsonb, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.create_game_from_quiz_with_show_games(
  p_quiz_id uuid,
  p_settings jsonb default '{}'::jsonb
)
returns table (game_id uuid, game_code text, game_title text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created record;
begin
  select * into created from public.create_game_from_quiz(p_quiz_id, p_settings);

  insert into public.game_show_games (
    game_id, quiz_show_game_id, show_game_key, item_position, round_number,
    round_title, game_type, title, settings
  )
  select
    created.game_id, quiz_show_games.id, quiz_show_games.show_game_key,
    quiz_show_games.item_position, quiz_show_games.round_number, quiz_show_games.round_title,
    quiz_show_games.game_type, quiz_show_games.title, quiz_show_games.settings
  from public.quiz_show_games
  where quiz_show_games.quiz_id = p_quiz_id
  order by quiz_show_games.item_position;

  return query select created.game_id, created.game_code, created.game_title;
end;
$$;

revoke all on function public.create_game_from_quiz_with_show_games(uuid, jsonb) from public;
grant execute on function public.create_game_from_quiz_with_show_games(uuid, jsonb) to authenticated;

create or replace function public.start_beat_the_bomb(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.game_show_games%rowtype;
begin
  if not exists (
    select 1 from public.game_show_games
    join public.games on games.id = game_show_games.game_id
    join public.quizzes on quizzes.id = games.quiz_id
    where game_show_games.id = p_game_show_game_id
      and game_show_games.game_type = 'beat-the-bomb'
      and quizzes.owner_id = auth.uid()
  ) then raise exception 'Show game not found or not owned by current host'; end if;

  delete from public.game_show_game_presses where game_show_game_id = p_game_show_game_id;

  update public.game_show_games
  set status = 'open',
      started_at = clock_timestamp(),
      explode_at = clock_timestamp() + make_interval(secs => 10 + floor(random() * 21)::integer),
      exploded_at = null,
      winner_team_id = null
  where id = p_game_show_game_id
  returning * into result;

  return result;
end;
$$;

create or replace function public.press_beat_the_bomb(p_game_show_game_id uuid, p_team_id uuid)
returns public.game_show_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.game_show_games%rowtype;
  active_team_count integer;
  press_count integer;
  latest_team_id uuid;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.teams on teams.game_id = games.id and teams.id = p_team_id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type = 'beat-the-bomb'
    and game_show_games.status = 'open'
    and games.status = 'live'
  for update of game_show_games;

  if result.id is null then raise exception 'Beat the Bomb is not accepting presses'; end if;

  if clock_timestamp() >= result.explode_at then
    select team_id into latest_team_id
    from public.game_show_game_presses
    where game_show_game_id = result.id
    order by pressed_at desc, id desc limit 1;

    if latest_team_id is not null then
      update public.game_show_games
      set status = 'exploded', exploded_at = clock_timestamp(), winner_team_id = latest_team_id
      where id = result.id returning * into result;
      return result;
    end if;
  end if;

  insert into public.game_show_game_presses (game_show_game_id, game_id, team_id)
  values (result.id, result.game_id, p_team_id)
  on conflict (game_show_game_id, team_id) do nothing;

  if not found then raise exception 'This team has already pressed'; end if;

  select count(*) into active_team_count from public.teams where teams.game_id = result.game_id;
  select count(*) into press_count from public.game_show_game_presses where game_show_game_id = result.id;

  if press_count >= active_team_count or clock_timestamp() >= result.explode_at then
    select team_id into latest_team_id
    from public.game_show_game_presses
    where game_show_game_id = result.id
    order by pressed_at desc, id desc limit 1;

    update public.game_show_games
    set status = 'exploded', exploded_at = clock_timestamp(), winner_team_id = latest_team_id
    where id = result.id returning * into result;
  else
    select * into result from public.game_show_games where id = result.id;
  end if;

  return result;
end;
$$;

create or replace function public.resolve_beat_the_bomb(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.game_show_games%rowtype;
  latest_team_id uuid;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id and quizzes.owner_id = auth.uid()
  for update of game_show_games;

  if result.id is null then raise exception 'Show game not found or not owned by current host'; end if;

  if result.status = 'open' and clock_timestamp() >= result.explode_at then
    select team_id into latest_team_id from public.game_show_game_presses
    where game_show_game_id = result.id order by pressed_at desc, id desc limit 1;

    if latest_team_id is not null then
      update public.game_show_games
      set status = 'exploded', exploded_at = clock_timestamp(), winner_team_id = latest_team_id
      where id = result.id returning * into result;
    end if;
  end if;

  return result;
end;
$$;

revoke all on function public.start_beat_the_bomb(uuid), public.press_beat_the_bomb(uuid, uuid), public.resolve_beat_the_bomb(uuid) from public;
grant execute on function public.start_beat_the_bomb(uuid), public.resolve_beat_the_bomb(uuid) to authenticated;
grant execute on function public.press_beat_the_bomb(uuid, uuid) to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_show_games') then
    alter publication supabase_realtime add table public.game_show_games;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_show_game_presses') then
    alter publication supabase_realtime add table public.game_show_game_presses;
  end if;
end $$;

comment on table public.quiz_show_games is 'Reusable, ordered, non-question show modules. game_type keeps future show games extensible.';
comment on table public.game_show_games is 'Frozen live-game snapshots and runtime outcome state for show-game modules.';
comment on table public.game_show_game_presses is 'One server-timestamped Beat the Bomb press per participating team.';

commit;
