begin;

alter table public.quiz_show_games drop constraint if exists quiz_show_games_game_type_check;
alter table public.quiz_show_games add constraint quiz_show_games_game_type_check
  check (game_type in ('beat-the-bomb', 'spin-the-wheel', 'heads-or-tails', 'dodge-the-rock', 'big-balloon', 'steal-the-treasure', 'audience-question', 'in-show-tiebreaker'));

alter table public.game_show_games drop constraint if exists game_show_games_game_type_check;
alter table public.game_show_games add constraint game_show_games_game_type_check
  check (game_type in ('beat-the-bomb', 'spin-the-wheel', 'heads-or-tails', 'dodge-the-rock', 'big-balloon', 'steal-the-treasure', 'audience-question', 'in-show-tiebreaker'));

create table public.game_show_game_treasure (
  id uuid primary key default gen_random_uuid(),
  game_show_game_id uuid not null references public.game_show_games(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  banked_units bigint not null default 0 check (banked_units >= 0),
  current_units bigint not null default 0 check (current_units >= 0),
  is_stealing boolean not null default false,
  stealing_started_at timestamptz,
  caught_count integer not null default 0 check (caught_count >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  unique (game_show_game_id, team_id)
);

alter table public.game_show_game_treasure enable row level security;
create policy "Participants read treasure progress"
on public.game_show_game_treasure for select to anon, authenticated
using (exists (select 1 from public.games where games.id = game_show_game_treasure.game_id and games.status in ('live', 'finished')));
grant select on public.game_show_game_treasure to anon, authenticated;

create or replace function public.start_steal_the_treasure(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path = public
as $$
declare result public.game_show_games%rowtype; eligible jsonb;
begin
  select game_show_games.* into result from public.game_show_games
  join public.games on games.id=game_show_games.game_id join public.quizzes on quizzes.id=games.quiz_id
  where game_show_games.id=p_game_show_game_id and game_show_games.game_type='steal-the-treasure'
    and game_show_games.status='ready' and quizzes.owner_id=auth.uid() for update of game_show_games;
  if result.id is null then raise exception 'Steal the Treasure not found, already started, or not owned by current host'; end if;
  eligible:=result.settings->'eligible_team_ids';
  if jsonb_typeof(eligible)<>'array' or jsonb_array_length(eligible)=0 then
    select jsonb_agg(teams.id order by teams.created_at) into eligible from public.teams
    where teams.game_id=result.game_id and teams.last_seen_at>clock_timestamp()-interval '5 minutes';
  end if;
  if eligible is null or jsonb_array_length(eligible)=0 then raise exception 'Steal the Treasure needs at least one active team'; end if;
  delete from public.game_show_game_treasure where game_show_game_id=result.id;
  insert into public.game_show_game_treasure(game_show_game_id,game_id,team_id)
    select result.id,result.game_id,value::uuid from jsonb_array_elements_text(eligible) as value;
  update public.game_show_games set status='open',started_at=clock_timestamp(),explode_at=clock_timestamp()+interval '30 seconds',
    exploded_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible,'guard_awake',false,'guard_next_at',clock_timestamp()+make_interval(secs=>3+random()*3))
  where id=result.id returning * into result;
  return result;
end; $$;

create or replace function public.set_steal_the_treasure_holding(
  p_game_show_game_id uuid,p_request_id uuid,p_request_token uuid,p_holding boolean
) returns public.game_show_game_treasure language plpgsql security definer set search_path=public
as $$
declare request_row public.team_join_requests%rowtype; show_game public.game_show_games%rowtype;
  result public.game_show_game_treasure%rowtype; guard_awake boolean; earned bigint;
begin
  select * into request_row from public.team_join_requests where id=p_request_id and request_token=p_request_token and status='approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;
  select * into show_game from public.game_show_games where id=p_game_show_game_id and game_id=request_row.game_id and game_type='steal-the-treasure' for update;
  if show_game.id is null or show_game.status<>'open' or clock_timestamp()>=show_game.explode_at then raise exception 'TREASURE_CLOSED'; end if;
  select * into result from public.game_show_game_treasure where game_show_game_id=show_game.id and team_id=request_row.team_id for update;
  if result.id is null then raise exception 'TEAM_NOT_ELIGIBLE'; end if;
  guard_awake:=coalesce((show_game.settings->>'guard_awake')::boolean,false);
  if p_holding then
    if guard_awake then raise exception 'GUARD_AWAKE'; end if;
    if not result.is_stealing then update public.game_show_game_treasure set is_stealing=true,stealing_started_at=clock_timestamp(),current_units=0,updated_at=clock_timestamp() where id=result.id returning * into result; end if;
  else
    if result.is_stealing and not guard_awake then
      earned:=greatest(1,floor(extract(epoch from (clock_timestamp()-result.stealing_started_at))*1000)::bigint);
      update public.game_show_game_treasure set banked_units=banked_units+earned,current_units=0,is_stealing=false,stealing_started_at=null,updated_at=clock_timestamp() where id=result.id returning * into result;
    else
      update public.game_show_game_treasure set current_units=0,is_stealing=false,stealing_started_at=null,updated_at=clock_timestamp() where id=result.id returning * into result;
    end if;
  end if;
  return result;
end; $$;

create or replace function public.advance_steal_the_treasure(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public
as $$
declare result public.game_show_games%rowtype; awake boolean; next_at timestamptz;
begin
  select game_show_games.* into result from public.game_show_games join public.games on games.id=game_show_games.game_id
  join public.quizzes on quizzes.id=games.quiz_id where game_show_games.id=p_game_show_game_id
    and game_show_games.game_type='steal-the-treasure' and quizzes.owner_id=auth.uid() for update of game_show_games;
  if result.id is null then raise exception 'Steal the Treasure not found or not owned by current host'; end if;
  if result.status<>'open' then return result; end if;
  if clock_timestamp()>=result.explode_at then return result; end if;
  next_at:=(result.settings->>'guard_next_at')::timestamptz;
  if next_at is null or clock_timestamp()<next_at then return result; end if;
  awake:=not coalesce((result.settings->>'guard_awake')::boolean,false);
  if awake then
    update public.game_show_game_treasure set is_stealing=false,stealing_started_at=null,current_units=0,caught_count=caught_count+1,updated_at=clock_timestamp()
      where game_show_game_id=result.id and is_stealing;
  end if;
  update public.game_show_games set settings=settings||jsonb_build_object('guard_awake',awake,'guard_next_at',
    clock_timestamp()+case when awake then make_interval(secs=>1.4+random()*1.6) else make_interval(secs=>2.5+random()*3.5) end)
  where id=result.id returning * into result;
  return result;
end; $$;

create or replace function public.resolve_steal_the_treasure(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public
as $$
declare result public.game_show_games%rowtype; winner_id uuid; reward_points integer;
begin
  select game_show_games.* into result from public.game_show_games join public.games on games.id=game_show_games.game_id
  join public.quizzes on quizzes.id=games.quiz_id where game_show_games.id=p_game_show_game_id
    and game_show_games.game_type='steal-the-treasure' and quizzes.owner_id=auth.uid() for update of game_show_games;
  if result.id is null then raise exception 'Steal the Treasure not found or not owned by current host'; end if;
  if result.status<>'open' then return result; end if;
  if not coalesce((result.settings->>'guard_awake')::boolean,false) then
    update public.game_show_game_treasure set banked_units=banked_units+greatest(0,floor(extract(epoch from (clock_timestamp()-stealing_started_at))*1000)::bigint),
      is_stealing=false,stealing_started_at=null,current_units=0,updated_at=clock_timestamp()
      where game_show_game_id=result.id and is_stealing;
  else
    update public.game_show_game_treasure set is_stealing=false,stealing_started_at=null,current_units=0,updated_at=clock_timestamp()
      where game_show_game_id=result.id and is_stealing;
  end if;
  select team_id into winner_id from public.game_show_game_treasure where game_show_game_id=result.id order by banked_units desc,caught_count,team_id limit 1;
  reward_points:=public.beat_the_bomb_reward_points(result.settings);
  if reward_points>0 then update public.teams set score=score+reward_points where id=winner_id; end if;
  update public.game_show_games set status='exploded',exploded_at=clock_timestamp(),explode_at=clock_timestamp(),winner_team_id=winner_id,reward_points_awarded=reward_points where id=result.id returning * into result;
  return result;
end; $$;

revoke all on function public.start_steal_the_treasure(uuid),public.set_steal_the_treasure_holding(uuid,uuid,uuid,boolean),public.advance_steal_the_treasure(uuid),public.resolve_steal_the_treasure(uuid) from public;
grant execute on function public.start_steal_the_treasure(uuid),public.advance_steal_the_treasure(uuid),public.resolve_steal_the_treasure(uuid) to authenticated;
grant execute on function public.set_steal_the_treasure_holding(uuid,uuid,uuid,boolean) to anon,authenticated;

-- In-show tiebreakers deliberately reuse the hardened numeric Audience Question
-- transport, while retaining their own semantic game type and score-neutral result.
create or replace function public.start_audience_question(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public
as $$
declare result public.game_show_games%rowtype; eligible jsonb;
begin
  select jsonb_agg(teams.id order by teams.created_at) into eligible from public.game_show_games
  join public.games on games.id=game_show_games.game_id join public.quizzes on quizzes.id=games.quiz_id
  join public.teams on teams.game_id=games.id and teams.last_seen_at>clock_timestamp()-interval '5 minutes'
  where game_show_games.id=p_game_show_game_id and game_show_games.game_type in ('audience-question','in-show-tiebreaker')
    and game_show_games.status='ready' and quizzes.owner_id=auth.uid();
  if eligible is null or jsonb_array_length(eligible)=0 then raise exception 'This activity needs at least one active team'; end if;
  update public.game_show_games set status='open',started_at=clock_timestamp(),explode_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible,'winner_team_ids','[]'::jsonb)
  where id=p_game_show_game_id returning * into result;
  if result.id is null then raise exception 'Activity not found, already started, or not owned by current host'; end if;
  return result;
end; $$;

create or replace function public.submit_audience_question_response(p_game_show_game_id uuid,p_request_id uuid,p_request_token uuid,p_response text)
returns public.game_show_game_responses language plpgsql security definer set search_path=public
as $$
declare request_row public.team_join_requests%rowtype; show_game public.game_show_games%rowtype; result public.game_show_game_responses%rowtype;
  parsed_number numeric; correct_value numeric;
begin
  select * into request_row from public.team_join_requests where id=p_request_id and request_token=p_request_token and status='approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;
  select * into show_game from public.game_show_games where id=p_game_show_game_id and game_id=request_row.game_id for update;
  if show_game.id is null or show_game.game_type not in ('audience-question','in-show-tiebreaker') or show_game.status<>'open' then raise exception 'RESPONSES_CLOSED'; end if;
  if not (show_game.settings->'eligible_team_ids'?request_row.team_id::text) then raise exception 'TEAM_NOT_ELIGIBLE'; end if;
  if length(btrim(p_response)) not between 1 and 1000 then raise exception 'RESPONSE_INVALID'; end if;
  if show_game.game_type='in-show-tiebreaker' or show_game.settings->>'audience_question_mode'='closest-number' then
    begin parsed_number:=replace(btrim(p_response),',','')::numeric; exception when invalid_text_representation then raise exception 'NUMBER_REQUIRED'; end;
    select correct_number into correct_value from public.game_show_game_audience_private where game_show_game_id=show_game.id;
    if correct_value is null then raise exception 'A correct number is required'; end if;
  end if;
  insert into public.game_show_game_responses(game_show_game_id,game_id,team_id,response_text,numeric_response,distance_from_correct)
  values(show_game.id,show_game.game_id,request_row.team_id,btrim(p_response),parsed_number,
    case when parsed_number is null then null else abs(parsed_number-correct_value) end) returning * into result;
  return result;
end; $$;

create or replace function public.resolve_audience_question(p_game_show_game_id uuid,p_winner_team_ids uuid[] default null)
returns public.game_show_games language plpgsql security definer set search_path=public
as $$
declare result public.game_show_games%rowtype; winners uuid[]; response_count integer; reward_points integer;
  correct_value numeric; minimum_distance numeric; allows_many boolean;
begin
  select game_show_games.* into result from public.game_show_games join public.games on games.id=game_show_games.game_id
  join public.quizzes on quizzes.id=games.quiz_id where game_show_games.id=p_game_show_game_id
    and game_show_games.game_type in ('audience-question','in-show-tiebreaker') and quizzes.owner_id=auth.uid() for update of game_show_games;
  if result.id is null then raise exception 'Activity not found or not owned by current host'; end if;
  if result.status<>'open' then return result; end if;
  select count(*) into response_count from public.game_show_game_responses where game_show_game_id=result.id;
  if response_count=0 then raise exception 'Wait for at least one team response'; end if;
  if result.game_type='in-show-tiebreaker' or result.settings->>'audience_question_mode'='closest-number' then
    select correct_number into correct_value from public.game_show_game_audience_private where game_show_game_id=result.id;
    if correct_value is null then raise exception 'A correct number is required'; end if;
    update public.game_show_game_responses set distance_from_correct=abs(numeric_response-correct_value) where game_show_game_id=result.id;
    select min(distance_from_correct) into minimum_distance from public.game_show_game_responses where game_show_game_id=result.id;
    select array_agg(team_id order by submitted_at) into winners from public.game_show_game_responses where game_show_game_id=result.id and distance_from_correct=minimum_distance;
  else
    winners:=coalesce(p_winner_team_ids,'{}'::uuid[]);
    if cardinality(winners)=0 then raise exception 'Choose at least one favourite response'; end if;
    allows_many:=coalesce((result.settings->>'allow_multiple_winners')::boolean,false);
    if cardinality(winners)>1 and not allows_many then raise exception 'This game allows one winner'; end if;
    if exists (select 1 from unnest(winners) id where not exists (
      select 1 from public.game_show_game_responses response
      where response.game_show_game_id=result.id and response.team_id=id
    )) then raise exception 'Every winner must have submitted a response'; end if;
  end if;
  update public.game_show_game_responses set is_winner=team_id=any(winners) where game_show_game_id=result.id;
  reward_points:=case when result.game_type='in-show-tiebreaker' then 0 else public.beat_the_bomb_reward_points(result.settings) end;
  if reward_points>0 then update public.teams set score=score+reward_points where id=any(winners); end if;
  update public.game_show_games set status='exploded',exploded_at=clock_timestamp(),explode_at=clock_timestamp(),winner_team_id=winners[1],reward_points_awarded=reward_points*cardinality(winners),
    settings=settings||jsonb_build_object('winner_team_ids',to_jsonb(winners),'correct_number',correct_value)
  where id=result.id returning * into result;
  return result;
end; $$;

-- Copy private numeric answers for both Audience Questions and in-show tiebreakers.
create or replace function public.create_game_from_quiz_with_show_games(p_quiz_id uuid,p_settings jsonb default '{}'::jsonb)
returns table(game_id uuid,game_code text,game_title text) language plpgsql security invoker set search_path=''
as $$
declare created record;
begin
  select * into created from public.create_game_from_quiz(p_quiz_id,p_settings);
  insert into public.game_show_games(game_id,quiz_show_game_id,show_game_key,item_position,round_number,round_title,game_type,title,settings)
  select created.game_id,q.id,q.show_game_key,q.item_position,q.round_number,q.round_title,q.game_type,q.title,
    case when q.game_type in ('audience-question','in-show-tiebreaker') then q.settings-'correct_number' else q.settings end
  from public.quiz_show_games q where q.quiz_id=p_quiz_id order by q.item_position;
  insert into public.game_show_game_audience_private(game_show_game_id,correct_number)
  select g.id,(q.settings->>'correct_number')::numeric from public.game_show_games g join public.quiz_show_games q on q.id=g.quiz_show_game_id
  where g.game_id=created.game_id and g.game_type in ('audience-question','in-show-tiebreaker');
  return query select created.game_id,created.game_code,created.game_title;
end; $$;

-- A resolved in-show tiebreaker is the current ordering key for every equal-score
-- group. The newest one supersedes earlier in-show tiebreakers.
create or replace function public.apply_latest_in_show_tiebreaker(p_game_id uuid)
returns integer language plpgsql security invoker set search_path=public
as $$
declare latest_id uuid; score_group record; ordered uuid[]; expected integer; resolved_count integer:=0;
begin
  select g.id into latest_id from public.game_show_games g join public.games ga on ga.id=g.game_id
  join public.quizzes q on q.id=ga.quiz_id where g.game_id=p_game_id and g.game_type='in-show-tiebreaker'
    and g.status='exploded' and q.owner_id=auth.uid() order by g.item_position desc limit 1;
  if latest_id is null then return 0; end if;
  for score_group in select score,array_agg(id) ids,count(*)::integer n from public.teams where game_id=p_game_id group by score having count(*)>1 loop
    select array_agg(r.team_id order by r.distance_from_correct,r.submitted_at,r.team_id),count(*) into ordered,expected
    from public.game_show_game_responses r where r.game_show_game_id=latest_id and r.team_id=any(score_group.ids) and r.distance_from_correct is not null;
    if expected=score_group.n and not exists(
      select 1 from public.game_show_game_responses a join public.game_show_game_responses b
        on a.game_show_game_id=b.game_show_game_id and a.team_id<>b.team_id and a.distance_from_correct=b.distance_from_correct
      where a.game_show_game_id=latest_id and a.team_id=any(score_group.ids) and b.team_id=any(score_group.ids)
    ) then
      insert into public.game_tie_resolutions(game_id,tied_score,team_ids,status,resolution_method,ordered_team_ids,resolved_at)
      values(p_game_id,score_group.score,score_group.ids,'resolved','tiebreaker',ordered,clock_timestamp())
      on conflict(game_id,tied_score) do update set team_ids=excluded.team_ids,status='resolved',resolution_method='tiebreaker',ordered_team_ids=excluded.ordered_team_ids,resolved_at=excluded.resolved_at;
      resolved_count:=resolved_count+1;
    end if;
  end loop;
  return resolved_count;
end; $$;

revoke all on function public.apply_latest_in_show_tiebreaker(uuid) from public;
grant execute on function public.apply_latest_in_show_tiebreaker(uuid) to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='game_show_game_treasure'
  ) then alter publication supabase_realtime add table public.game_show_game_treasure; end if;
end $$;

comment on table public.game_show_game_treasure is 'Server-authoritative banked and at-risk treasure for Steal the Treasure.';
comment on function public.apply_latest_in_show_tiebreaker(uuid) is 'Applies the most recent completed in-show closest-answer result to every uniquely ordered equal-score group without altering scores.';

commit;
