begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

create or replace function public.assert_player_team(p_game_id uuid,p_team_id uuid,p_request_id uuid,p_request_token uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.team_join_requests r join public.teams t on t.id=r.team_id and t.game_id=r.game_id
    where r.id=p_request_id and r.request_token=p_request_token and r.status='approved'
      and r.team_id=p_team_id and r.game_id=p_game_id) then raise exception 'JOIN_REQUEST_INVALID'; end if;
end;
$$;
revoke all on function public.assert_player_team(uuid,uuid,uuid,uuid) from public,anon,authenticated;

-- Public clients cannot read raw grading/answers or mutate scores. Hosts retain
-- their existing direct review workflow, restricted to games they own.
do $policies$
declare item record; target text;
begin
  foreach target in array array['submissions','bonus_submissions','game_tiebreaker_submissions'] loop
    for item in select policyname from pg_policies where schemaname='public' and tablename=target loop
      execute format('drop policy %I on public.%I',item.policyname,target);
    end loop;
    execute format('revoke all on public.%I from anon',target);
    execute format('create policy "Owners manage game answers" on public.%I for all to authenticated using (exists(select 1 from public.games g join public.quizzes q on q.id=g.quiz_id where g.id=game_id and q.owner_id=auth.uid())) with check (exists(select 1 from public.games g join public.quizzes q on q.id=g.quiz_id where g.id=game_id and q.owner_id=auth.uid()))',target);
  end loop;
  for item in select policyname from pg_policies where schemaname='public' and tablename='teams' and cmd<>'SELECT' loop
    execute format('drop policy %I on public.teams',item.policyname);
  end loop;
end;
$policies$;
revoke insert,update,delete on public.teams from anon;
create policy "Hosts insert own teams" on public.teams for insert to authenticated with check
  (exists(select 1 from public.games g join public.quizzes q on q.id=g.quiz_id where g.id=teams.game_id and q.owner_id=auth.uid()));
create policy "Hosts update own teams" on public.teams for update to authenticated using
  (exists(select 1 from public.games g join public.quizzes q on q.id=g.quiz_id where g.id=teams.game_id and q.owner_id=auth.uid())) with check
  (exists(select 1 from public.games g join public.quizzes q on q.id=g.quiz_id where g.id=teams.game_id and q.owner_id=auth.uid()));
create policy "Hosts delete own teams" on public.teams for delete to authenticated using
  (exists(select 1 from public.games g join public.quizzes q on q.id=g.quiz_id where g.id=teams.game_id and q.owner_id=auth.uid()));

create or replace function public.submit_owned_player_answer(p_game_id uuid,p_team_id uuid,p_question_key text,p_answer_text text,p_request_id uuid,p_request_token uuid,p_bonus boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_player_team(p_game_id,p_team_id,p_request_id,p_request_token);
  if p_bonus then return public.submit_player_bonus_answer(p_game_id,p_team_id,p_question_key,p_answer_text); end if;
  return public.submit_player_answer(p_game_id,p_team_id,p_question_key,p_answer_text);
end;
$$;
revoke all on function public.submit_player_answer(uuid,uuid,text,text), public.submit_player_bonus_answer(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.submit_owned_player_answer(uuid,uuid,text,text,uuid,uuid,boolean) from public;
grant execute on function public.submit_owned_player_answer(uuid,uuid,text,text,uuid,uuid,boolean) to anon,authenticated;

create or replace function public.get_owned_player_submission(p_game_id uuid,p_team_id uuid,p_question_key text,p_request_id uuid,p_request_token uuid,p_bonus boolean default false)
returns table(id uuid,answer_text text,is_correct boolean,points_awarded integer,grading_json jsonb)
language plpgsql stable security definer set search_path='' as $$
declare g public.games%rowtype; visible boolean; points_visible boolean; table_name text;
begin
  perform public.assert_player_team(p_game_id,p_team_id,p_request_id,p_request_token);
  select * into g from public.games where games.id=p_game_id;
  visible:=g.status='finished' or (g.current_question_key=p_question_key and g.answer_phase='revealed');
  points_visible:=coalesce(g.settings->>'player_score_visibility',case when g.settings->>'scores_visible_to_players'='false' then 'hidden' else 'live' end)='live'
    or (g.status='finished' and g.settings->>'player_score_visibility' in ('round','final'))
    or (g.round_scores_finalized and g.settings->>'player_score_visibility'='round' and g.current_screen in ('round-results','round-results-hidden','intermission'));
  table_name:=case when p_bonus then 'bonus_submissions' else 'submissions' end;
  return query execute format('select s.id,s.answer_text,case when $4 then s.is_correct else null end,case when $4 and $5 then s.points_awarded else 0 end,case when $4 then s.grading_json else null end from public.%I s where s.game_id=$1 and s.team_id=$2 and s.question_key=$3',table_name)
  using p_game_id,p_team_id,p_question_key,visible,coalesce(points_visible,false);
end;
$$;
revoke all on function public.get_player_bonus_submission(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.get_owned_player_submission(uuid,uuid,text,uuid,uuid,boolean) from public;
grant execute on function public.get_owned_player_submission(uuid,uuid,text,uuid,uuid,boolean) to anon,authenticated;

create or replace function public.submit_owned_player_tiebreaker(p_game_id uuid,p_team_id uuid,p_attempt_id uuid,p_numeric_answer numeric,p_request_id uuid,p_request_token uuid)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_player_team(p_game_id,p_team_id,p_request_id,p_request_token);
  return public.submit_player_tiebreaker(p_game_id,p_team_id,p_attempt_id,p_numeric_answer);
end;
$$;
revoke all on function public.submit_player_tiebreaker(uuid,uuid,uuid,numeric) from public,anon,authenticated;
revoke all on function public.submit_owned_player_tiebreaker(uuid,uuid,uuid,numeric,uuid,uuid) from public;
grant execute on function public.submit_owned_player_tiebreaker(uuid,uuid,uuid,numeric,uuid,uuid) to anon,authenticated;

create or replace function public.get_owned_player_tiebreaker_state(p_game_id uuid,p_team_id uuid,p_request_id uuid,p_request_token uuid)
returns table(attempt_id uuid,prompt text,answer_unit text,attempt_status text,is_participant boolean,numeric_answer numeric,distance numeric,correct_value numeric,is_winner boolean,submitted_count integer,participant_count integer)
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_player_team(p_game_id,p_team_id,p_request_id,p_request_token);
  return query select * from public.get_player_tiebreaker_state(p_game_id,p_team_id);
end;
$$;
revoke all on function public.get_player_tiebreaker_state(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_owned_player_tiebreaker_state(uuid,uuid,uuid,uuid) from public;
grant execute on function public.get_owned_player_tiebreaker_state(uuid,uuid,uuid,uuid) to anon,authenticated;

-- Aggregate correctness without returning anybody else's answer or grading.
create or replace function public.get_player_question_accuracy(p_game_id uuid,p_team_id uuid,p_question_key text,p_request_id uuid,p_request_token uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g public.games%rowtype; q public.game_questions%rowtype; total integer; correct integer; items jsonb:='[]'; answer record; active_ids uuid[];
begin
  perform public.assert_player_team(p_game_id,p_team_id,p_request_id,p_request_token);
  select * into g from public.games where id=p_game_id;
  if g.answer_phase<>'revealed' or g.current_question_key<>p_question_key or g.settings->>'show_correctness_percentage_to_players' is distinct from 'true' then return null; end if;
  select * into q from public.game_questions where game_id=p_game_id and question_key=p_question_key;
  select coalesce(array_agg(id),'{}') into active_ids from public.teams where game_id=p_game_id and last_seen_at>clock_timestamp()-interval '5 minutes';
  total:=cardinality(active_ids);
  select count(*)::integer into correct from public.submissions where game_id=p_game_id and question_key=p_question_key and team_id=any(active_ids) and is_correct;
  if jsonb_typeof(q.correct_answer)='array' then
    for answer in select value,ordinality from jsonb_array_elements_text(q.correct_answer) with ordinality loop
      items:=items||jsonb_build_array((select jsonb_build_object('total',total,'correct',count(*),'percentage',case when total=0 then 0 else round(count(*)*100.0/total) end)
        from public.submissions s where s.game_id=p_game_id and s.question_key=p_question_key and s.team_id=any(active_ids)
        and case when q.question_type='multi-answer' then exists(select 1 from jsonb_array_elements(coalesce(s.grading_json->'items','[]')) item where item->>'status'='correct' and public.normalise_answer_signal(item->>'expected')=public.normalise_answer_signal(answer.value))
          else s.grading_json->'items'->(answer.ordinality::integer-1)->>'status'='correct' end));
    end loop;
  end if;
  return jsonb_build_object('total',total,'correct',correct,'percentage',case when total=0 then 0 else round(correct*100.0/total) end,'items',items);
end;
$$;
revoke all on function public.get_player_question_accuracy(uuid,uuid,text,uuid,uuid) from public;
grant execute on function public.get_player_question_accuracy(uuid,uuid,text,uuid,uuid) to anon,authenticated;

-- Hosts still read the private rows; players use capability-checked projections.
drop policy if exists "Players read live show games" on public.game_show_games;
revoke select on public.game_show_games,public.game_show_game_choices from anon;
drop policy if exists "Participants read elimination game choices" on public.game_show_game_choices;
create policy "Hosts read elimination choices" on public.game_show_game_choices for select to authenticated using
  (exists(select 1 from public.games g join public.quizzes q on q.id=g.quiz_id where g.id=game_show_game_choices.game_id and q.owner_id=auth.uid()));

create or replace function public.get_owned_player_show_game(p_game_id uuid,p_team_id uuid,p_show_game_key text,p_request_id uuid,p_request_token uuid)
returns setof public.game_show_games language plpgsql stable security definer set search_path='' as $$
declare result public.game_show_games%rowtype;
begin
  perform public.assert_player_team(p_game_id,p_team_id,p_request_id,p_request_token);
  select * into result from public.game_show_games where game_id=p_game_id and show_game_key=p_show_game_key;
  if not found then return; end if;
  if result.game_type='beat-the-bomb' and result.status<>'exploded' then
    result.explode_at:=(result.settings->>'danger_ends_at')::timestamptz;
  end if;
  return next result;
end;
$$;
revoke all on function public.get_owned_player_show_game(uuid,uuid,text,uuid,uuid) from public;
grant execute on function public.get_owned_player_show_game(uuid,uuid,text,uuid,uuid) to anon,authenticated;

create or replace function public.get_owned_player_choices(p_game_id uuid,p_team_id uuid,p_show_game_id uuid,p_round_number integer,p_request_id uuid,p_request_token uuid)
returns table(team_id uuid,choice text) language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_player_team(p_game_id,p_team_id,p_request_id,p_request_token);
  return query select c.team_id,c.choice from public.game_show_game_choices c join public.game_show_games sg on sg.id=c.game_show_game_id
    where sg.game_id=p_game_id and sg.id=p_show_game_id and c.round_number=p_round_number
      and (sg.game_type<>'scissors-paper-rock' or c.team_id=p_team_id
        or sg.settings->>'round_phase'<>'choosing' or (sg.settings->>'round_number')::integer>p_round_number);
end;
$$;
revoke all on function public.get_owned_player_choices(uuid,uuid,uuid,integer,uuid,uuid) from public;
grant execute on function public.get_owned_player_choices(uuid,uuid,uuid,integer,uuid,uuid) to anon,authenticated;
create or replace function public.cut_beat_the_bomb_wire(p_game_show_game_id uuid,p_request_id uuid,p_request_token uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare team uuid; result public.game_show_games%rowtype; danger_ends timestamptz; existing_presses integer;
begin
  team:=public.collaborative_game_team(p_game_show_game_id,p_request_id,p_request_token,'beat-the-bomb');
  select * into result from public.game_show_games where id=p_game_show_game_id for update;
  if result.status<>'open' then raise exception 'BOMB_EXPLODED'; end if;
  if clock_timestamp()<(result.settings->>'armed_at')::timestamptz then raise exception 'BOMB_ARMING'; end if;
  danger_ends:=coalesce((result.settings->>'danger_ends_at')::timestamptz,(result.settings->>'armed_at')::timestamptz+interval '60 seconds');
  select count(*) into existing_presses from public.game_show_game_presses where game_show_game_id=result.id;
  if clock_timestamp()>=result.explode_at and existing_presses>0 then raise exception 'BOMB_EXPLODED'; end if;
  if clock_timestamp()>=result.explode_at and existing_presses=0 and clock_timestamp()<danger_ends then
    update public.game_show_games set explode_at=danger_ends where id=result.id returning * into result;
  end if;
  insert into public.game_show_game_presses(game_show_game_id,game_id,team_id) values(result.id,result.game_id,team)
  on conflict(game_show_game_id,team_id) do nothing;
  if not found then raise exception 'WIRE_ALREADY_CUT'; end if;
  if coalesce((result.settings->>'overtime')::boolean,false) then
    update public.game_show_games set explode_at=clock_timestamp() where id=result.id returning * into result;
  end if;
  -- The response is public; retain the random schedule only in the stored row.
  result.explode_at:=danger_ends;
  return result;
end; $$;
commit;
