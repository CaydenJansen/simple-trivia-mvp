begin;

create table if not exists public.game_show_game_response_votes (
  response_id uuid not null references public.game_show_game_responses(id) on delete cascade,
  game_show_game_id uuid not null references public.game_show_games(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  voter_team_id uuid not null references public.teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (response_id, voter_team_id)
);

create index if not exists game_show_game_response_votes_game_idx
  on public.game_show_game_response_votes (game_show_game_id, created_at);

alter table public.game_show_game_response_votes enable row level security;

drop policy if exists "Hosts can view audience response votes" on public.game_show_game_response_votes;
create policy "Hosts can view audience response votes"
on public.game_show_game_response_votes for select to authenticated
using (exists (
  select 1
  from public.game_show_games
  join public.games on games.id = game_show_games.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where game_show_games.id = game_show_game_response_votes.game_show_game_id
    and quizzes.owner_id = auth.uid()
));

grant select on public.game_show_game_response_votes to authenticated;
revoke all on public.game_show_game_response_votes from anon;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'game_show_game_response_votes'
  ) then
    alter publication supabase_realtime add table public.game_show_game_response_votes;
  end if;
end;
$$;

drop function if exists public.get_audience_question_responses(uuid, uuid, uuid);

create function public.get_audience_question_responses(
  p_game_show_game_id uuid,
  p_request_id uuid,
  p_request_token uuid
)
returns table (
  response_id uuid,
  team_id uuid,
  team_name text,
  response_text text,
  numeric_response numeric,
  submitted_at timestamptz,
  vote_count bigint,
  viewer_has_voted boolean
)
language plpgsql stable security definer set search_path = public
as $$
declare
  request_row public.team_join_requests%rowtype;
  show_game public.game_show_games%rowtype;
begin
  select * into request_row from public.team_join_requests
  where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;

  select * into show_game from public.game_show_games
  where id = p_game_show_game_id
    and game_id = request_row.game_id
    and game_type = 'audience-question';
  if show_game.id is null then raise exception 'SHOW_GAME_INVALID'; end if;
  if show_game.settings->>'audience_question_mode' = 'closest-number' then
    raise exception 'NUMERIC_RESPONSES_ARE_HOST_ONLY';
  end if;
  if coalesce((show_game.settings->>'audience_responses_visible')::boolean, false) is not true then
    raise exception 'RESPONSES_NOT_SHARED';
  end if;
  if show_game.status not in ('open', 'exploded') then raise exception 'RESPONSES_NOT_AVAILABLE'; end if;
  if not exists (
    select 1 from public.game_show_game_responses own_response
    where own_response.game_show_game_id = show_game.id
      and own_response.team_id = request_row.team_id
  ) then raise exception 'SUBMIT_BEFORE_VIEWING'; end if;

  return query
  select
    responses.id,
    responses.team_id,
    teams.name,
    responses.response_text,
    responses.numeric_response,
    responses.submitted_at,
    count(votes.voter_team_id),
    coalesce(bool_or(votes.voter_team_id = request_row.team_id), false)
  from public.game_show_game_responses responses
  join public.teams on teams.id = responses.team_id
  left join public.game_show_game_response_votes votes on votes.response_id = responses.id
  where responses.game_show_game_id = show_game.id
  group by responses.id, responses.team_id, teams.name, responses.response_text, responses.numeric_response, responses.submitted_at
  order by responses.submitted_at;
end;
$$;

create or replace function public.toggle_audience_question_response_vote(
  p_game_show_game_id uuid,
  p_response_id uuid,
  p_request_id uuid,
  p_request_token uuid
)
returns table (response_id uuid, liked boolean, vote_count bigint)
language plpgsql security definer set search_path = public
as $$
declare
  request_row public.team_join_requests%rowtype;
  show_game public.game_show_games%rowtype;
  target_response public.game_show_game_responses%rowtype;
  now_liked boolean;
begin
  select * into request_row from public.team_join_requests
  where id = p_request_id and request_token = p_request_token and status = 'approved';
  if not found or request_row.team_id is null then raise exception 'JOIN_REQUEST_INVALID'; end if;

  select * into show_game from public.game_show_games
  where id = p_game_show_game_id
    and game_id = request_row.game_id
    and game_type = 'audience-question'
  for update;
  if show_game.id is null then raise exception 'SHOW_GAME_INVALID'; end if;
  if show_game.status <> 'open' then raise exception 'VOTING_CLOSED'; end if;
  if show_game.settings->>'audience_question_mode' = 'closest-number'
    or coalesce((show_game.settings->>'audience_responses_visible')::boolean, false) is not true
  then raise exception 'VOTING_NOT_AVAILABLE'; end if;
  if not exists (
    select 1 from public.game_show_game_responses own_response
    where own_response.game_show_game_id = show_game.id
      and own_response.team_id = request_row.team_id
  ) then raise exception 'SUBMIT_BEFORE_VOTING'; end if;

  select * into target_response from public.game_show_game_responses
  where id = p_response_id and game_show_game_id = show_game.id;
  if target_response.id is null then raise exception 'RESPONSE_NOT_FOUND'; end if;
  if target_response.team_id = request_row.team_id then raise exception 'CANNOT_VOTE_FOR_OWN_RESPONSE'; end if;

  delete from public.game_show_game_response_votes
  where game_show_game_response_votes.response_id = target_response.id
    and game_show_game_response_votes.voter_team_id = request_row.team_id;

  if found then
    now_liked := false;
  else
    insert into public.game_show_game_response_votes (
      response_id, game_show_game_id, game_id, voter_team_id
    ) values (
      target_response.id, show_game.id, show_game.game_id, request_row.team_id
    );
    now_liked := true;
  end if;

  return query select
    target_response.id,
    now_liked,
    (select count(*) from public.game_show_game_response_votes where game_show_game_response_votes.response_id = target_response.id);
end;
$$;

revoke all on function public.get_audience_question_responses(uuid, uuid, uuid) from public;
revoke all on function public.toggle_audience_question_response_vote(uuid, uuid, uuid, uuid) from public;
grant execute on function public.get_audience_question_responses(uuid, uuid, uuid) to anon, authenticated;
grant execute on function public.toggle_audience_question_response_vote(uuid, uuid, uuid, uuid) to anon, authenticated;

comment on table public.game_show_game_response_votes is
  'Optional team likes on shared open-ended Audience Question responses. Votes guide the host and never resolve a winner automatically.';
comment on function public.get_audience_question_responses(uuid, uuid, uuid) is
  'Returns shared open-ended responses and vote totals after the admitted viewer submits, only when sharing is enabled.';
comment on function public.toggle_audience_question_response_vote(uuid, uuid, uuid, uuid) is
  'Securely toggles one admitted team vote on another team response while an open-ended Audience Question is open.';

commit;
