begin;

create or replace function public.start_deal_or_no_deal(p_game_show_game_id uuid)
returns public.game_show_games language plpgsql security definer set search_path=public as $$
declare result public.game_show_games%rowtype; eligible jsonb;
begin
  select jsonb_agg(id order by created_at) into eligible from public.teams where game_id=(select sg.game_id from public.game_show_games sg join public.games g on g.id=sg.game_id join public.quizzes q on q.id=g.quiz_id where sg.id=p_game_show_game_id and sg.game_type='deal-or-no-deal' and sg.status='ready' and q.owner_id=auth.uid()) and last_seen_at>clock_timestamp()-interval '5 minutes';
  if eligible is null or jsonb_array_length(eligible)<2 then raise exception 'Deal or No Deal needs at least two active teams'; end if;
  -- Keep one bank value unused so every requested swap can stay unique.
  if jsonb_array_length(eligible)>92 then raise exception 'Deal or No Deal has too many active teams'; end if;
  delete from public.game_show_game_deals where game_show_game_id=p_game_show_game_id;
  insert into public.game_show_game_deals(game_show_game_id,game_id,team_id,assigned_value)
  select p_game_show_game_id,sg.game_id,t.team_id,v.value from public.game_show_games sg
  cross join lateral (select (value #>> '{}')::uuid team_id,row_number() over() rn from jsonb_array_elements(eligible) value) t
  join (select value,row_number() over(order by random()) rn from generate_series(1,93) value) v using(rn) where sg.id=p_game_show_game_id;
  update public.game_show_games set status='open',started_at=clock_timestamp(),explode_at=clock_timestamp()+interval '22 seconds',exploded_at=null,winner_team_id=null,reward_points_awarded=0,
    settings=settings||jsonb_build_object('eligible_team_ids',eligible,'deal_round',1)
  where id=p_game_show_game_id returning * into result;
  return result;
end; $$;

revoke all on function public.start_deal_or_no_deal(uuid) from public;
grant execute on function public.start_deal_or_no_deal(uuid) to authenticated;

commit;
