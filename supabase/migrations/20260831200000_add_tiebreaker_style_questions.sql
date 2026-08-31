begin;

alter table public.quiz_show_games drop constraint if exists quiz_show_games_game_type_check;
alter table public.quiz_show_games add constraint quiz_show_games_game_type_check
  check (game_type in ('beat-the-bomb','spin-the-wheel','heads-or-tails','dodge-the-rock','scissors-paper-rock','big-balloon','steal-the-treasure','audience-question','tiebreaker-style-question','in-show-tiebreaker'));

alter table public.game_show_games drop constraint if exists game_show_games_game_type_check;
alter table public.game_show_games add constraint game_show_games_game_type_check
  check (game_type in ('beat-the-bomb','spin-the-wheel','heads-or-tails','dodge-the-rock','scissors-paper-rock','big-balloon','steal-the-treasure','audience-question','tiebreaker-style-question','in-show-tiebreaker'));

create table public.quiz_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  source_quiz_id uuid not null references public.quizzes(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(owner_id,name)
);
alter table public.quiz_templates enable row level security;
create policy "Hosts manage own quiz templates" on public.quiz_templates for all to authenticated
  using (owner_id=auth.uid()) with check (owner_id=auth.uid());
grant select,insert,update,delete on public.quiz_templates to authenticated;

-- The existing snapshot RPC deliberately moves numerical answers into a private
-- table for its known numeric activities. Extend that protection to the new type
-- without duplicating the large snapshot function.
create or replace function public.privatize_tiebreaker_style_answer()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.game_type='tiebreaker-style-question' then
    insert into public.game_show_game_audience_private(game_show_game_id,correct_number)
    values(new.id,nullif(new.settings->>'correct_number','')::numeric)
    on conflict (game_show_game_id) do update set correct_number=excluded.correct_number;
    update public.game_show_games set settings=settings-'correct_number' where id=new.id;
  end if;
  return new;
end; $$;

drop trigger if exists privatize_tiebreaker_style_answer on public.game_show_games;
create trigger privatize_tiebreaker_style_answer after insert on public.game_show_games
for each row when (new.game_type='tiebreaker-style-question') execute function public.privatize_tiebreaker_style_answer();

create or replace function public.start_audience_question(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; eligible jsonb;
begin
  select jsonb_agg(teams.id order by teams.created_at) into eligible from public.game_show_games
  join public.games on games.id=game_show_games.game_id join public.quizzes on quizzes.id=games.quiz_id
  join public.teams on teams.game_id=games.id and teams.last_seen_at>clock_timestamp()-interval '5 minutes'
  where game_show_games.id=p_game_show_game_id and game_show_games.game_type in ('audience-question','tiebreaker-style-question','in-show-tiebreaker')
    and game_show_games.status='ready' and quizzes.owner_id=auth.uid();
  if eligible is null or jsonb_array_length(eligible)=0 then raise exception 'This activity needs at least one active team'; end if;
  update public.game_show_games set status='open',started_at=clock_timestamp(),explode_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible,'winner_team_ids','[]'::jsonb)
  where id=p_game_show_game_id returning * into result;
  if result.id is null then raise exception 'Activity not found, already started, or not owned by current host'; end if;
  return result;
end; $$;

create or replace function public.submit_audience_question_response(p_game_show_game_id uuid,p_request_id uuid,p_request_token uuid,p_response text)
returns public.game_show_game_responses language plpgsql security definer set search_path=public as $$
declare request_row public.team_join_requests%rowtype; show_game public.game_show_games%rowtype; result public.game_show_game_responses%rowtype; parsed_number numeric; correct_value numeric;
begin
  select * into request_row from public.team_join_requests where id=p_request_id and request_token=p_request_token and status='approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;
  select * into show_game from public.game_show_games where id=p_game_show_game_id and game_id=request_row.game_id for update;
  if show_game.id is null or show_game.game_type not in ('audience-question','tiebreaker-style-question','in-show-tiebreaker') or show_game.status<>'open' then raise exception 'RESPONSES_CLOSED'; end if;
  if not (show_game.settings->'eligible_team_ids'?request_row.team_id::text) then raise exception 'TEAM_NOT_ELIGIBLE'; end if;
  if length(btrim(p_response)) not between 1 and 1000 then raise exception 'RESPONSE_INVALID'; end if;
  if show_game.game_type in ('tiebreaker-style-question','in-show-tiebreaker') then
    begin parsed_number:=replace(btrim(p_response),',','')::numeric; exception when invalid_text_representation then raise exception 'NUMBER_REQUIRED'; end;
    select correct_number into correct_value from public.game_show_game_audience_private where game_show_game_id=show_game.id;
    if correct_value is null then raise exception 'A correct number is required'; end if;
  end if;
  insert into public.game_show_game_responses(game_show_game_id,game_id,team_id,response_text,numeric_response,distance_from_correct)
  values(show_game.id,show_game.game_id,request_row.team_id,btrim(p_response),parsed_number,case when parsed_number is null then null else abs(parsed_number-correct_value) end)
  returning * into result;
  return result;
end; $$;

create or replace function public.resolve_audience_question(p_game_show_game_id uuid,p_winner_team_ids uuid[] default null)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; winners uuid[]; response_count integer; reward_points integer; correct_value numeric; minimum_distance numeric; allows_many boolean;
begin
  select game_show_games.* into result from public.game_show_games join public.games on games.id=game_show_games.game_id join public.quizzes on quizzes.id=games.quiz_id
  where game_show_games.id=p_game_show_game_id and game_show_games.game_type in ('audience-question','tiebreaker-style-question','in-show-tiebreaker') and quizzes.owner_id=auth.uid() for update of game_show_games;
  if result.id is null then raise exception 'Activity not found or not owned by current host'; end if;
  if result.status<>'open' then return result; end if;
  select count(*) into response_count from public.game_show_game_responses where game_show_game_id=result.id;
  if response_count=0 then raise exception 'Wait for at least one team response'; end if;
  if result.game_type in ('tiebreaker-style-question','in-show-tiebreaker') then
    select correct_number into correct_value from public.game_show_game_audience_private where game_show_game_id=result.id;
    if correct_value is null then raise exception 'A correct number is required'; end if;
    update public.game_show_game_responses set distance_from_correct=abs(numeric_response-correct_value) where game_show_game_id=result.id;
    select min(distance_from_correct) into minimum_distance from public.game_show_game_responses where game_show_game_id=result.id;
    select array_agg(team_id order by submitted_at) into winners from public.game_show_game_responses where game_show_game_id=result.id and distance_from_correct=minimum_distance;
  else
    select array_agg(team_id order by first_position) into winners from (select selected.team_id,min(selected.position) first_position from unnest(coalesce(p_winner_team_ids,'{}'::uuid[])) with ordinality selected(team_id,position) group by selected.team_id) deduplicated;
    winners:=coalesce(winners,'{}'::uuid[]);
    if cardinality(winners)=0 then raise exception 'Choose at least one favourite response'; end if;
    allows_many:=coalesce((result.settings->>'allow_multiple_winners')::boolean,false);
    if cardinality(winners)>1 and not allows_many then raise exception 'This game allows one winner'; end if;
  end if;
  update public.game_show_game_responses set is_winner=team_id=any(winners) where game_show_game_id=result.id;
  reward_points:=case when result.game_type='in-show-tiebreaker' then 0 else public.beat_the_bomb_reward_points(result.settings) end;
  if reward_points>0 then update public.teams set score=score+reward_points where id=any(winners); end if;
  update public.game_show_games set status='exploded',exploded_at=clock_timestamp(),explode_at=clock_timestamp(),winner_team_id=winners[1],reward_points_awarded=reward_points,
    settings=settings||jsonb_build_object('winner_team_ids',to_jsonb(winners),'correct_number',correct_value) where id=result.id returning * into result;
  return result;
end; $$;

revoke all on function public.start_audience_question(uuid),public.submit_audience_question_response(uuid,uuid,uuid,text),public.resolve_audience_question(uuid,uuid[]) from public;
grant execute on function public.start_audience_question(uuid),public.resolve_audience_question(uuid,uuid[]) to authenticated;
grant execute on function public.submit_audience_question_response(uuid,uuid,uuid,text) to anon,authenticated;

commit;
