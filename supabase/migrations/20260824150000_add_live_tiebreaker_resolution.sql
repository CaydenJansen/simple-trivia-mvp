alter table public.teams
  add column if not exists final_placement integer,
  add column if not exists final_bottom_placement integer,
  add column if not exists final_sort_order integer;

create table if not exists public.game_tie_resolutions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  tied_score integer not null,
  team_ids uuid[] not null check (cardinality(team_ids) > 1),
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  resolution_method text check (resolution_method in ('tiebreaker', 'allowed_tie', 'manual')),
  ordered_team_ids uuid[],
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (game_id, tied_score),
  check (
    (status = 'pending' and resolution_method is null and ordered_team_ids is null and resolved_at is null)
    or
    (status = 'resolved' and resolution_method is not null and resolved_at is not null)
  )
);

create table if not exists public.game_tiebreaker_attempts (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  resolution_id uuid not null references public.game_tie_resolutions(id) on delete cascade,
  game_tiebreaker_id uuid not null references public.game_tiebreakers(id) on delete restrict,
  team_ids uuid[] not null check (cardinality(team_ids) > 1),
  status text not null default 'open' check (status in ('open', 'closed', 'resolved', 'tied')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  revealed_at timestamptz,
  unique (game_tiebreaker_id)
);

create table if not exists public.game_tiebreaker_submissions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  attempt_id uuid not null references public.game_tiebreaker_attempts(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  numeric_answer numeric not null,
  distance numeric check (distance is null or distance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, team_id)
);

alter table public.games
  add column if not exists current_tiebreaker_attempt_id uuid
  references public.game_tiebreaker_attempts(id) on delete set null;

create index if not exists game_tie_resolutions_game_status_idx
  on public.game_tie_resolutions (game_id, status);
create index if not exists game_tiebreaker_attempts_game_idx
  on public.game_tiebreaker_attempts (game_id, created_at);
create index if not exists game_tiebreaker_submissions_attempt_idx
  on public.game_tiebreaker_submissions (attempt_id);

alter table public.game_tie_resolutions enable row level security;
alter table public.game_tiebreaker_attempts enable row level security;
alter table public.game_tiebreaker_submissions enable row level security;

revoke all on table public.game_tie_resolutions, public.game_tiebreaker_attempts, public.game_tiebreaker_submissions from anon;
grant select, insert, update, delete on table public.game_tie_resolutions, public.game_tiebreaker_attempts, public.game_tiebreaker_submissions to authenticated;

drop policy if exists "Hosts manage owned game tie resolutions" on public.game_tie_resolutions;
create policy "Hosts manage owned game tie resolutions"
on public.game_tie_resolutions for all to authenticated
using (
  exists (
    select 1 from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = game_tie_resolutions.game_id and quizzes.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = game_tie_resolutions.game_id and quizzes.owner_id = (select auth.uid())
  )
);

drop policy if exists "Hosts manage owned game tiebreaker attempts" on public.game_tiebreaker_attempts;
create policy "Hosts manage owned game tiebreaker attempts"
on public.game_tiebreaker_attempts for all to authenticated
using (
  exists (
    select 1 from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = game_tiebreaker_attempts.game_id and quizzes.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = game_tiebreaker_attempts.game_id and quizzes.owner_id = (select auth.uid())
  )
);

drop policy if exists "Hosts manage owned game tiebreaker submissions" on public.game_tiebreaker_submissions;
create policy "Hosts manage owned game tiebreaker submissions"
on public.game_tiebreaker_submissions for all to authenticated
using (
  exists (
    select 1 from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = game_tiebreaker_submissions.game_id and quizzes.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = game_tiebreaker_submissions.game_id and quizzes.owner_id = (select auth.uid())
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_tiebreaker_submissions'
  ) then
    alter publication supabase_realtime add table public.game_tiebreaker_submissions;
  end if;
end;
$$;

create or replace function public.start_game_tiebreaker(p_resolution_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_resolution public.game_tie_resolutions%rowtype;
  selected_tiebreaker_id uuid;
  created_attempt_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select resolutions.* into selected_resolution
  from public.game_tie_resolutions resolutions
  join public.games on games.id = resolutions.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where resolutions.id = p_resolution_id
    and resolutions.status = 'pending'
    and quizzes.owner_id = auth.uid()
  for update of resolutions;

  if selected_resolution.id is null then raise exception 'Pending tie was not found'; end if;

  select tiebreakers.id into selected_tiebreaker_id
  from public.game_tiebreakers tiebreakers
  where tiebreakers.game_id = selected_resolution.game_id
    and not exists (
      select 1 from public.game_tiebreaker_attempts attempts
      where attempts.game_tiebreaker_id = tiebreakers.id
    )
  order by tiebreakers.position
  limit 1;

  if selected_tiebreaker_id is null then raise exception 'No unused prepared tiebreakers remain'; end if;

  insert into public.game_tiebreaker_attempts (game_id, resolution_id, game_tiebreaker_id, team_ids)
  values (selected_resolution.game_id, selected_resolution.id, selected_tiebreaker_id, selected_resolution.team_ids)
  returning id into created_attempt_id;

  update public.games
  set status = 'live', current_screen = 'tiebreaker', answer_phase = 'open',
      current_tiebreaker_attempt_id = created_attempt_id
  where id = selected_resolution.game_id;

  return created_attempt_id;
end;
$$;

create or replace function public.close_game_tiebreaker(p_attempt_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare owned_game_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select attempts.game_id into owned_game_id
  from public.game_tiebreaker_attempts attempts
  join public.games on games.id = attempts.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where attempts.id = p_attempt_id and attempts.status = 'open' and quizzes.owner_id = auth.uid()
  for update of attempts;
  if owned_game_id is null then raise exception 'Open tiebreaker was not found'; end if;

  update public.game_tiebreaker_attempts set status = 'closed', closed_at = now() where id = p_attempt_id;
  update public.games set answer_phase = 'closed' where id = owned_game_id;
end;
$$;

create or replace function public.reveal_game_tiebreaker(p_attempt_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_attempt public.game_tiebreaker_attempts%rowtype;
  correct_number numeric;
  ordered_ids uuid[];
  has_equal_distance boolean;
  submission_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select attempts.* into selected_attempt
  from public.game_tiebreaker_attempts attempts
  join public.games on games.id = attempts.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where attempts.id = p_attempt_id and attempts.status = 'closed' and quizzes.owner_id = auth.uid()
  for update of attempts;
  if selected_attempt.id is null then raise exception 'Closed tiebreaker was not found'; end if;

  select count(*) into submission_count
  from public.game_tiebreaker_submissions where attempt_id = p_attempt_id;
  if submission_count <> cardinality(selected_attempt.team_ids) then
    raise exception 'Every tied team must submit before reveal';
  end if;

  select correct_value into correct_number
  from public.game_tiebreakers where id = selected_attempt.game_tiebreaker_id;

  update public.game_tiebreaker_submissions
  set distance = abs(numeric_answer - correct_number), updated_at = now()
  where attempt_id = p_attempt_id;

  select exists (
    select 1 from public.game_tiebreaker_submissions
    where attempt_id = p_attempt_id
    group by distance having count(*) > 1
  ) into has_equal_distance;

  if has_equal_distance then
    update public.game_tiebreaker_attempts set status = 'tied', revealed_at = now() where id = p_attempt_id;
  else
    select array_agg(team_id order by distance, team_id) into ordered_ids
    from public.game_tiebreaker_submissions where attempt_id = p_attempt_id;

    update public.game_tiebreaker_attempts set status = 'resolved', revealed_at = now() where id = p_attempt_id;
    update public.game_tie_resolutions
    set status = 'resolved', resolution_method = 'tiebreaker', ordered_team_ids = ordered_ids, resolved_at = now()
    where id = selected_attempt.resolution_id;
  end if;

  update public.games set current_screen = 'tiebreaker-result', answer_phase = 'revealed'
  where id = selected_attempt.game_id;
  return not has_equal_distance;
end;
$$;

create or replace function public.allow_game_tie(p_resolution_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.game_tie_resolutions resolutions
  set status = 'resolved', resolution_method = 'allowed_tie', ordered_team_ids = null, resolved_at = now()
  where resolutions.id = p_resolution_id
    and resolutions.status = 'pending'
    and exists (
      select 1 from public.games join public.quizzes on quizzes.id = games.quiz_id
      where games.id = resolutions.game_id and quizzes.owner_id = auth.uid()
    );
  if not found then raise exception 'Pending tie was not found'; end if;
end;
$$;

create or replace function public.manually_resolve_game_tie(p_resolution_id uuid, p_ordered_team_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare expected_ids uuid[];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select resolutions.team_ids into expected_ids
  from public.game_tie_resolutions resolutions
  join public.games on games.id = resolutions.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where resolutions.id = p_resolution_id and resolutions.status = 'pending' and quizzes.owner_id = auth.uid()
  for update of resolutions;
  if expected_ids is null then raise exception 'Pending tie was not found'; end if;
  if cardinality(p_ordered_team_ids) <> cardinality(expected_ids)
    or not (p_ordered_team_ids @> expected_ids and expected_ids @> p_ordered_team_ids) then
    raise exception 'Manual order must contain every tied team exactly once';
  end if;

  update public.game_tie_resolutions
  set status = 'resolved', resolution_method = 'manual', ordered_team_ids = p_ordered_team_ids, resolved_at = now()
  where id = p_resolution_id;
end;
$$;

create or replace function public.submit_player_tiebreaker(
  p_game_id uuid,
  p_team_id uuid,
  p_numeric_answer numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare selected_attempt public.game_tiebreaker_attempts%rowtype; submission_id uuid;
begin
  select attempts.* into selected_attempt
  from public.games
  join public.game_tiebreaker_attempts attempts on attempts.id = games.current_tiebreaker_attempt_id
  where games.id = p_game_id and games.current_screen = 'tiebreaker'
    and games.answer_phase = 'open' and attempts.status = 'open'
  for update of attempts;
  if selected_attempt.id is null then raise exception 'Tiebreaker answers are not open'; end if;
  if not (p_team_id = any(selected_attempt.team_ids))
    or not exists (select 1 from public.teams where id = p_team_id and game_id = p_game_id) then
    raise exception 'Team is not participating in this tiebreaker';
  end if;

  insert into public.game_tiebreaker_submissions (game_id, attempt_id, team_id, numeric_answer)
  values (p_game_id, selected_attempt.id, p_team_id, p_numeric_answer)
  on conflict (attempt_id, team_id) do update
    set numeric_answer = excluded.numeric_answer, distance = null, updated_at = now()
  returning id into submission_id;
  return submission_id;
end;
$$;

create or replace function public.get_player_tiebreaker_state(p_game_id uuid, p_team_id uuid)
returns table (
  attempt_id uuid,
  prompt text,
  answer_unit text,
  attempt_status text,
  is_participant boolean,
  numeric_answer numeric,
  distance numeric,
  correct_value numeric,
  submitted_count integer,
  participant_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    attempts.id,
    case when p_team_id = any(attempts.team_ids) then tiebreakers.prompt else null end,
    case when p_team_id = any(attempts.team_ids) then tiebreakers.answer_unit else null end,
    attempts.status,
    p_team_id = any(attempts.team_ids),
    submissions.numeric_answer,
    submissions.distance,
    case when attempts.status in ('resolved', 'tied') then tiebreakers.correct_value else null end,
    (select count(*)::integer from public.game_tiebreaker_submissions all_submissions where all_submissions.attempt_id = attempts.id),
    cardinality(attempts.team_ids)
  from public.games
  join public.game_tiebreaker_attempts attempts on attempts.id = games.current_tiebreaker_attempt_id
  join public.game_tiebreakers tiebreakers on tiebreakers.id = attempts.game_tiebreaker_id
  join public.teams team on team.id = p_team_id and team.game_id = games.id
  left join public.game_tiebreaker_submissions submissions
    on submissions.attempt_id = attempts.id and submissions.team_id = p_team_id
  where games.id = p_game_id;
$$;

create or replace function public.finalize_game_with_prizes(p_game_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  game_settings jsonb;
  team_count integer;
  tie_score integer;
  tie_team_ids uuid[];
  score_group record;
  ordered_ids uuid[];
  resolution_method text;
  team_id_value uuid;
  team_index integer;
  rank_cursor integer := 1;
  team_top_place integer;
  team_bottom_place integer;
  top_setting jsonb;
  bottom_setting jsonb;
  team_awards jsonb;
  awarded_team_count integer;
  top_labels text[] := array['1st', '2nd', '3rd'];
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
    select
      teams.score,
      array_agg(teams.id order by teams.name, teams.id) as ids,
      count(*)::integer as group_size,
      (select count(*)::integer from public.teams higher where higher.game_id = p_game_id and higher.score > teams.score) + 1 as top_start,
      (select count(*)::integer from public.teams lower where lower.game_id = p_game_id and lower.score < teams.score) + 1 as bottom_start
    from public.teams teams
    where teams.game_id = p_game_id
    group by teams.score
  )
  select groups.score, groups.ids into tie_score, tie_team_ids
  from groups
  where groups.group_size > 1
    and not exists (
      select 1 from public.game_tie_resolutions resolutions
      where resolutions.game_id = p_game_id and resolutions.tied_score = groups.score and resolutions.status = 'resolved'
    )
    and (
      groups.top_start = 1
      or exists (
        select 1 from generate_series(1, 3) place
        where game_settings->'top_prizes'->(place - 1)->>'enabled' = 'true'
          and place between groups.top_start and groups.top_start + groups.group_size - 1
      )
      or exists (
        select 1 from generate_series(1, 3) place
        where game_settings->'bottom_prizes'->(place - 1)->>'enabled' = 'true'
          and place between groups.bottom_start and groups.bottom_start + groups.group_size - 1
      )
    )
  order by groups.score desc
  limit 1;

  if tie_team_ids is not null then
    insert into public.game_tie_resolutions (game_id, tied_score, team_ids)
    values (p_game_id, tie_score, tie_team_ids)
    on conflict (game_id, tied_score) do nothing;
    update public.games
    set status = 'live', current_screen = 'tiebreaker-pending', answer_phase = 'closed', current_tiebreaker_attempt_id = null
    where id = p_game_id;
    return -1;
  end if;

  update public.teams set prize_awards = '[]'::jsonb,
    final_placement = null, final_bottom_placement = null, final_sort_order = null
  where game_id = p_game_id;

  for score_group in
    select teams.score, array_agg(teams.id order by teams.name, teams.id) as ids, count(*)::integer as group_size
    from public.teams teams where teams.game_id = p_game_id group by teams.score order by teams.score desc
  loop
    resolution_method := null;
    ordered_ids := null;
    select resolutions.resolution_method, resolutions.ordered_team_ids
      into resolution_method, ordered_ids
    from public.game_tie_resolutions resolutions
    where resolutions.game_id = p_game_id and resolutions.tied_score = score_group.score and resolutions.status = 'resolved';

    if coalesce(resolution_method, '') not in ('tiebreaker', 'manual') or ordered_ids is null then ordered_ids := score_group.ids; end if;

    for team_index in 1..cardinality(ordered_ids) loop
      team_id_value := ordered_ids[team_index];
      if resolution_method in ('tiebreaker', 'manual') then
        team_top_place := rank_cursor + team_index - 1;
        team_bottom_place := team_count - rank_cursor - team_index + 2;
      else
        team_top_place := rank_cursor;
        team_bottom_place := team_count - rank_cursor - score_group.group_size + 2;
      end if;
      update public.teams set final_placement = team_top_place,
        final_bottom_placement = team_bottom_place, final_sort_order = rank_cursor + team_index - 1
      where id = team_id_value;
    end loop;
    rank_cursor := rank_cursor + score_group.group_size;
  end loop;

  for score_group in
    select id, final_placement, final_bottom_placement from public.teams
    where game_id = p_game_id order by final_sort_order
  loop
    team_awards := '[]'::jsonb;
    if score_group.final_placement between 1 and 3 then
      top_setting := game_settings->'top_prizes'->(score_group.final_placement - 1);
      if top_setting->>'enabled' = 'true' and btrim(coalesce(top_setting->>'msg', '')) <> '' then
        team_awards := team_awards || jsonb_build_array(jsonb_build_object('placement', top_labels[score_group.final_placement], 'message', btrim(top_setting->>'msg')));
      end if;
    end if;
    if score_group.final_bottom_placement between 1 and 3 then
      bottom_setting := game_settings->'bottom_prizes'->(score_group.final_bottom_placement - 1);
      if bottom_setting->>'enabled' = 'true' and btrim(coalesce(bottom_setting->>'msg', '')) <> '' then
        team_awards := team_awards || jsonb_build_array(jsonb_build_object('placement', bottom_labels[score_group.final_bottom_placement], 'message', btrim(bottom_setting->>'msg')));
      end if;
    end if;
    update public.teams set prize_awards = team_awards where id = score_group.id;
  end loop;

  update public.games set status = 'finished', current_screen = 'final-result', answer_phase = 'revealed',
    current_content_screen_key = null, current_tiebreaker_attempt_id = null
  where id = p_game_id;

  select count(*) into awarded_team_count from public.teams
  where game_id = p_game_id and jsonb_array_length(prize_awards) > 0;
  return awarded_team_count;
end;
$$;

revoke all on function public.start_game_tiebreaker(uuid) from public;
revoke all on function public.close_game_tiebreaker(uuid) from public;
revoke all on function public.reveal_game_tiebreaker(uuid) from public;
revoke all on function public.allow_game_tie(uuid) from public;
revoke all on function public.manually_resolve_game_tie(uuid, uuid[]) from public;
revoke all on function public.submit_player_tiebreaker(uuid, uuid, numeric) from public;
revoke all on function public.get_player_tiebreaker_state(uuid, uuid) from public;

grant execute on function public.start_game_tiebreaker(uuid) to authenticated;
grant execute on function public.close_game_tiebreaker(uuid) to authenticated;
grant execute on function public.reveal_game_tiebreaker(uuid) to authenticated;
grant execute on function public.allow_game_tie(uuid) to authenticated;
grant execute on function public.manually_resolve_game_tie(uuid, uuid[]) to authenticated;
grant execute on function public.submit_player_tiebreaker(uuid, uuid, numeric) to anon, authenticated;
grant execute on function public.get_player_tiebreaker_state(uuid, uuid) to anon, authenticated;

comment on table public.game_tie_resolutions is 'Consequential final-placement decisions stored separately from trivia scores.';
comment on table public.game_tiebreaker_attempts is 'Uses frozen prepared tiebreakers at most once per game.';
comment on table public.game_tiebreaker_submissions is 'Numeric tied-team responses and reveal-time absolute distances.';
