begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

create or replace function public.duplicate_owned_quiz(p_quiz_id uuid,p_title text)
returns public.quizzes language plpgsql security invoker set search_path='' as $$
declare snapshot jsonb; copied_id uuid; folder uuid; result public.quizzes%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(btrim(p_title),'') is null then raise exception 'Quiz title is required'; end if;
  -- All layers are read within ONE statement/MVCC snapshot, even while another
  -- browser is atomically saving the original quiz.
  select to_jsonb(q)||jsonb_build_object(
    'questions',(select coalesce(jsonb_agg(to_jsonb(x) order by position),'[]') from public.quiz_questions x where quiz_id=q.id),
    'screens',(select coalesce(jsonb_agg(to_jsonb(x) order by item_position),'[]') from public.quiz_content_screens x where quiz_id=q.id),
    'tiebreakers',(select coalesce(jsonb_agg(to_jsonb(x) order by position),'[]') from public.quiz_tiebreakers x where quiz_id=q.id),
    'show_games',(select coalesce(jsonb_agg(to_jsonb(x) order by item_position),'[]') from public.quiz_show_games x where quiz_id=q.id)
  ) into snapshot from public.quizzes q where q.id=p_quiz_id and q.owner_id=auth.uid();
  if snapshot is null then raise exception 'Quiz not found'; end if;
  copied_id:=public.save_quiz_with_show_games(null,p_title,snapshot->>'status',
    (snapshot->>'estimated_minutes')::integer,snapshot->'questions',snapshot->'screens',snapshot->'tiebreakers',snapshot->'show_games');
  folder:=(snapshot->>'folder_id')::uuid;
  if folder is not null then
    perform 1 from public.quiz_folders where id=folder and owner_id=auth.uid() for key share;
    if found then update public.quizzes set folder_id=folder where id=copied_id; end if;
  end if;
  select * into result from public.quizzes where id=copied_id;
  return result;
end;
$$;
revoke all on function public.duplicate_owned_quiz(uuid,text) from public,anon;
grant execute on function public.duplicate_owned_quiz(uuid,text) to authenticated;
commit;
