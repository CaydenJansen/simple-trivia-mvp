alter table public.teams
  add column if not exists prize_awards jsonb not null default '[]'::jsonb
  check (jsonb_typeof(prize_awards) = 'array');

create or replace function public.finalize_game_with_prizes(p_game_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  game_settings jsonb;
  team_count integer;
  ranked_team record;
  top_setting jsonb;
  bottom_setting jsonb;
  team_awards jsonb;
  awarded_team_count integer;
  top_labels text[] := array['1st', '2nd', '3rd'];
  bottom_labels text[] := array['Last', '2nd Last', '3rd Last'];
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select games.settings
    into game_settings
  from public.games
  join public.quizzes on quizzes.id = games.quiz_id
  where games.id = p_game_id
    and quizzes.owner_id = auth.uid()
  for update of games;

  if game_settings is null then
    raise exception 'Game not found or not owned by current host';
  end if;

  select count(*) into team_count
  from public.teams
  where teams.game_id = p_game_id;

  update public.teams
  set prize_awards = '[]'::jsonb
  where teams.game_id = p_game_id;

  for ranked_team in
    select
      teams.id,
      row_number() over (order by teams.score desc, teams.name asc, teams.id asc)::integer as place
    from public.teams
    where teams.game_id = p_game_id
  loop
    team_awards := '[]'::jsonb;

    if ranked_team.place <= 3 then
      top_setting := game_settings->'top_prizes'->(ranked_team.place - 1);
      if top_setting->>'enabled' = 'true' and btrim(coalesce(top_setting->>'msg', '')) <> '' then
        team_awards := team_awards || jsonb_build_array(jsonb_build_object(
          'placement', top_labels[ranked_team.place],
          'message', btrim(top_setting->>'msg')
        ));
      end if;
    end if;

    if team_count - ranked_team.place < 3 then
      bottom_setting := game_settings->'bottom_prizes'->(team_count - ranked_team.place);
      if bottom_setting->>'enabled' = 'true' and btrim(coalesce(bottom_setting->>'msg', '')) <> '' then
        team_awards := team_awards || jsonb_build_array(jsonb_build_object(
          'placement', bottom_labels[team_count - ranked_team.place + 1],
          'message', btrim(bottom_setting->>'msg')
        ));
      end if;
    end if;

    update public.teams
    set prize_awards = team_awards
    where teams.id = ranked_team.id;
  end loop;

  update public.games
  set status = 'finished',
      current_screen = 'final-result',
      answer_phase = 'revealed',
      current_content_screen_key = null
  where games.id = p_game_id;

  select count(*) into awarded_team_count
  from public.teams
  where teams.game_id = p_game_id
    and jsonb_array_length(teams.prize_awards) > 0;

  return awarded_team_count;
end;
$$;

revoke all on function public.finalize_game_with_prizes(uuid) from public;
grant execute on function public.finalize_game_with_prizes(uuid) to authenticated;

comment on function public.finalize_game_with_prizes(uuid) is
  'Idempotently assigns configured placement prizes and publishes final results for one owned game.';
