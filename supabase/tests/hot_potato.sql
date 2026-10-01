-- Run with the migration in a transaction ending in ROLLBACK. No real game data.
do $$
declare h uuid:=gen_random_uuid(); q uuid; g uuid; sg uuid; ids uuid[]:='{}'; req uuid; token uuid:=gen_random_uuid(); op uuid:=gen_random_uuid();
  a uuid; b uuid; c uuid; potato uuid; second_potato uuid; r public.game_show_games; response jsonb; banked numeric; points integer; rejected boolean; i integer;
begin
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(h,h||'@hot-potato.invalid','{}','{}');
  perform set_config('request.jwt.claim.sub',h::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',h,'role','authenticated')::text,true);
  insert into public.quizzes(owner_id,title,status) values(h,'Hot Potato fixture','ready') returning id into q;
  insert into public.quiz_questions(quiz_id,question_key,position,item_position,round_number,round_position,round_question_count,round_title,prompt,question_type,correct_answer,accepted_answers,points_max)
    values(q,'q1',1,1,1,1,1,'Test','Question','single-answer','"Answer"','[]',1);
  insert into public.quiz_show_games(quiz_id,show_game_key,item_position,round_number,round_title,game_type,title,settings)
    values(q,'potato',2,1,'Test','hot-potato','Hot Potato','{"reward_type":"points","reward_points":2}');
  select game_id into g from public.create_game_from_quiz_with_show_games(q,'{}');
  select id into sg from public.game_show_games where game_id=g and show_game_key='potato';
  if sg is null then raise exception 'Game snapshot lost Hot Potato'; end if;
  update public.games set status='live',current_screen='show-game',current_show_game_key='potato' where id=g;
  for i in 1..6 loop
    insert into public.teams(game_id,name,last_seen_at) values(g,'Team '||i,clock_timestamp()) returning id into a;
    ids:=array_append(ids,a);
  end loop;
  a:=ids[1]; b:=ids[2]; c:=ids[3];
  insert into public.team_join_requests(game_id,requested_name,name_key,status,team_id,request_token) values(g,'Team 1','team 1','approved',a,token) returning id into req;
  r:=public.start_hot_potato(sg);
  if r.status<>'open' or r.explode_at-r.started_at<>interval '90 seconds' or (select count(*) from public.hot_potatoes where game_show_game_id=sg)<>2 then raise exception 'Start/count/timer wrong'; end if;
  perform public.start_hot_potato(sg);
  if (select count(*) from public.hot_potatoes where game_show_game_id=sg)<>2 then raise exception 'Start retry duplicated potatoes'; end if;
  update public.hot_potatoes set holder_id=a,born_at=clock_timestamp()-interval '2 seconds',received_at=clock_timestamp()-interval '1 second',burst_at=clock_timestamp()+interval '20 seconds' where game_show_game_id=sg;
  update public.hot_potato_rounds set accrued_at=clock_timestamp()-interval '3 seconds' where game_show_game_id=sg;
  r:=public.sync_hot_potato(sg,true);
  if (select pending from public.hot_potato_teams where game_show_game_id=sg and team_id=a)<6 then raise exception 'Multiple potato accrual wrong'; end if;
  select id into potato from public.hot_potatoes where game_show_game_id=sg order by id limit 1;
  select id into second_potato from public.hot_potatoes where game_show_game_id=sg and id<>potato;
  response:=public.pass_hot_potato(sg,req,token,potato,b,op);
  if response->>'outcome'<>'passed' or (select s.banked from public.hot_potato_teams s where game_show_game_id=sg and team_id=a)<>0 then raise exception 'Banked before all potatoes passed'; end if;
  response:=public.pass_hot_potato(sg,req,token,potato,b,op);
  if response->>'outcome'<>'already-passed' then raise exception 'Retry not idempotent'; end if;
  response:=public.pass_hot_potato(sg,req,token,second_potato,c,gen_random_uuid());
  select s.banked into banked from public.hot_potato_teams s where game_show_game_id=sg and team_id=a;
  if banked<6 or (select pending from public.hot_potato_teams where game_show_game_id=sg and team_id=a)<>0 then raise exception 'Final pass did not bank'; end if;
  if (select born_at from public.hot_potatoes where id=potato)>clock_timestamp()-interval '1 second' then raise exception 'Pass reset potato age'; end if;
  rejected:=false;
  begin perform public.pass_hot_potato(sg,req,gen_random_uuid(),potato,b,gen_random_uuid()); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Invalid admission accepted'; end if;
  rejected:=false;
  begin perform public.pass_hot_potato(sg,req,token,potato,a,gen_random_uuid()); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Self pass accepted'; end if;
  update public.hot_potatoes set holder_id=a,burst_at=clock_timestamp()-interval '0.1 seconds' where id=potato;
  update public.hot_potato_teams set pending=9 where game_show_game_id=sg and team_id=a;
  update public.hot_potato_rounds set accrued_at=clock_timestamp()-interval '0.2 seconds' where game_show_game_id=sg;
  r:=public.sync_hot_potato(sg,true);
  if (select pending from public.hot_potato_teams where game_show_game_id=sg and team_id=a)<>0 or (select bursts from public.hot_potato_teams where game_show_game_id=sg and team_id=a)<>1 then raise exception 'Explosion did not clear pending'; end if;
  if (select s.banked from public.hot_potato_teams s where game_show_game_id=sg and team_id=a)<>banked then raise exception 'Explosion removed banked points'; end if;
  if (select count(*) from public.hot_potatoes where game_show_game_id=sg)<>2 or exists(select 1 from public.hot_potatoes where game_show_game_id=sg and holder_id=a) then raise exception 'Replacement count/recipient wrong'; end if;
  select * into r from public.get_owned_player_show_game(g,a,'potato',req,token);
  if r.settings::text like '%burst_at%' then raise exception 'Explosion secrets exposed'; end if;
  if has_table_privilege('anon','public.hot_potatoes','SELECT') or has_function_privilege('anon','public.sync_hot_potato(uuid,boolean)','EXECUTE') then raise exception 'Private state is accessible'; end if;
  update public.hot_potato_teams set pending=1000 where game_show_game_id=sg and team_id=b;
  update public.game_show_games set explode_at=clock_timestamp()-interval '0.01 seconds' where id=sg;
  r:=public.advance_hot_potato(sg);
  if r.status<>'exploded' or r.winner_team_id<>a then raise exception 'Wrong winner or failed to finish'; end if;
  if exists(select 1 from public.hot_potato_teams where game_show_game_id=sg and pending<>0) then raise exception 'Buzzer banked pending'; end if;
  select score into points from public.teams where id=a;
  perform public.advance_hot_potato(sg);
  if points<>2 or (select score from public.teams where id=a)<>points then raise exception 'Reward not exactly once'; end if;
  if (select settings from public.quiz_show_games where quiz_id=q and show_game_key='potato') ? 'hot_potato' then raise exception 'Live state leaked into quiz'; end if;

  -- Speed mode scales only the configured reward; custom prizes award no quiz points.
  for i in 1..2 loop
    if i=2 then update public.quiz_show_games set settings='{"reward_type":"custom","reward_points":0,"reward_description":"A prize"}' where quiz_id=q; end if;
    select game_id into g from public.create_game_from_quiz_with_show_games(q,'{"scoring_mode":"speed"}');
    select id into sg from public.game_show_games where game_id=g and show_game_key='potato';
    update public.games set status='live',current_screen='show-game',current_show_game_key='potato' where id=g;
    insert into public.teams(game_id,name,last_seen_at) values(g,'A',clock_timestamp()) returning id into a;
    insert into public.teams(game_id,name,last_seen_at) values(g,'B',clock_timestamp()) returning id into b;
    r:=public.start_hot_potato(sg);
    if (select count(*) from public.hot_potatoes where game_show_game_id=sg)<>1 then raise exception 'Small room count wrong'; end if;
    update public.hot_potato_teams set banked=5 where game_show_game_id=sg and team_id=a;
    update public.game_show_games set explode_at=clock_timestamp()-interval '0.01 seconds' where id=sg;
    r:=public.advance_hot_potato(sg);
    perform public.advance_hot_potato(sg);
    if (select score from public.teams where id=a)<>(case when i=1 then 200 else 0 end) then raise exception 'Speed/custom reward incorrect'; end if;
  end loop;
end; $$;
