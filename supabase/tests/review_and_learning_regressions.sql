begin;
set local statement_timeout = '15s';
do $$
declare
  a uuid := gen_random_uuid(); q uuid; quiz uuid; g uuid; t uuid; s uuid; b uuid; suggestion uuid;
  rev integer; result text; aliases jsonb; rejected boolean := false;
begin
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(a,a||'@regression.invalid','{}','{}');
  insert into public.platform_admins(user_id,role) values(a,'admin');
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  q := public.admin_save_library_question(null,'{"question_type":"multi-answer","prompt":"Rollback alias fixture","correct_answer":["Mercury","Venus"],"accepted_answers":[],"status":"draft"}');
  select revision into rev from public.source_questions where id=q;
  insert into public.question_answer_suggestions(source_question_id,source_revision,answer_slot,proposed_answer,normalized_answer,status)
  values(q,rev,1,'Planet Venus','planet venus','pending') returning id into suggestion;
  result := public.review_answer_suggestion(suggestion,'approved');
  select accepted_answers into aliases from public.source_questions where id=q;
  if result <> 'approved' or aliases <> '[[],["Planet Venus"]]'::jsonb then raise exception 'Missing alias slot approval failed: %', aliases; end if;

  select revision into rev from public.source_questions where id=q;
  insert into public.question_answer_suggestions(source_question_id,source_revision,answer_slot,proposed_answer,normalized_answer,status)
  values(q,rev,2,'Invalid slot','invalid slot','pending') returning id into suggestion;
  begin perform public.review_answer_suggestion(suggestion,'approved');
  exception when others then rejected := sqlerrm = 'Answer slot is outside this question'; end;
  if not rejected then raise exception 'Out-of-range alias slot was accepted'; end if;

  insert into public.question_answer_suggestions(source_question_id,source_revision,answer_slot,proposed_answer,normalized_answer,status)
  values(q,rev,0,'Planet Mercury','planet mercury','pending') returning id into suggestion;
  update public.source_questions set prompt='Changed fixture' where id=q;
  if public.review_answer_suggestion(suggestion,'approved') <> 'stale' then raise exception 'Stale approval was not rejected'; end if;

  q := public.admin_save_library_question(null,'{"question_type":"multi-part","prompt":"Part alias fixture","correct_answer":["Mercury","Venus"],"accepted_answers":[],"options":[{"label":"A","clue":"First planet"},{"label":"B","clue":"Second planet"}],"status":"draft"}');
  select revision into rev from public.source_questions where id=q;
  insert into public.question_answer_suggestions(source_question_id,source_revision,answer_slot,proposed_answer,normalized_answer,status)
  values(q,rev,1,'Planet Venus','planet venus','pending') returning id into suggestion;
  perform public.review_answer_suggestion(suggestion,'approved');
  if not exists(select 1 from public.source_question_parts where source_question_id=q and position=2 and accepted_answers='["Planet Venus"]'::jsonb) then raise exception 'Multipart alias metadata not synchronized'; end if;

  q := public.admin_save_library_question(null,'{"question_type":"single-answer","prompt":"Original easy fixture","correct_answer":"Yes","accepted_answers":[],"status":"active","editorial_difficulty":3}');
  select revision into rev from public.source_questions where id=q;
  insert into public.quizzes(title,status,owner_id) values('Rollback scoring fixture','ready',a) returning id into quiz;
  insert into public.quiz_questions(quiz_id,question_key,position,item_position,round_number,round_position,round_question_count,round_title,prompt,question_type,correct_answer,accepted_answers,points_max,source_question_id,source_revision,bonus)
  values(quiz,'test-question',1,1,1,1,1,'Test','Original easy fixture','single-answer','"Yes"','[]',1,q,rev,'{"prompt":"Bonus?","correct_answer":"Bonus","points":1}');
  select game_id into g from public.create_game_from_quiz(quiz);
  update public.games set status='live',answer_phase='closed' where id=g;
  for i in 1..20 loop
    insert into public.teams(game_id,name) values(g,'Synthetic team '||i) returning id into t;
    insert into public.submissions(game_id,team_id,question_key,answer_text,is_correct,points_awarded,grading_json)
    values(g,t,'test-question','Yes',true,1,'{"items":[{"submitted":"Yes","expected":"Yes","status":"correct"}]}');
  end loop;
  if not exists(select 1 from public.source_questions where id=q and observed_sample_size=20 and observed_difficulty=1 and revision=rev) then raise exception 'Learning fixture failed'; end if;
  perform public.admin_save_library_question(q,'{"question_type":"single-answer","prompt":"Different hard fixture","correct_answer":"Replacement","accepted_answers":[],"editorial_difficulty":5,"status":"active"}',p_expected_revision=>rev);
  if not exists(select 1 from public.source_questions where id=q and observed_sample_size=0 and observed_difficulty is null and editorial_difficulty=5) then raise exception 'Edited content retained old difficulty'; end if;
  perform public.refresh_question_observed_difficulty(q);
  if not exists(select 1 from public.source_questions where id=q and observed_sample_size=0 and observed_difficulty is null) then raise exception 'Old revision events entered new aggregate'; end if;
  if (select count(*) from public.question_performance_events where source_question_id=q) <> 20 then raise exception 'Historical learning data was lost'; end if;

  insert into public.teams(game_id,name) values(g,'Correction team') returning id into t;
  insert into public.submissions(game_id,team_id,question_key,answer_text) values(g,t,'test-question','Accepted by host') returning id into s;
  insert into public.bonus_submissions(game_id,team_id,question_key,answer_text) values(g,t,'test-question','Accepted bonus') returning id into b;
  perform public.finalize_question_and_bonus_scoring(g,'test-question',jsonb_build_array(jsonb_build_object('submission_id',s,'is_correct',false,'points_awarded',0,'grading_json','{"items":[{"status":"incorrect"}]}'::jsonb)),jsonb_build_array(jsonb_build_object('submission_id',b,'is_correct',false,'points_awarded',0,'grading_json','{"items":[{"status":"incorrect"}]}'::jsonb)),false);
  perform public.rescore_submission(s,'{"items":[{"submitted":"Accepted by host","expected":"Yes","status":"correct"}]}',1);
  perform public.rescore_bonus_submission(b,'{"items":[{"submitted":"Accepted bonus","expected":"Bonus","status":"correct"}]}',1);
  if (select score from public.teams where id=t) <> 2 then raise exception 'Closed-phase corrections did not update score'; end if;
  perform public.rescore_submission(s,'{"items":[{"status":"correct"}]}',1);
  if (select score from public.teams where id=t) <> 2 then raise exception 'Repeated correction double-counted points'; end if;
  perform public.rescore_submission(s,'{"items":[{"status":"incorrect"}]}',0);
  if (select score from public.teams where id=t) <> 1 then raise exception 'Reversing correction did not remove points'; end if;
end $$;
select 'Review, scoring, and revision-learning regressions passed (rolled back)' as result;
rollback;
