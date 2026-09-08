begin;

create or replace function public.rescore_submission(
  p_submission_id uuid,
  p_grading_json jsonb,
  p_points_awarded integer
)
returns public.submissions
language plpgsql security definer set search_path = public
as $$
declare
  selected public.submissions%rowtype;
  maximum integer;
  old_points integer;
  next_points integer;
begin
  select submissions.*
  into selected
  from public.submissions
  join public.game_questions
    on game_questions.game_id = submissions.game_id
   and game_questions.question_key = submissions.question_key
  join public.games on games.id = submissions.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where submissions.id = p_submission_id
    and quizzes.owner_id = auth.uid()
  for update of submissions;

  if selected.id is null then raise exception 'Submission not found or not owned by current host'; end if;
  select greatest(points_max, 1) into maximum
  from public.game_questions
  where game_id = selected.game_id and question_key = selected.question_key;
  old_points := coalesce(selected.points_awarded, 0);
  next_points := least(greatest(coalesce(p_points_awarded, 0), 0), greatest(maximum, 1));

  update public.submissions
  set grading_json = coalesce(p_grading_json, '{}'::jsonb),
      points_awarded = next_points,
      is_correct = next_points >= greatest(maximum, 1)
  where id = selected.id
  returning * into selected;

  update public.teams
  set score = score + next_points - old_points
  where id = selected.team_id;

  return selected;
end;
$$;

create or replace function public.rescore_bonus_submission(
  p_submission_id uuid,
  p_grading_json jsonb,
  p_points_awarded integer
)
returns public.bonus_submissions
language plpgsql security definer set search_path = public
as $$
declare
  selected public.bonus_submissions%rowtype;
  maximum integer;
  old_points integer;
  next_points integer;
begin
  select bonus_submissions.*
  into selected
  from public.bonus_submissions
  join public.game_questions
    on game_questions.game_id = bonus_submissions.game_id
   and game_questions.question_key = bonus_submissions.question_key
  join public.games on games.id = bonus_submissions.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where bonus_submissions.id = p_submission_id
    and quizzes.owner_id = auth.uid()
  for update of bonus_submissions;

  if selected.id is null then raise exception 'Bonus submission not found or not owned by current host'; end if;
  select greatest(1, coalesce((bonus->>'points')::integer, 1)) into maximum
  from public.game_questions
  where game_id = selected.game_id and question_key = selected.question_key;
  old_points := coalesce(selected.points_awarded, 0);
  next_points := least(greatest(coalesce(p_points_awarded, 0), 0), maximum);

  update public.bonus_submissions
  set grading_json = coalesce(p_grading_json, '{}'::jsonb),
      points_awarded = next_points,
      is_correct = next_points >= maximum
  where id = selected.id
  returning * into selected;

  update public.teams
  set score = score + next_points - old_points
  where id = selected.team_id;

  return selected;
end;
$$;

create or replace function public.start_spin_the_wheel(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = ''
as $$
declare
  result public.game_show_games%rowtype;
  eligible_team_ids jsonb;
begin
  select jsonb_agg(teams.id order by teams.created_at) into eligible_team_ids
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  join public.teams on teams.game_id = games.id
  where game_show_games.id = p_game_show_game_id
    and game_show_games.game_type = 'spin-the-wheel'
    and game_show_games.status = 'ready'
    and quizzes.owner_id = auth.uid()
    and teams.last_seen_at > clock_timestamp() - interval '5 minutes';

  if eligible_team_ids is null or jsonb_array_length(eligible_team_ids) = 0 then
    raise exception 'Spin the Wheel needs at least one active team';
  end if;

  update public.game_show_games
  set status = 'open', started_at = clock_timestamp(),
      explode_at = clock_timestamp() + interval '3 seconds', exploded_at = null,
      winner_team_id = null, reward_points_awarded = 0,
      settings = settings || jsonb_build_object('eligible_team_ids', eligible_team_ids)
  where id = p_game_show_game_id
  returning * into result;

  if result.id is null then raise exception 'Show game not found, already started, or not owned by current host'; end if;
  return result;
end;
$$;

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
    where r.game_id=p_game_id and r.tied_score=score_group.score and r.status='resolved';

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
          when custom_position <= team_count then custom_position
          when custom_setting->>'missing_behavior'='closest' then team_count
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

create or replace function public.submit_elimination_show_game_choice(
  p_game_show_game_id uuid,
  p_request_id uuid,
  p_request_token uuid,
  p_choice text
)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  request_row public.team_join_requests%rowtype;
  result public.game_show_games%rowtype;
  current_round integer;
  other_choice text;
begin
  select * into request_row from public.team_join_requests
  where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;

  select * into result from public.game_show_games
  where id = p_game_show_game_id and game_id = request_row.game_id
  for update;

  if result.id is null or result.status <> 'open' or result.settings->>'round_phase' <> 'choosing'
    or clock_timestamp() >= result.explode_at then raise exception 'CHOICES_CLOSED'; end if;
  if not (result.settings->'alive_team_ids' ? request_row.team_id::text) then raise exception 'TEAM_ELIMINATED'; end if;
  if result.game_type = 'heads-or-tails' and p_choice not in ('heads', 'tails') then raise exception 'CHOICE_INVALID'; end if;
  if result.game_type = 'dodge-the-rock' and p_choice not in ('0', '1', '2') then raise exception 'CHOICE_INVALID'; end if;
  if result.game_type = 'scissors-paper-rock' and p_choice not in ('scissors', 'paper', 'rock') then raise exception 'CHOICE_INVALID'; end if;
  if result.game_type not in ('heads-or-tails', 'dodge-the-rock', 'scissors-paper-rock') then raise exception 'SHOW_GAME_INVALID'; end if;

  current_round := (result.settings->>'round_number')::integer;

  if result.game_type = 'dodge-the-rock'
    and jsonb_array_length(result.settings->'alive_team_ids') = 2 then
    select choice into other_choice
    from public.game_show_game_choices
    where game_show_game_id=result.id and round_number=current_round
      and team_id<>request_row.team_id
      and result.settings->'alive_team_ids' ? team_id::text
    limit 1;
    if other_choice = p_choice then raise exception 'FINAL_LANE_TAKEN'; end if;
  end if;

  insert into public.game_show_game_choices (game_show_game_id, game_id, team_id, round_number, choice)
  values (result.id, result.game_id, request_row.team_id, current_round, p_choice)
  on conflict (game_show_game_id, round_number, team_id)
  do update set choice = excluded.choice, submitted_at = clock_timestamp();

  if result.game_type = 'dodge-the-rock' then
    update public.game_show_games
    set settings = jsonb_set(settings,'{positions}',
      coalesce(settings->'positions','{}'::jsonb)||jsonb_build_object(request_row.team_id::text,p_choice::integer),true)
    where id=result.id returning * into result;
  end if;
  return result;
end;
$$;

-- Keep the current resolver body, but force a two-team final with distinct
-- positions to target one occupied lane.
create or replace function public.resolve_elimination_show_game(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare
  result public.game_show_games%rowtype;
  alive_ids uuid[]; survivor_ids uuid[] := '{}'::uuid[]; eliminated_ids uuid[] := '{}'::uuid[];
  current_round integer; outcome text; rock_lane integer; previous_rock_lane integer; reward_points integer;
  matchup jsonb; team_a uuid; team_b uuid; choice_a text; choice_b text; bye_team_id uuid;
  distinct_rock_positions integer;
begin
  select game_show_games.* into result
  from public.game_show_games
  join public.games on games.id=game_show_games.game_id
  join public.quizzes on quizzes.id=games.quiz_id
  where game_show_games.id=p_game_show_game_id
    and game_show_games.game_type in ('heads-or-tails','dodge-the-rock','scissors-paper-rock')
    and quizzes.owner_id=auth.uid()
  for update of game_show_games;

  if result.id is null then raise exception 'Show game not found or not owned by current host'; end if;
  if result.status<>'open' or result.settings->>'round_phase'<>'choosing' then return result; end if;
  if clock_timestamp()<result.explode_at then return result; end if;

  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into alive_ids
  from jsonb_array_elements_text(result.settings->'alive_team_ids') value;
  current_round := (result.settings->>'round_number')::integer;

  if result.game_type='heads-or-tails' then
    outcome := case when random()<0.5 then 'heads' else 'tails' end;
    select coalesce(array_agg(choices.team_id),'{}'::uuid[]) into survivor_ids
    from public.game_show_game_choices choices
    where choices.game_show_game_id=result.id and choices.round_number=current_round
      and choices.team_id=any(alive_ids) and choices.choice=outcome;
    if cardinality(survivor_ids)=0 then survivor_ids:=alive_ids; end if;
  elsif result.game_type='dodge-the-rock' then
    begin previous_rock_lane:=nullif(result.settings->>'last_rock_lane','')::integer;
    exception when invalid_text_representation then previous_rock_lane:=null; end;

    select count(distinct coalesce((result.settings->'positions'->>team_id::text)::integer,1))
    into distinct_rock_positions from unnest(alive_ids) team_id;

    if cardinality(alive_ids)=2 and distinct_rock_positions=2 then
      select coalesce((result.settings->'positions'->>team_id::text)::integer,1) into rock_lane
      from unnest(alive_ids) team_id order by random() limit 1;
    else
      select lane into rock_lane from generate_series(0,2) lane
      where (select count(*) from unnest(alive_ids) team_id
        where coalesce((result.settings->'positions'->>team_id::text)::integer,1)=lane)<cardinality(alive_ids)
      order by case when lane=previous_rock_lane then 1 else 0 end, random() limit 1;
    end if;

    outcome:=rock_lane::text;
    select coalesce(array_agg(team_id),'{}'::uuid[]) into survivor_ids
    from unnest(alive_ids) team_id
    where coalesce((result.settings->'positions'->>team_id::text)::integer,1)<>rock_lane;
  else
    outcome:='matchups-resolved';
    begin bye_team_id:=nullif(result.settings->>'round_bye_team_id','')::uuid;
    exception when invalid_text_representation then bye_team_id:=null; end;
    if bye_team_id is not null then survivor_ids:=array_append(survivor_ids,bye_team_id); end if;
    for matchup in select value from jsonb_array_elements(coalesce(result.settings->'round_matchups','[]'::jsonb)) loop
      team_a:=(matchup->>'team_a')::uuid; team_b:=(matchup->>'team_b')::uuid;
      select choice into choice_a from public.game_show_game_choices where game_show_game_id=result.id and round_number=current_round and team_id=team_a;
      select choice into choice_b from public.game_show_game_choices where game_show_game_id=result.id and round_number=current_round and team_id=team_b;
      if choice_a is null and choice_b is null then survivor_ids:=array_append(array_append(survivor_ids,team_a),team_b);
      elsif choice_a is null then survivor_ids:=array_append(survivor_ids,team_b);
      elsif choice_b is null then survivor_ids:=array_append(survivor_ids,team_a);
      elsif choice_a=choice_b then survivor_ids:=array_append(array_append(survivor_ids,team_a),team_b);
      elsif (choice_a='scissors' and choice_b='paper') or (choice_a='paper' and choice_b='rock') or (choice_a='rock' and choice_b='scissors')
        then survivor_ids:=array_append(survivor_ids,team_a);
      else survivor_ids:=array_append(survivor_ids,team_b); end if;
    end loop;
  end if;

  select coalesce(array_agg(team_id),'{}'::uuid[]) into eliminated_ids
  from unnest(alive_ids) team_id where not (team_id=any(survivor_ids));

  update public.game_show_games
  set settings=settings||jsonb_build_object(
      'alive_team_ids',to_jsonb(survivor_ids),
      'eliminated_team_ids',coalesce(settings->'eliminated_team_ids','[]'::jsonb)||to_jsonb(eliminated_ids),
      'round_eliminated_team_ids',to_jsonb(eliminated_ids),
      'round_phase','reveal','round_outcome',outcome)
    ||case when result.game_type='dodge-the-rock' then jsonb_build_object('last_rock_lane',rock_lane) else '{}'::jsonb end,
    explode_at=clock_timestamp()+interval '4 seconds'
  where id=result.id returning * into result;

  if cardinality(survivor_ids)=1 then
    reward_points:=public.beat_the_bomb_reward_points(result.settings);
    update public.teams set score=score+reward_points where id=survivor_ids[1];
    update public.game_show_games
    set status='exploded',exploded_at=clock_timestamp(),winner_team_id=survivor_ids[1],reward_points_awarded=reward_points
    where id=result.id returning * into result;
  end if;
  return result;
end;
$$;

revoke all on function public.rescore_submission(uuid,jsonb,integer) from public;
revoke all on function public.rescore_bonus_submission(uuid,jsonb,integer) from public;
revoke all on function public.start_spin_the_wheel(uuid) from public;
revoke all on function public.submit_elimination_show_game_choice(uuid,uuid,uuid,text) from public;
revoke all on function public.resolve_elimination_show_game(uuid) from public;
grant execute on function public.rescore_submission(uuid,jsonb,integer) to authenticated;
grant execute on function public.rescore_bonus_submission(uuid,jsonb,integer) to authenticated;
grant execute on function public.start_spin_the_wheel(uuid) to authenticated;
grant execute on function public.submit_elimination_show_game_choice(uuid,uuid,uuid,text) to anon, authenticated;
grant execute on function public.resolve_elimination_show_game(uuid) to authenticated;

commit;
