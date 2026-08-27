begin;

alter table public.game_tie_resolutions drop constraint if exists game_tie_resolutions_resolution_method_check;
alter table public.game_tie_resolutions add constraint game_tie_resolutions_resolution_method_check
  check (resolution_method in ('tiebreaker', 'allowed_tie', 'manual', 'show_game'));

create or replace function public.prepare_tie_show_game(
  p_resolution_id uuid,
  p_game_type text,
  p_prompt text default null,
  p_correct_number numeric default null
)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare resolution public.game_tie_resolutions%rowtype; result public.game_show_games%rowtype;
  item_position_value integer; round_number_value integer; key_value text;
begin
  select resolutions.* into resolution from public.game_tie_resolutions resolutions
  join public.games on games.id = resolutions.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where resolutions.id = p_resolution_id and resolutions.status = 'pending' and quizzes.owner_id = auth.uid()
  for update of resolutions;
  if resolution.id is null then raise exception 'Pending tie not found or not owned by current host'; end if;
  if cardinality(resolution.team_ids) <> 2 then raise exception 'Show games currently settle two-team ties'; end if;
  if p_game_type not in ('spin-the-wheel', 'beat-the-bomb', 'heads-or-tails', 'dodge-the-rock', 'audience-question') then raise exception 'Unsupported show game'; end if;
  if p_game_type = 'audience-question' and (btrim(coalesce(p_prompt, '')) = '' or p_correct_number is null) then
    raise exception 'Audience Question needs a prompt and correct number';
  end if;

  select coalesce(max(item_position), 0) + 1, coalesce(max(round_number), 1)
  into item_position_value, round_number_value from public.game_show_games where game_id = resolution.game_id;
  key_value := 'tie-game-' || gen_random_uuid()::text;
  insert into public.game_show_games (
    game_id, quiz_show_game_id, show_game_key, item_position, round_number, round_title,
    game_type, title, settings
  ) values (
    resolution.game_id, null, key_value, item_position_value, round_number_value, 'Final Tiebreak',
    p_game_type,
    case p_game_type when 'spin-the-wheel' then 'Spin the Wheel' when 'beat-the-bomb' then 'Beat the Bomb'
      when 'heads-or-tails' then 'Heads or Tails' when 'dodge-the-rock' then 'Dodge the Rock' else 'Audience Question' end,
    jsonb_build_object(
      'tie_resolution_id', resolution.id,
      'eligible_team_ids', to_jsonb(resolution.team_ids),
      'reward_type', 'custom', 'reward_points', 0,
      'reward_description', 'Winner takes the higher placement. Scores will not change.',
      'winner_message', 'You won the tiebreak game!',
      'audience_question_mode', case when p_game_type = 'audience-question' then 'closest-number' else null end,
      'prompt', case when p_game_type = 'audience-question' then btrim(p_prompt) else null end,
      'allow_multiple_winners', false
    )
  ) returning * into result;

  if p_game_type = 'audience-question' then
    insert into public.game_show_game_audience_private (game_show_game_id, correct_number) values (result.id, p_correct_number);
  end if;
  update public.games set status = 'live', current_screen = 'show-game', answer_phase = 'closed',
    current_show_game_key = result.show_game_key, current_tiebreaker_attempt_id = null
  where id = resolution.game_id;
  return result;
end;
$$;

create or replace function public.start_tie_show_game(p_game_show_game_id uuid)
returns public.game_show_games
language plpgsql security definer set search_path = public
as $$
declare result public.game_show_games%rowtype; eligible jsonb; initial_positions jsonb;
begin
  select game_show_games.* into result from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id and game_show_games.status = 'ready'
    and game_show_games.settings ? 'tie_resolution_id' and quizzes.owner_id = auth.uid()
  for update of game_show_games;
  if result.id is null then raise exception 'Prepared tie game not found or not owned by current host'; end if;
  eligible := result.settings->'eligible_team_ids';
  if jsonb_array_length(eligible) <> 2 then raise exception 'Tie game needs exactly two teams'; end if;
  select jsonb_object_agg(value, 1) into initial_positions from jsonb_array_elements_text(eligible) value;
  delete from public.game_show_game_presses where game_show_game_id = result.id;
  update public.game_show_games set status = 'open', started_at = clock_timestamp(), exploded_at = null,
    winner_team_id = null, reward_points_awarded = 0,
    explode_at = case game_type when 'spin-the-wheel' then clock_timestamp() + interval '5 seconds'
      when 'beat-the-bomb' then clock_timestamp() + make_interval(secs => 10 + floor(random() * 21)::integer)
      when 'heads-or-tails' then clock_timestamp() + interval '5 seconds'
      when 'dodge-the-rock' then clock_timestamp() + interval '5 seconds' else null end,
    settings = settings || case when game_type in ('heads-or-tails', 'dodge-the-rock') then jsonb_build_object(
      'alive_team_ids', eligible, 'eliminated_team_ids', '[]'::jsonb, 'round_eliminated_team_ids', '[]'::jsonb,
      'round_number', 1, 'round_phase', 'choosing', 'round_outcome', null, 'positions', initial_positions
    ) else '{}'::jsonb end
  where id = result.id returning * into result;
  return result;
end;
$$;

create or replace function public.complete_tie_show_game(p_game_show_game_id uuid)
returns public.game_tie_resolutions
language plpgsql security definer set search_path = public
as $$
declare show_game public.game_show_games%rowtype; resolution public.game_tie_resolutions%rowtype;
  other_team uuid; ordered_ids uuid[];
begin
  select game_show_games.* into show_game from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = p_game_show_game_id and game_show_games.status = 'exploded'
    and game_show_games.settings ? 'tie_resolution_id' and quizzes.owner_id = auth.uid();
  if show_game.id is null or show_game.winner_team_id is null then raise exception 'Tie game has no confirmed winner'; end if;
  select * into resolution from public.game_tie_resolutions
  where id = (show_game.settings->>'tie_resolution_id')::uuid and status = 'pending' for update;
  if resolution.id is null or cardinality(resolution.team_ids) <> 2 then raise exception 'Pending two-team tie not found'; end if;
  if jsonb_typeof(show_game.settings->'winner_team_ids') = 'array' and jsonb_array_length(show_game.settings->'winner_team_ids') > 1 then
    update public.games set current_screen = 'tiebreaker-pending', current_show_game_key = null where id = show_game.game_id;
    return resolution;
  end if;
  select tied_team.id into other_team from unnest(resolution.team_ids) as tied_team(id) where tied_team.id <> show_game.winner_team_id limit 1;
  ordered_ids := array[show_game.winner_team_id, other_team];
  update public.game_tie_resolutions set status = 'resolved', resolution_method = 'show_game',
    ordered_team_ids = ordered_ids, resolved_at = clock_timestamp()
  where id = resolution.id returning * into resolution;
  update public.games set current_screen = 'tiebreaker-pending', current_show_game_key = null where id = show_game.game_id;
  return resolution;
end;
$$;

revoke all on function public.prepare_tie_show_game(uuid, text, text, numeric), public.start_tie_show_game(uuid), public.complete_tie_show_game(uuid) from public;
grant execute on function public.prepare_tie_show_game(uuid, text, text, numeric), public.start_tie_show_game(uuid), public.complete_tie_show_game(uuid) to authenticated;

-- Preserve show-game ordering as a real placement decision during finalization.
create or replace function public.finalize_game_with_prizes(p_game_id uuid)
returns integer language plpgsql security invoker set search_path = ''
as $$
declare
  game_settings jsonb; team_count integer; tie_score integer; tie_team_ids uuid[]; score_group record;
  ordered_ids uuid[]; resolution_method text; team_id_value uuid; team_index integer; rank_cursor integer := 1;
  team_top_place integer; team_bottom_place integer; top_setting jsonb; bottom_setting jsonb;
  team_awards jsonb; awarded_team_count integer; top_labels text[] := array['1st', '2nd', '3rd'];
  bottom_labels text[] := array['Last', '2nd Last', '3rd Last'];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select games.settings into game_settings from public.games join public.quizzes on quizzes.id = games.quiz_id
  where games.id = p_game_id and quizzes.owner_id = auth.uid() for update of games;
  if not found then raise exception 'Game not found or not owned by current host'; end if;
  select count(*) into team_count from public.teams where game_id = p_game_id;
  with groups as (
    select teams.score, array_agg(teams.id order by teams.name, teams.id) ids, count(*)::integer group_size,
      (select count(*)::integer from public.teams higher where higher.game_id=p_game_id and higher.score>teams.score)+1 top_start,
      (select count(*)::integer from public.teams lower where lower.game_id=p_game_id and lower.score<teams.score)+1 bottom_start
    from public.teams teams where teams.game_id=p_game_id group by teams.score
  ) select groups.score, groups.ids into tie_score, tie_team_ids from groups where groups.group_size>1
    and not exists (select 1 from public.game_tie_resolutions r where r.game_id=p_game_id and r.tied_score=groups.score and r.status='resolved')
    and (groups.top_start=1 or exists (select 1 from generate_series(1,3) place where game_settings->'top_prizes'->(place-1)->>'enabled'='true' and place between groups.top_start and groups.top_start+groups.group_size-1)
      or exists (select 1 from generate_series(1,3) place where game_settings->'bottom_prizes'->(place-1)->>'enabled'='true' and place between groups.bottom_start and groups.bottom_start+groups.group_size-1))
    order by groups.score desc limit 1;
  if tie_team_ids is not null then
    insert into public.game_tie_resolutions(game_id,tied_score,team_ids) values(p_game_id,tie_score,tie_team_ids) on conflict(game_id,tied_score) do nothing;
    update public.games set status='live',current_screen='tiebreaker-pending',answer_phase='closed',current_tiebreaker_attempt_id=null where id=p_game_id;
    return -1;
  end if;
  update public.teams set prize_awards='[]'::jsonb,final_placement=null,final_bottom_placement=null,final_sort_order=null where game_id=p_game_id;
  for score_group in select teams.score,array_agg(teams.id order by teams.name,teams.id) ids,count(*)::integer group_size from public.teams teams where teams.game_id=p_game_id group by teams.score order by teams.score desc loop
    resolution_method:=null; ordered_ids:=null;
    select r.resolution_method,r.ordered_team_ids into resolution_method,ordered_ids from public.game_tie_resolutions r where r.game_id=p_game_id and r.tied_score=score_group.score and r.status='resolved';
    if coalesce(resolution_method,'') not in ('tiebreaker','manual','show_game') or ordered_ids is null then ordered_ids:=score_group.ids; end if;
    for team_index in 1..cardinality(ordered_ids) loop
      team_id_value:=ordered_ids[team_index];
      if resolution_method in ('tiebreaker','manual','show_game') then team_top_place:=rank_cursor+team_index-1; team_bottom_place:=team_count-rank_cursor-team_index+2;
      else team_top_place:=rank_cursor; team_bottom_place:=team_count-rank_cursor-score_group.group_size+2; end if;
      update public.teams set final_placement=team_top_place,final_bottom_placement=team_bottom_place,final_sort_order=rank_cursor+team_index-1 where id=team_id_value;
    end loop;
    rank_cursor:=rank_cursor+score_group.group_size;
  end loop;
  for score_group in select id,final_placement,final_bottom_placement from public.teams where game_id=p_game_id order by final_sort_order loop
    team_awards:='[]'::jsonb;
    if score_group.final_placement between 1 and 3 then top_setting:=game_settings->'top_prizes'->(score_group.final_placement-1);
      if top_setting->>'enabled'='true' and btrim(coalesce(top_setting->>'msg',''))<>'' then team_awards:=team_awards||jsonb_build_array(jsonb_build_object('placement',top_labels[score_group.final_placement],'message',btrim(top_setting->>'msg'))); end if; end if;
    if score_group.final_bottom_placement between 1 and 3 then bottom_setting:=game_settings->'bottom_prizes'->(score_group.final_bottom_placement-1);
      if bottom_setting->>'enabled'='true' and btrim(coalesce(bottom_setting->>'msg',''))<>'' then team_awards:=team_awards||jsonb_build_array(jsonb_build_object('placement',bottom_labels[score_group.final_bottom_placement],'message',btrim(bottom_setting->>'msg'))); end if; end if;
    update public.teams set prize_awards=team_awards where id=score_group.id;
  end loop;
  update public.games set status='finished',current_screen='final-result',answer_phase='revealed',current_content_screen_key=null,current_tiebreaker_attempt_id=null where id=p_game_id;
  select count(*) into awarded_team_count from public.teams where game_id=p_game_id and jsonb_array_length(prize_awards)>0;
  return awarded_team_count;
end;
$$;

comment on function public.prepare_tie_show_game(uuid, text, text, numeric) is 'Creates a score-neutral show game for a consequential two-team final-placement tie.';

commit;
