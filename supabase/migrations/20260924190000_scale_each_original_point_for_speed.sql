begin;

-- Each original earned point retains its value, scaled by the speed factor.
create or replace function public.convert_speed_awards(p_game_id uuid,p_results jsonb,p_bonus boolean default false)
returns integer language plpgsql security definer set search_path='' as $$
declare
  item jsonb; maximum integer; next_points integer; delta integer:=0; table_name text;
  target_submission_id uuid; target_team_id uuid; target_question_key text; awarded integer; speed_max integer;
begin
  if not exists(select 1 from public.games where id=p_game_id and settings->>'scoring_mode'='speed') then return 0; end if;
  table_name := case when p_bonus then 'bonus_submissions' else 'submissions' end;
  for item in select value from jsonb_array_elements(p_results) loop
    execute format('select id,team_id,question_key,points_awarded,speed_points_max from public.%I where id=$1 and game_id=$2 for update',table_name)
      into target_submission_id,target_team_id,target_question_key,awarded,speed_max using (item->>'submission_id')::uuid,p_game_id;
    if target_submission_id is null or speed_max is null then raise exception 'Missing server submission timing'; end if;
    select case when p_bonus then greatest(1,coalesce((q.bonus->>'points')::integer,1)) else greatest(1,q.points_max) end into maximum
      from public.game_questions q where q.game_id=p_game_id and q.question_key=target_question_key;
    next_points := round(awarded::numeric * speed_max)::integer;
    execute format('update public.%I set points_awarded=$1 where id=$2',table_name) using next_points,target_submission_id;
    if not p_bonus then
      update public.question_performance_events e set points_possible=maximum*100 where e.submission_id=target_submission_id;
    end if;
    update public.teams t set score=t.score+next_points-awarded where t.id=target_team_id and t.game_id=p_game_id;
    delta := delta+next_points-awarded;
  end loop;
  return delta;
end $$;

revoke all on function public.convert_speed_awards(uuid,jsonb,boolean) from public,anon,authenticated;

-- The original editable game prize is 1..100 classic points, so its speed-mode
-- equivalent can be 100..10000. Keep the base in the frozen snapshot to prevent
-- multiplying it again on each runtime update.
alter table public.game_show_games drop constraint game_show_games_reward_points_awarded_check;
alter table public.game_show_games add constraint game_show_games_reward_points_awarded_check
  check (reward_points_awarded between 0 and 10000);

create or replace function public.normalize_speed_game_reward()
returns trigger language plpgsql security definer set search_path='' as $$
declare base_points integer;
begin
  if exists(select 1 from public.games where id=new.game_id and settings->>'scoring_mode'='speed')
     and new.game_type<>'in-show-tiebreaker' and coalesce(new.settings->>'reward_type','points')='points' then
    if tg_op='INSERT' then
      base_points := least(100,greatest(1,coalesce((new.settings->>'reward_points')::integer,1)));
    else
      -- Older speed snapshots used a fixed 100-point prize and lack this marker.
      base_points := least(100,greatest(1,coalesce((old.settings->>'speed_reward_base_points')::integer,1)));
    end if;
    new.settings := new.settings || jsonb_build_object('speed_reward_base_points',base_points,
      'reward_type','points','reward_points',base_points*100,'reward_description',null);
  end if;
  return new;
end $$;
revoke all on function public.normalize_speed_game_reward() from public,anon,authenticated;

create or replace function public.beat_the_bomb_reward_points(p_settings jsonb)
returns integer language sql immutable set search_path='' as $$
  select case when p_settings->>'reward_type'='points'
    and coalesce(p_settings->>'reward_points','') ~ '^[0-9]+$'
    then least(case when p_settings ? 'speed_reward_base_points' then 10000 else 100 end,
      greatest(1,(p_settings->>'reward_points')::integer))
    else 0 end;
$$;
revoke all on function public.beat_the_bomb_reward_points(jsonb) from public;
commit;
