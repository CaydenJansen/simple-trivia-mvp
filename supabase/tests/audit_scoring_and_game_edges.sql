-- Run in a transaction after the migration; the runner must ROLLBACK.
do $$
declare
  h uuid:=gen_random_uuid(); q uuid; g uuid; a uuid; b uuid; c uuid; ra uuid; rb uuid;
  ta uuid:=gen_random_uuid(); tb uuid:=gen_random_uuid(); bomb uuid; cursor_game uuid;
  result public.game_show_games; rejected boolean; resolution uuid; outcome integer;
  tid uuid; profile uuid; submission uuid; stats record; source_id uuid; source_revision integer;
  independent_quiz uuid; operation uuid:=gen_random_uuid(); before_score integer;
  personal uuid; repeated_personal uuid; personal_revision integer; payload jsonb;
  rock_game uuid; other_lane text;
  joined_first record; joined_again record; copy_row public.quizzes%rowtype; folder uuid; suggestion uuid; dashboard jsonb;
begin
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
    values(h,h||'@rollback-audit.invalid','{}','{}');
  perform set_config('request.jwt.claim.sub',h::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',h,'role','authenticated')::text,true);
  insert into public.platform_admins(user_id,role) values(h,'admin');
  insert into public.categories(slug,name) values('audit-zero-'||h,'Audit zero '||h);
  dashboard:=public.get_platform_admin_dashboard();
  if not exists(select 1 from jsonb_array_elements(dashboard->'supply_by_category') item where item->>'category_name'='Audit zero '||h and (item->>'question_count')::integer=0) then raise exception 'A10: zero-supply category missing'; end if;
  payload:=jsonb_build_object('_operation_id',gen_random_uuid(),'question_type','single-answer','prompt','Synthetic personal question','correct_answer','Answer','status','active','as_of_date','2026-01-01','expires_at','2027-01-01');
  personal:=public.save_my_question_with_inherited_metadata(null,payload);
  repeated_personal:=public.save_my_question_with_inherited_metadata(null,payload);
  if repeated_personal<>personal then raise exception 'F35: retry created a duplicate source'; end if;
  select revision into personal_revision from public.source_questions where id=personal;
  perform public.save_my_question_with_inherited_metadata(personal,jsonb_build_object('_expected_revision',personal_revision,'prompt','Updated synthetic personal question'));
  if not exists(select 1 from public.source_questions where id=personal and as_of_date='2026-01-01'::date and expires_at='2027-01-01'::date) then raise exception 'E5: omitted metadata erased'; end if;
  rejected:=false;
  begin perform public.save_my_question_with_inherited_metadata(personal,jsonb_build_object('_expected_revision',personal_revision,'prompt','Stale edit'));
  exception when raise_exception then rejected:=sqlerrm like 'This question changed%'; end;
  if not rejected then raise exception 'E8: stale personal revision accepted'; end if;
  select revision into personal_revision from public.source_questions where id=personal;
  perform public.save_my_question_with_inherited_metadata(personal,jsonb_build_object('_expected_revision',personal_revision,'expires_at',null));
  if exists(select 1 from public.source_questions where id=personal and expires_at is not null) then raise exception 'E5: explicit clear ignored'; end if;
  insert into public.quizzes(owner_id,title,status) values(h,'Rollback regression fixture','ready') returning id into q;
  insert into public.quizzes(owner_id,title,status) values(h,'Independent template source','draft') returning id into independent_quiz;
  insert into public.quiz_templates(owner_id,name,source_quiz_id,structure) values(h,'Independent fixture',independent_quiz,'{"rounds":[],"questions":[]}') returning id into tid;
  delete from public.quizzes where id=independent_quiz;
  if not exists(select 1 from public.quiz_templates where id=tid and source_quiz_id is null and structure is not null) then raise exception 'F6: independent template removed with source'; end if;
  insert into public.quiz_questions(quiz_id,question_key,position,item_position,round_number,round_position,round_question_count,round_title,prompt,question_type,correct_answer,accepted_answers,points_max)
    values(q,'q1',1,1,1,1,1,'Test','Synthetic question','single-answer','"Answer"','[]',1);
  insert into public.quiz_content_screens(quiz_id,screen_key,item_position,round_number,round_title,title,body) values(q,'screen',2,1,'Test','Content','Preserve this body');
  insert into public.quiz_tiebreakers(quiz_id,tiebreaker_key,position,prompt,correct_value) values(q,'tb',1,'Tie question',42);
  insert into public.quiz_show_games(quiz_id,show_game_key,item_position,round_number,round_title,game_type,title,settings) values(q,'wheel',3,1,'Test','spin-the-wheel','Wheel','{"reward_type":"points","reward_points":2}');
  insert into public.quiz_folders(owner_id,name) values(h,'Copy folder') returning id into folder;
  update public.quizzes set folder_id=folder where id=q;
  copy_row:=public.duplicate_owned_quiz(q,'Atomic copy');
  if copy_row.folder_id is distinct from folder
    or not exists(select 1 from public.quiz_questions where quiz_id=copy_row.id and question_key='q1' and correct_answer='"Answer"'::jsonb)
    or not exists(select 1 from public.quiz_content_screens where quiz_id=copy_row.id and body='Preserve this body')
    or not exists(select 1 from public.quiz_tiebreakers where quiz_id=copy_row.id and correct_value=42)
    or not exists(select 1 from public.quiz_show_games where quiz_id=copy_row.id and settings->>'reward_points'='2') then raise exception 'F23/B10: incomplete atomic duplicate'; end if;
  select game_id into g from public.create_game_from_quiz(q,'{}');
  update public.games set status='live',answer_phase='closed' where id=g;
  rejected:=false;
  begin delete from public.quizzes where id=q; exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'F7: live quiz deletion was not rejected'; end if;
  insert into public.teams(game_id,name,last_seen_at) values(g,'First',clock_timestamp()) returning id into a;
  insert into public.teams(game_id,name,last_seen_at) values(g,'Second',clock_timestamp()) returning id into b;
  select score into before_score from public.teams where id=b;
  perform public.award_host_bonus_points_once(b,5,operation);
  perform public.award_host_bonus_points_once(b,5,operation);
  if (select score from public.teams where id=b)<>before_score+5 then raise exception 'C8: retried bonus awarded twice'; end if;
  rejected:=false;
  begin perform public.award_host_bonus_points_once(b,6,operation); exception when raise_exception then rejected:=sqlerrm='BONUS_OPERATION_CONFLICT'; end;
  if not rejected then raise exception 'C8: operation reused with different points'; end if;
  insert into public.team_join_requests(game_id,requested_name,name_key,status,team_id,request_token) values(g,'First','first','approved',a,ta) returning id into ra;
  insert into public.team_join_requests(game_id,requested_name,name_key,status,team_id,request_token) values(g,'Second','second','approved',b,tb) returning id into rb;
  insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title,settings)
    values(g,'bomb',2,1,'Test','beat-the-bomb','Bomb','{"reward_type":"points","reward_points":1}') returning id into bomb;
  insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title,settings)
    values(g,'rock',9,1,'Test','dodge-the-rock','Rock','{"reward_type":"points","reward_points":1}') returning id into rock_game;
  result:=public.start_elimination_show_game(rock_game);
  other_lane:=result.settings->'positions'->>b::text;
  if result.settings->'positions'->>a::text=other_lane then raise exception 'F13: finalists start in the same lane'; end if;
  rejected:=false;
  begin perform public.submit_elimination_show_game_choice(rock_game,ra,ta,other_lane);
  exception when raise_exception then rejected:=sqlerrm='FINAL_LANE_TAKEN'; end;
  if not rejected then raise exception 'F13: unconfirmed occupied lane was accepted'; end if;
  update public.game_show_games set explode_at=clock_timestamp()-interval '1 second' where id=rock_game;
  result:=public.resolve_elimination_show_game(rock_game);
  if result.winner_team_id is null then raise exception 'F13: two-team final did not produce a winner'; end if;

  select * into joined_first from public.join_live_game_once(operation,g,'Pending settings test');
  select * into joined_again from public.join_live_game_once(operation,g,'Pending settings test');
  if joined_first.request_id<>joined_again.request_id or joined_first.request_token<>joined_again.request_token then raise exception 'C7: join retry did not return the original capability'; end if;
  perform public.patch_host_game_settings(g,'{"player_score_visibility":"hidden"}');
  perform public.patch_host_game_settings(g,'{"auto_run_clock":{"key":"open-test-core","label":"Answers close in","deadline_ms":9999999999999}}');
  if not exists(select 1 from public.games where id=g and settings->>'player_score_visibility'='hidden' and settings ? 'auto_run_clock') then raise exception 'A4: patch replaced unrelated settings'; end if;
  perform public.patch_host_game_settings(g,'{"team_approval_required":false}');
  if exists(select 1 from public.team_join_requests where game_id=g and status='pending') or not exists(select 1 from public.teams where game_id=g and name='Pending settings test') then raise exception 'C10: auto join did not atomically admit waiting teams'; end if;
  -- Remove only this fixture before the two-team game checks.
  delete from public.teams where game_id=g and name='Pending settings test';
  perform public.patch_host_game_settings(g,'{"team_approval_required":true}');
  perform public.start_beat_the_bomb(bomb);
  update public.game_show_games set explode_at=clock_timestamp()-interval '1 second',settings=settings||jsonb_build_object('armed_at',clock_timestamp()-interval '81 seconds','danger_ends_at',clock_timestamp()-interval '1 second') where id=bomb;
  perform public.resolve_beat_the_bomb(bomb);
  perform public.cut_beat_the_bomb_wire(bomb,ra,ta);
  rejected:=false;
  begin perform public.cut_beat_the_bomb_wire(bomb,rb,tb); exception when raise_exception then rejected:=sqlerrm='BOMB_EXPLODED'; end;
  if not rejected then raise exception 'F11: second overtime cut accepted'; end if;
  result:=public.resolve_beat_the_bomb(bomb);
  if result.winner_team_id is distinct from a then raise exception 'F11: first overtime cut did not win'; end if;

  insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title,settings)
    values(g,'cursor',3,1,'Test','shared-cursor','Cursor','{"reward_type":"points","reward_points":1}') returning id into cursor_game;
  perform public.start_shared_cursor(cursor_game);
  update public.game_show_games set explode_at=clock_timestamp()-interval '1 second',settings=settings||jsonb_build_object('cursor_x',1,'cursor_y',0,'cursor_candidate_id',a,'cursor_candidate_since_ms',floor(extract(epoch from clock_timestamp())*1000)-1500) where id=cursor_game;
  perform public.remove_team_from_game(a);
  result:=public.advance_shared_cursor(cursor_game);
  if result.winner_team_id is distinct from b then raise exception 'F12: removed cursor target blocked the remaining team'; end if;

  -- A settled two-team tie must be reopened if a third team joins that score.
  insert into public.teams(game_id,name,score) values(g,'Third',10) returning id into c;
  insert into public.teams(game_id,name,score) values(g,'Fourth',9) returning id into a;
  update public.teams set score=10 where id=b;
  outcome:=public.finalize_game_with_prizes(g);
  select id into resolution from public.game_tie_resolutions where game_id=g and status='pending';
  perform public.manually_resolve_game_tie(resolution,array[b,c]);
  perform public.award_host_bonus_points(a,1);
  outcome:=public.finalize_game_with_prizes(g);
  if outcome<>-1 or not exists(select 1 from public.game_tie_resolutions where id=resolution and status='pending' and cardinality(team_ids)=3) then raise exception 'F10: stale tie membership finalized'; end if;
  perform public.allow_game_tie(resolution);

  -- Six teams, bottom two share fifth, seventh prize falls back to that group.
  update public.teams set score=case id when b then 60 when c then 50 else 40 end where game_id=g;
  insert into public.teams(game_id,name,score) values(g,'Fifth',30),(g,'Sixth',20),(g,'Seventh',20);
  update public.games set settings=settings||'{"other_prizes":[{"enabled":true,"position":7,"missing_behavior":"closest","msg":"Fallback prize"}]}'::jsonb where id=g;
  outcome:=public.finalize_game_with_prizes(g);
  select id into resolution from public.game_tie_resolutions where game_id=g and tied_score=20;
  perform public.allow_game_tie(resolution);
  outcome:=public.finalize_game_with_prizes(g);
  if (select count(*) from public.teams where game_id=g and final_placement=5 and jsonb_array_length(prize_awards)=1)<>2 then raise exception 'E10: closest prize not shared by tied bottom rank'; end if;

  -- Genuine speed submission; correctness must undo its exact multiplier.
  insert into public.team_profiles(display_name,name_key,pin_digest) values('Stats fixture',h::text,repeat('a',64)) returning id into profile;
  select game_id into g from public.create_game_from_quiz(q,'{"scoring_mode":"speed"}');
  insert into public.teams(game_id,name,team_profile_id) values(g,'Speed fixture',profile) returning id into b;
  update public.games set status='live',current_screen='single-answer',current_question_key='q1',question_stage='core',answer_phase='open' where id=g;
  submission:=public.submit_player_answer(g,b,'q1','Answer');
  update public.games set answer_phase='closed' where id=g;
  perform public.finalize_question_scoring(g,'q1',jsonb_build_array(jsonb_build_object('submission_id',submission,'is_correct',true,'points_awarded',1,'grading_json',jsonb_build_object('items',jsonb_build_array(jsonb_build_object('submitted','Answer','expected','Answer','status','correct'))))),true);
  update public.games set answer_phase='closed' where id=g;
  update public.game_question_speed_timers set opened_at=clock_timestamp()-interval '90 seconds',deadline_at=clock_timestamp()-interval '45 seconds' where game_id=g and question_key='q1';
  update public.games set answer_phase='open',answer_editing_allowed=true where id=g;
  if not exists(select 1 from public.game_question_speed_timers where game_id=g and question_key='q1' and opened_at<clock_timestamp()-interval '80 seconds' and deadline_at>clock_timestamp()) then raise exception 'E2: reopen reset scoring start or left deadline expired'; end if;
  perform public.submit_player_answer(g,b,'q1','Answer updated');
  if not exists(select 1 from public.submissions where id=submission and speed_points_max=50) then raise exception 'E2: reopen restored 100-point scoring'; end if;
  update public.games set answer_phase='closed' where id=g;
  perform public.finalize_question_scoring(g,'q1',jsonb_build_array(jsonb_build_object('submission_id',submission,'is_correct',true,'points_awarded',1,'grading_json',jsonb_build_object('items',jsonb_build_array(jsonb_build_object('submitted','Answer updated','expected','Answer','status','correct'))))),true);
  update public.games set status='finished' where id=g;
  select * into stats from public.get_host_team_stats() where team_profile_id=profile;
  if stats.correct_points<>1 or stats.possible_points<>1 or stats.correct_rate<>100 then raise exception 'E3: speed correctness mismatch %',row_to_json(stats); end if;

  insert into public.source_questions(origin,question_type,mechanic,prompt,correct_answer,accepted_answers,status,is_verified)
    values('platform','multi-answer','multi-answer','Synthetic multipart performance','["A","B","C"]','[]','active',true) returning id,revision into source_id,source_revision;
  insert into public.game_questions(game_id,question_key,position,item_position,round_number,round_position,round_question_count,round_title,prompt,question_type,correct_answer,accepted_answers,points_max,source_question_id,source_revision)
    values(g,'q2',2,4,1,2,2,'Test','Synthetic multipart performance','multi-answer','["A","B","C"]','[]',3,source_id,source_revision);
  update public.games set status='live',current_screen='multi-answer',current_question_key='q2',question_stage='core',answer_phase='open' where id=g;
  submission:=public.submit_player_answer(g,b,'q2','["A","B","wrong"]');
  update public.games set answer_phase='closed' where id=g;
  perform public.finalize_question_scoring(g,'q2',jsonb_build_array(jsonb_build_object('submission_id',submission,'is_correct',false,'points_awarded',2,'grading_json','{"items":[{"submitted":"A","expected":"A","status":"correct"},{"submitted":"B","expected":"B","status":"correct"},{"submitted":"wrong","status":"incorrect"}],"missing":["C"]}'::jsonb)),true);
  if not exists(select 1 from public.question_performance_events where submission_id=submission and correct_items=2 and total_items=3) then raise exception 'D2: expected two correct out of three, without double-counting missing C'; end if;
  update public.source_questions set observed_difficulty=5,observed_sample_size=20,observed_correct_rate=0.1 where id=source_id;
  if not exists(select 1 from public.source_question_catalog where id=source_id and observed_difficulty=5) then raise exception 'F15: observed difficulty unavailable in catalogue'; end if;
  perform public.rescore_submission(submission,'{"items":[{"submitted":"A","expected":"A","status":"correct"},{"submitted":"B","expected":"B","status":"correct"},{"submitted":"Novel alias","status":"correct"}]}'::jsonb,3);
  suggestion:=public.record_host_answer_override(submission,2);
  if suggestion is null or not exists(select 1 from public.question_answer_suggestions where id=suggestion and answer_slot=-1) then raise exception 'D3: unassigned alternative was lost or guessed'; end if;
  rejected:=false;
  begin perform public.review_answer_suggestion(suggestion,'approved'); exception when raise_exception then rejected:=sqlerrm like 'Choose the matching answer%'; end;
  if not rejected then raise exception 'D3: unassigned alternative approved without choosing a slot'; end if;
  update public.question_answer_suggestions set status='pending' where id=suggestion;
  perform public.rescore_submission(submission,'{"items":[{"submitted":"A","expected":"A","status":"correct"},{"submitted":"B","expected":"B","status":"correct"},{"submitted":"Novel alias","status":"incorrect"}]}'::jsonb,2);
  if exists(select 1 from public.question_answer_suggestion_signals where submission_id=submission) or not exists(select 1 from public.question_answer_suggestions where id=suggestion and status='collecting') then raise exception 'D4: reversed verdict still votes for alias'; end if;
  perform public.review_answer_suggestion_with_slot(suggestion,'approved',null,2);
  if not exists(select 1 from public.source_questions where id=source_id and accepted_answers->2 ? 'Novel alias') then raise exception 'D3: selected answer slot did not receive alias'; end if;
  tb:=gen_random_uuid();
  insert into public.team_join_requests(game_id,requested_name,name_key,status,team_id,request_token) values(g,'Speed fixture','speed fixture','approved',b,tb) returning id into rb;
  insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title,settings)
    values(g,'cancel-bomb',10,1,'Test','beat-the-bomb','Bomb','{"reward_type":"points","reward_points":1}') returning id into bomb;
  perform public.start_beat_the_bomb(bomb);
  update public.games set status='cancelled' where id=g;
  select score into before_score from public.teams where id=b;
  rejected:=false;
  begin perform public.cut_beat_the_bomb_wire(bomb,rb,tb);
  exception when raise_exception then rejected:=sqlerrm='GAME_CANCELLED'; end;
  if not rejected or (select score from public.teams where id=b)<>before_score then raise exception 'E1: cancelled game accepted an action'; end if;
end $$;
select 'F6, F7, F10, F11, F12, F13, F15, F23, F35, A4, A10, B10, C7, C8, C10, D2, D3, D4, E1, E2, E3, E5, E8, E10 regression checks passed; transaction must roll back' as result;
