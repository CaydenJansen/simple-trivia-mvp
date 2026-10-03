begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table public.practice_sessions (
  game_id uuid primary key references public.games(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  paused boolean not null default false,
  last_tick_at timestamptz,
  unique(owner_id,operation_id)
);
create table public.practice_bots (
  team_id uuid primary key references public.teams(id) on delete cascade,
  game_id uuid not null references public.practice_sessions(game_id) on delete cascade,
  request_id uuid not null references public.team_join_requests(id) on delete cascade,
  request_token uuid not null,
  next_action_at timestamptz not null default clock_timestamp()
);
alter table public.practice_sessions enable row level security;
alter table public.practice_bots enable row level security;
revoke all on public.practice_sessions,public.practice_bots from public,anon,authenticated;

-- Never allow a rehearsal to become a real show (or vice versa) later.
create function public.guard_practice_mode() returns trigger
language plpgsql set search_path='' as $$
begin
  if (new.settings->>'practice_mode'='true') is distinct from (old.settings->>'practice_mode'='true')
     and coalesce(new.settings->>'practice_mode','false')<>coalesce(old.settings->>'practice_mode','false') then
    raise exception 'Practice mode cannot be changed after creating a game';
  end if;
  return new;
end; $$;
create trigger guard_practice_mode before update of settings on public.games
for each row execute function public.guard_practice_mode();

create function public.create_practice_game(p_quiz_id uuid,p_settings jsonb,p_team_count integer,p_operation_id uuid)
returns table(game_id uuid,game_code text,game_title text)
language plpgsql security definer set search_path='' as $$
declare created record; previous uuid; i integer; t uuid; r uuid; token uuid; label text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_team_count is null or p_team_count not between 2 and 12 or p_operation_id is null then raise exception 'Choose between 2 and 12 simulated teams'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_operation_id::text,0));
  select s.game_id into previous from public.practice_sessions s where s.owner_id=auth.uid() and s.operation_id=p_operation_id;
  if previous is not null then return query select g.id,g.code,g.title from public.games g where g.id=previous; return; end if;
  if not exists(select 1 from public.quizzes where id=p_quiz_id and owner_id=auth.uid() and status='ready') then raise exception 'Choose one of your ready quizzes'; end if;
  select * into created from public.create_game_from_quiz_with_show_games(p_quiz_id,coalesce(p_settings,'{}')||'{"practice_mode":true}');
  insert into public.practice_sessions(game_id,owner_id,operation_id) values(created.game_id,auth.uid(),p_operation_id);
  for i in 1..p_team_count loop
    label:='Practice Team '||i; token:=gen_random_uuid();
    insert into public.teams(game_id,name,last_seen_at) values(created.game_id,label,clock_timestamp()) returning id into t;
    insert into public.team_join_requests(game_id,requested_name,name_key,status,team_id,request_token)
      values(created.game_id,label,lower(label),'approved',t,token) returning id into r;
    insert into public.practice_bots(team_id,game_id,request_id,request_token,next_action_at)
      values(t,created.game_id,r,token,clock_timestamp()+make_interval(secs=>i));
  end loop;
  return query select created.game_id,created.game_code,created.game_title;
end; $$;

create function public.control_practice_game(p_game_id uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.games g join public.practice_sessions s on s.game_id=g.id
    where g.id=p_game_id and s.owner_id=auth.uid() for update of g;
  if not found then raise exception 'Practice session not owned by current host'; end if;
  if p_action='stop' then
    update public.games set status='cancelled' where id=p_game_id and status in ('lobby','live');
  elsif p_action in ('pause','resume') then
    update public.practice_sessions set paused=(p_action='pause') where game_id=p_game_id;
  else raise exception 'Invalid practice action'; end if;
end; $$;

-- Uses the exact player RPCs: timing, eligibility, ownership, grading and rewards
-- remain authoritative. No bot receives a future fuse or random game outcome.
create function public.tick_practice_game(p_game_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.games; session public.practice_sessions; bot public.practice_bots;
  q public.game_questions; sg public.game_show_games; potato record; target uuid;
  answer jsonb; response text; choice text; attempt public.game_tiebreaker_attempts;
  actions integer:=0; failures integer:=0; bonus boolean;
begin
  select ga.* into g from public.games ga join public.practice_sessions s on s.game_id=ga.id
    where ga.id=p_game_id and s.owner_id=auth.uid() for update of ga;
  if g.id is null then raise exception 'Practice session not owned by current host'; end if;
  select * into session from public.practice_sessions where game_id=g.id for update;
  if session.paused or g.status not in ('lobby','live') or session.last_tick_at>clock_timestamp()-interval '450 milliseconds' then
    return jsonb_build_object('actions',0,'failures',0,'paused',session.paused);
  end if;
  update public.practice_sessions set last_tick_at=clock_timestamp() where game_id=g.id;
  update public.teams set last_seen_at=clock_timestamp() where id in(select team_id from public.practice_bots where game_id=g.id)
    and last_seen_at<clock_timestamp()-interval '30 seconds';
  if g.status<>'live' then return jsonb_build_object('actions',0,'failures',0); end if;
  select * into q from public.game_questions where game_id=g.id and question_key=g.current_question_key;
  select * into sg from public.game_show_games where game_id=g.id and show_game_key=g.current_show_game_key;
  select * into attempt from public.game_tiebreaker_attempts where id=g.current_tiebreaker_attempt_id and status='open';
  for bot in select * from public.practice_bots where game_id=g.id and next_action_at<=clock_timestamp() order by next_action_at loop
    update public.practice_bots set next_action_at=clock_timestamp()+make_interval(secs=>1+random()*3) where team_id=bot.team_id;
    begin
      if g.current_screen in ('single-answer','image-question','multiple-choice','multi-answer','multi-part','ranking') and g.answer_phase='open' and q.id is not null then
        bonus:=g.question_stage='bonus';
        if (bonus and exists(select 1 from public.bonus_submissions where game_id=g.id and team_id=bot.team_id and question_key=q.question_key))
          or (not bonus and exists(select 1 from public.submissions where game_id=g.id and team_id=bot.team_id and question_key=q.question_key)) then continue; end if;
        answer:=case when bonus then coalesce(q.bonus->'answer',q.bonus->'correctAnswer',q.bonus->'correct_answer') else q.correct_answer end;
        if jsonb_typeof(answer)='array' then
          if q.question_type='ranking' then
            if random()<0.4 then select jsonb_agg(value order by random()) into answer from jsonb_array_elements(answer); end if;
          else select jsonb_agg(case when random()<0.7 then value else to_jsonb('Practice guess'::text) end order by ord) into answer from jsonb_array_elements(answer) with ordinality a(value,ord); end if;
          response:=answer::text;
        elsif q.question_type='multiple-choice' and not bonus then
          response:=answer#>>'{}';
          if random()<0.3 and jsonb_typeof(q.options)='array' then
            select coalesce(value->>'key',value#>>'{}') into choice from jsonb_array_elements(q.options) order by random() limit 1;
            response:=coalesce(choice,response);
          end if;
        else response:=case when random()<0.7 then coalesce(answer#>>'{}','Practice answer') else 'Practice guess' end; end if;
        perform public.submit_owned_player_answer(g.id,bot.team_id,q.question_key,response,bot.request_id,bot.request_token,bonus);
        actions:=actions+1;
      elsif g.current_screen='show-game' and sg.status='open' then
        case sg.game_type
          when 'hot-potato' then
            for potato in select value from jsonb_array_elements(sg.settings->'hot_potato'->'potatoes') where value->>'holder_id'=bot.team_id::text loop
              select t.id into target from public.teams t where t.game_id=g.id and t.id<>bot.team_id
                and sg.settings->'eligible_team_ids' @> to_jsonb(array[t.id::text]) order by random() limit 1;
              if target is not null then perform public.pass_hot_potato(sg.id,bot.request_id,bot.request_token,(potato.value->>'id')::uuid,target,gen_random_uuid()); end if;
            end loop;
          when 'beat-the-bomb' then
            if clock_timestamp()>sg.started_at+interval '22 seconds' and random()<0.18 and not exists(select 1 from public.game_show_game_presses where game_show_game_id=sg.id and team_id=bot.team_id) then perform public.cut_beat_the_bomb_wire(sg.id,bot.request_id,bot.request_token); end if;
          when 'lowest-bidder' then
            if not exists(select 1 from public.game_show_game_bids where game_show_game_id=sg.id and team_id=bot.team_id) then
              perform public.submit_lowest_bidder_bid(sg.id,bot.request_id,bot.request_token,1+floor(random()*10)::integer);
            end if;
          when 'deal-or-no-deal' then
            if exists(select 1 from public.game_show_game_deals where game_show_game_id=sg.id and team_id=bot.team_id and not locked and decision is null) then
              perform public.submit_deal_or_no_deal_decision(sg.id,bot.request_id,bot.request_token,case when random()<0.55 then 'swap' else 'keep' end);
            end if;
          when 'shared-cursor' then perform public.pull_shared_cursor(sg.id,bot.request_id,bot.request_token);
          when 'heads-or-tails','dodge-the-rock','scissors-paper-rock' then
            if sg.settings->>'round_phase'<>'choosing' or not (sg.settings->'alive_team_ids' @> to_jsonb(array[bot.team_id::text])) then continue; end if;
            choice:=case sg.game_type when 'heads-or-tails' then (array['heads','tails'])[1+floor(random()*2)::integer]
              when 'dodge-the-rock' then floor(random()*3)::integer::text else (array['scissors','paper','rock'])[1+floor(random()*3)::integer] end;
            perform public.submit_elimination_show_game_choice(sg.id,bot.request_id,bot.request_token,choice);
          when 'audience-question','tiebreaker-style-question','in-show-tiebreaker' then
            if not exists(select 1 from public.game_show_game_responses where game_show_game_id=sg.id and team_id=bot.team_id) then
              response:=case when sg.game_type='audience-question' then 'Practice answer from '||(select name from public.teams where id=bot.team_id) else (1+floor(random()*1000))::text end;
              perform public.submit_audience_question_response(sg.id,bot.request_id,bot.request_token,response);
            end if;
          when 'big-balloon' then
            if random()<0.1 then perform public.lock_big_balloon(sg.id,bot.request_id,bot.request_token);
            else perform public.pulse_big_balloon(sg.id,bot.request_id,bot.request_token); end if;
          when 'steal-the-treasure' then perform public.set_steal_the_treasure_holding(sg.id,bot.request_id,bot.request_token,random()<0.6);
          else null;
        end case;
        actions:=actions+1;
      elsif attempt.id is not null and bot.team_id=any(attempt.team_ids) and not exists(select 1 from public.game_tiebreaker_submissions where attempt_id=attempt.id and team_id=bot.team_id) then
        perform public.submit_owned_player_tiebreaker(g.id,bot.team_id,attempt.id,1+floor(random()*1000),bot.request_id,bot.request_token);
        actions:=actions+1;
      end if;
    exception when others then
      -- Expected races (already locked, eliminated, final lane occupied) must not
      -- roll back other bots. Surface a count so hosts can spot repeated failures.
      failures:=failures+1;
    end;
  end loop;
  return jsonb_build_object('actions',actions,'failures',failures,'paused',false);
end; $$;

create function public.get_host_session_health(p_game_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.games; result jsonb;
begin
  select ga.* into g from public.games ga join public.quizzes q on q.id=ga.quiz_id where ga.id=p_game_id and q.owner_id=auth.uid();
  if g.id is null then raise exception 'Game not owned by current host'; end if;
  select jsonb_build_object('game_id',g.id,'code',g.code,'status',g.status,'practice',g.settings->>'practice_mode'='true',
    'server_time',clock_timestamp(),'paused',coalesce((select paused from public.practice_sessions where game_id=g.id),false),
    'answer_phase',g.answer_phase,'screen',g.current_screen,
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'last_seen_at',t.last_seen_at,
      'simulated',exists(select 1 from public.practice_bots b where b.team_id=t.id),
      'submitted',case when g.current_screen not in ('single-answer','image-question','multiple-choice','multi-answer','multi-part','ranking') then null when g.question_stage='bonus' then exists(select 1 from public.bonus_submissions s where s.team_id=t.id and s.game_id=g.id and s.question_key=g.current_question_key)
        else exists(select 1 from public.submissions s where s.team_id=t.id and s.game_id=g.id and s.question_key=g.current_question_key) end) order by t.name)
      from public.teams t where t.game_id=g.id),'[]')) into result;
  return result;
end; $$;

-- Keep practice out of analytics, learning, team history and permanent QR links.
-- Patch only known function bodies, leaving their permission checks intact.
do $isolate$
declare f regprocedure; definition text;
begin
  foreach f in array array['public.get_platform_admin_dashboard()'::regprocedure,'public.get_host_game_count()'::regprocedure,
    'public.get_host_team_stats()'::regprocedure,'public.resolve_host_join_link(text)'::regprocedure] loop
    definition:=pg_get_functiondef(f);
    definition:=replace(definition,'public.games','(select * from public.games where settings->>''practice_mode'' is distinct from ''true'') games');
    if f='public.get_platform_admin_dashboard()'::regprocedure then
      definition:=replace(definition,'(select count(*) from public.teams)','(select count(*) from public.teams t join public.games g on g.id=t.game_id where g.settings->>''practice_mode'' is distinct from ''true'')');
      definition:=replace(definition,'(select count(*) from public.submissions)','(select count(*) from public.submissions s join public.games g on g.id=s.game_id where g.settings->>''practice_mode'' is distinct from ''true'')');
    end if;
    execute definition;
  end loop;
  definition:=pg_get_functiondef('public.question_snapshot_matches_source(uuid,text)'::regprocedure);
  definition:=replace(definition,'where gq.game_id = p_game_id','where not exists(select 1 from public.games where id=p_game_id and settings->>''practice_mode''=''true'') and gq.game_id = p_game_id');
  execute definition;
end; $isolate$;

revoke all on function public.create_practice_game(uuid,jsonb,integer,uuid),public.control_practice_game(uuid,text),public.tick_practice_game(uuid),public.get_host_session_health(uuid) from public,anon;
grant execute on function public.create_practice_game(uuid,jsonb,integer,uuid),public.control_practice_game(uuid,text),public.tick_practice_game(uuid),public.get_host_session_health(uuid) to authenticated;
commit;
