begin;
set local statement_timeout='20s';
do $$
declare
  host_id uuid:=gen_random_uuid(); quiz uuid; game uuid; classic_game uuid;
  team_a uuid; team_b uuid; team_c uuid; s1 uuid; s2 uuid; s3 uuid; bonus_id uuid; show_id uuid;
  timer_before timestamptz; denied boolean; outcome integer;
begin
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(host_id,host_id||'@speed-test.invalid','{}','{}');
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',host_id,'role','authenticated')::text,true);
  insert into public.quizzes(title,status,owner_id) values('Speed scoring rollback test','ready',host_id) returning id into quiz;
  insert into public.quiz_questions(quiz_id,question_key,position,item_position,round_number,round_position,round_question_count,round_title,prompt,question_type,correct_answer,accepted_answers,points_max,bonus)
  values(quiz,'q1',1,1,1,1,1,'Test','Name two planets','multi-answer','["Mercury","Venus"]','[[],[]]',2,'{"prompt":"Bonus planet?","correct_answer":"Mars","points":1}');
  select game_id into game from public.create_game_from_quiz(quiz,'{"scoring_mode":"speed","auto_run_speed":"medium"}');
  select game_id into classic_game from public.create_game_from_quiz(quiz,'{}');
  assert not exists(select 1 from public.game_question_speed_timers where game_id=game), 'Timer started in lobby';
  update public.games set status='live',current_screen='multi-answer',answer_phase='open',answer_editing_allowed=true where id=game;
  assert (select duration_seconds=54 from public.game_question_speed_timers where game_id=game and stage='core'), 'Wrong normal-speed duration';
  select opened_at into timer_before from public.game_question_speed_timers where game_id=game and stage='core';
  update public.games set settings=settings || '{"speed_clock":{"deadline_ms":9999999999999}}'::jsonb where id=game;
  assert (select opened_at=timer_before from public.game_question_speed_timers where game_id=game and stage='core'), 'Clock restarted on settings update';
  update public.games set answer_phase='closed' where id=game;
  update public.games set answer_phase='open' where id=game;
  assert (select opened_at=timer_before from public.game_question_speed_timers where game_id=game and stage='core'), 'Reopening reset the timer';
  denied:=false;
  begin update public.games set settings=settings||'{"scoring_mode":"classic"}'::jsonb where id=game; exception when raise_exception then denied:=true; end;
  assert denied, 'Scoring mode changed mid-game';
  denied:=false;
  begin update public.games set settings=settings||'{"auto_run_speed":"slow"}'::jsonb where id=game; exception when raise_exception then denied:=true; end;
  assert denied, 'Timer speed changed mid-game';
  insert into public.teams(game_id,name) values(game,'Fast') returning id into team_a;
  insert into public.teams(game_id,name) values(game,'Edited') returning id into team_b;
  insert into public.teams(game_id,name) values(game,'Partial') returning id into team_c;
  s1:=public.submit_player_answer(game,team_a,'q1','["Mercury","Venus"]');
  s2:=public.submit_player_answer(game,team_b,'q1','["Placeholder"]');
  assert (select speed_points_max=100 from public.submissions where id=s1), 'Immediate answer did not earn 100';
  update public.game_question_speed_timers set opened_at=clock_timestamp()-interval '27 seconds',deadline_at=clock_timestamp()+interval '27 seconds' where game_id=game and stage='core';
  perform public.submit_player_answer(game,team_b,'q1','["Mercury","Venus"]');
  assert (select speed_points_max=75 from public.submissions where id=s2), 'Answer update retained early points';
  update public.submissions set speed_points_max=100 where id=s2;
  assert (select speed_points_max=75 from public.submissions where id=s2), 'Client could forge timing';
  update public.game_question_speed_timers set opened_at=clock_timestamp()-interval '54 seconds',deadline_at=clock_timestamp() where game_id=game and stage='core';
  s3:=public.submit_player_answer(game,team_c,'q1','["Venus",""]');
  assert (select speed_points_max=50 from public.submissions where id=s3), 'Deadline floor was not 50';
  update public.game_question_speed_timers set deadline_at=clock_timestamp()-interval '2 seconds' where game_id=game and stage='core';
  denied:=false;
  begin perform public.submit_player_answer(game,team_c,'q1','["Mercury","Venus"]'); exception when raise_exception then denied:=true; end;
  assert denied, 'Late answer was accepted';
  update public.games set answer_phase='closed' where id=game;
  outcome:=public.finalize_question_scoring(game,'q1',jsonb_build_array(
    jsonb_build_object('submission_id',s1,'points_awarded',2,'is_correct',true,'grading_json','{"items":[{"status":"correct"},{"status":"correct"}]}'::jsonb),
    jsonb_build_object('submission_id',s2,'points_awarded',2,'is_correct',true,'grading_json','{"items":[{"status":"correct"},{"status":"correct"}]}'::jsonb),
    jsonb_build_object('submission_id',s3,'points_awarded',1,'is_correct',false,'grading_json','{"items":[{"status":"correct"}],"missing":["Mercury"]}'::jsonb)),false);
  assert outcome=400, 'Wrong total speed award';
  assert (select score=200 from public.teams where id=team_a), 'Fast team score wrong';
  assert (select score=150 from public.teams where id=team_b), 'Edited team score wrong';
  assert (select score=50 from public.teams where id=team_c), 'Partial team score wrong';
  assert (select is_correct from public.submissions where id=s2), 'Slow correct answer marked wrong';
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  denied:=false;
  begin perform public.rescore_submission(s3,'{"items":[]}',2); exception when raise_exception then denied:=true; end;
  assert denied, 'Another host could change the speed score';
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  perform public.rescore_submission(s3,'{"items":[{"status":"correct"},{"status":"correct"}]}',2);
  perform public.rescore_submission(s3,'{"items":[{"status":"correct"},{"status":"correct"}]}',2);
  assert (select score=100 from public.teams where id=team_c), 'Rescore lost timing or duplicated points';
  update public.games set question_stage='bonus',answer_phase='open' where id=game;
  bonus_id:=public.submit_player_bonus_answer(game,team_a,'q1','Mars');
  update public.games set answer_phase='closed' where id=game;
  perform public.finalize_question_and_bonus_scoring(game,'q1','[]',jsonb_build_array(jsonb_build_object('submission_id',bonus_id,'points_awarded',1,'is_correct',true,'grading_json','{"items":[{"status":"correct"}]}'::jsonb)),true);
  assert (select score=300 from public.teams where id=team_a), 'Bonus score conversion failed';
  perform public.rescore_bonus_submission(bonus_id,'{"items":[{"status":"incorrect"}]}',0);
  assert (select score=200 from public.teams where id=team_a), 'Bonus correction failed';
  assert public.finalize_question_scoring(game,'q1',jsonb_build_array(jsonb_build_object('submission_id',s1)),true)=0, 'Duplicate reveal was not idempotent';
  assert (select score=200 from public.teams where id=team_a), 'Duplicate reveal inflated points';
  assert not has_function_privilege('authenticated','public.convert_speed_awards(uuid,jsonb,boolean)','execute'), 'Private score conversion exposed';
  assert not has_function_privilege('authenticated','public.finalize_question_scoring_classic(uuid,text,jsonb,boolean)','execute'), 'Classic bypass exposed';

  insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title,settings)
  values(game,'wheel',2,1,'Test','spin-the-wheel','Wheel','{"reward_type":"points","reward_points":1}') returning id into show_id;
  assert (select (settings->>'reward_points')::integer=100 from public.game_show_games where id=show_id), 'Game reward not converted';
  update public.game_show_games set status='open',explode_at=clock_timestamp()-interval '1 second',settings=settings||jsonb_build_object('eligible_team_ids',jsonb_build_array(team_a)) where id=show_id;
  perform public.resolve_spin_the_wheel(show_id);
  perform public.resolve_spin_the_wheel(show_id);
  assert (select score=300 from public.teams where id=team_a), 'Game winner did not receive exactly 100 points';
  insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title,settings)
  values(game,'weighted',6,1,'Test','spin-the-wheel','Five-point wheel','{"reward_type":"points","reward_points":5}') returning id into show_id;
  update public.game_show_games set status='open',explode_at=clock_timestamp()-interval '1 second',settings=settings||jsonb_build_object('eligible_team_ids',jsonb_build_array(team_a)) where id=show_id;
  assert (select (settings->>'reward_points')::integer=500 from public.game_show_games where id=show_id), 'Runtime update multiplied reward again';
  perform public.resolve_spin_the_wheel(show_id);
  perform public.resolve_spin_the_wheel(show_id);
  assert (select score=800 from public.teams where id=team_a), 'Five-point game did not award exactly 500';
  insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title,settings)
  values(game,'custom',3,1,'Test','spin-the-wheel','Custom prize','{"reward_type":"custom","reward_description":"A mug","reward_points":0}');
  assert (select settings->>'reward_description'='A mug' and settings->>'reward_points'='0' from public.game_show_games where game_id=game and show_game_key='custom'), 'Custom prize changed';
  insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title,settings)
  values(game,'tie',4,1,'Test','in-show-tiebreaker','Tie','{"reward_type":"points","reward_points":0}');
  assert (select settings->>'reward_points'='0' from public.game_show_games where game_id=game and show_game_key='tie'), 'Tiebreaker became a points game';
  insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title,settings)
  values(game,'legacy',5,1,'Test','spin-the-wheel','Legacy points reward','{}');
  assert (select settings->>'reward_points'='100' from public.game_show_games where game_id=game and show_game_key='legacy'), 'Default game reward not converted';

  -- Fresh composite and Auto-Run scoring both use the same conversion path.
  select game_id into game from public.create_game_from_quiz(quiz,'{"scoring_mode":"speed"}');
  update public.games set status='live',current_screen='multi-answer',answer_phase='open' where id=game;
  insert into public.teams(game_id,name) values(game,'Composite') returning id into team_b;
  s2:=public.submit_player_answer(game,team_b,'q1','["Mercury","Venus"]');
  update public.games set question_stage='bonus' where id=game;
  bonus_id:=public.submit_player_bonus_answer(game,team_b,'q1','Mars');
  update public.games set answer_phase='closed' where id=game;
  perform public.finalize_question_and_bonus_scoring(game,'q1',jsonb_build_array(jsonb_build_object('submission_id',s2,'points_awarded',2,'is_correct',true,'grading_json','{"items":[]}'::jsonb)),jsonb_build_array(jsonb_build_object('submission_id',bonus_id,'points_awarded',1,'is_correct',true,'grading_json','{"items":[]}'::jsonb)),true);
  assert (select score=300 from public.teams where id=team_b), 'Composite scorer did not convert both stages';
  select game_id into game from public.create_game_from_quiz(quiz,'{"scoring_mode":"speed"}');
  update public.games set status='live',current_screen='multi-answer',answer_phase='open' where id=game;
  insert into public.teams(game_id,name) values(game,'Auto run') returning id into team_b;
  s2:=public.submit_player_answer(game,team_b,'q1','["Mercury","Venus"]');
  update public.games set answer_phase='closed' where id=game;
  perform public.finalize_auto_run_question_scoring(game,'q1',jsonb_build_array(jsonb_build_object('submission_id',s2,'points_awarded',2,'is_correct',true,'grading_json','{"items":[]}'::jsonb)),'[]',false);
  assert (select score=200 from public.teams where id=team_b), 'Auto-Run did not convert points';

  update public.games set status='live',current_screen='multi-answer',answer_phase='open' where id=classic_game;
  insert into public.teams(game_id,name) values(classic_game,'Classic') returning id into team_a;
  s1:=public.submit_player_answer(classic_game,team_a,'q1','["Mercury","Venus"]');
  update public.games set answer_phase='closed' where id=classic_game;
  perform public.finalize_auto_run_question_scoring(classic_game,'q1',jsonb_build_array(jsonb_build_object('submission_id',s1,'points_awarded',2,'is_correct',true,'grading_json','{"items":[]}'::jsonb)),'[]',true);
  assert (select score=2 from public.teams where id=team_a), 'Classic scoring changed';

  -- A seven-pointer keeps all seven points; a later host correction retains
  -- the original speed factor, rather than dividing by the question maximum.
  update public.quiz_questions set points_max=7,correct_answer='["a","b","c","d","e","f","g"]',bonus=null
    where quiz_id=quiz and question_key='q1';
  select game_id into game from public.create_game_from_quiz(quiz,'{"scoring_mode":"speed"}');
  update public.games set status='live',current_screen='multi-answer',answer_phase='open' where id=game;
  insert into public.teams(game_id,name) values(game,'Seven pointer') returning id into team_a;
  s1:=public.submit_player_answer(game,team_a,'q1','["a","b","c","d","e","f","g"]');
  update public.games set answer_phase='closed' where id=game;
  perform public.finalize_question_scoring(game,'q1',jsonb_build_array(jsonb_build_object('submission_id',s1,'points_awarded',7,'is_correct',true,'grading_json','{"items":[]}'::jsonb)),true);
  assert (select score=700 from public.teams where id=team_a), 'Seven-pointer did not award 700';
  perform public.rescore_submission(s1,'{"items":[{"status":"correct"},{"status":"correct"},{"status":"correct"}]}',3);
  assert (select score=300 from public.teams where id=team_a), 'Partial seven-pointer did not award 300';

  -- Per-position ranker: three original points at the 80-point speed factor.
  update public.quiz_questions set question_type='ranking' where quiz_id=quiz and question_key='q1';
  select game_id into game from public.create_game_from_quiz(quiz,'{"scoring_mode":"speed"}');
  update public.games set status='live',current_screen='ranking',answer_phase='open' where id=game;
  update public.game_question_speed_timers set opened_at=clock_timestamp()-interval '24 seconds',deadline_at=clock_timestamp()+interval '36 seconds' where game_id=game;
  insert into public.teams(game_id,name) values(game,'Ranker') returning id into team_a;
  s1:=public.submit_player_answer(game,team_a,'q1','["a","b","c","e","f","g","d"]');
  update public.games set answer_phase='closed' where id=game;
  perform public.finalize_question_scoring(game,'q1',jsonb_build_array(jsonb_build_object('submission_id',s1,'points_awarded',3,'is_correct',false,'grading_json','{"items":[]}'::jsonb)),true);
  assert (select score=240 from public.teams where id=team_a), 'Per-position ranker did not award 3 times 80';
end $$;
select 'Speed scoring regression checks passed (rolled back)' as result;
rollback;
