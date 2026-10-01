begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

alter table public.quiz_show_games drop constraint quiz_show_games_game_type_check;
alter table public.quiz_show_games add constraint quiz_show_games_game_type_check check(game_type in ('hot-potato','beat-the-bomb','lowest-bidder','deal-or-no-deal','shared-cursor','spin-the-wheel','heads-or-tails','dodge-the-rock','scissors-paper-rock','big-balloon','steal-the-treasure','audience-question','tiebreaker-style-question','in-show-tiebreaker'));
alter table public.game_show_games drop constraint game_show_games_game_type_check;
alter table public.game_show_games add constraint game_show_games_game_type_check check(game_type in ('hot-potato','beat-the-bomb','lowest-bidder','deal-or-no-deal','shared-cursor','spin-the-wheel','heads-or-tails','dodge-the-rock','scissors-paper-rock','big-balloon','steal-the-treasure','audience-question','tiebreaker-style-question','in-show-tiebreaker'));

-- Private authoritative state. Only the safe projection is sent to browsers;
-- neither players nor hosts need access to future explosion timestamps.
create table public.hot_potato_rounds (
  game_show_game_id uuid primary key references public.game_show_games(id) on delete cascade,
  accrued_at timestamptz not null,
  revision bigint not null default 0
);
create table public.hot_potato_teams (
  game_show_game_id uuid not null references public.hot_potato_rounds(game_show_game_id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  banked numeric not null default 0 check(banked>=0),
  pending numeric not null default 0 check(pending>=0),
  received integer not null default 0,
  bursts integer not null default 0,
  primary key(game_show_game_id,team_id)
);
create table public.hot_potatoes (
  id uuid primary key default gen_random_uuid(),
  game_show_game_id uuid not null,
  holder_id uuid not null,
  born_at timestamptz not null,
  received_at timestamptz not null,
  burst_at timestamptz not null,
  foreign key(game_show_game_id,holder_id) references public.hot_potato_teams(game_show_game_id,team_id) on delete cascade,
  check(burst_at>born_at)
);
create index hot_potatoes_round_burst_idx on public.hot_potatoes(game_show_game_id,burst_at);
create table public.hot_potato_passes (
  operation_id uuid primary key,
  game_show_game_id uuid not null references public.hot_potato_rounds(game_show_game_id) on delete cascade,
  team_id uuid not null,
  potato_id uuid not null,
  recipient_id uuid not null
);
alter table public.hot_potato_rounds enable row level security;
alter table public.hot_potato_teams enable row level security;
alter table public.hot_potatoes enable row level security;
alter table public.hot_potato_passes enable row level security;
revoke all on public.hot_potato_rounds,public.hot_potato_teams,public.hot_potatoes,public.hot_potato_passes from anon,authenticated;

create function public.publish_hot_potato(p_id uuid) returns public.game_show_games
language plpgsql security definer set search_path='' as $$
declare result public.game_show_games; team_rows jsonb; potato_rows jsonb; sampled_at timestamptz; version bigint;
begin
  update public.hot_potato_rounds set revision=revision+1 where game_show_game_id=p_id returning accrued_at,revision into sampled_at,version;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.team_id,'name',t.name,'banked',round(s.banked,1),'pending',s.pending,'bursts',s.bursts) order by t.created_at),'[]') into team_rows
    from public.hot_potato_teams s join public.teams t on t.id=s.team_id where s.game_show_game_id=p_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'holder_id',holder_id,'born_at',born_at,'received_at',received_at) order by born_at,id),'[]') into potato_rows
    from public.hot_potatoes where game_show_game_id=p_id;
  update public.game_show_games set settings=settings||jsonb_build_object('hot_potato',jsonb_build_object('teams',team_rows,'potatoes',potato_rows,'sampled_at',sampled_at,'revision',version))
    where id=p_id returning * into result;
  return result;
end; $$;

create function public.spawn_hot_potato(p_id uuid,p_at timestamptz,p_exclude uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
  -- Prefer teams with fewer deliveries so a crowded room still gets turns.
  select team_id into recipient from public.hot_potato_teams where game_show_game_id=p_id and (p_exclude is null or team_id<>p_exclude) order by received,random() limit 1;
  if recipient is null then return; end if;
  insert into public.hot_potatoes(game_show_game_id,holder_id,born_at,received_at,burst_at)
    values(p_id,recipient,p_at,p_at,p_at+make_interval(secs=>8+random()*14));
  update public.hot_potato_teams set received=received+1 where game_show_game_id=p_id and team_id=recipient;
end; $$;

create function public.sync_hot_potato(p_id uuid,p_force boolean default false) returns public.game_show_games
language plpgsql security definer set search_path='' as $$
declare result public.game_show_games; cutoff timestamptz; last_at timestamptz; event_at timestamptz; due public.hot_potatoes;
  n integer; target_count integer; winner uuid; reward integer; top_score numeric; tied integer;
begin
  -- All clock ticks, passes, deliveries and scoring serialize on this row.
  select * into result from public.game_show_games where id=p_id and game_type='hot-potato' for update;
  if result.id is null then raise exception 'HOT_POTATO_NOT_FOUND'; end if;
  if result.status<>'open' then return result; end if;
  if not exists(select 1 from public.games where id=result.game_id and status='live' and current_screen='show-game' and current_show_game_key=result.show_game_key) then return result; end if;
  select accrued_at into last_at from public.hot_potato_rounds where game_show_game_id=p_id;
  cutoff:=least(clock_timestamp(),result.explode_at);
  if not p_force and cutoff<result.explode_at and cutoff-last_at<interval '400 milliseconds' then return result; end if;
  -- Catch up in chronological order after disconnection; never credit a holder
  -- beyond an explosion, or beyond the round's fixed deadline.
  loop
    select * into due from public.hot_potatoes where game_show_game_id=p_id and burst_at<=cutoff order by burst_at,id limit 1;
    event_at:=case when found then greatest(last_at,due.burst_at) else cutoff end;
    update public.hot_potato_teams s set pending=s.pending+greatest(0,extract(epoch from(event_at-last_at)))*h.total
      from (select holder_id,count(*) total from public.hot_potatoes where game_show_game_id=p_id group by holder_id) h
      where s.game_show_game_id=p_id and s.team_id=h.holder_id;
    last_at:=event_at;
    exit when due.id is null;
    update public.hot_potato_teams set pending=0,bursts=bursts+1 where game_show_game_id=p_id and team_id=due.holder_id;
    delete from public.hot_potatoes where id=due.id;
    if event_at<result.explode_at then perform public.spawn_hot_potato(p_id,event_at,due.holder_id); end if;
  end loop;
  update public.hot_potato_rounds set accrued_at=cutoff where game_show_game_id=p_id;
  select count(*) into n from public.hot_potato_teams where game_show_game_id=p_id;
  if cutoff>=result.explode_at or n<2 then
    -- Unbanked points are lost at the buzzer, just as the instructions promise.
    update public.hot_potato_teams set pending=0 where game_show_game_id=p_id;
    delete from public.hot_potatoes where game_show_game_id=p_id;
    select max(round(banked,1)) into top_score from public.hot_potato_teams where game_show_game_id=p_id;
    select count(*) into tied from public.hot_potato_teams where game_show_game_id=p_id and round(banked,1)=top_score;
    select team_id into winner from public.hot_potato_teams where game_show_game_id=p_id and round(banked,1)=top_score and top_score>0 order by random() limit 1;
    reward:=case when winner is not null then public.beat_the_bomb_reward_points(result.settings) else 0 end;
    if reward>0 then update public.teams set score=score+reward where id=winner; end if;
    update public.game_show_games set status='exploded',exploded_at=cutoff,winner_team_id=winner,reward_points_awarded=reward,
      settings=settings||jsonb_build_object('hot_potato_tied',tied>1 and top_score>0) where id=p_id;
  else
    target_count:=ceil(jsonb_array_length(result.settings->'eligible_team_ids')/5.0)::integer;
    -- Team removal cascades its potatoes; refill those vacancies safely.
    while (select count(*) from public.hot_potatoes where game_show_game_id=p_id)<target_count loop
      perform public.spawn_hot_potato(p_id,cutoff);
    end loop;
  end if;
  return public.publish_hot_potato(p_id);
end; $$;

create function public.start_hot_potato(p_game_show_game_id uuid) returns public.game_show_games
language plpgsql security definer set search_path='' as $$
declare result public.game_show_games; eligible jsonb; start_at timestamptz:=clock_timestamp(); i integer;
begin
  select sg.* into result from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id
    where sg.id=p_game_show_game_id and sg.game_type='hot-potato' and q.owner_id=auth.uid() and g.status='live' and g.current_screen='show-game' and g.current_show_game_key=sg.show_game_key for update of sg;
  if result.id is null then raise exception 'HOT_POTATO_NOT_CURRENT'; end if;
  if result.status<>'ready' then return result; end if;
  select jsonb_agg(id order by created_at) into eligible from public.teams where game_id=result.game_id and last_seen_at>start_at-interval '5 minutes';
  if eligible is null or jsonb_array_length(eligible)<2 then raise exception 'Hot Potato needs at least two active teams'; end if;
  insert into public.hot_potato_rounds(game_show_game_id,accrued_at) values(result.id,start_at);
  insert into public.hot_potato_teams(game_show_game_id,team_id) select result.id,value::uuid from jsonb_array_elements_text(eligible);
  for i in 1..ceil(jsonb_array_length(eligible)/5.0)::integer loop perform public.spawn_hot_potato(result.id,start_at); end loop;
  update public.game_show_games set status='open',started_at=start_at,explode_at=start_at+interval '90 seconds',exploded_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible) where id=result.id;
  return public.publish_hot_potato(result.id);
end; $$;

create function public.advance_hot_potato(p_game_show_game_id uuid) returns public.game_show_games
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id where sg.id=p_game_show_game_id and q.owner_id=auth.uid()) then raise exception 'NOT_GAME_HOST'; end if;
  return public.sync_hot_potato(p_game_show_game_id);
end; $$;

create function public.pass_hot_potato(p_game_show_game_id uuid,p_request_id uuid,p_request_token uuid,p_potato_id uuid,p_recipient_id uuid,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; result public.game_show_games; potato public.hot_potatoes; previous public.hot_potato_passes; at_time timestamptz;
begin
  select * into result from public.game_show_games where id=p_game_show_game_id for update;
  actor:=public.collaborative_game_team(p_game_show_game_id,p_request_id,p_request_token,'hot-potato');
  if p_operation_id is null then raise exception 'OPERATION_REQUIRED'; end if;
  select * into previous from public.hot_potato_passes where operation_id=p_operation_id;
  if found then
    if previous.game_show_game_id<>p_game_show_game_id or previous.team_id<>actor or previous.potato_id<>p_potato_id or previous.recipient_id<>p_recipient_id then raise exception 'OPERATION_CONFLICT'; end if;
    return jsonb_build_object('game',result,'outcome','already-passed');
  end if;
  if not exists(select 1 from public.games where id=result.game_id and status='live' and current_screen='show-game' and current_show_game_key=result.show_game_key) then raise exception 'HOT_POTATO_NOT_CURRENT'; end if;
  if p_recipient_id=actor or not exists(select 1 from public.hot_potato_teams where game_show_game_id=result.id and team_id=p_recipient_id) then raise exception 'INVALID_RECIPIENT'; end if;
  result:=public.sync_hot_potato(result.id,true);
  if result.status<>'open' then return jsonb_build_object('game',result,'outcome','closed'); end if;
  select * into potato from public.hot_potatoes where id=p_potato_id and game_show_game_id=result.id and holder_id=actor;
  if potato.id is null then return jsonb_build_object('game',result,'outcome','not-held'); end if;
  select accrued_at into at_time from public.hot_potato_rounds where game_show_game_id=result.id;
  if at_time<potato.received_at+interval '600 milliseconds' then return jsonb_build_object('game',result,'outcome','too-soon'); end if;
  insert into public.hot_potato_passes values(p_operation_id,result.id,actor,p_potato_id,p_recipient_id);
  update public.hot_potatoes set holder_id=p_recipient_id,received_at=at_time where id=potato.id;
  update public.hot_potato_teams set received=received+1 where game_show_game_id=result.id and team_id=p_recipient_id;
  if not exists(select 1 from public.hot_potatoes where game_show_game_id=result.id and holder_id=actor) then
    update public.hot_potato_teams set banked=banked+pending,pending=0 where game_show_game_id=result.id and team_id=actor;
  end if;
  result:=public.publish_hot_potato(result.id);
  return jsonb_build_object('game',result,'outcome','passed');
end; $$;

-- An approved player's passive poll can advance the clock if the host sleeps.
-- Other games keep the existing protected projection unchanged.
create or replace function public.get_owned_player_show_game(p_game_id uuid,p_team_id uuid,p_show_game_key text,p_request_id uuid,p_request_token uuid)
returns setof public.game_show_games language plpgsql volatile security definer set search_path='' as $$
declare result public.game_show_games;
begin
  perform public.assert_player_team(p_game_id,p_team_id,p_request_id,p_request_token);
  select * into result from public.game_show_games where game_id=p_game_id and show_game_key=p_show_game_key;
  if not found then return; end if;
  if result.game_type='hot-potato' and result.status='open' and exists(select 1 from public.hot_potato_rounds where game_show_game_id=result.id and accrued_at<clock_timestamp()-interval '400 milliseconds') then result:=public.sync_hot_potato(result.id); end if;
  if result.game_type='beat-the-bomb' and result.status<>'exploded' then result.explode_at:=(result.settings->>'danger_ends_at')::timestamptz; end if;
  result.settings:=result.settings-'deal_max_value';
  return next result;
end; $$;

revoke all on function public.publish_hot_potato(uuid),public.spawn_hot_potato(uuid,timestamptz,uuid),public.sync_hot_potato(uuid,boolean),public.start_hot_potato(uuid),public.advance_hot_potato(uuid),public.pass_hot_potato(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.start_hot_potato(uuid),public.advance_hot_potato(uuid) to authenticated;
grant execute on function public.pass_hot_potato(uuid,uuid,uuid,uuid,uuid,uuid) to anon,authenticated;
commit;
