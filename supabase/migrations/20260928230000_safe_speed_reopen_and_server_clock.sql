begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create or replace function public.maintain_speed_game_clock()
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
    if tg_op='UPDATE' and old.answer_phase='closed' and new.answer_phase='open'
      and new.answer_editing_allowed and old.current_question_key=new.current_question_key and old.question_stage=new.question_stage then
      -- Reopening grants an editing window, not a fresh 100-point start.
      update public.game_question_speed_timers set deadline_at=greatest(deadline_at,opened+make_interval(secs=>duration))
      where game_id=new.id and question_key=new.current_question_key and stage=new.question_stage;
    end if;
    select * into timer from public.game_question_speed_timers where game_id=new.id and question_key=new.current_question_key and stage=new.question_stage;
    new.settings := new.settings || jsonb_build_object('speed_clock',jsonb_build_object(
      'key','speed-'||new.current_question_key||'-'||new.question_stage,
      'deadline_ms',extract(epoch from timer.deadline_at)*1000,'opened_at_ms',extract(epoch from timer.opened_at)*1000,'duration_seconds',timer.duration_seconds));
  end if;
  return new;
end $$;
create or replace function public.get_server_epoch_ms() returns numeric language sql volatile set search_path='' as $$
  select extract(epoch from clock_timestamp())*1000;
$$;
revoke all on function public.get_server_epoch_ms() from public;
grant execute on function public.get_server_epoch_ms() to anon,authenticated;
commit;
