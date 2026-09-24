-- Run against the target schema with `supabase db query --linked --file ...`.
-- Everything (including synthetic users, permissions, questions and audit rows)
-- is rolled back. No real user's role or library question is changed.
begin;
do $$
declare
  super_id uuid := gen_random_uuid();
  editor_id uuid := gen_random_uuid();
  host_id uuid := gen_random_uuid();
  question_id uuid;
  multipart_id uuid;
  first_part uuid;
  second_part uuid;
  revision_number integer;
  denied boolean;
  result_role text;
  base jsonb := '{"question_type":"single-answer","prompt":"Admin rollback test","correct_answer":"Mercury","accepted_answers":["Planet Mercury"],"status":"draft","editorial_difficulty":3,"audience_fit":"kids","adult_content":false}'::jsonb;
begin
  assert not has_function_privilege('anon', 'public.admin_set_user_role(uuid,text,text)', 'execute'), 'Anonymous role API access';
  assert not has_function_privilege('anon', 'public.admin_list_users(text,integer)', 'execute'), 'Anonymous user directory access';
  assert not has_function_privilege('authenticated', 'public.admin_save_library_question_content(uuid,jsonb,uuid,uuid[],uuid[],jsonb)', 'execute'), 'Private save helper exposed';
  insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
  values(super_id, super_id||'@admin-test.invalid', '{}', '{}'),
    (editor_id, editor_id||'@admin-test.invalid', '{}', '{}'),
    (host_id, host_id||'@admin-test.invalid', '{}', '{}');
  insert into public.platform_admins(user_id, role) values(super_id,'super_admin'),(editor_id,'admin');
  perform set_config('request.jwt.claim.sub', super_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',super_id,'role','authenticated')::text, true);
  assert public.is_platform_super_admin(), 'Super-admin not recognized';
  assert (select count(*) from public.admin_list_users(host_id::text)) = 1, 'User search failed';
  perform public.admin_set_user_role(host_id, 'admin', 'host');
  select role into result_role from public.platform_admins where user_id=host_id;
  assert result_role = 'admin', 'Role grant failed';
  denied := false;
  begin perform public.admin_set_user_role(host_id,'super_admin','host'); exception when raise_exception then denied := true; end;
  assert denied, 'Stale access update accepted';
  perform public.admin_set_user_role(host_id,'host','admin');
  assert not (select active from public.platform_admins where user_id=host_id), 'Revocation failed';
  denied := false;
  begin perform public.admin_set_user_role(super_id,'host','super_admin'); exception when raise_exception then denied := true; end;
  assert denied, 'Self-demotion accepted';

  perform set_config('request.jwt.claim.sub', host_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',host_id,'role','authenticated','app_metadata',jsonb_build_object('role','admin'))::text, true);
  assert not public.is_platform_admin(), 'Revoked JWT still grants admin access';
  denied := false;
  begin perform public.admin_save_library_question(null,base); exception when insufficient_privilege then denied := true; end;
  assert denied, 'Host can create library question';
  denied := false;
  begin perform public.admin_list_users(); exception when insufficient_privilege then denied := true; end;
  assert denied, 'Host can read users';

  perform set_config('request.jwt.claim.sub', editor_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',editor_id,'role','authenticated')::text, true);
  denied := false;
  begin perform public.admin_set_user_role(host_id,'super_admin','host'); exception when insufficient_privilege then denied := true; end;
  assert denied, 'Ordinary admin can grant roles';
  denied := false;
  begin perform public.admin_list_users(); exception when insufficient_privilege then denied := true; end;
  assert denied, 'Ordinary admin can read user emails';
  question_id := public.admin_save_library_question(null,base);
  assert (select origin='platform' and owner_id is null and status='draft' and not is_verified and audience_fit='kids' from public.source_questions where id=question_id), 'Incorrect new library defaults';
  select revision into revision_number from public.source_questions where id=question_id;
  perform public.admin_save_library_question(question_id,base||'{"status":"active"}',p_expected_revision=>revision_number,p_verified=>true);
  assert (select is_verified and status='active' from public.source_questions where id=question_id), 'Publication failed';
  denied := false;
  begin perform public.admin_save_library_question(question_id,base,p_expected_revision=>revision_number); exception when raise_exception then denied := true; end;
  assert denied, 'Stale question update accepted';

  multipart_id := public.admin_save_library_question(null,base||'{"question_type":"multi-part","correct_answer":["One","Two"],"accepted_answers":[[],[]],"options":[{"label":"A","clue":"First clue"},{"label":"B","clue":"Second clue"}],"part_ids":[null,null]}');
  select id into first_part from public.source_question_parts where source_question_id=multipart_id and position=1;
  select id into second_part from public.source_question_parts where source_question_id=multipart_id and position=2;
  update public.source_question_parts set editorial_difficulty=5, adult_content=true where id=second_part;
  select revision into revision_number from public.source_questions where id=multipart_id;
  perform public.admin_save_library_question(multipart_id,base||jsonb_build_object('question_type','multi-part','correct_answer',jsonb_build_array('Two'),'accepted_answers','[[]]'::jsonb,'options','[{"label":"A","clue":"Second clue edited"}]'::jsonb,'part_ids',jsonb_build_array(second_part)),p_expected_revision=>revision_number);
  assert not exists(select 1 from public.source_question_parts where id=first_part), 'Removed part remains';
  assert (select position=1 and editorial_difficulty=5 and adult_content and prompt='Second clue edited' from public.source_question_parts where id=second_part), 'Part identity or metadata lost';

  perform public.admin_save_library_question(null,base||'{"question_type":"multiple-choice","correct_answer":"B","options":[{"key":"A","label":"No"},{"key":"B","label":"Yes"}]}');
  perform public.admin_save_library_question(null,base||'{"question_type":"multi-answer","correct_answer":["A","B"],"accepted_answers":[[],[]]}');
  perform public.admin_save_library_question(null,base||'{"question_type":"ranking","correct_answer":["A","B"],"options":["A","B"]}');
  assert (select count(*) from public.platform_admin_audit_log where admin_id=editor_id and action like 'library_question_%') >= 7, 'Library audit rows missing';

  -- Exercise actual authenticated RLS, not just SECURITY DEFINER checks.
  execute 'set local role authenticated';
  assert (select count(*) from public.source_questions where id=multipart_id)=1, 'Admin cannot read drafts';
  perform set_config('request.jwt.claim.sub', host_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',host_id,'role','authenticated','app_metadata',jsonb_build_object('role','admin'))::text, true);
  assert not public.can_edit_source_question(multipart_id), 'Revoked token can edit child metadata';
  assert (select count(*) from public.source_questions where id=multipart_id)=0, 'Revoked token can read private drafts';
  execute 'reset role';
end; $$;
select 'Admin permission, authoring, revision and metadata checks passed (rolled back)' as result;
rollback;
