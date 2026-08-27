begin;

alter table public.quiz_show_games drop constraint if exists quiz_show_games_game_type_check;
alter table public.quiz_show_games add constraint quiz_show_games_game_type_check
  check (game_type in ('beat-the-bomb', 'spin-the-wheel', 'heads-or-tails', 'dodge-the-rock', 'audience-question'));

alter table public.game_show_games drop constraint if exists game_show_games_game_type_check;
alter table public.game_show_games add constraint game_show_games_game_type_check
  check (game_type in ('beat-the-bomb', 'spin-the-wheel', 'heads-or-tails', 'dodge-the-rock', 'audience-question'));

create table public.game_show_game_audience_private (
  game_show_game_id uuid primary key references public.game_show_games(id) on delete cascade,
  correct_number numeric null
);

create table public.game_show_game_responses (
  id uuid primary key default gen_random_uuid(),
  game_show_game_id uuid not null references public.game_show_games(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  response_text text not null check (length(btrim(response_text)) between 1 and 1000),
  numeric_response numeric null,
  distance_from_correct numeric null check (distance_from_correct is null or distance_from_correct >= 0),
  is_winner boolean not null default false,
  submitted_at timestamptz not null default clock_timestamp(),
  unique (game_show_game_id, team_id)
);

create index game_show_game_responses_game_idx on public.game_show_game_responses (game_show_game_id, submitted_at);

alter table public.game_show_game_audience_private enable row level security;
alter table public.game_show_game_responses enable row level security;

create policy "Hosts manage private audience question answers"
on public.game_show_game_audience_private for all to authenticated
using (exists (
  select 1 from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = game_show_game_audience_private.game_show_game_id
    and quizzes.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = game_show_game_audience_private.game_show_game_id
    and quizzes.owner_id = auth.uid()
));

create policy "Hosts read audience question responses"
on public.game_show_game_responses for select to authenticated
using (exists (
  select 1 from public.games
  join public.quizzes on quizzes.id = games.quiz_id
  where games.id = game_show_game_responses.game_id and quizzes.owner_id = auth.uid()
));

grant select, insert, update, delete on public.game_show_game_audience_private to authenticated;
grant select on public.game_show_game_responses to authenticated;

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
    quiz_show_games.game_type, quiz_show_games.title,
    case when quiz_show_games.game_type = 'audience-question'
      then quiz_show_games.settings - 'correct_number'
      else quiz_show_games.settings end
  from public.quiz_show_games
  where quiz_show_games.quiz_id = p_quiz_id
  order by quiz_show_games.item_position;

  insert into public.game_show_game_audience_private (game_show_game_id, correct_number)
  select game_show_games.id,
    case when quiz_show_games.settings->>'audience_question_mode' = 'closest-number'
      then (quiz_show_games.settings->>'correct_number')::numeric else null end
  from public.game_show_games
  join public.quiz_show_games on quiz_show_games.id = game_show_games.quiz_show_game_id
  where game_show_games.game_id = created.game_id and game_show_games.game_type = 'audience-question';

  return query select created.game_id, created.game_code, created.game_title;
end;
$$;

create or replace function public.start_audience_question(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare result public.game_show_games%rowtype; eligible jsonb;
begin
  select jsonb_agg(teams.id order by teams.created_at) into eligible
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  join public.teams on teams.game_id = games.id and teams.last_seen_at > clock_timestamp() - interval '5 minutes'
  where game_show_games.id = p_game_show_game_id and game_show_games.game_type = 'audience-question'
    and game_show_games.status = 'ready' and quizzes.owner_id = auth.uid();
  if eligible is null or jsonb_array_length(eligible) = 0 then raise exception 'This game needs at least one active team'; end if;
  update public.game_show_games set status = 'open', started_at = clock_timestamp(), explode_at = null,
    winner_team_id = null, reward_points_awarded = 0,
    settings = settings || jsonb_build_object('eligible_team_ids', eligible, 'winner_team_ids', '[]'::jsonb)
  where id = p_game_show_game_id returning * into result;
  if result.id is null then raise exception 'Show game not found, already started, or not owned by current host'; end if;
  return result;
end;
$$;

create or replace function public.submit_audience_question_response(
  p_game_show_game_id uuid, p_request_id uuid, p_request_token uuid, p_response text
)
returns public.game_show_game_responses
language plpgsql security definer set search_path = public
as $$
declare request_row public.team_join_requests%rowtype; show_game public.game_show_games%rowtype;
  result public.game_show_game_responses%rowtype; parsed_number numeric;
begin
  select * into request_row from public.team_join_requests
  where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;
  select * into show_game from public.game_show_games where id = p_game_show_game_id and game_id = request_row.game_id for update;
  if show_game.id is null or show_game.game_type <> 'audience-question' or show_game.status <> 'open' then raise exception 'RESPONSES_CLOSED'; end if;
  if not (show_game.settings->'eligible_team_ids' ? request_row.team_id::text) then raise exception 'TEAM_NOT_ELIGIBLE'; end if;
  if length(btrim(p_response)) not between 1 and 1000 then raise exception 'RESPONSE_INVALID'; end if;
  if show_game.settings->>'audience_question_mode' = 'closest-number' then
    begin parsed_number := btrim(p_response)::numeric; exception when invalid_text_representation then raise exception 'NUMBER_REQUIRED'; end;
  end if;
  insert into public.game_show_game_responses (game_show_game_id, game_id, team_id, response_text, numeric_response)
  values (show_game.id, show_game.game_id, request_row.team_id, btrim(p_response), parsed_number)
  returning * into result;
  return result;
end;
$$;

create or replace function public.get_own_audience_question_response(
  p_game_show_game_id uuid, p_request_id uuid, p_request_token uuid
)
returns public.game_show_game_responses
language plpgsql security definer set search_path = public stable
as $$
declare request_row public.team_join_requests%rowtype; result public.game_show_game_responses%rowtype;
begin
  select * into request_row from public.team_join_requests where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;
  select * into result from public.game_show_game_responses
  where game_show_game_id = p_game_show_game_id and team_id = request_row.team_id;
  return result;
end;
$$;

create or replace function public.resolve_audience_question(p_game_show_game_id uuid, p_winner_team_ids uuid[] default null)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare result public.game_show_games%rowtype; winners uuid[]; response_count integer; reward_points integer;
  correct_value numeric; minimum_distance numeric; allows_many boolean;
begin
  select game_show_games.* into result from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id and game_show_games.game_type = 'audience-question'
    and quizzes.owner_id = auth.uid() for update of game_show_games;
  if result.id is null then raise exception 'Show game not found or not owned by current host'; end if;
  if result.status <> 'open' then return result; end if;
  select count(*) into response_count from public.game_show_game_responses where game_show_game_id = result.id;
  if response_count = 0 then raise exception 'Choose after at least one team responds'; end if;

  if result.settings->>'audience_question_mode' = 'closest-number' then
    select correct_number into correct_value from public.game_show_game_audience_private where game_show_game_id = result.id;
    if correct_value is null then raise exception 'Closest Guess needs a correct number'; end if;
    update public.game_show_game_responses set distance_from_correct = abs(numeric_response - correct_value)
    where game_show_game_id = result.id;
    select min(distance_from_correct) into minimum_distance from public.game_show_game_responses where game_show_game_id = result.id;
    select array_agg(team_id order by submitted_at) into winners from public.game_show_game_responses
      where game_show_game_id = result.id and distance_from_correct = minimum_distance;
  else
    winners := coalesce(p_winner_team_ids, '{}'::uuid[]);
    if cardinality(winners) = 0 then raise exception 'Choose at least one favourite response'; end if;
    allows_many := coalesce((result.settings->>'allow_multiple_winners')::boolean, false);
    if cardinality(winners) > 1 and not allows_many then raise exception 'This game allows one winner'; end if;
    if exists (select 1 from unnest(winners) id where not exists (
      select 1 from public.game_show_game_responses r where r.game_show_game_id = result.id and r.team_id = id
    )) then raise exception 'Every winner must have submitted a response'; end if;
  end if;

  update public.game_show_game_responses set is_winner = team_id = any(winners) where game_show_game_id = result.id;
  reward_points := public.beat_the_bomb_reward_points(result.settings);
  if reward_points > 0 then update public.teams set score = score + reward_points where id = any(winners); end if;
  update public.game_show_games set status = 'exploded', exploded_at = clock_timestamp(), explode_at = clock_timestamp(),
    winner_team_id = winners[1], reward_points_awarded = reward_points * cardinality(winners),
    settings = settings || jsonb_build_object('winner_team_ids', to_jsonb(winners), 'correct_number', correct_value)
  where id = result.id returning * into result;
  return result;
end;
$$;

revoke all on function public.start_audience_question(uuid), public.submit_audience_question_response(uuid, uuid, uuid, text), public.get_own_audience_question_response(uuid, uuid, uuid), public.resolve_audience_question(uuid, uuid[]) from public;
grant execute on function public.start_audience_question(uuid), public.resolve_audience_question(uuid, uuid[]) to authenticated;
grant execute on function public.submit_audience_question_response(uuid, uuid, uuid, text), public.get_own_audience_question_response(uuid, uuid, uuid) to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_show_game_responses')
  then alter publication supabase_realtime add table public.game_show_game_responses; end if;
end $$;

comment on table public.game_show_game_responses is 'Locked player responses and host-selected outcomes for Audience Question show games.';
comment on table public.game_show_game_audience_private is 'Host-only correct numeric values for Closest Guess games; prevents pre-result answer leakage.';

commit;
