begin;

set local lock_timeout='3s';

set local statement_timeout='20s';

-- F7: do not sever the ownership link used by live-game RPCs.

create or replace function public.protect_live_quiz_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.games where quiz_id=old.id and status in ('lobby','live')) then
    raise exception 'Finish or cancel the active games before deleting this quiz.';
  end if;
  if exists (select 1 from public.quiz_templates where source_quiz_id=old.id and structure is null) then
    raise exception 'Open and save the legacy template before deleting its source quiz.';
  end if;
  return old;
end;
$$;
revoke all on function public.protect_live_quiz_deletion() from public, anon, authenticated;
create trigger protect_live_quiz_deletion before delete on public.quizzes
for each row execute function public.protect_live_quiz_deletion();

-- F6: saved structures are independent; preserve them when the source is removed.
alter table public.quiz_templates alter column source_quiz_id drop not null;
alter table public.quiz_templates drop constraint quiz_templates_source_quiz_id_fkey;
alter table public.quiz_templates add constraint quiz_templates_source_quiz_id_fkey
  foreign key(source_quiz_id) references public.quizzes(id) on delete set null;

-- F11: after the first overtime cut, later cuts cannot steal the winner.

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
  return result;
end; $$;

-- F12: a removed team cannot win or block cursor resolution.

create or replace function public.advance_shared_cursor(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; candidate uuid; since_ms bigint; winner uuid; reward integer; nearest record;
begin
  select sg.* into result from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id where sg.id=p_game_show_game_id and sg.game_type='shared-cursor' and q.owner_id=auth.uid() for update of sg;
  if result.id is null then raise exception 'Shared Cursor not found'; end if; if result.status<>'open' then return result; end if;
  if not exists(select 1 from jsonb_each(result.settings->'cursor_positions') where exists(select 1 from public.teams where id=key::uuid and game_id=result.game_id)) then
    update public.game_show_games set status='exploded',exploded_at=clock_timestamp(),winner_team_id=null,reward_points_awarded=0 where id=result.id returning * into result;
    return result;
  end if;
  candidate:=nullif(result.settings->>'cursor_candidate_id','')::uuid; since_ms:=nullif(result.settings->>'cursor_candidate_since_ms','')::bigint;
  if candidate is not null and exists(select 1 from public.teams where id=candidate and game_id=result.game_id) and since_ms is not null and floor(extract(epoch from clock_timestamp())*1000)-since_ms>=1000 then winner:=candidate; end if;
  if winner is null and clock_timestamp()>=result.explode_at then
    select key::uuid into winner from jsonb_each(result.settings->'cursor_positions') where exists(select 1 from public.teams where id=key::uuid and game_id=result.game_id) order by power((value->>'x')::numeric-(result.settings->>'cursor_x')::numeric,2)+power((value->>'y')::numeric-(result.settings->>'cursor_y')::numeric,2) limit 1;
  end if;
  if winner is not null then reward:=public.beat_the_bomb_reward_points(result.settings); if reward>0 then update public.teams set score=score+reward where id=winner; end if; update public.game_show_games set status='exploded',exploded_at=clock_timestamp(),winner_team_id=winner,reward_points_awarded=reward where id=result.id returning * into result; end if;
  return result;
end; $$;

-- D2: difficulty uses expected answer slots, not guesses plus missing answers.

create or replace function public.capture_question_performance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot public.game_questions%rowtype;
  correct_count integer;
  item_count integer;
  missing_count integer;
  prior_source_id uuid;
begin
  if tg_op = 'DELETE' then
    select source_question_id into prior_source_id
    from public.question_performance_events
    where submission_id = old.id;
    delete from public.question_performance_events where submission_id = old.id;
    if prior_source_id is not null then
      perform public.refresh_question_observed_difficulty(prior_source_id);
    end if;
    return old;
  end if;

  if new.is_correct is null then
    return new;
  end if;

  select * into snapshot
  from public.game_questions
  where game_id = new.game_id and question_key = new.question_key;

  if snapshot.source_question_id is null
     or not public.question_snapshot_matches_source(new.game_id, new.question_key) then
    select source_question_id into prior_source_id
    from public.question_performance_events
    where submission_id = new.id;
    delete from public.question_performance_events where submission_id = new.id;
    if prior_source_id is not null then
      perform public.refresh_question_observed_difficulty(prior_source_id);
    end if;
    return new;
  end if;

  select count(*) filter (where item->>'status' = 'correct')::integer,
         count(*)::integer
    into correct_count, item_count
  from jsonb_array_elements(case when jsonb_typeof(new.grading_json->'items')='array' then new.grading_json->'items' else '[]'::jsonb end) item;

  missing_count := case
    when jsonb_typeof(new.grading_json->'missing') = 'array'
      then jsonb_array_length(new.grading_json->'missing')
    else 0
  end;
  -- Every expected answer is counted once; wrong guesses do not add slots.
  item_count := case when snapshot.question_type in ('multi-answer','multi-part','ranking')
    and jsonb_typeof(snapshot.correct_answer) = 'array'
    then greatest(jsonb_array_length(snapshot.correct_answer), 1) else 1 end;

  if item_count is null or jsonb_typeof(new.grading_json->'items') is distinct from 'array' or new.grading_json->'items'='[]'::jsonb then
    correct_count := case when new.is_correct then item_count else 0 end;
  else
    correct_count := least(coalesce(correct_count, 0), item_count);
  end if;

  select source_question_id into prior_source_id
  from public.question_performance_events
  where submission_id = new.id;

  insert into public.question_performance_events (
    submission_id, source_question_id, source_revision, game_id, team_id,
    correct_items, total_items, points_awarded, points_possible
  ) values (
    new.id, snapshot.source_question_id, snapshot.source_revision, new.game_id, new.team_id,
    correct_count, item_count, greatest(new.points_awarded, 0), greatest(snapshot.points_max, 1)
  )
  on conflict (submission_id) do update set
    source_question_id = excluded.source_question_id,
    source_revision = excluded.source_revision,
    correct_items = excluded.correct_items,
    total_items = excluded.total_items,
    points_awarded = excluded.points_awarded,
    points_possible = excluded.points_possible,
    updated_at = now();

  perform public.refresh_question_observed_difficulty(snapshot.source_question_id);
  if prior_source_id is not null and prior_source_id <> snapshot.source_question_id then
    perform public.refresh_question_observed_difficulty(prior_source_id);
  end if;
  return new;
end;
$$;

-- E3: undo each submission's actual speed multiplier for correctness.

-- Repair prior adaptive samples as well as future submissions. Only derived
-- analytics change; frozen questions, player answers and awarded scores do not.
do $$
declare source_id uuid;
begin
  for source_id in
    with expected as (
      select e.submission_id, case when q.question_type in ('multi-answer','multi-part','ranking') and jsonb_typeof(q.correct_answer)='array'
        then greatest(jsonb_array_length(q.correct_answer),1) else 1 end as slots
      from public.question_performance_events e join public.game_questions q on q.game_id=e.game_id and q.question_key=(select question_key from public.submissions where id=e.submission_id)
    ), repaired as (
      update public.question_performance_events e set total_items=x.slots,correct_items=least(e.correct_items,x.slots),updated_at=now()
      from expected x where e.submission_id=x.submission_id and e.total_items<>x.slots returning e.source_question_id
    ) select distinct source_question_id from repaired
  loop
    perform public.refresh_question_observed_difficulty(source_id);
  end loop;
end $$;

create or replace function public.get_host_team_stats()
returns table (
  team_profile_id uuid,
  display_name text,
  games_played bigint,
  average_placement numeric,
  best_placement integer,
  wins bigint,
  correct_points bigint,
  possible_points bigint,
  correct_rate numeric,
  total_points bigint,
  recent_game_title text,
  recent_game_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with finished_host_teams as (
    select
      teams.id as team_id,
      teams.team_profile_id,
      teams.score,
      coalesce(
        teams.final_placement,
        rank() over (partition by games.id order by teams.score desc)::integer
      ) as placement,
      games.id as game_id,
      games.title as game_title,
      games.created_at as game_at
    from public.teams
    join public.games on games.id = teams.game_id
    join public.quizzes on quizzes.id = games.quiz_id
    where quizzes.owner_id = (select auth.uid())
      and games.status = 'finished'
      and teams.team_profile_id is not null
  ),
  attempts as (
    select
      host_teams.team_profile_id,
      least(greatest(game_questions.points_max, 0), greatest(submissions.points_awarded, 0) / coalesce(nullif(submissions.speed_points_max, 0), 1))::bigint as correct_points,
      greatest(game_questions.points_max, 0)::bigint as possible_points
    from finished_host_teams host_teams
    join public.submissions on submissions.team_id = host_teams.team_id
    join public.game_questions
      on game_questions.game_id = submissions.game_id
      and game_questions.question_key = submissions.question_key

    union all

    select
      host_teams.team_profile_id,
      least(greatest(coalesce((game_questions.bonus->>'points')::integer, 1), 0), greatest(bonus_submissions.points_awarded, 0) / coalesce(nullif(bonus_submissions.speed_points_max, 0), 1))::bigint,
      greatest(coalesce((game_questions.bonus->>'points')::integer, 1), 0)::bigint
    from finished_host_teams host_teams
    join public.bonus_submissions on bonus_submissions.team_id = host_teams.team_id
    join public.game_questions
      on game_questions.game_id = bonus_submissions.game_id
      and game_questions.question_key = bonus_submissions.question_key
  ),
  answer_totals as (
    select
      team_profile_id,
      sum(correct_points)::bigint as correct_points,
      sum(possible_points)::bigint as possible_points
    from attempts
    group by team_profile_id
  ),
  history as (
    select
      host_teams.team_profile_id,
      count(*)::bigint as games_played,
      round(avg(host_teams.placement)::numeric, 1) as average_placement,
      min(host_teams.placement)::integer as best_placement,
      count(*) filter (where host_teams.placement = 1)::bigint as wins,
      sum(host_teams.score)::bigint as total_points,
      (array_agg(host_teams.game_title order by host_teams.game_at desc))[1] as recent_game_title,
      max(host_teams.game_at) as recent_game_at
    from finished_host_teams host_teams
    group by host_teams.team_profile_id
  )
  select
    profiles.id,
    profiles.display_name,
    history.games_played,
    history.average_placement,
    history.best_placement,
    history.wins,
    coalesce(answer_totals.correct_points, 0),
    coalesce(answer_totals.possible_points, 0),
    case
      when coalesce(answer_totals.possible_points, 0) = 0 then null
      else round(100 * answer_totals.correct_points::numeric / answer_totals.possible_points, 1)
    end,
    history.total_points,
    history.recent_game_title,
    history.recent_game_at
  from history
  join public.team_profiles profiles on profiles.id = history.team_profile_id
  left join answer_totals on answer_totals.team_profile_id = history.team_profile_id
  order by history.games_played desc, history.average_placement asc, profiles.display_name;
$$;

-- E10: closest prizes target occupied placement groups, including allowed ties.

create or replace function public.finalize_game_with_prizes(p_game_id uuid)
returns integer language plpgsql security invoker set search_path = ''
as $$
declare
  game_settings jsonb; team_count integer; tie_score integer; tie_team_ids uuid[]; score_group record;
  ordered_ids uuid[]; resolution_method text; team_id_value uuid; team_index integer; rank_cursor integer := 1;
  team_top_place integer; team_bottom_place integer; top_setting jsonb; bottom_setting jsonb;
  custom_setting jsonb; custom_position integer; effective_position integer; placement_label text;
  team_awards jsonb; awarded_team_count integer; top_labels text[] := array['1st', '2nd', '3rd'];
  bottom_labels text[] := array['Last', '2nd Last', '3rd Last'];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select games.settings into game_settings
  from public.games join public.quizzes on quizzes.id = games.quiz_id
  where games.id = p_game_id and quizzes.owner_id = auth.uid()
  for update of games;
  if not found then raise exception 'Game not found or not owned by current host'; end if;

  select count(*) into team_count from public.teams where game_id = p_game_id;

  -- A resolution belongs to an exact set of teams, not merely a score value.
  -- Bonus awards/removals may change that set while the resolution is open.
  update public.game_tie_resolutions r set
    team_ids=current_group.ids, status='pending', resolution_method=null,
    ordered_team_ids=null, resolved_at=null
  from (
    select t.score, array_agg(t.id order by t.name,t.id) ids
    from public.teams t where t.game_id=p_game_id group by t.score having count(*)>1
  ) current_group
  where r.game_id=p_game_id and r.tied_score=current_group.score
    and not (r.team_ids @> current_group.ids and r.team_ids <@ current_group.ids
      and cardinality(r.team_ids)=cardinality(current_group.ids));

  with groups as (
    select teams.score,
      array_agg(teams.id order by teams.name, teams.id) ids,
      count(*)::integer group_size,
      (select count(*)::integer from public.teams higher where higher.game_id=p_game_id and higher.score>teams.score)+1 top_start,
      (select count(*)::integer from public.teams lower where lower.game_id=p_game_id and lower.score<teams.score)+1 bottom_start
    from public.teams teams where teams.game_id=p_game_id group by teams.score
  )
  select groups.score, groups.ids into tie_score, tie_team_ids
  from groups
  where groups.group_size > 1
    and not exists (
      select 1 from public.game_tie_resolutions r
      where r.game_id=p_game_id and r.tied_score=groups.score and r.status='resolved'
    )
    and (
      (coalesce((game_settings->>'skip_unneeded_tiebreakers')::boolean, false) = false and groups.top_start = 1)
      or exists (
        select 1 from generate_series(1,3) place
        where game_settings->'top_prizes'->(place-1)->>'enabled'='true'
          and place between groups.top_start and groups.top_start+groups.group_size-1
      )
      or exists (
        select 1 from generate_series(1,3) place
        where game_settings->'bottom_prizes'->(place-1)->>'enabled'='true'
          and place between groups.bottom_start and groups.bottom_start+groups.group_size-1
      )
      or exists (
        select 1
        from jsonb_array_elements(coalesce(game_settings->'other_prizes', '[]'::jsonb)) custom
        where custom->>'enabled'='true'
          and case
            when coalesce(custom->>'position','') ~ '^[0-9]+$'
              and (custom->>'position')::integer <= team_count then (custom->>'position')::integer
            when coalesce(custom->>'position','') ~ '^[0-9]+$'
              and custom->>'missing_behavior'='closest' then team_count
            else 0
          end between groups.top_start and groups.top_start+groups.group_size-1
      )
    )
  order by groups.score desc limit 1;

  if tie_team_ids is not null then
    insert into public.game_tie_resolutions(game_id,tied_score,team_ids)
    values(p_game_id,tie_score,tie_team_ids)
    on conflict(game_id,tied_score) do nothing;
    update public.games
    set status='live',current_screen='tiebreaker-pending',answer_phase='closed',current_tiebreaker_attempt_id=null
    where id=p_game_id;
    return -1;
  end if;

  update public.teams
  set prize_awards='[]'::jsonb,final_placement=null,final_bottom_placement=null,final_sort_order=null
  where game_id=p_game_id;

  for score_group in
    select teams.score,array_agg(teams.id order by teams.name,teams.id) ids,count(*)::integer group_size
    from public.teams teams where teams.game_id=p_game_id group by teams.score order by teams.score desc
  loop
    resolution_method:=null; ordered_ids:=null;
    select r.resolution_method,r.ordered_team_ids into resolution_method,ordered_ids
    from public.game_tie_resolutions r
    where r.game_id=p_game_id and r.tied_score=score_group.score and r.status='resolved'
      and r.team_ids @> score_group.ids and r.team_ids <@ score_group.ids
      and cardinality(r.team_ids)=cardinality(score_group.ids);

    if coalesce(resolution_method,'') not in ('tiebreaker','manual','show_game') or ordered_ids is null then
      ordered_ids:=score_group.ids;
    end if;

    for team_index in 1..cardinality(ordered_ids) loop
      team_id_value:=ordered_ids[team_index];
      if resolution_method in ('tiebreaker','manual','show_game') then
        team_top_place:=rank_cursor+team_index-1;
        team_bottom_place:=team_count-rank_cursor-team_index+2;
      else
        team_top_place:=rank_cursor;
        team_bottom_place:=team_count-rank_cursor-score_group.group_size+2;
      end if;
      update public.teams
      set final_placement=team_top_place,final_bottom_placement=team_bottom_place,final_sort_order=rank_cursor+team_index-1
      where id=team_id_value;
    end loop;
    rank_cursor:=rank_cursor+score_group.group_size;
  end loop;

  for score_group in
    select id,final_placement,final_bottom_placement
    from public.teams where game_id=p_game_id order by final_sort_order
  loop
    team_awards:='[]'::jsonb;
    if score_group.final_placement between 1 and 3 then
      top_setting:=game_settings->'top_prizes'->(score_group.final_placement-1);
      if top_setting->>'enabled'='true' and btrim(coalesce(top_setting->>'msg',''))<>'' then
        team_awards:=team_awards||jsonb_build_array(jsonb_build_object('placement',top_labels[score_group.final_placement],'message',btrim(top_setting->>'msg')));
      end if;
    end if;
    if score_group.final_bottom_placement between 1 and 3 then
      bottom_setting:=game_settings->'bottom_prizes'->(score_group.final_bottom_placement-1);
      if bottom_setting->>'enabled'='true' and btrim(coalesce(bottom_setting->>'msg',''))<>'' then
        team_awards:=team_awards||jsonb_build_array(jsonb_build_object('placement',bottom_labels[score_group.final_bottom_placement],'message',btrim(bottom_setting->>'msg')));
      end if;
    end if;

    for custom_setting in
      select value from jsonb_array_elements(coalesce(game_settings->'other_prizes','[]'::jsonb))
    loop
      if custom_setting->>'enabled'='true'
        and btrim(coalesce(custom_setting->>'msg',''))<>''
        and coalesce(custom_setting->>'position','') ~ '^[0-9]+$' then
        custom_position := greatest(1, (custom_setting->>'position')::integer);
        effective_position := case
          when custom_setting->>'missing_behavior'='closest' then (
            select t.final_placement from public.teams t where t.game_id=p_game_id and t.final_placement is not null
            order by abs(t.final_placement::bigint-custom_position::bigint), t.final_placement limit 1
          )
          when custom_position <= team_count then custom_position
          else 0
        end;
        if score_group.final_placement = effective_position then
          placement_label := custom_position::text ||
            case
              when custom_position % 100 between 11 and 13 then 'th'
              when custom_position % 10 = 1 then 'st'
              when custom_position % 10 = 2 then 'nd'
              when custom_position % 10 = 3 then 'rd'
              else 'th'
            end;
          team_awards:=team_awards||jsonb_build_array(jsonb_build_object('placement',placement_label,'message',btrim(custom_setting->>'msg')));
        end if;
      end if;
    end loop;
    update public.teams set prize_awards=team_awards where id=score_group.id;
  end loop;

  update public.games
  set status='finished',current_screen='final-result',answer_phase='revealed',
      current_content_screen_key=null,current_tiebreaker_attempt_id=null
  where id=p_game_id;

  select count(*) into awarded_team_count
  from public.teams where game_id=p_game_id and jsonb_array_length(prize_awards)>0;
  return awarded_team_count;
end;
$$;

commit;
