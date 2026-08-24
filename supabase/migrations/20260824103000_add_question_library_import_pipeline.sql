begin;

-- Spreadsheet authorship keeps one editorial reference per ordinary question,
-- bonus and tiebreaker for MVP. These fields are not gameplay provenance;
-- source_question_id/revision continue to preserve runtime provenance.
alter table public.source_questions
  add column if not exists source_name text,
  add column if not exists source_url text,
  add column if not exists source_checked_date date;

alter table public.source_question_bonuses
  add column if not exists notes text,
  add column if not exists source_name text,
  add column if not exists source_url text,
  add column if not exists source_checked_date date;

alter table public.source_tiebreakers
  add column if not exists source_name text,
  add column if not exists source_url text,
  add column if not exists source_checked_date date;

alter table public.media_assets
  add column if not exists import_key text;

create unique index if not exists media_assets_import_key_idx
  on public.media_assets (import_key)
  where import_key is not null;

create table if not exists public.question_library_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  file_sha256 text not null unique check (file_sha256 ~ '^[0-9a-f]{64}$'),
  format_version integer not null check (format_version > 0),
  normalized_payload jsonb not null check (jsonb_typeof(normalized_payload) = 'object'),
  counts jsonb not null check (jsonb_typeof(counts) = 'object'),
  imported_at timestamptz not null default now()
);

alter table public.question_library_import_batches enable row level security;
revoke all on table public.question_library_import_batches from public, anon, authenticated;
grant all on table public.question_library_import_batches to service_role;

create or replace function public.import_question_library_media(
  p_import_key text,
  p_media jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  media_id uuid;
begin
  if p_media is null or jsonb_typeof(p_media) <> 'object'
    or length(btrim(coalesce(p_media->>'url', ''))) = 0 then
    return null;
  end if;

  if p_media->>'url' !~ '^https://' then
    raise exception 'Imported media URLs must use HTTPS';
  end if;

  insert into public.media_assets (
    origin, owner_id, kind, url, alt_text, import_key
  ) values (
    'platform', null, 'image', btrim(p_media->>'url'),
    nullif(btrim(p_media->>'alt'), ''), p_import_key
  )
  on conflict (import_key) where import_key is not null do update set
    kind = excluded.kind,
    url = excluded.url,
    alt_text = excluded.alt_text,
    updated_at = now()
  returning id into media_id;

  return media_id;
end;
$$;

revoke all on function public.import_question_library_media(text, jsonb) from public, anon, authenticated, service_role;

create or replace function public.import_question_library_question(p_question jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  question_id uuid;
  question_import_key text;
  question_status text;
  question_mechanic text;
  primary_category_slug text;
  legacy_category text;
  legacy_difficulty text;
  legacy_tags text[];
  pattern_id uuid;
  answer_type_id uuid;
  media_id uuid;
  part jsonb;
  part_id uuid;
  part_pattern_id uuid;
  part_answer_type_id uuid;
  part_media_id uuid;
  bonus jsonb;
  bonus_id uuid;
  bonus_pattern_id uuid;
  bonus_answer_type_id uuid;
  bonus_media_id uuid;
  referenced_slug text;
begin
  if jsonb_typeof(p_question) <> 'object' then
    raise exception 'Each imported question must be an object';
  end if;

  question_import_key := btrim(coalesce(p_question->>'importKey', ''));
  question_status := p_question->>'status';
  question_mechanic := p_question->>'mechanic';
  primary_category_slug := nullif(p_question->>'primaryCategory', '');

  if question_import_key !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Invalid question import key: %', question_import_key;
  end if;
  if length(btrim(coalesce(p_question->>'prompt', ''))) = 0 then
    raise exception 'Question % has no prompt', question_import_key;
  end if;
  if coalesce(question_status, '') not in ('draft', 'needs_review') then
    raise exception 'Question % has unsafe import status %', question_import_key, question_status;
  end if;
  if coalesce(question_mechanic, '') not in ('single-answer', 'multiple-choice', 'multi-answer', 'multi-part', 'ranking') then
    raise exception 'Question % has invalid mechanic %', question_import_key, question_mechanic;
  end if;
  if p_question->'correctAnswer' is null then
    raise exception 'Question % has no correct answer', question_import_key;
  end if;
  if coalesce(p_question->>'stability', '') not in ('stable', 'review_periodically', 'volatile') then
    raise exception 'Question % has invalid stability %', question_import_key, p_question->>'stability';
  end if;
  if question_mechanic <> 'multi-part' and (
    nullif(p_question->>'editorialDifficulty', '')::integer is null
    or nullif(p_question->>'editorialDifficulty', '')::integer not between 1 and 5
  ) then
    raise exception 'Question % must have difficulty 1 to 5', question_import_key;
  end if;
  if jsonb_typeof(p_question->'acceptedAnswers') <> 'array'
    or jsonb_typeof(p_question->'secondaryCategories') <> 'array'
    or jsonb_typeof(p_question->'tags') <> 'array'
    or jsonb_typeof(p_question->'parts') <> 'array' then
    raise exception 'Question % has malformed array metadata', question_import_key;
  end if;

  if primary_category_slug is not null then
    select categories.name into legacy_category
    from public.categories
    where categories.slug = primary_category_slug and categories.is_active;
    if legacy_category is null then
      raise exception 'Question % uses unknown primary category %', question_import_key, primary_category_slug;
    end if;
  end if;

  if length(btrim(coalesce(p_question->>'promptPattern', ''))) > 0 then
    select prompt_patterns.id into pattern_id
    from public.prompt_patterns
    where prompt_patterns.slug = p_question->>'promptPattern' and prompt_patterns.is_active;
    if pattern_id is null then
      raise exception 'Question % uses unknown prompt pattern %', question_import_key, p_question->>'promptPattern';
    end if;
  end if;

  if length(btrim(coalesce(p_question->>'answerType', ''))) > 0 then
    select answer_types.id into answer_type_id
    from public.answer_types
    where answer_types.slug = p_question->>'answerType' and answer_types.is_active;
    if answer_type_id is null then
      raise exception 'Question % uses unknown answer type %', question_import_key, p_question->>'answerType';
    end if;
  end if;

  for referenced_slug in
    select value from jsonb_array_elements_text(coalesce(p_question->'secondaryCategories', '[]'::jsonb))
  loop
    if not exists (select 1 from public.categories where slug = referenced_slug and is_active) then
      raise exception 'Question % uses unknown category %', question_import_key, referenced_slug;
    end if;
  end loop;

  for referenced_slug in
    select value from jsonb_array_elements_text(coalesce(p_question->'tags', '[]'::jsonb))
  loop
    if not exists (select 1 from public.tags where slug = referenced_slug and is_active) then
      raise exception 'Question % uses unknown or inactive tag %', question_import_key, referenced_slug;
    end if;
  end loop;

  select coalesce(array_agg(tags.name order by tags.name), '{}'::text[])
  into legacy_tags
  from public.tags
  where tags.slug in (
    select value from jsonb_array_elements_text(coalesce(p_question->'tags', '[]'::jsonb))
  );

  legacy_difficulty := case nullif(p_question->>'editorialDifficulty', '')::integer
    when 1 then 'Very Easy'
    when 2 then 'Easy'
    when 3 then 'Medium'
    when 4 then 'Hard'
    when 5 then 'Very Hard'
    else null
  end;

  media_id := public.import_question_library_media(
    'question:' || question_import_key,
    p_question->'media'
  );

  insert into public.source_questions (
    origin, owner_id, question_type, mechanic, prompt, correct_answer, accepted_answers,
    options, category, difficulty, editorial_difficulty, scoring_mode,
    prompt_pattern_id, answer_type_id, stability, as_of_date, review_due_at,
    valid_from, expires_at, media_asset_id, prompt_signature, tags, image_url,
    notes, status, is_verified, verified_at, verified_by, last_reviewed_at,
    import_key, source_name, source_url, source_checked_date
  ) values (
    'platform', null, question_mechanic, question_mechanic,
    btrim(p_question->>'prompt'), p_question->'correctAnswer',
    coalesce(p_question->'acceptedAnswers', '[]'::jsonb),
    nullif(p_question->'options', 'null'::jsonb), legacy_category, legacy_difficulty,
    nullif(p_question->>'editorialDifficulty', '')::integer,
    case when question_mechanic in ('multi-answer', 'multi-part', 'ranking') then 'per-item' else 'fixed' end,
    pattern_id, answer_type_id,
    coalesce(nullif(p_question->>'stability', ''), 'stable'),
    nullif(p_question->>'asOfDate', '')::date,
    nullif(p_question->>'reviewDueAt', '')::timestamptz,
    nullif(p_question->>'validFrom', '')::timestamptz,
    nullif(p_question->>'expiresAt', '')::timestamptz,
    media_id, nullif(btrim(p_question->>'promptSignature'), ''), legacy_tags,
    case when jsonb_typeof(p_question->'media') = 'object' then nullif(btrim(p_question->'media'->>'url'), '') else null end,
    nullif(btrim(p_question->>'notes'), ''), question_status,
    false, null, null, null, question_import_key,
    nullif(btrim(p_question->'source'->>'name'), ''),
    nullif(btrim(p_question->'source'->>'url'), ''),
    nullif(p_question->'source'->>'checkedDate', '')::date
  )
  on conflict (origin, import_key) where import_key is not null do update set
    owner_id = null,
    question_type = excluded.question_type,
    mechanic = excluded.mechanic,
    prompt = excluded.prompt,
    correct_answer = excluded.correct_answer,
    accepted_answers = excluded.accepted_answers,
    options = excluded.options,
    category = excluded.category,
    difficulty = excluded.difficulty,
    editorial_difficulty = excluded.editorial_difficulty,
    scoring_mode = excluded.scoring_mode,
    prompt_pattern_id = excluded.prompt_pattern_id,
    answer_type_id = excluded.answer_type_id,
    stability = excluded.stability,
    as_of_date = excluded.as_of_date,
    review_due_at = excluded.review_due_at,
    valid_from = excluded.valid_from,
    expires_at = excluded.expires_at,
    media_asset_id = excluded.media_asset_id,
    prompt_signature = excluded.prompt_signature,
    tags = excluded.tags,
    image_url = excluded.image_url,
    notes = excluded.notes,
    status = excluded.status,
    is_verified = false,
    verified_at = null,
    verified_by = null,
    last_reviewed_at = null,
    source_name = excluded.source_name,
    source_url = excluded.source_url,
    source_checked_date = excluded.source_checked_date
  returning id into question_id;

  delete from public.source_question_categories where source_question_id = question_id;
  if primary_category_slug is not null then
    insert into public.source_question_categories (source_question_id, category_id, role)
    select question_id, categories.id, 'primary'
    from public.categories where categories.slug = primary_category_slug;
  end if;
  insert into public.source_question_categories (source_question_id, category_id, role)
  select question_id, categories.id, 'secondary'
  from jsonb_array_elements_text(coalesce(p_question->'secondaryCategories', '[]'::jsonb)) as wanted(slug)
  join public.categories on categories.slug = wanted.slug
  where categories.slug is distinct from primary_category_slug
  on conflict do nothing;

  delete from public.source_question_tags where source_question_id = question_id;
  insert into public.source_question_tags (source_question_id, tag_id)
  select question_id, tags.id
  from jsonb_array_elements_text(coalesce(p_question->'tags', '[]'::jsonb)) as wanted(slug)
  join public.tags on tags.slug = wanted.slug;

  delete from public.source_question_parts where source_question_id = question_id;
  for part in select value from jsonb_array_elements(coalesce(p_question->'parts', '[]'::jsonb))
  loop
    select prompt_patterns.id into part_pattern_id
    from public.prompt_patterns
    where prompt_patterns.slug = part->>'promptPattern' and prompt_patterns.is_active;
    if part_pattern_id is null then
      raise exception 'Question % part % uses unknown prompt pattern %', question_import_key, part->>'position', part->>'promptPattern';
    end if;

    select answer_types.id into part_answer_type_id
    from public.answer_types
    where answer_types.slug = part->>'answerType' and answer_types.is_active;
    if part_answer_type_id is null then
      raise exception 'Question % part % uses unknown answer type %', question_import_key, part->>'position', part->>'answerType';
    end if;

    if not exists (select 1 from public.categories where slug = part->>'primaryCategory' and is_active) then
      raise exception 'Question % part % uses unknown primary category %', question_import_key, part->>'position', part->>'primaryCategory';
    end if;
    for referenced_slug in
      select value from jsonb_array_elements_text(coalesce(part->'secondaryCategories', '[]'::jsonb))
    loop
      if not exists (select 1 from public.categories where slug = referenced_slug and is_active) then
        raise exception 'Question % part % uses unknown category %', question_import_key, part->>'position', referenced_slug;
      end if;
    end loop;
    for referenced_slug in
      select value from jsonb_array_elements_text(coalesce(part->'tags', '[]'::jsonb))
    loop
      if not exists (select 1 from public.tags where slug = referenced_slug and is_active) then
        raise exception 'Question % part % uses unknown or inactive tag %', question_import_key, part->>'position', referenced_slug;
      end if;
    end loop;

    part_media_id := public.import_question_library_media(
      'question:' || question_import_key || ':part:' || (part->>'position'),
      part->'media'
    );

    insert into public.source_question_parts (
      source_question_id, position, label, prompt, correct_answer, accepted_answers,
      prompt_pattern_id, answer_type_id, editorial_difficulty, stability, media_asset_id
    ) values (
      question_id, (part->>'position')::integer, btrim(part->>'label'), btrim(part->>'prompt'),
      part->'correctAnswer', coalesce(part->'acceptedAnswers', '[]'::jsonb),
      part_pattern_id, part_answer_type_id, (part->>'editorialDifficulty')::integer,
      part->>'stability', part_media_id
    ) returning id into part_id;

    insert into public.source_question_part_categories (source_question_part_id, category_id, role)
    select part_id, categories.id, 'primary'
    from public.categories where categories.slug = part->>'primaryCategory';
    insert into public.source_question_part_categories (source_question_part_id, category_id, role)
    select part_id, categories.id, 'secondary'
    from jsonb_array_elements_text(coalesce(part->'secondaryCategories', '[]'::jsonb)) as wanted(slug)
    join public.categories on categories.slug = wanted.slug
    where categories.slug is distinct from part->>'primaryCategory'
    on conflict do nothing;
    insert into public.source_question_part_tags (source_question_part_id, tag_id)
    select part_id, tags.id
    from jsonb_array_elements_text(coalesce(part->'tags', '[]'::jsonb)) as wanted(slug)
    join public.tags on tags.slug = wanted.slug;
  end loop;

  bonus := p_question->'bonus';
  if bonus is null or jsonb_typeof(bonus) <> 'object' then
    delete from public.source_question_bonuses where source_question_id = question_id;
  else
    select prompt_patterns.id into bonus_pattern_id
    from public.prompt_patterns
    where prompt_patterns.slug = bonus->>'promptPattern' and prompt_patterns.is_active;
    if bonus_pattern_id is null then
      raise exception 'Question % bonus uses unknown prompt pattern %', question_import_key, bonus->>'promptPattern';
    end if;

    select answer_types.id into bonus_answer_type_id
    from public.answer_types
    where answer_types.slug = bonus->>'answerType' and answer_types.is_active;
    if bonus_answer_type_id is null then
      raise exception 'Question % bonus uses unknown answer type %', question_import_key, bonus->>'answerType';
    end if;

    if not exists (select 1 from public.categories where slug = bonus->>'primaryCategory' and is_active) then
      raise exception 'Question % bonus uses unknown primary category %', question_import_key, bonus->>'primaryCategory';
    end if;
    for referenced_slug in
      select value from jsonb_array_elements_text(coalesce(bonus->'secondaryCategories', '[]'::jsonb))
    loop
      if not exists (select 1 from public.categories where slug = referenced_slug and is_active) then
        raise exception 'Question % bonus uses unknown category %', question_import_key, referenced_slug;
      end if;
    end loop;
    for referenced_slug in
      select value from jsonb_array_elements_text(coalesce(bonus->'tags', '[]'::jsonb))
    loop
      if not exists (select 1 from public.tags where slug = referenced_slug and is_active) then
        raise exception 'Question % bonus uses unknown or inactive tag %', question_import_key, referenced_slug;
      end if;
    end loop;

    bonus_media_id := public.import_question_library_media(
      'question:' || question_import_key || ':bonus',
      bonus->'media'
    );

    insert into public.source_question_bonuses (
      source_question_id, prompt, correct_answer, accepted_answers, points,
      prompt_pattern_id, answer_type_id, editorial_difficulty, stability,
      media_asset_id, image_url, notes, source_name, source_url, source_checked_date
    ) values (
      question_id, btrim(bonus->>'prompt'), bonus->'correctAnswer',
      coalesce(bonus->'acceptedAnswers', '[]'::jsonb), (bonus->>'points')::integer,
      bonus_pattern_id, bonus_answer_type_id, (bonus->>'editorialDifficulty')::integer,
      bonus->>'stability', bonus_media_id,
      case when jsonb_typeof(bonus->'media') = 'object' then nullif(btrim(bonus->'media'->>'url'), '') else null end,
      nullif(btrim(bonus->>'notes'), ''),
      nullif(btrim(bonus->'source'->>'name'), ''),
      nullif(btrim(bonus->'source'->>'url'), ''),
      nullif(bonus->'source'->>'checkedDate', '')::date
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
      as_of_date = null,
      review_due_at = null,
      valid_from = null,
      expires_at = null,
      media_asset_id = excluded.media_asset_id,
      image_url = excluded.image_url,
      notes = excluded.notes,
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      source_checked_date = excluded.source_checked_date,
      updated_at = now()
    returning id into bonus_id;

    delete from public.source_question_bonus_categories where source_question_bonus_id = bonus_id;
    insert into public.source_question_bonus_categories (source_question_bonus_id, category_id, role)
    select bonus_id, categories.id, 'primary'
    from public.categories where categories.slug = bonus->>'primaryCategory';
    insert into public.source_question_bonus_categories (source_question_bonus_id, category_id, role)
    select bonus_id, categories.id, 'secondary'
    from jsonb_array_elements_text(coalesce(bonus->'secondaryCategories', '[]'::jsonb)) as wanted(slug)
    join public.categories on categories.slug = wanted.slug
    where categories.slug is distinct from bonus->>'primaryCategory'
    on conflict do nothing;

    delete from public.source_question_bonus_tags where source_question_bonus_id = bonus_id;
    insert into public.source_question_bonus_tags (source_question_bonus_id, tag_id)
    select bonus_id, tags.id
    from jsonb_array_elements_text(coalesce(bonus->'tags', '[]'::jsonb)) as wanted(slug)
    join public.tags on tags.slug = wanted.slug;
  end if;

  return question_id;
end;
$$;

revoke all on function public.import_question_library_question(jsonb) from public, anon, authenticated, service_role;

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
  existing_batch_id uuid;
  saved_batch_id uuid;
  tag_definition jsonb;
  alias_value text;
  alias_normalized text;
  imported_tag_id uuid;
  parent_id uuid;
  question_definition jsonb;
  tiebreaker_definition jsonb;
  counts jsonb;
  part_count integer;
  bonus_count integer;
begin
  if length(btrim(coalesce(p_file_name, ''))) not between 1 and 255 then
    raise exception 'Import file name is required and must be at most 255 characters';
  end if;
  if p_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Import checksum must be a lowercase SHA-256 value';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
    or (p_payload->>'version')::integer <> 1
    or jsonb_typeof(p_payload->'questions') <> 'array'
    or jsonb_typeof(p_payload->'tiebreakers') <> 'array'
    or jsonb_typeof(p_payload->'tags') <> 'array' then
    raise exception 'Unsupported or malformed Question Library import payload';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_payload->'questions') as question(value)
    group by question.value->>'importKey'
    having count(*) > 1
  ) then
    raise exception 'Question import keys must be unique within a batch';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_payload->'tiebreakers') as tiebreaker(value)
    group by tiebreaker.value->>'importKey'
    having count(*) > 1
  ) then
    raise exception 'Tiebreaker import keys must be unique within a batch';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_payload->'tags') as tag(value)
    group by tag.value->>'slug'
    having count(*) > 1
  ) then
    raise exception 'Tag slugs must be unique within a batch';
  end if;

  select id into existing_batch_id
  from public.question_library_import_batches
  where file_sha256 = p_file_sha256;
  if existing_batch_id is not null then
    return jsonb_build_object('batch_id', existing_batch_id, 'reused', true);
  end if;

  -- Tags are applied first so every question reference can be checked against
  -- the final controlled vocabulary within this same transaction.
  for tag_definition in select value from jsonb_array_elements(p_payload->'tags')
  loop
    if tag_definition->>'slug' !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      or length(btrim(coalesce(tag_definition->>'name', ''))) = 0
      or (tag_definition->>'specificity')::integer not between 1 and 4
      or (tag_definition->>'diversityWeight')::numeric < 0 then
      raise exception 'Malformed tag definition for %', tag_definition->>'slug';
    end if;

    insert into public.tags (
      slug, name, specificity, diversity_weight, is_active
    ) values (
      tag_definition->>'slug', btrim(tag_definition->>'name'),
      (tag_definition->>'specificity')::integer,
      (tag_definition->>'diversityWeight')::numeric,
      (tag_definition->>'active')::boolean
    )
    on conflict (slug) do update set
      name = excluded.name,
      specificity = excluded.specificity,
      diversity_weight = excluded.diversity_weight,
      is_active = excluded.is_active,
      updated_at = now()
    returning id into imported_tag_id;

    delete from public.tag_aliases where tag_aliases.tag_id = imported_tag_id;
    for alias_value in
      select value from jsonb_array_elements_text(coalesce(tag_definition->'aliases', '[]'::jsonb))
    loop
      alias_normalized := btrim(lower(regexp_replace(alias_value, '[^[:alnum:]]+', ' ', 'g')));
      if exists (
        select 1 from public.tag_aliases
        where normalized_alias = alias_normalized and tag_aliases.tag_id <> imported_tag_id
      ) then
        raise exception 'Tag alias % is already assigned to another canonical tag', alias_value;
      end if;
      insert into public.tag_aliases (tag_id, alias, normalized_alias)
      values (imported_tag_id, btrim(alias_value), alias_normalized)
      on conflict (normalized_alias) do update set alias = excluded.alias;
    end loop;
  end loop;

  for tag_definition in select value from jsonb_array_elements(p_payload->'tags')
  loop
    parent_id := null;
    if length(btrim(coalesce(tag_definition->>'parentTag', ''))) > 0 then
      select id into parent_id from public.tags where slug = tag_definition->>'parentTag';
      if parent_id is null then
        raise exception 'Tag % uses unknown parent %', tag_definition->>'slug', tag_definition->>'parentTag';
      end if;
    end if;
    update public.tags set parent_tag_id = parent_id where slug = tag_definition->>'slug';
  end loop;

  for question_definition in select value from jsonb_array_elements(p_payload->'questions')
  loop
    perform public.import_question_library_question(question_definition);
  end loop;

  for tiebreaker_definition in select value from jsonb_array_elements(p_payload->'tiebreakers')
  loop
    if tiebreaker_definition->>'importKey' !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      or length(btrim(coalesce(tiebreaker_definition->>'prompt', ''))) = 0
      or jsonb_typeof(tiebreaker_definition->'correctValue') <> 'number'
      or coalesce(tiebreaker_definition->>'status', '') not in ('draft', 'needs_review') then
      raise exception 'Malformed tiebreaker definition for %', tiebreaker_definition->>'importKey';
    end if;

    insert into public.source_tiebreakers (
      prompt, correct_value, answer_unit, notes, status, is_verified,
      last_reviewed_at, import_key, source_name, source_url, source_checked_date
    ) values (
      btrim(tiebreaker_definition->>'prompt'),
      (tiebreaker_definition->>'correctValue')::numeric,
      nullif(btrim(tiebreaker_definition->>'answerUnit'), ''),
      nullif(btrim(tiebreaker_definition->>'notes'), ''),
      tiebreaker_definition->>'status', false, null,
      tiebreaker_definition->>'importKey',
      nullif(btrim(tiebreaker_definition->'source'->>'name'), ''),
      nullif(btrim(tiebreaker_definition->'source'->>'url'), ''),
      nullif(tiebreaker_definition->'source'->>'checkedDate', '')::date
    )
    on conflict (import_key) do update set
      prompt = excluded.prompt,
      correct_value = excluded.correct_value,
      answer_unit = excluded.answer_unit,
      notes = excluded.notes,
      status = excluded.status,
      is_verified = false,
      last_reviewed_at = null,
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      source_checked_date = excluded.source_checked_date;
  end loop;

  select coalesce(sum(jsonb_array_length(value->'parts')), 0)::integer,
    count(*) filter (where jsonb_typeof(value->'bonus') = 'object')::integer
  into part_count, bonus_count
  from jsonb_array_elements(p_payload->'questions');

  counts := jsonb_build_object(
    'questions', jsonb_array_length(p_payload->'questions'),
    'questionParts', part_count,
    'bonuses', bonus_count,
    'tiebreakers', jsonb_array_length(p_payload->'tiebreakers'),
    'tags', jsonb_array_length(p_payload->'tags')
  );

  insert into public.question_library_import_batches (
    file_name, file_sha256, format_version, normalized_payload, counts
  ) values (
    btrim(p_file_name), p_file_sha256, (p_payload->>'version')::integer, p_payload, counts
  ) returning id into saved_batch_id;

  return jsonb_build_object('batch_id', saved_batch_id, 'reused', false, 'counts', counts);
end;
$$;

revoke all on function public.import_question_library_batch(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.import_question_library_batch(text, text, jsonb) to service_role;

comment on table public.question_library_import_batches is
  'Private audit trail for validated, atomic Question Library spreadsheet imports. Exact file hashes are idempotent.';
comment on function public.import_question_library_batch(text, text, jsonb) is
  'Service-role-only atomic import boundary. It never edits quiz or game snapshots and never publishes spreadsheet rows directly.';

commit;
