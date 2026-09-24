begin;

-- Capture only already-trusted legacy roles. Membership becomes authoritative,
-- so revocations do not wait for an old JWT to expire.
insert into public.platform_admins (user_id, role, granted_reason)
select id, raw_app_meta_data->>'role', 'Existing trusted admin role'
from auth.users where raw_app_meta_data->>'role' in ('admin', 'super_admin')
on conflict (user_id) do nothing;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.platform_admins where user_id = auth.uid() and active); $$;

create or replace function public.is_platform_super_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.platform_admins where user_id = auth.uid() and active and role = 'super_admin'); $$;
revoke all on function public.is_platform_super_admin() from public, anon;
grant execute on function public.is_platform_super_admin() to authenticated;

create or replace function public.admin_list_users(p_search text default '', p_offset integer default 0)
returns table(user_id uuid, email text, display_name text, role text, created_at timestamptz,
  quiz_count bigint, total_count bigint, is_self boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_platform_super_admin() then raise exception 'Super-admin access required' using errcode = '42501'; end if;
  if length(coalesce(p_search, '')) > 200 then raise exception 'Search is too long'; end if;
  return query
  select u.id, coalesce(u.email, '')::text, coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
    case when a.active then a.role else 'host' end, u.created_at,
    (select count(*) from public.quizzes q where q.owner_id = u.id),
    count(*) over(), u.id = auth.uid()
  from auth.users u left join public.platform_admins a on a.user_id = u.id
  where coalesce(u.is_anonymous, false) = false and
    (coalesce(btrim(p_search), '') = '' or
     position(lower(btrim(p_search)) in lower(coalesce(u.email, '') || ' ' ||
       coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', ''))) > 0)
  order by u.created_at desc, u.id
  limit 25 offset greatest(0, coalesce(p_offset, 0));
end; $$;
revoke all on function public.admin_list_users(text, integer) from public, anon;
grant execute on function public.admin_list_users(text, integer) to authenticated;

create or replace function public.admin_set_user_role(p_user_id uuid, p_role text, p_expected_role text)
returns void language plpgsql security definer set search_path = ''
as $$
declare old_role text;
begin
  if not public.is_platform_super_admin() then raise exception 'Super-admin access required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_admin_role_changes', 0));
  perform 1 from public.platform_admins where user_id = auth.uid() and active and role = 'super_admin' for share;
  if not found then raise exception 'Super-admin access required' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('host', 'admin', 'super_admin') then raise exception 'Invalid role'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot change your own access. Ask another super-admin.'; end if;
  perform 1 from auth.users where id = p_user_id and not coalesce(is_anonymous, false) for update;
  if not found then raise exception 'User not found'; end if;
  select case when active then role else 'host' end into old_role from public.platform_admins where user_id = p_user_id for update;
  old_role := coalesce(old_role, 'host');
  if old_role = p_role then return; end if;
  if p_expected_role is distinct from old_role then raise exception 'Access changed since you opened this user. Close this dialog and refresh.'; end if;
  if old_role = 'super_admin' and p_role <> 'super_admin' and
    (select count(*) from public.platform_admins where active and role = 'super_admin') <= 1 then
    raise exception 'The last super-admin cannot be removed';
  end if;
  insert into public.platform_admins(user_id, role, active, granted_by, granted_reason)
  values(p_user_id, case when p_role = 'host' then 'admin' else p_role end, p_role <> 'host', auth.uid(), 'Admin console')
  on conflict(user_id) do update set role = excluded.role, active = excluded.active,
    granted_by = excluded.granted_by, granted_reason = excluded.granted_reason, updated_at = now();
  -- Remove obsolete token roles on next refresh; membership gates existing tokens.
  update auth.users set raw_app_meta_data = raw_app_meta_data - 'role'
  where id = p_user_id and raw_app_meta_data->>'role' in ('admin', 'super_admin');
  insert into public.platform_admin_audit_log(admin_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'user_role_changed', 'user', p_user_id, jsonb_build_object('before', old_role, 'after', p_role));
end; $$;
revoke all on function public.admin_set_user_role(uuid, text, text) from public, anon;
grant execute on function public.admin_set_user_role(uuid, text, text) to authenticated;

-- A revoked legacy JWT must not retain its old direct-table privileges.
-- Ordinary host JWTs and the separate pre-existing question_editor role are unaffected.
do $$
declare target record;
begin
  for target in select distinct schemaname, tablename from pg_policies
    where schemaname = 'public' and
    (coalesce(qual, '') || coalesce(with_check, '')) like '%app_metadata%' and
    (coalesce(qual, '') || coalesce(with_check, '')) like '%''admin''%'
  loop
    execute format('create policy "Revoked legacy admin guard" on %I.%I as restrictive for all to authenticated
      using (coalesce(auth.jwt()->''app_metadata''->>''role'', '''') not in (''admin'', ''super_admin'') or public.is_platform_admin())
      with check (coalesce(auth.jwt()->''app_metadata''->>''role'', '''') not in (''admin'', ''super_admin'') or public.is_platform_admin())',
      target.schemaname, target.tablename);
  end loop;
end; $$;

create policy "Admins read library editorial records" on public.source_questions for select to authenticated
using (origin = 'platform' and public.is_platform_admin());

create or replace function public.can_read_source_question(p_source_question_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
select exists(select 1 from public.source_questions where id = p_source_question_id and
  ((origin = 'user' and owner_id = auth.uid()) or
   (origin = 'platform' and (status = 'active' or public.is_platform_admin() or
     coalesce(auth.jwt()->'app_metadata'->>'role', '') = 'question_editor'))));
$$;

-- Existing child-table policies call this helper, including policies whose
-- expression does not mention JWT roles directly.
create or replace function public.can_edit_source_question(p_source_question_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
select exists(select 1 from public.source_questions where id = p_source_question_id and
  ((origin = 'user' and owner_id = auth.uid()) or
   (origin = 'platform' and (coalesce(auth.jwt()->'app_metadata'->>'role', '') = 'question_editor' or
     (coalesce(auth.jwt()->'app_metadata'->>'role', '') = 'admin' and public.is_platform_admin())))));
$$;

create function public.admin_save_library_question_content(
  p_question_id uuid,
  p_question jsonb,
  p_primary_category_id uuid default null,
  p_secondary_category_ids uuid[] default '{}'::uuid[],
  p_tag_ids uuid[] default '{}'::uuid[],
  p_bonus jsonb default '{"preserve_existing": true}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_question_id uuid;
  saved_bonus_id uuid;
  bonus_primary_category_id uuid;
  legacy_category text;
  legacy_difficulty text;
  legacy_tags text[];
  numeric_difficulty integer;
  bonus_difficulty integer;
  bonus_points integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(p_question) <> 'object' then
    raise exception 'Question must be a JSON object';
  end if;

  if length(btrim(coalesce(p_question->>'prompt', ''))) = 0 then
    raise exception 'Question text is required';
  end if;

  if p_question->>'question_type' not in (
    'single-answer', 'image-question', 'multiple-choice',
    'multi-answer', 'multi-part', 'ranking'
  ) then
    raise exception 'Invalid question type';
  end if;

  if p_question->'correct_answer' is null then
    raise exception 'Correct answer is required';
  end if;

  numeric_difficulty := nullif(p_question->>'editorial_difficulty', '')::integer;
  if numeric_difficulty is not null and numeric_difficulty not between 1 and 5 then
    raise exception 'Editorial difficulty must be between 1 and 5';
  end if;

  legacy_difficulty := case numeric_difficulty
    when 1 then 'Very Easy'
    when 2 then 'Easy'
    when 3 then 'Medium'
    when 4 then 'Hard'
    when 5 then 'Very Hard'
    else null
  end;

  select categories.name
    into legacy_category
  from public.categories
  where categories.id = p_primary_category_id
    and categories.is_active;

  select coalesce(array_agg(tags.name order by tags.name), '{}'::text[])
    into legacy_tags
  from public.tags
  where tags.id = any(coalesce(p_tag_ids, '{}'::uuid[]))
    and tags.is_active;

  if p_question_id is null then
    insert into public.source_questions (
      origin, owner_id, question_type, prompt, correct_answer, accepted_answers,
      options, category, difficulty, tags, image_url, notes, status,
      prompt_pattern_id, answer_type_id, editorial_difficulty, scoring_mode,
      stability, as_of_date, review_due_at, valid_from, expires_at, prompt_signature
    ) values (
      'platform', null, p_question->>'question_type', btrim(p_question->>'prompt'),
      p_question->'correct_answer', coalesce(p_question->'accepted_answers', '[]'::jsonb),
      nullif(p_question->'options', 'null'::jsonb), legacy_category, legacy_difficulty,
      legacy_tags, nullif(btrim(p_question->>'image_url'), ''),
      nullif(btrim(p_question->>'notes'), ''),
      coalesce(nullif(p_question->>'status', ''), 'active'),
      nullif(p_question->>'prompt_pattern_id', '')::uuid,
      nullif(p_question->>'answer_type_id', '')::uuid,
      numeric_difficulty,
      coalesce(nullif(p_question->>'scoring_mode', ''),
        case when p_question->>'question_type' in ('multi-answer', 'multi-part', 'ranking')
          then 'per-item' else 'fixed' end),
      coalesce(nullif(p_question->>'stability', ''), 'stable'),
      nullif(p_question->>'as_of_date', '')::date,
      nullif(p_question->>'review_due_at', '')::timestamptz,
      nullif(p_question->>'valid_from', '')::timestamptz,
      nullif(p_question->>'expires_at', '')::timestamptz,
      nullif(btrim(p_question->>'prompt_signature'), '')
    ) returning id into saved_question_id;
  else
    update public.source_questions
    set
      question_type = p_question->>'question_type',
      prompt = btrim(p_question->>'prompt'),
      correct_answer = p_question->'correct_answer',
      accepted_answers = coalesce(p_question->'accepted_answers', '[]'::jsonb),
      options = nullif(p_question->'options', 'null'::jsonb),
      category = legacy_category,
      difficulty = legacy_difficulty,
      tags = legacy_tags,
      image_url = nullif(btrim(p_question->>'image_url'), ''),
      notes = nullif(btrim(p_question->>'notes'), ''),
      status = coalesce(nullif(p_question->>'status', ''), status),
      prompt_pattern_id = nullif(p_question->>'prompt_pattern_id', '')::uuid,
      answer_type_id = nullif(p_question->>'answer_type_id', '')::uuid,
      editorial_difficulty = numeric_difficulty,
      scoring_mode = coalesce(nullif(p_question->>'scoring_mode', ''), scoring_mode),
      stability = coalesce(nullif(p_question->>'stability', ''), stability),
      as_of_date = nullif(p_question->>'as_of_date', '')::date,
      review_due_at = nullif(p_question->>'review_due_at', '')::timestamptz,
      valid_from = nullif(p_question->>'valid_from', '')::timestamptz,
      expires_at = nullif(p_question->>'expires_at', '')::timestamptz,
      prompt_signature = nullif(btrim(p_question->>'prompt_signature'), '')
    where id = p_question_id
      and origin = 'platform'
    returning id into saved_question_id;

    if saved_question_id is null then
      raise exception 'Library question not found';
    end if;
  end if;

  delete from public.source_question_categories where source_question_id = saved_question_id;

  if p_primary_category_id is not null then
    insert into public.source_question_categories (source_question_id, category_id, role)
    select saved_question_id, categories.id, 'primary'
    from public.categories
    where categories.id = p_primary_category_id and categories.is_active;
  end if;

  insert into public.source_question_categories (source_question_id, category_id, role)
  select saved_question_id, categories.id, 'secondary'
  from public.categories
  where categories.id = any(coalesce(p_secondary_category_ids, '{}'::uuid[]))
    and categories.id is distinct from p_primary_category_id
    and categories.is_active
  on conflict do nothing;

  delete from public.source_question_tags where source_question_id = saved_question_id;

  insert into public.source_question_tags (source_question_id, tag_id)
  select saved_question_id, tags.id
  from public.tags
  where tags.id = any(coalesce(p_tag_ids, '{}'::uuid[])) and tags.is_active
  on conflict do nothing;

  if p_bonus is null or jsonb_typeof(p_bonus) = 'null' then
    delete from public.source_question_bonuses where source_question_id = saved_question_id;
  elsif jsonb_typeof(p_bonus) = 'object' and coalesce((p_bonus->>'preserve_existing')::boolean, false) then
    null;
  else
    if jsonb_typeof(p_bonus) <> 'object' then
      raise exception 'Bonus must be a JSON object or null';
    end if;
    if length(btrim(coalesce(p_bonus->>'prompt', ''))) = 0 then
      raise exception 'Bonus question text is required';
    end if;
    if length(btrim(coalesce(p_bonus->>'correct_answer', ''))) = 0 then
      raise exception 'Bonus answer is required';
    end if;

    bonus_points := nullif(p_bonus->>'points', '')::integer;
    if bonus_points is null or bonus_points < 1 then
      raise exception 'Bonus points must be a positive whole number';
    end if;

    bonus_difficulty := nullif(p_bonus->>'editorial_difficulty', '')::integer;
    if bonus_difficulty is not null and bonus_difficulty not between 1 and 5 then
      raise exception 'Bonus editorial difficulty must be between 1 and 5';
    end if;

    insert into public.source_question_bonuses (
      source_question_id, prompt, correct_answer, accepted_answers, points,
      prompt_pattern_id, answer_type_id, editorial_difficulty, stability, image_url
    ) values (
      saved_question_id,
      btrim(p_bonus->>'prompt'),
      to_jsonb(btrim(p_bonus->>'correct_answer')),
      coalesce(p_bonus->'accepted_answers', '[]'::jsonb),
      bonus_points,
      nullif(p_bonus->>'prompt_pattern_id', '')::uuid,
      nullif(p_bonus->>'answer_type_id', '')::uuid,
      bonus_difficulty,
      coalesce(nullif(p_bonus->>'stability', ''), 'stable'),
      nullif(btrim(p_bonus->>'image_url'), '')
    )
    on conflict (source_question_id) do update set
      prompt = excluded.prompt,
      correct_answer = excluded.correct_answer,
      accepted_answers = excluded.accepted_answers,
      points = excluded.points,
      prompt_pattern_id = excluded.prompt_pattern_id,
      answer_type_id = excluded.answer_type_id,
      editorial_difficulty = excluded.editorial_difficulty,
      stability = excluded.stability,
      image_url = excluded.image_url,
      updated_at = now()
    returning id into saved_bonus_id;

    bonus_primary_category_id := nullif(p_bonus->>'primary_category_id', '')::uuid;

    delete from public.source_question_bonus_categories
    where source_question_bonus_id = saved_bonus_id;

    if bonus_primary_category_id is not null then
      insert into public.source_question_bonus_categories (source_question_bonus_id, category_id, role)
      select saved_bonus_id, categories.id, 'primary'
      from public.categories
      where categories.id = bonus_primary_category_id and categories.is_active;
    end if;

    insert into public.source_question_bonus_categories (source_question_bonus_id, category_id, role)
    select saved_bonus_id, categories.id, 'secondary'
    from public.categories
    where categories.id in (
      select value::uuid
      from jsonb_array_elements_text(coalesce(p_bonus->'secondary_category_ids', '[]'::jsonb))
    )
      and categories.id is distinct from bonus_primary_category_id
      and categories.is_active
    on conflict do nothing;

    delete from public.source_question_bonus_tags where source_question_bonus_id = saved_bonus_id;

    insert into public.source_question_bonus_tags (source_question_bonus_id, tag_id)
    select saved_bonus_id, tags.id
    from public.tags
    where tags.id in (
      select value::uuid
      from jsonb_array_elements_text(coalesce(p_bonus->'tag_ids', '[]'::jsonb))
    ) and tags.is_active
    on conflict do nothing;
  end if;

  return saved_question_id;
end;
$$;

-- Only the revision-checked public entry point may invoke this helper.
revoke all on function public.admin_save_library_question_content(uuid,jsonb,uuid,uuid[],uuid[],jsonb) from public, anon, authenticated, service_role;

create or replace function public.admin_save_library_question(
  p_question_id uuid,
  p_question jsonb,
  p_primary_category_id uuid default null,
  p_secondary_category_ids uuid[] default '{}',
  p_tag_ids uuid[] default '{}',
  p_bonus jsonb default '{"preserve_existing":true}',
  p_expected_revision integer default null,
  p_verified boolean default false
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  previous public.source_questions;
  saved_id uuid;
  payload jsonb;
  answer_count integer;
  idx integer;
  part_id uuid;
  part_ids uuid[] := '{}';
  saved_bonus_id uuid;
  prior_bonus_tags integer := 0;
begin
  if not public.is_platform_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  -- Keep role revocation and an already-running editorial save serializable.
  perform 1 from public.platform_admins where user_id = auth.uid() and active for share;
  if not found then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_question_id is not null then
    select * into previous from public.source_questions where id = p_question_id and origin = 'platform' for update;
    if not found then raise exception 'Library question not found'; end if;
    if p_expected_revision is distinct from previous.revision then
      raise exception 'This question changed since you opened it. Close the editor, refresh and try again.';
    end if;
  end if;
  if p_question is null or jsonb_typeof(p_question) <> 'object' then raise exception 'Question must be an object'; end if;
  -- Keep editorial metadata not exposed in the simple form (dates, signatures,
  -- imported audience flags, etc.). Never accept origin/owner/provenance changes.
  payload := coalesce(to_jsonb(previous), '{}'::jsonb) || p_question;
  if payload->>'question_type' is null or payload->>'question_type' not in
    ('single-answer','image-question','multiple-choice','multi-answer','multi-part','ranking') then raise exception 'Invalid question type'; end if;
  if jsonb_typeof(payload->'accepted_answers') is distinct from 'array' then raise exception 'Accepted answers must be an array'; end if;
  if payload->>'question_type' in ('multi-answer','multi-part','ranking') then
    if jsonb_typeof(payload->'correct_answer') is distinct from 'array' then raise exception 'Add answer rows'; end if;
    answer_count := jsonb_array_length(payload->'correct_answer');
    if answer_count < 1 or answer_count > 100 or
      (payload->>'question_type' = 'ranking' and answer_count < 2) then raise exception 'Invalid number of answer rows'; end if;
    if exists(select 1 from jsonb_array_elements(payload->'correct_answer') a where jsonb_typeof(a) <> 'string' or length(btrim(a #>> '{}')) = 0)
      then raise exception 'Every answer row needs an answer'; end if;
    if payload->>'question_type' = 'multi-part' then
      if jsonb_typeof(payload->'options') is distinct from 'array' or jsonb_array_length(payload->'options') <> answer_count then raise exception 'Each part needs a clue'; end if;
      if exists(select 1 from jsonb_array_elements(payload->'options') o where length(btrim(coalesce(o->>'clue',''))) = 0) then raise exception 'Each part needs a clue'; end if;
      if p_question_id is not null and exists(select 1 from public.source_question_parts where source_question_id = p_question_id)
        and not (p_question ? 'part_ids') then raise exception 'Reload the editor to preserve existing part metadata'; end if;
      for idx in 0..answer_count-1 loop
        part_id := nullif(p_question->'part_ids'->>idx, '')::uuid;
        if part_id is not null then
          if part_id = any(part_ids) or not exists(select 1 from public.source_question_parts where id = part_id and source_question_id = p_question_id) then
            raise exception 'Invalid part reference';
          end if;
          part_ids := array_append(part_ids, part_id);
        end if;
      end loop;
    end if;
  else
    if jsonb_typeof(payload->'correct_answer') not in ('string','number') or
       length(btrim(coalesce(payload->>'correct_answer',''))) = 0 then raise exception 'Correct answer is required'; end if;
    if payload->>'question_type' = 'multiple-choice' then
      if jsonb_typeof(payload->'options') is distinct from 'array' then raise exception 'Add choices'; end if;
      if jsonb_array_length(payload->'options') < 2 or not exists(
        select 1 from jsonb_array_elements(payload->'options') o
        where o->>'key' = payload->>'correct_answer' and length(btrim(coalesce(o->>'label',''))) > 0
      ) then raise exception 'Choose a valid correct option'; end if;
    end if;
  end if;

  select count(*) into prior_bonus_tags from public.source_question_bonus_tags bt
    join public.source_question_bonuses b on b.id=bt.source_question_bonus_id where b.source_question_id=p_question_id;
  saved_id := public.admin_save_library_question_content(
    p_question_id, payload, p_primary_category_id, p_secondary_category_ids, p_tag_ids, p_bonus
  );
  update public.source_questions set
    audience_fit = coalesce(nullif(payload->>'audience_fit',''),'broad'),
    adult_content = coalesce((payload->>'adult_content')::boolean, false),
    audience_suitability = coalesce(nullif(payload->>'audience_suitability',''),'general'),
    audience_scope = coalesce(nullif(payload->>'audience_scope',''),'global'),
    audience_locale = case when payload->>'audience_scope' = 'country_specific' then nullif(btrim(payload->>'audience_locale'),'') else null end,
    content_flags = array(select jsonb_array_elements_text(coalesce(payload->'content_flags','[]'::jsonb))),
    is_verified = coalesce(p_verified, false),
    verified_at = case when p_verified then now() else null end,
    verified_by = case when p_verified then auth.uid() else null end,
    last_reviewed_at = now()
  where id = saved_id;

  if p_bonus is not null and jsonb_typeof(p_bonus) = 'object' and not coalesce((p_bonus->>'preserve_existing')::boolean, false) then
    update public.source_question_bonuses set
      tag_mode = case when jsonb_array_length(coalesce(p_bonus->'tag_ids', '[]'::jsonb)) > 0 then 'replace'
        when prior_bonus_tags > 0 then 'inherit' else tag_mode end,
      stability = nullif(p_bonus->>'stability',''),
      audience_suitability = nullif(p_bonus->>'audience_suitability',''),
      audience_scope = nullif(p_bonus->>'audience_scope',''),
      audience_locale = case when p_bonus->>'audience_scope' = 'country_specific' then nullif(btrim(p_bonus->>'audience_locale'),'') else null end,
      content_flags = case when p_bonus->'content_flags' is null or p_bonus->'content_flags' = 'null'::jsonb then null
        else array(select jsonb_array_elements_text(p_bonus->'content_flags')) end
    where source_question_id = saved_id returning id into saved_bonus_id;
  end if;

  if payload->>'question_type' = 'multi-part' then
    -- Retain IDs and all per-part classifications even when a middle row is
    -- removed. Temporary unique positions/labels prevent reorder collisions.
    delete from public.source_question_parts where source_question_id = saved_id and not (id = any(part_ids));
    update public.source_question_parts set position = position + 10000, label = id::text where source_question_id = saved_id;
    for idx in 0..answer_count-1 loop
      part_id := nullif(p_question->'part_ids'->>idx, '')::uuid;
      if part_id is null then
        insert into public.source_question_parts(source_question_id, position, label, prompt, correct_answer, accepted_answers)
        values(saved_id, idx+1, coalesce(payload->'options'->idx->>'label',chr(65+idx)), payload->'options'->idx->>'clue',
          payload->'correct_answer'->idx, coalesce(payload->'accepted_answers'->idx,'[]'::jsonb));
      else
        update public.source_question_parts set position=idx+1, label=coalesce(payload->'options'->idx->>'label',chr(65+idx)),
          prompt=payload->'options'->idx->>'clue', correct_answer=payload->'correct_answer'->idx,
          accepted_answers=coalesce(payload->'accepted_answers'->idx,'[]'::jsonb), updated_at=now() where id=part_id;
      end if;
    end loop;
  else
    delete from public.source_question_parts where source_question_id = saved_id;
  end if;
  insert into public.platform_admin_audit_log(admin_id, action, entity_type, entity_id, details)
  values(auth.uid(), case when p_question_id is null then 'library_question_created' else 'library_question_updated' end,
    'source_question', saved_id, jsonb_build_object('previous_revision', previous.revision,
      'revision', (select revision from public.source_questions where id=saved_id), 'verified',p_verified,'status',payload->>'status'));
  return saved_id;
end; $$;
revoke all on function public.admin_save_library_question(uuid,jsonb,uuid,uuid[],uuid[],jsonb,integer,boolean) from public, anon;
grant execute on function public.admin_save_library_question(uuid,jsonb,uuid,uuid[],uuid[],jsonb,integer,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
