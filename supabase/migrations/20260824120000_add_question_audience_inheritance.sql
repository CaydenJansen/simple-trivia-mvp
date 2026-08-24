begin;

alter table public.source_questions
  add column audience_suitability text not null default 'general',
  add column audience_scope text not null default 'global',
  add column audience_locale text,
  add column content_flags text[] not null default '{}'::text[],
  add constraint source_questions_audience_suitability_check
    check (audience_suitability in ('family', 'general', 'adult')),
  add constraint source_questions_audience_scope_check
    check (audience_scope in ('global', 'country_specific')),
  add constraint source_questions_audience_locale_check
    check (
      (audience_scope = 'global' and audience_locale is null)
      or (audience_scope = 'country_specific' and length(btrim(audience_locale)) > 0)
    ),
  add constraint source_questions_content_flags_check
    check (content_flags <@ array[
      'sexual_health', 'sexual_content', 'alcohol', 'drugs', 'violence',
      'death', 'profanity', 'gambling'
    ]::text[]);

alter table public.source_question_parts
  alter column stability drop not null,
  alter column stability drop default,
  add column audience_suitability text,
  add column audience_scope text,
  add column audience_locale text,
  add column content_flags text[],
  add constraint source_question_parts_audience_suitability_check
    check (audience_suitability is null or audience_suitability in ('family', 'general', 'adult')),
  add constraint source_question_parts_audience_scope_check
    check (audience_scope is null or audience_scope in ('global', 'country_specific')),
  add constraint source_question_parts_audience_locale_check
    check (
      (audience_scope is null and audience_locale is null)
      or (audience_scope = 'global' and audience_locale is null)
      or (audience_scope = 'country_specific' and length(btrim(audience_locale)) > 0)
    ),
  add constraint source_question_parts_content_flags_check
    check (content_flags is null or content_flags <@ array[
      'sexual_health', 'sexual_content', 'alcohol', 'drugs', 'violence',
      'death', 'profanity', 'gambling'
    ]::text[]);

alter table public.source_question_bonuses
  alter column stability drop not null,
  alter column stability drop default,
  add column audience_suitability text,
  add column audience_scope text,
  add column audience_locale text,
  add column content_flags text[],
  add constraint source_question_bonuses_audience_suitability_check
    check (audience_suitability is null or audience_suitability in ('family', 'general', 'adult')),
  add constraint source_question_bonuses_audience_scope_check
    check (audience_scope is null or audience_scope in ('global', 'country_specific')),
  add constraint source_question_bonuses_audience_locale_check
    check (
      (audience_scope is null and audience_locale is null)
      or (audience_scope = 'global' and audience_locale is null)
      or (audience_scope = 'country_specific' and length(btrim(audience_locale)) > 0)
    ),
  add constraint source_question_bonuses_content_flags_check
    check (content_flags is null or content_flags <@ array[
      'sexual_health', 'sexual_content', 'alcohol', 'drugs', 'violence',
      'death', 'profanity', 'gambling'
    ]::text[]);

create index source_questions_audience_filter_idx
  on public.source_questions (status, audience_suitability, audience_scope, audience_locale);

alter table public.quiz_questions
  add column metadata_snapshot jsonb not null default '{}'::jsonb,
  add constraint quiz_questions_metadata_snapshot_object_check
    check (jsonb_typeof(metadata_snapshot) = 'object');

alter table public.game_questions
  add column metadata_snapshot jsonb not null default '{}'::jsonb,
  add constraint game_questions_metadata_snapshot_object_check
    check (jsonb_typeof(metadata_snapshot) = 'object');

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
    'audience_scope', source_question_bonuses.audience_scope,
    'audience_locale', source_question_bonuses.audience_locale,
    'content_flags', source_question_bonuses.content_flags,
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

revoke all on table public.source_question_catalog from anon;
grant select on table public.source_question_catalog to authenticated;

create or replace function public.save_my_question_with_inherited_metadata(
  p_question_id uuid,
  p_question jsonb,
  p_primary_category_id uuid default null,
  p_secondary_category_ids uuid[] default '{}'::uuid[],
  p_tag_ids uuid[] default '{}'::uuid[],
  p_bonus jsonb default '{"preserve_existing": true}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_question_id uuid;
begin
  saved_question_id := public.save_my_question_with_metadata(
    p_question_id, p_question, p_primary_category_id,
    p_secondary_category_ids, p_tag_ids, p_bonus
  );

  update public.source_questions
  set audience_suitability = coalesce(nullif(p_question->>'audience_suitability', ''), 'general'),
      audience_scope = coalesce(nullif(p_question->>'audience_scope', ''), 'global'),
      audience_locale = case
        when coalesce(nullif(p_question->>'audience_scope', ''), 'global') = 'country_specific'
          then nullif(btrim(p_question->>'audience_locale'), '')
        else null
      end,
      content_flags = coalesce(array(
        select jsonb_array_elements_text(coalesce(p_question->'content_flags', '[]'::jsonb))
      ), '{}'::text[])
  where id = saved_question_id;

  if p_bonus is not null
    and jsonb_typeof(p_bonus) = 'object'
    and not coalesce((p_bonus->>'preserve_existing')::boolean, false) then
    update public.source_question_bonuses
    set stability = nullif(p_bonus->>'stability', ''),
        audience_suitability = nullif(p_bonus->>'audience_suitability', ''),
        audience_scope = nullif(p_bonus->>'audience_scope', ''),
        audience_locale = case
          when p_bonus->>'audience_scope' = 'country_specific'
            then nullif(btrim(p_bonus->>'audience_locale'), '')
          else null
        end,
        content_flags = case
          when p_bonus->'content_flags' is null or jsonb_typeof(p_bonus->'content_flags') = 'null' then null
          else array(select jsonb_array_elements_text(p_bonus->'content_flags'))
        end
    where source_question_id = saved_question_id;
  end if;

  return saved_question_id;
end;
$$;

revoke all on function public.save_my_question_with_inherited_metadata(uuid, jsonb, uuid, uuid[], uuid[], jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_my_question_with_inherited_metadata(uuid, jsonb, uuid, uuid[], uuid[], jsonb) to authenticated;

do $$
begin
  if to_regprocedure('public.import_question_library_batch_legacy(text,text,jsonb)') is null then
    alter function public.import_question_library_batch(text, text, jsonb)
      rename to import_question_library_batch_legacy;
  end if;
end;
$$;

revoke all on function public.import_question_library_batch_legacy(text, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.apply_question_library_inherited_metadata(p_question jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  question_id uuid;
  part jsonb;
  bonus jsonb;
begin
  select id into question_id
  from public.source_questions
  where import_key = p_question->>'importKey' and origin = 'platform';

  if question_id is null then
    raise exception 'Imported question % was not found', p_question->>'importKey';
  end if;

  update public.source_questions
  set audience_suitability = coalesce(nullif(p_question->>'audienceSuitability', ''), 'general'),
      audience_scope = coalesce(nullif(p_question->>'audienceScope', ''), 'global'),
      audience_locale = case when p_question->>'audienceScope' = 'country_specific'
        then nullif(btrim(p_question->>'audienceLocale'), '') else null end,
      content_flags = coalesce(array(
        select jsonb_array_elements_text(coalesce(p_question->'contentFlags', '[]'::jsonb))
      ), '{}'::text[])
  where id = question_id;

  for part in select value from jsonb_array_elements(p_question->'parts') loop
    update public.source_question_parts
    set prompt_pattern_id = case when nullif(part->>'promptPattern', '') is null then null else prompt_pattern_id end,
        answer_type_id = case when nullif(part->>'answerType', '') is null then null else answer_type_id end,
        editorial_difficulty = nullif(part->>'editorialDifficulty', '')::integer,
        stability = nullif(part->>'stability', ''),
        audience_suitability = nullif(part->>'audienceSuitability', ''),
        audience_scope = nullif(part->>'audienceScope', ''),
        audience_locale = case when part->>'audienceScope' = 'country_specific'
          then nullif(btrim(part->>'audienceLocale'), '') else null end,
        content_flags = case
          when part->'contentFlags' is null or jsonb_typeof(part->'contentFlags') = 'null' then null
          else array(select jsonb_array_elements_text(part->'contentFlags'))
        end
    where source_question_id = question_id
      and position = (part->>'position')::integer;

    if nullif(part->>'primaryCategory', '') is null
      and jsonb_array_length(coalesce(part->'secondaryCategories', '[]'::jsonb)) = 0 then
      delete from public.source_question_part_categories
      where source_question_part_id = (
        select id from public.source_question_parts
        where source_question_id = question_id and position = (part->>'position')::integer
      );
    end if;
    if jsonb_array_length(coalesce(part->'tags', '[]'::jsonb)) = 0 then
      delete from public.source_question_part_tags
      where source_question_part_id = (
        select id from public.source_question_parts
        where source_question_id = question_id and position = (part->>'position')::integer
      );
    end if;
  end loop;

  bonus := p_question->'bonus';
  if bonus is not null and jsonb_typeof(bonus) = 'object' then
    update public.source_question_bonuses
    set prompt_pattern_id = case when nullif(bonus->>'promptPattern', '') is null then null else prompt_pattern_id end,
        answer_type_id = case when nullif(bonus->>'answerType', '') is null then null else answer_type_id end,
        editorial_difficulty = nullif(bonus->>'editorialDifficulty', '')::integer,
        stability = nullif(bonus->>'stability', ''),
        audience_suitability = nullif(bonus->>'audienceSuitability', ''),
        audience_scope = nullif(bonus->>'audienceScope', ''),
        audience_locale = case when bonus->>'audienceScope' = 'country_specific'
          then nullif(btrim(bonus->>'audienceLocale'), '') else null end,
        content_flags = case
          when bonus->'contentFlags' is null or jsonb_typeof(bonus->'contentFlags') = 'null' then null
          else array(select jsonb_array_elements_text(bonus->'contentFlags'))
        end
    where source_question_id = question_id;

    if nullif(bonus->>'primaryCategory', '') is null
      and jsonb_array_length(coalesce(bonus->'secondaryCategories', '[]'::jsonb)) = 0 then
      delete from public.source_question_bonus_categories
      where source_question_bonus_id = (
        select id from public.source_question_bonuses where source_question_id = question_id
      );
    end if;
    if jsonb_array_length(coalesce(bonus->'tags', '[]'::jsonb)) = 0 then
      delete from public.source_question_bonus_tags
      where source_question_bonus_id = (
        select id from public.source_question_bonuses where source_question_id = question_id
      );
    end if;
  end if;
end;
$$;

revoke all on function public.apply_question_library_inherited_metadata(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.import_question_library_batch(
  p_file_name text,
  p_file_sha256 text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  question jsonb;
  legacy_payload jsonb := p_payload;
  legacy_questions jsonb := '[]'::jsonb;
  legacy_question jsonb;
  legacy_parts jsonb;
  legacy_part jsonb;
  legacy_bonus jsonb;
begin
  for question in select value from jsonb_array_elements(p_payload->'questions') loop
    legacy_question := question;
    legacy_parts := '[]'::jsonb;
    for legacy_part in select value from jsonb_array_elements(question->'parts') loop
      legacy_part := jsonb_set(legacy_part, '{primaryCategory}', to_jsonb(coalesce(
        nullif(legacy_part->>'primaryCategory', ''), nullif(question->>'primaryCategory', '')
      )));
      legacy_part := jsonb_set(legacy_part, '{promptPattern}', to_jsonb(coalesce(
        nullif(legacy_part->>'promptPattern', ''), nullif(question->>'promptPattern', ''), 'name-term-identification'
      )));
      legacy_part := jsonb_set(legacy_part, '{answerType}', to_jsonb(coalesce(
        nullif(legacy_part->>'answerType', ''), nullif(question->>'answerType', ''), 'term'
      )));
      legacy_part := jsonb_set(legacy_part, '{editorialDifficulty}', to_jsonb(coalesce(
        nullif(legacy_part->>'editorialDifficulty', ''), nullif(question->>'editorialDifficulty', ''), '3'
      )::integer));
      legacy_part := jsonb_set(legacy_part, '{stability}', to_jsonb(coalesce(
        nullif(legacy_part->>'stability', ''), nullif(question->>'stability', ''), 'stable'
      )));
      legacy_parts := legacy_parts || jsonb_build_array(legacy_part);
    end loop;
    legacy_question := jsonb_set(legacy_question, '{parts}', legacy_parts);

    legacy_bonus := question->'bonus';
    if legacy_bonus is not null and jsonb_typeof(legacy_bonus) = 'object' then
      legacy_bonus := jsonb_set(legacy_bonus, '{primaryCategory}', to_jsonb(coalesce(
        nullif(legacy_bonus->>'primaryCategory', ''), nullif(question->>'primaryCategory', '')
      )));
      legacy_bonus := jsonb_set(legacy_bonus, '{promptPattern}', to_jsonb(coalesce(
        nullif(legacy_bonus->>'promptPattern', ''), nullif(question->>'promptPattern', ''), 'name-term-identification'
      )));
      legacy_bonus := jsonb_set(legacy_bonus, '{answerType}', to_jsonb(coalesce(
        nullif(legacy_bonus->>'answerType', ''), nullif(question->>'answerType', ''), 'term'
      )));
      legacy_bonus := jsonb_set(legacy_bonus, '{editorialDifficulty}', to_jsonb(coalesce(
        nullif(legacy_bonus->>'editorialDifficulty', ''), nullif(question->>'editorialDifficulty', ''), '3'
      )::integer));
      legacy_bonus := jsonb_set(legacy_bonus, '{stability}', to_jsonb(coalesce(
        nullif(legacy_bonus->>'stability', ''), nullif(question->>'stability', ''), 'stable'
      )));
      legacy_question := jsonb_set(legacy_question, '{bonus}', legacy_bonus);
    end if;

    legacy_questions := legacy_questions || jsonb_build_array(legacy_question);
  end loop;
  legacy_payload := jsonb_set(legacy_payload, '{questions}', legacy_questions);
  legacy_payload := jsonb_set(legacy_payload, '{version}', '1'::jsonb);

  result := public.import_question_library_batch_legacy(p_file_name, p_file_sha256, legacy_payload);

  if not coalesce((result->>'reused')::boolean, false) then
    for question in select value from jsonb_array_elements(p_payload->'questions') loop
      perform public.apply_question_library_inherited_metadata(question);
    end loop;
    update public.question_library_import_batches
    set normalized_payload = p_payload,
        format_version = (p_payload->>'version')::integer
    where id = (result->>'batch_id')::uuid;
  end if;

  return result;
end;
$$;

revoke all on function public.import_question_library_batch(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_question_library_batch(text, text, jsonb) to service_role;

create or replace function public.save_quiz_with_bonus_snapshots(
  p_quiz_id uuid,
  p_title text,
  p_status text,
  p_estimated_minutes integer,
  p_questions jsonb,
  p_content_screens jsonb default '[]'::jsonb,
  p_tiebreakers jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_quiz_id uuid;
begin
  saved_quiz_id := public.save_quiz_with_questions(
    p_quiz_id, p_title, p_status, p_estimated_minutes,
    p_questions, p_content_screens, p_tiebreakers
  );

  update public.quiz_questions
  set bonus = nullif(question.value->'bonus', 'null'::jsonb),
      metadata_snapshot = coalesce(question.value->'metadata_snapshot', '{}'::jsonb)
  from jsonb_array_elements(p_questions) as question(value)
  where quiz_questions.quiz_id = saved_quiz_id
    and quiz_questions.question_key = question.value->>'question_key';

  return saved_quiz_id;
end;
$$;

create or replace function public.snapshot_game_question_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.metadata_snapshot = '{}'::jsonb then
    select quiz_questions.metadata_snapshot
      into new.metadata_snapshot
    from public.games
    join public.quiz_questions
      on quiz_questions.quiz_id = games.quiz_id
     and quiz_questions.question_key = new.question_key
    where games.id = new.game_id;
  end if;

  new.metadata_snapshot := coalesce(new.metadata_snapshot, '{}'::jsonb);
  return new;
end;
$$;

create trigger game_questions_snapshot_metadata_before_insert
before insert on public.game_questions
for each row execute function public.snapshot_game_question_metadata();

comment on column public.source_questions.audience_suitability is
  'Editorial audience judgement. Defaults to general and is independent of category and tags.';
comment on column public.source_question_parts.audience_suitability is
  'Nullable override; null inherits the parent source question value.';
comment on column public.source_question_bonuses.audience_suitability is
  'Nullable override; null inherits the parent source question value.';
comment on column public.quiz_questions.metadata_snapshot is
  'Independent structured source metadata copied into the reusable quiz question.';
comment on column public.game_questions.metadata_snapshot is
  'Frozen copy of the quiz-question metadata snapshot for this game.';

commit;
