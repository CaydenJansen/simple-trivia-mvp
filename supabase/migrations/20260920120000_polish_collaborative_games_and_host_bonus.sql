begin;

create table if not exists public.game_score_adjustments (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  points integer not null check (points between 1 and 100),
  reason text not null default 'host_bonus',
  awarded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists game_score_adjustments_game_idx
  on public.game_score_adjustments (game_id, created_at desc);

alter table public.game_score_adjustments enable row level security;

drop policy if exists "Hosts read their score adjustments" on public.game_score_adjustments;
create policy "Hosts read their score adjustments"
  on public.game_score_adjustments for select to authenticated
  using (exists (
    select 1
    from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = game_score_adjustments.game_id
      and quizzes.owner_id = auth.uid()
  ));

grant select on public.game_score_adjustments to authenticated;

create or replace function public.award_host_bonus_points(p_team_id uuid, p_points integer)
returns public.teams
language plpgsql security definer set search_path=public as $$
declare
  selected_team public.teams%rowtype;
  selected_game public.games%rowtype;
begin
  if p_points is null or p_points < 1 or p_points > 100 then
    raise exception 'BONUS_POINTS_OUT_OF_RANGE';
  end if;

  select teams.* into selected_team
  from public.teams
  join public.games on games.id = teams.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where teams.id = p_team_id
    and quizzes.owner_id = auth.uid()
  for update of teams;

  if selected_team.id is null then raise exception 'TEAM_NOT_FOUND'; end if;

  select * into selected_game from public.games where id = selected_team.game_id;
  if selected_game.status not in ('lobby', 'live') then
    raise exception 'GAME_NOT_ACTIVE';
  end if;

  update public.teams
  set score = score + p_points
  where id = selected_team.id
  returning * into selected_team;

  insert into public.game_score_adjustments(game_id, team_id, points, awarded_by)
  values(selected_team.game_id, selected_team.id, p_points, auth.uid());

  return selected_team;
end; $$;

create or replace function public.get_lowest_bidder_matching_result(
  p_game_show_game_id uuid,
  p_request_id uuid,
  p_request_token uuid
)
returns table(team_name text, bid integer, is_own boolean, is_winner boolean)
language plpgsql security definer set search_path=public as $$
declare
  own_team uuid;
  own_bid integer;
  selected_game public.game_show_games%rowtype;
begin
  own_team := public.collaborative_game_team(p_game_show_game_id, p_request_id, p_request_token, 'lowest-bidder');
  select * into selected_game from public.game_show_games where id = p_game_show_game_id;
  if selected_game.status <> 'exploded' then raise exception 'RESULT_NOT_READY'; end if;

  select bids.bid into own_bid
  from public.game_show_game_bids bids
  where bids.game_show_game_id = p_game_show_game_id and bids.team_id = own_team;

  if own_bid is null then return; end if;

  return query
  select teams.name, bids.bid, bids.team_id = own_team, bids.team_id = selected_game.winner_team_id
  from public.game_show_game_bids bids
  join public.teams on teams.id = bids.team_id
  where bids.game_show_game_id = p_game_show_game_id and bids.bid = own_bid
  order by bids.submitted_at, teams.name;
end; $$;

create or replace function public.start_deal_or_no_deal(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; eligible jsonb;
begin
  select jsonb_agg(id order by created_at) into eligible from public.teams where game_id=(select sg.game_id from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id where sg.id=p_game_show_game_id and sg.game_type='deal-or-no-deal' and sg.status='ready' and q.owner_id=auth.uid()) and last_seen_at>clock_timestamp()-interval '5 minutes';
  if eligible is null or jsonb_array_length(eligible)<2 then raise exception 'Deal or No Deal needs at least two active teams'; end if;
  if jsonb_array_length(eligible)>93 then raise exception 'Deal or No Deal supports up to 93 active teams'; end if;
  delete from public.game_show_game_deals where game_show_game_id=p_game_show_game_id;
  insert into public.game_show_game_deals(game_show_game_id,game_id,team_id,assigned_value)
  select p_game_show_game_id,sg.game_id,t.team_id,v.value from public.game_show_games sg
  cross join lateral (select (value #>> '{}')::uuid team_id,row_number() over() rn from jsonb_array_elements(eligible) value) t
  join (select value,row_number() over(order by random()) rn from generate_series(1,93) value) v using(rn) where sg.id=p_game_show_game_id;
  update public.game_show_games set status='open',started_at=clock_timestamp(),explode_at=clock_timestamp()+interval '22 seconds',exploded_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible,'deal_round',1)
  where id=p_game_show_game_id returning * into result;
  return result;
end; $$;

create or replace function public.advance_deal_or_no_deal(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare
  result public.game_show_games%rowtype;
  swapper record;
  replacement integer;
  round_no integer;
  winner uuid;
  reward integer;
  pending integer;
begin
  select sg.* into result from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id
  where sg.id=p_game_show_game_id and sg.game_type='deal-or-no-deal' and q.owner_id=auth.uid() for update of sg;
  if result.id is null then raise exception 'Deal or No Deal not found'; end if;
  if result.status<>'open' then return result; end if;
  select count(*) into pending from public.game_show_game_deals where game_show_game_id=result.id and not locked and decision is null;
  if clock_timestamp()<result.explode_at and pending>0 then return result; end if;

  update public.game_show_game_deals set decision='keep' where game_show_game_id=result.id and not locked and decision is null;
  update public.game_show_game_deals set locked=true,last_outcome='kept',updated_at=clock_timestamp() where game_show_game_id=result.id and not locked and decision='keep';

  for swapper in
    select team_id, assigned_value, swaps_used
    from public.game_show_game_deals
    where game_show_game_id=result.id and not locked and decision='swap'
    order by random()
  loop
    select candidate into replacement
    from generate_series(1,93) candidate
    where candidate <> swapper.assigned_value
      and not exists (
        select 1 from public.game_show_game_deals other_case
        where other_case.game_show_game_id=result.id
          and other_case.team_id<>swapper.team_id
          and other_case.assigned_value=candidate
      )
    order by random()
    limit 1;

    if replacement is null then
      select candidate into replacement from generate_series(1,93) candidate
      where candidate<>swapper.assigned_value order by random() limit 1;
    end if;

    update public.game_show_game_deals
    set assigned_value=replacement,
        swaps_used=swaps_used+1,
        locked=(swaps_used+1>=3),
        decision=null,
        last_outcome='bank-swapped',
        updated_at=clock_timestamp()
    where game_show_game_id=result.id and team_id=swapper.team_id;
  end loop;

  select count(*) into pending from public.game_show_game_deals where game_show_game_id=result.id and not locked;
  round_no:=coalesce((result.settings->>'deal_round')::integer,1);
  if pending>0 and round_no<3 then
    update public.game_show_games set settings=settings||jsonb_build_object('deal_round',round_no+1),explode_at=clock_timestamp()+interval '22 seconds' where id=result.id returning * into result;
  else
    update public.game_show_game_deals set locked=true where game_show_game_id=result.id;
    select team_id into winner from public.game_show_game_deals where game_show_game_id=result.id order by assigned_value desc,team_id limit 1;
    reward:=public.beat_the_bomb_reward_points(result.settings); if reward>0 then update public.teams set score=score+reward where id=winner; end if;
    update public.game_show_games set status='exploded',exploded_at=clock_timestamp(),winner_team_id=winner,reward_points_awarded=reward where id=result.id returning * into result;
  end if;
  return result;
end; $$;

create or replace function public.start_beat_the_bomb(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; eligible jsonb; armed timestamptz; danger_ends timestamptz;
begin
  select jsonb_agg(teams.id order by teams.created_at) into eligible from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id join public.teams on teams.game_id=g.id and teams.last_seen_at>clock_timestamp()-interval '5 minutes' where sg.id=p_game_show_game_id and sg.game_type='beat-the-bomb' and sg.status='ready' and q.owner_id=auth.uid();
  if eligible is null then raise exception 'Beat the Bomb needs an active team'; end if;
  armed:=clock_timestamp()+interval '20 seconds';
  danger_ends:=armed+interval '60 seconds';
  delete from public.game_show_game_presses where game_show_game_id=p_game_show_game_id;
  update public.game_show_games set status='open',started_at=clock_timestamp(),explode_at=armed+make_interval(secs=>1+floor(random()*60)::integer),exploded_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible,'armed_at',armed,'danger_ends_at',danger_ends,'overtime',false)
  where id=p_game_show_game_id returning * into result;
  return result;
end; $$;

create or replace function public.get_own_beat_the_bomb_status(
  p_game_show_game_id uuid,
  p_request_id uuid,
  p_request_token uuid
)
returns boolean language plpgsql security definer set search_path=public as $$
declare team uuid;
begin
  team:=public.collaborative_game_team(p_game_show_game_id,p_request_id,p_request_token,'beat-the-bomb');
  return exists(select 1 from public.game_show_game_presses where game_show_game_id=p_game_show_game_id and team_id=team);
end; $$;

create or replace function public.cut_beat_the_bomb_wire(p_game_show_game_id uuid,p_request_id uuid,p_request_token uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare team uuid; result public.game_show_games%rowtype; danger_ends timestamptz; existing_presses integer;
begin
  team:=public.collaborative_game_team(p_game_show_game_id,p_request_id,p_request_token,'beat-the-bomb');
  select * into result from public.game_show_games where id=p_game_show_game_id for update;
  if result.status<>'open' then raise exception 'BOMB_EXPLODED'; end if;
  if clock_timestamp()<(result.settings->>'armed_at')::timestamptz then raise exception 'BOMB_ARMING'; end if;
  danger_ends:=coalesce((result.settings->>'danger_ends_at')::timestamptz,(result.settings->>'armed_at')::timestamptz+interval '60 seconds');
  select count(*) into existing_presses from public.game_show_game_presses where game_show_game_id=result.id;
  if clock_timestamp()>=result.explode_at and existing_presses>0 and coalesce((result.settings->>'overtime')::boolean,false)=false then raise exception 'BOMB_EXPLODED'; end if;
  if clock_timestamp()>=result.explode_at and existing_presses=0 and clock_timestamp()<danger_ends then
    update public.game_show_games set explode_at=danger_ends where id=result.id returning * into result;
  end if;
  insert into public.game_show_game_presses(game_show_game_id,game_id,team_id) values(result.id,result.game_id,team)
  on conflict(game_show_game_id,team_id) do nothing;
  if not found then raise exception 'WIRE_ALREADY_CUT'; end if;
  if coalesce((result.settings->>'overtime')::boolean,false) then
    update public.game_show_games set explode_at=clock_timestamp() where id=result.id returning * into result;
  end if;
  return result;
end; $$;

create or replace function public.resolve_beat_the_bomb(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; winner uuid; reward integer; press_count integer; danger_ends timestamptz;
begin
  select sg.* into result from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id where sg.id=p_game_show_game_id and sg.game_type='beat-the-bomb' and q.owner_id=auth.uid() for update of sg;
  if result.id is null then raise exception 'Beat the Bomb not found'; end if;
  if result.status<>'open' or clock_timestamp()<result.explode_at then return result; end if;
  select count(*) into press_count from public.game_show_game_presses where game_show_game_id=result.id;
  danger_ends:=coalesce((result.settings->>'danger_ends_at')::timestamptz,(result.settings->>'armed_at')::timestamptz+interval '60 seconds');

  if press_count=0 then
    if clock_timestamp()<danger_ends then
      update public.game_show_games set explode_at=danger_ends where id=result.id returning * into result;
    else
      update public.game_show_games
      set explode_at=clock_timestamp()+interval '1 second', settings=settings||jsonb_build_object('overtime',true)
      where id=result.id returning * into result;
    end if;
    return result;
  end if;

  select team_id into winner from public.game_show_game_presses where game_show_game_id=result.id order by pressed_at desc,id desc limit 1;
  reward:=public.beat_the_bomb_reward_points(result.settings);
  if reward>0 then update public.teams set score=score+reward where id=winner; end if;
  update public.game_show_games set status='exploded',exploded_at=clock_timestamp(),winner_team_id=winner,reward_points_awarded=reward where id=result.id returning * into result;
  return result;
end; $$;

revoke all on function public.award_host_bonus_points(uuid,integer),public.get_lowest_bidder_matching_result(uuid,uuid,uuid),public.get_own_beat_the_bomb_status(uuid,uuid,uuid) from public;
grant execute on function public.award_host_bonus_points(uuid,integer) to authenticated;
grant execute on function public.get_lowest_bidder_matching_result(uuid,uuid,uuid),public.get_own_beat_the_bomb_status(uuid,uuid,uuid) to anon,authenticated;

drop policy if exists "Participants read show game presses" on public.game_show_game_presses;
drop policy if exists "Hosts read show game presses" on public.game_show_game_presses;
create policy "Hosts read show game presses"
  on public.game_show_game_presses for select to authenticated
  using (exists (
    select 1
    from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = game_show_game_presses.game_id
      and quizzes.owner_id = auth.uid()
  ));

revoke select on public.game_show_game_presses from anon;
grant select on public.game_show_game_presses to authenticated;

commit;
