-- Start a lobby as one host-authorised transaction.  This avoids leaving a
-- game half-reset when one of the client-side setup requests fails.
create or replace function public.start_live_game(p_game_id uuid, p_answer_editing_allowed boolean default false)
returns public.games
language plpgsql
security definer
set search_path = public
as $$
declare
  live_game public.games%rowtype;
  first_item record;
begin
  select games.* into live_game
  from public.games
  join public.quizzes on quizzes.id = games.quiz_id
  where games.id = p_game_id
    and games.status = 'lobby'
    and quizzes.owner_id = auth.uid()
  for update of games;

  if live_game.id is null then
    raise exception 'Lobby not found or not owned by current host';
  end if;

  select kind, item_key
  into first_item
  from (
    select 'question'::text as kind, question_key as item_key, item_position
    from public.game_questions where game_id = live_game.id
    union all
    select 'content'::text as kind, screen_key as item_key, item_position
    from public.game_content_screens where game_id = live_game.id
    union all
    select 'show-game'::text as kind, show_game_key as item_key, item_position
    from public.game_show_games where game_id = live_game.id
  ) sequence
  order by item_position
  limit 1;

  if first_item.item_key is null then
    raise exception 'This show has no playable content';
  end if;

  delete from public.submissions where game_id = live_game.id;
  delete from public.bonus_submissions where game_id = live_game.id;
  delete from public.game_show_game_presses where game_id = live_game.id;
  update public.teams set score = 0 where game_id = live_game.id;

  -- A lobby can be retried after a failed start; restore its prepared games.
  update public.game_show_games
  set status = 'ready', started_at = null, explode_at = null, exploded_at = null,
      winner_team_id = null, reward_points_awarded = 0
  where game_id = live_game.id;

  update public.games
  set status = 'live',
      current_screen = case first_item.kind
        when 'question' then 'round-start'
        when 'content' then 'content-screen'
        else 'show-game'
      end,
      answer_phase = case when first_item.kind = 'question' then 'open' else 'closed' end,
      answer_editing_allowed = first_item.kind = 'question' and p_answer_editing_allowed,
      question_stage = 'core',
      current_question_key = case when first_item.kind = 'question' then first_item.item_key else null end,
      current_content_screen_key = case when first_item.kind = 'content' then first_item.item_key else null end,
      current_show_game_key = case when first_item.kind = 'show-game' then first_item.item_key else null end,
      current_tiebreaker_attempt_id = null,
      round_scores_finalized = false
  where id = live_game.id
  returning * into live_game;

  return live_game;
end;
$$;

revoke all on function public.start_live_game(uuid, boolean) from public;
grant execute on function public.start_live_game(uuid, boolean) to authenticated;

comment on function public.start_live_game(uuid, boolean) is
  'Atomically validates and starts a host-owned lobby from its earliest frozen question, content, or show-game item.';
