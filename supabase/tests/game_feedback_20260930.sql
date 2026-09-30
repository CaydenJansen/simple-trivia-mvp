-- Synthetic fixtures only. The runner wraps this entire file in ROLLBACK.
do $$
declare
  h uuid:=gen_random_uuid(); q uuid; g uuid; sg uuid; a uuid; b uuid; c uuid;
  ra uuid; rb uuid; rc uuid; ta uuid:=gen_random_uuid(); tb uuid:=gen_random_uuid(); tc uuid:=gen_random_uuid();
  result public.game_show_games; row_data record; count_values integer; old_values jsonb;
  ceiling_value integer; round_no integer; team_count integer; sub uuid; bonus_sub uuid; rejected boolean;
  speed_g uuid; speed_team uuid; speed_request uuid; speed_token uuid:=gen_random_uuid(); speed_total integer;
  right_grade jsonb:='{"items":[{"submitted":"Alternate","expected":"Answer","status":"correct"}]}';
  wrong_grade jsonb:='{"items":[{"submitted":"Alternate","expected":"Answer","status":"incorrect"}]}';
begin
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(h,h||'@game-feedback.invalid','{}','{}');
  perform set_config('request.jwt.claim.sub',h::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',h,'role','authenticated')::text,true);
  insert into public.quizzes(owner_id,title,status) values(h,'Feedback fixture','ready') returning id into q;
  insert into public.quiz_questions(quiz_id,question_key,position,item_position,round_number,round_position,round_question_count,round_title,prompt,question_type,correct_answer,accepted_answers,points_max,bonus)
    values(q,'q1',1,1,1,1,1,'Test','Synthetic question','single-answer','"Answer"','[]',1,'{"prompt":"Bonus","correct_answer":"Answer","points":1}');
  select game_id into g from public.create_game_from_quiz(q,'{}');
  update public.games set status='live',current_screen='single-answer',current_question_key='q1',answer_phase='open' where id=g;
  insert into public.teams(game_id,name,last_seen_at) values(g,'A',clock_timestamp()) returning id into a;
  insert into public.teams(game_id,name,last_seen_at) values(g,'B',clock_timestamp()) returning id into b;
  insert into public.teams(game_id,name,last_seen_at) values(g,'C',clock_timestamp()) returning id into c;
  insert into public.team_join_requests(game_id,requested_name,name_key,status,team_id,request_token) values(g,'A','a','approved',a,ta) returning id into ra;
  insert into public.team_join_requests(game_id,requested_name,name_key,status,team_id,request_token) values(g,'B','b','approved',b,tb) returning id into rb;
  insert into public.team_join_requests(game_id,requested_name,name_key,status,team_id,request_token) values(g,'C','c','approved',c,tc) returning id into rc;

  -- Both directions of post-reveal overrides, retry idempotency, and hidden-score correctness.
  sub:=public.submit_owned_player_answer(g,a,'q1','Alternate',ra,ta);
  update public.games set question_stage='bonus',answer_phase='open' where id=g;
  bonus_sub:=public.submit_owned_player_answer(g,a,'q1','Alternate',ra,ta,true);
  update public.games set answer_phase='revealed' where id=g;
  perform public.rescore_submission(sub,right_grade,1);
  perform public.rescore_submission(sub,right_grade,1);
  perform public.rescore_bonus_submission(bonus_sub,right_grade,1);
  perform public.rescore_bonus_submission(bonus_sub,right_grade,1);
  if (select score from public.teams where id=a)<>2 then raise exception 'Duplicate override points'; end if;
  update public.games set settings=settings||'{"player_score_visibility":"hidden"}'::jsonb where id=g;
  select * into row_data from public.get_owned_player_submission(g,a,'q1',ra,ta,true);
  if row_data.is_correct is distinct from true or row_data.points_awarded<>0 or row_data.grading_json->'items'->0->>'status'<>'correct' then raise exception 'Hidden bonus correctness lost'; end if;
  perform public.rescore_submission(sub,wrong_grade,0);
  perform public.rescore_bonus_submission(bonus_sub,wrong_grade,0);
  if (select score from public.teams where id=a)<>0 then raise exception 'Override points not reversed'; end if;
  -- Fixed speed multiplier must be retained when a host changes their mind.
  select game_id into speed_g from public.create_game_from_quiz(q,'{"scoring_mode":"speed"}');
  insert into public.teams(game_id,name,last_seen_at) values(speed_g,'Speed team',clock_timestamp()) returning id into speed_team;
  insert into public.team_join_requests(game_id,requested_name,name_key,status,team_id,request_token) values(speed_g,'Speed team','speed team','approved',speed_team,speed_token) returning id into speed_request;
  update public.games set status='live',current_screen='single-answer',current_question_key='q1',answer_phase='open' where id=speed_g;
  update public.game_question_speed_timers set opened_at=clock_timestamp()-interval '16 seconds' where game_id=speed_g;
  sub:=public.submit_owned_player_answer(speed_g,speed_team,'q1','Alternate',speed_request,speed_token);
  update public.games set question_stage='bonus',answer_phase='open' where id=speed_g;
  update public.game_question_speed_timers set opened_at=clock_timestamp()-interval '23 seconds' where game_id=speed_g and stage='bonus';
  bonus_sub:=public.submit_owned_player_answer(speed_g,speed_team,'q1','Alternate',speed_request,speed_token,true);
  select speed_points_max into speed_total from public.submissions where id=sub;
  speed_total:=speed_total+(select speed_points_max from public.bonus_submissions where id=bonus_sub);
  update public.games set answer_phase='revealed' where id=speed_g;
  perform public.rescore_submission(sub,right_grade,1);
  perform public.rescore_submission(sub,right_grade,1);
  perform public.rescore_bonus_submission(bonus_sub,right_grade,1);
  if (select score from public.teams where id=speed_team)<>speed_total then raise exception 'Speed override multiplier/retry mismatch'; end if;
  perform public.rescore_submission(sub,wrong_grade,0);
  perform public.rescore_bonus_submission(bonus_sub,wrong_grade,0);
  if (select score from public.teams where id=speed_team)<>0 then raise exception 'Speed override reversal mismatch'; end if;

  -- Live choices visible only to eliminated participants (not active opponents).
  insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title,status,explode_at,settings)
    values(g,'spr',2,1,'Test','scissors-paper-rock','SPR','open',clock_timestamp()+interval '30 seconds',jsonb_build_object('round_phase','choosing','round_number',2,'eligible_team_ids',jsonb_build_array(a,b,c),'alive_team_ids',jsonb_build_array(b,c),'eliminated_team_ids',jsonb_build_array(a))) returning id into sg;
  insert into public.game_show_game_choices(game_show_game_id,game_id,team_id,round_number,choice) values(sg,g,b,2,'rock'),(sg,g,c,2,'paper');
  select count(*) into count_values from public.get_owned_player_choices(g,a,sg,2,ra,ta);
  if count_values<>2 then raise exception 'Eliminated spectator cannot see choices'; end if;
  select count(*) into count_values from public.get_owned_player_choices(g,b,sg,2,rb,tb);
  if count_values<>1 then raise exception 'Active opponent choices leaked'; end if;
  rejected:=false;
  begin perform public.get_owned_player_choices(g,a,sg,2,rb,tb); exception when raise_exception then rejected:=sqlerrm='JOIN_REQUEST_INVALID'; end;
  if not rejected then raise exception 'Spectator team forgery accepted'; end if;

  -- Small, large and >100-team rooms: every case unique and every swap >= $5.
  foreach team_count in array array[3,40,100] loop
    insert into public.teams(game_id,name,last_seen_at) select g,'Bank team '||n,clock_timestamp() from generate_series((select count(*)::integer from public.teams where game_id=g)+1,team_count) n;
    insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title,settings)
      values(g,'deal-'||team_count,team_count+10,1,'Test','deal-or-no-deal','Deal','{"reward_type":"points","reward_points":1}') returning id into sg;
    result:=public.start_deal_or_no_deal(sg);
    ceiling_value:=(result.settings->>'deal_max_value')::integer;
    if ceiling_value<greatest(25,team_count+9) or ceiling_value>greatest(100,team_count+9) then raise exception 'Invalid dynamic bank size'; end if;
    select * into result from public.get_owned_player_show_game(g,a,'deal-'||team_count,ra,ta);
    if result.settings ? 'deal_max_value' then raise exception 'Hidden ceiling leaked'; end if;
    for round_no in 1..3 loop
      select count(distinct assigned_value),jsonb_object_agg(team_id::text,assigned_value) into count_values,old_values from public.game_show_game_deals where game_show_game_id=sg;
      if count_values<>team_count then raise exception 'Duplicate initial/swapped case'; end if;
      update public.game_show_game_deals set decision='swap' where game_show_game_id=sg;
      result:=public.advance_deal_or_no_deal(sg);
      if exists(select 1 from public.game_show_game_deals where game_show_game_id=sg and (abs(assigned_value-(old_values->>team_id::text)::integer)<5 or assigned_value>ceiling_value)) then raise exception 'Illegal bank swap'; end if;
    end loop;
    if result.status<>'exploded' then raise exception 'Deal failed to finish'; end if;
    select count(distinct assigned_value) into count_values from public.game_show_game_deals where game_show_game_id=sg;
    if count_values<>team_count then raise exception 'Duplicate final case'; end if;
  end loop;

  -- Server refill accumulates fractions across taps, rather than resetting them.
  insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title)
    values(g,'cursor',200,1,'Test','shared-cursor','Cursor') returning id into sg;
  result:=public.start_shared_cursor(sg);
  update public.game_show_games set settings=jsonb_set(settings,array['cursor_stamina',a::text],jsonb_build_object('remaining',2,'updated_at_ms',floor(extract(epoch from clock_timestamp())*1000)-500,'cooldown_until_ms',null)) where id=sg;
  result:=public.pull_shared_cursor(sg,ra,ta);
  if (result.settings->'cursor_stamina'->a::text->>'remaining')::numeric not between 1.49 and 1.9 then raise exception 'Stamina fractional recovery lost'; end if;
end;
$$;
