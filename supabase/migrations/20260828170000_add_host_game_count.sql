begin;

create or replace function public.get_host_game_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::bigint
  from public.games
  join public.quizzes on quizzes.id = games.quiz_id
  where quizzes.owner_id = (select auth.uid());
$$;

revoke all on function public.get_host_game_count() from public, anon;
grant execute on function public.get_host_game_count() to authenticated;

comment on function public.get_host_game_count() is
  'Returns the number of games created from quizzes owned by the current host only.';

commit;
