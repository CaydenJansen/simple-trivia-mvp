-- Run with the new migration in a ROLLBACK-only transaction.
do $$
declare h uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); q uuid; g uuid; op uuid:=gen_random_uuid(); created record;
  kind text; sg uuid; r public.game_show_games; result jsonb; count_before bigint; rejected boolean;
  source public.source_questions; t uuid; admin_before jsonb; admin_after jsonb; position_number integer:=1;
begin
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(h,h||'@practice.invalid','{}','{}'),(stranger,stranger||'@practice.invalid','{}','{}');
  perform set_config('request.jwt.claim.sub',h::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',h,'role','authenticated')::text,true);
  insert into public.platform_admins(user_id,role) values(h,'admin');
  admin_before:=public.get_platform_admin_dashboard();
  insert into public.quizzes(owner_id,title,status) values(h,'Practice fixture','ready') returning id into q;
  insert into public.quiz_questions(quiz_id,question_key,position,item_position,round_number,round_position,round_question_count,round_title,prompt,question_type,correct_answer,accepted_answers,points_max)
    values(q,'q1',1,1,1,1,1,'Test','A test question','single-answer','"Answer"','[]',1);
  count_before:=public.get_host_game_count();
  select * into created from public.create_practice_game(q,'{}',4,op); g:=created.game_id;
  if g is null or (select count(*) from public.practice_bots where game_id=g)<>4 then raise exception 'Practice bots missing'; end if;
  select * into created from public.create_practice_game(q,'{}',4,op);
  if created.game_id<>g or public.get_host_game_count()<>count_before then raise exception 'Practice idempotency/count isolation failed'; end if;
  result:=public.get_host_session_health(g);
  if result->>'practice'<>'true' or jsonb_array_length(result->'teams')<>4 then raise exception 'Health data wrong'; end if;
  perform public.ensure_host_join_link();
  if exists(select 1 from public.resolve_host_join_link((select slug from public.host_join_links where host_id=h))) then raise exception 'Practice leaked to permanent QR'; end if;
  rejected:=false;
  begin update public.games set settings='{}' where id=g; exception when others then rejected:=true; end;
  if not rejected then raise exception 'Practice converted to real game'; end if;
  update public.games set status='live',current_screen='single-answer',current_question_key='q1',answer_phase='open' where id=g;
  update public.practice_bots set next_action_at=clock_timestamp()-interval '1 second' where game_id=g;
  result:=public.tick_practice_game(g);
  if (result->>'failures')::integer<>0 or (select count(*) from public.submissions where game_id=g)<>4 then raise exception 'Practice question submissions failed: %',result; end if;
  update public.practice_sessions set last_tick_at=null where game_id=g;
  update public.practice_bots set next_action_at=clock_timestamp()-interval '1 second' where game_id=g;
  perform public.tick_practice_game(g);
  if (select count(*) from public.submissions where game_id=g)<>4 then raise exception 'Practice duplicated answers'; end if;
  foreach kind in array array['multiple-choice','multi-answer','multi-part','ranking'] loop
    position_number:=position_number+1;
    insert into public.game_questions(game_id,question_key,position,item_position,round_number,round_position,round_question_count,round_title,prompt,question_type,correct_answer,accepted_answers,options,points_max,bonus)
      values(g,kind,position_number,position_number,1,position_number,5,'Test','Practice question',kind,
        case when kind='multiple-choice' then '"A"'::jsonb else '["A","B","C"]'::jsonb end,'[]','[{"key":"A","label":"Alpha"},{"key":"B","label":"Beta"}]',1,
        '{"prompt":"A bonus","correct_answer":"Bonus answer","accepted_answers":[],"points":1}');
    update public.games set current_screen=kind,current_question_key=kind,question_stage='core',answer_phase='open' where id=g;
    update public.practice_sessions set last_tick_at=null where game_id=g;
    update public.practice_bots set next_action_at=clock_timestamp()-interval '1 second' where game_id=g;
    result:=public.tick_practice_game(g);
    if (result->>'failures')::integer<>0 or (select count(*) from public.submissions where game_id=g and question_key=kind)<>4 then raise exception 'Practice % answer failed: %',kind,result; end if;
    update public.games set question_stage='bonus',answer_phase='open' where id=g;
    update public.practice_sessions set last_tick_at=null where game_id=g;
    update public.practice_bots set next_action_at=clock_timestamp()-interval '1 second' where game_id=g;
    result:=public.tick_practice_game(g);
    if (result->>'failures')::integer<>0 or (select count(*) from public.bonus_submissions where game_id=g and question_key=kind)<>4 then raise exception 'Practice bonus failed: %',result; end if;
  end loop;
  -- A byte-for-byte source snapshot must STILL be excluded from learning.
  select * into source from public.source_questions where origin='platform' and question_type='single-answer' limit 1;
  if source.id is not null then
    update public.game_questions set prompt=source.prompt,question_type=source.question_type,correct_answer=source.correct_answer,
      accepted_answers=source.accepted_answers,options=source.options,image_url=source.image_url,source_question_id=source.id,source_revision=source.revision where game_id=g;
    if public.question_snapshot_matches_source(g,'q1') then raise exception 'Practice eligible for question learning'; end if;
    update public.submissions set is_correct=true,points_awarded=1 where game_id=g;
    if exists(select 1 from public.question_performance_events where game_id=g) then raise exception 'Practice wrote performance events'; end if;
  end if;
  foreach kind in array array['hot-potato','lowest-bidder','deal-or-no-deal','shared-cursor','heads-or-tails','scissors-paper-rock','dodge-the-rock','audience-question','in-show-tiebreaker'] loop
    insert into public.game_show_games(game_id,show_game_key,item_position,round_number,round_title,game_type,title,settings)
      values(g,kind,2,1,'Test',kind,kind,'{"reward_type":"points","reward_points":1}') returning id into sg;
    update public.games set current_screen='show-game',current_show_game_key=kind where id=g;
    case kind
      when 'hot-potato' then r:=public.start_hot_potato(sg); update public.hot_potatoes set received_at=clock_timestamp()-interval '2 seconds' where game_show_game_id=sg;
      when 'lowest-bidder' then r:=public.start_lowest_bidder(sg);
      when 'deal-or-no-deal' then r:=public.start_deal_or_no_deal(sg);
      when 'shared-cursor' then r:=public.start_shared_cursor(sg);
      when 'heads-or-tails','scissors-paper-rock','dodge-the-rock' then r:=public.start_elimination_show_game(sg);
      else
        if kind='in-show-tiebreaker' then insert into public.game_show_game_audience_private(game_show_game_id,correct_number) values(sg,100); end if;
        r:=public.start_audience_question(sg);
    end case;
    -- Publish the adjusted safe-catch state, without exposing fuses.
    if kind='hot-potato' then r:=public.publish_hot_potato(sg); end if;
    update public.practice_sessions set last_tick_at=null where game_id=g;
    update public.practice_bots set next_action_at=clock_timestamp()-interval '1 second' where game_id=g;
    result:=public.tick_practice_game(g);
    if (result->>'failures')::integer<>0 or (result->>'actions')::integer=0 then raise exception 'Bot actions failed for %: %',kind,result; end if;
  end loop;
  admin_after:=public.get_platform_admin_dashboard();
  foreach kind in array array['games_total','games_live','teams_total','answers_total'] loop
    if admin_before->kind is distinct from admin_after->kind then raise exception 'Practice changed admin metric %',kind; end if;
  end loop;
  perform public.control_practice_game(g,'pause');
  if (public.tick_practice_game(g)->>'paused')::boolean is not true then raise exception 'Pause ignored'; end if;
  perform set_config('request.jwt.claim.sub',stranger::text,true);
  rejected:=false; begin perform public.tick_practice_game(g); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Other host controlled bots'; end if;
  rejected:=false; begin perform public.get_host_session_health(g); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Other host read health'; end if;
  rejected:=false; begin perform public.control_practice_game(g,'stop'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Other host ended practice'; end if;
  if has_table_privilege('anon','public.practice_bots','SELECT') or has_function_privilege('anon','public.tick_practice_game(uuid)','EXECUTE') then raise exception 'Anonymous bot access'; end if;
  perform set_config('request.jwt.claim.sub',h::text,true);
  perform public.control_practice_game(g,'stop');
  if (select status from public.games where id=g)<>'cancelled' then raise exception 'Practice did not end'; end if;
end; $$;
