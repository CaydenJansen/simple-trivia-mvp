begin;

alter table public.submissions add column speed_points_max integer check (speed_points_max between 50 and 100);
alter table public.bonus_submissions add column speed_points_max integer check (speed_points_max between 50 and 100);

create table public.game_question_speed_timers (
  game_id uuid not null references public.games(id) on delete cascade,
  question_key text not null,
  stage text not null check(stage in ('core','bonus')),
  opened_at timestamptz not null,
  deadline_at timestamptz not null,
  duration_seconds integer not null check(duration_seconds > 0),
  primary key(game_id,question_key,stage)
);
alter table public.game_question_speed_timers enable row level security;
revoke all on public.game_question_speed_timers from public, anon, authenticated;

create function public.maintain_speed_game_clock()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  q public.game_questions%rowtype;
  timer public.game_question_speed_timers%rowtype;
  duration integer; multiplier numeric; opened timestamptz;
begin
  if tg_op='UPDATE' then
    if coalesce(old.settings->>'scoring_mode','classic') is distinct from coalesce(new.settings->>'scoring_mode','classic') then
      raise exception 'Scoring mode is fixed for this game. Start a new game to change it.';
    end if;
    if old.settings->>'scoring_mode'='speed' and coalesce(old.settings->>'auto_run_speed','fast') is distinct from coalesce(new.settings->>'auto_run_speed','fast') then
      raise exception 'Speed-scoring pace is fixed for this game';
    end if;
  elsif coalesce(new.settings->>'scoring_mode','classic') not in ('classic','speed') then
    raise exception 'Unknown scoring mode';
  end if;
  if new.settings->>'scoring_mode' is distinct from 'speed' then return new; end if;
  -- Never accept a clock supplied by a browser. Reuse the original server clock
  -- on reconnect, host refresh, repeated updates or revisiting a question.
  new.settings := new.settings - 'speed_clock';
  if new.status='live' and new.answer_phase='open'
     and new.current_screen in ('single-answer','image-question','multiple-choice','multi-answer','multi-part','ranking') then
    select * into q from public.game_questions where game_id=new.id and question_key=new.current_question_key;
    if q.question_key is null then raise exception 'Question snapshot not found'; end if;
    if new.question_stage='bonus' and q.bonus is null then raise exception 'Question has no bonus'; end if;
    multiplier := case new.settings->>'auto_run_speed' when 'slow' then 1.4 when 'medium' then 1.2 else 1 end;
    duration := case when new.question_stage='bonus' then 30 + (greatest(1,coalesce((q.bonus->>'points')::integer,1))-1)*15
      when q.question_type='ranking' then 30 + (greatest(1,jsonb_array_length(q.correct_answer))-1)*5
      else 30 + (greatest(1,q.points_max)-1)*15 end;
    duration := greatest(1,round(duration*multiplier)::integer);
    opened := clock_timestamp();
    insert into public.game_question_speed_timers(game_id,question_key,stage,opened_at,deadline_at,duration_seconds)
    values(new.id,new.current_question_key,new.question_stage,opened,opened+make_interval(secs=>duration),duration)
    on conflict do nothing;
    select * into timer from public.game_question_speed_timers where game_id=new.id and question_key=new.current_question_key and stage=new.question_stage;
    new.settings := new.settings || jsonb_build_object('speed_clock',jsonb_build_object(
      'key','speed-'||new.current_question_key||'-'||new.question_stage,
      'deadline_ms',extract(epoch from timer.deadline_at)*1000,'duration_seconds',timer.duration_seconds));
  end if;
  return new;
end $$;
create trigger maintain_speed_game_clock before insert or update on public.games
for each row execute function public.maintain_speed_game_clock();

create function public.stamp_speed_submission()
returns trigger language plpgsql security definer set search_path='' as $$
declare game public.games%rowtype; timer public.game_question_speed_timers%rowtype; stage_name text; elapsed numeric;
begin
  if tg_op='UPDATE' and new.answer_text is not distinct from old.answer_text then
    new.speed_points_max := old.speed_points_max;
    return new;
  end if;
  new.speed_points_max := null;
  select * into game from public.games where id=new.game_id;
  if game.settings->>'scoring_mode' is distinct from 'speed' then return new; end if;
  stage_name := case when tg_table_name='bonus_submissions' then 'bonus' else 'core' end;
  if game.status<>'live' or game.answer_phase<>'open' or game.current_question_key is distinct from new.question_key or game.question_stage<>stage_name then
    raise exception 'QUESTION_CHANGED';
  end if;
  select * into timer from public.game_question_speed_timers where game_id=new.game_id and question_key=new.question_key and stage=stage_name;
  if timer.game_id is null or clock_timestamp() > timer.deadline_at + interval '750 milliseconds' then
    raise exception 'QUESTION_CHANGED: answer timer has ended';
  end if;
  elapsed := greatest(0,extract(epoch from clock_timestamp()-timer.opened_at));
  new.speed_points_max := round(100 - 50*least(1,elapsed/timer.duration_seconds))::integer;
  return new;
end $$;
create trigger stamp_speed_submission before insert or update on public.submissions for each row execute function public.stamp_speed_submission();
create trigger stamp_speed_bonus_submission before insert or update on public.bonus_submissions for each row execute function public.stamp_speed_submission();

create function public.normalize_speed_game_reward()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.games where id=new.game_id and settings->>'scoring_mode'='speed')
     and new.game_type<>'in-show-tiebreaker' and coalesce(new.settings->>'reward_type','points')='points' then
    new.settings := new.settings || '{"reward_points":100,"reward_description":null}'::jsonb;
  end if;
  return new;
end $$;
create trigger normalize_speed_game_reward before insert or update on public.game_show_games for each row execute function public.normalize_speed_game_reward();

-- Retain the classic scoring implementations and validations. Public wrappers
-- below convert their awards inside the SAME transaction, including team totals.
alter function public.finalize_question_scoring(uuid,text,jsonb,boolean) rename to finalize_question_scoring_classic;
alter function public.finalize_question_and_bonus_scoring(uuid,text,jsonb,jsonb,boolean) rename to finalize_question_and_bonus_scoring_classic;
alter function public.finalize_auto_run_question_scoring(uuid,text,jsonb,jsonb,boolean) rename to finalize_auto_run_question_scoring_classic;
alter function public.rescore_submission(uuid,jsonb,integer) rename to rescore_submission_classic;
alter function public.rescore_bonus_submission(uuid,jsonb,integer) rename to rescore_bonus_submission_classic;

create function public.assert_scoring_host(p_game_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.games g join public.quizzes q on q.id=g.quiz_id where g.id=p_game_id and q.owner_id=auth.uid() for update of g;
  if not found then raise exception 'Game not found or not owned by current host'; end if;
end $$;

create function public.convert_speed_awards(p_game_id uuid,p_results jsonb,p_bonus boolean default false)
returns integer language plpgsql security definer set search_path='' as $$
declare item jsonb; row_data record; maximum integer; next_points integer; delta integer:=0; table_name text;
begin
  if not exists(select 1 from public.games where id=p_game_id and settings->>'scoring_mode'='speed') then return 0; end if;
  table_name := case when p_bonus then 'bonus_submissions' else 'submissions' end;
  for item in select value from jsonb_array_elements(p_results) loop
    execute format('select * from public.%I where id=$1 and game_id=$2 for update',table_name)
      into row_data using (item->>'submission_id')::uuid,p_game_id;
    if row_data.id is null or row_data.speed_points_max is null then raise exception 'Missing server submission timing'; end if;
    select case when p_bonus then greatest(1,coalesce((bonus->>'points')::integer,1)) else greatest(1,points_max) end into maximum
      from public.game_questions where game_id=p_game_id and question_key=row_data.question_key;
    next_points := round(row_data.points_awarded::numeric / maximum * row_data.speed_points_max)::integer;
    execute format('update public.%I set points_awarded=$1 where id=$2',table_name) using next_points,row_data.id;
    if not p_bonus then
      update public.question_performance_events set points_possible=100 where submission_id=row_data.id;
    end if;
    update public.teams set score=score+next_points-row_data.points_awarded where id=row_data.team_id and game_id=p_game_id;
    delta := delta+next_points-row_data.points_awarded;
  end loop;
  return delta;
end $$;

create function public.finalize_question_scoring(p_game_id uuid,p_question_key text,p_results jsonb,p_reveal boolean default true)
returns integer language plpgsql security definer set search_path='' as $$
declare total integer;
begin
  perform public.assert_scoring_host(p_game_id);
  if p_reveal and exists(select 1 from public.games where id=p_game_id and answer_phase='revealed') then return 0; end if;
  total := public.finalize_question_scoring_classic(p_game_id,p_question_key,p_results,p_reveal);
  return total + public.convert_speed_awards(p_game_id,p_results,false);
end $$;

create function public.finalize_question_and_bonus_scoring(p_game_id uuid,p_question_key text,p_results jsonb,p_bonus_results jsonb default '[]',p_reveal boolean default true)
returns integer language plpgsql security definer set search_path='' as $$
declare total integer;
begin
  perform public.assert_scoring_host(p_game_id);
  total := public.finalize_question_and_bonus_scoring_classic(p_game_id,p_question_key,p_results,p_bonus_results,p_reveal);
  return total + public.convert_speed_awards(p_game_id,p_bonus_results,true);
end $$;

create function public.finalize_auto_run_question_scoring(p_game_id uuid,p_question_key text,p_results jsonb default '[]',p_bonus_results jsonb default '[]',p_reveal boolean default true)
returns integer language plpgsql security definer set search_path='' as $$
declare total integer;
begin
  perform public.assert_scoring_host(p_game_id);
  total := public.finalize_auto_run_question_scoring_classic(p_game_id,p_question_key,p_results,p_bonus_results,p_reveal);
  return total + public.convert_speed_awards(p_game_id,p_results,false) + public.convert_speed_awards(p_game_id,p_bonus_results,true);
end $$;

create function public.rescore_submission(p_submission_id uuid,p_grading_json jsonb,p_points_awarded integer)
returns public.submissions language plpgsql security definer set search_path='' as $$
declare result public.submissions%rowtype;
begin
  select * into result from public.submissions where id=p_submission_id;
  perform public.assert_scoring_host(result.game_id);
  result := public.rescore_submission_classic(p_submission_id,p_grading_json,p_points_awarded);
  perform public.convert_speed_awards(result.game_id,jsonb_build_array(jsonb_build_object('submission_id',result.id)),false);
  select * into result from public.submissions where id=p_submission_id;
  return result;
end $$;
create function public.rescore_bonus_submission(p_submission_id uuid,p_grading_json jsonb,p_points_awarded integer)
returns public.bonus_submissions language plpgsql security definer set search_path='' as $$
declare result public.bonus_submissions%rowtype;
begin
  select * into result from public.bonus_submissions where id=p_submission_id;
  perform public.assert_scoring_host(result.game_id);
  result := public.rescore_bonus_submission_classic(p_submission_id,p_grading_json,p_points_awarded);
  perform public.convert_speed_awards(result.game_id,jsonb_build_array(jsonb_build_object('submission_id',result.id)),true);
  select * into result from public.bonus_submissions where id=p_submission_id;
  return result;
end $$;

revoke all on function public.maintain_speed_game_clock(),public.stamp_speed_submission(),public.normalize_speed_game_reward(),
  public.assert_scoring_host(uuid),public.convert_speed_awards(uuid,jsonb,boolean),
  public.finalize_question_scoring_classic(uuid,text,jsonb,boolean),public.finalize_question_and_bonus_scoring_classic(uuid,text,jsonb,jsonb,boolean),
  public.finalize_auto_run_question_scoring_classic(uuid,text,jsonb,jsonb,boolean),public.rescore_submission_classic(uuid,jsonb,integer),public.rescore_bonus_submission_classic(uuid,jsonb,integer)
  from public,anon,authenticated;
revoke all on function public.finalize_question_scoring(uuid,text,jsonb,boolean),public.finalize_question_and_bonus_scoring(uuid,text,jsonb,jsonb,boolean),
  public.finalize_auto_run_question_scoring(uuid,text,jsonb,jsonb,boolean),public.rescore_submission(uuid,jsonb,integer),public.rescore_bonus_submission(uuid,jsonb,integer)
  from public,anon;
grant execute on function public.finalize_question_scoring(uuid,text,jsonb,boolean),public.finalize_question_and_bonus_scoring(uuid,text,jsonb,jsonb,boolean),
  public.finalize_auto_run_question_scoring(uuid,text,jsonb,jsonb,boolean),public.rescore_submission(uuid,jsonb,integer),public.rescore_bonus_submission(uuid,jsonb,integer)
  to authenticated;

commit;
