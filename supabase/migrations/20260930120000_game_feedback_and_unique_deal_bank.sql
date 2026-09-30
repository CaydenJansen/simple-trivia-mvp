begin;

set local lock_timeout='3s';

set local statement_timeout='20s';

alter table public.game_show_game_deals drop constraint game_show_game_deals_assigned_value_check;
alter table public.game_show_game_deals add constraint game_show_game_deals_assigned_value_check check (assigned_value>0);

create or replace function public.start_deal_or_no_deal(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; eligible jsonb; minimum_ceiling integer; ceiling_value integer;
begin
  select sg.* into result from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id
  where sg.id=p_game_show_game_id and sg.game_type='deal-or-no-deal' and q.owner_id=auth.uid() for update of sg;
  if result.id is null then raise exception 'Deal or No Deal not found'; end if;
  if result.status<>'ready' then return result; end if;
  select jsonb_agg(id order by created_at) into eligible from public.teams where game_id=result.game_id and last_seen_at>clock_timestamp()-interval '5 minutes';
  if eligible is null or jsonb_array_length(eligible)<2 then raise exception 'Deal or No Deal needs at least two active teams'; end if;
  -- Nine spare values guarantee a free value outside the current +/-4 window.
  -- Very large rooms extend above 100 instead of excluding participating teams.
  minimum_ceiling:=greatest(25,jsonb_array_length(eligible)+9);
  ceiling_value:=minimum_ceiling+floor(random()*(greatest(100,minimum_ceiling)-minimum_ceiling+1))::integer;
  update public.game_show_games set settings=settings||jsonb_build_object('deal_max_value',ceiling_value) where id=result.id;
  delete from public.game_show_game_deals where game_show_game_id=result.id;
  insert into public.game_show_game_deals(game_show_game_id,game_id,team_id,assigned_value)
  select result.id,result.game_id,t.team_id,v.value
  from (select (value #>> '{}')::uuid team_id,row_number() over() rn from jsonb_array_elements(eligible) value) t
  join (select value,row_number() over(order by random()) rn from generate_series(1,ceiling_value) value) v using(rn);
  update public.game_show_games set status='open',started_at=clock_timestamp(),explode_at=clock_timestamp()+interval '22 seconds',exploded_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible,'deal_round',1)
  where id=result.id returning * into result;
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
  ceiling_value integer;
begin
  select sg.* into result from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id
  where sg.id=p_game_show_game_id and sg.game_type='deal-or-no-deal' and q.owner_id=auth.uid() for update of sg;
  if result.id is null then raise exception 'Deal or No Deal not found'; end if;
  if result.status<>'open' then return result; end if;
  ceiling_value:=coalesce((result.settings->>'deal_max_value')::integer,93);
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
    from generate_series(1,ceiling_value) candidate
    where abs(candidate-swapper.assigned_value)>=5
      and not exists (
        select 1 from public.game_show_game_deals other_case
        where other_case.game_show_game_id=result.id
          and other_case.team_id<>swapper.team_id
          and other_case.assigned_value=candidate
      )
    order by random()
    limit 1;

    if replacement is null then
      -- Legacy sessions may have a smaller bank. Never create duplicate cases.
      update public.game_show_game_deals set decision=null,last_outcome='bank-unavailable',updated_at=clock_timestamp()
      where game_show_game_id=result.id and team_id=swapper.team_id;
      continue;
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

create or replace function public.pull_shared_cursor(p_game_show_game_id uuid,p_request_id uuid,p_request_token uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare
  team uuid;
  result public.game_show_games%rowtype;
  target jsonb;
  team_stamina jsonb;
  all_stamina jsonb;
  cx numeric;
  cy numeric;
  tx numeric;
  ty numeric;
  nx numeric;
  ny numeric;
  elapsed numeric;
  strength numeric;
  nearest record;
  candidate text;
  old_candidate text;
  since_ms bigint;
  now_ms bigint;
  updated_at_ms bigint;
  cooldown_until_ms bigint;
  remaining numeric;
  restored numeric;
begin
  team:=public.collaborative_game_team(p_game_show_game_id,p_request_id,p_request_token,'shared-cursor');
  select * into result from public.game_show_games where id=p_game_show_game_id for update;
  if result.status<>'open' or clock_timestamp()>=result.explode_at then return result; end if;

  now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  team_stamina:=coalesce(result.settings->'cursor_stamina'->team::text,jsonb_build_object('remaining',5,'updated_at_ms',now_ms,'cooldown_until_ms',null));
  remaining:=greatest(0,least(5,coalesce((team_stamina->>'remaining')::numeric,5)));
  updated_at_ms:=coalesce((team_stamina->>'updated_at_ms')::bigint,now_ms);
  cooldown_until_ms:=nullif(team_stamina->>'cooldown_until_ms','')::bigint;

  if cooldown_until_ms is not null and cooldown_until_ms>now_ms then return result; end if;
  if cooldown_until_ms is not null then
    remaining:=5;
  else
    restored:=greatest(0,(now_ms-updated_at_ms)/1000.0);
    remaining:=least(5,remaining+restored);
  end if;

  if remaining<1 then return result; end if;
  target:=result.settings->'cursor_positions'->team::text;
  if target is null then return result; end if;
  cx:=coalesce((result.settings->>'cursor_x')::numeric,0);
  cy:=coalesce((result.settings->>'cursor_y')::numeric,0);
  tx:=(target->>'x')::numeric;
  ty:=(target->>'y')::numeric;
  elapsed:=least(1,greatest(0,extract(epoch from(clock_timestamp()-result.started_at))/35));
  strength:=0.22-(0.17*elapsed);
  nx:=cx+(tx-cx)*strength;
  ny:=cy+(ty-cy)*strength;
  select key,value,power((value->>'x')::numeric-nx,2)+power((value->>'y')::numeric-ny,2) distance
    into nearest from jsonb_each(result.settings->'cursor_positions') order by distance limit 1;
  candidate:=case when nearest.distance<0.05 then nearest.key else null end;
  old_candidate:=result.settings->>'cursor_candidate_id';
  since_ms:=case when candidate is not null and candidate=old_candidate then nullif(result.settings->>'cursor_candidate_since_ms','')::bigint when candidate is not null then now_ms else null end;

  remaining:=greatest(0,remaining-1);
  cooldown_until_ms:=case when remaining<1 then now_ms+3000 else null end;
  team_stamina:=jsonb_build_object('remaining',remaining,'updated_at_ms',now_ms,'cooldown_until_ms',cooldown_until_ms);
  all_stamina:=jsonb_set(coalesce(result.settings->'cursor_stamina','{}'::jsonb),array[team::text],team_stamina,true);
  update public.game_show_games set settings=settings||jsonb_build_object(
    'cursor_x',nx,
    'cursor_y',ny,
    'cursor_candidate_id',candidate,
    'cursor_candidate_since_ms',since_ms,
    'cursor_pull_count',coalesce((settings->>'cursor_pull_count')::integer,0)+1,
    'cursor_stamina',all_stamina
  ) where id=result.id returning * into result;
  return result;
end; $$;

create or replace function public.get_owned_player_show_game(p_game_id uuid,p_team_id uuid,p_show_game_key text,p_request_id uuid,p_request_token uuid)
returns setof public.game_show_games language plpgsql stable security definer set search_path='' as $$
declare result public.game_show_games%rowtype;
begin
  perform public.assert_player_team(p_game_id,p_team_id,p_request_id,p_request_token);
  select * into result from public.game_show_games where game_id=p_game_id and show_game_key=p_show_game_key;
  if not found then return; end if;
  if result.game_type='beat-the-bomb' and result.status<>'exploded' then
    result.explode_at:=(result.settings->>'danger_ends_at')::timestamptz;
  end if;
  result.settings:=result.settings-'deal_max_value';
  return next result;
end;
$$;

create or replace function public.get_owned_player_choices(p_game_id uuid,p_team_id uuid,p_show_game_id uuid,p_round_number integer,p_request_id uuid,p_request_token uuid)
returns table(team_id uuid,choice text) language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_player_team(p_game_id,p_team_id,p_request_id,p_request_token);
  return query select c.team_id,c.choice from public.game_show_game_choices c join public.game_show_games sg on sg.id=c.game_show_game_id
    where sg.game_id=p_game_id and sg.id=p_show_game_id and c.round_number=p_round_number
      and (sg.game_type<>'scissors-paper-rock' or c.team_id=p_team_id
        or ((sg.settings->'eligible_team_ids' ? p_team_id::text) and (sg.settings->'eliminated_team_ids' ? p_team_id::text) and not (sg.settings->'alive_team_ids' ? p_team_id::text))
        or sg.settings->>'round_phase'<>'choosing' or (sg.settings->>'round_number')::integer>p_round_number);
end;
$$;

create or replace function public.guard_unique_deal_case()
returns trigger language plpgsql security definer set search_path='' as $$
declare ceiling_value integer;
begin
  select (settings->>'deal_max_value')::integer into ceiling_value from public.game_show_games where id=new.game_show_game_id for update;
  if ceiling_value is not null then
    if new.assigned_value<1 or new.assigned_value>ceiling_value then raise exception 'CASE_OUT_OF_RANGE'; end if;
    if exists(select 1 from public.game_show_game_deals where game_show_game_id=new.game_show_game_id and team_id<>new.team_id and assigned_value=new.assigned_value) then raise exception 'CASE_ALREADY_HELD'; end if;
  end if;
  return new;
end; $$;
revoke all on function public.guard_unique_deal_case() from public,anon,authenticated;
create trigger guard_unique_deal_case before insert or update of assigned_value on public.game_show_game_deals for each row execute function public.guard_unique_deal_case();

commit;
