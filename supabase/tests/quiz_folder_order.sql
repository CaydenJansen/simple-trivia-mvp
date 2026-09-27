begin;
set local statement_timeout='15s';
do $$
declare
  owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid();
  folder_a uuid; folder_b uuid; other_folder uuid; rejected boolean; bad_order uuid[];
begin
  insert into auth.users(id,email) values(owner_a,owner_a||'@folder-test.invalid'),(owner_b,owner_b||'@folder-test.invalid');
  insert into public.quiz_folders(owner_id,name,sort_position) values(owner_a,'A',0) returning id into folder_a;
  insert into public.quiz_folders(owner_id,name,sort_position) values(owner_a,'B',1) returning id into folder_b;
  insert into public.quiz_folders(owner_id,name,sort_position) values(owner_b,'Other',7) returning id into other_folder;
  perform set_config('request.jwt.claim.sub',owner_a::text,true);
  perform public.reorder_quiz_folders(array[folder_b,folder_a]);
  assert (select sort_position=0 from public.quiz_folders where id=folder_b), 'First folder was not saved';
  assert (select sort_position=1 from public.quiz_folders where id=folder_a), 'Second folder was not saved';
  assert (select sort_position=7 from public.quiz_folders where id=other_folder), 'Another owner was changed';
  foreach bad_order slice 1 in array array[array[folder_a,folder_a],array[folder_a,other_folder],array[folder_a,null::uuid]] loop
    rejected:=false;
    begin perform public.reorder_quiz_folders(bad_order); exception when raise_exception then rejected:=true; end;
    assert rejected, 'Invalid folder list was accepted';
  end loop;
  rejected:=false;
  begin perform public.reorder_quiz_folders(array[folder_a]); exception when raise_exception then rejected:=true; end;
  assert rejected, 'Incomplete folder list was accepted';
  assert (select sort_position=0 from public.quiz_folders where id=folder_b), 'Failed request partially reordered folders';
  assert not has_function_privilege('anon','public.reorder_quiz_folders(uuid[])','execute'), 'Anonymous reorder exposed';
  assert has_function_privilege('authenticated','public.reorder_quiz_folders(uuid[])','execute'), 'Host cannot reorder';
end $$;
rollback;
select 'Folder order checks passed (rolled back)' as result;
