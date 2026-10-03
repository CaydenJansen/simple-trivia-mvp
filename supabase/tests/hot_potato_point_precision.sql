-- Run inside a transaction ending in ROLLBACK; no lasting fixture data.
do $$
declare h uuid:=gen_random_uuid(); q uuid; g uuid; sg uuid; a uuid; b uuid;
  r public.game_show_games; shown numeric;
begin
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(h,h||'@potato-precision.invalid','{}','{}');
  perform set_config('request.jwt.claim.sub',h::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',h,'role','authenticated')::text,true);
  insert into public.quizzes(owner_id,title,status) values(h,'Potato precision fixture','ready') returning id into q;
  insert into public.quiz_show_games(quiz_id,show_game_key,item_position,round_number,round_title,game_type,title,settings)
    values(q,'potato',1,1,'Test','hot-potato','Hot Potato','{"reward_type":"points","reward_points":2}');
  select game_id into g from public.create_game_from_quiz_with_show_games(q,'{}');
  select id into sg from public.game_show_games where game_id=g and show_game_key='potato';
  update public.games set status='live',current_screen='show-game',current_show_game_key='potato' where id=g;
  insert into public.teams(game_id,name,last_seen_at) values(g,'A',clock_timestamp()) returning id into a;
  insert into public.teams(game_id,name,last_seen_at) values(g,'B',clock_timestamp()) returning id into b;
  r:=public.start_hot_potato(sg);
  update public.hot_potato_teams set banked=3.61 where game_show_game_id=sg and team_id=a;
  update public.hot_potato_teams set banked=3.62 where game_show_game_id=sg and team_id=b;
  r:=public.publish_hot_potato(sg);
  select (value->>'banked')::numeric into shown from jsonb_array_elements(r.settings->'hot_potato'->'teams') where value->>'id'=a::text;
  if shown<>3.61 then raise exception 'Banked score lost single-point precision'; end if;
  update public.game_show_games set explode_at=clock_timestamp()-interval '0.01 seconds' where id=sg;
  r:=public.advance_hot_potato(sg);
  if r.winner_team_id<>b or (r.settings->>'hot_potato_tied')::boolean then raise exception '361 versus 362 incorrectly tied'; end if;
  perform public.advance_hot_potato(sg);
  if (select score from public.teams where id=b)<>2 or (select score from public.teams where id=a)<>0 then raise exception 'Configured reward changed or was duplicated'; end if;
end; $$;
