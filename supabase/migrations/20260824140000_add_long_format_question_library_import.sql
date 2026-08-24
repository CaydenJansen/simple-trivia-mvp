begin;

-- The approved human-facing model uses Audience Fit as a soft signal and a
-- separate family-safety boolean. Keep the previous audience/content columns
-- as compatibility projections until every deployed writer has migrated.
alter table public.source_questions
  add column audience_fit text not null default 'broad'
    check (audience_fit in ('broad', 'kids', 'young_adults', 'older_adults')),
  add column adult_content boolean not null default false;

alter table public.source_question_parts
  add column audience_fit text
    check (audience_fit is null or audience_fit in ('broad', 'kids', 'young_adults', 'older_adults')),
  add column adult_content boolean;

alter table public.source_question_bonuses
  add column audience_fit text
    check (audience_fit is null or audience_fit in ('broad', 'kids', 'young_adults', 'older_adults')),
  add column adult_content boolean,
  add column tag_mode text not null default 'inherit'
    check (tag_mode in ('inherit', 'replace'));

alter table public.source_tiebreakers
  add column primary_category_id uuid references public.categories(id) on delete set null,
  add column editorial_difficulty smallint check (editorial_difficulty between 1 and 5),
  add column audience_fit text not null default 'broad'
    check (audience_fit in ('broad', 'kids', 'young_adults', 'older_adults')),
  add column adult_content boolean not null default false,
  add column audience_scope text not null default 'global'
    check (audience_scope in ('global', 'country_specific')),
  add column audience_locale text,
  add constraint source_tiebreakers_audience_locale_check check (
    (audience_scope = 'global' and audience_locale is null)
    or (audience_scope = 'country_specific' and length(btrim(audience_locale)) > 0)
  );

create table public.proposed_question_tags (
  id uuid primary key default gen_random_uuid(),
  normalized_phrase text not null unique check (length(btrim(normalized_phrase)) > 0),
  display_phrase text not null check (length(btrim(display_phrase)) > 0),
  status text not null default 'pending' check (status in ('pending', 'mapped', 'created', 'ignored')),
  resolved_tag_id uuid references public.tags(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (
    (status = 'pending' and resolved_tag_id is null and resolved_at is null)
    or (status in ('mapped', 'created') and resolved_tag_id is not null and resolved_at is not null)
    or (status = 'ignored' and resolved_tag_id is null and resolved_at is not null)
  )
);

create table public.proposed_question_tag_assignments (
  id uuid primary key default gen_random_uuid(),
  proposed_tag_id uuid not null references public.proposed_question_tags(id) on delete cascade,
  import_batch_id uuid references public.question_library_import_batches(id) on delete set null,
  source_question_id uuid not null references public.source_questions(id) on delete cascade,
  source_question_part_id uuid references public.source_question_parts(id) on delete cascade,
  source_question_bonus_id uuid references public.source_question_bonuses(id) on delete cascade,
  raw_phrase text not null check (length(btrim(raw_phrase)) > 0),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (num_nonnulls(source_question_part_id, source_question_bonus_id) <= 1)
);

create unique index proposed_question_tag_parent_assignment_idx
  on public.proposed_question_tag_assignments (proposed_tag_id, source_question_id)
  where source_question_part_id is null and source_question_bonus_id is null;
create unique index proposed_question_tag_part_assignment_idx
  on public.proposed_question_tag_assignments (proposed_tag_id, source_question_part_id)
  where source_question_part_id is not null;
create unique index proposed_question_tag_bonus_assignment_idx
  on public.proposed_question_tag_assignments (proposed_tag_id, source_question_bonus_id)
  where source_question_bonus_id is not null;
create index proposed_question_tag_assignments_batch_idx
  on public.proposed_question_tag_assignments (import_batch_id);

alter table public.proposed_question_tags enable row level security;
alter table public.proposed_question_tag_assignments enable row level security;
revoke all on public.proposed_question_tags, public.proposed_question_tag_assignments from anon, authenticated;
grant all on public.proposed_question_tags, public.proposed_question_tag_assignments to service_role;

create or replace function public.normalize_question_tag_phrase(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(lower(regexp_replace(normalize(coalesce(p_value, ''), NFKD), '[^[:alnum:]]+', ' ', 'g')))
$$;

create or replace function public.enforce_question_tag_alias_safeguards()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  normalized text;
  target_tag_id uuid;
begin
  if tg_table_name = 'tags' then
    normalized := public.normalize_question_tag_phrase(new.name);
    if exists (
      select 1 from public.tags
      where id <> new.id and public.normalize_question_tag_phrase(name) = normalized
    ) then
      raise exception 'Canonical tag name % conflicts with an existing canonical tag', new.name;
    end if;
    if exists (
      select 1 from public.tag_aliases
      where normalized_alias = normalized and tag_id <> new.id
    ) then
      raise exception 'Canonical tag name % is already another tag''s alias', new.name;
    end if;
  else
    normalized := public.normalize_question_tag_phrase(new.alias);
    target_tag_id := new.tag_id;
    if exists (
      select 1 from public.tags
      where id <> target_tag_id and public.normalize_question_tag_phrase(name) = normalized
    ) then
      raise exception 'Alias % conflicts with another canonical tag name', new.alias;
    end if;
    new.normalized_alias := normalized;
  end if;
  return new;
end;
$$;

create trigger enforce_question_tag_name_safeguards
before insert or update of name on public.tags
for each row execute function public.enforce_question_tag_alias_safeguards();

create trigger enforce_question_tag_alias_safeguards
before insert or update of tag_id, alias, normalized_alias on public.tag_aliases
for each row execute function public.enforce_question_tag_alias_safeguards();

-- Seed the approved flat vocabulary. The display groupings in the authoring
-- guide deliberately do not create parent/child taxonomy records.
with approved(name) as (
  select unnest(array[
    'Pop Culture','World Records','Famous Quotes','1900s','1910s','1920s','1930s','1940s','1950s','1960s','1970s','1980s','1990s','2000s','2010s','2020s','2030s',
    'Film','Television','Books','Theatre','Comedy','Radio','Podcasts','Streaming','Celebrities','Actors','Directors','Musicians','Bands','Songs','Albums','Reality TV','Sitcoms','Cartoons','Animation','Children''s Media','Comics','Superheroes','Awards','Advertising','Logos','Soundtracks','Credits','Silhouettes',
    'Marvel','DC','Disney','Harry Potter','Star Wars','The Simpsons','Pokémon','James Bond','The Lord of the Rings','Game of Thrones',
    'Royalty','Law','Crime','Military','Weapons','Human Rights','Religion','Mythology','LGBTQ+','Relationships','Sexuality','Education','Universities','Holidays','Festivals',
    'Australia','New Zealand','United States','Canada','United Kingdom','Europe','Asia','Africa','South America','Middle East','Oceania','Countries','Cities','National Capitals','Flags','Maps','Landmarks','Architecture','Oceans','Rivers','Mountains','Islands',
    'Biology','Chemistry','Physics','Space','Medicine','Psychology','Human Body','Anatomy','Engineering','Inventions','Discoveries','Maths','Animals','Plants','Environment','Weather','Natural Disasters','Dinosaurs',
    'Olympics','AFL','NRL','Cricket','Soccer','Rugby Union','Rugby League','Tennis','Golf','Motorsport','Basketball','Baseball','American Football','Combat Sports','Horse Racing',
    'Food','Drink','Alcohol','Brands','Companies','Products','Money','Economics','Art','Paintings','Artists','Sculpture','Museums','Fashion','Design','Agriculture','Manufacturing','Transport','Cars','Aviation','Maritime','Trains','Roads','Toys','Board Games','Card Games','Video Games','Internet','Internet Culture','Social Media','Memes','Etymology','Spelling','Grammar','Poetry','Authors','Lyrics'
  ]::text[])
), prepared as (
  select name, trim(both '-' from regexp_replace(
    replace(replace(replace(lower(name), 'é', 'e'), '''', ''), '’', ''),
    '[^a-z0-9]+', '-', 'g'
  )) as slug
  from approved
)
insert into public.tags (slug, name, specificity, diversity_weight, is_active)
select prepared.slug, prepared.name, 2, 1, true
from prepared
where not exists (
  select 1
  from public.tags
  where tags.slug = prepared.slug
    or public.normalize_question_tag_phrase(tags.name)
      = public.normalize_question_tag_phrase(prepared.name)
)
on conflict (slug) do nothing;

with approved(name) as (
  select unnest(array[
    'Pop Culture','World Records','Famous Quotes','1900s','1910s','1920s','1930s','1940s','1950s','1960s','1970s','1980s','1990s','2000s','2010s','2020s','2030s',
    'Film','Television','Books','Theatre','Comedy','Radio','Podcasts','Streaming','Celebrities','Actors','Directors','Musicians','Bands','Songs','Albums','Reality TV','Sitcoms','Cartoons','Animation','Children''s Media','Comics','Superheroes','Awards','Advertising','Logos','Soundtracks','Credits','Silhouettes',
    'Marvel','DC','Disney','Harry Potter','Star Wars','The Simpsons','Pokémon','James Bond','The Lord of the Rings','Game of Thrones',
    'Royalty','Law','Crime','Military','Weapons','Human Rights','Religion','Mythology','LGBTQ+','Relationships','Sexuality','Education','Universities','Holidays','Festivals',
    'Australia','New Zealand','United States','Canada','United Kingdom','Europe','Asia','Africa','South America','Middle East','Oceania','Countries','Cities','National Capitals','Flags','Maps','Landmarks','Architecture','Oceans','Rivers','Mountains','Islands',
    'Biology','Chemistry','Physics','Space','Medicine','Psychology','Human Body','Anatomy','Engineering','Inventions','Discoveries','Maths','Animals','Plants','Environment','Weather','Natural Disasters','Dinosaurs',
    'Olympics','AFL','NRL','Cricket','Soccer','Rugby Union','Rugby League','Tennis','Golf','Motorsport','Basketball','Baseball','American Football','Combat Sports','Horse Racing',
    'Food','Drink','Alcohol','Brands','Companies','Products','Money','Economics','Art','Paintings','Artists','Sculpture','Museums','Fashion','Design','Agriculture','Manufacturing','Transport','Cars','Aviation','Maritime','Trains','Roads','Toys','Board Games','Card Games','Video Games','Internet','Internet Culture','Social Media','Memes','Etymology','Spelling','Grammar','Poetry','Authors','Lyrics'
  ]::text[])
), prepared as (
  select trim(both '-' from regexp_replace(
    replace(replace(replace(lower(name), 'é', 'e'), '''', ''), '’', ''),
    '[^a-z0-9]+', '-', 'g'
  )) as slug
  from approved
)
update public.tags
set is_active = true,
    updated_at = now()
from prepared
where tags.slug = prepared.slug;

with aliases(alias, canonical_name) as (values
  ('USA','United States'),('US','United States'),('U.S.','United States'),
  ('UK','United Kingdom'),('Movies','Film'),('Movie','Film'),('TV','Television'),
  ('LOTR','The Lord of the Rings'),('Pokemon','Pokémon'),
  ('90s','1990s'),('the 90s','1990s'),
  ('80s','1980s'),('the 80s','1980s'),
  ('00s','2000s'),('the 2000s','2000s'),('2000''s','2000s')
), prepared_aliases as (
  select distinct on (normalized_alias)
    alias,
    canonical_name,
    normalized_alias
  from (
    select
      aliases.alias,
      aliases.canonical_name,
      public.normalize_question_tag_phrase(aliases.alias) as normalized_alias
    from aliases
  ) normalized_aliases
  order by normalized_alias, alias
)
insert into public.tag_aliases (tag_id, alias, normalized_alias)
select tags.id, prepared_aliases.alias, prepared_aliases.normalized_alias
from prepared_aliases join public.tags on tags.name = prepared_aliases.canonical_name
on conflict (normalized_alias) do update set tag_id = excluded.tag_id, alias = excluded.alias;

create or replace view public.question_library_proposed_tag_review
with (security_invoker = true)
as
select
  proposed_question_tags.id,
  proposed_question_tags.display_phrase,
  proposed_question_tags.normalized_phrase,
  proposed_question_tags.status,
  proposed_question_tags.resolved_tag_id,
  count(proposed_question_tag_assignments.id)::integer as assignment_count,
  count(distinct proposed_question_tag_assignments.source_question_id)::integer as question_count,
  proposed_question_tags.first_seen_at,
  proposed_question_tags.last_seen_at,
  proposed_question_tags.resolved_at
from public.proposed_question_tags
left join public.proposed_question_tag_assignments
  on proposed_question_tag_assignments.proposed_tag_id = proposed_question_tags.id
group by proposed_question_tags.id;

revoke all on public.question_library_proposed_tag_review from anon, authenticated;
grant select on public.question_library_proposed_tag_review to service_role;

create or replace function public.resolve_question_library_tag_id(p_phrase text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := public.normalize_question_tag_phrase(p_phrase);
  resolved_id uuid;
begin
  select tags.id into resolved_id
  from public.tags
  where tags.is_active and public.normalize_question_tag_phrase(tags.name) = normalized
  order by tags.created_at
  limit 1;

  if resolved_id is null then
    select tags.id into resolved_id
    from public.tag_aliases
    join public.tags on tags.id = tag_aliases.tag_id
    where tags.is_active and tag_aliases.normalized_alias = normalized
    limit 1;
  end if;

  if resolved_id is null then
    select proposed_question_tags.resolved_tag_id into resolved_id
    from public.proposed_question_tags
    where proposed_question_tags.normalized_phrase = normalized
      and proposed_question_tags.status in ('mapped', 'created');
  end if;
  return resolved_id;
end;
$$;

revoke all on function public.resolve_question_library_tag_id(text) from public, anon, authenticated;

create or replace function public.attach_or_propose_question_tags(
  p_source_question_id uuid,
  p_source_question_part_id uuid,
  p_source_question_bonus_id uuid,
  p_import_batch_id uuid,
  p_phrases jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  phrase text;
  normalized text;
  resolved_id uuid;
  proposal_id uuid;
  proposal_status text;
  proposed_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_phrases, '[]'::jsonb)) <> 'array' then
    raise exception 'Tag phrases must be an array';
  end if;
  if p_source_question_part_id is not null and p_source_question_bonus_id is not null then
    raise exception 'A tag assignment cannot target both a Part and a Bonus';
  end if;
  if p_source_question_part_id is not null and not exists (
    select 1 from public.source_question_parts
    where id = p_source_question_part_id and source_question_id = p_source_question_id
  ) then
    raise exception 'The tag Part does not belong to the supplied Question';
  end if;
  if p_source_question_bonus_id is not null and not exists (
    select 1 from public.source_question_bonuses
    where id = p_source_question_bonus_id and source_question_id = p_source_question_id
  ) then
    raise exception 'The tag Bonus does not belong to the supplied Question';
  end if;

  for phrase in select value from jsonb_array_elements_text(coalesce(p_phrases, '[]'::jsonb)) loop
    normalized := public.normalize_question_tag_phrase(phrase);
    if normalized = '' then continue; end if;
    resolved_id := public.resolve_question_library_tag_id(phrase);

    if resolved_id is not null then
      if p_source_question_part_id is not null then
        insert into public.source_question_part_tags (source_question_part_id, tag_id)
        values (p_source_question_part_id, resolved_id) on conflict do nothing;
      elsif p_source_question_bonus_id is not null then
        insert into public.source_question_bonus_tags (source_question_bonus_id, tag_id)
        values (p_source_question_bonus_id, resolved_id) on conflict do nothing;
      else
        insert into public.source_question_tags (source_question_id, tag_id)
        values (p_source_question_id, resolved_id) on conflict do nothing;
      end if;
      continue;
    end if;

    proposal_id := null;
    proposal_status := null;
    select id, status into proposal_id, proposal_status
    from public.proposed_question_tags where normalized_phrase = normalized;
    if proposal_status = 'ignored' then continue; end if;

    insert into public.proposed_question_tags (normalized_phrase, display_phrase)
    values (normalized, btrim(phrase))
    on conflict (normalized_phrase) do update set last_seen_at = now()
    returning id into proposal_id;

    insert into public.proposed_question_tag_assignments (
      proposed_tag_id, import_batch_id, source_question_id,
      source_question_part_id, source_question_bonus_id, raw_phrase
    ) values (
      proposal_id, p_import_batch_id, p_source_question_id,
      p_source_question_part_id, p_source_question_bonus_id, btrim(phrase)
    ) on conflict do nothing
    returning id into proposal_id;
    if proposal_id is not null then proposed_count := proposed_count + 1; end if;
  end loop;
  return proposed_count;
end;
$$;

revoke all on function public.attach_or_propose_question_tags(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.resolve_question_library_proposed_tag(
  p_proposed_tag_id uuid,
  p_action text,
  p_tag_slug text default null,
  p_tag_name text default null,
  p_remember_alias boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.proposed_question_tags%rowtype;
  resolved_id uuid;
  assignment record;
  created_status text;
begin
  select * into proposal from public.proposed_question_tags where id = p_proposed_tag_id for update;
  if proposal.id is null then raise exception 'Proposed tag was not found'; end if;
  if proposal.status <> 'pending' then raise exception 'Proposed tag has already been resolved'; end if;
  if p_action not in ('map', 'create', 'ignore') then raise exception 'Action must be map, create or ignore'; end if;

  if p_action = 'ignore' then
    update public.proposed_question_tags set status = 'ignored', resolved_at = now() where id = proposal.id;
    update public.proposed_question_tag_assignments set resolved_at = now() where proposed_tag_id = proposal.id;
    return null;
  end if;

  if p_action = 'map' then
    select id into resolved_id from public.tags where slug = p_tag_slug and is_active;
    if resolved_id is null then raise exception 'Active canonical tag % was not found', p_tag_slug; end if;
    created_status := 'mapped';
  else
    if p_tag_slug is null or p_tag_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or length(btrim(coalesce(p_tag_name, ''))) = 0 then
      raise exception 'Creating a tag requires a valid slug and name';
    end if;
    insert into public.tags (slug, name) values (p_tag_slug, btrim(p_tag_name)) returning id into resolved_id;
    created_status := 'created';
  end if;

  for assignment in select * from public.proposed_question_tag_assignments where proposed_tag_id = proposal.id loop
    if assignment.source_question_part_id is not null then
      insert into public.source_question_part_tags (source_question_part_id, tag_id)
      values (assignment.source_question_part_id, resolved_id) on conflict do nothing;
    elsif assignment.source_question_bonus_id is not null then
      insert into public.source_question_bonus_tags (source_question_bonus_id, tag_id)
      values (assignment.source_question_bonus_id, resolved_id) on conflict do nothing;
    else
      insert into public.source_question_tags (source_question_id, tag_id)
      values (assignment.source_question_id, resolved_id) on conflict do nothing;
    end if;
  end loop;

  if p_remember_alias and not exists (
    select 1 from public.tags
    where id <> resolved_id and public.normalize_question_tag_phrase(name) = proposal.normalized_phrase
  ) then
    insert into public.tag_aliases (tag_id, alias, normalized_alias)
    values (resolved_id, proposal.display_phrase, proposal.normalized_phrase)
    on conflict (normalized_alias) do nothing;
  end if;

  update public.proposed_question_tags
  set status = created_status, resolved_tag_id = resolved_id, resolved_at = now()
  where id = proposal.id;
  update public.proposed_question_tag_assignments set resolved_at = now() where proposed_tag_id = proposal.id;
  return resolved_id;
end;
$$;

revoke all on function public.resolve_question_library_proposed_tag(uuid, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.resolve_question_library_proposed_tag(uuid, text, text, text, boolean)
  to service_role;

comment on table public.proposed_question_tags is
  'Normalized unknown topic phrases awaiting one bulk map/create/ignore decision.';
comment on table public.proposed_question_tag_assignments is
  'Question, Part, or Bonus assignments retained so bulk tag decisions enrich already-imported content.';
comment on column public.source_question_bonuses.tag_mode is
  'Whether blank Bonus tags inherit parent tags or populated Bonus tags replace them, even while proposed tags are unresolved.';

commit;
