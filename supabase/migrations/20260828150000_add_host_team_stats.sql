begin;

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
      greatest(submissions.points_awarded, 0)::bigint as correct_points,
      greatest(game_questions.points_max, 0)::bigint as possible_points
    from finished_host_teams host_teams
    join public.submissions on submissions.team_id = host_teams.team_id
    join public.game_questions
      on game_questions.game_id = submissions.game_id
      and game_questions.question_key = submissions.question_key

    union all

    select
      host_teams.team_profile_id,
      greatest(bonus_submissions.points_awarded, 0)::bigint,
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

revoke all on function public.get_host_team_stats() from public, anon;
grant execute on function public.get_host_team_stats() to authenticated;

comment on function public.get_host_team_stats() is
  'Returns PIN-linked team history only for completed games owned by the current host. Raw PIN digests are never exposed.';

commit;
