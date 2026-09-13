begin;

alter table public.quiz_show_games drop constraint if exists quiz_show_games_game_type_check;
alter table public.quiz_show_games add constraint quiz_show_games_game_type_check
  check (game_type in ('beat-the-bomb','lowest-bidder','deal-or-no-deal','shared-cursor','spin-the-wheel','heads-or-tails','dodge-the-rock','scissors-paper-rock','big-balloon','steal-the-treasure','audience-question','tiebreaker-style-question','in-show-tiebreaker'));

alter table public.game_show_games drop constraint if exists game_show_games_game_type_check;
alter table public.game_show_games add constraint game_show_games_game_type_check
  check (game_type in ('beat-the-bomb','lowest-bidder','deal-or-no-deal','shared-cursor','spin-the-wheel','heads-or-tails','dodge-the-rock','scissors-paper-rock','big-balloon','steal-the-treasure','audience-question','tiebreaker-style-question','in-show-tiebreaker'));

create table public.game_show_game_bids (
  id uuid primary key default gen_random_uuid(),
  game_show_game_id uuid not null references public.game_show_games(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  bid integer not null check (bid >= 0 and bid <= 999999),
  submitted_at timestamptz not null default clock_timestamp(),
  unique (game_show_game_id, team_id)
);

create table public.game_show_game_deals (
  id uuid primary key default gen_random_uuid(),
  game_show_game_id uuid not null references public.game_show_games(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  assigned_value integer not null check (assigned_value between 1 and 100),
  swaps_used integer not null default 0 check (swaps_used between 0 and 3),
  decision text check (decision is null or decision in ('keep','swap')),
  locked boolean not null default false,
  last_outcome text,
  updated_at timestamptz not null default clock_timestamp(),
  unique (game_show_game_id, team_id)
);

create index game_show_game_bids_game_idx on public.game_show_game_bids (game_show_game_id, submitted_at);
create index game_show_game_deals_game_idx on public.game_show_game_deals (game_show_game_id, locked, updated_at);
alter table public.game_show_game_bids enable row level security;
alter table public.game_show_game_deals enable row level security;

create policy "Hosts read collaborative game bids" on public.game_show_game_bids for select to authenticated
using (exists (select 1 from public.games join public.quizzes on quizzes.id=games.quiz_id where games.id=game_show_game_bids.game_id and quizzes.owner_id=auth.uid()));
create policy "Hosts read collaborative game deals" on public.game_show_game_deals for select to authenticated
using (exists (select 1 from public.games join public.quizzes on quizzes.id=games.quiz_id where games.id=game_show_game_deals.game_id and quizzes.owner_id=auth.uid()));
grant select on public.game_show_game_bids, public.game_show_game_deals to authenticated;

create or replace function public.collaborative_game_team(
  p_game_show_game_id uuid, p_request_id uuid, p_request_token uuid, p_game_type text
) returns uuid language plpgsql security definer set search_path=public as $$
declare request_row public.team_join_requests%rowtype; show_game public.game_show_games%rowtype;
begin
  select * into request_row from public.team_join_requests
  where id=p_request_id and request_token=p_request_token and status='approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;
  select * into show_game from public.game_show_games
  where id=p_game_show_game_id and game_id=request_row.game_id and game_type=p_game_type;
  if show_game.id is null or not (show_game.settings->'eligible_team_ids' ? request_row.team_id::text) then raise exception 'TEAM_NOT_ELIGIBLE'; end if;
  return request_row.team_id;
end; $$;
revoke all on function public.collaborative_game_team(uuid,uuid,uuid,text) from public;

create or replace function public.start_lowest_bidder(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; eligible jsonb;
begin
  select jsonb_agg(teams.id order by teams.created_at) into eligible
  from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id
  join public.teams on teams.game_id=g.id and teams.last_seen_at > clock_timestamp()-interval '5 minutes'
  where sg.id=p_game_show_game_id and sg.game_type='lowest-bidder' and sg.status='ready' and q.owner_id=auth.uid();
  if eligible is null or jsonb_array_length(eligible)<2 then raise exception 'Lowest Bidder needs at least two active teams'; end if;
  delete from public.game_show_game_bids where game_show_game_id=p_game_show_game_id;
  update public.game_show_games set status='open',started_at=clock_timestamp(),explode_at=clock_timestamp()+interval '20 seconds',exploded_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible)
  where id=p_game_show_game_id returning * into result;
  return result;
end; $$;

create or replace function public.submit_lowest_bidder_bid(p_game_show_game_id uuid,p_request_id uuid,p_request_token uuid,p_bid integer)
returns public.game_show_game_bids language plpgsql security definer set search_path=public as $$
declare team uuid; sg public.game_show_games%rowtype; result public.game_show_game_bids%rowtype;
begin
  if p_bid<0 or p_bid>999999 then raise exception 'BID_OUT_OF_RANGE'; end if;
  team:=public.collaborative_game_team(p_game_show_game_id,p_request_id,p_request_token,'lowest-bidder');
  select * into sg from public.game_show_games where id=p_game_show_game_id for update;
  if sg.status<>'open' or clock_timestamp()>=sg.explode_at then raise exception 'BIDDING_CLOSED'; end if;
  insert into public.game_show_game_bids(game_show_game_id,game_id,team_id,bid) values(sg.id,sg.game_id,team,p_bid)
  on conflict(game_show_game_id,team_id) do update set bid=excluded.bid,submitted_at=clock_timestamp() returning * into result;
  return result;
end; $$;

create or replace function public.get_own_lowest_bidder_bid(p_game_show_game_id uuid,p_request_id uuid,p_request_token uuid)
returns public.game_show_game_bids language plpgsql security definer set search_path=public as $$
declare team uuid; result public.game_show_game_bids%rowtype;
begin
  team:=public.collaborative_game_team(p_game_show_game_id,p_request_id,p_request_token,'lowest-bidder');
  select * into result from public.game_show_game_bids where game_show_game_id=p_game_show_game_id and team_id=team;
  return result;
end; $$;

create or replace function public.resolve_lowest_bidder(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; winner uuid; reward integer;
begin
  select sg.* into result from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id
  where sg.id=p_game_show_game_id and sg.game_type='lowest-bidder' and q.owner_id=auth.uid() for update of sg;
  if result.id is null then raise exception 'Lowest Bidder not found'; end if;
  if result.status<>'open' or clock_timestamp()<result.explode_at then return result; end if;
  select min(team_id::text)::uuid into winner from public.game_show_game_bids b
  where b.game_show_game_id=result.id and b.bid=(select min(unique_bid.bid) from (select b2.bid from public.game_show_game_bids b2 where b2.game_show_game_id=result.id group by b2.bid having count(*)=1) unique_bid);
  reward:=public.beat_the_bomb_reward_points(result.settings);
  if winner is not null and reward>0 then update public.teams set score=score+reward where id=winner; end if;
  update public.game_show_games set status='exploded',exploded_at=clock_timestamp(),winner_team_id=winner,reward_points_awarded=case when winner is null then 0 else reward end
  where id=result.id returning * into result;
  return result;
end; $$;

create or replace function public.start_deal_or_no_deal(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; eligible jsonb;
begin
  select jsonb_agg(id order by created_at) into eligible from public.teams where game_id=(select sg.game_id from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id where sg.id=p_game_show_game_id and sg.game_type='deal-or-no-deal' and sg.status='ready' and q.owner_id=auth.uid()) and last_seen_at>clock_timestamp()-interval '5 minutes';
  if eligible is null or jsonb_array_length(eligible)<2 then raise exception 'Deal or No Deal needs at least two active teams'; end if;
  delete from public.game_show_game_deals where game_show_game_id=p_game_show_game_id;
  insert into public.game_show_game_deals(game_show_game_id,game_id,team_id,assigned_value)
  select p_game_show_game_id,sg.game_id,t.team_id,v.value from public.game_show_games sg
  cross join lateral (select (value #>> '{}')::uuid team_id,row_number() over() rn from jsonb_array_elements(eligible) value) t
  join (select value,row_number() over(order by random()) rn from generate_series(1,100) value) v using(rn) where sg.id=p_game_show_game_id;
  update public.game_show_games set status='open',started_at=clock_timestamp(),explode_at=clock_timestamp()+interval '12 seconds',exploded_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible,'deal_round',1)
  where id=p_game_show_game_id returning * into result;
  return result;
end; $$;

create or replace function public.get_own_deal_or_no_deal_state(p_game_show_game_id uuid,p_request_id uuid,p_request_token uuid)
returns public.game_show_game_deals language plpgsql security definer set search_path=public as $$
declare team uuid; result public.game_show_game_deals%rowtype;
begin
  team:=public.collaborative_game_team(p_game_show_game_id,p_request_id,p_request_token,'deal-or-no-deal');
  select * into result from public.game_show_game_deals where game_show_game_id=p_game_show_game_id and team_id=team;
  return result;
end; $$;

create or replace function public.submit_deal_or_no_deal_decision(p_game_show_game_id uuid,p_request_id uuid,p_request_token uuid,p_decision text)
returns public.game_show_game_deals language plpgsql security definer set search_path=public as $$
declare team uuid; sg public.game_show_games%rowtype; result public.game_show_game_deals%rowtype;
begin
  if p_decision not in ('keep','swap') then raise exception 'INVALID_DECISION'; end if;
  team:=public.collaborative_game_team(p_game_show_game_id,p_request_id,p_request_token,'deal-or-no-deal');
  select * into sg from public.game_show_games where id=p_game_show_game_id for update;
  if sg.status<>'open' or clock_timestamp()>=sg.explode_at then raise exception 'DECISION_CLOSED'; end if;
  update public.game_show_game_deals set decision=p_decision,updated_at=clock_timestamp() where game_show_game_id=sg.id and team_id=team and not locked returning * into result;
  if result.id is null then raise exception 'CASE_LOCKED'; end if;
  return result;
end; $$;

create or replace function public.advance_deal_or_no_deal(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; a uuid; b uuid; av integer; bv integer; pair record; round_no integer; winner uuid; reward integer; pending integer;
begin
  select sg.* into result from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id
  where sg.id=p_game_show_game_id and sg.game_type='deal-or-no-deal' and q.owner_id=auth.uid() for update of sg;
  if result.id is null then raise exception 'Deal or No Deal not found'; end if;
  if result.status<>'open' then return result; end if;
  select count(*) into pending from public.game_show_game_deals where game_show_game_id=result.id and not locked and decision is null;
  if clock_timestamp()<result.explode_at and pending>0 then return result; end if;
  update public.game_show_game_deals set decision='keep' where game_show_game_id=result.id and not locked and decision is null;
  update public.game_show_game_deals set locked=true,last_outcome='kept',updated_at=clock_timestamp() where game_show_game_id=result.id and not locked and decision='keep';
  for pair in select array_agg(team_id order by random()) ids from public.game_show_game_deals where game_show_game_id=result.id and not locked and decision='swap' loop
    if pair.ids is not null then
      for i in 1..coalesce(array_length(pair.ids,1),0) by 2 loop
        a:=pair.ids[i]; b:=case when i+1<=array_length(pair.ids,1) then pair.ids[i+1] else null end;
        if b is null then update public.game_show_game_deals set locked=true,last_outcome='no-partner',decision=null where team_id=a and game_show_game_id=result.id;
        else
          select assigned_value into av from public.game_show_game_deals where team_id=a and game_show_game_id=result.id;
          select assigned_value into bv from public.game_show_game_deals where team_id=b and game_show_game_id=result.id;
          update public.game_show_game_deals set assigned_value=case when team_id=a then bv else av end,swaps_used=swaps_used+1,locked=(swaps_used+1>=3),decision=null,last_outcome='swapped',updated_at=clock_timestamp() where game_show_game_id=result.id and team_id in(a,b);
        end if;
      end loop;
    end if;
  end loop;
  select count(*) into pending from public.game_show_game_deals where game_show_game_id=result.id and not locked;
  round_no:=coalesce((result.settings->>'deal_round')::integer,1);
  if pending>=2 and round_no<3 then
    update public.game_show_games set settings=settings||jsonb_build_object('deal_round',round_no+1),explode_at=clock_timestamp()+interval '12 seconds' where id=result.id returning * into result;
  else
    update public.game_show_game_deals set locked=true where game_show_game_id=result.id;
    select team_id into winner from public.game_show_game_deals where game_show_game_id=result.id order by assigned_value desc,team_id limit 1;
    reward:=public.beat_the_bomb_reward_points(result.settings); if reward>0 then update public.teams set score=score+reward where id=winner; end if;
    update public.game_show_games set status='exploded',exploded_at=clock_timestamp(),winner_team_id=winner,reward_points_awarded=reward where id=result.id returning * into result;
  end if;
  return result;
end; $$;

create or replace function public.start_shared_cursor(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; eligible jsonb; positions jsonb;
begin
  with active as (select teams.id,row_number() over(order by teams.created_at)-1 idx,count(*) over() total from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id join public.teams on teams.game_id=g.id and teams.last_seen_at>clock_timestamp()-interval '5 minutes' where sg.id=p_game_show_game_id and sg.game_type='shared-cursor' and sg.status='ready' and q.owner_id=auth.uid())
  select jsonb_agg(id order by idx),jsonb_object_agg(id::text,jsonb_build_object('x',cos(2*pi()*idx/greatest(total,1)),'y',sin(2*pi()*idx/greatest(total,1)))) into eligible,positions from active;
  if eligible is null or jsonb_array_length(eligible)<2 then raise exception 'Shared Cursor needs at least two active teams'; end if;
  update public.game_show_games set status='open',started_at=clock_timestamp(),explode_at=clock_timestamp()+interval '35 seconds',exploded_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible,'cursor_positions',positions,'cursor_x',0,'cursor_y',0,'cursor_candidate_id',null,'cursor_candidate_since_ms',null,'cursor_pull_count',0)
  where id=p_game_show_game_id returning * into result; return result;
end; $$;

create or replace function public.advance_shared_cursor(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; candidate uuid; since_ms bigint; winner uuid; reward integer; nearest record;
begin
  select sg.* into result from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id where sg.id=p_game_show_game_id and sg.game_type='shared-cursor' and q.owner_id=auth.uid() for update of sg;
  if result.id is null then raise exception 'Shared Cursor not found'; end if; if result.status<>'open' then return result; end if;
  candidate:=nullif(result.settings->>'cursor_candidate_id','')::uuid; since_ms:=nullif(result.settings->>'cursor_candidate_since_ms','')::bigint;
  if candidate is not null and since_ms is not null and floor(extract(epoch from clock_timestamp())*1000)-since_ms>=1000 then winner:=candidate; end if;
  if winner is null and clock_timestamp()>=result.explode_at then
    select key::uuid into winner from jsonb_each(result.settings->'cursor_positions') order by power((value->>'x')::numeric-(result.settings->>'cursor_x')::numeric,2)+power((value->>'y')::numeric-(result.settings->>'cursor_y')::numeric,2) limit 1;
  end if;
  if winner is not null then reward:=public.beat_the_bomb_reward_points(result.settings); if reward>0 then update public.teams set score=score+reward where id=winner; end if; update public.game_show_games set status='exploded',exploded_at=clock_timestamp(),winner_team_id=winner,reward_points_awarded=reward where id=result.id returning * into result; end if;
  return result;
end; $$;

create or replace function public.pull_shared_cursor(p_game_show_game_id uuid,p_request_id uuid,p_request_token uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare team uuid; result public.game_show_games%rowtype; target jsonb; cx numeric; cy numeric; tx numeric; ty numeric; nx numeric; ny numeric; elapsed numeric; strength numeric; nearest record; candidate text; old_candidate text; since_ms bigint;
begin
  team:=public.collaborative_game_team(p_game_show_game_id,p_request_id,p_request_token,'shared-cursor'); select * into result from public.game_show_games where id=p_game_show_game_id for update;
  if result.status<>'open' or clock_timestamp()>=result.explode_at then raise exception 'CURSOR_CLOSED'; end if;
  target:=result.settings->'cursor_positions'->team::text; cx:=coalesce((result.settings->>'cursor_x')::numeric,0); cy:=coalesce((result.settings->>'cursor_y')::numeric,0); tx:=(target->>'x')::numeric; ty:=(target->>'y')::numeric;
  elapsed:=least(1,greatest(0,extract(epoch from(clock_timestamp()-result.started_at))/35)); strength:=0.22-(0.17*elapsed); nx:=cx+(tx-cx)*strength; ny:=cy+(ty-cy)*strength;
  select key,value,power((value->>'x')::numeric-nx,2)+power((value->>'y')::numeric-ny,2) distance into nearest from jsonb_each(result.settings->'cursor_positions') order by distance limit 1;
  candidate:=case when nearest.distance<0.05 then nearest.key else null end; old_candidate:=result.settings->>'cursor_candidate_id'; since_ms:=case when candidate is not null and candidate=old_candidate then nullif(result.settings->>'cursor_candidate_since_ms','')::bigint when candidate is not null then floor(extract(epoch from clock_timestamp())*1000)::bigint else null end;
  update public.game_show_games set settings=settings||jsonb_build_object('cursor_x',nx,'cursor_y',ny,'cursor_candidate_id',candidate,'cursor_candidate_since_ms',since_ms,'cursor_pull_count',coalesce((settings->>'cursor_pull_count')::integer,0)+1) where id=result.id returning * into result;
  return result;
end; $$;

create or replace function public.start_beat_the_bomb(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; eligible jsonb; armed timestamptz;
begin
  select jsonb_agg(teams.id order by teams.created_at) into eligible from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id join public.teams on teams.game_id=g.id and teams.last_seen_at>clock_timestamp()-interval '5 minutes' where sg.id=p_game_show_game_id and sg.game_type='beat-the-bomb' and sg.status='ready' and q.owner_id=auth.uid();
  if eligible is null then raise exception 'Beat the Bomb needs an active team'; end if; armed:=clock_timestamp()+interval '20 seconds'; delete from public.game_show_game_presses where game_show_game_id=p_game_show_game_id;
  update public.game_show_games set status='open',started_at=clock_timestamp(),explode_at=armed+make_interval(secs=>1+floor(random()*30)::integer),exploded_at=null,winner_team_id=null,reward_points_awarded=0,settings=settings||jsonb_build_object('eligible_team_ids',eligible,'armed_at',armed) where id=p_game_show_game_id returning * into result; return result;
end; $$;

create or replace function public.cut_beat_the_bomb_wire(p_game_show_game_id uuid,p_request_id uuid,p_request_token uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare team uuid; result public.game_show_games%rowtype;
begin
  team:=public.collaborative_game_team(p_game_show_game_id,p_request_id,p_request_token,'beat-the-bomb'); select * into result from public.game_show_games where id=p_game_show_game_id for update;
  if result.status<>'open' or clock_timestamp()>=result.explode_at then raise exception 'BOMB_EXPLODED'; end if; if clock_timestamp()<(result.settings->>'armed_at')::timestamptz then raise exception 'BOMB_ARMING'; end if;
  insert into public.game_show_game_presses(game_show_game_id,game_id,team_id) values(result.id,result.game_id,team) on conflict(game_show_game_id,team_id) do nothing; if not found then raise exception 'WIRE_ALREADY_CUT'; end if; return result;
end; $$;

create or replace function public.resolve_beat_the_bomb(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; winner uuid; reward integer;
begin
  select sg.* into result from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id where sg.id=p_game_show_game_id and sg.game_type='beat-the-bomb' and q.owner_id=auth.uid() for update of sg;
  if result.id is null then raise exception 'Beat the Bomb not found'; end if; if result.status<>'open' or clock_timestamp()<result.explode_at then return result; end if;
  select team_id into winner from public.game_show_game_presses where game_show_game_id=result.id order by pressed_at desc,id desc limit 1; reward:=public.beat_the_bomb_reward_points(result.settings); if winner is not null and reward>0 then update public.teams set score=score+reward where id=winner; end if;
  update public.game_show_games set status='exploded',exploded_at=clock_timestamp(),winner_team_id=winner,reward_points_awarded=case when winner is null then 0 else reward end where id=result.id returning * into result; return result;
end; $$;

revoke all on function public.start_lowest_bidder(uuid),public.submit_lowest_bidder_bid(uuid,uuid,uuid,integer),public.get_own_lowest_bidder_bid(uuid,uuid,uuid),public.resolve_lowest_bidder(uuid),public.start_deal_or_no_deal(uuid),public.get_own_deal_or_no_deal_state(uuid,uuid,uuid),public.submit_deal_or_no_deal_decision(uuid,uuid,uuid,text),public.advance_deal_or_no_deal(uuid),public.start_shared_cursor(uuid),public.pull_shared_cursor(uuid,uuid,uuid),public.advance_shared_cursor(uuid),public.cut_beat_the_bomb_wire(uuid,uuid,uuid) from public;
grant execute on function public.start_lowest_bidder(uuid),public.resolve_lowest_bidder(uuid),public.start_deal_or_no_deal(uuid),public.advance_deal_or_no_deal(uuid),public.start_shared_cursor(uuid),public.advance_shared_cursor(uuid) to authenticated;
grant execute on function public.submit_lowest_bidder_bid(uuid,uuid,uuid,integer),public.get_own_lowest_bidder_bid(uuid,uuid,uuid),public.get_own_deal_or_no_deal_state(uuid,uuid,uuid),public.submit_deal_or_no_deal_decision(uuid,uuid,uuid,text),public.pull_shared_cursor(uuid,uuid,uuid),public.cut_beat_the_bomb_wire(uuid,uuid,uuid) to anon,authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='game_show_game_bids') then alter publication supabase_realtime add table public.game_show_game_bids; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='game_show_game_deals') then alter publication supabase_realtime add table public.game_show_game_deals; end if;
end $$;

commit;
