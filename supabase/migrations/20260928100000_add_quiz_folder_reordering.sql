begin;

create function public.reorder_quiz_folders(p_folder_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
declare
  host_id uuid := auth.uid();
  folder_count integer;
begin
  if host_id is null then raise exception 'Authentication required'; end if;
  -- Lock in a stable order so simultaneous reorders cannot leave a partial order.
  perform id from public.quiz_folders where owner_id=host_id order by id for update;
  select count(*) into folder_count from public.quiz_folders where owner_id=host_id;
  if p_folder_ids is null
     or cardinality(p_folder_ids) <> folder_count
     or (select count(distinct id) from unnest(p_folder_ids) as ids(id)) <> folder_count
     or exists(select 1 from unnest(p_folder_ids) as ids(id)
       where not exists(select 1 from public.quiz_folders f where f.id=ids.id and f.owner_id=host_id)) then
    raise exception 'Folder list changed. Refresh and try again.';
  end if;
  update public.quiz_folders f
  set sort_position=ordered.position::integer-1, updated_at=now()
  from unnest(p_folder_ids) with ordinality as ordered(id,position)
  where f.id=ordered.id and f.owner_id=host_id;
end;
$$;

revoke all on function public.reorder_quiz_folders(uuid[]) from public,anon;
grant execute on function public.reorder_quiz_folders(uuid[]) to authenticated;

commit;
