create or replace function public.cancel_host_game(
  p_game_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cancelled_game_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.games
  set
    status = 'cancelled',
    current_screen = 'game-ended',
    answer_phase = 'closed',
    current_content_screen_key = null
  where games.code = p_game_code
    and games.status in ('lobby', 'live')
    and exists (
      select 1
      from public.quizzes
      where quizzes.id = games.quiz_id
        and quizzes.owner_id = auth.uid()
    )
  returning games.id into cancelled_game_id;

  if cancelled_game_id is null then
    raise exception 'Active game not found or not owned by current host';
  end if;

  return cancelled_game_id;
end;
$$;

revoke all on function public.cancel_host_game(text) from public;
grant execute on function public.cancel_host_game(text) to authenticated;

comment on function public.cancel_host_game(text) is
  'Ends an owned lobby or live game without deleting its teams, submissions, scores, or snapshots.';
