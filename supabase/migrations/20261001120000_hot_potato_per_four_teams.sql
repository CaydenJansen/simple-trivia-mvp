begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Round up one potato per four starting teams, including replacement refills.
create or replace function public.sync_hot_potato(p_id uuid,p_force boolean default false) returns public.game_show_games
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
    target_count:=ceil(jsonb_array_length(result.settings->'eligible_team_ids')/4.0)::integer;
    -- Team removal cascades its potatoes; refill those vacancies safely.
    while (select count(*) from public.hot_potatoes where game_show_game_id=p_id)<target_count loop
      perform public.spawn_hot_potato(p_id,cutoff);
    end loop;
  end if;
  return public.publish_hot_potato(p_id);
end; $$;

create or replace function public.start_hot_potato(p_game_show_game_id uuid) returns public.game_show_games
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
  for i in 1..ceil(jsonb_array_length(eligible)/4.0)::integer loop perform public.spawn_hot_potato(result.id,start_at); end loop;
  update public.game_show_games set status='open',started_at=start_at,explode_at=start_at+interval '90 seconds',exploded_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible) where id=result.id;
  return public.publish_hot_potato(result.id);
end; $$;

commit;
