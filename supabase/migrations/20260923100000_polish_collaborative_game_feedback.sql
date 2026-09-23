begin;

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
      select candidate into replacement from generate_series(1,93) candidate
      where abs(candidate-swapper.assigned_value)>=5 order by random() limit 1;
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

create or replace function public.start_shared_cursor(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; eligible jsonb; positions jsonb; stamina jsonb; now_ms bigint;
begin
  now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  with active as (
    select teams.id,row_number() over(order by teams.created_at)-1 idx,count(*) over() total
    from public.game_show_games sg
    join public.games g on g.id=sg.game_id
    join public.quizzes q on q.id=g.quiz_id
    join public.teams on teams.game_id=g.id and teams.last_seen_at>clock_timestamp()-interval '5 minutes'
    where sg.id=p_game_show_game_id and sg.game_type='shared-cursor' and sg.status='ready' and q.owner_id=auth.uid()
  )
  select
    jsonb_agg(id order by idx),
    jsonb_object_agg(id::text,jsonb_build_object('x',cos(2*pi()*idx/greatest(total,1)),'y',sin(2*pi()*idx/greatest(total,1)))),
    jsonb_object_agg(id::text,jsonb_build_object('remaining',5,'updated_at_ms',now_ms,'cooldown_until_ms',null))
  into eligible,positions,stamina from active;
  if eligible is null or jsonb_array_length(eligible)<2 then raise exception 'Shared Cursor needs at least two active teams'; end if;
  update public.game_show_games set status='open',started_at=clock_timestamp(),explode_at=clock_timestamp()+interval '35 seconds',exploded_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible,'cursor_positions',positions,'cursor_x',0,'cursor_y',0,'cursor_candidate_id',null,'cursor_candidate_since_ms',null,'cursor_pull_count',0,'cursor_stamina',stamina)
  where id=p_game_show_game_id returning * into result;
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
  remaining integer;
  restored integer;
begin
  team:=public.collaborative_game_team(p_game_show_game_id,p_request_id,p_request_token,'shared-cursor');
  select * into result from public.game_show_games where id=p_game_show_game_id for update;
  if result.status<>'open' or clock_timestamp()>=result.explode_at then return result; end if;

  now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  team_stamina:=coalesce(result.settings->'cursor_stamina'->team::text,jsonb_build_object('remaining',5,'updated_at_ms',now_ms,'cooldown_until_ms',null));
  remaining:=greatest(0,least(5,coalesce((team_stamina->>'remaining')::integer,5)));
  updated_at_ms:=coalesce((team_stamina->>'updated_at_ms')::bigint,now_ms);
  cooldown_until_ms:=nullif(team_stamina->>'cooldown_until_ms','')::bigint;

  if cooldown_until_ms is not null and cooldown_until_ms>now_ms then return result; end if;
  if cooldown_until_ms is not null then
    remaining:=5;
  else
    restored:=greatest(0,floor((now_ms-updated_at_ms)/1000.0)::integer);
    remaining:=least(5,remaining+restored);
  end if;

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
  cooldown_until_ms:=case when remaining=0 then now_ms+3000 else null end;
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

create or replace function public.get_own_beat_the_bomb_result(
  p_game_show_game_id uuid,
  p_request_id uuid,
  p_request_token uuid
)
returns table(own_pressed_at timestamptz,winner_pressed_at timestamptz,explosion_at timestamptz,winner_team_id uuid)
language plpgsql security definer set search_path=public as $$
declare own_team uuid; selected_game public.game_show_games%rowtype;
begin
  own_team:=public.collaborative_game_team(p_game_show_game_id,p_request_id,p_request_token,'beat-the-bomb');
  select * into selected_game from public.game_show_games where id=p_game_show_game_id;
  return query
  select
    own_press.pressed_at,
    case when selected_game.status='exploded' then winner_press.pressed_at else null end,
    case when selected_game.status='exploded' then selected_game.explode_at else null end,
    case when selected_game.status='exploded' then selected_game.winner_team_id else null end
  from (select 1) seed
  left join public.game_show_game_presses own_press
    on own_press.game_show_game_id=selected_game.id and own_press.team_id=own_team
  left join public.game_show_game_presses winner_press
    on winner_press.game_show_game_id=selected_game.id and winner_press.team_id=selected_game.winner_team_id;
end; $$;

revoke all on function public.get_own_beat_the_bomb_result(uuid,uuid,uuid) from public;
grant execute on function public.get_own_beat_the_bomb_result(uuid,uuid,uuid) to anon,authenticated;

commit;
