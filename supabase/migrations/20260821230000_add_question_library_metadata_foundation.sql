begin;

-- Controlled vocabularies remain platform-managed. Hosts may read and reuse them,
-- but customer-authored questions do not create global taxonomy records.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null unique check (length(btrim(name)) > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.prompt_patterns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null unique check (length(btrim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.answer_types (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null unique check (length(btrim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) > 0),
  parent_tag_id uuid references public.tags(id) on delete set null,
  specificity smallint not null default 2 check (specificity between 1 and 4),
  diversity_weight numeric(5,2) not null default 1 check (diversity_weight >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_tag_id is null or parent_tag_id <> id)
);

create table public.tag_aliases (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.tags(id) on delete cascade,
  alias text not null check (length(btrim(alias)) > 0),
  normalized_alias text not null unique check (length(btrim(normalized_alias)) > 0),
  created_at timestamptz not null default now(),
  unique (tag_id, alias)
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  origin text not null check (origin in ('platform', 'user')),
  owner_id uuid references auth.users(id) on delete cascade,
  kind text not null default 'image' check (kind in ('image', 'audio', 'video')),
  url text not null check (length(btrim(url)) > 0),
  alt_text text,
  caption text,
  credit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (origin = 'user' and owner_id is not null)
    or (origin = 'platform' and owner_id is null)
  )
);

alter table public.source_questions
  add column mechanic text,
  add column prompt_pattern_id uuid references public.prompt_patterns(id) on delete set null,
  add column answer_type_id uuid references public.answer_types(id) on delete set null,
  add column editorial_difficulty smallint,
  add column scoring_mode text,
  add column stability text not null default 'stable',
  add column as_of_date date,
  add column review_due_at timestamptz,
  add column valid_from timestamptz,
  add column expires_at timestamptz,
  add column media_asset_id uuid references public.media_assets(id) on delete set null,
  add column prompt_signature text;

update public.source_questions
set mechanic = case question_type
      when 'image-question' then 'single-answer'
      else question_type
    end,
    editorial_difficulty = case lower(coalesce(difficulty, ''))
      when 'very easy' then 1
      when 'easy' then 2
      when 'medium' then 3
      when 'hard' then 4
      when 'very hard' then 5
      else null
    end,
    scoring_mode = case
      when question_type in ('multi-answer', 'multi-part', 'ranking') then 'per-item'
      else 'fixed'
    end;

alter table public.source_questions
  alter column mechanic set not null,
  alter column scoring_mode set not null,
  add constraint source_questions_mechanic_check
    check (mechanic in ('single-answer', 'multiple-choice', 'multi-answer', 'multi-part', 'ranking')),
  add constraint source_questions_editorial_difficulty_check
    check (editorial_difficulty is null or editorial_difficulty between 1 and 5),
  add constraint source_questions_scoring_mode_check
    check (scoring_mode in ('fixed', 'per-item', 'all-or-nothing')),
  add constraint source_questions_stability_check
    check (stability in ('stable', 'review_periodically', 'volatile')),
  add constraint source_questions_validity_check
    check (valid_from is null or expires_at is null or valid_from < expires_at);

create or replace function public.sync_source_question_foundation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mechanic is null
    or (tg_op = 'UPDATE' and new.question_type is distinct from old.question_type
      and new.mechanic is not distinct from old.mechanic) then
    new.mechanic := case new.question_type
      when 'image-question' then 'single-answer'
      else new.question_type
    end;
  end if;

  if new.editorial_difficulty is null
    or (tg_op = 'UPDATE' and new.difficulty is distinct from old.difficulty
      and new.editorial_difficulty is not distinct from old.editorial_difficulty) then
    new.editorial_difficulty := case lower(coalesce(new.difficulty, ''))
      when 'very easy' then 1
      when 'easy' then 2
      when 'medium' then 3
      when 'hard' then 4
      when 'very hard' then 5
      else null
    end;
  end if;

  if new.scoring_mode is null then
    new.scoring_mode := case
      when new.question_type in ('multi-answer', 'multi-part', 'ranking') then 'per-item'
      else 'fixed'
    end;
  end if;

  return new;
end;
$$;

create trigger source_questions_foundation_sync_before_write
before insert or update on public.source_questions
for each row execute function public.sync_source_question_foundation();

create table public.source_question_categories (
  source_question_id uuid not null references public.source_questions(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  role text not null default 'primary' check (role in ('primary', 'secondary')),
  created_at timestamptz not null default now(),
  primary key (source_question_id, category_id)
);

create unique index source_question_one_primary_category_idx
  on public.source_question_categories (source_question_id)
  where role = 'primary';

create table public.source_question_tags (
  source_question_id uuid not null references public.source_questions(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (source_question_id, tag_id)
);

create table public.source_question_parts (
  id uuid primary key default gen_random_uuid(),
  source_question_id uuid not null references public.source_questions(id) on delete cascade,
  position integer not null check (position > 0),
  label text not null check (length(btrim(label)) > 0),
  prompt text not null check (length(btrim(prompt)) > 0),
  correct_answer jsonb not null,
  accepted_answers jsonb not null default '[]'::jsonb check (jsonb_typeof(accepted_answers) = 'array'),
  prompt_pattern_id uuid references public.prompt_patterns(id) on delete set null,
  answer_type_id uuid references public.answer_types(id) on delete set null,
  editorial_difficulty smallint check (editorial_difficulty is null or editorial_difficulty between 1 and 5),
  stability text not null default 'stable' check (stability in ('stable', 'review_periodically', 'volatile')),
  as_of_date date,
  review_due_at timestamptz,
  valid_from timestamptz,
  expires_at timestamptz,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_question_id, position),
  unique (source_question_id, label),
  check (valid_from is null or expires_at is null or valid_from < expires_at)
);

create table public.source_question_part_categories (
  source_question_part_id uuid not null references public.source_question_parts(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  role text not null default 'primary' check (role in ('primary', 'secondary')),
  created_at timestamptz not null default now(),
  primary key (source_question_part_id, category_id)
);

create unique index source_question_part_one_primary_category_idx
  on public.source_question_part_categories (source_question_part_id)
  where role = 'primary';

create table public.source_question_part_tags (
  source_question_part_id uuid not null references public.source_question_parts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (source_question_part_id, tag_id)
);

create table public.source_question_bonuses (
  id uuid primary key default gen_random_uuid(),
  source_question_id uuid not null unique references public.source_questions(id) on delete cascade,
  prompt text not null check (length(btrim(prompt)) > 0),
  correct_answer jsonb not null,
  accepted_answers jsonb not null default '[]'::jsonb check (jsonb_typeof(accepted_answers) = 'array'),
  points integer not null default 1 check (points > 0),
  prompt_pattern_id uuid references public.prompt_patterns(id) on delete set null,
  answer_type_id uuid references public.answer_types(id) on delete set null,
  editorial_difficulty smallint check (editorial_difficulty is null or editorial_difficulty between 1 and 5),
  stability text not null default 'stable' check (stability in ('stable', 'review_periodically', 'volatile')),
  as_of_date date,
  review_due_at timestamptz,
  valid_from timestamptz,
  expires_at timestamptz,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_from is null or expires_at is null or valid_from < expires_at)
);

create table public.source_question_bonus_categories (
  source_question_bonus_id uuid not null references public.source_question_bonuses(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  role text not null default 'primary' check (role in ('primary', 'secondary')),
  created_at timestamptz not null default now(),
  primary key (source_question_bonus_id, category_id)
);

create unique index source_question_bonus_one_primary_category_idx
  on public.source_question_bonus_categories (source_question_bonus_id)
  where role = 'primary';

create table public.source_question_bonus_tags (
  source_question_bonus_id uuid not null references public.source_question_bonuses(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (source_question_bonus_id, tag_id)
);

create index source_questions_foundation_filters_idx
  on public.source_questions (status, mechanic, editorial_difficulty, stability);
create index source_question_categories_category_idx
  on public.source_question_categories (category_id, source_question_id);
create index source_question_tags_tag_idx
  on public.source_question_tags (tag_id, source_question_id);
create index tag_aliases_tag_idx on public.tag_aliases (tag_id);
create index tags_parent_idx on public.tags (parent_tag_id);

insert into public.categories (slug, name, sort_order)
values
  ('geography', 'Geography', 10),
  ('history', 'History', 20),
  ('science-nature', 'Science & Nature', 30),
  ('sport', 'Sport', 40),
  ('music', 'Music', 50),
  ('film-television', 'Film & Television', 60),
  ('arts-literature', 'Arts & Literature', 70),
  ('food-drink', 'Food & Drink', 80),
  ('society-culture', 'Society & Culture', 90),
  ('language-words', 'Language & Words', 100),
  ('technology-inventions', 'Technology & Inventions', 110),
  ('games-leisure', 'Games & Leisure', 120),
  ('business-brands', 'Business & Brands', 130),
  ('politics-government', 'Politics & Government', 140);

insert into public.prompt_patterns (slug, name)
values
  ('name-term-identification', 'Name / term identification'),
  ('person-identification', 'Person identification'),
  ('place-identification', 'Place identification'),
  ('quantity', 'Quantity / how many'),
  ('year-date', 'Year / date'),
  ('definition', 'Definition'),
  ('which-of-the-following', 'Which of the following'),
  ('identify-from-clue', 'Identify from clue'),
  ('identify-from-image', 'Identify from image'),
  ('origin-etymology', 'Origin / etymology'),
  ('complete-phrase-title', 'Complete phrase / title'),
  ('list-answers', 'List answers'),
  ('ranking-ordering', 'Ranking / ordering'),
  ('match-clue-answer', 'Match clue to answer');

insert into public.answer_types (slug, name)
values
  ('person', 'Person'),
  ('place', 'Place'),
  ('country', 'Country'),
  ('city', 'City'),
  ('number', 'Number'),
  ('year-date', 'Year / date'),
  ('term', 'Term'),
  ('organisation', 'Organisation'),
  ('brand', 'Brand'),
  ('animal-species', 'Animal / species'),
  ('title', 'Title'),
  ('film-tv-title', 'Film / television title'),
  ('song', 'Song'),
  ('artist', 'Artist'),
  ('object', 'Object'),
  ('event', 'Event');

-- Preserve current free-text tags as canonical records. Specificity and parent
-- relationships are intentionally conservative until editorial curation.
with legacy_tags as (
  select distinct btrim(tag_name) as name,
    trim(both '-' from lower(regexp_replace(btrim(tag_name), '[^[:alnum:]]+', '-', 'g'))) as slug
  from public.source_questions
  cross join lateral unnest(tags) as tag_name
  where length(btrim(tag_name)) > 0
)
insert into public.tags (slug, name)
select slug, min(name)
from legacy_tags
where length(slug) > 0
group by slug
on conflict (slug) do nothing;

with legacy_tags as (
  select distinct btrim(tag_name) as alias,
    lower(regexp_replace(btrim(tag_name), '[^[:alnum:]]+', ' ', 'g')) as normalized_alias,
    trim(both '-' from lower(regexp_replace(btrim(tag_name), '[^[:alnum:]]+', '-', 'g'))) as slug
  from public.source_questions
  cross join lateral unnest(tags) as tag_name
  where length(btrim(tag_name)) > 0
)
insert into public.tag_aliases (tag_id, alias, normalized_alias)
select tags.id, legacy_tags.alias, btrim(legacy_tags.normalized_alias)
from legacy_tags
join public.tags on tags.slug = legacy_tags.slug
where length(btrim(legacy_tags.normalized_alias)) > 0
on conflict (normalized_alias) do nothing;

insert into public.source_question_tags (source_question_id, tag_id)
select distinct source_questions.id, tags.id
from public.source_questions
cross join lateral unnest(source_questions.tags) as tag_name
join public.tags
  on tags.slug = trim(both '-' from lower(regexp_replace(btrim(tag_name), '[^[:alnum:]]+', '-', 'g')))
on conflict do nothing;

-- Straight category aliases are safe to map automatically.
insert into public.source_question_categories (source_question_id, category_id, role)
select source_questions.id, categories.id, 'primary'
from public.source_questions
join public.categories on categories.slug = case lower(btrim(source_questions.category))
  when 'geography' then 'geography'
  when 'history' then 'history'
  when 'science & nature' then 'science-nature'
  when 'sport' then 'sport'
  when 'music' then 'music'
  when 'movies' then 'film-television'
  when 'film & television' then 'film-television'
  when 'arts & literature' then 'arts-literature'
  when 'food & drink' then 'food-drink'
  when 'society & culture' then 'society-culture'
  when 'language & words' then 'language-words'
  when 'technology & inventions' then 'technology-inventions'
  when 'games & leisure' then 'games-leisure'
  when 'business & brands' then 'business-brands'
  when 'politics & government' then 'politics-government'
  else null
end
on conflict do nothing;

-- Existing General Knowledge seed rows are classified individually. General
-- Knowledge itself is never inserted into categories.
with classifications (import_key, category_slug) as (
  values
    ('starter-general-01', 'geography'),
    ('starter-general-02', 'science-nature'),
    ('starter-general-03', 'arts-literature'),
    ('starter-general-04', 'geography'),
    ('starter-general-05', 'science-nature'),
    ('starter-general-06', 'science-nature'),
    ('starter-general-07', 'language-words'),
    ('starter-general-08', 'geography'),
    ('library-v2-general-ve-01', 'science-nature'),
    ('library-v2-general-ve-02', 'science-nature'),
    ('library-v2-general-ve-03', 'science-nature'),
    ('library-v2-general-ve-04', 'geography'),
    ('library-v2-general-ve-05', 'geography'),
    ('library-v2-general-ve-06', 'arts-literature'),
    ('library-v2-general-hard-01', 'geography'),
    ('library-v2-general-hard-02', 'science-nature'),
    ('library-v2-general-hard-03', 'arts-literature'),
    ('library-v2-general-hard-04', 'geography'),
    ('library-v2-general-hard-05', 'history'),
    ('library-v2-general-hard-06', 'science-nature'),
    ('library-v2-general-vh-01', 'geography'),
    ('library-v2-general-vh-02', 'geography'),
    ('library-v2-general-vh-03', 'history'),
    ('library-v2-general-vh-04', 'geography'),
    ('library-v2-general-vh-05', 'science-nature'),
    ('library-v2-general-vh-06', 'geography')
)
insert into public.source_question_categories (source_question_id, category_id, role)
select source_questions.id, categories.id, 'primary'
from classifications
join public.source_questions on source_questions.import_key = classifications.import_key
join public.categories on categories.slug = classifications.category_slug
on conflict do nothing;

with secondary_classifications (import_key, category_slug) as (
  values
    ('starter-general-07', 'geography'),
    ('starter-general-08', 'business-brands'),
    ('library-v2-general-ve-05', 'business-brands'),
    ('library-v2-general-vh-02', 'business-brands'),
    ('library-v2-general-vh-03', 'geography')
)
insert into public.source_question_categories (source_question_id, category_id, role)
select source_questions.id, categories.id, 'secondary'
from secondary_classifications
join public.source_questions on source_questions.import_key = secondary_classifications.import_key
join public.categories on categories.slug = secondary_classifications.category_slug
on conflict do nothing;

-- Child metadata edits are part of the source revision even though they live
-- outside source_questions.
create or replace function public.touch_parent_source_question()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_id uuid;
begin
  parent_id := coalesce(new.source_question_id, old.source_question_id);
  update public.source_questions set updated_at = now() where id = parent_id;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger source_question_categories_touch_parent
after insert or update or delete on public.source_question_categories
for each row execute function public.touch_parent_source_question();
create trigger source_question_tags_touch_parent
after insert or update or delete on public.source_question_tags
for each row execute function public.touch_parent_source_question();
create trigger source_question_parts_touch_parent
after insert or update or delete on public.source_question_parts
for each row execute function public.touch_parent_source_question();
create trigger source_question_bonuses_touch_parent
after insert or update or delete on public.source_question_bonuses
for each row execute function public.touch_parent_source_question();

create or replace function public.touch_parent_from_part_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  part_id uuid;
begin
  part_id := coalesce(new.source_question_part_id, old.source_question_part_id);
  update public.source_questions
  set updated_at = now()
  where id = (select source_question_id from public.source_question_parts where id = part_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger source_question_part_categories_touch_parent
after insert or update or delete on public.source_question_part_categories
for each row execute function public.touch_parent_from_part_metadata();
create trigger source_question_part_tags_touch_parent
after insert or update or delete on public.source_question_part_tags
for each row execute function public.touch_parent_from_part_metadata();

create or replace function public.touch_parent_from_bonus_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  bonus_id uuid;
begin
  bonus_id := coalesce(new.source_question_bonus_id, old.source_question_bonus_id);
  update public.source_questions
  set updated_at = now()
  where id = (select source_question_id from public.source_question_bonuses where id = bonus_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger source_question_bonus_categories_touch_parent
after insert or update or delete on public.source_question_bonus_categories
for each row execute function public.touch_parent_from_bonus_metadata();
create trigger source_question_bonus_tags_touch_parent
after insert or update or delete on public.source_question_bonus_tags
for each row execute function public.touch_parent_from_bonus_metadata();

-- Controlled vocabularies are readable by signed-in hosts and writable only by
-- internal question editors.
alter table public.categories enable row level security;
alter table public.prompt_patterns enable row level security;
alter table public.answer_types enable row level security;
alter table public.tags enable row level security;
alter table public.tag_aliases enable row level security;
alter table public.media_assets enable row level security;
alter table public.source_question_categories enable row level security;
alter table public.source_question_tags enable row level security;
alter table public.source_question_parts enable row level security;
alter table public.source_question_part_categories enable row level security;
alter table public.source_question_part_tags enable row level security;
alter table public.source_question_bonuses enable row level security;
alter table public.source_question_bonus_categories enable row level security;
alter table public.source_question_bonus_tags enable row level security;

revoke all on public.categories, public.prompt_patterns, public.answer_types,
  public.tags, public.tag_aliases, public.media_assets,
  public.source_question_categories, public.source_question_tags,
  public.source_question_parts, public.source_question_part_categories,
  public.source_question_part_tags, public.source_question_bonuses,
  public.source_question_bonus_categories, public.source_question_bonus_tags
  from anon;
grant select, insert, update, delete on public.categories,
  public.prompt_patterns, public.answer_types, public.tags, public.tag_aliases
  to authenticated;
grant select, insert, update, delete on public.media_assets,
  public.source_question_categories, public.source_question_tags,
  public.source_question_parts, public.source_question_part_categories,
  public.source_question_part_tags, public.source_question_bonuses,
  public.source_question_bonus_categories, public.source_question_bonus_tags
  to authenticated;
grant all on public.categories, public.prompt_patterns, public.answer_types,
  public.tags, public.tag_aliases, public.media_assets,
  public.source_question_categories, public.source_question_tags,
  public.source_question_parts, public.source_question_part_categories,
  public.source_question_part_tags, public.source_question_bonuses,
  public.source_question_bonus_categories, public.source_question_bonus_tags
  to service_role;

create policy "Hosts read active categories" on public.categories
for select to authenticated using (
  is_active or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor')
);
create policy "Hosts read active prompt patterns" on public.prompt_patterns
for select to authenticated using (
  is_active or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor')
);
create policy "Hosts read active answer types" on public.answer_types
for select to authenticated using (
  is_active or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor')
);
create policy "Hosts read active tags" on public.tags
for select to authenticated using (
  is_active or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor')
);
create policy "Hosts read tag aliases" on public.tag_aliases
for select to authenticated using (
  exists (select 1 from public.tags where tags.id = tag_aliases.tag_id)
);

create policy "Editors manage categories" on public.categories
for all to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor'))
with check (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor'));
create policy "Editors manage prompt patterns" on public.prompt_patterns
for all to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor'))
with check (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor'));
create policy "Editors manage answer types" on public.answer_types
for all to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor'))
with check (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor'));
create policy "Editors manage tags" on public.tags
for all to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor'))
with check (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor'));
create policy "Editors manage tag aliases" on public.tag_aliases
for all to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor'))
with check (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor'));

create policy "Hosts manage their media" on public.media_assets
for all to authenticated
using (
  (origin = 'user' and owner_id = (select auth.uid()))
  or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor')
)
with check (
  (origin = 'user' and owner_id = (select auth.uid()))
  or (origin = 'platform' and owner_id is null
    and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'question_editor'))
);
create policy "Hosts read platform media" on public.media_assets
for select to authenticated using (origin = 'platform');

create or replace function public.can_read_source_question(p_source_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.source_questions
    where id = p_source_question_id
      and (
        (origin = 'user' and owner_id = auth.uid())
        or (origin = 'platform' and status = 'active')
        or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'question_editor')
      )
  );
$$;

create or replace function public.can_edit_source_question(p_source_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.source_questions
    where id = p_source_question_id
      and (
        (origin = 'user' and owner_id = auth.uid())
        or (origin = 'platform'
          and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'question_editor'))
      )
  );
$$;

revoke all on function public.can_read_source_question(uuid) from public;
revoke all on function public.can_edit_source_question(uuid) from public;
grant execute on function public.can_read_source_question(uuid) to authenticated;
grant execute on function public.can_edit_source_question(uuid) to authenticated;

create policy "Read source categories" on public.source_question_categories
for select to authenticated using (public.can_read_source_question(source_question_id));
create policy "Edit source categories" on public.source_question_categories
for all to authenticated using (public.can_edit_source_question(source_question_id))
with check (public.can_edit_source_question(source_question_id));
create policy "Read source tags" on public.source_question_tags
for select to authenticated using (public.can_read_source_question(source_question_id));
create policy "Edit source tags" on public.source_question_tags
for all to authenticated using (public.can_edit_source_question(source_question_id))
with check (public.can_edit_source_question(source_question_id));
create policy "Read source parts" on public.source_question_parts
for select to authenticated using (public.can_read_source_question(source_question_id));
create policy "Edit source parts" on public.source_question_parts
for all to authenticated using (public.can_edit_source_question(source_question_id))
with check (public.can_edit_source_question(source_question_id));
create policy "Read source bonuses" on public.source_question_bonuses
for select to authenticated using (public.can_read_source_question(source_question_id));
create policy "Edit source bonuses" on public.source_question_bonuses
for all to authenticated using (public.can_edit_source_question(source_question_id))
with check (public.can_edit_source_question(source_question_id));

create policy "Read source part categories" on public.source_question_part_categories
for select to authenticated using (public.can_read_source_question((
  select source_question_id from public.source_question_parts where id = source_question_part_id
)));
create policy "Edit source part categories" on public.source_question_part_categories
for all to authenticated using (public.can_edit_source_question((
  select source_question_id from public.source_question_parts where id = source_question_part_id
))) with check (public.can_edit_source_question((
  select source_question_id from public.source_question_parts where id = source_question_part_id
)));
create policy "Read source part tags" on public.source_question_part_tags
for select to authenticated using (public.can_read_source_question((
  select source_question_id from public.source_question_parts where id = source_question_part_id
)));
create policy "Edit source part tags" on public.source_question_part_tags
for all to authenticated using (public.can_edit_source_question((
  select source_question_id from public.source_question_parts where id = source_question_part_id
))) with check (public.can_edit_source_question((
  select source_question_id from public.source_question_parts where id = source_question_part_id
)));
create policy "Read source bonus categories" on public.source_question_bonus_categories
for select to authenticated using (public.can_read_source_question((
  select source_question_id from public.source_question_bonuses where id = source_question_bonus_id
)));
create policy "Edit source bonus categories" on public.source_question_bonus_categories
for all to authenticated using (public.can_edit_source_question((
  select source_question_id from public.source_question_bonuses where id = source_question_bonus_id
))) with check (public.can_edit_source_question((
  select source_question_id from public.source_question_bonuses where id = source_question_bonus_id
)));
create policy "Read source bonus tags" on public.source_question_bonus_tags
for select to authenticated using (public.can_read_source_question((
  select source_question_id from public.source_question_bonuses where id = source_question_bonus_id
)));
create policy "Edit source bonus tags" on public.source_question_bonus_tags
for all to authenticated using (public.can_edit_source_question((
  select source_question_id from public.source_question_bonuses where id = source_question_bonus_id
))) with check (public.can_edit_source_question((
  select source_question_id from public.source_question_bonuses where id = source_question_bonus_id
)));

comment on table public.categories is
  'Controlled broad subject categories. General Knowledge is a composition mode and is never stored here.';
comment on table public.tags is
  'Canonical topic tags with hierarchy and diversity weight for search and quiz sequencing.';
comment on column public.source_questions.question_type is
  'Legacy runtime compatibility projection. New architecture uses mechanic plus optional media.';
comment on column public.source_questions.mechanic is
  'How the player responds; media is deliberately not a mechanic.';
comment on table public.source_question_parts is
  'Canonical part-level content and metadata for multi-part source questions.';
comment on table public.source_question_bonuses is
  'Optional one-to-one ordinary scored bonus attached to a reusable source question.';

commit;
