begin;

drop view public.source_question_catalog;

create view public.source_question_catalog
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
  coalesce(tag_metadata.tag_names, '{}'::text[]) as tag_names,
  bonus_metadata.bonus
from public.source_questions
left join lateral (
  select
    array_agg(source_question_categories.category_id order by source_question_categories.role, categories.sort_order)
      as category_ids,
    array_agg(source_question_categories.category_id order by categories.sort_order)
      filter (where source_question_categories.role = 'secondary') as secondary_category_ids,
    (array_agg(source_question_categories.category_id order by categories.sort_order)
      filter (where source_question_categories.role = 'primary'))[1] as primary_category_id,
    max(categories.name) filter (where source_question_categories.role = 'primary') as primary_category_name,
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
) as tag_metadata on true
left join lateral (
  select jsonb_build_object(
    'id', source_question_bonuses.id,
    'prompt', source_question_bonuses.prompt,
    'correct_answer', source_question_bonuses.correct_answer,
    'accepted_answers', source_question_bonuses.accepted_answers,
    'points', source_question_bonuses.points,
    'image_url', source_question_bonuses.image_url,
    'prompt_pattern_id', source_question_bonuses.prompt_pattern_id,
    'answer_type_id', source_question_bonuses.answer_type_id,
    'editorial_difficulty', source_question_bonuses.editorial_difficulty,
    'stability', source_question_bonuses.stability,
    'audience_suitability', source_question_bonuses.audience_suitability,
    'audience_fit', source_question_bonuses.audience_fit,
    'adult_content', source_question_bonuses.adult_content,
    'audience_scope', source_question_bonuses.audience_scope,
    'audience_locale', source_question_bonuses.audience_locale,
    'content_flags', source_question_bonuses.content_flags,
    'tag_mode', source_question_bonuses.tag_mode,
    'primary_category_id', bonus_categories.primary_category_id,
    'secondary_category_ids', coalesce(bonus_categories.secondary_category_ids, '{}'::uuid[]),
    'category_ids', coalesce(bonus_categories.category_ids, '{}'::uuid[]),
    'tag_ids', coalesce(bonus_tags.tag_ids, '{}'::uuid[])
  ) as bonus
  from public.source_question_bonuses
  left join lateral (
    select
      array_agg(source_question_bonus_categories.category_id order by source_question_bonus_categories.role, categories.sort_order)
        as category_ids,
      array_agg(source_question_bonus_categories.category_id order by categories.sort_order)
        filter (where source_question_bonus_categories.role = 'secondary') as secondary_category_ids,
      (array_agg(source_question_bonus_categories.category_id order by categories.sort_order)
        filter (where source_question_bonus_categories.role = 'primary'))[1] as primary_category_id
    from public.source_question_bonus_categories
    join public.categories on categories.id = source_question_bonus_categories.category_id
    where source_question_bonus_categories.source_question_bonus_id = source_question_bonuses.id
  ) as bonus_categories on true
  left join lateral (
    select array_agg(tags.id order by tags.name) as tag_ids
    from public.source_question_bonus_tags
    join public.tags on tags.id = source_question_bonus_tags.tag_id
    where source_question_bonus_tags.source_question_bonus_id = source_question_bonuses.id
  ) as bonus_tags on true
  where source_question_bonuses.source_question_id = source_questions.id
) as bonus_metadata on true;

revoke all on public.source_question_catalog from anon;
grant select on public.source_question_catalog to authenticated;

comment on view public.source_question_catalog is
  'RLS-aware source question catalog with normalized category/tag data and approved Audience Fit, Adult Content, and Bonus tag-mode metadata.';

commit;
