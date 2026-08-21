begin;

create or replace view public.source_question_catalog
with (security_invoker = true)
as
select
  source_questions.*,
  coalesce(category_metadata.category_ids, '{}'::uuid[]) as category_ids,
  coalesce(category_metadata.secondary_category_ids, '{}'::uuid[]) as secondary_category_ids,
  category_metadata.primary_category_id,
  category_metadata.primary_category_name,
  coalesce(category_metadata.category_names, '{}'::text[]) as category_names,
  coalesce(tag_metadata.tag_ids, '{}'::uuid[]) as tag_ids,
  coalesce(tag_metadata.tag_names, '{}'::text[]) as tag_names
from public.source_questions
left join lateral (
  select
    array_agg(source_question_categories.category_id order by source_question_categories.role, categories.sort_order)
      as category_ids,
    array_agg(source_question_categories.category_id order by categories.sort_order)
      filter (where source_question_categories.role = 'secondary') as secondary_category_ids,
    (array_agg(source_question_categories.category_id order by categories.sort_order)
      filter (where source_question_categories.role = 'primary'))[1] as primary_category_id,
    max(categories.name)
      filter (where source_question_categories.role = 'primary') as primary_category_name,
    array_agg(categories.name order by source_question_categories.role, categories.sort_order) as category_names
  from public.source_question_categories
  join public.categories on categories.id = source_question_categories.category_id
  where source_question_categories.source_question_id = source_questions.id
) as category_metadata on true
left join lateral (
  select
    array_agg(tags.id order by tags.name) as tag_ids,
    array_agg(tags.name order by tags.name) as tag_names
  from public.source_question_tags
  join public.tags on tags.id = source_question_tags.tag_id
  where source_question_tags.source_question_id = source_questions.id
) as tag_metadata on true;

revoke all on table public.source_question_catalog from anon;
grant select on table public.source_question_catalog to authenticated;

comment on view public.source_question_catalog is
  'RLS-aware read model joining source content to controlled category and tag metadata.';

create or replace function public.save_my_question_with_metadata(
  p_question_id uuid,
  p_question jsonb,
  p_primary_category_id uuid default null,
  p_secondary_category_ids uuid[] default '{}'::uuid[],
  p_tag_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_question_id uuid;
  legacy_category text;
  legacy_difficulty text;
  legacy_tags text[];
  numeric_difficulty integer;
begin
  if auth.uid() is null then
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
      origin,
      owner_id,
      question_type,
      prompt,
      correct_answer,
      accepted_answers,
      options,
      category,
      difficulty,
      tags,
      image_url,
      notes,
      status,
      prompt_pattern_id,
      answer_type_id,
      editorial_difficulty,
      scoring_mode,
      stability,
      as_of_date,
      review_due_at,
      valid_from,
      expires_at,
      prompt_signature
    ) values (
      'user',
      auth.uid(),
      p_question->>'question_type',
      btrim(p_question->>'prompt'),
      p_question->'correct_answer',
      coalesce(p_question->'accepted_answers', '[]'::jsonb),
      nullif(p_question->'options', 'null'::jsonb),
      legacy_category,
      legacy_difficulty,
      legacy_tags,
      nullif(btrim(p_question->>'image_url'), ''),
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
    )
    returning id into saved_question_id;
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
      and origin = 'user'
      and owner_id = auth.uid()
    returning id into saved_question_id;

    if saved_question_id is null then
      raise exception 'Question not found or not owned by current host';
    end if;
  end if;

  delete from public.source_question_categories
  where source_question_id = saved_question_id;

  if p_primary_category_id is not null then
    insert into public.source_question_categories (source_question_id, category_id, role)
    select saved_question_id, categories.id, 'primary'
    from public.categories
    where categories.id = p_primary_category_id
      and categories.is_active;
  end if;

  insert into public.source_question_categories (source_question_id, category_id, role)
  select saved_question_id, categories.id, 'secondary'
  from public.categories
  where categories.id = any(coalesce(p_secondary_category_ids, '{}'::uuid[]))
    and categories.id is distinct from p_primary_category_id
    and categories.is_active
  on conflict do nothing;

  delete from public.source_question_tags
  where source_question_id = saved_question_id;

  insert into public.source_question_tags (source_question_id, tag_id)
  select saved_question_id, tags.id
  from public.tags
  where tags.id = any(coalesce(p_tag_ids, '{}'::uuid[]))
    and tags.is_active
  on conflict do nothing;

  return saved_question_id;
end;
$$;

revoke all on function public.save_my_question_with_metadata(uuid, jsonb, uuid, uuid[], uuid[]) from public;
grant execute on function public.save_my_question_with_metadata(uuid, jsonb, uuid, uuid[], uuid[]) to authenticated;

comment on function public.save_my_question_with_metadata(uuid, jsonb, uuid, uuid[], uuid[]) is
  'Atomically saves one owned reusable question and its controlled category/tag relationships while maintaining legacy runtime projections.';

commit;
