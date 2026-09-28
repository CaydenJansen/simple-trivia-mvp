-- Rollback-only capability, RLS and secret-projection tests. Never read player data.
create temp table player_access_fixture(h uuid,g uuid,a uuid,b uuid,ra uuid,rb uuid,ta uuid,tb uuid,submission uuid,bomb uuid,spr uuid);
grant select on player_access_fixture to anon,authenticated;
do $$
declare h uuid:=gen_random_uuid(); q uuid; g uuid; a uuid; b uuid; ra uuid; rb uuid;
  ta uuid:=gen_random_uuid(); tb uuid:=gen_random_uuid(); submission uuid; bomb uuid; spr uuid;
begin
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(h,h||'@access-rollback.invalid','{}','{}');
  perform set_config('request.jwt.claim.sub',h::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',h,'role','authenticated')::text,true);
  insert into public.quizzes(owner_id,title,status) values(h,'Access fixture','ready') returning id into q;
  insert into public.quiz_questions(quiz_id,question_key,position,item_position,round_number,round_position,round_question_count,round_title,prompt,question_type,correct_answer,accepted_answers,points_max)
    values(q,'q1',1,1,1,1,1,'Test','Three answers','multi-answer','["A","B","C"]','[]',3);
  select game_id into g from public.create_game_from_quiz(q,'{"show_correctness_percentage_to_players":true,"player_score_visibility":"hidden"}');
  update public.games set status='live',current_screen='multi-answer',answer_phase='open',current_question_key='q1' where id=g;
  insert into public.teams(game_id,name,last_seen_at) values(g,'Active',clock_timestamp()) returning id into a;
  insert into public.teams(game_id,name,last_seen_at) values(g,'Asleep',clock_timestamp()-interval '10 minutes') returning id into b;
  insert into public.team_join_requests(game_id,requested_name,name_key,status,team_id,request_token) values(g,'Active','active','approved',a,ta) returning id into ra;
  insert into public.team_join_requests(game_id,requested_name,name_key,status,team_id,request_token) values(g,'Asleep','asleep','approved',b,tb) returning id into rb;
  submission:=public.submit_owned_player_answer(g,a,'q1','["A","B","wrong"]',ra,ta);
  update public.submissions set is_correct=false,points_awarded=2,grading_json='{"items":[{"submitted":"A","expected":"A","status":"correct"},{"submitted":"B","expected":"B","status":"correct"},{"submitted":"wrong","status":"incorrect"}]}' where id=submission;
  perform public.submit_owned_player_answer(g,b,'q1','["A","B","C"]',rb,tb);
  update public.submissions set is_correct=true,points_awarded=3,grading_json='{"items":[{"expected":"A","status":"correct"},{"expected":"B","status":"correct"},{"expected":"C","status":"correct"}]}' where game_id=g and team_id=b;
  insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title,status,explode_at,settings)
    values(g,'bomb',2,1,'Test','beat-the-bomb','Bomb','open',clock_timestamp()+interval '30 seconds',jsonb_build_object('armed_at',clock_timestamp()-interval '1 second','danger_ends_at',clock_timestamp()+interval '60 seconds','eligible_team_ids',jsonb_build_array(a,b))) returning id into bomb;
  insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title,status,explode_at,settings)
    values(g,'spr',3,1,'Test','scissors-paper-rock','SPR','open',clock_timestamp()+interval '30 seconds','{"round_phase":"choosing","round_number":1}') returning id into spr;
  insert into public.game_show_game_choices(game_show_game_id,game_id,team_id,round_number,choice) values(spr,g,a,1,'rock'),(spr,g,b,1,'paper');
  insert into player_access_fixture values(h,g,a,b,ra,rb,ta,tb,submission,bomb,spr);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
end;
$$;
set local role anon;
do $$
declare f record; rejected boolean; row_data record; n integer; game_row public.game_show_games;
begin
  select * into f from player_access_fixture;
  rejected:=false;
  begin perform public.submit_owned_player_answer(f.g,f.b,'q1','stolen',f.ra,f.ta); exception when raise_exception then rejected:=sqlerrm='JOIN_REQUEST_INVALID'; end;
  if not rejected then raise exception 'F2: another team submission accepted'; end if;
  rejected:=false;
  begin perform public.submit_player_answer(f.g,f.b,'q1','legacy bypass'); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'F2: old unprotected RPC callable'; end if;
  rejected:=false;
  begin perform answer_text from public.submissions where id=f.submission; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'F2: raw answers readable'; end if;
  rejected:=false;
  begin update public.teams set score=999 where id=f.a; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'F2: anonymous score update accepted'; end if;
  rejected:=false;
  begin delete from public.submissions where id=f.submission; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'F2: anonymous answer deletion accepted'; end if;
  select * into row_data from public.get_owned_player_submission(f.g,f.a,'q1',f.ra,f.ta);
  if row_data.answer_text<>'["A","B","wrong"]' or row_data.is_correct is not null or row_data.grading_json is not null or row_data.points_awarded<>0 then raise exception 'F2: own draft missing or grading leaked before reveal'; end if;
  select * into game_row from public.get_owned_player_show_game(f.g,f.a,'bomb',f.ra,f.ta);
  if game_row.explode_at is distinct from (game_row.settings->>'danger_ends_at')::timestamptz then raise exception 'C2: bomb secret leaked through read'; end if;
  game_row:=public.cut_beat_the_bomb_wire(f.bomb,f.ra,f.ta);
  if game_row.explode_at is distinct from (game_row.settings->>'danger_ends_at')::timestamptz then raise exception 'C2: bomb secret leaked through cut'; end if;
  select count(*) into n from public.get_owned_player_choices(f.g,f.a,f.spr,1,f.ra,f.ta);
  if n<>1 then raise exception 'C3: opponent choice visible before reveal'; end if;
  rejected:=false;
  begin perform choice from public.game_show_game_choices where game_show_game_id=f.spr; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'C3: raw choices readable'; end if;
end;
$$;
reset role;
update public.games set answer_phase='revealed' where id=(select g from player_access_fixture);
update public.game_show_games set settings=settings||'{"round_phase":"revealed"}' where id=(select spr from player_access_fixture);
set local role anon;
do $$
declare f record; result jsonb; row_data record;
begin
  select * into f from player_access_fixture;
  result:=public.get_player_question_accuracy(f.g,f.a,'q1',f.ra,f.ta);
  if (result->>'total')::integer<>1 or (result->'items'->0->>'percentage')::integer<>100 or (result->'items'->2->>'percentage')::integer<>0 then raise exception 'D5: dormant team distorted per-answer correctness: %',result; end if;
  select * into row_data from public.get_owned_player_submission(f.g,f.a,'q1',f.ra,f.ta);
  if row_data.grading_json is null or row_data.points_awarded<>0 then raise exception 'F5: reveal failed or hidden points disclosed'; end if;
  if (select count(*) from public.get_owned_player_choices(f.g,f.a,f.spr,1,f.ra,f.ta))<>2 then raise exception 'C3: revealed choices unavailable'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub',(select h::text from player_access_fixture),true);
set local role authenticated;
do $$
declare f record;
begin
  select * into f from player_access_fixture;
  if (select count(*) from public.submissions where game_id=f.g)<>2 then raise exception 'F2: host lost answer review access'; end if;
  if (select count(*) from public.game_show_game_choices where game_id=f.g)<>2 then raise exception 'C3: host lost choices'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
do $$
declare f record; affected integer;
begin
  select * into f from player_access_fixture;
  if exists(select 1 from public.submissions where game_id=f.g) then raise exception 'F2: unrelated signed-in user can read answers'; end if;
  update public.teams set score=999 where id=f.a;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'F2: unrelated signed-in user can change scores'; end if;
  if exists(select 1 from public.game_show_games where game_id=f.g) then raise exception 'C2: unrelated signed-in user can read bomb schedule'; end if;
end;
$$;
reset role;
select 'F2, F5, C2, C3, D5 player access regression checks passed; transaction must roll back' as result;
