begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Display uses 100 points per stored second. Preserve hundredths so banked
-- scores and winner/tie decisions agree down to a single displayed point.
-- Stored accrual units and configured quiz rewards remain unchanged.
create or replace function public.publish_hot_potato(p_id uuid) returns public.game_show_games
language plpgsql security definer set search_path='' as $$
declare result public.game_show_games; team_rows jsonb; potato_rows jsonb; sampled_at timestamptz; version bigint;
begin
  update public.hot_potato_rounds set revision=revision+1 where game_show_game_id=p_id returning accrued_at,revision into sampled_at,version;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.team_id,'name',t.name,'banked',round(s.banked,2),'pending',s.pending,'bursts',s.bursts) order by t.created_at),'[]') into team_rows
    from public.hot_potato_teams s join public.teams t on t.id=s.team_id where s.game_show_game_id=p_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'holder_id',holder_id,'born_at',born_at,'received_at',received_at) order by born_at,id),'[]') into potato_rows
    from public.hot_potatoes where game_show_game_id=p_id;
  update public.game_show_games set settings=settings||jsonb_build_object('hot_potato',jsonb_build_object('teams',team_rows,'potatoes',potato_rows,'sampled_at',sampled_at,'revision',version))
    where id=p_id returning * into result;
  return result;
end; $$;

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
    select max(round(banked,2)) into top_score from public.hot_potato_teams where game_show_game_id=p_id;
    select count(*) into tied from public.hot_potato_teams where game_show_game_id=p_id and round(banked,2)=top_score;
    select team_id into winner from public.hot_potato_teams where game_show_game_id=p_id and round(banked,2)=top_score and top_score>0 order by random() limit 1;
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

commit;
