begin;

-- Explicit fields also let the database's static checker validate this dynamic
-- core/bonus-table query. The award calculation is unchanged.
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
    next_points := round(awarded::numeric / maximum * speed_max)::integer;
    execute format('update public.%I set points_awarded=$1 where id=$2',table_name) using next_points,target_submission_id;
    if not p_bonus then
      update public.question_performance_events e set points_possible=100 where e.submission_id=target_submission_id;
    end if;
    update public.teams t set score=t.score+next_points-awarded where t.id=target_team_id and t.game_id=p_game_id;
    delta := delta+next_points-awarded;
  end loop;
  return delta;
end $$;

revoke all on function public.convert_speed_awards(uuid,jsonb,boolean) from public,anon,authenticated;
commit;
