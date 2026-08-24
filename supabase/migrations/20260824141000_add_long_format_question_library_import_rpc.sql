begin;

create or replace function public.resolved_question_tag_slugs(p_phrases jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(distinct tags.slug order by tags.slug), '[]'::jsonb)
  from jsonb_array_elements_text(coalesce(p_phrases, '[]'::jsonb)) as phrase(value)
  join lateral (select public.resolve_question_library_tag_id(phrase.value) as id) resolved on resolved.id is not null
  join public.tags on tags.id = resolved.id
$$;

revoke all on function public.resolved_question_tag_slugs(jsonb) from public, anon, authenticated;

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
  legacy_payload jsonb;
  legacy_questions jsonb := '[]'::jsonb;
  legacy_tiebreakers jsonb := '[]'::jsonb;
  question jsonb;
  legacy_question jsonb;
  part jsonb;
  legacy_parts jsonb;
  bonus jsonb;
  legacy_bonus jsonb;
  tiebreaker jsonb;
  internal_key text;
  question_id uuid;
  part_id uuid;
  bonus_id uuid;
  tiebreaker_id uuid;
  batch_id uuid;
  proposed_count integer := 0;
  proposed_unique integer := 0;
  parent_scope text;
  part_count integer;
  bonus_count integer;
  tag_phrase_count integer;
  current_counts jsonb;
begin
  if length(btrim(coalesce(p_file_name, ''))) not between 1 and 255 then
    raise exception 'Import file name is required and must be at most 255 characters';
  end if;
  if p_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Import checksum must be a lowercase SHA-256 value';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
    or (p_payload->>'version')::integer <> 3
    or jsonb_typeof(p_payload->'questions') <> 'array'
    or jsonb_typeof(p_payload->'tiebreakers') <> 'array' then
    raise exception 'Unsupported or malformed long-format Question Library payload';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_payload->'questions') question(value)
    group by question.value->>'importKey' having count(*) > 1
  ) then raise exception 'Question import keys must be unique within a batch'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'tiebreakers') tiebreaker(value)
    group by tiebreaker.value->>'importKey' having count(*) > 1
  ) then raise exception 'Tiebreaker import keys must be unique within a batch'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_payload->'questions') question(value)
    where coalesce(question.value->>'importKey', '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  ) then raise exception 'Question import keys contain unsupported characters'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'tiebreakers') tiebreaker(value)
    where coalesce(tiebreaker.value->>'importKey', '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
      or not exists (
        select 1 from public.categories
        where categories.slug = tiebreaker.value->>'primaryCategory' and categories.is_active
      )
      or nullif(tiebreaker.value->>'editorialDifficulty', '')::integer not between 1 and 5
      or coalesce(tiebreaker.value->>'audienceFit', '') not in ('broad', 'kids', 'young_adults', 'older_adults')
      or coalesce(tiebreaker.value->>'audienceScope', '') not in ('global', 'country_specific')
      or jsonb_typeof(tiebreaker.value->'adultContent') <> 'boolean'
  ) then raise exception 'A tiebreaker has invalid identity or classification metadata'; end if;

  -- The protected legacy writer still expects slug-shaped keys. Temporarily
  -- move any matching row to a deterministic internal key, then restore the
  -- approved external ID after the atomic legacy upsert.
  for question in select value from jsonb_array_elements(p_payload->'questions') loop
    internal_key := 'v3-' || md5(question->>'importKey');
    update public.source_questions set import_key = internal_key
    where origin = 'platform' and import_key = question->>'importKey';

    legacy_parts := '[]'::jsonb;
    for part in select value from jsonb_array_elements(question->'parts') loop
      legacy_parts := legacy_parts || jsonb_build_array(jsonb_build_object(
        'position', (part->>'position')::integer,
        'label', part->>'label',
        'prompt', part->>'prompt',
        'correctAnswer', part->'correctAnswer',
        'acceptedAnswers', coalesce(part->'acceptedAnswers', '[]'::jsonb),
        'primaryCategory', coalesce(nullif(part->>'primaryCategory', ''), nullif(question->>'primaryCategory', '')),
        'secondaryCategories', '[]'::jsonb,
        'tags', public.resolved_question_tag_slugs(part->'tagPhrases'),
        'promptPattern', 'name-term-identification',
        'answerType', 'term',
        'editorialDifficulty', coalesce(nullif(part->>'editorialDifficulty', '')::integer, nullif(question->>'editorialDifficulty', '')::integer),
        'stability', 'stable',
        'media', null
      ));
    end loop;

    bonus := question->'bonus';
    if bonus is null or jsonb_typeof(bonus) <> 'object' then
      legacy_bonus := null;
    else
      legacy_bonus := jsonb_build_object(
        'prompt', bonus->>'prompt',
        'correctAnswer', bonus->'correctAnswer',
        'acceptedAnswers', coalesce(bonus->'acceptedAnswers', '[]'::jsonb),
        'points', coalesce((bonus->>'points')::integer, 1),
        'primaryCategory', coalesce(nullif(bonus->>'primaryCategory', ''), nullif(question->>'primaryCategory', '')),
        'secondaryCategories', '[]'::jsonb,
        'tags', public.resolved_question_tag_slugs(bonus->'tagPhrases'),
        'promptPattern', 'name-term-identification',
        'answerType', 'term',
        'editorialDifficulty', coalesce(nullif(bonus->>'editorialDifficulty', '')::integer, nullif(question->>'editorialDifficulty', '')::integer),
        'stability', 'stable',
        'media', null,
        'notes', bonus->>'notes',
        'source', jsonb_build_object('name', null, 'url', null, 'checkedDate', null)
      );
    end if;

    legacy_question := jsonb_build_object(
      'importKey', internal_key,
      'prompt', question->>'prompt',
      'mechanic', question->>'mechanic',
      'correctAnswer', question->'correctAnswer',
      'acceptedAnswers', coalesce(question->'acceptedAnswers', '[]'::jsonb),
      'options', question->'options',
      'primaryCategory', nullif(question->>'primaryCategory', ''),
      'secondaryCategories', '[]'::jsonb,
      'tags', public.resolved_question_tag_slugs(question->'tagPhrases'),
      'promptPattern', 'name-term-identification',
      'answerType', 'term',
      'editorialDifficulty', nullif(question->>'editorialDifficulty', '')::integer,
      'stability', 'stable',
      'asOfDate', null,
      'reviewDueAt', null,
      'validFrom', null,
      'expiresAt', null,
      'media', null,
      'notes', question->>'notes',
      'status', 'needs_review',
      'source', jsonb_build_object('name', null, 'url', null, 'checkedDate', null),
      'promptSignature', question->>'promptSignature',
      'parts', legacy_parts,
      'bonus', legacy_bonus
    );
    legacy_questions := legacy_questions || jsonb_build_array(legacy_question);
  end loop;

  for tiebreaker in select value from jsonb_array_elements(p_payload->'tiebreakers') loop
    internal_key := 'v3-' || md5(tiebreaker->>'importKey');
    update public.source_tiebreakers set import_key = internal_key
    where import_key = tiebreaker->>'importKey';
    legacy_tiebreakers := legacy_tiebreakers || jsonb_build_array(jsonb_build_object(
      'importKey', internal_key,
      'prompt', tiebreaker->>'prompt',
      'correctValue', tiebreaker->'correctValue',
      'answerUnit', tiebreaker->>'answerUnit',
      'notes', tiebreaker->>'notes',
      'status', 'needs_review',
      'source', jsonb_build_object('name', null, 'url', null, 'checkedDate', null)
    ));
  end loop;

  legacy_payload := jsonb_build_object(
    'version', 1,
    'questions', legacy_questions,
    'tiebreakers', legacy_tiebreakers,
    'tags', '[]'::jsonb
  );
  result := public.import_question_library_batch_legacy(p_file_name, p_file_sha256, legacy_payload);
  batch_id := (result->>'batch_id')::uuid;

  if coalesce((result->>'reused')::boolean, false) then
    select count(distinct proposed_tag_id)::integer into proposed_unique
    from public.proposed_question_tag_assignments where import_batch_id = batch_id;
    return result || jsonb_build_object('proposed_tags', coalesce(proposed_unique, 0));
  end if;

  update public.question_library_import_batches
  set normalized_payload = p_payload, format_version = 3
  where id = batch_id;

  for question in select value from jsonb_array_elements(p_payload->'questions') loop
    internal_key := 'v3-' || md5(question->>'importKey');
    update public.source_questions set import_key = question->>'importKey'
    where origin = 'platform' and import_key = internal_key
    returning id into question_id;
    if question_id is null then raise exception 'Imported question % was not found', question->>'importKey'; end if;

    parent_scope := coalesce(nullif(question->>'audienceScope', ''), 'global');
    update public.source_questions
    set audience_fit = coalesce(nullif(question->>'audienceFit', ''), 'broad'),
        adult_content = coalesce((question->>'adultContent')::boolean, false),
        audience_scope = parent_scope,
        audience_locale = case when parent_scope = 'country_specific' then nullif(btrim(question->>'audienceLocale'), '') else null end,
        audience_suitability = case
          when coalesce((question->>'adultContent')::boolean, false) then 'adult'
          when question->>'audienceFit' = 'kids' then 'family'
          else 'general'
        end,
        content_flags = '{}'::text[],
        stability = 'stable', as_of_date = null, review_due_at = null, valid_from = null, expires_at = null,
        source_name = null, source_url = null, source_checked_date = null
    where id = question_id;

    delete from public.proposed_question_tag_assignments where source_question_id = question_id;
    proposed_count := proposed_count + public.attach_or_propose_question_tags(
      question_id, null, null, batch_id, question->'tagPhrases'
    );

    for part in select value from jsonb_array_elements(question->'parts') loop
      part_id := null;
      select id into part_id from public.source_question_parts
      where source_question_id = question_id and position = (part->>'position')::integer;
      if part_id is null then
        raise exception 'Imported Question % Part % was not found', question->>'importKey', part->>'position';
      end if;
      update public.source_question_parts
      set editorial_difficulty = nullif(part->>'editorialDifficulty', '')::integer,
          stability = null,
          audience_fit = nullif(part->>'audienceFit', ''),
          adult_content = nullif(part->>'adultContent', '')::boolean,
          audience_scope = case
            when nullif(part->>'audienceScope', '') is null
              and nullif(btrim(part->>'audienceLocale'), '') is not null then parent_scope
            else nullif(part->>'audienceScope', '')
          end,
          audience_locale = case
            when coalesce(nullif(part->>'audienceScope', ''), parent_scope) = 'country_specific'
              then nullif(btrim(part->>'audienceLocale'), '')
            else null
          end,
          audience_suitability = case
            when nullif(part->>'adultContent', '')::boolean then 'adult'
            when part->>'audienceFit' = 'kids' then 'family'
            when nullif(part->>'audienceFit', '') is not null then 'general'
            else null
          end,
          content_flags = null
      where id = part_id;
      if nullif(part->>'primaryCategory', '') is null then
        delete from public.source_question_part_categories where source_question_part_id = part_id;
      end if;
      proposed_count := proposed_count + public.attach_or_propose_question_tags(
        question_id, part_id, null, batch_id, part->'tagPhrases'
      );
    end loop;

    bonus := question->'bonus';
    if bonus is not null and jsonb_typeof(bonus) = 'object' then
      bonus_id := null;
      select id into bonus_id from public.source_question_bonuses where source_question_id = question_id;
      if bonus_id is null then raise exception 'Imported Question % Bonus was not found', question->>'importKey'; end if;
      update public.source_question_bonuses
      set editorial_difficulty = nullif(bonus->>'editorialDifficulty', '')::integer,
          stability = null,
          audience_fit = nullif(bonus->>'audienceFit', ''),
          adult_content = nullif(bonus->>'adultContent', '')::boolean,
          audience_scope = case
            when nullif(bonus->>'audienceScope', '') is null
              and nullif(btrim(bonus->>'audienceLocale'), '') is not null then parent_scope
            else nullif(bonus->>'audienceScope', '')
          end,
          audience_locale = case
            when coalesce(nullif(bonus->>'audienceScope', ''), parent_scope) = 'country_specific'
              then nullif(btrim(bonus->>'audienceLocale'), '')
            else null
          end,
          audience_suitability = case
            when nullif(bonus->>'adultContent', '')::boolean then 'adult'
            when bonus->>'audienceFit' = 'kids' then 'family'
            when nullif(bonus->>'audienceFit', '') is not null then 'general'
            else null
          end,
          content_flags = null,
          tag_mode = coalesce(nullif(bonus->>'tagMode', ''), 'inherit'),
          source_name = null, source_url = null, source_checked_date = null
      where id = bonus_id;
      if nullif(bonus->>'primaryCategory', '') is null then
        delete from public.source_question_bonus_categories where source_question_bonus_id = bonus_id;
      end if;
      proposed_count := proposed_count + public.attach_or_propose_question_tags(
        question_id, null, bonus_id, batch_id, bonus->'tagPhrases'
      );
    end if;
  end loop;

  for tiebreaker in select value from jsonb_array_elements(p_payload->'tiebreakers') loop
    internal_key := 'v3-' || md5(tiebreaker->>'importKey');
    tiebreaker_id := null;
    update public.source_tiebreakers
    set import_key = tiebreaker->>'importKey',
        primary_category_id = (select id from public.categories where slug = tiebreaker->>'primaryCategory'),
        editorial_difficulty = (tiebreaker->>'editorialDifficulty')::integer,
        audience_fit = coalesce(nullif(tiebreaker->>'audienceFit', ''), 'broad'),
        adult_content = coalesce((tiebreaker->>'adultContent')::boolean, false),
        audience_scope = coalesce(nullif(tiebreaker->>'audienceScope', ''), 'global'),
        audience_locale = case when tiebreaker->>'audienceScope' = 'country_specific' then nullif(btrim(tiebreaker->>'audienceLocale'), '') else null end,
        source_name = null, source_url = null, source_checked_date = null
    where import_key = internal_key
    returning id into tiebreaker_id;
    if tiebreaker_id is null then raise exception 'Imported Tiebreaker % was not found', tiebreaker->>'importKey'; end if;
  end loop;

  select count(distinct proposed_tag_id)::integer into proposed_unique
  from public.proposed_question_tag_assignments where import_batch_id = batch_id;

  select
    coalesce(sum(jsonb_array_length(value->'parts')), 0)::integer,
    count(*) filter (where jsonb_typeof(value->'bonus') = 'object')::integer
  into part_count, bonus_count
  from jsonb_array_elements(p_payload->'questions');

  select count(*)::integer into tag_phrase_count from (
    select phrase.value
    from jsonb_array_elements(p_payload->'questions') question(value)
    cross join lateral jsonb_array_elements_text(question.value->'tagPhrases') phrase(value)
    union all
    select phrase.value
    from jsonb_array_elements(p_payload->'questions') question(value)
    cross join lateral jsonb_array_elements(question.value->'parts') part(value)
    cross join lateral jsonb_array_elements_text(part.value->'tagPhrases') phrase(value)
    union all
    select phrase.value
    from jsonb_array_elements(p_payload->'questions') question(value)
    cross join lateral jsonb_array_elements_text(question.value->'bonus'->'tagPhrases') phrase(value)
  ) phrases;

  current_counts := jsonb_build_object(
    'questions', jsonb_array_length(p_payload->'questions'),
    'questionParts', part_count,
    'bonuses', bonus_count,
    'tiebreakers', jsonb_array_length(p_payload->'tiebreakers'),
    'tagPhrases', tag_phrase_count,
    'proposedTagPhrases', coalesce(proposed_unique, 0)
  );
  update public.question_library_import_batches set counts = current_counts where id = batch_id;

  return result || jsonb_build_object(
    'counts', current_counts,
    'proposed_tags', coalesce(proposed_unique, 0),
    'proposed_assignments', proposed_count
  );
end;
$$;

revoke all on function public.import_question_library_batch(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_question_library_batch(text, text, jsonb) to service_role;

comment on function public.import_question_library_batch(text, text, jsonb) is
  'Atomically imports approved v3 long-format Questions/Tiebreakers payloads; unknown tags become non-blocking bulk-review assignments.';

commit;
