begin;

alter table public.quiz_show_games drop constraint if exists quiz_show_games_game_type_check;
alter table public.quiz_show_games add constraint quiz_show_games_game_type_check
  check (game_type in ('beat-the-bomb', 'spin-the-wheel', 'heads-or-tails', 'dodge-the-rock', 'big-balloon', 'audience-question'));

alter table public.game_show_games drop constraint if exists game_show_games_game_type_check;
alter table public.game_show_games add constraint game_show_games_game_type_check
  check (game_type in ('beat-the-bomb', 'spin-the-wheel', 'heads-or-tails', 'dodge-the-rock', 'big-balloon', 'audience-question'));

create table public.game_show_game_balloons (
  id uuid primary key default gen_random_uuid(),
  game_show_game_id uuid not null references public.game_show_games(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  size_units bigint not null default 0 check (size_units >= 0),
  status text not null default 'ready' check (status in ('ready', 'inflating', 'locked', 'popped')),
  last_inflated_at timestamptz,
  locked_at timestamptz,
  popped_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (game_show_game_id, team_id)
);

create table public.game_show_game_balloon_private (
  game_show_game_id uuid not null references public.game_show_games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  pop_at_units bigint not null check (pop_at_units between 6500000 and 10000000),
  primary key (game_show_game_id, team_id)
);

create index game_show_game_balloons_size_idx
  on public.game_show_game_balloons (game_show_game_id, status, size_units desc, locked_at desc);

alter table public.game_show_game_balloons enable row level security;
alter table public.game_show_game_balloon_private enable row level security;

create policy "Participants read balloon progress"
on public.game_show_game_balloons for select to anon, authenticated
using (exists (
  select 1 from public.games
  where games.id = game_show_game_balloons.game_id and games.status in ('live', 'finished')
));

create policy "Hosts read balloon thresholds"
on public.game_show_game_balloon_private for select to authenticated
using (exists (
  select 1 from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = game_show_game_balloon_private.game_show_game_id
    and quizzes.owner_id = auth.uid()
));

grant select on public.game_show_game_balloons to anon, authenticated;
grant select on public.game_show_game_balloon_private to authenticated;

create or replace function public.finish_big_balloon_if_ready(p_game_show_game_id uuid, p_force boolean default false)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  winner_id uuid;
  reward_points integer;
begin
  select * into result from public.game_show_games where id = p_game_show_game_id for update;
  if result.id is null or result.game_type <> 'big-balloon' or result.status <> 'open' then return result; end if;

  if p_force then
    update public.game_show_game_balloons
    set status = 'locked', locked_at = clock_timestamp(), last_inflated_at = null
    where game_show_game_id = result.id and status in ('ready', 'inflating');
  end if;

  if exists (select 1 from public.game_show_game_balloons where game_show_game_id = result.id and status in ('ready', 'inflating')) then
    return result;
  end if;

  select team_id into winner_id
  from public.game_show_game_balloons
  where game_show_game_id = result.id and status = 'locked'
  order by size_units desc, locked_at desc, team_id
  limit 1;

  -- The final surviving balloon is protected from a no-winner finish.
  if winner_id is null then
    select team_id into winner_id from public.game_show_game_balloons
    where game_show_game_id = result.id order by popped_at desc, team_id limit 1;
    update public.game_show_game_balloons set status = 'locked', popped_at = null, locked_at = clock_timestamp()
    where game_show_game_id = result.id and team_id = winner_id;
  end if;
  if winner_id is null then return result; end if;

  reward_points := public.beat_the_bomb_reward_points(result.settings);
  update public.teams set score = score + reward_points where id = winner_id;
  update public.game_show_games
  set status = 'exploded', exploded_at = clock_timestamp(), explode_at = clock_timestamp(),
      winner_team_id = winner_id, reward_points_awarded = reward_points
  where id = result.id returning * into result;
  return result;
end;
$$;

revoke all on function public.finish_big_balloon_if_ready(uuid, boolean) from public;

create or replace function public.start_big_balloon(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  eligible jsonb;
begin
  select game_show_games.* into result from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id and game_show_games.game_type = 'big-balloon'
    and game_show_games.status = 'ready' and quizzes.owner_id = auth.uid()
  for update of game_show_games;
  if result.id is null then raise exception 'Big Balloon not found, already started, or not owned by current host'; end if;

  eligible := result.settings->'eligible_team_ids';
  if jsonb_typeof(eligible) <> 'array' or jsonb_array_length(eligible) = 0 then
    select jsonb_agg(teams.id order by teams.created_at) into eligible
    from public.teams where teams.game_id = result.game_id
      and teams.last_seen_at > clock_timestamp() - interval '5 minutes';
  end if;
  if eligible is null or jsonb_array_length(eligible) = 0 then raise exception 'Big Balloon needs at least one active team'; end if;

  delete from public.game_show_game_balloons where game_show_game_id = result.id;
  delete from public.game_show_game_balloon_private where game_show_game_id = result.id;
  insert into public.game_show_game_balloons (game_show_game_id, game_id, team_id)
  select result.id, result.game_id, value::uuid from jsonb_array_elements_text(eligible) value;
  insert into public.game_show_game_balloon_private (game_show_game_id, team_id, pop_at_units)
  select result.id, value::uuid, 6500000 + floor(random() * 3500001)::bigint
  from jsonb_array_elements_text(eligible) value;

  update public.game_show_games
  set status = 'open', started_at = clock_timestamp(), explode_at = clock_timestamp() + interval '18 seconds',
      exploded_at = null, winner_team_id = null, reward_points_awarded = 0,
      settings = settings || jsonb_build_object('eligible_team_ids', eligible)
  where id = result.id returning * into result;
  return result;
end;
$$;

create or replace function public.pulse_big_balloon(p_game_show_game_id uuid, p_request_id uuid, p_request_token uuid)
returns public.game_show_game_balloons
language plpgsql security definer set search_path = public
as $$
declare
  request_row public.team_join_requests%rowtype;
  show_game public.game_show_games%rowtype;
  balloon public.game_show_game_balloons%rowtype;
  threshold bigint;
  elapsed_units bigint;
  next_size bigint;
  other_intact integer;
begin
  select * into request_row from public.team_join_requests
  where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;
  select * into show_game from public.game_show_games
  where id = p_game_show_game_id and game_id = request_row.game_id and game_type = 'big-balloon'
  for update;
  if show_game.id is null or show_game.status <> 'open' or clock_timestamp() >= show_game.explode_at then raise exception 'BALLOON_CLOSED'; end if;
  select * into balloon from public.game_show_game_balloons
  where game_show_game_id = show_game.id and team_id = request_row.team_id for update;
  if balloon.id is null or balloon.status in ('locked', 'popped') then raise exception 'BALLOON_LOCKED'; end if;
  select pop_at_units into threshold from public.game_show_game_balloon_private
  where game_show_game_id = show_game.id and team_id = request_row.team_id;

  if balloon.status = 'ready' then
    update public.game_show_game_balloons set status = 'inflating', size_units = 25000, last_inflated_at = clock_timestamp()
    where id = balloon.id returning * into balloon;
    return balloon;
  end if;

  elapsed_units := greatest(1000, least(350000, floor(extract(epoch from (clock_timestamp() - balloon.last_inflated_at)) * 1000000)::bigint));
  next_size := balloon.size_units + elapsed_units;
  if next_size >= threshold then
    select count(*) into other_intact from public.game_show_game_balloons
    where game_show_game_id = show_game.id and team_id <> balloon.team_id and status <> 'popped';
    if other_intact = 0 then
      update public.game_show_game_balloons set size_units = threshold - 1, status = 'locked', locked_at = clock_timestamp(), last_inflated_at = null
      where id = balloon.id returning * into balloon;
    else
      update public.game_show_game_balloons set size_units = threshold, status = 'popped', popped_at = clock_timestamp(), last_inflated_at = null
      where id = balloon.id returning * into balloon;
    end if;
  else
    update public.game_show_game_balloons set size_units = next_size, last_inflated_at = clock_timestamp()
    where id = balloon.id returning * into balloon;
  end if;
  perform public.finish_big_balloon_if_ready(show_game.id, false);
  return balloon;
end;
$$;

create or replace function public.lock_big_balloon(p_game_show_game_id uuid, p_request_id uuid, p_request_token uuid)
returns public.game_show_game_balloons
language plpgsql security definer set search_path = public
as $$
declare
  request_row public.team_join_requests%rowtype;
  show_game public.game_show_games%rowtype;
  balloon public.game_show_game_balloons%rowtype;
  threshold bigint;
  next_size bigint;
  other_intact integer;
begin
  select * into request_row from public.team_join_requests where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;
  select * into show_game from public.game_show_games where id = p_game_show_game_id and game_id = request_row.game_id and game_type = 'big-balloon' for update;
  if show_game.id is null or show_game.status <> 'open' then raise exception 'BALLOON_CLOSED'; end if;
  select * into balloon from public.game_show_game_balloons where game_show_game_id = show_game.id and team_id = request_row.team_id for update;
  if balloon.id is null then raise exception 'BALLOON_NOT_FOUND'; end if;
  if balloon.status in ('locked', 'popped') then return balloon; end if;
  select pop_at_units into threshold from public.game_show_game_balloon_private where game_show_game_id = show_game.id and team_id = request_row.team_id;
  next_size := balloon.size_units + case when balloon.last_inflated_at is null then 0 else greatest(0, least(350000, floor(extract(epoch from (clock_timestamp() - balloon.last_inflated_at)) * 1000000)::bigint)) end;
  if next_size >= threshold then
    select count(*) into other_intact from public.game_show_game_balloons where game_show_game_id = show_game.id and team_id <> balloon.team_id and status <> 'popped';
    if other_intact = 0 then
      update public.game_show_game_balloons set size_units = threshold - 1, status = 'locked', locked_at = clock_timestamp(), last_inflated_at = null where id = balloon.id returning * into balloon;
    else
      update public.game_show_game_balloons set size_units = threshold, status = 'popped', popped_at = clock_timestamp(), last_inflated_at = null where id = balloon.id returning * into balloon;
    end if;
  else
    update public.game_show_game_balloons set size_units = next_size, status = 'locked', locked_at = clock_timestamp(), last_inflated_at = null where id = balloon.id returning * into balloon;
  end if;
  perform public.finish_big_balloon_if_ready(show_game.id, false);
  return balloon;
end;
$$;

create or replace function public.resolve_big_balloon(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare result public.game_show_games%rowtype;
begin
  select game_show_games.* into result from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id and game_show_games.game_type = 'big-balloon' and quizzes.owner_id = auth.uid();
  if result.id is null then raise exception 'Big Balloon not found or not owned by current host'; end if;
  return public.finish_big_balloon_if_ready(result.id, clock_timestamp() >= result.explode_at);
end;
$$;

revoke all on function public.start_big_balloon(uuid), public.pulse_big_balloon(uuid, uuid, uuid), public.lock_big_balloon(uuid, uuid, uuid), public.resolve_big_balloon(uuid) from public;
grant execute on function public.start_big_balloon(uuid), public.resolve_big_balloon(uuid) to authenticated;
grant execute on function public.pulse_big_balloon(uuid, uuid, uuid), public.lock_big_balloon(uuid, uuid, uuid) to anon, authenticated;

create or replace function public.prepare_tie_show_game(
  p_resolution_id uuid, p_game_type text, p_prompt text default null, p_correct_number numeric default null
)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare resolution public.game_tie_resolutions%rowtype; result public.game_show_games%rowtype;
  item_position_value integer; round_number_value integer; key_value text;
begin
  select resolutions.* into resolution from public.game_tie_resolutions resolutions
  join public.games on games.id = resolutions.game_id join public.quizzes on quizzes.id = games.quiz_id
  where resolutions.id = p_resolution_id and resolutions.status = 'pending' and quizzes.owner_id = auth.uid() for update of resolutions;
  if resolution.id is null then raise exception 'Pending tie not found or not owned by current host'; end if;
  if cardinality(resolution.team_ids) <> 2 then raise exception 'Show games currently settle two-team ties'; end if;
  if p_game_type not in ('spin-the-wheel', 'beat-the-bomb', 'heads-or-tails', 'dodge-the-rock', 'big-balloon', 'audience-question') then raise exception 'Unsupported show game'; end if;
  if p_game_type = 'audience-question' and (btrim(coalesce(p_prompt, '')) = '' or p_correct_number is null) then raise exception 'Audience Question needs a prompt and correct number'; end if;
  select coalesce(max(item_position), 0) + 1, coalesce(max(round_number), 1) into item_position_value, round_number_value from public.game_show_games where game_id = resolution.game_id;
  key_value := 'tie-game-' || gen_random_uuid()::text;
  insert into public.game_show_games (game_id, quiz_show_game_id, show_game_key, item_position, round_number, round_title, game_type, title, settings)
  values (resolution.game_id, null, key_value, item_position_value, round_number_value, 'Final Tiebreak', p_game_type,
    case p_game_type when 'spin-the-wheel' then 'Spin the Wheel' when 'beat-the-bomb' then 'Beat the Bomb' when 'heads-or-tails' then 'Heads or Tails' when 'dodge-the-rock' then 'Dodge the Rock' when 'big-balloon' then 'Big Balloon' else 'Audience Question' end,
    jsonb_build_object('tie_resolution_id', resolution.id, 'eligible_team_ids', to_jsonb(resolution.team_ids), 'reward_type', 'custom', 'reward_points', 0,
      'reward_description', 'Winner takes the higher placement. Scores will not change.', 'winner_message', 'You won the tiebreak game!',
      'audience_question_mode', case when p_game_type = 'audience-question' then 'closest-number' else null end,
      'prompt', case when p_game_type = 'audience-question' then btrim(p_prompt) else null end, 'allow_multiple_winners', false)) returning * into result;
  if p_game_type = 'audience-question' then insert into public.game_show_game_audience_private (game_show_game_id, correct_number) values (result.id, p_correct_number); end if;
  update public.games set status = 'live', current_screen = 'show-game', answer_phase = 'closed', current_show_game_key = result.show_game_key, current_tiebreaker_attempt_id = null where id = resolution.game_id;
  return result;
end;
$$;

revoke all on function public.prepare_tie_show_game(uuid, text, text, numeric) from public;
grant execute on function public.prepare_tie_show_game(uuid, text, text, numeric) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_show_game_balloons'
  ) then alter publication supabase_realtime add table public.game_show_game_balloons; end if;
end $$;

comment on table public.game_show_game_balloons is 'Public server-authoritative Big Balloon progress. Hidden pop thresholds live in the private companion table.';

commit;
