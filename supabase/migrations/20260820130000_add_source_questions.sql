create table if not exists public.source_questions (
  id uuid primary key default gen_random_uuid(),
  origin text not null,
  owner_id uuid references auth.users(id) on delete cascade,
  question_type text not null,
  prompt text not null,
  correct_answer jsonb not null,
  accepted_answers jsonb not null default '[]'::jsonb,
  options jsonb,
  category text,
  difficulty text,
  tags text[] not null default '{}'::text[],
  image_url text,
  notes text,
  status text not null default 'draft',
  is_verified boolean not null default false,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  last_reviewed_at timestamptz,
  revision integer not null default 1,
  import_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_questions_origin_check
    check (origin in ('platform', 'user')),
  constraint source_questions_owner_check
    check (
      (origin = 'user' and owner_id is not null)
      or (origin = 'platform' and owner_id is null)
    ),
  constraint source_questions_type_check
    check (question_type in (
      'single-answer',
      'image-question',
      'multiple-choice',
      'multi-answer',
      'multi-part',
      'ranking'
    )),
  constraint source_questions_status_check
    check (status in ('draft', 'needs_review', 'active', 'archived')),
  constraint source_questions_user_verification_check
    check (
      origin = 'platform'
      or (
        is_verified = false
        and verified_at is null
        and verified_by is null
      )
    ),
  constraint source_questions_prompt_check
    check (length(btrim(prompt)) > 0),
  constraint source_questions_accepted_answers_check
    check (jsonb_typeof(accepted_answers) = 'array'),
  constraint source_questions_revision_check
    check (revision > 0)
);

create unique index if not exists source_questions_import_key_idx
  on public.source_questions (origin, import_key)
  where import_key is not null;

create index if not exists source_questions_owner_status_idx
  on public.source_questions (owner_id, status, updated_at desc)
  where origin = 'user';

create index if not exists source_questions_library_filters_idx
  on public.source_questions (status, question_type, category, difficulty)
  where origin = 'platform';

create index if not exists source_questions_tags_idx
  on public.source_questions using gin (tags);

create index if not exists source_questions_prompt_search_idx
  on public.source_questions
  using gin (to_tsvector('simple', prompt));

create or replace function public.touch_source_question()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.revision = old.revision + 1;
  return new;
end;
$$;

drop trigger if exists source_questions_touch_before_update
on public.source_questions;

create trigger source_questions_touch_before_update
before update on public.source_questions
for each row execute function public.touch_source_question();

alter table public.quiz_questions
  add column if not exists source_question_id uuid
    references public.source_questions(id) on delete set null,
  add column if not exists source_revision integer,
  add column if not exists accepted_answers jsonb not null default '[]'::jsonb,
  add column if not exists tags text[] not null default '{}'::text[];

alter table public.quiz_questions
  drop constraint if exists quiz_questions_accepted_answers_check,
  drop constraint if exists quiz_questions_source_revision_check;

alter table public.quiz_questions
  add constraint quiz_questions_accepted_answers_check
    check (jsonb_typeof(accepted_answers) = 'array'),
  add constraint quiz_questions_source_revision_check
    check (source_revision is null or source_revision > 0);

create index if not exists quiz_questions_source_question_idx
  on public.quiz_questions (source_question_id)
  where source_question_id is not null;

alter table public.game_questions
  add column if not exists accepted_answers jsonb not null default '[]'::jsonb,
  add column if not exists tags text[] not null default '{}'::text[];

alter table public.game_questions
  drop constraint if exists game_questions_accepted_answers_check;

alter table public.game_questions
  add constraint game_questions_accepted_answers_check
    check (jsonb_typeof(accepted_answers) = 'array');

alter table public.source_questions enable row level security;

revoke all on table public.source_questions from anon;
grant select, insert, update, delete on table public.source_questions to authenticated;
grant all on table public.source_questions to service_role;

drop policy if exists "Hosts read their questions and active library"
on public.source_questions;

create policy "Hosts read their questions and active library"
on public.source_questions
for select
to authenticated
using (
  (origin = 'user' and owner_id = (select auth.uid()))
  or (origin = 'platform' and status = 'active')
  or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '')
    in ('admin', 'question_editor')
);

drop policy if exists "Hosts create their own questions"
on public.source_questions;

create policy "Hosts create their own questions"
on public.source_questions
for insert
to authenticated
with check (
  origin = 'user'
  and owner_id = (select auth.uid())
);

drop policy if exists "Hosts update their own questions"
on public.source_questions;

create policy "Hosts update their own questions"
on public.source_questions
for update
to authenticated
using (
  origin = 'user'
  and owner_id = (select auth.uid())
)
with check (
  origin = 'user'
  and owner_id = (select auth.uid())
);

drop policy if exists "Hosts delete their own questions"
on public.source_questions;

create policy "Hosts delete their own questions"
on public.source_questions
for delete
to authenticated
using (
  origin = 'user'
  and owner_id = (select auth.uid())
);

drop policy if exists "Editors manage platform questions"
on public.source_questions;

create policy "Editors manage platform questions"
on public.source_questions
for all
to authenticated
using (
  origin = 'platform'
  and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '')
    in ('admin', 'question_editor')
)
with check (
  origin = 'platform'
  and owner_id is null
  and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '')
    in ('admin', 'question_editor')
);

comment on table public.source_questions is
  'Reusable source records for user-owned My Questions and the platform Question Library.';

comment on column public.source_questions.accepted_answers is
  'Alternate normalized answers. Single-answer uses a flat array; multi-answer and multi-part use arrays aligned to canonical answer positions.';

comment on column public.quiz_questions.source_question_id is
  'Optional provenance only. Quiz content is an independent snapshot and never synchronizes automatically.';
