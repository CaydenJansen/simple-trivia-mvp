begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

create or replace function public.guard_cancelled_show_activity()
returns trigger language plpgsql security definer set search_path='' as $$
declare session_id uuid; session_status text;
begin
  session_id:=(to_jsonb(new)->>'game_id')::uuid;
  if session_id is null then
    select game_id into session_id from public.game_show_games
    where id=(to_jsonb(new)->>'game_show_game_id')::uuid;
  end if;
  -- Coordinate with a concurrent cancellation; the entire action rolls back,
  -- including any score increments that preceded this row write.
  select status into session_status from public.games where id=session_id for share;
  if session_status='cancelled' then raise exception 'GAME_CANCELLED'; end if;
  return new;
end;
$$;
revoke all on function public.guard_cancelled_show_activity() from public,anon,authenticated;
create trigger guard_cancelled_show_activity before insert or update on public.game_show_games
for each row execute function public.guard_cancelled_show_activity();
create trigger guard_cancelled_show_activity before insert or update on public.game_show_game_presses
for each row execute function public.guard_cancelled_show_activity();
create trigger guard_cancelled_show_activity before insert or update on public.game_show_game_bids
for each row execute function public.guard_cancelled_show_activity();
create trigger guard_cancelled_show_activity before insert or update on public.game_show_game_deals
for each row execute function public.guard_cancelled_show_activity();
create trigger guard_cancelled_show_activity before insert or update on public.game_show_game_choices
for each row execute function public.guard_cancelled_show_activity();
create trigger guard_cancelled_show_activity before insert or update on public.game_show_game_responses
for each row execute function public.guard_cancelled_show_activity();
create trigger guard_cancelled_show_activity before insert or update on public.game_show_game_response_votes
for each row execute function public.guard_cancelled_show_activity();
create trigger guard_cancelled_show_activity before insert or update on public.game_show_game_balloons
for each row execute function public.guard_cancelled_show_activity();
create trigger guard_cancelled_show_activity before insert or update on public.game_show_game_treasure
for each row execute function public.guard_cancelled_show_activity();

create or replace function public.distinct_rock_final_lanes()
returns trigger language plpgsql set search_path='' as $$
declare ids jsonb; first_id text; second_id text; first_lane integer; second_lane integer;
begin
  ids:=new.settings->'alive_team_ids';
  if new.game_type='dodge-the-rock' and new.status='open'
    and new.settings->>'round_phase'='choosing' and jsonb_array_length(ids)=2 then
    first_id:=ids->>0; second_id:=ids->>1;
    first_lane:=coalesce((new.settings->'positions'->>first_id)::integer,1);
    second_lane:=coalesce((new.settings->'positions'->>second_id)::integer,1);
    if first_lane=second_lane then
      second_lane:=(first_lane+1+floor(random()*2)::integer)%3;
    end if;
    new.settings:=jsonb_set(new.settings,'{positions}',coalesce(new.settings->'positions','{}'::jsonb)||jsonb_build_object(first_id,first_lane,second_id,second_lane));
  end if;
  return new;
end;
$$;
revoke all on function public.distinct_rock_final_lanes() from public,anon,authenticated;
create trigger distinct_rock_final_lanes before insert or update on public.game_show_games
for each row execute function public.distinct_rock_final_lanes();

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
    select coalesce(result.settings->'positions'->>value,'1') into other_choice
    from jsonb_array_elements_text(result.settings->'alive_team_ids')
    where value<>request_row.team_id::text limit 1;
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

create or replace function public.collaborative_game_team(
  p_game_show_game_id uuid, p_request_id uuid, p_request_token uuid, p_game_type text
) returns uuid language plpgsql security definer set search_path=public as $$
declare request_row public.team_join_requests%rowtype; show_game public.game_show_games%rowtype;
begin
  select * into request_row from public.team_join_requests
  where id=p_request_id and request_token=p_request_token and status='approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;
  select * into show_game from public.game_show_games
  where id=p_game_show_game_id and game_id=request_row.game_id and game_type=p_game_type;
  if show_game.id is null or not (show_game.settings->'eligible_team_ids' ? request_row.team_id::text) then raise exception 'TEAM_NOT_ELIGIBLE'; end if;
  perform 1 from public.games where id=request_row.game_id and status='cancelled';
  if found then raise exception 'GAME_CANCELLED'; end if;
  return request_row.team_id;
end; $$;

commit;
